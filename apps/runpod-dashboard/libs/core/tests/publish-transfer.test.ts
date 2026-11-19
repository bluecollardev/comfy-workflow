import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as publish from '../src/publish.js'
import * as history from '../src/history.js'
import * as settingsEnv from '../src/settings.js'
import { configDir } from '../src/paths.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 amendment "transfer adapters": a volume file reaches the bucket from a pod on the volume (curl -T to a presigned PUT made here) or streamed through this PC. Fakes only: no pod, no S3.
vi.setConfig({ testTimeout: 15_000 })
const VOLB = 'a3upg9ey48', DEST = 'my-internal-bucket', O = 'comfy-shared/output/', SECRET = 'secretsecretsecret1234', KEYID = 'AKIAEXAMPLE12345'
const POD = { id: 'pod-1', name: 'ComfyUI-Dev', host: 'root@203.0.113.9', port: 40022 }
let dir: string, vol: Map<string, number>, dest: Map<string, number>, spawned: { args: string[] }[], scripts: string[], urls: string[], podRef: typeof POD | null
let probe: { curl: boolean; sha: boolean; ssh: boolean }, putMode: 'ok' | 'fail' | 'leak' | 'hang', failOnly: string | null, stopped: string[], now: number, sshCalls: number

const row = (k: string, n: number) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${k}`
const fakeAws: podpull.AwsRunner = async (args) => {
  if (args[0] === 's3api') { const pre = args[args.indexOf('--prefix') + 1]; const keys = [...vol.keys()].filter((k) => k.startsWith(pre)).slice(0, 2); return { code: 0, stdout: JSON.stringify(keys.length ? { Contents: keys.map((Key) => ({ Key })) } : {}), stderr: '' } }
  if (args[0] === 's3' && args[1] === 'ls') {
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!, store = m[1] === VOLB ? vol : dest, pre = m[2], recursive = args.includes('--recursive')
    const under = [...store].filter(([k]) => k.startsWith(pre)).sort()
    if (recursive) { const rows = under.map(([k, n]) => row(k, n)); return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' } }
    const pres = new Set<string>(), files: string[] = []
    for (const [k, n] of under) { const r = k.slice(pre.length); if (r.includes('/')) pres.add(`${r.split('/')[0]}/`); else files.push(row(r, n)) }
    return { code: pres.size || files.length ? 0 : 1, stdout: [...[...pres].map((x) => `                           PRE ${x}`), ...files].join('\n'), stderr: '' }
  }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_c: string, args: string[]): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }; spawned.push({ args })
  const so = new PassThrough(), se = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: se, stdin: si })
  const close = (code: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', code) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { setImmediate(() => close(null)); return true }
  if (args[3] === '-') { const n = vol.get(args[2].replace(/^s3:\/\/[^/]+\//, '')) ?? 0; setImmediate(() => { so.write(Buffer.alloc(n, 2)); so.end(); setImmediate(() => close(0)) }) }
  else if (args[2] === '-') { si.on('data', () => undefined); si.on('end', () => { dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), 1); setImmediate(() => close(0)) }) }
  return c
}
const fakeSsh: podpull.SshRunner = async ({ script, onLine, signal }) => {
  sshCalls++
  if (!probe.ssh) return { code: 255 }
  if (script.includes('PROBE-END')) { if (probe.curl) onLine('PROBE-CURL'); if (probe.sha) onLine('PROBE-SHA'); onLine('PROBE-END'); return { code: 0 } }
  if (script.includes('pkill')) { stopped.push(script); onLine(''); return { code: 0 } }
  const url = /url = "([^"]+)"/.exec(script)![1], file = /^f='(.*)'$/m.exec(script)![1]
  scripts.push(script); urls.push(url)
  onLine('PUBLISH-PID 4242')
  if (putMode === 'hang') return new Promise((res) => signal.addEventListener('abort', () => res({ code: null }), { once: true }))
  if ((putMode === 'fail' || putMode === 'leak') && (!failOnly || file.endsWith(failOnly))) {
    onLine('PUBLISH-SHA ' + createHash('sha256').update(file).digest('hex'))
    if (putMode === 'leak') { onLine(`curl: (22) The requested URL returned error: 403 ${url} ${SECRET}`); onLine(`PUBLISH-FAIL curl exit 22 ${url}`) } else onLine('PUBLISH-FAIL curl exit 22')
    return { code: 22 }
  }
  onLine('PUBLISH-SHA ' + createHash('sha256').update(file).digest('hex')); onLine('PUBLISH-OK'); return { code: 0 }
}
const sha = (f: string) => createHash('sha256').update(f).digest('hex')
const configure = (transfer?: string) => publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: DEST, prefix: 'returns/BKK', region: 'us-west-2', access_key_id: KEYID, secret_access_key: SECRET, ...(transfer ? { transfer } : {}) } })
const items = [{ where: 'volume' as const, path: 'delivery_v007/clipA.mov' }, { where: 'volume' as const, path: 'top.mov' }]
const go = async (extra: Record<string, unknown> = {}) => { const { job_id } = await publish.run({ items, targets: ['s3'], approved_by: 'Lucas', ...extra }); await publish.settled(); return publish.status(job_id).jobs[0] }

beforeEach(async () => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); mkdirSync(join(dir, 'out'), { recursive: true })
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  spawned = []; scripts = []; urls = []; stopped = []; sshCalls = 0; now = Date.parse('2026-11-19T10:00:00Z'); dest = new Map(); podRef = POD
  probe = { curl: true, sha: true, ssh: true }; putMode = 'ok'; failOnly = null
  vol = new Map([[`${O}delivery_v007/clipA.mov`, 400], [`${O}top.mov`, 5]])
  publish.reset(); publish.setDeps({ aws: fakeAws, outputRoot: () => join(dir, 'out'), parallel: () => 8, spawn: fakeSpawn, now: () => now, volumeId: () => 'vol1', ssh: fakeSsh, podOnVolume: async () => podRef,
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  await configure()
})
afterEach(() => { publish.reset(); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('the s3.transfer setting', () => {
  it('defaults to auto, saves pod and pc, goes back to auto, and refuses anything else', async () => {
    expect((await publish.settings()).s3.transfer).toBe('auto')
    expect((await publish.setSettings({ s3: { transfer: 'pod' } })).s3.transfer).toBe('pod'); expect((await publish.setSettings({ s3: { transfer: 'pc' } })).s3.transfer).toBe('pc')
    expect((await publish.setSettings({ s3: { transfer: 'auto' } })).s3.transfer).toBe('auto')
    await expect(publish.setSettings({ s3: { transfer: 'fast' } })).rejects.toMatchObject({ status: 400 })
  })
})

describe('the pod adapter (auto, a pod is available)', () => {
  it('uploads each file from the pod with a presigned PUT, records the pod, the adapter and the sha256, and streams nothing through this PC', async () => {
    const j = await go()
    expect(j.state).toBe('done'); expect(j.adapter).toBe('pod'); expect(j.pod).toBe('ComfyUI-Dev'); expect(j.pod_files).toBe(2); expect(j.pc_files).toBe(0)
    expect(spawned).toEqual([]); expect(urls).toHaveLength(2)
    expect(j.files.map((f) => [f.path, f.adapter, f.sha256]).sort()).toEqual([['delivery_v007/clipA.mov', 'pod', sha(`/workspace/${O}delivery_v007/clipA.mov`)], ['top.mov', 'pod', sha(`/workspace/${O}top.mov`)]])
    const u = new URL(urls.find((x) => x.includes('top.mov'))!); expect(u.host).toBe(`${DEST}.s3.us-west-2.amazonaws.com`); expect(u.pathname).toBe('/returns/BKK/top.mov'); expect(u.searchParams.get('X-Amz-Expires')).toBe('3600'); expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host'); expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set(urls).size).toBe(2)   // one URL per destination key
    for (const s of scripts) { expect(s).not.toContain(SECRET); expect(s).toContain('curl -fsS'); expect(s).toContain('-K -'); expect(s).toContain('sha256sum'); expect(s.split('\n').filter((l) => l.startsWith('curl')).join('')).not.toContain('X-Amz') }   // the link is a curl config on stdin, never an argument
    expect(j.summary).toMatch(/2 files uploaded/)
  })
  it('the probe is true only with a running pod AND curl AND sha256sum; otherwise auto uses this PC (and records it)', async () => {
    for (const [why, mutate] of [['no curl', () => { probe.curl = false }], ['no sha256sum', () => { probe.sha = false }], ['ssh down', () => { probe.ssh = false }], ['no pod', () => { podRef = null }]] as [string, () => void][]) {
      publish.reset(); publish.setDeps({ aws: fakeAws, outputRoot: () => join(dir, 'out'), parallel: () => 8, spawn: fakeSpawn, now: () => now, volumeId: () => 'vol1', ssh: fakeSsh, podOnVolume: async () => podRef, volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
      probe = { curl: true, sha: true, ssh: true }; podRef = POD; mutate(); spawned = []; dest = new Map(); urls = []
      const j = await go()
      expect(j.state, why).toBe('done'); expect(j.adapter, why).toBe('pc'); expect(j.pod, why).toBeUndefined(); expect(j.pc_files, why).toBe(2); expect(urls, why).toEqual([]); expect(spawned.length, why).toBeGreaterThan(0)
    }
  })
  it('a streamed file also gets its sha256 (of the bytes that went through)', async () => {
    probe.curl = false; const j = await go()
    expect(j.files.find((f) => f.path === 'top.mov')).toMatchObject({ path: 'top.mov', adapter: 'pc', sha256: createHash('sha256').update(Buffer.alloc(5, 2)).digest('hex') })
  })
  it('podAvailable says why in plain words', async () => {
    const a = { keys: { id: KEYID, secret: SECRET } } as Parameters<typeof publish.podAvailable>[0]
    podRef = null; expect(await publish.podAvailable(a)).toMatchObject({ ok: false, reason: expect.stringMatching(/no running pod is attached to the volume/) })
    podRef = POD; probe.curl = false; expect(await publish.podAvailable(a)).toMatchObject({ ok: false, reason: 'pod ComfyUI-Dev has no curl' })
    probe.curl = true; expect(await publish.podAvailable(a)).toMatchObject({ ok: true })
    expect(await publish.podAvailable({ keys: null } as never)).toMatchObject({ ok: false })
  })
})

describe('selection', () => {
  it('pc forces this PC even when a pod is available (the pod is not even asked)', async () => {
    await publish.setSettings({ s3: { transfer: 'pc' } }); const j = await go()
    expect(j.adapter).toBe('pc'); expect(sshCalls).toBe(0); expect(spawned.length).toBeGreaterThan(0)
  })
  it('pod forces the pod and fails clearly when it is not available (nothing is streamed)', async () => {
    await publish.setSettings({ s3: { transfer: 'pod' } }); podRef = null; const j = await go()
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/Transfer is set to Pod, but no running pod is attached to the volume/); expect(spawned).toEqual([])
    podRef = POD; probe.sha = false; const k = await go(); expect(k.state).toBe('failed'); expect(k.error).toMatch(/has no sha256sum/)
  })
  it('auto falls back to this PC for ONE file when the pod fails it, and records which adapter carried each', async () => {
    putMode = 'fail'; failOnly = 'clipA.mov'; const j = await go()
    expect(j.state).toBe('done'); expect(j.adapter).toBe('pod'); expect(j.pod_files).toBe(1); expect(j.pc_files).toBe(1)
    expect(j.files.find((f) => f.path === 'delivery_v007/clipA.mov')!.adapter).toBe('pc'); expect(j.files.find((f) => f.path === 'top.mov')!.adapter).toBe('pod')
    expect(spawned.filter((s) => s.args[2] === '-')).toHaveLength(1); expect(urls.filter((u) => u.includes('clipA'))).toHaveLength(1)   // the pod tried once, this PC once
  })
  it('a forced pod does not fall back: the file fails with the pod named', async () => {
    await publish.setSettings({ s3: { transfer: 'pod' } }); putMode = 'fail'; const j = await go()
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/via pod ComfyUI-Dev: curl exit 22/); expect(spawned).toEqual([])
  })
  it('local files are unaffected: no ssh for a publish with no volume item', async () => {
    const { writeFileSync } = await import('node:fs'); writeFileSync(join(dir, 'out', 'a.txt'), 'hello')
    const { job_id } = await publish.run({ items: ['a.txt'], targets: ['s3'], approved_by: 'L' }); await publish.settled()
    expect(publish.status(job_id).jobs[0].adapter).toBe('pc'); expect(sshCalls).toBe(0)
  })
})

describe('a presigned URL is a credential', () => {
  it('never reaches the job view, the stored job file, History or an error, even when the pod echoes it back', async () => {
    putMode = 'leak'; await publish.setSettings({ s3: { transfer: 'pod' } }); const j = await go()
    expect(j.state).toBe('failed'); expect(urls.length).toBeGreaterThan(0)
    const persisted = existsSync(join(configDir(), 'publish-jobs.json')) ? readFileSync(join(configDir(), 'publish-jobs.json'), 'utf8') : ''
    const hist = JSON.stringify(history.list({ limit: 200 })), view = JSON.stringify(publish.status().jobs)
    for (const [where, text] of [['view', view], ['job file', persisted], ['history', hist]] as const) {
      for (const u of urls) { expect(text, where).not.toContain(u); expect(text, where).not.toContain(new URL(u).searchParams.get('X-Amz-Signature')!) }
      expect(text, where).not.toContain('X-Amz-'); expect(text, where).not.toContain(SECRET)
    }
    expect(persisted).not.toBe('')
  })
  it('redact strikes a live URL, an X-Amz query and the keys from any text', async () => {
    expect(publish.redact(`x https://b.s3.amazonaws.com/k?X-Amz-Signature=abc&X-Amz-Credential=${KEYID} y ${SECRET}`)).toBe('x <url> y •••')
    expect(publish.redact('q X-Amz-Signature=abcdef12 z')).toBe('q ••• z')
  })
  it('the success path stores no URL either (job file and History)', async () => {
    const j = await go(); expect(j.state).toBe('done')
    const text = readFileSync(join(configDir(), 'publish-jobs.json'), 'utf8') + JSON.stringify(history.list({ limit: 200 }))
    expect(text).not.toContain('X-Amz-'); expect(text).not.toContain(SECRET); expect(text).toContain('via pod ComfyUI-Dev')
  })
})

describe('cancel and spending', () => {
  it('cancelling stops the pod-side transfer too (a kill by pid over ssh) and does not fall back to this PC', async () => {
    putMode = 'hang'; const { job_id } = await publish.run({ items, targets: ['s3'], approved_by: 'L' })
    await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0)); publish.cancel(job_id); await publish.settled()
    const j = publish.status(job_id).jobs[0]
    expect(j.state).toBe('cancelled'); expect(spawned).toEqual([]); expect(stopped.length).toBeGreaterThan(0); expect(stopped[0]).toMatch(/pkill -TERM -P 4242/); expect(stopped[0]).toMatch(/kill -TERM 4242/)
  })
  it('never creates, resumes or stops a pod: only the pod list is read, and the scripts that run on a pod name no pod control', async () => {
    await go()
    const src = readFileSync(join(__dirname, '..', 'src', 'publish.ts'), 'utf8')
    expect([...new Set([...src.matchAll(/\brp\.(\w+)/g)].map((m) => m[1]))]).toEqual(['listPods'])
    for (const s of scripts) expect(s).not.toMatch(/runpodctl|stop pod|start pod|terminate/i)
    expect(history.list({ kind: 'pod', limit: 50 })).toEqual([])
  })
})
