/**
 * Storage events against the real services (docs/ADR-064, ADR-072): this machine's Wasabi keys and network volume. No pod, nothing billed beyond a few MB of storage.
 * Its own sync rules, history, job file and ComfyUI-Shared folder (a temporary one), so your settings and files are not touched. It writes only under zz-live-test/<run>/
 * and removes exactly the objects it wrote. Nothing is approved or published, and nothing goes near the BH bucket.
 * LIVE_VOLUME=<id> and LIVE_STORAGE=<id> choose other targets (defaults: the configured network volume, wasabi).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'live-storage-')), shared = join(dir, 'ComfyUI-Shared')
const realMounts = process.env.MOUNTS_FILE || join(homedir(), '.config', 'runpod-pod-manager', 'mounts.json')
const cfg = JSON.parse(readFileSync(realMounts, 'utf8'))
const VOL: string = process.env.LIVE_VOLUME || cfg.network_volume_id, STORE = process.env.LIVE_STORAGE || 'wasabi'
writeFileSync(join(dir, 'mounts.json'), JSON.stringify({ ...cfg, folders: { ...cfg.folders, 'comfy-shared': shared } }), { mode: 0o600 })
Object.assign(process.env, { MOUNTS_FILE: join(dir, 'mounts.json'), SYNC_RULES_FILE: join(dir, 'sync-rules.json'), HISTORY_FILE: join(dir, 'history.jsonl'), SOURCE_SYNC_JOBS_FILE: join(dir, 'source-sync.json') })
writeFileSync(join(dir, 'sync-rules.json'), '{"rules":{}}')

const { storage, syncrules, localcopy, publish, sourcesync } = await import('../src/index.js')
const run = `zz-live-test/${new Date().toISOString().replace(/[:.]/g, '-')}`
type Acc = { env: Record<string, string>; common: string[] }
let wasabi: ReturnType<typeof storage.storageAccess>, vol: Acc & { bucket: string }
const made: { acc: Acc; uri: string }[] = []
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex')
const aws = async (acc: Acc, args: string[]) => { const r = await storage.aws([...args, ...acc.common], acc.env, { stallMs: 120_000 }); if (r.code !== 0 && !(args[1] === 'ls' && r.code === 1)) throw new Error(publish.redact(r.stderr || r.stdout)); return r.stdout }
const arrives = async (f: string, want: string, ms = 90_000) => { for (let t = 0; t < ms; t += 500) { if (existsSync(f) && sha(f) === want) return true; await new Promise((r) => setTimeout(r, 500)) } return false }
const settle = async () => { for (let i = 0; i < 120; i++) { if (!(await sourcesync.status()).jobs.some((j) => ['queued', 'running', 'downloading'].includes(j.state))) return; await new Promise((r) => setTimeout(r, 500)) } }
/** A file of `bytes` random bytes, put on the volume at output/<key>. */
async function onVolume(key: string, bytes: number) {
  const local = join(dir, `src-${made.length}`); writeFileSync(local, randomBytes(bytes))
  const uri = `s3://${vol.bucket}/comfy-shared/output/${key}`
  await aws(vol, ['s3', 'cp', local, uri]); made.push({ acc: vol, uri })
  made.push({ acc: wasabi, uri: `s3://${wasabi.bucket}/${wasabi.prefix}${key}` })   // wherever it may be copied to
  return { local, sha: sha(local), file: { source_key: `comfy-shared/output/${key}`, key, bytes } }
}
const inBucket = async (key: string) => (await aws(wasabi, ['s3', 'ls', `s3://${wasabi.bucket}/${wasabi.prefix}${key}`])).trim().split(/\s+/)[2]
async function sameInBucket(key: string, want: string) {
  const back = join(dir, 'back'); await aws(wasabi, ['s3', 'cp', `s3://${wasabi.bucket}/${wasabi.prefix}${key}`, back]); const s = sha(back); rmSync(back); return s === want
}

beforeAll(async () => {
  wasabi = storage.storageAccess(STORE)
  const v = await publish.volumeS3Access(VOL); if (!v.ok) throw new Error(v.reason)
  vol = { bucket: v.bucket, env: { AWS_ACCESS_KEY_ID: v.id, AWS_SECRET_ACCESS_KEY: v.secret, AWS_REGION: v.region }, common: ['--region', v.region, '--endpoint-url', v.endpoint] }
})
afterAll(async () => {
  await settle()
  for (const m of made) await aws(m.acc, ['s3', 'rm', m.uri]).catch((e) => console.warn(`not removed: ${m.uri}: ${(e as Error).message}`))
  rmSync(dir, { recursive: true, force: true })
})

describe.each(['approved', 'published', 'generated'] as const)(`live: %s`, (ev) => {
  const folder = `${run}/${ev}`
  let big: Awaited<ReturnType<typeof onVolume>>, meta: Awaited<ReturnType<typeof onVolume>>
  it('files only on the volume reach the storage byte for byte (with no pod), sidecar included', async () => {
    syncrules.set(VOL, ev, [{ type: 'storage', id: STORE }])
    big = await onVolume(`${folder}/clip.mov`, 12 * 1024 * 1024); meta = await onVolume(`${folder}/clip.mov.meta.json`, 700)
    expect(await storage.uploadFromVolume(ev, VOL, [big.file, meta.file])).toEqual([])
    expect(await inBucket(big.file.key)).toBe(String(big.file.bytes))
    expect(await sameInBucket(big.file.key, big.sha)).toBe(true)
    expect(await sameInBucket(meta.file.key, meta.sha)).toBe(true)
    expect(existsSync(join(shared, 'output', big.file.key))).toBe(false)   // no This PC rule yet: nothing comes down
  })
  it('sent again it is already there, and This PC pulls it from the storage when the storage is ticked', async () => {
    syncrules.set(STORE, ev, [{ type: 'local' }])
    expect(await storage.uploadFromVolume(ev, VOL, [big.file, meta.file])).toEqual([])
    const job = storage.uploadJobs().jobs.find((j) => j.event === ev)!
    expect([job.state, job.files_skipped, job.bytes_done]).toEqual(['done', 2, 0])
    expect(await arrives(join(shared, 'output', big.file.key), big.sha)).toBe(true)
    expect(await arrives(join(shared, 'output', meta.file.key), meta.sha)).toBe(true)
    syncrules.set(STORE, ev, [])
  })
  it('This PC pulls the event folder straight from the volume when the volume has This PC ticked', async () => {
    await settle()
    const f = await onVolume(`${folder}-direct/clip.mov`, 2048)
    syncrules.set(VOL, ev, [{ type: 'local' }])
    await localcopy.onEvent(ev, VOL, [`comfy-shared/output/${folder}-direct`])
    expect(await arrives(join(shared, 'output', f.file.key), f.sha)).toBe(true)
  })
})

describe('live: a file on this PC', () => {
  it('goes to the storage and comes back to this PC from it', async () => {
    await settle()
    const key = `${run}/from-pc/probe.txt`, local = join(dir, 'pc-probe'); writeFileSync(local, randomBytes(4096))
    made.push({ acc: wasabi, uri: `s3://${wasabi.bucket}/${wasabi.prefix}${key}` })
    syncrules.set(VOL, 'generated', [{ type: 'storage', id: STORE }]); syncrules.set(STORE, 'generated', [{ type: 'local' }])
    expect(await storage.uploadOn('generated', [{ abs: local, key }], undefined, VOL)).toEqual([])
    expect(await sameInBucket(key, sha(local))).toBe(true)
    const came = await arrives(join(shared, 'output', key), sha(local))
    expect(came, readFileSync(join(dir, 'history.jsonl'), 'utf8').split('\n').filter((l) => l.includes('from-pc') || l.includes('source sync')).slice(-8).join('\n')).toBe(true)
  })
})
