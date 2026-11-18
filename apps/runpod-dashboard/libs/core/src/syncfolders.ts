/**
 * The folders a push could leave out (docs/ADR-011, "Leaving folders out"): `folders()` lists the top-level directories of each push step's local root so the Sync window can offer them, and
 * `measure()` sizes ONE of them on demand (`du -sk`, spawned, async, 120 s, abortable by an id, cached 5 minutes). Nothing here is recursive or slow on its own: listing is one `readdir` per step.
 * `measure` is path-guarded: the name must be a direct child directory of that step's local root (no slash, no `..`, no symlink out).
 */
import { spawn } from 'node:child_process'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as sync from './sync.js'
import { excluded, folderExcludesFor } from './syncrun.js'

export const FOLDER_CAP = 500, MEASURE_MS = 120_000, CACHE_MS = 5 * 60_000
export interface FolderStep { key: string; local: string; folders: { name: string; bytes: number | null }[]; capped?: boolean; /** the patterns already saved for this step (global + per-folder, de-duplicated) and where each comes from */ saved: string[]; saved_sources: Record<string, 'default' | 'pod' | 'folder'> }

export interface Deps { now(): number; du(path: string, signal: AbortSignal): Promise<number | null> }
const realDu: Deps['du'] = (path, signal) => new Promise((resolve) => {
  const child = spawn('du', ['-sk', path], { stdio: ['ignore', 'pipe', 'ignore'] })   // an argument array: no shell
  let out = ''; child.stdout.on('data', (d) => { out += d })
  const kill = () => child.kill('SIGTERM'); if (signal.aborted) kill(); else signal.addEventListener('abort', kill, { once: true })
  child.on('error', () => resolve(null))
  child.on('close', (code) => { signal.removeEventListener('abort', kill); const kb = Number(/^(\d+)/.exec(out.trim())?.[1]); resolve(code === 0 || Number.isFinite(kb) ? (Number.isFinite(kb) ? kb : null) : null) })
})
let deps: Deps = { now: () => Date.now(), du: realDu }
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : { now: () => Date.now(), du: realDu } }

const cfgOf = (podId: string) => podconfigs.get(podId) ?? mounts.load()
/** The push steps of a pod (project, plates, comfy-shared, workflows) in the order a push runs them, with their local roots; steps whose folder is missing are left out. */
async function stepsOf(podId: string): Promise<sync.Step[]> {
  const steps = sync.orderForRun(sync.plan(cfgOf(podId), new Set(), true))
  const ok: sync.Step[] = []
  for (const st of steps) { try { if ((await lstat(st.local)).isDirectory()) ok.push(st) } catch { /* not there */ } }
  return ok
}

/** The top-level directories of each push step's local root, sorted, at most 500 each: dotfiles, symlinks and what a sync never carries (`sync.EXCLUDE`) are hidden. Sizes are not measured here (bytes: null). */
/** What this core can do, so the Sync window can hide an option an older core lacks. Add a key when a feature lands. */
export const SUPPORTS = { exclude: true, delete_excluded: true, folder_excludes: true, measure: true } as const
export async function folders(o: { pod_id: string }): Promise<{ steps: FolderStep[]; supports: typeof SUPPORTS }> {
  if (!o?.pod_id) throw bad('Which pod?')
  const out: FolderStep[] = []
  for (const st of await stepsOf(o.pod_id)) {
    let entries: import('node:fs').Dirent[] = []
    try { entries = await readdir(st.local, { withFileTypes: true }) } catch { /* unreadable: no folders */ }
    const names = entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith('.') && !excluded(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b))
    const saved: string[] = [], saved_sources: FolderStep['saved_sources'] = {}
    for (const [list, src] of [[podconfigs.get(o.pod_id) ? podconfigs.get(o.pod_id)!.sync_exclude ?? [] : mounts.load().sync_exclude ?? [], podconfigs.get(o.pod_id) ? 'pod' : 'default'], [folderExcludesFor(o.pod_id, st.key), 'folder']] as [string[], 'default' | 'pod' | 'folder'][]) for (const p of list) if (!saved.includes(p)) { saved.push(p); saved_sources[p] = src }
    out.push({ key: st.key, local: st.local, saved, saved_sources, folders: names.slice(0, FOLDER_CAP).map((name) => ({ name, bytes: null })), ...(names.length > FOLDER_CAP ? { capped: true } : {}) })
  }
  return { steps: out, supports: { ...SUPPORTS } }
}

const cache = new Map<string, { at: number; bytes: number }>()
const running = new Map<string, AbortController>()
export const forgetMeasures = () => { cache.clear() }
/** The size of one top-level folder of a step (`du -sk`), cached for 5 minutes. `id` lets `measureCancel` stop it. */
export async function measure(o: { pod_id: string; step: string; name: string; id?: string }): Promise<{ bytes: number; cached?: boolean }> {
  const name = o?.name
  if (typeof name !== 'string' || !name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('\u0000')) throw bad(`Not a folder name: ${String(name).slice(0, 60)}`)
  const st = (await stepsOf(o.pod_id)).find((s) => s.key === o.step)
  if (!st) throw new CoreError(404, `No such step on this PC: ${String(o.step).slice(0, 40)}`)
  const path = join(st.local, name)
  try {
    const l = await lstat(path)
    if (!l.isDirectory() || l.isSymbolicLink()) throw new Error('not a plain folder')
    const root = await realpath(st.local), real = await realpath(path)
    if (!real.startsWith(root + sep)) throw new Error('outside')
  } catch { throw bad(`${name} is not a folder directly inside ${st.local}`) }
  const key = `${st.local}|${name}`, hit = cache.get(key)
  if (hit && deps.now() - hit.at < CACHE_MS) return { bytes: hit.bytes, cached: true }
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), MEASURE_MS)
  if (o.id) running.set(o.id, ac)
  try {
    const kb = await deps.du(path, ac.signal)
    if (ac.signal.aborted) throw new CoreError(499, 'The measurement was cancelled or took too long')
    if (kb === null) throw new CoreError(502, `Could not measure ${name}`)
    const bytes = kb * 1024; cache.set(key, { at: deps.now(), bytes }); return { bytes }
  } finally { clearTimeout(timer); if (o.id) running.delete(o.id) }
}
export function measureCancel(id: string): { cancelled: boolean } { const ac = running.get(id); if (!ac) return { cancelled: false }; ac.abort(); return { cancelled: true } }
