import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as sync from '../src/sync.js'
import * as syncrun from '../src/syncrun.js'
import { registry } from '../src/syncruns.js'
import * as autosync from '../src/autosync.js'
import { CoreError } from '../src/errors.js'
import { fakeTree, scratch } from './helpers.js'

// docs/ADR-011, amendment "Push order, preflight and a full volume" (2026-11-18): the incident was a push of a 2.1 TB project tree to a 1,000 GB volume. Fakes only: no rsync, ssh, aws or RunPod.
const GB = 1e9, TB = 1e12
let dir: string, shared: string, volumeGb: number, copies: string[][], started: string[][], dfLines: string[] | 'fail', sizes: Record<string, number>, full: { line: string; after: number } | null
const pod = { id: 'p1', name: 'p', networkVolumeId: 'vol1', runtime: { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
const client = { apiKey: 'test', fetchFn: (async (url: string) => (String(url).includes('graphql') ? { ok: true, status: 200, json: async () => ({ data: { pod } }) } : { ok: true, status: 200, json: async () => ({ id: 'vol1', name: 'v', size: volumeGb, dataCenterId: 'EU-RO-1' }) })) as unknown as typeof fetch }
const remoteOf = (cmd: string[]) => cmd[cmd.length - 1]
const stepOf = (cmd: string[]) => /\/workspace\/(project|plates|comfy-shared)\/?$/.exec(remoteOf(cmd).replace(/^.*?:/, ''))?.[1] ?? (remoteOf(cmd).includes('workflows') ? 'workflows' : '?')
/** A fake rsync/ssh: the listing pass reports `sizes` per step, `df` answers dfLines, a copy is recorded (and can hit a full volume). */
const exec: syncrun.Exec = async (cmd, onLine, signal) => {
  if (cmd[0] === 'ssh') { if (dfLines === 'fail') return 255; for (const l of dfLines) onLine(l); return 0 }
  if (cmd.includes('-n')) { const step = stepOf(cmd), b = sizes[step] ?? 100; onLine(`Number of files transferred: ${b > 1000 ? 15134 : 2}`); onLine(`Total transferred file size: ${b} B`); return 0 }
  copies.push(cmd); started.push(cmd)
  if (full && copies.length === 1) { await new Promise((r) => setTimeout(r, 15)); onLine(`rsync: [receiver] write failed on "/workspace/x/a.dpx": ${full.line} (122)`); return 11 }
  if (full) { await new Promise<void>((r) => { const t = setTimeout(r, 400); signal.addEventListener('abort', () => { clearTimeout(t); r() }, { once: true }) }); return signal.aborted ? 255 : 0 }
  onLine('a.png')
  return 0
}
const df = (freeGb: number) => ['Filesystem 1024-blocks Used Available Capacity Mounted on', `/dev/x ${1_000_000_000} 1 ${Math.round(freeGb * GB / 1024)} 10% /workspace`]
const push = (o: Partial<syncrun.SyncRequest> = {}, events: syncrun.SyncEvent[] = []) => syncrun.run({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc', ...o }, (e) => events.push(e), new AbortController().signal, client, exec)

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); process.env.HISTORY_FILE = join(dir, 'h.jsonl'); process.env.SYNC_LOGS_DIR = join(dir, 'logs'); process.env.SYNC_RUNS_FILE = join(dir, 'runs.json')
  for (const d of ['input', 'models', 'output', 'workflows']) { mkdirSync(join(shared, d), { recursive: true }); writeFileSync(join(shared, d, 'a.txt'), d) }
  const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.folders.plates = dir; cfg.folders['comfy-shared'] = shared; cfg.network_volume_id = 'vol1'; cfg.sync_parallel = 3; mounts.save(cfg)
  copies = []; started = []; dfLines = df(900); sizes = {}; volumeGb = 1000; full = null; delete process.env.COMFY_APP_WORKFLOWS_DIR
})
afterEach(() => { delete process.env.COMFY_APP_WORKFLOWS_DIR; delete process.env.SYNC_LOGS_DIR; delete process.env.SYNC_RUNS_FILE })
const stepKeys = (ev: syncrun.SyncEvent[]) => ev.filter((e) => e.kind === 'step').map((e) => e.key)

describe('the order of a push: the small and important first', () => {
  it('runs workflows, comfy-shared, project, plates; the plan event keeps the panel\'s order; a failure at the end never costs the graphs', async () => {
    const ev: syncrun.SyncEvent[] = []; await push({}, ev)
    expect(stepKeys(ev)).toEqual(['workflows', 'comfy-shared', 'project', 'plates']); expect(ev.find((e) => e.kind === 'plan')!.steps!.map((s) => s.key)).toEqual(['project', 'plates', 'comfy-shared', 'workflows'])
    expect(sync.orderForRun([{ key: 'plates' }, { key: 'project' }, { key: 'x' }, { key: 'comfy-shared' }, { key: 'workflows' }]).map((s) => s.key)).toEqual(['workflows', 'comfy-shared', 'project', 'plates', 'x'])
  })
})

describe('where the graphs come from', () => {
  it('the repo folder when it exists; else the mapped ComfyUI-Shared/workflows (and the comfy-shared step then leaves workflows/ out: once, not twice); else the step is skipped with a plain warning and the run goes on', async () => {
    let ev: syncrun.SyncEvent[] = []; await push({}, ev); expect(ev.find((e) => e.kind === 'step' && e.key === 'workflows')!.local).toBe(sync.WORKFLOWS_DIR + '/')
    process.env.COMFY_APP_WORKFLOWS_DIR = join(dir, 'nowhere'); ev = []; copies = []; await push({}, ev)
    const w = ev.find((e) => e.kind === 'step' && e.key === 'workflows')!; expect(w.local).toBe(join(shared, 'workflows') + '/'); expect(w.remote).toBe('/workspace/comfy-shared/workflows/')
    const cs = copies.filter((c) => remoteOf(c).includes('comfy-shared')); expect(cs.some((c) => c.includes('/workflows/'))).toBe(true)   // the comfy-shared copy excludes the folder the graphs step carried
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push' }, { key: 'comfy-shared', local: '', remote: '' }, true)).toContain('/workflows/'); expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', shared: ['input', 'models', 'workflows'] }, { key: 'comfy-shared', local: '', remote: '' }, false)).not.toContain('/workflows/')
    mkdirSync(join(dir, 'empty-shared'), { recursive: true }); const cfg = mounts.load(); cfg.folders['comfy-shared'] = join(dir, 'empty-shared'); mounts.save(cfg); ev = []
    const r = await push({}, ev); expect(r.failed).toBe(0); expect(stepKeys(ev)).not.toContain('workflows')
    expect(ev.find((e) => e.kind === 'warning' && e.key === 'workflows')).toMatchObject({ code: 'skipped', text: 'No local workflows folder: the graphs step was skipped', reason: 'No local workflows folder: the graphs step was skipped' })
  })
  it('a missing local folder of ANY step is a warning, never a failed run', async () => {
    const cfg = mounts.load(); cfg.folders.project = join(dir, 'gone'); mounts.save(cfg); const ev: syncrun.SyncEvent[] = []; const r = await push({}, ev)
    expect(r).toMatchObject({ failed: 0, cancelled: false }); expect(stepKeys(ev)).toEqual(['workflows', 'comfy-shared', 'plates'])
    expect(ev.find((e) => e.kind === 'warning' && e.key === 'project')).toMatchObject({ code: 'skipped', reason: `${join(dir, 'gone')}/ does not exist on this PC`, text: `Skipped project: ${join(dir, 'gone')}/ does not exist on this PC` })
    expect(registry.recent('p1')[0].state).toBe('done'); expect((await registry.log(registry.recent('p1')[0].run_id)).lines.some((l) => l.level === 'warn' && /Skipped project/.test(l.text))).toBe(true)
  })
})

describe('the preflight: nothing is copied to a volume that cannot hold it', () => {
  it('refuses a 2.1 TB push to a 1,000 GB volume with the sizes per step, copies NOTHING, and the totals event says so', async () => {
    sizes = { project: 2.1 * TB, 'comfy-shared': 12 * GB, workflows: 1e6, plates: 50 * GB }; dfLines = df(348)
    const ev: syncrun.SyncEvent[] = []; const e = await push({}, ev).catch((x) => x as CoreError)
    expect(e).toBeInstanceOf(CoreError); expect(e.status).toBe(400); expect(e.code).toBe('over_capacity')
    expect(e.message).toMatch(/^This push would send 2\.2 TB; the volume is 1,000 GB \(about 348 GB free\)\. Nothing was copied\. By step: workflows 1 MB, comfy-shared 12 GB, project 2\.1 TB, plates 50 GB\. Push only the graphs \(untick the project\), or enlarge the volume\.$/)
    expect(copies).toEqual([]); expect(started).toEqual([])   // the fake was never asked to copy
    expect(ev.find((x) => x.kind === 'totals')).toMatchObject({ capacity_bytes: 1000 * GB, free_bytes: 348 * GB, over_capacity: true }); expect(ev.find((x) => x.kind === 'error')).toMatchObject({ code: 'over_capacity', text: e.message })
    expect(ev.some((x) => x.kind === 'step' || x.kind === 'file')).toBe(false)
    const h = history.list({ kind: 'job' }).find((x) => x.kind === 'job' && x.job === 'sync')!; expect(h).toMatchObject({ state: 'failed' }); expect((h as { error: string }).error).toMatch(/Nothing was copied/)
  })
  it('passes when it fits; uses the real free space when ssh answers and the volume size when it does not', async () => {
    sizes = { project: 100 * GB, 'comfy-shared': 12 * GB }; dfLines = df(500); let ev: syncrun.SyncEvent[] = []; await push({}, ev)
    expect(ev.find((x) => x.kind === 'totals')).toMatchObject({ capacity_bytes: 1000 * GB, free_bytes: 500 * GB, over_capacity: false }); expect(copies.length).toBeGreaterThan(0)
    dfLines = df(50); copies = []; await expect(push()).rejects.toThrow(/about 50 GB free/); expect(copies).toEqual([])   // the volume is 1,000 GB but only 50 are free: refused although it is "smaller than the volume"
    dfLines = 'fail'; ev = []; await push({}, ev); expect(ev.find((x) => x.kind === 'totals')).toMatchObject({ capacity_bytes: 1000 * GB, free_bytes: null, over_capacity: false })
    sizes = { project: 1.5 * TB }; copies = []; await expect(push()).rejects.toThrow(/the volume is 1,000 GB\. Nothing was copied/)   // free unknown: compared with the capacity
  })
  it('a push that fits but leaves under 5% free carries a warning event', async () => {
    sizes = { project: 70 * GB }; dfLines = df(100); const ev: syncrun.SyncEvent[] = []; await push({}, ev)
    expect(ev.find((x) => x.kind === 'warning' && /under 5%/.test(x.text ?? ''))).toBeTruthy(); expect(copies.length).toBeGreaterThan(0)
  })
  it('count() carries capacity_bytes, free_bytes and over_capacity on all AND without_renders, each worked out for its own count; a failing lookup gives null and false', async () => {
    dfLines = df(300); sizes = { project: 400 * GB }
    const countExec: syncrun.Exec = async (cmd, onLine, signal, env) => { if (cmd[0] === 'ssh') return exec(cmd, onLine, signal, env); if (cmd.includes('-n')) { const skip = cmd.includes('06_REVIEW/'); onLine('Number of files transferred: 5'); onLine(`Total transferred file size: ${cmd.includes('--ignore-times') ? 9 : remoteOf(cmd).includes('project') ? (skip ? 200 : 400) * GB : 1000} B`) } return 0 }
    const c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', skip_renders: true }, client, countExec)
    expect(c.all).toMatchObject({ capacity_bytes: 1000 * GB, free_bytes: 300 * GB, over_capacity: true }); expect(c.without_renders).toMatchObject({ capacity_bytes: 1000 * GB, free_bytes: 300 * GB, over_capacity: false })
    dfLines = 'fail'; const d = await syncrun.countFor({ pod_id: 'p1', direction: 'push', skip_renders: true }, client, async (cmd, onLine, s, e) => (cmd[0] === 'ssh' ? 255 : countExec(cmd, onLine, s, e))); expect(d.all.free_bytes).toBeNull(); expect(typeof d.all.over_capacity).toBe('boolean')
    const failing = { ...client, fetchFn: (async (u: string) => { if (!String(u).includes('graphql')) throw new Error('RunPod is down'); return { ok: true, status: 200, json: async () => ({ data: { pod } }) } }) as unknown as typeof fetch }
    const f = await syncrun.countFor({ pod_id: 'p1', direction: 'push' }, failing, async (cmd, onLine) => { if (cmd[0] === 'ssh') return 255; onLine('Number of files transferred: 1'); onLine('Total transferred file size: 5 B'); return 0 }); expect(f.all).toMatchObject({ capacity_bytes: null, free_bytes: null, over_capacity: false })
    expect(await syncrun.countFor({ pod_id: 'p1', direction: 'pull' }, client, countExec)).toMatchObject({ all: { over_capacity: false, capacity_bytes: null } })
  })
})

describe('a full volume or disk stops everything', () => {
  it('"Disk quota exceeded" aborts all remaining streams at once, nothing after it starts, the message names what was not done, code volume_full, History and the run log say so', async () => {
    full = { line: 'Disk quota exceeded', after: 1 }; sizes = {}
    const ev: syncrun.SyncEvent[] = []; const t0 = Date.now(); const r = await push({}, ev)
    expect(Date.now() - t0).toBeLessThan(1500)   // the other streams were killed, not waited for
    const startedAtLine = copies.length
    await new Promise((x) => setTimeout(x, 60)); expect(copies.length).toBe(startedAtLine)   // peak of streams started after the line is zero
    expect(r.code).toBe('volume_full'); expect(r.failed).toBeGreaterThan(0); expect(r.cancelled).toBe(false)
    expect(r.message).toMatch(/^The volume is full \(Disk quota exceeded\)\. \d+ files? (was|were) written\. Not done: .*project.*plates.*\. Free space or enlarge the volume, then run again\.$/)
    expect(ev.find((x) => x.kind === 'error' && x.code === 'volume_full')).toMatchObject({ text: r.message, code: 'volume_full', not_done: expect.arrayContaining(['project', 'plates']) }); expect(ev.some((x) => x.kind === 'step' && x.key === 'plates')).toBe(false)
    expect(ev.at(-1)).toMatchObject({ kind: 'done', text: r.message })
    const h = history.list({ kind: 'job' }).find((x) => x.kind === 'job' && x.job === 'sync')!; expect(h).toMatchObject({ state: 'failed' }); expect((h as { error: string }).error).toBe(r.message); expect(typeof (h as { files?: number }).files).toBe('number')
    const lines = (await registry.log(registry.recent('p1')[0].run_id)).lines; expect(lines.some((l) => l.level === 'error' && l.text === r.message)).toBe(true)
  })
  it('the other messages of a full disk count too: No space left on device, ENOSPC', async () => {
    for (const line of ['No space left on device', 'ENOSPC: no space']) { full = { line, after: 1 }; copies = []; started = []; const r = await push(); expect(r.code).toBe('volume_full'); expect(r.message).toContain(`(${line.split(':')[0] === 'ENOSPC' ? 'ENOSPC' : line})`) }
    expect(syncrun.FULL_RE.test('write failed: Disk quota exceeded')).toBe(true); expect(syncrun.FULL_RE.test('Permission denied')).toBe(false)
  })
  it('on a pull, a full local disk is code disk_full with this PC\'s words', async () => {
    const ev: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: ['output/a.dpx'] }, (e) => ev.push(e), new AbortController().signal, client, async (cmd, onLine) => { if (cmd.includes('-n')) { onLine('Number of files transferred: 1'); onLine('Total transferred file size: 5 B'); return 0 } onLine('rsync: [receiver] write failed on "a.dpx": No space left on device (28)'); return 11 })
    expect(r.code).toBe('disk_full'); expect(r.message).toMatch(/^The disk on this PC is full \(No space left on device\)\. 0 files were written\. Not done: output\. Free space on this PC, then run again\.$/); expect(ev.find((x) => x.kind === 'error')).toMatchObject({ code: 'disk_full', not_done: ['output'] })
  })
  it('an Auto sync pull that fills this PC\'s disk is an error item with that text', async () => {
    const shared2 = join(dir, 'auto'); mkdirSync(join(shared2, 'output'), { recursive: true }); const cfg = mounts.load(); cfg.folders['comfy-shared'] = shared2; mounts.save(cfg)
    process.env.AUTOSYNC_FILE = join(dir, 'a.json'); process.env.AUTOSYNC_STATE_FILE = join(dir, 's.json'); process.env.AUTOSYNC_MANIFEST_FILE = join(dir, 'm.json'); autosync.reset()
    const { set } = await import('../src/autosyncstore.js'); set('p1', { enabled: true, pull: true, approved_by: 'L' })
    autosync.setDeps({ now: () => Date.now(), volumeOf: async () => 'vol1', tail: async () => 'k0', reconcile: async () => undefined, podName: () => 'p', listPods: async () => [{ id: 'p1', name: 'p' }], localRoot: () => shared2, parallel: () => 2,
      feed: async (_v, since) => ({ volume_id: 'vol1', cursor: 'k1', events: since === 'k0' ? [{ seq: 'k1', ts: '', writer: 'x', op: 'created', paths: ['output/a.dpx'] } as never] : [], more: false }), files: async () => [{ path: 'output/a.dpx', bytes: 5, modified: '2026-01-01T00:00:00' }],
      run: async () => ({ steps: 1, failed: 1, warned: 0, cancelled: false, code: 'disk_full', message: 'The disk on this PC is full (No space left on device). 0 files were written. Not done: output. Free space on this PC, then run again.' }) })
    await autosync.tick(); await autosync.settle(); const it = autosync.status().items[0]
    expect(it.state).toBe('error'); expect(it.error).toContain('The disk on this PC is full (No space left on device)'); autosync.reset(); for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE']) delete process.env[k]
  })
})
