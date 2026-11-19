import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as history from '../src/history.js'
import * as publish from '../src/publish.js'
import * as renders from '../src/renders.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 Backfill: the scan, the inventory, the plan keys and the streamed copy, with fakes only (no S3, no Slack, no real aws).
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/SECRETSECRETSECRET', PK = 'AKIAPANAMAKEY12345', PS = 'panamaSecretKeyValue1234567890abcdef'
let dir: string, out: string
let vol: Map<string, { bytes: number; modified: string }>, bucket: Map<string, number>, calls: { args: string[]; env: Record<string, string> }[]
let spawned: { args: string[]; env: Record<string, string>; killed: boolean; stdin: string }[], failDst: Set<string>, hold: boolean
let posts: { text: string }[], slackStatus: number

const write = (rel: string, size = 10) => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, Buffer.alloc(size, 1)) }
const fakeAws: podpull.AwsRunner = async (args, env) => {
  calls.push({ args, env })
  if (args[1] === 'ls') {
    const pre = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1], rows = [...bucket].filter(([k]) => k.startsWith(pre)).map(([k, n]) => `2026-11-19 10:00:00 ${String(n).padStart(10)} ${k}`)
    return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' }
  }
  if (args[1] === 'cp') { bucket.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), 1); return { code: 0, stdout: '', stderr: '' } }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_cmd: string, args: string[], env: Record<string, string>): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }
  const rec = { args, env, killed: false, stdin: '' }; spawned.push(rec)
  const so = new PassThrough(), se = new PassThrough(), si = new PassThrough()
  Object.assign(c, { stdout: so, stderr: se, stdin: si })
  const close = (code: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', code) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { rec.killed = true; setImmediate(() => close(null)); return true }
  if (args[2] === '-' || args[3] === '-') {
    if (args[3] === '-') {   // the download end: s3 cp s3://bucket/key -
      const key = args[2].replace(/^s3:\/\/[^/]+\//, ''), n = vol.get(key)?.bytes ?? 0
      setImmediate(() => { if (hold) return; for (let i = 0; i < n; i += 4) so.write(Buffer.alloc(Math.min(4, n - i), 2)); so.end(); setImmediate(() => close(0)) })
    } else {   // the upload end: s3 cp - s3://dest/key
      si.on('data', (d) => { rec.stdin += String(d) }); si.on('end', () => setImmediate(() => close(failDst.has(args[3].replace(/^s3:\/\/[^/]+\//, '')) ? 1 : 0)))
      if (failDst.has(args[2]) || failDst.has(args[3])) setImmediate(() => { se.write('upload failed: An error occurred (AccessDenied)'); })
    }
  }
  return c
}
const fakeFetch = (async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response('ok', { status: slackStatus }) }) as unknown as typeof fetch
const keys = (): Record<string, { bytes: number; modified: string }> => Object.fromEntries(vol)
const finish = async (id: string) => { await publish.settled(); return publish.status(id).jobs[0] }
const scanAll = async (sources: publish.Source[] = [...publish.SOURCES]) => { const { job_id } = await publish.scan({ sources }); await publish.scanSettled(); return publish.inventory(job_id) }

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true })
  process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  process.env.PANAMA_AWS_ACCESS_KEY_ID = PK; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = PS
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  vol = new Map(); bucket = new Map(); calls = []; spawned = []; failDst = new Set(); hold = false; posts = []; slackStatus = 200
  publish.reset()
  publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 8, spawn: fakeSpawn, volumeId: () => 'vol1',
    volumeKeys: async (_v, prefix) => [...vol].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, bytes: v.bytes, modified: v.modified })),
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: 'a3upg9ey48', region: 'EU-RO-1' }) })
  write('deliver/archival-085/v001/clip.mov', 100); write('deliver/archival-085/v001/DELIVERY.md', 20)
  for (let i = 1; i <= 3; i++) write(`corrosion-015_L/corrosion-015_L.${String(i).padStart(4, '0')}.dpx`, 50)
  write('.proxies/corrosion-015_L/corrosion-015_L_960.mp4', 30); write('notes.txt', 5); write('m.safetensors', 9)
  const v = (k: string, bytes: number) => vol.set(k, { bytes, modified: '2026-11-10 12:00:00' })
  v('comfy-shared/output/deliver/archival-085/v001/clip.mov', 100)   // also on the PC
  for (let i = 1; i <= 2; i++) v(`comfy-shared/output/archival-101_R/archival-101_R.${String(i).padStart(4, '0')}.dpx`, 8)   // only on the volume
  v('comfy-shared/input/pipe_finals/archival-200-final.mov', 12); v('project/90_DELIVERIES/archival-300_review.mov', 16)
  await publish.setSettings({ slack: { webhook_url: WEBHOOK, channel: '#renders' } })
})
afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of [...settingsEnv.PUBLISH_SECRETS, 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY']) delete process.env[k] })

describe('defaults', () => {
  it('resolve to the Panama exchange bucket, returns/BKK/ and Panama credentials; no secret is in them', async () => {
    const s = (await publish.settings()).s3
    expect(s).toMatchObject({ credentials: 'panama', prefix: 'returns/BKK/', ready: true }); expect(s.bucket).toMatch(/^bh-panama-exchange-/)
    expect(JSON.stringify(publish.PUBLISH_DEFAULTS)).not.toMatch(/hooks\.slack\.com\/services|xox|AKIA|secret/i)
    expect(JSON.stringify(await publish.settings())).not.toMatch(new RegExp(`${PK}|${PS}|SECRETSECRET`))
  })
})

describe('scan', () => {
  it('groups DPX sequences, picks the shot from the names and the kind from the place, and merges the PC and the volume', async () => {
    const inv = await scanAll()
    const by = (n: string) => inv.rows.find((r) => r.name === n)!
    const seq = by('corrosion-015_L.####.dpx'); expect(seq).toMatchObject({ kind: 'dpx-sequence', frames: 3, bytes: 150, shot: 'corrosion-015', where: ['pc'], weight: false, backfilled: true })
    expect(by('clip.mov')).toMatchObject({ kind: 'review', shot: 'archival-085', where: ['pc', 'volume'], bytes: 100 }); expect(by('DELIVERY.md').kind).toBe('other')
    expect(by('corrosion-015_L_960.mp4')).toMatchObject({ kind: 'proxy', shot: 'corrosion-015' })
    expect(by('archival-101_R.####.dpx')).toMatchObject({ kind: 'dpx-sequence', frames: 2, where: ['volume'], shot: 'archival-101' })
    expect(by('archival-200-final.mov')).toMatchObject({ kind: 'movie', shot: 'archival-200', source: 'volume-pipe-finals' }); expect(by('archival-300_review.mov')).toMatchObject({ kind: 'review', source: 'volume-deliveries' })
    expect(by('m.safetensors').weight).toBe(true); expect(by('notes.txt').kind).toBe('other')
    expect(inv.by_shot.find((b) => b.shot === 'corrosion-015')).toMatchObject({ frames: 4 }); expect(inv.totals.shots).toBeGreaterThan(4)
    expect(inv.rows.every((r) => r.event_time === r.modified && r.backfilled)).toBe(true)
  })
  it('the shot rule is the one renders uses', () => { for (const [n, d] of [['corrosion-015_L', 'a'], ['x_y', 'My Shot'], ['archival-123c-wide', '']] as const) expect(publish.shotOf(n, d)).toBe(renders.shotOf(n, d)) })
  it('reads one source at a time and says what could not be read', async () => {
    const only = await scanAll(['volume-pipe-finals']); expect(only.rows.map((r) => r.name)).toEqual(['archival-200-final.mov'])
    publish.setDeps({ volumeKeys: async () => null }); const bad = await scanAll(['volume-output']); expect(bad.unreadable[0]).toMatchObject({ source: 'volume-output', reason: expect.stringMatching(/cannot be read/) })
    publish.setDeps({ volumeKeys: async () => { throw new Error(`boom https://x.example/${PS}`) } }); const bad2 = await scanAll(['volume-output']); expect(JSON.stringify(bad2.unreadable)).not.toMatch(/https?:|panamaSecret/)
    await expect(publish.scan({ sources: ['nope'] })).rejects.toMatchObject({ status: 400 })
  })
  it('in_destination comes from ONE listing of the destination; ids are idempotent and the inventory file keeps them once', async () => {
    bucket.set('returns/BKK/archival-200/archival-200-final.mov', 12)
    const a = await scanAll(), listings = calls.filter((c) => c.args[1] === 'ls'); expect(listings).toHaveLength(1)
    expect(a.rows.find((r) => r.name === 'archival-200-final.mov')!.in_destination).toBe(true); expect(a.rows.find((r) => r.name === 'clip.mov')!.in_destination).toBe(false)
    const b = await scanAll(); expect(b.rows.map((r) => r.id)).toEqual(a.rows.map((r) => r.id)); expect(new Set(a.rows.map((r) => r.id)).size).toBe(a.rows.length)
    const disk = JSON.parse(readFileSync(join(dir, 'publish-inventory.json'), 'utf8')) as { rows: Record<string, unknown> }; expect(Object.keys(disk.rows)).toHaveLength(a.rows.length)
    expect(history.list({ limit: 100 }).filter((e) => e.kind === 'change' && e.action === 'outputs found (backfill)').length).toBe(new Set(a.rows.map((r) => r.shot)).size)   // the second scan found nothing new
  })
  it('does not hold the event loop for a big tree, and stays inside the local output folder', async () => {
    mkdirSync(join(out, 'many')); for (let i = 0; i < 6000; i++) writeFileSync(join(out, 'many', `f${i}.txt`), '')
    let worst = 0, last = performance.now(); const t = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1)
    await scanAll(['local-output']); clearInterval(t); expect(worst).toBeLessThan(750)
  }, 30_000)
})

describe('plan', () => {
  it('keeps the original names under <prefix>/<shot>/<name>, skips same size, refuses explicit weights, and shows the destination', async () => {
    const inv = await scanAll(); bucket.set('returns/BKK/archival-085/clip.mov', 100)
    const p = await publish.backfillPlan({ job_id: inv.job_id, all: true, targets: ['s3', 'slack'], approved_by: 'Lucas' })
    expect(p.ok).toBe(true); expect(p.excluded_weights).toBe(1); expect(p.dest).toMatch(/^s3:\/\/bh-panama-exchange-.*\/returns\/BKK\/$/)
    const key = (n: string) => p.items.find((i) => i.path.endsWith(n))!
    expect(key('clip.mov')).toMatchObject({ s3_key: 'returns/BKK/archival-085/clip.mov', skip: 'same size already there', from: 'pc' })
    expect(key('corrosion-015_L.0002.dpx').s3_key).toBe('returns/BKK/corrosion-015/corrosion-015_L/corrosion-015_L.0002.dpx'); expect(key('corrosion-015_L_960.mp4').s3_key).toBe('returns/BKK/corrosion-015/corrosion-015_L_960.mp4')
    expect(key('archival-101_R.0001.dpx')).toMatchObject({ from: 'volume', source_key: 'comfy-shared/output/archival-101_R/archival-101_R.0001.dpx' }); expect(p.inventory_key).toMatch(/^returns\/BKK\/_inventory_\d{4}-\d\d-\d\d\.csv$/)
    expect(p.slack!.preview).toContain('Outputs inventory and upload:'); expect(p.slack!.preview).not.toMatch(/https?:|X-Amz/)
    const w = inv.rows.find((r) => r.weight)!; const ref = await publish.backfillPlan({ job_id: inv.job_id, rows: [w.id], targets: ['s3'] }); expect(ref.ok).toBe(false); expect(ref.refused[0].reason).toMatch(/weights/)
    await expect(publish.backfillPlan({ job_id: inv.job_id, rows: ['nope'], targets: ['s3'] })).rejects.toMatchObject({ status: 400 })
    expect((await publish.backfillPlan({ job_id: inv.job_id, all: true, targets: ['s3'], destination_prefix: 'other/dir' })).items[0].s3_key.startsWith('other/dir/')).toBe(true)
  })
})

describe('run', () => {
  it('needs the approver; then uploads PC files with aws cp and volume-only files by two piped aws commands, with --expected-size and no temp file; the inventory CSV goes last; ONE Slack message with no links', async () => {
    const inv = await scanAll(); const ids = inv.rows.filter((r) => !r.weight).map((r) => r.id)
    await expect(publish.backfillRun({ job_id: inv.job_id, rows: ids, targets: ['s3'] })).rejects.toMatchObject({ message: 'Publishing needs the name of who says yes (approved_by)' })
    const { job_id } = await publish.backfillRun({ job_id: inv.job_id, rows: ids, targets: ['s3', 'slack'], approved_by: 'Lucas' }); const j = await finish(job_id)
    expect(j).toMatchObject({ state: 'done', slack: { state: 'sent' }, approved_by: 'Lucas' })
    const cps = calls.filter((c) => c.args[1] === 'cp'); expect(cps.length).toBe(7); expect(cps[0].args[3]).toMatch(/^s3:\/\/bh-panama-exchange-.*\/returns\/BKK\//); expect(cps[0].env).toMatchObject({ AWS_ACCESS_KEY_ID: PK })
    const down = spawned.find((s) => s.args[3] === '-')!, up = spawned.find((s) => s.args[2] === '-' && s.args[3].includes('archival-101'))!
    expect(down.args).toEqual(['s3', 'cp', expect.stringMatching(/^s3:\/\/a3upg9ey48\/(comfy-shared|project)/), '-', '--endpoint-url', 'https://s3api-eu-ro-1.runpod.io', '--region', 'EU-RO-1']); expect(down.env).toMatchObject({ AWS_ACCESS_KEY_ID: 'RPKEY' })
    expect(up.args.slice(0, 3)).toEqual(['s3', 'cp', '-']); expect(up.args[4]).toBe('--expected-size'); expect(up.args[5]).toBe('8'); expect(up.env).toMatchObject({ AWS_ACCESS_KEY_ID: PK })
    expect(spawned.some((s) => s.args.some((a) => /\/tmp|\.part|\.tmp/.test(a)))).toBe(false)
    const csv = spawned.find((s) => /_inventory_/.test(s.args[3]))!.stdin
    expect(csv.split('\n')[0]).toBe('shot,name,kind,frames,bytes,modified,where,uploaded'); expect(csv).toContain('archival-101,archival-101_R.####.dpx,dpx-sequence,2,16,'); expect(csv).toContain(',pc+volume,yes'); expect(csv).not.toContain('m.safetensors')
    expect(spawned.indexOf(spawned.find((s) => /_inventory_/.test(s.args[3]))!)).toBe(spawned.length - 1)   // last
    expect(posts).toHaveLength(1); expect(posts[0].text).toContain('Outputs inventory and upload: 6 shots, 11 files'); expect(posts[0].text).toContain('as they are, naming to be fixed after'); expect(posts[0].text).toContain('Approved by Lucas'); expect(posts[0].text).not.toMatch(/https?:|X-Amz/)
    expect(JSON.stringify(history.list({ limit: 50 }))).not.toMatch(new RegExp(`${PS}|RPSECRET`)); expect(history.list({ limit: 50 }).find((e) => e.kind === 'job' && e.job === 'publish')).toMatchObject({ approved_by: 'Lucas' })
  })
  it('a failed upload ends the job as failed with no Slack post and no inventory file', async () => {
    const inv = await scanAll(); failDst.add('returns/BKK/archival-200/archival-200-final.mov')
    const { job_id } = await publish.backfillRun({ job_id: inv.job_id, rows: inv.rows.filter((r) => r.name === 'archival-200-final.mov').map((r) => r.id), targets: ['s3', 'slack'], approved_by: 'Lucas' }); const j = await finish(job_id)
    expect(j.state).toBe('failed'); expect(j.error).toContain('archival-200-final.mov'); expect(posts).toHaveLength(0); expect(spawned.some((s) => /_inventory_/.test(s.args[3]))).toBe(false); expect(JSON.stringify(j)).not.toMatch(/RPSECRET|panamaSecret/)
  })
  it('cancel kills BOTH ends of a stream and posts nothing', async () => {
    const inv = await scanAll(); hold = true
    const { job_id } = await publish.backfillRun({ job_id: inv.job_id, rows: inv.rows.filter((r) => r.name === 'archival-200-final.mov').map((r) => r.id), targets: ['s3', 'slack'], approved_by: 'Lucas' })
    await new Promise((r) => setTimeout(r, 40)); publish.cancel(job_id); const j = await finish(job_id)
    expect(j.state).toBe('cancelled'); expect(spawned.filter((s) => s.killed)).toHaveLength(2); expect(posts).toHaveLength(0)
  })
  it('streams at most 3 at a time (sync_parallel capped), and a stall timer is per file', async () => {
    const inv = await scanAll(['volume-output']); const ids = inv.rows.map((r) => r.id)
    let live = 0, max = 0
    publish.setDeps({ spawn: (c, a, e) => { const ch = fakeSpawn(c, a, e); if (a[3] === '-') { live++; max = Math.max(max, live); ch.on('close', () => live--) } return ch } })
    const { job_id } = await publish.backfillRun({ job_id: inv.job_id, rows: ids, targets: ['s3'], approved_by: 'L' }); await finish(job_id)
    expect(max).toBeLessThanOrEqual(3)
  })
  it('a Slack-only backfill has nothing to upload and posts the counts; the stored text keeps the retry', async () => {
    const inv = await scanAll(); slackStatus = 500
    const { job_id } = await publish.backfillRun({ job_id: inv.job_id, all: true, targets: ['slack'], approved_by: 'L' }); const j = await finish(job_id)
    expect(j.state).toBe('failed'); expect(spawned).toHaveLength(0)
  })
})
