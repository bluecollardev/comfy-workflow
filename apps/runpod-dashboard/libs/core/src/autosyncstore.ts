/**
 * What Auto sync keeps on disk (docs/ADR-046), apart from the controller so pods.ts can forget and carry a pod's entry without importing the sync machinery.
 *  autosync.json         the settings per pod id (and per volume under the key volume:<volume_id>): { enabled, pull, push, approved_by, approved_at }   (~/.config/runpod-pod-manager)
 *  autosync-state.json   the controller's small memory: the journal cursor per volume, the open conflicts per pod (capped), the global pause (a few KB)
 *  autosync-manifest.json the last-synced manifest per pod (thousands of entries): ONLY read and written with fs.promises, kept in memory in between
 * ASYNC RULE (ADR-046): the core runs in Electron's main process. The two tiny files above are read and written synchronously on purpose (a few KB, a call per click or per tick);
 * anything that can grow (the manifest) never blocks the event loop. A test (autosync-async.test.ts) fails on readFileSync/writeFileSync anywhere else in the auto-sync files.
 * Both are written atomically (a temp file, then a rename); a corrupt file starts empty. Turning Auto sync ON needs the name of who says yes (it moves data between
 * machines, and keeps doing so); the name and the time are recorded and a History entry is written. Turning it off needs nothing.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bad } from './errors.js'
import * as history from './history.js'
import { autosyncFile, autosyncManifestFile, autosyncStateFile } from './paths.js'
import * as podnames from './podnames.js'

export interface Settings { enabled: boolean; pull: boolean; push: boolean; approved_by: string; approved_at?: string }
export const DEFAULTS: Settings = { enabled: false, pull: true, push: false, approved_by: '' }
/** Shown where Push is described: models/ is never pushed by Auto sync. */
export const PUSH_NOTE = 'Auto sync never pushes models/ (the app already provides the models); the Sync window still can.'
export const NEEDS_NAME = 'Auto sync needs the name of who says yes'

/** What was true of a file at the last sync: here (size, mtime) and on the volume (size, LastModified). The conflict rule compares against it. */
export interface Synced { size: number; mtime: number; remote_size: number; remote_modified: string }
export interface Conflict { path: string; reason: string }
export interface State { paused: boolean; cursors: Record<string, string>; conflicts: Record<string, Conflict[]> }
export const MAX_CONFLICTS = 200, MAX_MANIFEST = 20_000

// ALLOWED SYNC IO (tiny config, a few KB): readJson / writeJson below, used only for autosync.json and autosync-state.json.
function readJson<T>(file: string, fallback: T): T {
  try { if (!existsSync(file)) return fallback; const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : fallback } catch { return fallback }
}
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 })
  renameSync(tmp, file)
}

// ----- the settings -----

const all = (): Record<string, Partial<Settings>> => readJson<Record<string, Partial<Settings>>>(autosyncFile(), {})
const norm = (s: Partial<Settings> | undefined): Settings => ({
  enabled: s?.enabled === true, pull: s?.pull === undefined ? DEFAULTS.pull : s.pull === true, push: s?.push === true,
  approved_by: typeof s?.approved_by === 'string' ? s.approved_by : '', ...(typeof s?.approved_at === 'string' ? { approved_at: s.approved_at } : {}),
})
export const VOLUME_PREFIX = 'volume:'
const isVolumeKey = (k: string) => k.startsWith(VOLUME_PREFIX)
/** pod id -> volume id, filled by the controller (autosync.ts) from the pod list; read synchronously so no caller changes. Memory only. */
let podVolume = new Map<string, string>()
/** Replace the whole map (a successful refresh). */
export const setVolumeMap = (m: Map<string, string>): void => { podVolume = new Map(m) }
/** Note one pod's volume. */
export const setPodVolume = (podId: string, volumeId: string): void => { if (podId && volumeId) podVolume.set(podId, volumeId) }
export const podVolumeOf = (podId: string): string => podVolume.get(podId) ?? ''
export const volumeMap = (): Map<string, string> => new Map(podVolume)

/** A pod's OWN entry only (never the volume's); the defaults when it was never set. */
export const getOwn = (podId: string): Settings => norm(all()[podId])
/** The volume's settings; the defaults (off; Pull on, Push off) when never set. */
export const getVolume = (volumeId: string): Settings => norm(all()[VOLUME_PREFIX + volumeId])
/** Where a pod's effective settings come from: its own enabled entry, else its volume's enabled entry, else its own (off). */
export function via(podId: string): 'pod' | 'volume' {
  if (getOwn(podId).enabled) return 'pod'
  const v = podVolume.get(podId)
  return v && getVolume(v).enabled ? 'volume' : 'pod'
}
/** A pod's effective settings: its own when that is enabled, else its volume's when that is enabled, else its own (default off). */
export const get = (podId: string): Settings => {
  const own = getOwn(podId)
  if (own.enabled) return own
  const v = podVolume.get(podId)
  if (v) { const vs = getVolume(v); if (vs.enabled) return vs }
  return own
}
/** Every pod that has settings stored (volume entries are not pods). */
export const entries = (): Record<string, Settings> => Object.fromEntries(Object.entries(all()).filter(([id]) => !isVolumeKey(id)).map(([id, s]) => [id, norm(s)]))
/** Every volume that has settings stored, by volume id. */
export const volumeEntries = (): Record<string, Settings> => Object.fromEntries(Object.entries(all()).filter(([id]) => isVolumeKey(id)).map(([id, s]) => [id.slice(VOLUME_PREFIX.length), norm(s)]))
/** Pods with Auto sync switched on: those with their own enabled entry, and the pods (from the map) of a volume with an enabled entry; `settings` is the effective ones. */
export const enabledPods = (): { pod_id: string; settings: Settings; via: 'pod' | 'volume' }[] => {
  const out: { pod_id: string; settings: Settings; via: 'pod' | 'volume' }[] = []
  const f = all(), seen = new Set<string>()
  for (const [id, s] of Object.entries(f)) if (!isVolumeKey(id)) { const n = norm(s); if (n.enabled) { out.push({ pod_id: id, settings: n, via: 'pod' }); seen.add(id) } }
  for (const [podId, vol] of podVolume) {
    if (seen.has(podId)) continue
    const vs = norm(f[VOLUME_PREFIX + vol])
    if (vs.enabled) out.push({ pod_id: podId, settings: vs, via: 'volume' })
  }
  return out
}

function save(key: string, before: Settings, input: Partial<Settings>): Settings {
  if (input == null || typeof input !== 'object') throw bad('settings is { enabled, pull, push, approved_by }')
  for (const k of ['enabled', 'pull', 'push'] as const) if (input[k] !== undefined && typeof input[k] !== 'boolean') throw bad(`${k} is true or false`)
  const next: Settings = { ...before, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.pull !== undefined ? { pull: input.pull } : {}), ...(input.push !== undefined ? { push: input.push } : {}) }
  const by = typeof input.approved_by === 'string' ? input.approved_by.trim() : ''
  if (next.enabled) {
    if (!by && !(before.enabled && before.approved_by)) throw bad(NEEDS_NAME)   // a change to one that is already on keeps the yes it was given
    if (by) { next.approved_by = by; next.approved_at = new Date().toISOString() }
  } else if (input.approved_by !== undefined) next.approved_by = by
  return norm(next)
}

/** Save a pod's settings. enabled: true REQUIRES approved_by (400 otherwise); the name and time are recorded, and so is a History entry. enabled: false needs nothing. */
export function set(podId: string, input: Partial<Settings>, now: () => Date = () => new Date()): Settings {
  if (!podId || typeof podId !== 'string') throw bad('Which pod?')
  if (isVolumeKey(podId)) throw bad('Which pod?')
  return write(podId, getOwn(podId), input, now, 'pod', podnames.get(podId) || podId)
}
/** Save a volume's settings (key `volume:<id>`), same rules as a pod's: enabled: true REQUIRES approved_by; the name and time are recorded, and a History entry. */
export function setVolume(volumeId: string, input: Partial<Settings>, now: () => Date = () => new Date()): Settings {
  if (!volumeId || typeof volumeId !== 'string') throw bad('Which volume?')
  return write(VOLUME_PREFIX + volumeId, getVolume(volumeId), input, now, 'volume', volumeId)
}
function write(key: string, before: Settings, input: Partial<Settings>, now: () => Date, area: 'pod' | 'volume', what: string): Settings {
  const stamp = now().toISOString()
  const next = save(key, before, input)
  if (next.enabled && input.approved_by && typeof input.approved_by === 'string' && input.approved_by.trim()) next.approved_at = stamp
  const file = all(); file[key] = norm(next); writeJson(autosyncFile(), file)
  const changed = before.enabled !== next.enabled || (next.enabled && (before.pull !== next.pull || before.push !== next.push))
  if (changed) history.record({ kind: 'change', area, action: next.enabled ? 'auto sync on' : 'auto sync off', what, detail: next.enabled ? `pull ${next.pull ? 'on' : 'off'}, push ${next.push ? 'on' : 'off'}` : undefined, ...(next.enabled ? { approved_by: next.approved_by } : {}) }, now)
  return norm(next)
}
/** Remove a volume's settings. */
export function forgetVolume(volumeId: string): void {
  const f = all(), k = VOLUME_PREFIX + volumeId
  if (k in f) { delete f[k]; writeJson(autosyncFile(), f) }
}

// ----- travelling in a configuration file (docs/ADR-023, ADR-070): the volume entries only, and they ARRIVE OFF -----
const VOLUME_ID = /^[A-Za-z0-9_-]{3,64}$/
/** The auto_sync_volumes section from a file, checked: a bad value is an error that names the volume and the field. Every entry comes out with enabled false (turning it on needs a named yes on this machine); pull, push and the approver's name stay as information. */
export function checkVolumeEntries(v: unknown): { value: Record<string, Settings>; wasOn: string[]; error: string | null } {
  const out: Record<string, Settings> = {}, wasOn: string[] = []
  const fail = (m: string) => ({ value: out, wasOn, error: m })
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('auto_sync_volumes maps a volume id to its settings')
  for (const [id, e] of Object.entries(v as Record<string, unknown>)) {
    if (!VOLUME_ID.test(id)) return fail(`auto_sync_volumes: "${id.slice(0, 40)}" is not a volume id`)
    if (!e || typeof e !== 'object' || Array.isArray(e)) return fail(`auto_sync_volumes.${id} is { enabled, pull, push, approved_by }`)
    const o = e as Record<string, unknown>
    for (const k of ['enabled', 'pull', 'push']) if (o[k] !== undefined && typeof o[k] !== 'boolean') return fail(`auto_sync_volumes.${id}.${k} is true or false`)
    if (o.approved_by !== undefined && (typeof o.approved_by !== 'string' || o.approved_by.length > 80)) return fail(`auto_sync_volumes.${id}.approved_by is a name of at most 80 characters`)
    if (o.enabled === true) wasOn.push(id)
    out[id] = norm({ enabled: false, pull: o.pull as boolean | undefined, push: o.push as boolean | undefined, approved_by: (o.approved_by as string | undefined) ?? '' })
  }
  return { value: out, wasOn, error: null }
}
/** Write imported volume entries (already checked, all off). Other entries in the file stay. */
export function importVolumeEntries(entries: Record<string, Settings>): void {
  const f = all()
  for (const [id, s] of Object.entries(entries)) f[VOLUME_PREFIX + id] = norm({ ...s, enabled: false })
  writeJson(autosyncFile(), f)
  history.record({ kind: 'change', area: 'volume', action: 'auto sync settings imported (off)', what: `${Object.keys(entries).length} volume(s)`, detail: 'they arrive off: turning one on needs a named yes' })
}

// ----- a configuration applies it to the pods it creates -----

/** The Auto sync part of a configuration, applied to a pod just created (pods.create, which covers the queue's pods, Recreate, Retry Later and agents). Best effort: it never fails or slows
 *  the creation. Enabled without a name is skipped with a History warning. `source` says where the yes came from, for the History. Returns whether it was switched on. */
export function applyFromConfig(podId: string, a: { enabled?: boolean; pull?: boolean; push?: boolean; approved_by?: string } | undefined, source = 'configuration'): boolean {
  try {
    if (!a?.enabled) return false
    const by = (a.approved_by ?? '').trim(), what = podnames.get(podId) || podId
    if (!by) { history.record({ kind: 'change', area: 'pod', action: 'auto sync skipped', what, detail: `Auto sync is on in the ${source} but has no name of who says yes: not turned on` }); return false }
    set(podId, { enabled: true, pull: a.pull !== false, push: a.push === true, approved_by: by })
    history.record({ kind: 'change', area: 'pod', action: `auto sync on from ${source}`, what, approved_by: by })
    // the timer and the baseline, loaded on demand (no import cycle with the sync machinery). A pod being created has no outputs of its own yet: a quiet baseline, no catch-up pull.
    void import('./autosync.js').then((m) => { m.start(); return m.catchUp(podId, { baselineOnly: true }) }).catch(() => undefined)
    return true
  } catch { return false }
}

// ----- the controller's memory -----

export const loadState = (): State => {
  const s = readJson<Partial<State>>(autosyncStateFile(), {})
  return { paused: s.paused === true, cursors: s.cursors && typeof s.cursors === 'object' ? s.cursors : {}, conflicts: s.conflicts && typeof s.conflicts === 'object' ? s.conflicts : {} }
}
export const saveState = (s: State): void => writeJson(autosyncStateFile(), s)
/** Change the state under one read and one write. */
export function updateState(fn: (s: State) => void): State { const s = loadState(); fn(s); saveState(s); return s }

// ----- the manifest (async only) -----

type Manifest = Record<string, Record<string, Synced>>
let mCache: { file: string; data: Manifest } | null = null
let mWrite: Promise<void> = Promise.resolve()
async function manifests(): Promise<Manifest> {
  const file = autosyncManifestFile()
  if (mCache?.file === file) return mCache.data
  let data: Manifest = {}
  try { const j = JSON.parse(await readFile(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) data = j } catch { /* none yet, or corrupt: start empty */ }
  mCache = { file, data }
  return data
}
const persist = (): Promise<void> => (mWrite = mWrite.then(async () => {
  if (!mCache) return
  const file = mCache.file, tmp = `${file}.${process.pid}.tmp`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(tmp, JSON.stringify(mCache.data), { mode: 0o600 })
  await rename(tmp, file)
}).catch(() => undefined))
/** A pod's last-synced manifest (path relative to ComfyUI-Shared -> what was true at the last sync). */
export const getManifest = async (podId: string): Promise<Record<string, Synced>> => (await manifests())[podId] ?? {}
/** Merge entries into a pod's manifest (the newest MAX_MANIFEST stay) and write it in the background. */
export async function putManifest(podId: string, entries: Record<string, Synced>): Promise<void> {
  const m = await manifests(), cur = { ...(m[podId] ?? {}), ...entries }
  const keys = Object.keys(cur)
  if (keys.length > MAX_MANIFEST) for (const k of keys.slice(0, keys.length - MAX_MANIFEST)) if (!(k in entries)) delete cur[k]
  m[podId] = cur
  await persist()
}
/** Forget the in-memory copy (tests change the file between cases). */
export const resetMemory = (): void => { mCache = null; podVolume = new Map() }

// ----- the pod's life -----

/** The pod is gone: forget its settings, its manifest and its conflicts (the volume's cursor stays: other pods may read the same feed). */
export function forget(podId: string): void {
  if (isVolumeKey(podId)) return   // a volume entry is not a pod
  podVolume.delete(podId)
  const f = all(); if (podId in f) { delete f[podId]; writeJson(autosyncFile(), f) }
  const s = loadState()
  if (podId in s.conflicts) { delete s.conflicts[podId]; saveState(s) }
  void manifests().then((m) => { if (podId in m) { delete m[podId]; return persist() } }).catch(() => undefined)
}
/** Recreate: the new pod keeps the old pod's settings (and its manifest, which describes the volume both mount). */
export function carry(fromId: string, toId: string): void {
  const f = all()
  if (f[fromId]) { f[toId] = f[fromId]; writeJson(autosyncFile(), f) }
  const s = loadState()
  if (s.conflicts[fromId]) { s.conflicts[toId] = s.conflicts[fromId]; saveState(s) }
  void manifests().then((m) => { if (m[fromId]) { m[toId] = m[fromId]; return persist() } }).catch(() => undefined)
}
