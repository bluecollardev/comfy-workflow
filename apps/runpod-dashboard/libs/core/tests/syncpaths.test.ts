import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendFileSync } from 'node:fs'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as sync from '../src/sync.js'
import * as syncrun from '../src/syncrun.js'
import { registry } from '../src/syncruns.js'
import { fakeTree, scratch } from './helpers.js'

// ADR-046: the `paths` filter of a sync, and the streams (sync_parallel) it copies with. Fake exec, no pod, no network.
let dir: string, shared: string
beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared')
  for (const d of ['input', 'models', 'output', 'workflows']) mkdirSync(join(shared, d), { recursive: true })
  const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = shared; cfg.folders.project = fakeTree(dir); cfg.folders.plates = dir; mounts.save(cfg)
})
const pod = { id: 'p1', name: 'p', networkVolumeId: null, runtime: { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
const client = { apiKey: 'test', fetchFn: (async () => ({ status: 200, json: async () => ({ data: { pod } }) })) as unknown as typeof fetch }
const files = (n: number) => Array.from({ length: n }, (_, i) => `output/proxy_v004/frame_${String(i).padStart(4, '0')}.dpx`)

describe('validatePaths', () => {
  it('accepts files inside the ComfyUI-Shared folders, sorted and de-duplicated; drops OS litter', () => {
    expect(syncrun.validatePaths(['output/b.dpx', 'output/a.dpx', 'output/a.dpx', 'input/.DS_Store', 'models/x/._y'])).toEqual(['output/a.dpx', 'output/b.dpx'])
  })
  it('refuses anything that leaves the root', () => {
    for (const p of ['/etc/passwd', '../x', 'output/../../x', 'C:\\x', 'output\\a', 'output/', 'output', 'temp/rounds/a', '10_CORROSION/a/b', 'output//a', 'output/./a', 'a\nb', '']) expect(() => syncrun.validatePaths([p]), p).toThrow()
    expect(() => syncrun.validatePaths([])).toThrow(/list of files/); expect(() => syncrun.validatePaths('output/a')).toThrow(); expect(() => syncrun.validatePaths(['input/.DS_Store'])).toThrow(/never carries/)
  })
})

describe('commands', () => {
  it('rsync: --files-from with the list file, still additive (no --delete)', () => {
    const c = sync.rsyncPullCmd('root@1.2.3.4', 22, '/workspace/comfy-shared/output/', '/x/output/', { filesFrom: '/tmp/l.txt', existing: 'size', progress: '--progress' })
    expect(c).toContain('--files-from'); expect(c[c.indexOf('--files-from') + 1]).toBe('/tmp/l.txt'); expect(c).toContain('--size-only'); expect(c.join(' ')).not.toMatch(/--delete/)
    expect(sync.rsyncCmd('/a/', 'root@h', 22, '/w/', {})).not.toContain('--files-from')
  })
  it('S3: one aws s3 cp per key, each direction, no --recursive', () => {
    const v = { id: 'vol1', datacenter: 'EU-RO-1' }
    const pull = sync.s3FileCmd('pull', v, '/workspace/comfy-shared/output/', '/x/output/', 'p/a.dpx')
    expect(pull.slice(0, 3)).toEqual(['aws', 's3', 'cp']); expect(pull.slice(-2)).toEqual(['s3://vol1/comfy-shared/output/p/a.dpx', '/x/output/p/a.dpx']); expect(pull).not.toContain('--recursive')
    expect(sync.s3FileCmd('push', v, '/workspace/comfy-shared/', '/x/', 'input/a.png').slice(-2)).toEqual(['/x/input/a.png', 's3://vol1/comfy-shared/input/a.png'])
  })
})

describe('the plan of a paths sync', () => {
  it('a pull covers ComfyUI-Shared only: never the project tree or the plates; a push only comfy-shared', () => {
    const pull = syncrun.planFor({ pod_id: 'p1', direction: 'pull', paths: files(3) })
    expect(pull.map((s) => s.key)).toEqual(['output']); expect(pull[0].local).toBe(`${shared}/output/`)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push', paths: ['input/a.png'], plates: true, approved_by: 'x' }).map((s) => s.key)).toEqual(['comfy-shared'])
    expect(syncrun.stepPaths({ pod_id: 'p1', direction: 'pull', paths: ['output/a/b.dpx', 'input/c.png'] }, pull[0])).toEqual(['a/b.dpx'])
  })
  it('a path in a folder the pod does not pull has nowhere to go', async () => {
    await expect(syncrun.run({ pod_id: 'p1', direction: 'pull', paths: ['input/a.png'] }, () => {}, new AbortController().signal, client, async () => 0)).rejects.toThrow(/Nothing to copy/)
  })
})

describe('parallelFor: the streams', () => {
  it('the pod\'s own configuration, else the Default Configuration, else 8; clamped 1..32', () => {
    expect(syncrun.parallelFor('p1')).toBe(8)
    const cfg = mounts.load(); cfg.sync_parallel = 5; mounts.save(cfg); expect(syncrun.parallelFor('p1')).toBe(5)
    podconfigs.set('p1', { ...cfg, sync_parallel: 3 }); expect(syncrun.parallelFor('p1')).toBe(3); expect(syncrun.parallelFor('other')).toBe(5)
    podconfigs.set('p1', { ...cfg, sync_parallel: undefined as never }); expect(syncrun.parallelFor('p1')).toBe(5)   // a pod without a value follows the default
    mounts.save({ ...cfg, sync_parallel: undefined as never }); podconfigs.forget('p1'); expect(syncrun.parallelFor('p1')).toBe(8)   // no value anywhere: 8
    mounts.save({ ...cfg, sync_parallel: 5 }); podconfigs.set('p1', { ...cfg, sync_parallel: 99 }); expect(syncrun.parallelFor('p1')).toBe(32); podconfigs.set('p1', { ...cfg, sync_parallel: 0 }); expect(syncrun.parallelFor('p1')).toBe(5)
  })
  it('chunksOf splits into at most n contiguous chunks', () => { expect(syncrun.chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2, 3], [4, 5]]); expect(syncrun.chunksOf([1, 2], 8)).toEqual([[1], [2]]); expect(syncrun.chunksOf([], 3)).toEqual([]) })
})

/** A fake rsync that waits a little, reads its --files-from list, and prints what it "copies". */
function fakeExec(opts: { fail?: (list: string[]) => boolean } = {}) {
  const lists: string[][] = []; let inFlight = 0, peak = 0
  const exec: syncrun.Exec = async (cmd, onLine) => {
    if (cmd.includes('-n')) { for (const l of ['Number of files transferred: 20', 'Total transferred file size: 2000 B']) onLine(l); return 0 }
    const list = readFileSync(cmd[cmd.indexOf('--files-from') + 1], 'utf8').split('\n').filter(Boolean)
    lists.push(list); inFlight++; peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 15))
    let bytes = 0
    for (const f of list) { onLine(f); bytes += 100; onLine(`       ${100} 100%   1.00MB/s   00:00:00 (xfer#1, to-check=0/1)`) }
    inFlight--
    return opts.fail?.(list) ? 23 + 100 : 0
  }
  return { exec, lists, peak: () => peak }
}
const rel = (ps: string[]) => ps.map((p) => p.replace(/^output\//, ''))

describe('over SSH: split into up to sync_parallel streams', () => {
  it('20 files with sync_parallel 4: exactly the files asked for, four rsyncs at once, never more', async () => {
    const cfg = mounts.load(); cfg.sync_parallel = 4; mounts.save(cfg)
    const f = fakeExec(), ev: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(20) }, (e) => ev.push(e), new AbortController().signal, client, f.exec)
    expect(r).toMatchObject({ failed: 0, cancelled: false }); expect(f.lists).toHaveLength(4); expect(f.peak()).toBe(4)
    expect(f.lists.flat().sort()).toEqual(rel(files(20))); expect(new Set(f.lists.flat()).size).toBe(20)   // each file once
    expect(ev.find((e) => e.kind === 'step')?.streams).toBe(4)
  })
  it('a pod\'s own sync_parallel overrides the default; fewer files than streams make fewer streams', async () => {
    const cfg = mounts.load(); cfg.sync_parallel = 8; podconfigs.set('p1', { ...cfg, sync_parallel: 2 }); mounts.save(cfg)
    const f = fakeExec(); await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(20) }, () => {}, new AbortController().signal, client, f.exec)
    expect(f.peak()).toBe(2); expect(f.lists).toHaveLength(2)
    podconfigs.forget('p1'); const g = fakeExec(); await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(3) }, () => {}, new AbortController().signal, client, g.exec)
    expect(g.lists).toHaveLength(3); expect(g.peak()).toBe(3)
  })
  it('a missing value falls back to 8', async () => {
    const cfg = mounts.load(); mounts.save({ ...cfg, sync_parallel: undefined as never }); mounts.save(mounts.load())   // normalize puts the default back
    const f = fakeExec(); await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(24) }, () => {}, new AbortController().signal, client, f.exec)
    expect(f.peak()).toBe(8)
  })
  it('one failing stream does not stop the others', async () => {
    const cfg = mounts.load(); cfg.sync_parallel = 4; mounts.save(cfg)
    const f = fakeExec({ fail: (l) => l.some((x) => x.endsWith('frame_0000.dpx')) }), ev: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(20) }, (e) => ev.push(e), new AbortController().signal, client, f.exec)
    expect(f.lists).toHaveLength(4); expect(f.lists.flat()).toHaveLength(20); expect(r.failed).toBe(1)
  })
  it('the aggregated progress only goes up', async () => {
    const cfg = mounts.load(); cfg.sync_parallel = 4; mounts.save(cfg)
    const f = fakeExec(), ev: syncrun.SyncEvent[] = []
    await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(20) }, (e) => ev.push(e), new AbortController().signal, client, f.exec)
    const bytes = ev.filter((e) => e.kind === 'progress').map((e) => e.run_bytes_done ?? 0)
    expect(bytes.length).toBeGreaterThan(0); expect(bytes.every((b, i) => i === 0 || b >= bytes[i - 1])).toBe(true); expect(bytes.at(-1)).toBe(2000)
  })
})

describe('the History entry of an automatic run', () => {
  const jobs = () => history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'sync')
  beforeEach(() => { process.env.HISTORY_FILE = join(dir, 'history.jsonl') })
  it('ONE entry per run (not per file), with the trigger and the counts, the streams used and the first paths', async () => {
    const cfg = mounts.load(); cfg.sync_parallel = 4; mounts.save(cfg)
    const sizes = Object.fromEntries(files(20).map((p) => [p, 100]))
    await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(20), path_sizes: sizes, trigger: 'auto-sync:output', note: '1 conflict skipped (output/x.dpx)' }, () => {}, new AbortController().signal, client, fakeExec().exec)
    expect(jobs()).toHaveLength(1)
    expect(jobs()[0]).toMatchObject({ kind: 'job', job: 'sync', state: 'done', trigger: 'auto-sync:output', pod_id: 'p1', files: 20, bytes: 2000, what: 'auto sync pull p1' })
    const d = (jobs()[0] as { detail: string }).detail
    expect(d).toMatch(/^automatic, output: 20 files/); expect(d).toMatch(/4 streams/); expect(d).toContain('output/proxy_v004/frame_0000.dpx'); expect(d).toMatch(/\(\+17 more\)/); expect(d).toMatch(/1 conflict skipped/)
  })
  it('an automatic run that moved nothing records nothing; a failed one is recorded', async () => {
    await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(3), trigger: 'auto-sync:feed' }, () => {}, new AbortController().signal, client, async (cmd, onLine) => { if (cmd.includes('-n')) onLine('Number of files transferred: 0'); return 0 })
    expect(jobs()).toHaveLength(0)
    await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(3), trigger: 'auto-sync:feed' }, () => {}, new AbortController().signal, client, async () => 255)
    expect(jobs()).toHaveLength(1); expect(jobs()[0]).toMatchObject({ state: 'failed', trigger: 'auto-sync:feed' })
  })
  it('a person\'s Sync has no trigger and keeps its old shape; an old entry in the file still reads', async () => {
    appendFileSync(process.env.HISTORY_FILE!, JSON.stringify({ ts: '2026-11-01T10:00:00.000Z', kind: 'job', job: 'sync', state: 'done', what: 'sync p9', pod_id: 'p9' }) + '\n')
    await syncrun.run({ pod_id: 'p1', direction: 'pull', paths: files(2) }, () => {}, new AbortController().signal, client, fakeExec().exec)
    const all = jobs(); expect(all).toHaveLength(2)
    expect(all.find((e) => (e as { pod_id?: string }).pod_id === 'p9')).toEqual({ ts: '2026-11-01T10:00:00.000Z', kind: 'job', job: 'sync', state: 'done', what: 'sync p9', pod_id: 'p9' })
    const mine = all.find((e) => (e as { pod_id?: string }).pod_id === 'p1') as Record<string, unknown>; expect(mine.what).toBe('sync p1'); expect('trigger' in mine).toBe(false)
  })
})

describe('the registry sees every run (manual and automatic)', () => {
  it('both are in active() while they run and in recent() after, with their trigger, and the run\'s own events and History entry are unchanged', async () => {
    process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.SYNC_LOGS_DIR = join(dir, 'logs'); process.env.SYNC_RUNS_FILE = join(dir, 'runs.json')
    const known = new Set(registry.recent(undefined, 200).map((r) => r.run_id)); registry.reset()
    let release!: () => void; const gate = new Promise<void>((r) => { release = r })
    const slow: syncrun.Exec = async (cmd, onLine) => { if (cmd.includes('-n')) return 0; await gate; onLine('output/a.dpx'); return 0 }
    const ev: syncrun.SyncEvent[] = []
    const auto = syncrun.run({ pod_id: 'p1', direction: 'pull', paths: ['output/a.dpx'], trigger: 'auto-sync:feed' }, () => {}, new AbortController().signal, client, slow)
    const manual = syncrun.run({ pod_id: 'p1', direction: 'pull', paths: ['output/a.dpx'] }, (e) => ev.push(e), new AbortController().signal, client, slow)
    await new Promise((r) => setTimeout(r, 20))
    const act = registry.active().items.filter((i) => i.pod_id === 'p1'); expect(act.map((i) => i.trigger).sort()).toEqual(['auto-sync:feed', 'manual'])
    release(); await Promise.all([auto, manual]); await registry.settled()
    const rec = registry.recent('p1').filter((r) => !known.has(r.run_id)); expect(rec.map((r) => r.trigger).sort()).toEqual(['auto-sync:feed', 'manual']); expect(rec.every((r) => r.state === 'done')).toBe(true)
    expect(ev.some((e) => e.kind === 'plan') && ev.some((e) => e.kind === 'done')).toBe(true)
    expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'sync')).toHaveLength(2)
    const lines = (await registry.log(rec[0].run_id)).lines.map((l) => l.text); expect(lines.some((l) => /^Plan:/.test(l))).toBe(true)
    delete process.env.SYNC_LOGS_DIR; delete process.env.SYNC_RUNS_FILE
  })
})
