/**
 * The reconciler (docs/ADR-046, phase 1): the safety net under the change journal. It lists a few allowlisted prefixes of a volume over RunPod's S3 API (no pod, no spend),
 * compares LastModified and size with the snapshot it kept last time (~/.config/runpod-pod-manager/volume-snapshots.json) and writes `reconciler` events for what differs.
 * It catches everything that bypassed the journal: ComfyUI's own outputs (there is no pod agent yet), a manual upload, Binc's tools.
 *
 * It never lists the whole volume (ADR-045: that takes minutes): `output/` is listed one level first, then the NEWEST folders (by name, descending) are listed whole until
 * the object cap; `workflows/` and `node-packs/` always; `input/` and `models/` only when a pod's push or pull configuration includes them (`extra`).
 * The first run on a volume only records the baseline (nothing is "created" because it was already there). A folder that was never listed before is a baseline too,
 * unless it is NEW since the last run (not in the level-one listing then): that is a real new output and is reported as created.
 * Deletions are only inferred inside a folder that was listed completely this time.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as journal from './journal.js'
import { volumeSnapshotsFile } from './paths.js'

/** In memory, for the sync explorer: when each volume was last reconciled, and the volume being reconciled right now. */
const lastRun = new Map<string, number>()
let current: string | null = null
export const lastReconcile = (volumeId: string): number => lastRun.get(volumeId) ?? 0
export const reconcilingNow = (): string | null => current

export const ALLOWLIST = ['workflows', 'node-packs'] as const
export const OPTIONAL = ['input', 'models'] as const
export const OBJECT_CAP = 5000, FOLDER_CAP = 25, SCOPE_CAP = 300
export const EVERY_MS = 5 * 60_000, PRUNE_EVERY_MS = 24 * 3600_000

type Files = Record<string, [number, string]>   // path relative to comfy-shared -> [bytes, LastModified as listed]
export interface VolumeSnapshot { at: string; folders: string[]; scopes: Record<string, Files>; pruned_at?: string }

// ASYNC ONLY: a snapshot of tens of thousands of objects is megabytes. It is read and written with fs.promises and never blocks the main process.
async function load(): Promise<Record<string, VolumeSnapshot>> {
  try { const j = JSON.parse(await readFile(volumeSnapshotsFile(), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {} } catch { return {} }
}
async function save(all: Record<string, VolumeSnapshot>): Promise<void> {
  const f = volumeSnapshotsFile()
  await mkdir(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(all), { mode: 0o600 })
  await rename(tmp, f)
}
/** Let the event loop run: loops over big lists work in chunks of CHUNK and yield between them. */
export const CHUNK = 500
export const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

export const snapshot = async (volumeId: string): Promise<VolumeSnapshot | null> => (await load())[volumeId] ?? null
export const forgetSnapshot = async (volumeId: string): Promise<void> => { const all = await load(); if (all[volumeId]) { delete all[volumeId]; await save(all) } }

export interface ReconcileOpts extends journal.JournalOpts { extra?: string[]; objectCap?: number; folderCap?: number }
export interface ReconcileReport { volume_id: string; baseline: boolean; scopes: number; listed: number; events: journal.JournalEvent[]; partial: boolean; skipped?: string }

export interface Row { key: string; bytes: number; modified?: string }
/** `aws s3 ls` of a prefix (one level, or everything under it), parsed in chunks of CHUNK lines with a yield between them: a 50,000-object listing never holds the main process. Read-only. */
export async function listRows(volumeId: string, prefix: string, recursive: boolean, o: journal.JournalOpts = {}): Promise<Row[]> {
  if (!/^[\w .+@=,()/-]{1,300}$/.test(prefix) || prefix.split('/').includes('..') || prefix.startsWith('/')) throw new Error(`Not a path inside the volume: ${prefix}`)
  const a = await journal.access(volumeId, o)
  if (!a) throw new Error('This volume cannot be read over the S3 API.')
  const dir = prefix.replace(/\/+$/, '') + '/'
  const r = await journal.awsCall(a, ['s3', 'ls', `s3://${a.bucket}/${dir}`, ...(recursive ? ['--recursive'] : [])], o)
  if (r.code !== 0) throw new Error(`RunPod's S3 API: ${(r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`}`)
  const lines = r.stdout.split('\n'), out: Row[] = []
  for (let i = 0; i < lines.length; i += CHUNK) {
    for (const line of lines.slice(i, i + CHUNK)) {
      const f = /^(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)\s+(\d+)\s+(.+)$/.exec(line)
      if (f) { out.push({ key: recursive ? f[4] : dir + f[4], bytes: Number(f[3]), modified: `${f[1]}T${f[2]}` }); continue }
      const d = /^\s*PRE\s+(.+\/)$/.exec(line)
      if (d && !recursive) out.push({ key: dir + d[1], bytes: 0 })
    }
    await yieldLoop()
  }
  return out
}

const ROOT = 'comfy-shared/'
const toRel = (key: string) => (key.startsWith(ROOT) ? key.slice(ROOT.length) : key)
const asFiles = async (rows: { key: string; bytes: number; modified?: string }[]): Promise<Files> => {
  const o: Files = {}
  for (let i = 0; i < rows.length; i += CHUNK) { for (const r of rows.slice(i, i + CHUNK)) if (!r.key.endsWith('/')) o[toRel(r.key)] = [r.bytes, r.modified ?? '']; await yieldLoop() }
  return o
}

/** What changed in one scope between the snapshot (`prev`) and the listing (`now`). */
export async function diffScope(prev: Files, now: Files): Promise<{ created: string[]; modified: string[]; deleted: string[] }> {
  const created: string[] = [], modified: string[] = [], deleted: string[] = []
  const nowKeys = Object.keys(now), prevKeys = Object.keys(prev)
  for (let i = 0; i < nowKeys.length; i += CHUNK) {
    for (const p of nowKeys.slice(i, i + CHUNK)) { const v = now[p], o = prev[p]; if (!o) created.push(p); else if (o[0] !== v[0] || o[1] !== v[1]) modified.push(p) }
    await yieldLoop()
  }
  for (let i = 0; i < prevKeys.length; i += CHUNK) { for (const p of prevKeys.slice(i, i + CHUNK)) if (!(p in now)) deleted.push(p); await yieldLoop() }
  return { created: created.sort(), modified: modified.sort(), deleted: deleted.sort() }
}

/** The prefixes (scopes) to list for a volume. */
export const allowlist = (extra: string[] = []): string[] => [...ALLOWLIST, ...OPTIONAL.filter((d) => extra.includes(d))]

/** One reconcile of one volume. Reads only; writes events through the journal and the snapshot file. */
export async function reconcile(volumeId: string, o: ReconcileOpts = {}): Promise<ReconcileReport> {
  const rep: ReconcileReport = { volume_id: volumeId, baseline: false, scopes: 0, listed: 0, events: [], partial: false }
  current = volumeId
  try { return await reconcileInner(volumeId, o, rep) } finally { current = null; lastRun.set(volumeId, (o.now ?? (() => new Date()))().getTime()) }
}
async function reconcileInner(volumeId: string, o: ReconcileOpts, rep: ReconcileReport): Promise<ReconcileReport> {
  if (!(await journal.access(volumeId, o))) return { ...rep, skipped: 'This volume cannot be read over the S3 API (no S3 keys, or its datacenter has none).' }
  const objectCap = o.objectCap ?? OBJECT_CAP, folderCap = o.folderCap ?? FOLDER_CAP
  const all = await load(), prev = all[volumeId], baseline = !prev
  const next: VolumeSnapshot = { at: (o.now ?? (() => new Date()))().toISOString(), folders: [], scopes: { ...(prev?.scopes ?? {}) }, ...(prev?.pruned_at ? { pruned_at: prev.pruned_at } : {}) }
  const found = new Map<string, Files>(), complete = new Set<string>()
  const list = async (prefix: string, recursive: boolean) => {
    const rows = await listRows(volumeId, prefix, recursive, o)
    rep.listed += rows.length
    return rows
  }
  // output/: one level, then the newest folders whole
  const top = await list('comfy-shared/output', false)
  const folders = top.filter((r) => r.key.endsWith('/')).map((r) => r.key.slice(`${ROOT}output/`.length).replace(/\/$/, '')).filter(Boolean)
  next.folders = folders.slice().sort()
  found.set('output/', await asFiles(top.filter((r) => !r.key.endsWith('/')))); complete.add('output/')
  let budget = objectCap
  for (const f of folders.slice().sort().reverse().slice(0, folderCap)) {
    if (budget <= 0) { rep.partial = true; break }
    const rows = await list(`comfy-shared/output/${f}`, true)
    budget -= rows.length
    found.set(`output/${f}/`, await asFiles(rows)); complete.add(`output/${f}/`)
    if (budget < 0) { rep.partial = true; complete.delete(`output/${f}/`) }   // cut off by the cap: its deletions are not believed
  }
  if (folders.length > folderCap) rep.partial = true
  for (const d of allowlist(o.extra)) { const rows = await list(`comfy-shared/${d}`, true); found.set(`${d}/`, await asFiles(rows)); complete.add(`${d}/`) }

  const known = new Set(prev?.folders ?? [])
  const emitted: journal.EventInput[] = []
  for (const [scope, now] of found) {
    const before = prev?.scopes[scope]
    const isOutputFolder = scope.startsWith('output/') && scope !== 'output/'
    if (!before && (baseline || !isOutputFolder || known.has(scope.slice('output/'.length, -1)))) { next.scopes[scope] = now; continue }   // a baseline: nothing is new because it was already there
    const d = await diffScope(before ?? {}, now)
    if (!complete.has(scope)) d.deleted = []
    const sum = (paths: string[]) => paths.reduce((a, p) => a + (now[p]?.[0] ?? before?.[p]?.[0] ?? 0), 0)
    for (const [op, paths] of [['created', d.created], ['modified', d.modified], ['deleted', d.deleted]] as const) {
      if (!paths.length) continue
      emitted.push({ writer: 'reconciler', op, prefix: scope, files: paths.length, bytes: sum(paths), ...(paths.length <= journal.MAX_PATHS ? { paths } : {}) })
    }
    next.scopes[scope] = now
  }
  // an output folder that is gone from the one-level listing is gone for good (S3 has no empty folders): everything it held was deleted
  const present = new Set(folders)
  for (const [scope, before] of Object.entries(prev?.scopes ?? {})) {
    if (!scope.startsWith('output/') || scope === 'output/' || found.has(scope) || present.has(scope.slice('output/'.length, -1))) continue
    const paths = Object.keys(before)
    if (paths.length) emitted.push({ writer: 'reconciler', op: 'deleted', prefix: scope, files: paths.length, bytes: paths.reduce((a, p) => a + before[p][0], 0), ...(paths.length <= journal.MAX_PATHS ? { paths: paths.sort() } : {}) })
    delete next.scopes[scope]
  }
  rep.scopes = found.size
  // keep the snapshot bounded: the newest output folders and the fixed scopes
  const names = Object.keys(next.scopes).sort()
  for (const n of names.slice(0, Math.max(0, names.length - SCOPE_CAP))) if (n.startsWith('output/')) delete next.scopes[n]
  rep.baseline = baseline
  for (const e of emitted) { const w = await journal.emit(volumeId, e, o); if (w) rep.events.push(w) }
  all[volumeId] = next
  await save(all)
  return rep
}

// ----- the timer -----

export interface VolumeWork { volume_id: string; extra?: string[] }
let provider: (() => VolumeWork[]) | null = null
let timer: ReturnType<typeof setInterval> | null = null
export const timerOn = (): boolean => timer !== null
let running = false
let runOpts: ReconcileOpts = {}
export const setOpts = (o: ReconcileOpts | null) => { runOpts = o ?? {} }

/** One pass over the volumes the provider names (each at most once at a time); a failing volume is skipped, never thrown. Prunes each volume's journal about once a day. */
export async function tick(now: () => number = Date.now): Promise<ReconcileReport[]> {
  if (running || !provider) return []
  running = true
  const out: ReconcileReport[] = []
  try {
    for (const w of provider()) {
      try {
        out.push(await reconcile(w.volume_id, { ...runOpts, extra: w.extra }))
        const s = await snapshot(w.volume_id)
        if (s && now() - Date.parse(s.pruned_at ?? '1970-01-01') > PRUNE_EVERY_MS) {
          await journal.prune(w.volume_id, {}, runOpts).catch(() => undefined)
          const all = await load(); if (all[w.volume_id]) { all[w.volume_id].pruned_at = new Date(now()).toISOString(); await save(all) }
        }
      } catch { /* the next pass tries again */ }
    }
  } finally { running = false }
  return out
}
/** Reconcile every 5 minutes while the provider names a volume (idempotent). */
export function start(p: () => VolumeWork[], everyMs = EVERY_MS): void {
  provider = p
  if (timer) return
  timer = setInterval(() => { void tick() }, everyMs)
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
}
export function stop(): void { if (timer) { clearInterval(timer); timer = null } provider = null }
