import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as autosync from '../src/autosync.js'
import * as changes from '../src/changes.js'
import * as history from '../src/history.js'
import * as journal from '../src/journal.js'
import * as mounts from '../src/mounts.js'
import * as podpull from '../src/podpull.js'
import * as runflows from '../src/runflows.js'
import * as store from '../src/autosyncstore.js'
import * as syncrun from '../src/syncrun.js'
import { scratch } from './helpers.js'
import { VOL, fakeBucket, noS3Env, s3Env } from './s3fake.js'

// THE ACCEPTANCE TEST of Auto sync (ADR-046): outputs come down by themselves. Real controller, real sync machinery (syncrun.run), fake rsync/aws, fake RunPod, fake S3. No real ssh, aws, volume or pod.
const POD = 'pod1', C = 'comfy-shared/'
let dir: string, shared: string, t: number, execs: string[][], peak: number, inFlight: number, failNext: boolean
const T0 = Date.parse('2026-11-18T10:00:00Z')
const until = async (f: () => unknown, n = 100) => { for (let i = 0; i < n && !f(); i++) await new Promise((r) => setTimeout(r, 10)) }
const localTime = (ms: number) => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
const loc = (p: string) => join(shared, p)
const put = (p: string, size: number) => { mkdirSync(dirname(loc(p)), { recursive: true }); const fd = openSync(loc(p), 'w'); ftruncateSync(fd, size); closeSync(fd) }
const item = () => autosync.status().items.find((i) => i.pod_id === POD)!
const enable = (o: Partial<store.Settings> = {}) => store.set(POD, { enabled: true, pull: true, approved_by: 'Lucas', ...o })

// ----- fake RunPod: a pod that runs (SSH) or is stopped with an S3 volume -----
let running = true
const pod = () => ({ id: POD, name: 'p', networkVolumeId: VOL, runtime: running ? { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } : { uptimeInSeconds: 0, ports: [] } })
const client = { apiKey: 'test', fetchFn: (async (url: string) => (String(url).includes('graphql') ? { ok: true, status: 200, json: async () => ({ data: { pod: pod() } }) } : { ok: true, status: 200, json: async () => ({ id: VOL, name: 'v', size: 100, dataCenterId: 'EU-RO-1' }) })) as unknown as typeof fetch }
/** A fake rsync / aws: records the command, and "copies" the files it was asked for into the mapped folder (size 100, as the fake volume lists them). */
const exec: syncrun.Exec = async (cmd, onLine) => {
  if (cmd.includes('-n')) return 0
  execs.push(cmd); inFlight++; peak = Math.max(peak, inFlight)
  await new Promise((r) => setTimeout(r, 12))
  inFlight--
  if (failNext) return 255
  if (cmd[0] === 'rsync') { const list = readFileSync(cmd[cmd.indexOf('--files-from') + 1], 'utf8').split('\n').filter(Boolean); for (const f of list) { put(join(cmd.at(-1)!.replace(shared + '/', ''), f), 100); onLine(f) } }
  else { const dst = cmd.at(-1)!; put(dst.replace(shared + '/', ''), 100); onLine(`download: ${cmd.at(-2)} to ${dst}`) }
  return 0
}
let remote: autosync.Remote[], feedEvents: journal.JournalEvent[]
const R = (path: string, bytes = 100, modified = '2026-11-18T09:00:00'): autosync.Remote => ({ path, bytes, modified })

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true })
  for (const [k, f] of [['AUTOSYNC_FILE', 'a.json'], ['AUTOSYNC_STATE_FILE', 's.json'], ['AUTOSYNC_MANIFEST_FILE', 'm.json'], ['HISTORY_FILE', 'h.jsonl'], ['VOLUME_SNAPSHOTS_FILE', 'snap.json'], ['SYNC_LOGS_DIR', 'logs'], ['SYNC_RUNS_FILE', 'runs.json']]) process.env[k] = join(dir, f)
  s3Env(); const cfg = mounts.load(); cfg.folders['comfy-shared'] = shared; cfg.sync_parallel = 4; mounts.save(cfg)
  t = T0; execs = []; peak = 0; inFlight = 0; failNext = false; running = true; remote = []; feedEvents = []
  autosync.reset()
  autosync.setDeps({
    now: () => t, volumeOf: async () => VOL, tail: async () => 'k000', reconcile: async () => undefined, podName: () => 'CanalV2-lores',
    feed: async (_v, since) => { const e = feedEvents.filter((x) => x.seq > since); return { volume_id: VOL, cursor: e.length ? e[e.length - 1].seq : since, events: e, more: false } },
    files: async (_v, entries) => remote.filter((r) => entries.some((e) => e.paths?.includes(r.path) || (e.prefix && r.path.startsWith(e.prefix)))),
    run: (req, send, signal) => syncrun.run(req, send, signal, client, exec),   // the REAL sync machinery over fake transports
    timer: { set: () => 0, clear: () => undefined },
  })
})
afterEach(() => { autosync.reset(); noS3Env(); for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE', 'VOLUME_SNAPSHOTS_FILE', 'SYNC_LOGS_DIR', 'SYNC_RUNS_FILE']) delete process.env[k] })

describe('1. a Run workflows job finishes with files: exactly those paths come down, same relative path, both transports', () => {
  const historyEntry = { status: { status_str: 'success', completed: true }, outputs: { '9': { images: [{ filename: 'a.0001.dpx', subfolder: 'proxy_v004/shotA', type: 'output' }, { filename: 'a.0002.dpx', subfolder: 'proxy_v004/shotA', type: 'output' }, { filename: 'prev.png', subfolder: '', type: 'temp' }] } }, prompt: [] }
  const run = async () => { const files = runflows.outcomeOf(historyEntry as never)!.files!; remote = [R('output/proxy_v004/shotA/a.0001.dpx'), R('output/proxy_v004/shotA/a.0002.dpx'), R('output/proxy_v004/shotA/other.dpx')]; autosync.notifyOutputs(POD, VOL, files); await until(() => item().state === 'done'); await autosync.settle() }
  it('the run job calls notifyOutputs (wired in runflows.ts, best effort)', () => { expect(readFileSync(join(import.meta.dirname, '..', 'src', 'runflows.ts'), 'utf8')).toMatch(/autosync\.notifyOutputs\(i\.job\.pod_id/) })
  it('pod RUNNING: over SSH, rsync --files-from', async () => {
    enable(); await run()
    expect(execs.every((c) => c[0] === 'rsync' && c.includes('--files-from'))).toBe(true)
    expect(existsSync(loc('output/proxy_v004/shotA/a.0001.dpx')) && existsSync(loc('output/proxy_v004/shotA/a.0002.dpx'))).toBe(true); expect(existsSync(loc('output/proxy_v004/shotA/other.dpx'))).toBe(false)   // exactly those, not the folder
    expect(item()).toMatchObject({ state: 'done', summary: expect.stringMatching(/^Pulled 2 files \(.+\) to output\/$/) })
  })
  it('pod STOPPED: over the S3 route, aws s3 cp per key, no pod needed', async () => {
    running = false; enable(); await run()
    expect(execs.length).toBe(2); expect(execs.every((c) => c[0] === 'aws' && c[2] === 'cp' && c.includes('--endpoint-url'))).toBe(true)
    expect(execs.map((c) => c.at(-2)).sort()).toEqual([`s3://${VOL}/${C}output/proxy_v004/shotA/a.0001.dpx`, `s3://${VOL}/${C}output/proxy_v004/shotA/a.0002.dpx`])
    expect(existsSync(loc('output/proxy_v004/shotA/a.0002.dpx'))).toBe(true); expect(existsSync(loc('output/proxy_v004/shotA/other.dpx'))).toBe(false); expect(item().state).toBe('done')
    expect(JSON.stringify(execs)).not.toMatch(/user_x|rps_y/)   // the S3 keys travel in the environment, never in a command line
  })
})

describe('2. outputs made by anything else arrive through the feed and the reconciler within one cycle', () => {
  it('a new file under output/ (a pod\'s own ComfyUI, the web UI, a queue job): the reconciler emits an event, the controller pulls it', async () => {
    const b = fakeBucket({ [`${C}output/old/a.dpx`]: { size: 100 } })
    const jopts = { aws: b.aws, now: () => new Date(t), rand: () => 0.5 }
    autosync.setDeps({ tail: (v) => journal.tail(v, jopts), feed: (v, since) => journal.list({ volume_id: v, since, limit: 500 }, jopts),
      reconcile: async (v, extra) => { await changes.reconcile(v, { ...jopts, extra }) },
      files: async (v, entries) => { const out: autosync.Remote[] = []; for (const e of entries) for (const p of (e.paths ?? [])) { const rows = await changes.listRows(v, `${C}${p.slice(0, p.lastIndexOf('/'))}`, false, jopts); out.push(...rows.filter((r) => r.key === `${C}${p}`).map((r) => R(p, r.bytes, r.modified))) } for (const e of entries) if (e.prefix) out.push(...(await changes.listRows(v, `${C}${e.prefix}`, true, jopts)).map((r) => R(r.key.slice(C.length), r.bytes, r.modified))); return out } })
    enable(); await autosync.syncNow(POD); await autosync.settle()      // the baseline: what was already there is not an event (the catch-up pulls it, case 8)
    execs.length = 0; put('output/old/a.dpx', 100)
    t += 60_000; b.put(`${C}output/web_ui/new_00001.dpx`, { size: 100, modified: '2026-11-18 09:00:00' })   // made somewhere else
    await changes.reconcile(VOL, jopts)
    expect((await journal.list({ volume_id: VOL }, jopts)).events.some((e) => e.writer === 'reconciler' && e.op === 'created' && e.paths?.includes('output/web_ui/new_00001.dpx'))).toBe(true)
    await autosync.tick(); await autosync.settle()
    expect(existsSync(loc('output/web_ui/new_00001.dpx'))).toBe(true); expect(item().state).toBe('done')
  })
})

describe('3. outputs that landed while the app was closed are caught up at the next start (the cursor is persisted)', () => {
  it('a restart (memory gone, files kept) pulls what the feed gained meanwhile, and nothing twice', async () => {
    enable(); feedEvents.push({ seq: 'k001', ts: '', writer: 'reconciler', op: 'created', prefix: 'output/r1/' } as journal.JournalEvent); remote = [R('output/r1/a.dpx')]
    await autosync.tick(); await autosync.settle(); expect(item().state).toBe('done'); expect(JSON.parse(readFileSync(process.env.AUTOSYNC_STATE_FILE!, 'utf8')).cursors[`${VOL}:${POD}`]).toBe('k001')
    // the app is closed; a pod keeps working
    feedEvents.push({ seq: 'k002', ts: '', writer: 'pod:abc', op: 'created', paths: ['output/r2/b.dpx', 'output/r2/c.dpx'] } as journal.JournalEvent); remote.push(R('output/r2/b.dpx'), R('output/r2/c.dpx'))
    autosync.reset()   // the app starts again: nothing in memory
    autosync.setDeps({ now: () => t, volumeOf: async () => VOL, tail: async () => 'k002', reconcile: async () => undefined, podName: () => 'p', timer: { set: () => 0, clear: () => undefined },
      feed: async (_v, since) => { const e = feedEvents.filter((x) => x.seq > since); return { volume_id: VOL, cursor: e.length ? e.at(-1)!.seq : since, events: e, more: false } },
      files: async (_v, entries) => remote.filter((r) => entries.some((e) => e.paths?.includes(r.path) || (e.prefix && r.path.startsWith(e.prefix)))), run: (req, send, signal) => syncrun.run(req, send, signal, client, exec) })
    execs.length = 0; await autosync.tick(); await autosync.settle()
    expect(existsSync(loc('output/r2/b.dpx')) && existsSync(loc('output/r2/c.dpx'))).toBe(true); expect(existsSync(loc('output/r1/a.dpx'))).toBe(true)
    expect(item().summary).toMatch(/^Pulled 2 files/)
  })
})

describe('4. what is already here', () => {
  it('a same-size local file is skipped; a different existing local file is a reported conflict and is never overwritten', async () => {
    enable(); put('output/r/same.dpx', 100); put('output/r/mine.dpx', 55)
    feedEvents.push({ seq: 'k001', ts: '', writer: 'reconciler', op: 'created', prefix: 'output/r/' } as journal.JournalEvent); remote = [R('output/r/same.dpx'), R('output/r/mine.dpx'), R('output/r/new.dpx')]
    await autosync.tick(); await autosync.settle()
    expect(statSync(loc('output/r/mine.dpx')).size).toBe(55); expect(existsSync(loc('output/r/new.dpx'))).toBe(true)
    expect(item().conflicts.map((c) => c.path)).toEqual(['output/r/mine.dpx']); expect(item().summary).toMatch(/^Pulled 1 file /)
  })
})

describe('5. sync_parallel streams, and nothing blocking', () => {
  it('20 files with sync_parallel 4 over SSH: four rsyncs at once, never more; the status says streams', async () => {
    enable(); remote = Array.from({ length: 20 }, (_, i) => R(`output/seq/f${String(i).padStart(4, '0')}.dpx`)); autosync.notifyOutputs(POD, VOL, remote.map((r) => r.path))
    await until(() => item().state === 'syncing' || item().state === 'done'); expect(item().streams).toBe(4); await until(() => item().state === 'done'); await autosync.settle()
    expect(peak).toBe(4); expect(execs.length).toBe(4); expect(item()).toMatchObject({ state: 'done', files_done: 20, files_total: 20 })
  })
  it('over S3 a pool of aws s3 cp: at most sync_parallel at once', async () => {
    running = false; enable(); remote = Array.from({ length: 20 }, (_, i) => R(`output/seq/f${i}.dpx`)); autosync.notifyOutputs(POD, VOL, remote.map((r) => r.path))
    await until(() => item().state === 'done'); await autosync.settle(); expect(execs.length).toBe(20); expect(peak).toBeLessThanOrEqual(4); expect(peak).toBeGreaterThan(1)
  })
  it('status() answers at once while the pull is in flight', async () => {
    enable(); remote = [R('output/r/a.dpx')]; autosync.notifyOutputs(POD, VOL, ['output/r/a.dpx'])
    await until(() => item().state === 'syncing'); const t0 = performance.now(); for (let i = 0; i < 20; i++) autosync.status(); expect((performance.now() - t0) / 20).toBeLessThan(5); await autosync.settle()
  })
})

describe('6. what the person sees', () => {
  it('syncing -> done with "Pulled N files (X) to output/"', async () => {
    enable(); remote = [R('output/r/a.dpx', 600_000_000), R('output/r/b.dpx', 600_000_000)]; autosync.notifyOutputs(POD, VOL, remote.map((r) => r.path))
    await until(() => item().state === 'syncing' || item().state === 'done'); await until(() => item().state === 'done'); await autosync.settle()
    expect(item().summary).toBe('Pulled 2 files (1.2 GB) to output/')
  })
  it('a missing mapped folder gives the "Map ComfyUI-Shared first" error', async () => {
    enable(); autosync.setDeps({ localRoot: () => null }); remote = [R('output/r/a.dpx')]; autosync.notifyOutputs(POD, VOL, ['output/r/a.dpx']); await until(() => item().state === 'error')
    expect(item().error).toMatch(/^Map ComfyUI-Shared first/)
  })
  it('a failed pull is an error item, retried after 5 minutes, and the files are not lost', async () => {
    enable(); remote = [R('output/r/a.dpx'), R('output/r/b.dpx')]; failNext = true; autosync.notifyOutputs(POD, VOL, remote.map((r) => r.path))
    await until(() => item().state === 'error'); await autosync.settle(); expect(item().state).toBe('error'); expect(existsSync(loc('output/r/a.dpx'))).toBe(false)
    failNext = false; t += 60_000; await autosync.tick(); await autosync.settle(); expect(item().state).toBe('error')   // not hammered
    t += 5 * 60_000; await autosync.tick(); await autosync.settle(); await until(() => item().state === 'done')
    expect(existsSync(loc('output/r/a.dpx')) && existsSync(loc('output/r/b.dpx'))).toBe(true); expect(item().error).toBe('')
  })
})

describe('7. a file still being written is waited for, not pulled half-written and not a conflict', () => {
  it('a file the volume lists as modified a moment ago is left until it is stable; the cursor does not move past it', async () => {
    enable(); feedEvents.push({ seq: 'k001', ts: '', writer: 'reconciler', op: 'created', prefix: 'output/r/' } as journal.JournalEvent)
    remote = [R('output/r/done.dpx', 100, '2026-11-18T09:00:00'), R('output/r/growing.dpx', 50, new Date(t - 2000).toISOString().slice(0, 19))]
    remote[1].modified = localTime(t - 2000).replace(' ', 'T')
    await autosync.tick(); await autosync.settle()
    expect(existsSync(loc('output/r/done.dpx'))).toBe(true); expect(existsSync(loc('output/r/growing.dpx'))).toBe(false); expect(item().conflicts).toEqual([])
    expect(JSON.parse(readFileSync(process.env.AUTOSYNC_STATE_FILE!, 'utf8')).cursors[`${VOL}:${POD}`] ?? 'k000').toBe('k000')
    t += 10_000; remote[1] = R('output/r/growing.dpx', 100, localTime(t - 8000).replace(' ', 'T')); await autosync.tick(); await autosync.settle()
    expect(statSync(loc('output/r/growing.dpx')).size).toBe(100); expect(item().conflicts).toEqual([])
  })
  it('a transfer that fails because the file vanished or is not finished is an error that is retried, never a conflict', async () => {
    enable(); remote = [R('output/r/a.dpx')]; failNext = true; autosync.notifyOutputs(POD, VOL, ['output/r/a.dpx']); await until(() => item().state === 'error'); await autosync.settle()
    expect(item().conflicts).toEqual([]); failNext = false; t += 6 * 60_000; await autosync.tick(); await autosync.settle(); await until(() => item().state === 'done'); expect(existsSync(loc('output/r/a.dpx'))).toBe(true)
  })
})

describe('8. turning Auto sync on catches up with what was already on the volume (automatically)', () => {
  const set = (id: string, s: Partial<store.Settings>) => autosync.set(id, s)
  it('off -> on starts exactly ONE catch-up of output/ with trigger auto-sync:enable; on -> on does not; Pull off does not; off and on again does', async () => {
    remote = [R('output/old/a.dpx'), R('output/old/b.dpx')]
    set(POD, { enabled: true, pull: false, approved_by: 'Lucas' }); await new Promise((r) => setTimeout(r, 50)); expect(execs).toHaveLength(0)   // no pull: nothing to catch up
    set(POD, { enabled: false }); set(POD, { enabled: true, pull: true, approved_by: 'Lucas' })
    await until(() => item().state === 'done'); await autosync.settle()
    expect(execs.length).toBeGreaterThan(0); expect(existsSync(loc('output/old/a.dpx')) && existsSync(loc('output/old/b.dpx'))).toBe(true); expect(item().summary).toMatch(/^Pulled 2 files/)
    const jobs = () => history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'sync')
    expect(jobs()).toHaveLength(1); expect(jobs()[0]).toMatchObject({ trigger: 'auto-sync:enable', files: 2 })
    const n = execs.length; set(POD, { enabled: true, pull: true, approved_by: 'Lucas' }); await new Promise((r) => setTimeout(r, 50)); await autosync.settle(); expect(execs.length).toBe(n); expect(jobs()).toHaveLength(1)   // on -> on
    set(POD, { enabled: false }); put('output/old/a.dpx', 100); remote = [R('output/old/c.dpx')]; set(POD, { enabled: true, pull: true, approved_by: 'Lucas' })
    await until(() => execs.length > n); await autosync.settle(); expect(existsSync(loc('output/old/c.dpx'))).toBe(true); expect(jobs()).toHaveLength(2)   // off and on again
  })
  it('the usual rules apply: same size skipped, a different local file is a conflict, models/ and the project tree are never involved', async () => {
    put('output/old/same.dpx', 100); put('output/old/mine.dpx', 5)
    remote = [R('output/old/same.dpx'), R('output/old/mine.dpx'), R('output/old/new.dpx'), R('models/m.safetensors'), R('input/a.png')]
    set(POD, { enabled: true, pull: true, approved_by: 'Lucas' }); await until(() => item().state === 'done'); await autosync.settle()
    expect(existsSync(loc('output/old/new.dpx'))).toBe(true); expect(statSync(loc('output/old/mine.dpx')).size).toBe(5); expect(item().conflicts.map((c) => c.path)).toEqual(['output/old/mine.dpx'])
    expect(existsSync(loc('models/m.safetensors')) || existsSync(loc('input/a.png'))).toBe(false); expect(item().summary).toMatch(/^Pulled 1 file /)
  })
  it('above 5 GB the catch-up waits for approval', async () => {
    remote = [R('output/big/a.exr', 3e9), R('output/big/b.exr', 3e9)]; set(POD, { enabled: true, pull: true, approved_by: 'Lucas' })
    await until(() => item().state === 'needs_approval'); expect(item()).toMatchObject({ state: 'needs_approval', pending_bytes: 6e9 }); expect(execs).toHaveLength(0)
  })
  it('nothing to pull is a quiet "Already up to date" done and records no History entry', async () => {
    put('output/old/a.dpx', 100); remote = [R('output/old/a.dpx')]; set(POD, { enabled: true, pull: true, approved_by: 'Lucas' })
    await until(() => item().state === 'done'); expect(item().summary).toBe('Already up to date'); expect(execs).toHaveLength(0); expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'sync')).toHaveLength(0)
  })
  it('a pod being created has no outputs yet: enabling at creation is a quiet baseline, no pull, no failure', async () => {
    remote = [R('output/other-pods-work/a.dpx')]
    expect(store.applyFromConfig(POD, { enabled: true, pull: true, push: false, approved_by: 'Lucas' })).toBe(true)
    await new Promise((r) => setTimeout(r, 80)); expect(execs).toHaveLength(0); expect(item().state).toBe('idle'); expect(existsSync(loc('output/other-pods-work/a.dpx'))).toBe(false)
  })
  it('the baseline is taken BEFORE the listing, so a file that lands in between is not swallowed', async () => {
    const order: string[] = []
    autosync.setDeps({ tail: async () => { order.push('tail'); return 'k000' }, reconcile: async () => { order.push('baseline') }, files: async () => { order.push('list'); return [] } })
    set(POD, { enabled: true, pull: true, approved_by: 'Lucas' }); await until(() => order.includes('list')); expect(order).toEqual(['tail', 'baseline', 'list'])
  })
})

describe('no test can reach a real aws', () => {
  it('cannot reach a real aws or volume: the test runner is replaced for the whole suite', async () => { expect((await podpull.defaultAws(['s3', 'ls'], {})).stderr).toMatch(/not run in tests/) })
})
