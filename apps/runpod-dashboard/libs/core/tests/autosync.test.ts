import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSync, existsSync, mkdirSync, openSync, ftruncateSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as autosync from '../src/autosync.js'
import * as push from '../src/autosyncpush.js'
import * as store from '../src/autosyncstore.js'
import { CoreError } from '../src/errors.js'
import * as history from '../src/history.js'
import type * as journal from '../src/journal.js'
import * as mounts from '../src/mounts.js'
import * as outputruns from '../src/outputruns.js'
import type * as syncrun from '../src/syncrun.js'
import { scratch } from './helpers.js'

// ADR-046: Auto sync's settings, controller, output trigger and push collector, all with fakes: no pod, no S3, no network, no disk but the scratch folder.
const VOL = 'volx1', POD = 'pod1'
let dir: string, shared: string, t: number
let events: { key: string; ev: journal.JournalEvent }[], remote: autosync.Remote[], runs: syncrun.SyncRequest[]
let feedFail: (() => Error) | null
let gate: Promise<void> | null, failPaths: Set<string>, runError: string | null, cancelled: boolean
const T0 = Date.parse('2026-11-18T10:00:00Z')

const addEvent = (e: Partial<journal.JournalEvent>) => { const key = `k${String(events.length + 1).padStart(3, '0')}`; events.push({ key, ev: { seq: key, ts: new Date(t).toISOString(), writer: 'reconciler', op: 'created', ...e } as journal.JournalEvent }) }
const R = (path: string, bytes = 100, modified = 'm1'): autosync.Remote => ({ path, bytes, modified })
const local = (p: string) => join(shared, p)
const writeLocal = (p: string, size: number, mtimeSec?: number) => { mkdirSync(dirname(local(p)), { recursive: true }); { const fd = openSync(local(p), 'w'); ftruncateSync(fd, size); closeSync(fd) }; if (mtimeSec) utimesSync(local(p), mtimeSec, mtimeSec) }
const enable = (o: Partial<store.Settings> = {}) => store.set(POD, { enabled: true, pull: true, approved_by: 'Lucas', ...o })
const item = () => autosync.status().items.find((i) => i.pod_id === POD)!
const runAll = async () => { await autosync.tick(); await autosync.settle() }

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true })
  for (const [k, f] of [['AUTOSYNC_FILE', 'autosync.json'], ['AUTOSYNC_STATE_FILE', 'autosync-state.json'], ['AUTOSYNC_MANIFEST_FILE', 'autosync-manifest.json'], ['HISTORY_FILE', 'history.jsonl'], ['POD_NAMES_FILE', 'pod-names.json']]) process.env[k] = join(dir, f)
  const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = shared; cfg.network_volume_id = VOL; mounts.save(cfg)
  t = T0; feedFail = null; events = []; remote = []; runs = []; gate = null; failPaths = new Set(); runError = null; cancelled = false
  autosync.reset()
  autosync.setDeps({
    now: () => t, volumeOf: async () => VOL, tail: async () => 'k000', reconcile: async () => undefined, parallel: () => 4, podName: () => 'CanalV2-lores',
    feed: async (_v, since) => { if (feedFail) throw feedFail(); const evs = events.filter((e) => e.key > since); return { volume_id: VOL, cursor: evs.length ? evs[evs.length - 1].key : since, events: evs.map((e) => e.ev), more: false } },
    files: async (_v, entries) => remote.filter((r) => entries.some((e) => e.paths?.includes(r.path) || (e.prefix && r.path.startsWith(e.prefix)))),
    localRoot: () => shared,
    run: async (req, send) => {
      runs.push(req)
      send({ kind: 'line', text: 'Copying over SSH into the running pod' }); send({ kind: 'step', key: 'output', streams: 2 })
      if (gate) await gate
      if (runError) throw new Error(runError)
      let bytes = 0
      for (const p of req.paths!) {
        send({ kind: 'file', path: p.split('/').slice(1).join('/') }); bytes += req.path_sizes![p]
        send({ kind: 'progress', run_bytes_done: bytes, rate_bps: 1000 })
        if (!failPaths.has(p)) writeLocal(p, req.path_sizes![p])
      }
      return { steps: 1, failed: 0, warned: 0, cancelled }
    },
  })
})
afterEach(() => { autosync.reset(); for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE', 'POD_NAMES_FILE']) delete process.env[k] })

describe('settings (the named yes)', () => {
  it('defaults when never set: off, Pull on, Push off', () => { expect(autosync.get(POD)).toEqual({ enabled: false, pull: true, push: false, approved_by: '' }) })
  it('turning it on needs the name of who says yes (400); the name and the time are recorded with a History entry; off needs nothing', () => {
    for (const bad of [{ enabled: true }, { enabled: true, approved_by: '   ' }]) { const e = (() => { try { store.set(POD, bad) } catch (x) { return x as CoreError } })(); expect(e).toBeInstanceOf(CoreError); expect(e!.status).toBe(400); expect(e!.message).toBe('Auto sync needs the name of who says yes') }
    expect(autosync.get(POD).enabled).toBe(false)
    const s = store.set(POD, { enabled: true, pull: true, push: false, approved_by: ' Lucas ' }, () => new Date(T0))
    expect(s).toEqual({ enabled: true, pull: true, push: false, approved_by: 'Lucas', approved_at: '2026-11-18T10:00:00.000Z' }); expect(autosync.get(POD)).toEqual(s)
    const h = history.list({ kind: 'change' }).find((e) => e.kind === 'change' && e.action === 'auto sync on')!
    expect(h).toMatchObject({ area: 'pod', approved_by: 'Lucas' })
    expect(store.set(POD, { enabled: false }).enabled).toBe(false); expect(history.list({ kind: 'change' }).some((e) => e.kind === 'change' && e.action === 'auto sync off')).toBe(true)
    expect(() => store.set(POD, { enabled: 'yes' as never })).toThrow(/true or false/)
  })
  it('a corrupt file starts empty; a deleted pod is forgotten; Recreate carries it', async () => {
    writeFileSync(process.env.AUTOSYNC_FILE!, '{oops'); expect(autosync.get(POD).enabled).toBe(false)
    enable(); store.carry(POD, 'pod2'); expect(autosync.get('pod2')).toMatchObject({ enabled: true, approved_by: 'Lucas' })
    store.forget(POD); expect(autosync.get(POD).enabled).toBe(false); expect(autosync.get('pod2').enabled).toBe(true)
  })
})

describe('the controller state machine', () => {
  it('idle -> syncing -> done (the files land) -> idle after 10 s with the summary kept -> dismiss', async () => {
    enable(); expect(item().state).toBe('idle')
    addEvent({ prefix: 'output/proxy_v004/' }); remote = [R('output/proxy_v004/a.dpx', 600_000_000), R('output/proxy_v004/b.dpx', 600_000_000)]
    let release!: () => void; gate = new Promise((r) => { release = r })
    await autosync.tick()
    expect(item()).toMatchObject({ state: 'syncing', direction: 'pull', files_total: 2, bytes_total: 1_200_000_000, pod_name: 'CanalV2-lores', streams: 2 })
    release(); await autosync.settle()
    expect(item()).toMatchObject({ state: 'done', files_done: 2, files_total: 2, bytes_done: 1_200_000_000, summary: 'Pulled 2 files (1.2 GB) to output/', error: '', conflicts: [] })
    expect(runs).toHaveLength(1); expect(runs[0]).toMatchObject({ pod_id: POD, direction: 'pull', paths: ['output/proxy_v004/a.dpx', 'output/proxy_v004/b.dpx'], existing: 'size' })
    expect(existsSync(local('output/proxy_v004/a.dpx'))).toBe(true)
    t += 5000; expect(item().state).toBe('done'); t += 6000; expect(item().state).toBe('idle'); expect(item().summary).toMatch(/Pulled 2 files/)
    await runAll(); expect(runs).toHaveLength(1)   // the cursor moved: nothing is pulled twice
  })
  it('an error stays until dismissed (or a later success) and names the failing file; the retry waits', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx'), R('output/r/b.dpx')]; failPaths = new Set(['output/r/b.dpx'])
    await runAll()
    expect(item()).toMatchObject({ state: 'error', current: 'output/r/b.dpx' }); expect(item().error).toMatch(/1 file of 2 did not arrive/)
    t += 60_000; await runAll(); expect(runs).toHaveLength(1); expect(item().state).toBe('error')   // not hammered: five minutes
    t += 20 * 60_000; expect(item().state).toBe('error')   // errors do not expire
    failPaths.clear(); await runAll(); expect(runs).toHaveLength(2); expect(item()).toMatchObject({ state: 'done', error: '' })   // a later success clears it
    runError = 'ssh: connection refused'; addEvent({ prefix: 'output/s/' }); remote.push(R('output/s/c.dpx')); await runAll()
    expect(item()).toMatchObject({ state: 'error' }); expect(item().error).toMatch(/connection refused/)
    autosync.dismiss(POD); expect(item().state).toBe('idle'); expect(item().error).toBe('')
  })
  it('a transport that throws, or a stalled pull, ends as an error item and never holds the controller', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]; runError = 'The pod is off and has no network volume'
    await runAll(); expect(item().state).toBe('error'); expect(autosync.status().paused).toBe(false)
  })
  it('over the size gate it waits for approve(true); approve(false) skips and drops it', async () => {
    enable(); addEvent({ prefix: 'output/big/' }); remote = [R('output/big/a.exr', 3e9), R('output/big/b.exr', 3e9)]
    await runAll()
    expect(item()).toMatchObject({ state: 'needs_approval', pending_bytes: 6e9, files_total: 2 }); expect(runs).toHaveLength(0)
    await runAll(); t += 600_000; await runAll(); expect(runs).toHaveLength(0); expect(item().state).toBe('needs_approval')   // nothing moves on its own
    await autosync.approve(POD, true); await autosync.settle()
    expect(runs).toHaveLength(1); expect(item()).toMatchObject({ state: 'done', pending_bytes: 0 })
    addEvent({ prefix: 'output/big2/' }); remote.push(R('output/big2/c.exr', 6e9)); await runAll(); expect(item().state).toBe('needs_approval')
    await autosync.approve(POD, false); expect(item()).toMatchObject({ state: 'idle', pending_bytes: 0 }); expect(item().summary).toMatch(/Skipped 1 file/)
    await runAll(); expect(runs).toHaveLength(1)   // dropped for good
    await expect(autosync.approve(POD, true)).rejects.toThrow(/Nothing waits/)
  })
  it('exactly 5 GB goes through without asking', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.exr', 5e9)]; await runAll(); expect(item().state).toBe('done')
  })
  it('pause stops new pulls (a running one finishes); syncNow ignores the pause', async () => {
    enable(); autosync.pause(true); expect(autosync.status().paused).toBe(true)
    addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]
    await runAll(); expect(runs).toHaveLength(0)
    await autosync.syncNow(POD); await autosync.settle(); expect(runs).toHaveLength(1); expect(item().state).toBe('done')
    autosync.pause(false); expect(autosync.status().paused).toBe(false)
  })
  it('one pull per pod at a time', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]
    let release!: () => void; gate = new Promise((r) => { release = r })
    await autosync.tick(); addEvent({ prefix: 'output/r2/' }); remote.push(R('output/r2/b.dpx')); await autosync.tick(); await autosync.syncNow(POD)
    expect(runs).toHaveLength(1)
    release(); await autosync.settle(); await runAll(); expect(runs).toHaveLength(2); expect(runs[1].paths).toEqual(['output/r2/b.dpx'])
  })
  it('only the folders the pod pulls (output by default); a deleted event and other folders are ignored; the journal is never pulled', async () => {
    enable(); addEvent({ prefix: 'input/' }); addEvent({ prefix: 'output/x/', op: 'deleted' }); addEvent({ paths: ['models/m.safetensors'] }); remote = [R('input/a.png'), R('output/x/a.dpx'), R('models/m.safetensors')]
    await runAll(); expect(runs).toHaveLength(0)
  })
  it('without a mapped ComfyUI-Shared folder it says where to set it', async () => {
    enable(); autosync.setDeps({ localRoot: () => null }); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]
    await runAll(); expect(item().state).toBe('error'); expect(item().error).toMatch(/Map ComfyUI-Shared first.*Configuration/)
  })
  it('the first run starts at the end of the journal: history is not pulled', async () => {
    addEvent({ prefix: 'output/old/' }); remote = [R('output/old/a.dpx')]
    autosync.setDeps({ tail: async () => 'k001' }); enable(); await runAll(); expect(runs).toHaveLength(0)
    addEvent({ prefix: 'output/new/' }); remote.push(R('output/new/b.dpx')); await runAll(); expect(runs[0].paths).toEqual(['output/new/b.dpx'])
  })
  it('the status has the contract shape', () => {
    enable(); const s = autosync.status()
    expect(Object.keys(s).sort()).toEqual(['items', 'paused'])
    expect(Object.keys(s.items[0]).sort()).toEqual(['bytes_done', 'bytes_total', 'conflicts', 'current', 'direction', 'error', 'files_done', 'files_total', 'finished_at', 'pending_bytes', 'pod_id', 'pod_name', 'rate_bps', 'started_at', 'state', 'streams', 'summary', 'volume_id'])
  })
})

describe('watch() for the sync explorer', () => {
  it('pull and push shapes from memory: states, cursor, pending, folders, debounce, events', async () => {
    enable({ push: true }); expect(autosync.watch()).toMatchObject({ paused: false, events: [] })
    addEvent({ prefix: 'output/r/', writer: 'pod:abc' }); addEvent({ prefix: 'output/q/' }); remote = [R('output/r/a.dpx', 50)]
    let release!: () => void; gate = new Promise((r) => { release = r })
    await autosync.tick()
    let w = autosync.watch()
    expect(w.pull).toEqual([expect.objectContaining({ pod_id: POD, pod_name: 'CanalV2-lores', volume_id: VOL, state: 'pulling', pending_events: 2, pending_paths: 1, pending_bytes: 50, cursor: 'k002' === '' ? '' : expect.any(String) })])
    expect(w.events.map((e) => `${e.writer}:${e.path}:${e.source_pod}`)).toEqual(['pod:abc:output/r/:abc', 'reconciler:output/q/:'])
    expect(w.push[0]).toMatchObject({ pod_id: POD, state: 'pushing' === w.push[0].state ? 'pushing' : expect.stringMatching(/watching|idle|pending/), debounce_ms_left: 0 }); expect(w.push[0].folders.map((f) => f.path)).toEqual(['input', 'workflows'])
    release(); await autosync.settle()
    autosync.pause(true); expect(autosync.watch()).toMatchObject({ paused: true }); expect(autosync.watch().pull[0].state).toBe('paused'); expect(autosync.watch().pull[0].pending_paths).toBe(0)
  })
  it('the push side: folders watched, pending files and the debounce time left, with a fake watcher and clock', async () => {
    enable({ push: true }); mkdirSync(join(shared, 'input'), { recursive: true }); const cbs: Record<string, (n: string | null) => void> = {}
    const q: { fn: () => void }[] = []; let id = 0
    autosync.setDeps({ watch: (d, cb) => { cbs[d.split('/').pop()!] = cb; return { close() {} } }, timer: { set: (fn) => { q.push({ fn }); return ++id }, clear: () => {} } })
    await autosync.tick()
    cbs.input('a.png'); cbs.input('b.png'); t += 4000
    const p = autosync.watch().push[0]
    expect(p).toMatchObject({ pending_files: 2, state: 'waiting', debounce_ms_left: 6000, last_change_at: new Date(T0).toISOString() }); expect(p.folders).toEqual([{ path: 'input', watching: true, pending: 2 }, { path: 'workflows', watching: false, pending: 0 }])
  })
})

describe('the History', () => {
  const changes = () => history.list({ kind: 'change' }).filter((e) => e.kind === 'change')
  it('records the approval of a big pull with the name of who enabled Auto sync, and pause and resume (once each)', async () => {
    enable(); addEvent({ prefix: 'output/big/' }); remote = [R('output/big/a.exr', 6e9)]; await runAll()
    await autosync.approve(POD, true); await autosync.settle()
    expect(changes().find((e) => e.action === 'auto sync approved a big pull')).toMatchObject({ area: 'pod', approved_by: 'Lucas', what: 'CanalV2-lores' })
    autosync.pause(true); autosync.pause(true); autosync.pause(false)
    expect(changes().filter((e) => e.action === 'auto sync paused')).toHaveLength(1); expect(changes().filter((e) => e.action === 'auto sync resumed')).toHaveLength(1)
  })
  it('the controller adds nothing of its own to the job history (the sync run records the one entry) and passes the trigger', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]; await runAll()
    expect(runs[0].trigger).toBe('auto-sync:reconcile'); expect(history.list({ kind: 'job' })).toHaveLength(0)   // the fake run records nothing; the real one does (syncpaths.test.ts)
    addEvent({ prefix: 'output/r2/', writer: 'app:sync' }); remote.push(R('output/r2/b.dpx')); await runAll(); expect(runs[1].trigger).toBe('auto-sync:feed')
    autosync.notifyOutputs(POD, VOL, ['output/r3/c.dpx']); remote.push(R('output/r3/c.dpx')); await new Promise((r) => setTimeout(r, 20)); await autosync.settle(); expect(runs[2].trigger).toBe('auto-sync:output')
    writeLocal('input/p.png', 3); store.set(POD, { push: true }); expect(await autosync.pushFiles(POD, ['input/p.png'])).toBe(1); await autosync.settle(); expect(runs[3].trigger).toBe('auto-sync:push')
  })
})

describe('pod names and pods that are gone (live pod list)', () => {
  let list: { id: string; name: string }[] | Error, listCalls: number
  beforeEach(() => { listCalls = 0; list = [{ id: POD, name: 'CanalV2-mono-v015-RO-auto-b' }] })
  const wire = () => autosync.setDeps({ podName: autosync.podNameOf, listPods: async () => { listCalls++; if (list instanceof Error) throw list; return list } })
  it('the name comes from the live list, not the raw id; a failing list falls back to the id', async () => {
    wire(); enable(); await autosync.tick(); expect(item().pod_name).toBe('CanalV2-mono-v015-RO-auto-b')
    list = new Error('RunPod is down'); autosync.forgetLive(); wire(); await autosync.tick(); expect(item().pod_name).toBe(POD)
  })
  it('refreshes at most once a minute, and not at all with no Auto sync pod', async () => {
    wire(); await autosync.tick(); expect(listCalls).toBe(0)
    enable(); await autosync.tick(); await autosync.tick(); expect(listCalls).toBe(1); t += 61_000; await autosync.tick(); expect(listCalls).toBe(2)
    list = [{ id: POD, name: 'Renamed' }]; t += 61_000; await autosync.tick(); expect(item().pod_name).toBe('Renamed')   // existing items follow the map
  })
  it('a pod missing from a fresh live list is skipped and its item is dropped, even one waiting for approval; its settings stay; one History line', async () => {
    wire(); enable(); addEvent({ prefix: 'output/big/' }); remote = [R('output/big/a.exr', 6e9)]; await autosync.tick(); await autosync.settle()
    expect(item().state).toBe('needs_approval')
    list = [{ id: 'someone-else', name: 'x' }]; t += 61_000; await autosync.tick()
    expect(autosync.status().items.find((i) => i.pod_id === POD)).toBeUndefined(); expect(autosync.get(POD).enabled).toBe(true)
    await autosync.tick(); await autosync.tick(); expect(runs).toHaveLength(0)
    expect(history.list({ kind: 'change' }).filter((e) => e.kind === 'change' && e.detail === `Pod ${POD} is not in RunPod any more: auto sync skipped`)).toHaveLength(1)
  })
  it('a failed list (or an old one) drops nothing', async () => {
    wire(); enable(); await autosync.tick(); list = [{ id: 'other', name: 'x' }]; t += 61_000; await autosync.tick(); expect(autosync.status().items.some((i) => i.pod_id === POD)).toBe(false)
    list = [{ id: POD, name: 'x' }]; autosync.forgetLive(); wire(); enable(); await autosync.tick(); list = new Error('down'); t += 61_000; await autosync.tick(); expect(autosync.status().items.some((i) => i.pod_id === POD)).toBe(true)
    t += 121_000; expect(autosync.status().items.some((i) => i.pod_id === POD)).toBe(true)   // the list is old now: believed no more, nothing dropped
  })
})

describe('the conflict rule and the skips', () => {
  it('a file already here with the same size is skipped', async () => {
    enable(); writeLocal('output/r/a.dpx', 100); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx', 100), R('output/r/b.dpx', 100)]
    await runAll(); expect(runs[0].paths).toEqual(['output/r/b.dpx'])
    writeLocal('output/r/c.dpx', 100); addEvent({ prefix: 'output/r/' }); remote.push(R('output/r/c.dpx', 100)); const n = runs.length; await runAll(); expect(runs).toHaveLength(n)
  })
  it('never synced and different: a conflict, reported and skipped (never overwritten)', async () => {
    enable(); writeLocal('output/r/a.dpx', 50); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx', 100), R('output/r/b.dpx', 100)]
    await runAll()
    expect(runs[0].paths).toEqual(['output/r/b.dpx']); expect(statSync(local('output/r/a.dpx')).size).toBe(50)
    expect(item().conflicts).toEqual([{ path: 'output/r/a.dpx', reason: expect.stringMatching(/never synced/) }])
  })
  it('changed on BOTH sides since the last sync: a conflict; only on the volume: pulled; only here: left alone, no conflict', async () => {
    enable(); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx', 100, 'm1'), R('output/r/b.dpx', 100, 'm1'), R('output/r/c.dpx', 100, 'm1')]
    await runAll(); expect(runs[0].paths).toHaveLength(3); autosync.dismiss(POD)
    writeLocal('output/r/a.dpx', 77, 1_000_000); writeLocal('output/r/c.dpx', 66, 1_000_000)   // edited here: a and c
    addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx', 120, 'm2'), R('output/r/b.dpx', 130, 'm2'), R('output/r/c.dpx', 100, 'm1')]   // a and b changed on the volume
    await runAll()
    expect(runs[1].paths).toEqual(['output/r/b.dpx'])   // b: only the volume changed
    expect(item().conflicts.map((c) => c.path)).toEqual(['output/r/a.dpx']); expect(item().conflicts[0].reason).toMatch(/both|Changed here and on the volume/i)
    expect(statSync(local('output/r/a.dpx')).size).toBe(77); expect(statSync(local('output/r/c.dpx')).size).toBe(66)   // neither was overwritten
  })
})

describe('the output trigger', () => {
  it('notifyOutputs starts a targeted pull of exactly those paths, at once', async () => {
    enable(); remote = [R('output/proxy_v004/a.0001.dpx'), R('output/proxy_v004/a.0002.dpx'), R('output/proxy_v004/other.dpx')]
    expect(autosync.notifyOutputs(POD, VOL, [{ filename: 'a.0001.dpx', subfolder: 'proxy_v004', type: 'output' }, { filename: 'a.0002.dpx', subfolder: 'proxy_v004', type: 'output' }, { filename: 'preview.png', subfolder: '', type: 'temp' }])).toBe(true)
    await autosync.settle(); await new Promise((r) => setTimeout(r, 20)); await autosync.settle()
    expect(runs).toHaveLength(1); expect(runs[0].paths).toEqual(['output/proxy_v004/a.0001.dpx', 'output/proxy_v004/a.0002.dpx'])   // no journal event, no other file
    expect(item().state).toBe('done')
  })
  it('does nothing for a pod without Auto sync, with Pull off, paused, or with only temp files', async () => {
    remote = [R('output/a.dpx')]
    expect(autosync.notifyOutputs(POD, VOL, ['output/a.dpx'])).toBe(false)
    enable({ pull: false }); expect(autosync.notifyOutputs(POD, VOL, ['output/a.dpx'])).toBe(false)
    enable(); expect(autosync.notifyOutputs(POD, VOL, [{ filename: 'p.png', type: 'temp' }])).toBe(false)
    expect(autosync.notifyOutputs(POD, VOL, ['../../etc/passwd'])).toBe(false)
    autosync.pause(true); expect(autosync.notifyOutputs(POD, VOL, ['output/a.dpx'])).toBe(false)
    await autosync.settle(); expect(runs).toHaveLength(0)
  })
  it('a run recorded by outputruns (a pod\'s history) calls the same notify', async () => {
    enable(); remote = [R('output/r/x.dpx')]
    outputruns.record({ pod_id: POD, volume_id: VOL }, [{ prompt_id: 'p1', status: 'success', outputs: [{ filename: 'x.dpx', subfolder: 'r', type: 'output' }] }])
    await new Promise((r) => setTimeout(r, 20)); await autosync.settle(); expect(runs[0]?.paths).toEqual(['output/r/x.dpx'])
  })
  it('a file the volume does not list yet is asked again a few times, then dropped', async () => {
    enable(); autosync.notifyOutputs(POD, VOL, ['output/late.dpx']); await new Promise((r) => setTimeout(r, 20)); await autosync.settle(); expect(runs).toHaveLength(0)
    remote = [R('output/late.dpx')]; await runAll(); expect(runs[0]?.paths).toEqual(['output/late.dpx'])
  })
})

describe('push (default off)', () => {
  const timer = () => { const q: { at: number; fn: () => void; id: number }[] = []; let id = 0, now = 0
    return { q, set: (fn: () => void, ms: number) => { q.push({ at: now + ms, fn, id: ++id }); return id }, clear: (h: unknown) => { const i = q.findIndex((x) => x.id === h); if (i >= 0) q.splice(i, 1) }, advance: (ms: number) => { now += ms; for (const x of q.filter((y) => y.at <= now)) { q.splice(q.indexOf(x), 1); x.fn() } } } }
  it('the collector debounces: every change re-arms, one flush after 10 s of quiet with the unique paths', async () => {
    const tm = timer(), got: string[][] = []
    const c = new push.Collector({ onFlush: (p) => { got.push(p) }, timer: tm })
    c.add('input/a.png'); tm.advance(6000); c.add('input/b.png'); c.add('input/a.png'); tm.advance(6000); expect(got).toEqual([]); expect(tm.q).toHaveLength(1)
    tm.advance(4000); await Promise.resolve(); await Promise.resolve(); expect(got).toEqual([['input/a.png', 'input/b.png']])
    c.add('input/c.png'); c.close(); tm.advance(20000); expect(got).toHaveLength(1)
  })
  it('a fake watcher: only the chosen folders, no litter; the callback only records', async () => {
    const tm = timer(), got: string[][] = []; const cbs: Record<string, (n: string | null) => void> = {}
    const w = new push.PushWatch(shared, ['input', 'models', 'workflows'], new push.Collector({ onFlush: (p) => { got.push(p) }, timer: tm }), (d, cb) => { cbs[d.split('/').pop()!] = cb; return { close() {} } })
    mkdirSync(join(shared, 'input'), { recursive: true }); mkdirSync(join(shared, 'models'), { recursive: true })
    expect(await w.start()).toEqual(['input', 'models'])   // workflows does not exist yet: not watched
    cbs.input('cat.png'); cbs.input('.DS_Store'); cbs.input('sub/._x'); cbs.models('a/m.safetensors'); cbs.input(null)
    tm.advance(10_000); await Promise.resolve(); await Promise.resolve()
    expect(got).toEqual([['input/cat.png', 'models/a/m.safetensors']])
    expect(push.relevant('output/a.dpx', ['input'])).toBe(false); expect(push.relevant('input/../x', ['input'])).toBe(false)
  })
  it('pushFiles sends changed files only (paths, additive), never an echo of our own pull, never when Push is off or paused', async () => {
    enable({ push: true })
    writeLocal('input/new.png', 10); writeLocal('input/pulled.png', 20); writeLocal('models/m.bin', 30)
    await store.putManifest(POD, { 'input/pulled.png': { size: 20, mtime: statSync(local('input/pulled.png')).mtimeMs, remote_size: 20, remote_modified: 'm' } })
    expect(await autosync.pushFiles(POD, ['input/new.png', 'input/pulled.png', 'input/gone.png', 'output/not-in-sync_shared.dpx', 'models/m.bin'])).toBe(1)   // models/ is never pushed by Auto sync
    await autosync.settle()
    expect(runs).toHaveLength(1); expect(runs[0]).toMatchObject({ direction: 'push', paths: ['input/new.png'], existing: 'size' }); expect(runs[0].shared).toEqual(['input'])
    expect(item()).toMatchObject({ direction: 'push', state: 'done' }); expect(item().summary).toMatch(/^Pushed 1 file /)
    store.set(POD, { push: false }); expect(await autosync.pushFiles(POD, ['input/new.png'])).toBe(0)
  })
  it('models/ is never pushed automatically, even when sync_shared includes it; the watcher does not watch it', async () => {
    enable({ push: true }); mkdirSync(join(shared, 'models'), { recursive: true }); mkdirSync(join(shared, 'input'), { recursive: true })
    writeLocal('models/m.safetensors', 9); writeLocal('input/a.png', 3)
    autosync.setDeps({ pushDirs: () => ['input', 'models', 'workflows'] })
    expect(await autosync.pushFiles(POD, ['models/m.safetensors', 'input/a.png'])).toBe(1)
    await autosync.settle(); expect(runs[0].paths).toEqual(['input/a.png']); expect(runs[0].shared).toEqual(['input'])
    expect(await autosync.pushFiles(POD, ['models/m.safetensors'])).toBe(0)
    const watched: string[] = []; autosync.setDeps({ watch: (d) => { watched.push(d.split('/').pop()!); return { close() {} } } }); await autosync.tick()
    expect(watched).toContain('input'); expect(watched).not.toContain('models'); expect(autosync.watch().push[0].folders.map((f) => f.path)).not.toContain('models')
    expect(store.PUSH_NOTE).toMatch(/never pushes models/)
  })
  it('a busy pod asks the collector to offer the paths again (one operation per pod)', async () => {
    enable({ push: true }); writeLocal('input/a.png', 5)
    let release!: () => void; gate = new Promise((r) => { release = r }); addEvent({ prefix: 'output/r/' }); remote = [R('output/r/a.dpx')]
    await autosync.tick(); expect(await autosync.pushFiles(POD, ['input/a.png'])).toBe(-1); release(); await autosync.settle()
  })
})

describe('transient storage errors (ADR-046)', () => {
  const unreachable = () => Object.assign(new CoreError(502, "RunPod's storage did not answer (the connection failed). Tried 3 times."), { code: 'storage_unreachable' })
  it('stays waiting for two failures in a row, one tick apart (not the 5 minute backoff), errors on the third with ONE History line, and resets on a success', async () => {
    enable(); feedFail = unreachable
    const lines = () => history.list({}).filter((e) => e.action === 'auto sync cannot reach storage').length
    await runAll(); expect(item().state).toBe('waiting'); expect(item().summary).toBe("Waiting for RunPod's storage to answer"); expect(item().error).toBe('')
    t += 30_000; await runAll(); expect(item().state).toBe('waiting')
    t += 30_000; await runAll(); expect(item().state).toBe('error'); expect(item().error).toContain('did not answer'); expect(item().error).not.toMatch(/https?:/)
    expect(lines()).toBe(1)
    feedFail = null; t += 5 * 60_000 + 1; await runAll(); expect(item().state).not.toBe('error')
    feedFail = unreachable; t += 30_000; await runAll(); expect(item().state).toBe('waiting')   // the count started over
    expect(lines()).toBe(1)
  })
  it('a failure that is not transient is an error at once, with the 5 minute retry', async () => {
    enable(); feedFail = () => new Error('Access denied')
    await runAll(); expect(item().state).toBe('error'); expect(item().error).toBe('Access denied')
    feedFail = null; t += 30_000; await runAll(); expect(item().state).toBe('error')   // still inside the backoff
  })
})

describe('a stopped pod has no volume in the RunPod API (its volume is remembered)', () => {
  const wire = (status: string, vol: string) => autosync.setDeps({ podName: autosync.podNameOf, volumeOf: async () => vol, listPods: async () => [{ id: POD, name: 'CanalV2-sync-RO-cheap-a-alt', status }] })
  it('a stopped pod with no volume known is INFO ("Stopped: <name>\'s volume is shown when it runs"), not an error; a running pod with none is still the error', async () => {
    wire('stopped', ''); enable(); await autosync.tick(); expect(item()).toMatchObject({ state: 'idle', error: '' }); expect(item().summary).toBe("Stopped: CanalV2-sync-RO-cheap-a-alt's volume is shown when it runs")
    autosync.forgetLive(); wire('running', ''); await autosync.tick(); expect(item()).toMatchObject({ state: 'error', error: 'This pod has no network volume to follow: set one in its configuration.' })
  })
})
