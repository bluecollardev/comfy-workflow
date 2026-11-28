/**
 * Auto sync, the controller (docs/ADR-046, phase 1). Per pod with Auto sync on and Pull on, a timer (every 30 s, like the pod watches in podwatch.ts) reads the volume's change
 * feed (journal.ts) after the pod's cursor, turns the new events into files under the pod's `pull_shared` folders (default `output`), decides what to bring down, and runs
 * the existing sync (syncrun.ts) with a `paths` list. The fast path: a run started from the app tells `notifyOutputs` which files it made and they are pulled at once.
 *
 * Rules it keeps:
 *  - Additive and never deleting. The project tree and plates are never part of it (a `paths` sync touches ComfyUI-Shared only).
 *  - A file already here with the same size is skipped. A file changed on BOTH sides since the last sync (the per-pod manifest decides) is a conflict: reported in
 *    status().conflicts and skipped, never overwritten. Changed only here: left alone. Exists here, differs, and was never synced: a conflict.
 *  - Size gate: more than 5 GB in one pull waits in state needs_approval until approve(pod, true) (false skips it and drops it).
 *  - One pull per pod at a time. `pause(true)` stops NEW auto pulls and pushes (a running one finishes). syncNow ignores the pause (a person asked).
 *  - The cursor moves only when everything the events named has landed; an error retries after 5 minutes (or at once on syncNow).
 *  - The destination is the mapped ComfyUI-Shared folder (the same relative path); not mapped: an error item says where to set it.
 *
 * ASYNC RULE (ADR-046): the core runs in Electron's main process. Everything here that touches a disk or a network is async and spawned (the sync machinery spawns rsync / aws and
 * parses their output a line at a time); loops over big lists work in chunks of 500 and yield with setImmediate; status() and get() answer from memory (a tiny settings file at most);
 * every planning call has a deadline and every pull a stall watchdog, so a stuck S3 or SSH call ends as an error item and never holds the controller.
 * Every effect goes through `Deps`, so the tests run it with fakes.
 */
import { timedTick } from './ticks.js'
import { stat as fsStat } from 'node:fs/promises'
import { join } from 'node:path'
import { CoreError } from './errors.js'
import * as history from './history.js'
import * as changes from './changes.js'
import * as journal from './journal.js'
import * as mounts from './mounts.js'
import * as outputruns from './outputruns.js'
import * as podpull from './podpull.js'
import * as podconfigs from './podconfigs.js'
import * as podnames from './podnames.js'
import * as pods from './pods.js'
import { Collector, PushWatch, nodeWatch, realTimer, type Timer, type WatchFn } from './autosyncpush.js'
import * as store from './autosyncstore.js'
import * as syncrun from './syncrun.js'

export { get, set as setSettings, forget, getVolume as getVolumeSettings } from './autosyncstore.js'
export type { Settings, Conflict } from './autosyncstore.js'

export type State = 'idle' | 'waiting' | 'syncing' | 'needs_approval' | 'error' | 'done'
export interface Item {
  pod_id: string; pod_name: string; volume_id: string; /** whose settings apply: the pod's own, or its volume's */ via: 'pod' | 'volume'; state: State; direction: 'pull' | 'push'
  files_done: number; files_total: number; bytes_done: number; bytes_total: number; rate_bps: number
  /** the newest file name; the failing file when state is error */ current: string
  pending_bytes: number; started_at: string; finished_at: string; summary: string; error: string; conflicts: store.Conflict[]
  /** how many copies run at once (sync_parallel, or fewer files) */ streams: number
}
export interface Status { paused: boolean; items: Item[] }
export interface Remote { path: string; bytes: number; modified: string }
export interface Entry { prefix?: string; paths?: string[] }

export const TICK_MS = 30_000
export const GATE_BYTES = 5e9
export const DONE_SHOW_MS = 10_000
export const RETRY_MS = 5 * 60_000
export const PLAN_TIMEOUT_MS = 5 * 60_000
export const STALL_MS = 10 * 60_000
export const NOTIFY_TRIES = 3
/** A file the volume lists as modified in the last few seconds may still be written (a DPX frame): it is left for the next try, not pulled half-written and not called a conflict. */
export const STABLE_MS = 5_000
/** Folders Auto sync never pushes, whatever the pod's sync_shared says (Lucas, 2026-11-18: "we already have models baked into app"). The Sync window, pressed by a person, still behaves as before. */
export const NEVER_PUSHED = ['models'] as const
const pushable = (dirs: string[]): string[] => dirs.filter((d) => !(NEVER_PUSHED as readonly string[]).includes(d))
const CHUNK = 500
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

export interface Deps {
  now(): number
  podName(podId: string): string
  /** The live pod list (id and name), best effort: used for names and to notice a pod that is gone */
  listPods(): Promise<{ id: string; name: string; status?: string }[]>
  volumeOf(podId: string): Promise<string>
  feed(volumeId: string, since: string): Promise<journal.Feed>
  tail(volumeId: string): Promise<string>
  files(volumeId: string, entries: Entry[]): Promise<Remote[]>
  localRoot(podId: string): string | null
  stat(abs: string): Promise<{ size: number; mtimeMs: number } | null>
  run(req: syncrun.SyncRequest, send: (e: syncrun.SyncEvent) => void, signal: AbortSignal): Promise<syncrun.SyncResult>
  reconcile(volumeId: string, extra: string[]): Promise<unknown>
  parallel(podId: string): number
  pullDirs(podId: string): string[]
  pushDirs(podId: string): string[]
  watch: WatchFn
  timer: Timer
}

const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
/** The remote files an event list names, from S3 listings by prefix (never the whole volume): exact paths by their folder (one level), prefixes whole. */
async function remoteFiles(volumeId: string, entries: Entry[]): Promise<Remote[]> {
  const out = new Map<string, Remote>(), byDir = new Map<string, Set<string>>()
  const add = (rows: { key: string; bytes: number; modified?: string }[], want?: Set<string>) => { for (const r of rows) { const p = r.key.startsWith('comfy-shared/') ? r.key.slice('comfy-shared/'.length) : r.key; if (!r.key.endsWith('/') && (!want || want.has(p))) out.set(p, { path: p, bytes: r.bytes, modified: r.modified ?? '' }) } }
  for (const e of entries) {
    if (e.paths) for (const p of e.paths) { const i = p.lastIndexOf('/'); if (i > 0) { const d = p.slice(0, i); byDir.set(d, (byDir.get(d) ?? new Set()).add(p)) } }
    else if (e.prefix) {
      try { add(await changes.listRows(volumeId, `comfy-shared/${e.prefix.replace(/\/+$/, '')}`, true)) } catch { /* a prefix S3 cannot list is skipped */ }
    }
  }
  for (const [d, want] of byDir) { try { add(await changes.listRows(volumeId, `comfy-shared/${d}`, false), want) } catch { /* skipped */ } await yieldLoop() }
  return [...out.values()]
}
const realDeps = (): Deps => ({
  now: () => Date.now(),
  podName: (id) => podNameOf(id),
  listPods: async () => (await pods.list()).map((p) => ({ id: p.id, name: p.name, status: p.status })),
  volumeOf: async (id) => syncrun.volumeIdFor(id),
  feed: (vol, since) => journal.list({ volume_id: vol, since, limit: journal.MAX_LIMIT }),
  tail: (vol) => journal.tail(vol),
  files: remoteFiles,
  localRoot: (id) => mounts.folderRows(cfgOf(id)).find((r) => r.key === 'comfy-shared')?.local || null,
  stat: async (abs) => { try { const s = await fsStat(abs); return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null } catch { return null } },
  run: (req, send, signal) => syncrun.run(req, send, signal),
  reconcile: (vol, extra) => changes.reconcile(vol, { extra }),
  parallel: (id) => syncrun.parallelFor(id),
  pullDirs: (id) => [...(cfgOf(id).pull_shared ?? mounts.PULL_SHARED_DEFAULT)],
  pushDirs: (id) => [...syncrun.effectiveShared({ pod_id: id })],
  watch: nodeWatch,
  timer: realTimer,
})
let deps: Deps = realDeps()
/** The tests give fakes (merged over what is set); null puts everything back. null puts everything back. */
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : realDeps() }

// ----- the runtime items (memory) -----

interface Held { files: Remote[]; bytes: number; cursor: string | null; synced: Record<string, store.Synced>; trigger: string; note: string }
interface Rt { /** consecutive failures because RunPod's storage did not answer (reset by any success) */ transientFails: number; lastEventAt: string; pendingEvents: number; pendingPaths: number; pendingBytes: number; lastPushAt: string; item: Item; busy: boolean; job?: Promise<void>; held?: Held; queued: Map<string, number>; retryAt: number; abort?: AbortController; s3: boolean }
const rts = new Map<string, Rt>()
// ----- the live pod list (names, and pods that are gone) -----
const liveStatus = new Map<string, string>()
const live = new Map<string, string>()   // pod id -> its live name; podName() reads it synchronously
let liveAt = 0, liveTried = 0
/** The live RunPod name, else the name this app gave the pod, else its id. Synchronous, from memory. */
export const podNameOf = (id: string): string => live.get(id) || podnames.get(id) || id
const goneLogged = new Set<string>()
export const LIVE_EVERY_MS = 60_000, LIVE_FRESH_MS = 120_000
/** Refresh the live pod list at most once a minute, only while an Auto sync pod exists; best effort (a failed call keeps what was known, and drops nothing). */
async function refreshLive(): Promise<void> {
  const now = deps.now()
  if (!store.enabledPods().length || now - liveTried < LIVE_EVERY_MS) return
  liveTried = now
  try {
    const list = await withDeadline(deps.listPods(), 20_000, 'The pod list')
    live.clear(); liveStatus.clear(); for (const p of list) { live.set(p.id, p.name); if (p.status) liveStatus.set(p.id, p.status) }
    liveAt = deps.now()
    for (const [id, rt] of rts) rt.item.pod_name = deps.podName(id)
  } catch { /* the list failed: behave as before */ }
}
/** True when a fresh, successful pod list (at most 2 minutes old) does not contain the pod: it was deleted outside the app. Settings are kept, nothing is deleted. */
const isGone = (podId: string): boolean => liveAt > 0 && deps.now() - liveAt <= LIVE_FRESH_MS && !live.has(podId)
function noteGone(podId: string): void {
  rts.delete(podId)
  if (goneLogged.has(podId)) return
  goneLogged.add(podId)
  history.record({ kind: 'change', area: 'pod', action: 'auto sync skipped', what: podId, detail: `Pod ${podId} is not in RunPod any more: auto sync skipped` })
}

const blank = (podId: string): Item => ({ pod_id: podId, pod_name: deps.podName(podId), volume_id: store.podVolumeOf(podId), via: store.via(podId), state: 'idle', direction: 'pull', files_done: 0, files_total: 0, bytes_done: 0, bytes_total: 0, rate_bps: 0, current: '', pending_bytes: 0, started_at: '', finished_at: '', summary: '', error: '', conflicts: [], streams: 0 })
function rtOf(podId: string): Rt {
  let r = rts.get(podId)
  if (!r) { const item = blank(podId); item.conflicts = store.loadState().conflicts[podId] ?? []; r = { transientFails: 0, lastEventAt: '', pendingEvents: 0, pendingPaths: 0, pendingBytes: 0, lastPushAt: '', item, busy: false, queued: new Map(), retryAt: 0, s3: false }; rts.set(podId, r) }
  return r
}
const iso = (ms: number) => new Date(ms).toISOString()
const fmt = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const withDeadline = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new CoreError(504, `${what} did not answer in ${Math.round(ms / 60000)} minutes`)), ms); if (typeof t === 'object' && 'unref' in t) t.unref(); p.then((v) => { clearTimeout(t); res(v) }, (e) => { clearTimeout(t); rej(e) }) })

export const TRANSIENT_LIMIT = 3
export const WAITING_STORAGE = "Waiting for RunPod's storage to answer"
const isTransient = (e: unknown): boolean => podpull.isStorageUnreachable(e) || /RunPod's storage did not answer/.test(String((e as { message?: string } | string | null)?.hasOwnProperty?.('message') ? (e as { message: string }).message : e ?? ''))
/** A failure because the connection to RunPod's storage did not work: the item stays `waiting` and the NEXT 30 s tick tries again (not the 5 minute error backoff); it becomes an error only on the 3rd failure in a row. One History line then, not one per attempt. Returns true when it was absorbed. */
function transientFail(rt: Rt, podId: string, e: unknown): boolean {
  if (!isTransient(e)) return false
  rt.transientFails++
  if (rt.transientFails === TRANSIENT_LIMIT) history.record({ kind: 'change', area: 'pod', action: 'auto sync cannot reach storage', what: deps.podName(podId), detail: `${TRANSIENT_LIMIT} tries in a row failed${(e as { detail?: string })?.detail ? `: ${(e as { detail: string }).detail}` : ''}` })
  if (rt.transientFails >= TRANSIENT_LIMIT) return false
  Object.assign(rt.item, { state: 'waiting', summary: WAITING_STORAGE, error: '' })
  return true
}
function fail(rt: Rt, message: string, current = ''): void {
  const it = rt.item
  it.state = 'error'; it.error = message; it.current = current || it.current; it.finished_at = iso(deps.now()); it.pending_bytes = 0
  rt.retryAt = deps.now() + RETRY_MS
}
const saveConflicts = (podId: string, list: store.Conflict[]) => { try { store.updateState((s) => { s.conflicts[podId] = list.slice(0, store.MAX_CONFLICTS) }) } catch { /* memory still has them */ } }

// ----- reading the state (all from memory) -----

/** What the card, the banner and the MCP show. From memory: never waits on a pull or a listing. `done` shows for a few seconds, then the item is idle again (its summary stays). */
export function status(): Status {
  const now = deps.now()
  for (const id of [...rts.keys()]) if (isGone(id)) noteGone(id)   // a pod deleted outside the app: its item (even one waiting for approval) goes
  const on = new Set(store.enabledPods().map((p) => p.pod_id)), st0 = store.loadState()
  for (const id of on) if (!isGone(id)) rtOf(id)
  const items: Item[] = []
  for (const [id, rt] of rts) {
    const it = rt.item
    if (it.state === 'done' && it.finished_at && now - Date.parse(it.finished_at) > DONE_SHOW_MS) it.state = 'idle'
    if (!on.has(id) && it.state === 'idle') continue
    it.pod_name = deps.podName(id)
    it.via = store.via(id); it.volume_id = store.podVolumeOf(id) || it.volume_id
    items.push({ ...it, conflicts: [...it.conflicts] })
  }
  return { paused: st0.paused, items: items.sort((a, b) => a.pod_id.localeCompare(b.pod_id)) }
}

export function pause(on: boolean): Status {
  const was = store.loadState().paused
  store.updateState((s) => { s.paused = !!on })
  if (was !== !!on) history.record({ kind: 'change', area: 'pod', action: on ? 'auto sync paused' : 'auto sync resumed', what: 'all pods', detail: on ? 'no new automatic pulls or pushes start; a running one finishes' : undefined })
  return status()
}
/** Take an error or a finished item off the banner (its conflicts go too). A running or waiting-for-approval item stays. */
export function dismiss(podId: string): Item {
  const rt = rtOf(podId), it = rt.item
  if (it.state === 'error' || it.state === 'done') { it.state = 'idle'; it.error = ''; it.current = ''; it.conflicts = []; saveConflicts(podId, []) }
  return { ...it, conflicts: [...it.conflicts] }
}

// ----- the cycle: plan (awaited), then run (detached) -----

type Mode = 'tick' | 'notify' | 'now' | 'enable'
const outputPath = (f: string | { filename?: string; subfolder?: string; type?: string }): string | null => {
  if (typeof f === 'string') return f
  if (!f || typeof f.filename !== 'string' || (f.type !== undefined && f.type !== 'output')) return null
  return `output/${f.subfolder ? `${f.subfolder.replace(/^\/+|\/+$/g, '')}/` : ''}${f.filename}`
}
const underDirs = (p: string, dirs: string[]) => dirs.includes(p.split('/')[0])

async function cycle(podId: string, mode: Mode): Promise<void> {
  if (isGone(podId)) { noteGone(podId); return }
  const rt = rtOf(podId), st = store.get(podId), s = store.loadState()
  if (rt.busy || rt.item.state === 'needs_approval' || rt.item.state === 'syncing') return
  if (mode !== 'now' && mode !== 'enable' && (!st.enabled || !st.pull || s.paused)) return
  if (mode === 'tick' && rt.item.state === 'error' && deps.now() < rt.retryAt) return
  rt.busy = true
  let detached = false
  try {
    const vol = await deps.volumeOf(podId)
    if (!vol) {
      const status = liveStatus.get(podId)
      if (status && status !== 'running') { Object.assign(rt.item, { state: 'idle', error: '', summary: `Stopped: ${deps.podName(podId)}'s volume is shown when it runs` }); return }   // INFO, not an error: RunPod gives no volume for a stopped pod
      if (!status) { Object.assign(rt.item, { state: 'idle', error: '', summary: `${deps.podName(podId)}'s volume is not known yet (it is shown when the pod runs)` }); return }
      fail(rt, 'This pod has no network volume to follow: set one in its configuration.'); return
    }
    rt.item.volume_id = vol; rt.item.pod_name = deps.podName(podId)
    const root = deps.localRoot(podId)
    if (!root) { fail(rt, 'Map ComfyUI-Shared first: set the ComfyUI-Shared folder in Configuration, Folders (Default Configuration or this pod\'s own), so Auto sync knows where to put the files.'); return }
    const key = `${vol}:${podId}`   // a cursor per pod on the volume: pods that pull different folders must not eat each other's events
    const existing = mode === 'enable'
    let cursor = store.loadState().cursors[key]
    if (!cursor && !existing) { cursor = await withDeadline(deps.tail(vol), PLAN_TIMEOUT_MS, 'The change journal'); store.updateState((x) => { x.cursors[key] = cursor! }) }
    const dirs = deps.pullDirs(podId)
    // the feed after the cursor
    let next = cursor
    const events: journal.JournalEvent[] = []
    for (let page = 0; page < 5 && !existing; page++) {
      const f = await withDeadline(deps.feed(vol, next), PLAN_TIMEOUT_MS, 'The change journal')
      events.push(...f.events); next = f.cursor || next
      if (!f.more) break
    }
    noteEvents(rt, events)
    rt.pendingEvents = events.length
    // events and queued output paths -> entries under the pull folders
    const entries: Entry[] = [], seen = new Set<string>()
    for (let i = 0; i < events.length; i += CHUNK) {
      for (const e of events.slice(i, i + CHUNK)) {
        if (e.op === 'deleted') continue
        const exact = e.paths ?? (e.path ? [e.path] : undefined)
        if (exact) { const ps = exact.filter((p) => underDirs(p, dirs) && !seen.has(p)); ps.forEach((p) => seen.add(p)); if (ps.length) entries.push({ paths: ps }) }
        else if (e.prefix && (underDirs(e.prefix, dirs) || dirs.some((d) => d.startsWith(e.prefix!)))) entries.push({ prefix: e.prefix })
      }
      await yieldLoop()
    }
    const asked = [...rt.queued.keys()].filter((p) => underDirs(p, dirs))
    if (asked.length) entries.push({ paths: asked })
    if (existing) for (const d of dirs) entries.push({ prefix: `${d}/` })   // "Pull existing outputs now": everything the pull folders hold, once
    if (!entries.length) { if (rt.transientFails && rt.item.state === 'error') { rt.item.state = 'idle'; rt.item.error = '' }; rt.transientFails = 0; await finishPlan(rt, podId, key, cursor, next, [], {}); return }
    if (rt.item.state !== 'error') rt.item.state = 'waiting'
    let remote = (await withDeadline(deps.files(vol, entries), PLAN_TIMEOUT_MS, 'The volume listing')).filter((r) => underDirs(r.path, dirs))
    rt.transientFails = 0   // the storage answered
    // queued output paths that were found leave the queue; the rest are tried a few more times (the volume may not list them yet)
    const have = new Set(remote.map((r) => r.path))
    // files modified a moment ago may still be being written: wait for them to be stable
    const young = new Set<string>(), nowMs = deps.now()
    for (const r of remote) { const m = Date.parse(r.modified); if (r.modified && Number.isFinite(m) && nowMs - m < STABLE_MS && nowMs - m > -86_400_000) young.add(r.path) }
    for (const p of asked) { if (young.has(p)) continue; if (have.has(p)) rt.queued.delete(p); else { const n = (rt.queued.get(p) ?? 0) + 1; if (n >= NOTIFY_TRIES) rt.queued.delete(p); else rt.queued.set(p, n) } }
    // decide, in chunks: pull, same, conflict, leave alone
    const manifest = await store.getManifest(podId)
    if (young.size) { remote = remote.filter((r) => !young.has(r.path)); next = cursor; deps.timer.set(() => { void cycle(podId, existing ? 'enable' : 'tick') }, STABLE_MS + 500) }   // not moved past: the next try sees them again
    const toPull: Remote[] = [], synced: Record<string, store.Synced> = {}, conflicts: store.Conflict[] = []
    for (let i = 0; i < remote.length; i += CHUNK) {
      await Promise.all(remote.slice(i, i + CHUNK).map(async (f) => {
        try { journal.sharedPath(f.path) } catch { return }
        const loc = await deps.stat(join(root, f.path))
        if (!loc) { toPull.push(f); return }
        if (loc.size === f.bytes) { synced[f.path] = { size: loc.size, mtime: loc.mtimeMs, remote_size: f.bytes, remote_modified: f.modified }; return }   // already here
        const m = manifest[f.path]
        if (!m) { conflicts.push({ path: f.path, reason: 'It exists here with a different size and was never synced, so neither copy is known to be newer.' }); return }
        const localChanged = loc.size !== m.size || Math.abs(loc.mtimeMs - m.mtime) > 2000
        const remoteChanged = f.bytes !== m.remote_size || f.modified !== m.remote_modified
        if (localChanged && remoteChanged) conflicts.push({ path: f.path, reason: 'Changed here and on the volume since the last sync; neither was overwritten.' })
        else if (!localChanged) toPull.push(f)   // changed only on the volume: bring it down
        // changed only here: this PC's copy is the newer one, left alone (a push carries it)
      }))
      await yieldLoop()
    }
    toPull.sort((a, b) => a.path.localeCompare(b.path))
    if (conflicts.length) {
      const known = new Map(rt.item.conflicts.map((c) => [c.path, c]))
      for (const c of conflicts) known.set(c.path, c)
      rt.item.conflicts = [...known.values()].slice(-store.MAX_CONFLICTS); saveConflicts(podId, rt.item.conflicts)
    }
    const bytes = toPull.reduce((a, f) => a + f.bytes, 0)
    rt.pendingPaths = toPull.length; rt.pendingBytes = bytes
    if (!toPull.length) { await finishPlan(rt, podId, key, cursor, next, [], synced, existing); return }
    const fromAsked = asked.length > 0 && !existing, fromFeed = events.filter((e) => e.op !== 'deleted')
    const trigger = existing ? 'auto-sync:enable' : fromAsked ? 'auto-sync:output' : fromFeed.length && fromFeed.every((e) => e.writer === 'reconciler') ? 'auto-sync:reconcile' : 'auto-sync:feed'
    const note = conflicts.length ? `${plural(conflicts.length, 'conflict')} skipped (${conflicts.slice(0, 2).map((c) => c.path).join(', ')}${conflicts.length > 2 ? ', ...' : ''})` : ''
    const held: Held = { files: toPull, bytes, cursor: next, synced, trigger, note }
    if (bytes > GATE_BYTES) {
      Object.assign(rt.item, { state: 'needs_approval', direction: 'pull', pending_bytes: bytes, files_total: toPull.length, bytes_total: bytes, error: '', summary: `${plural(toPull.length, 'file')} (${fmt(bytes)}) wait for your yes`, finished_at: '' })
      rt.held = held
      return
    }
    rt.job = execute(rt, podId, key, held)
    detached = true
  } catch (e) {
    if (!transientFail(rt, podId, e)) fail(rt, (e as Error).message)
  } finally { if (!detached) rt.busy = false }
}

/** Nothing to pull: the cursor moves on, the files already here are noted in the manifest, and a "waiting" item goes back to idle. */
async function finishPlan(rt: Rt, podId: string, key: string, from: string, to: string, _files: Remote[], synced: Record<string, store.Synced>, _existing = false): Promise<void> {
  if (to !== from) store.updateState((x) => { x.cursors[key] = to })
  if (Object.keys(synced).length) await store.putManifest(podId, synced).catch(() => undefined)
  if (rt.item.state === 'waiting') { rt.item.state = 'idle'; if (rt.item.summary === WAITING_STORAGE) rt.item.summary = '' }
  if (_existing) { rt.item.summary = 'Already up to date'; rt.item.finished_at = iso(deps.now()); rt.item.state = 'done' }   // the catch-up found nothing to pull: a quiet done
}

/** Pull the planned files through the sync machinery and map its events into the item. */
async function execute(rt: Rt, podId: string, cursorKey: string, held: Held): Promise<void> {
  const it = rt.item, ac = new AbortController()
  rt.abort = ac; rt.held = undefined; rt.s3 = false
  const files = held.files, total = files.length
  Object.assign(it, { state: 'syncing', direction: 'pull', files_total: total, files_done: 0, bytes_total: held.bytes, bytes_done: 0, rate_bps: 0, current: '', pending_bytes: 0, started_at: iso(deps.now()), finished_at: '', summary: '', error: '', streams: Math.max(1, Math.min(deps.parallel(podId), total)) })
  let last = deps.now(), stalled = false, started = 0
  const watchdog = setInterval(() => { if (deps.now() - last > STALL_MS) { stalled = true; ac.abort() } }, Math.min(10_000, STALL_MS / 2)); if (typeof watchdog === 'object' && 'unref' in watchdog) watchdog.unref()
  const problems: string[] = []
  const send = (e: syncrun.SyncEvent) => {   // monotonic: the banner never goes backwards
    last = deps.now()
    if (e.kind === 'line' && e.text && /^Copying /.test(e.text)) rt.s3 = /S3/.test(e.text)
    else if (e.kind === 'step' && e.streams) it.streams = e.streams
    else if (e.kind === 'file' && e.path) { started++; it.current = e.path.split('/').pop() || e.path; it.files_done = Math.max(it.files_done, Math.min(total, rt.s3 ? started : Math.max(0, started - 1))) }
    else if (e.kind === 'progress') { if (e.run_bytes_done !== undefined) it.bytes_done = Math.max(it.bytes_done, Math.min(held.bytes, e.run_bytes_done)); if (e.rate_bps !== undefined) it.rate_bps = e.rate_bps }
    else if (e.kind === 'problem' && e.text && problems.length < 20) problems.push(e.text)
  }
  const sizes: Record<string, number> = {}
  for (const f of files) sizes[f.path] = f.bytes
  let thrown = ''
  try {
    const r = await deps.run({ pod_id: podId, direction: 'pull', paths: files.map((f) => f.path), path_sizes: sizes, existing: 'size', trigger: held.trigger, ...(held.note ? { note: held.note } : {}) }, send, ac.signal)
    if (r.code && r.message) thrown = r.message   // disk_full on this PC: the same words as the Sync window
    else if (r.cancelled && !stalled) thrown = 'The pull was cancelled.'
  } catch (e) { thrown = (e as Error).message } finally { clearInterval(watchdog) }
  if (stalled) thrown = `No progress for ${Math.round(STALL_MS / 60000)} minutes: the pull was stopped (it is tried again in ${Math.round(RETRY_MS / 60000)} minutes).`
  // what actually landed, whatever the exit codes said
  const root = deps.localRoot(podId) ?? ''
  const landed: Record<string, store.Synced> = {}, missing: string[] = []
  let got = 0
  for (let i = 0; i < files.length; i += CHUNK) {
    await Promise.all(files.slice(i, i + CHUNK).map(async (f) => {
      const loc = root ? await deps.stat(join(root, f.path)) : null
      if (loc) { landed[f.path] = { size: loc.size, mtime: loc.mtimeMs, remote_size: f.bytes, remote_modified: f.modified }; got += loc.size } else missing.push(f.path)
    }))
    await yieldLoop()
  }
  await store.putManifest(podId, { ...held.synced, ...landed }).catch(() => undefined)
  const n = total - missing.length
  it.finished_at = iso(deps.now())
  if ((missing.length || thrown) && transientFail(rt, podId, thrown)) {   // the pull's storage call did not answer: wait, try again at the next tick
    for (const p of asQueued(files, missing.length ? missing : files.map((f) => f.path))) rt.queued.set(p, 0)
  } else if (missing.length || thrown) {
    missing.sort()
    const why = thrown || (problems[0] ?? '')
    fail(rt, `${missing.length ? `${plural(missing.length, 'file')} of ${total} did not arrive` : 'The pull failed'}${why ? `: ${why}` : ''}`, missing[0] ?? '')
    it.files_done = Math.max(it.files_done, n); it.summary = n ? `Pulled ${plural(n, 'file')} before it stopped` : ''
    for (const p of asQueued(files, missing)) rt.queued.set(p, 0)
  } else {
    rt.transientFails = 0
    it.state = 'done'; it.files_done = total; it.bytes_done = Math.max(it.bytes_done, held.bytes); it.current = it.current || ''
    const top = [...new Set(files.map((f) => `${f.path.split('/')[0]}/`))].join(', ')
    it.summary = `Pulled ${plural(total, 'file')} (${fmt(held.bytes)}) to ${top}`
    store.updateState((x) => { if (held.cursor) x.cursors[cursorKey] = held.cursor })
    const pulled = new Set(files.map((f) => f.path))
    if (it.conflicts.some((c) => pulled.has(c.path))) { it.conflicts = it.conflicts.filter((c) => !pulled.has(c.path)); saveConflicts(podId, it.conflicts) }
  }
  rt.abort = undefined; rt.busy = false; rt.pendingEvents = 0; rt.pendingPaths = 0; rt.pendingBytes = 0
  if (rt.queued.size && it.state !== 'error') void cycle(podId, 'notify')
}
const asQueued = (files: Remote[], missing: string[]): string[] => { const m = new Set(missing); return files.filter((f) => m.has(f.path) && f.path.startsWith('output/')).map((f) => f.path) }

/** Wait for every running pull and push to finish (the tests, and a quit that wants to be clean). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const jobs = [...rts.values()].map((r) => r.job).filter(Boolean) as Promise<void>[]
    if (jobs.length) { await Promise.all(jobs); for (const r of rts.values()) r.job = undefined; continue }
    if (![...rts.values()].some((r) => r.busy)) return
    await new Promise((r) => setTimeout(r, 5))
  }
}

// ----- the person's calls -----

/** Reconcile the volume and pull for this pod now (whatever Auto sync's switch says; the pause does not apply). Returns once the pull has started or there was nothing to do. */
export async function syncNow(podId: string): Promise<Item> {
  const rt = rtOf(podId)
  if (rt.busy || rt.item.state === 'syncing' || rt.item.state === 'needs_approval') return { ...rt.item, conflicts: [...rt.item.conflicts] }
  try {
    const vol = await deps.volumeOf(podId)
    if (vol) {
      const key = `${vol}:${podId}`
      if (!store.loadState().cursors[key]) { const t = await withDeadline(deps.tail(vol), PLAN_TIMEOUT_MS, 'The change journal'); store.updateState((x) => { x.cursors[key] = t }) }   // before the reconcile, so its events are after the cursor
      await withDeadline(deps.reconcile(vol, extraDirs(podId)), PLAN_TIMEOUT_MS, 'The volume listing').catch(() => undefined)
    }
  } catch (e) { fail(rt, (e as Error).message); return { ...rt.item, conflicts: [...rt.item.conflicts] } }
  rt.retryAt = 0
  await cycle(podId, 'now')
  return { ...rt.item, conflicts: [...rt.item.conflicts] }
}

/**
 * The catch-up when Auto sync is turned on (off to on, with Pull on): outputs that appeared BEFORE it was enabled must not be lost, because the feed starts at its end and the reconciler's first
 * pass is only a baseline. In the background (set() returns at once): the cursor goes to the end of the journal, the reconciler baseline is recorded, THEN output/ (the pull folders) is listed
 * whole over S3 (works with the pod stopped) and what is not here yet is pulled by the usual rules (same size skipped, conflicts reported, the 5 GB gate, sync_parallel streams). Baseline before the
 * listing, not after: a file that lands between the two is both an event and in the listing (pulled once, the second time it is the same size), where a baseline taken after the pull would swallow it.
 * `baselineOnly` (a pod being created has no outputs of its own yet) only sets the cursor and the baseline. Idempotent by its caller: only the off-to-on change starts it.
 */
export async function catchUp(podId: string, o: { baselineOnly?: boolean } = {}): Promise<void> {
  const rt = rtOf(podId)
  if (rt.busy || rt.item.state === 'syncing' || rt.item.state === 'needs_approval') return
  rt.busy = true
  try {
    const vol = await deps.volumeOf(podId)
    if (!vol) return
    const key = `${vol}:${podId}`
    if (!store.loadState().cursors[key]) { const t = await withDeadline(deps.tail(vol), PLAN_TIMEOUT_MS, 'The change journal'); store.updateState((x) => { x.cursors[key] = t }) }
    await withDeadline(deps.reconcile(vol, extraDirs(podId)), PLAN_TIMEOUT_MS, 'The volume listing').catch(() => undefined)
  } catch (e) { if (!o.baselineOnly) fail(rt, (e as Error).message) } finally { rt.busy = false }
  if (!o.baselineOnly && rt.item.state !== 'error') await cycle(podId, 'enable')
}

/** The person's answer to a pull that waits above the size gate: true pulls it, false skips it and drops it. */
export async function approve(podId: string, yes: boolean): Promise<Item> {
  const rt = rtOf(podId), held = rt.held
  if (!held || rt.item.state !== 'needs_approval') throw new CoreError(409, 'Nothing waits for approval on this pod.')
  const key = `${rt.item.volume_id}:${podId}`
  history.record({ kind: 'change', area: 'pod', action: yes ? 'auto sync approved a big pull' : 'auto sync skipped a big pull', what: deps.podName(podId), detail: `${plural(held.files.length, 'file')} (${fmt(held.bytes)}), above the ${fmt(GATE_BYTES)} gate`, approved_by: store.get(podId).approved_by || undefined })
  if (yes) { rt.busy = true; rt.job = execute(rt, podId, key, held); await Promise.resolve(); return { ...rt.item, conflicts: [...rt.item.conflicts] } }
  rt.held = undefined
  store.updateState((x) => { if (held.cursor) x.cursors[key] = held.cursor })
  Object.assign(rt.item, { state: 'idle', pending_bytes: 0, summary: `Skipped ${plural(held.files.length, 'file')} (${fmt(held.bytes)})`, files_total: 0, bytes_total: 0, finished_at: iso(deps.now()) })
  return { ...rt.item, conflicts: [...rt.item.conflicts] }
}

/** The fast path (ADR-046 section 5): a run on this pod just made these files. When Auto sync pulls for this pod they are pulled at once. Best effort, never throws; returns whether a pull was asked for. */
export function notifyOutputs(podId: string, _volumeId: string | null | undefined, files: (string | { filename?: string; subfolder?: string; type?: string })[]): boolean {
  try {
    if (_volumeId) store.setPodVolume(podId, _volumeId); else noteSeen(podId)   // the output event names the volume: a pod on an enabled volume works from the first file
    const st = store.get(podId)
    if (!st.enabled || !st.pull || store.loadState().paused) return false
    const paths = (files ?? []).map(outputPath).filter((p): p is string => !!p).filter((p) => { try { journal.sharedPath(p); return true } catch { return false } })
    if (!paths.length || !underDirs(paths[0], deps.pullDirs(podId))) return false
    const rt = rtOf(podId)
    for (const p of paths) rt.queued.set(p, 0)
    void cycle(podId, 'notify')
    return true
  } catch { return false }
}
// when a pod's history records new runs (outputruns.ts), the same notification
outputruns.setRecordedHook((ctx, files) => { notifyOutputs(ctx.pod_id, ctx.volume_id, files) })

// ----- push (default off) -----

interface Pushing { watch: PushWatch; key: string }
const pushers = new Map<string, Pushing>()
const extraDirs = (podId: string): string[] => { const st = store.get(podId); return [...(st.pull ? deps.pullDirs(podId) : []), ...(st.push ? pushable(deps.pushDirs(podId)) : [])].filter((d) => d === 'input' || d === 'models') }

/** Push these files (relative to ComfyUI-Shared) now: only what exists, was not just pulled, and changed. Additive, `paths` only. Returns how many were sent. */
export async function pushFiles(podId: string, paths: string[]): Promise<number> {
  const rt = rtOf(podId), root = deps.localRoot(podId)
  if (!root || store.loadState().paused || !store.get(podId).push) return 0
  if (rt.busy || rt.item.state === 'needs_approval') return -1   // one operation per pod at a time: the collector offers the paths again
  const manifest = await store.getManifest(podId)
  const dirs = pushable(deps.pushDirs(podId)), send: Remote[] = []
  for (let i = 0; i < paths.length; i += CHUNK) {
    await Promise.all(paths.slice(i, i + CHUNK).map(async (p) => {
      if (!underDirs(p, dirs)) return
      const loc = await deps.stat(join(root, p))
      if (!loc) return
      const m = manifest[p]
      if (m && m.size === loc.size && Math.abs(m.mtime - loc.mtimeMs) <= 2000) return   // what our own pull put here: not an edit, no echo
      send.push({ path: p, bytes: loc.size, modified: '' })
    }))
    await yieldLoop()
  }
  if (!send.length) return 0
  send.sort((a, b) => a.path.localeCompare(b.path))
  const it = rt.item, ac = new AbortController(), total = send.length, bytes = send.reduce((a, f) => a + f.bytes, 0)
  rt.busy = true; rt.abort = ac
  Object.assign(it, { state: 'syncing', direction: 'push', files_total: total, files_done: 0, bytes_total: bytes, bytes_done: 0, rate_bps: 0, current: '', pending_bytes: 0, started_at: iso(deps.now()), finished_at: '', summary: '', error: '', streams: Math.max(1, Math.min(deps.parallel(podId), total)) })
  let started = 0
  const sizes: Record<string, number> = {}
  for (const f of send) sizes[f.path] = f.bytes
  rt.job = (async () => {
    try {
      const r = await deps.run({ pod_id: podId, direction: 'push', paths: send.map((f) => f.path), path_sizes: sizes, shared: [...new Set(send.map((f) => f.path.split('/')[0]))], existing: 'size', trigger: 'auto-sync:push' }, (e) => {
        if (e.kind === 'file' && e.path) { started++; it.current = e.path.split('/').pop() || e.path; it.files_done = Math.max(it.files_done, Math.min(total, started)) }
        else if (e.kind === 'progress') { if (e.run_bytes_done !== undefined) it.bytes_done = Math.max(it.bytes_done, Math.min(bytes, e.run_bytes_done)); if (e.rate_bps !== undefined) it.rate_bps = e.rate_bps }
      }, ac.signal)
      if (r.failed) throw new Error(`${plural(r.failed, 'folder')} failed to push`)
      it.state = 'done'; it.files_done = total; it.bytes_done = bytes; it.finished_at = iso(deps.now()); rt.lastPushAt = it.finished_at
      it.summary = `Pushed ${plural(total, 'file')} (${fmt(bytes)}) to ${[...new Set(send.map((f) => `${f.path.split('/')[0]}/`))].join(', ')}`
    } catch (e) { fail(rt, `Push failed: ${(e as Error).message}`) } finally { rt.abort = undefined; rt.busy = false }
  })()
  return total
}

/** Start or stop each pod's local watcher to match its settings (every tick). A watcher that cannot start is an error item, not an exception. */
async function syncWatchers(): Promise<void> {
  const want = new Map(store.enabledPods().filter((p) => p.settings.push && !isGone(p.pod_id)).map((p) => [p.pod_id, p]))
  for (const [id, p] of pushers) if (!want.has(id)) { p.watch.close(); pushers.delete(id) }
  for (const [id] of want) {
    const root = deps.localRoot(id)
    if (!root) continue
    const dirs = pushable(deps.pushDirs(id)), key = `${root}|${dirs.join(',')}`
    const have = pushers.get(id)
    if (have && have.key === key) continue
    have?.watch.close()
    const collector = new Collector({ onFlush: (paths) => pushFiles(id, paths).then((n) => { if (n === -1) paths.forEach((p) => collector.add(p)) }), timer: deps.timer, now: () => deps.now() })
    const watch = new PushWatch(root, dirs, collector, deps.watch)
    pushers.set(id, { watch, key })
    try { await watch.start() } catch (e) { pushers.delete(id); watch.close(); fail(rtOf(id), `Push watch could not start: ${(e as Error).message}`) }
  }
}

// ----- the timer -----

let ticking = false
/** One pass: each Auto sync pod with Pull on plans (and starts) a pull; the push watchers are kept in step with the settings. Never throws. */
export async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await refreshLive()
    await refreshVolumes().catch(() => undefined)
    for (const { pod_id, settings } of store.enabledPods()) { if (settings.pull) await cycle(pod_id, 'tick').catch(() => undefined) }
    await syncWatchers().catch(() => undefined)
  } finally { ticking = false }
}
let timer: ReturnType<typeof setInterval> | null = null
/** Tick every 30 s and reconcile the volumes of Auto sync pods every 5 minutes while this process is up (idempotent). */
export function start(everyMs = TICK_MS): void {
  changes.start(() => {
    const by = new Map<string, Set<string>>()
    for (const { pod_id } of store.enabledPods()) { const v = syncrun.volumeIdFor(pod_id); if (v) { const s = by.get(v) ?? new Set(); extraDirs(pod_id).forEach((d) => s.add(d)); by.set(v, s) } }
    return [...by].map(([volume_id, s]) => ({ volume_id, extra: [...s] }))
  })
  if (timer) return
  timer = setInterval(() => { void timedTick('autosync.tick', () => tick()) }, everyMs)
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
}
export function stop(): void { if (timer) { clearInterval(timer); timer = null } changes.stop(); for (const p of pushers.values()) p.watch.close(); pushers.clear() }

/** Save a pod's settings (a named yes to turn it on) and get going at once. */
export function set(podId: string, settings: Partial<store.Settings>): store.Settings {
  const before = store.getOwn(podId)
  const r = store.set(podId, settings)
  if (r.enabled) { start(); if (!before.enabled && r.pull) void catchUp(podId).catch(() => undefined); else void tick() } else { const p = pushers.get(podId); if (p) { p.watch.close(); pushers.delete(podId) } }
  return r
}

// ----- per volume (a pod follows its volume's Auto sync unless its own entry is on) -----
export const VOLUMES_EVERY_MS = 60_000
let volTried = 0, volLooking = new Set<string>(), volMissed = new Map<string, number>()
/** Refresh pod -> volume (listPods + volumeOf) about every 60 s, only while some volume has Auto sync on; a failure keeps the old map (a pod whose lookup fails keeps its old volume). Pods first seen get looked up at once. */
export async function refreshVolumes(force = false): Promise<void> {
  if (!Object.values(store.volumeEntries()).some((s) => s.enabled)) return
  const now = deps.now()
  if (!force && now - volTried < VOLUMES_EVERY_MS) return
  volTried = now
  const list = await withDeadline(deps.listPods(), 20_000, 'The pod list')   // a failure throws: the map stays as it was
  const old = store.volumeMap(), next = new Map<string, string>()
  await Promise.all(list.map(async (p) => {
    try { const v = await withDeadline(deps.volumeOf(p.id), 20_000, 'The volume lookup'); if (v) next.set(p.id, v); else if (old.has(p.id)) next.set(p.id, old.get(p.id)!) } catch { if (old.has(p.id)) next.set(p.id, old.get(p.id)!) }
  }))
  store.setVolumeMap(next)
}
/** A pod seen for the first time (no volume known): look its volume up in the background (at most once a minute per pod). */
function noteSeen(podId: string): void {
  if (store.podVolumeOf(podId) || volLooking.has(podId) || !Object.values(store.volumeEntries()).some((s) => s.enabled)) return
  const now = deps.now(); if (now - (volMissed.get(podId) ?? -Infinity) < VOLUMES_EVERY_MS) return
  volMissed.set(podId, now); volLooking.add(podId)
  void deps.volumeOf(podId).then((v) => { if (v) store.setPodVolume(podId, v) }).catch(() => undefined).finally(() => volLooking.delete(podId))
}
/** A volume's Auto sync settings plus kick the controller so it starts or stops at once (like set for a pod). enabled: true needs approved_by. */
export function setVolumeSettings(volumeId: string, settings: Partial<store.Settings>): store.Settings {
  const before = store.getVolume(volumeId)
  const r = store.setVolume(volumeId, settings)
  if (r.enabled) { start(); void refreshVolumes(true).catch(() => undefined).then(async () => { if (!before.enabled && r.pull) await Promise.all(store.enabledPods().filter((p) => p.via === 'volume' && store.podVolumeOf(p.pod_id) === volumeId).map((p) => catchUp(p.pod_id).catch(() => undefined))); else await tick() }).catch(() => undefined) }
  else { for (const [id, p] of [...pushers]) if (store.podVolumeOf(id) === volumeId && !store.getOwn(id).enabled) { p.watch.close(); pushers.delete(id) } }
  return r
}
/** The status items of the pods on a volume (with the volume's settings). */
export function volumeStatus(volumeId: string): { paused: boolean; volume_id: string; settings: store.Settings; items: Item[] } {
  const st = status()
  return { paused: st.paused, volume_id: volumeId, settings: store.getVolume(volumeId), items: st.items.filter((i) => i.volume_id === volumeId || store.podVolumeOf(i.pod_id) === volumeId) }
}
/** Forget the live pod list and the items (tests). */
export function forgetLive(): void { rts.clear(); live.clear(); liveAt = 0; liveTried = 0; goneLogged.clear(); volTried = 0; volLooking.clear(); volMissed.clear() }
/** Forget the runtime memory (tests). */
export function reset(): void { stop(); rts.clear(); live.clear(); liveAt = 0; liveTried = 0; goneLogged.clear(); feedRing.length = 0; feedSeen.clear(); volTried = 0; volLooking.clear(); volMissed.clear(); store.resetMemory(); setDeps(null) }

// ----- the sync explorer's view of the watchers (docs/ADR-046, "Sync explorer and logs") -----

const feedSeen = new Set<string>()
const feedRing: { ts: string; writer: string; op: string; path: string; source_pod: string }[] = []
/** Remember the feed events the controller reads: the last 30, across the volumes Auto sync follows. */
function noteEvents(rt: Rt, events: journal.JournalEvent[]): void {
  for (const e of events) {
    if (feedSeen.has(e.seq)) continue
    feedSeen.add(e.seq); if (feedSeen.size > 500) feedSeen.delete(feedSeen.values().next().value as string)
    feedRing.push({ ts: e.ts, writer: e.writer, op: e.op, path: e.path ?? e.paths?.[0] ?? e.prefix ?? '', source_pod: e.writer.startsWith('pod:') ? e.writer.slice(4) : '' })
    if (feedRing.length > 30) feedRing.shift()
    if (e.ts) rt.lastEventAt = e.ts
  }
}
export interface WatchView {
  paused: boolean
  pull: { pod_id: string; pod_name: string; volume_id: string; state: 'idle' | 'reconciling' | 'pulling' | 'paused' | 'error'; cursor: string; last_event_at: string; last_reconcile_at: string; next_reconcile_at: string; pending_events: number; pending_paths: number; pending_bytes: number }[]
  push: { pod_id: string; pod_name: string; folders: { path: string; watching: boolean; pending: number }[]; pending_files: number; debounce_ms_left: number; last_change_at: string; last_push_at: string; state: 'idle' | 'watching' | 'waiting' | 'pushing' | 'paused' | 'error' }[]
  events: { ts: string; writer: string; op: string; path: string; source_pod: string }[]
}
/** What the watchers are doing now, from memory only (no listing, no disk but the two tiny settings files). */
export function watch(): WatchView {
  const st = store.loadState(), now = deps.now(), out: WatchView = { paused: st.paused, pull: [], push: [], events: [...feedRing] }
  const iso0 = (ms: number) => (ms ? new Date(ms).toISOString() : '')
  for (const { pod_id, settings } of store.enabledPods()) {
    if (isGone(pod_id)) continue
    const rt = rtOf(pod_id), vol = syncrun.volumeIdFor(pod_id) || rt.item.volume_id
    if (settings.pull) {
      const last = changes.lastReconcile(vol)
      out.pull.push({
        pod_id, pod_name: rt.item.pod_name, volume_id: vol,
        state: st.paused ? 'paused' : rt.item.state === 'error' ? 'error' : changes.reconcilingNow() === vol ? 'reconciling' : rt.item.state === 'syncing' || rt.item.state === 'waiting' || rt.item.state === 'needs_approval' ? 'pulling' : 'idle',
        cursor: st.cursors[`${vol}:${pod_id}`] ?? '', last_event_at: rt.lastEventAt, last_reconcile_at: iso0(last), next_reconcile_at: last && changes.timerOn() ? iso0(last + changes.EVERY_MS) : '',
        pending_events: rt.pendingEvents, pending_paths: rt.pendingPaths, pending_bytes: rt.pendingBytes,
      })
    }
    if (settings.push) {
      const p = pushers.get(pod_id), col = p?.watch.collector, dirs = p?.watch.dirs ?? pushable(deps.pushDirs(pod_id))
      out.push.push({
        pod_id, pod_name: rt.item.pod_name,
        folders: dirs.map((d) => ({ path: d, watching: !!p?.watch.started.includes(d), pending: col?.pendingIn(d) ?? 0 })),
        pending_files: col?.pending ?? 0, debounce_ms_left: col?.msLeft() ?? 0, last_change_at: iso0(col?.lastChangeAt ?? 0), last_push_at: rt.lastPushAt,
        state: st.paused ? 'paused' : rt.item.direction === 'push' && rt.item.state === 'error' ? 'error' : rt.item.direction === 'push' && rt.item.state === 'syncing' ? 'pushing' : (col?.pending ?? 0) > 0 ? 'waiting' : p ? 'watching' : 'idle',
      })
    }
  }
  void now
  return out
}
