/**
 * The record of a chunked graph run (ADR-056, "Re-attach after a restart"). A chunked run keeps its plan and its loop in the memory of the process that started it, but the prompts it
 * submitted keep running on the pod's ComfyUI. This file lets another process (the app after a restart) pick the run up where it stopped.
 *
 * One small JSON file per run in `<config>/chunk-runs/<job id>__<n>.json`, written atomically after every change of the plan or of a chunk and at least every HEARTBEAT_MS while the run is
 * alive. It holds ids and numbers only: no keys, no URLs with secrets, no graph (the API graph is converted again from the graph on the pod when the run is adopted).
 *
 *  - `begin`   the owner writes and updates its record; `finish` removes it (done or cancelled); `fail` keeps it for diagnosis but it is never adopted.
 *  - `adoptable`  a run whose owner is gone (no such pid, another host, or no heartbeat for STALE_MS) and that has a plan to continue.
 *  - `claim`   one process wins a run: an exclusive lock file (`wx`) next to the record, so two processes never adopt the same run.
 */
import { hostname } from 'node:os'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './paths.js'
import type { Checkpoint } from './autochunk.js'

export const HEARTBEAT_MS = 15_000, STALE_MS = 60_000
export interface Meta { task_id?: string; import_id?: string; client?: string }
export interface ChunkRunRecord {
  version: 1; id: string; job_id: string; pod_id: string; pod_name: string; base_url: string
  /** the graph this record is about, the graphs of its whole run, and where in them it is (the rest of the run follows it) */ path: string; job_paths: string[]; index: number
  meta?: Meta; started_at: string; heartbeat_at: string; owner: { pid: number; host: string }
  state: 'running' | 'failed'; error?: string; adopted_from?: string; checkpoint?: Checkpoint
}
export interface Deps { now(): number; pid(): number; host(): string; alive(pid: number): boolean }
const defaults = (): Deps => ({ now: () => Date.now(), pid: () => process.pid, host: () => hostname(), alive: (pid) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } } })
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null): void => { deps = d ? { ...deps, ...d } : defaults() }

export const dir = (): string => join(configDir(), 'chunk-runs')
const fileOf = (id: string): string => join(dir(), `${id}.json`)
const lockOf = (id: string): string => join(dir(), `${id}.claim`)
const safe = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, '_')
const iso = (ms: number): string => new Date(ms).toISOString()

async function write(rec: ChunkRunRecord): Promise<void> {
  const f = fileOf(rec.id), t = `${f}.${deps.pid()}.tmp`
  await mkdir(dirname(f), { recursive: true }); await writeFile(t, JSON.stringify(rec), { mode: 0o600 }); await rename(t, f)
}
export async function read(id: string): Promise<ChunkRunRecord | null> {
  try { const r = JSON.parse(await readFile(fileOf(id), 'utf8')) as ChunkRunRecord; return r && r.version === 1 && r.id && r.pod_id && r.path ? r : null } catch { return null }
}
/** Every record on disk (a corrupt file is skipped; `corrupt` lists them so the adopter can say so). */
export async function list(): Promise<{ records: ChunkRunRecord[]; corrupt: string[] }> {
  let names: string[] = []
  try { names = (await readdir(dir())).filter((n) => n.endsWith('.json')) } catch { return { records: [], corrupt: [] } }
  const records: ChunkRunRecord[] = [], corrupt: string[] = []
  for (const n of names) { const r = await read(n.replace(/\.json$/, '')); if (r) records.push(r); else corrupt.push(n) }
  return { records, corrupt }
}
export async function remove(id: string): Promise<void> { await rm(fileOf(id), { force: true }).catch(() => undefined); await rm(lockOf(id), { force: true }).catch(() => undefined) }

/** The records this process is writing now: never adopted by itself. */
const live = new Set<string>()
export const isLive = (id: string): boolean => live.has(id)

export interface Writer { id: string; update(cp: Checkpoint): Promise<void>; beat(): Promise<void>; finish(): Promise<void>; fail(error: string): Promise<void> }
/** Start the record of a run. `adoptedFrom` names the record this run continues (it is removed once the new one exists). */
export async function begin(o: { job_id: string; index: number; pod_id: string; pod_name: string; base_url: string; path: string; job_paths: string[]; meta?: Meta; started_at?: string; adopted_from?: string }): Promise<Writer> {
  const id = safe(`${o.job_id}__${o.index}`)
  const rec: ChunkRunRecord = { version: 1, id, job_id: o.job_id, pod_id: o.pod_id, pod_name: o.pod_name, base_url: o.base_url, path: o.path, job_paths: o.job_paths, index: o.index, ...(o.meta ? { meta: o.meta } : {}), started_at: o.started_at ?? iso(deps.now()), heartbeat_at: iso(deps.now()), owner: { pid: deps.pid(), host: deps.host() }, state: 'running', ...(o.adopted_from ? { adopted_from: o.adopted_from } : {}) }
  live.add(id)
  let chain: Promise<void> = Promise.resolve(), over = false
  const save = (): Promise<void> => { chain = chain.then(async () => { if (over) return; rec.heartbeat_at = iso(deps.now()); await write(rec) }).catch(() => undefined); return chain }
  await save()
  return {
    id,
    update: (cp) => { rec.checkpoint = cp; return save() },
    beat: () => save(),
    finish: async () => { over = true; live.delete(id); await chain; await remove(id) },
    fail: async (error) => { await chain; over = true; live.delete(id); rec.state = 'failed'; rec.error = error.slice(0, 500); rec.heartbeat_at = iso(deps.now()); await write(rec).catch(() => undefined) },
  }
}

/** Why a record is not adoptable, or '' when it is. */
export function whyNot(r: ChunkRunRecord): string {
  if (r.state !== 'running') return `the run ${r.state}${r.error ? `: ${r.error}` : ''}`
  if (live.has(r.id)) return 'this process is running it'
  if (!ownerGone(r)) return r.owner.host === deps.host() ? `process ${r.owner.pid} is still running it` : `host ${r.owner.host} is still running it`
  if (!r.checkpoint || r.checkpoint.version !== 1 || !Array.isArray(r.checkpoint.plan) || !r.checkpoint.plan.length) return 'it has no plan yet (the process stopped before the first chunk was planned)'
  return ''
}
export const adoptable = (r: ChunkRunRecord): boolean => whyNot(r) === ''

/** Take a run: an exclusive lock file. A lock whose process is gone (or older than STALE_MS) is stale and replaced once. True when this process holds the run. */
export async function claim(id: string): Promise<boolean> {
  const f = lockOf(id)
  await mkdir(dir(), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await writeFile(f, JSON.stringify({ pid: deps.pid(), host: deps.host(), at: iso(deps.now()) }), { flag: 'wx', mode: 0o600 }); return true } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return false
      let holder: { pid?: number; host?: string } = {}, age = Infinity
      try { holder = JSON.parse(await readFile(f, 'utf8')) as typeof holder; age = deps.now() - (await stat(f)).mtimeMs } catch { /* unreadable: treat as stale */ }
      const mine = holder.host === deps.host() && holder.pid === deps.pid()
      const gone = holder.host === deps.host() && !!holder.pid && !deps.alive(holder.pid)
      if (mine || (!gone && age < STALE_MS * 5)) return false   // this process already holds it (a second pass), or someone else holds it and is alive
      await rm(f, { force: true }).catch(() => undefined)
    }
  }
  return false
}
export const release = (id: string): Promise<void> => rm(lockOf(id), { force: true }).catch(() => undefined)

/** The owner of a record is gone: no such pid on this host, or no heartbeat for STALE_MS (any host), and this process is not the one writing it. */
export function ownerGone(r: ChunkRunRecord): boolean {
  if (live.has(r.id)) return false
  const fresh = deps.now() - Date.parse(r.heartbeat_at) < STALE_MS
  if (r.owner.host === deps.host()) return !(deps.alive(r.owner.pid) && fresh && r.owner.pid !== deps.pid())
  return !fresh
}
/** Close a record as failed (kept for diagnosis, never adopted), without this process becoming its owner. */
export async function markFailed(r: ChunkRunRecord, error: string): Promise<void> {
  await write({ ...r, state: 'failed', error: error.slice(0, 500), heartbeat_at: iso(deps.now()) }).catch(() => undefined)
}
