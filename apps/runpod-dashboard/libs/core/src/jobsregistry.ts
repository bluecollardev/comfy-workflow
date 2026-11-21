/**
 * Running jobs, visible across processes (docs/ADR-050, "MCP actions are shown in the Queue"). A job lives in the memory of the process that started
 * it (the app, the stdio MCP server, a script); this keeps a small shared file `jobs-running.json` in the config folder: each owner writes its jobs there
 * (at most every 2 s) and removes them when they finish, and every process MERGES the other processes' live jobs into its own status calls. A job whose
 * owner is dead (no such pid) or silent (no heartbeat for 15 s) is shown once as interrupted and cleaned. A Cancel on a job another process owns is a
 * request written to the same file, which the owner polls. Everything is async; the file is written atomically.
 */
import { hostname } from 'node:os'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './paths.js'

export type Origin = 'window' | 'mcp' | 'auto-publish' | 'backfill' | 'script'
export interface RunningJob {
  id: string; kind: 'render' | 'publish' | 'volume' | 'sync' | 'other'; pid: number; host: string; trigger: string; origin: Origin; mcp_client?: string
  started_at: string; heartbeat_at: string; state: string; progress?: { done: number; total: number; unit?: string }; label: string; approved_by?: string; cancel_requested?: boolean
  /** how far a transfer is, for the other processes' Queue: bytes done and in all, a rate, the file being sent, files already there, the pods carrying it (names only, never a key or a link) */
  transfer?: Transfer
  /** what ComfyUI on the pod says it is doing right now (its websocket events): node, step, percent; small, no secrets */ live?: Live
  /** a render run's own facts for the other processes' Queue: the pod, the element, frames done and in all, chunk k of n, the current frame range */ run?: RunFacts
}
export interface Live { state: 'live' | 'waiting' | 'none'; node?: string; node_class?: string; node_title?: string; step?: number; max?: number; percent?: number; prompt_id?: string; started_at?: string; ts: number; queue_remaining?: number; reason?: string }
export interface RunFacts { pod_id: string; pod_name: string; element: string; path: string; frames_done?: number; frames_total?: number; chunk?: number; chunks?: number; rate_spf?: number }
/** What a heartbeat may carry of the live progress: numbers and short names. */
export function cleanLive(l: Live | undefined): Live | undefined {
  if (!l) return undefined
  const n = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : undefined)
  const t = (x: unknown, m = 80): string | undefined => (typeof x === 'string' && x ? x.slice(0, m) : undefined)
  const st = l.state === 'live' || l.state === 'waiting' ? l.state : 'none'
  return { state: st, ts: n(l.ts) ?? 0, ...(t(l.node, 16) ? { node: t(l.node, 16) } : {}), ...(t(l.node_class) ? { node_class: t(l.node_class) } : {}), ...(t(l.node_title) ? { node_title: t(l.node_title) } : {}), ...(n(l.step) !== undefined ? { step: n(l.step) } : {}), ...(n(l.max) !== undefined ? { max: n(l.max) } : {}), ...(n(l.percent) !== undefined ? { percent: n(l.percent) } : {}), ...(t(l.prompt_id, 64) ? { prompt_id: t(l.prompt_id, 64) } : {}), ...(t(l.started_at, 40) ? { started_at: t(l.started_at, 40) } : {}), ...(n(l.queue_remaining) !== undefined ? { queue_remaining: n(l.queue_remaining) } : {}), ...(t(l.reason, 120) ? { reason: t(l.reason, 120) } : {}) }
}
export function cleanRun(r: RunFacts | undefined): RunFacts | undefined {
  if (!r) return undefined
  const n = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : undefined)
  return { pod_id: String(r.pod_id || '').slice(0, 40), pod_name: String(r.pod_name || '').slice(0, 80), element: String(r.element || '').slice(0, 120), path: String(r.path || '').slice(0, 200), ...(n(r.frames_done) !== undefined ? { frames_done: n(r.frames_done) } : {}), ...(n(r.frames_total) !== undefined ? { frames_total: n(r.frames_total) } : {}), ...(n(r.chunk) !== undefined ? { chunk: n(r.chunk) } : {}), ...(n(r.chunks) !== undefined ? { chunks: n(r.chunks) } : {}), ...(n(r.rate_spf) !== undefined ? { rate_spf: n(r.rate_spf) } : {}) }
}
export interface Transfer { bytes_done: number; bytes_total: number; rate_bps: number; current?: string; skipped?: number; pods?: string[] }
/** What a heartbeat may carry of a transfer: numbers and short names, nothing else. */
export function cleanTransfer(t: Transfer | undefined): Transfer | undefined {
  if (!t) return undefined
  const n = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0)
  return { bytes_done: n(t.bytes_done), bytes_total: n(t.bytes_total), rate_bps: n(t.rate_bps), ...(t.current ? { current: String(t.current).slice(0, 120) } : {}), ...(t.skipped ? { skipped: n(t.skipped) } : {}), ...(t.pods?.length ? { pods: t.pods.slice(0, 8).map((x) => String(x).slice(0, 80)) } : {}) }
}
export interface External extends RunningJob { external: true; interrupted?: boolean }
export interface Deps { now(): number; pid(): number; alive(pid: number): boolean; /** how often a running job writes its heartbeat (and how often the file is re-read) */ heartbeatMs: number }
const defaults = (): Deps => ({ heartbeatMs: HEARTBEAT_MS, now: () => Date.now(), pid: () => process.pid, alive: (pid) => { try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' } } })
export const HEARTBEAT_MS = 2000, STALE_MS = 15_000
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

const file = () => join(configDir(), 'jobs-running.json')
const iso = (ms: number) => new Date(ms).toISOString()
async function read(): Promise<Record<string, RunningJob>> { try { const j = JSON.parse(await readFile(file(), 'utf8')) as { jobs?: Record<string, RunningJob> }; return j && typeof j.jobs === 'object' && j.jobs ? j.jobs : {} } catch { return {} } }
let lock: Promise<unknown> = Promise.resolve()
/** Read, change, write: one at a time in this process (another process's write between two of ours loses at most one heartbeat). */
function mutate(fn: (jobs: Record<string, RunningJob>) => void): Promise<void> {
  const run = lock.then(async () => { const jobs = await read(); fn(jobs); const f = file(), t = `${f}.${deps.pid()}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(t, JSON.stringify({ jobs }), { mode: 0o600 }); await rename(t, f) })
  lock = run.catch(() => undefined); return run
}

interface Tracked { stop: () => void }
const tracked = new Map<string, Tracked>()
/** Start publishing a job of this process. `view()` is read at each heartbeat; `cancel` is called when another process asked for it. Returns `stop`. */
export function track(o: { id: string; kind: RunningJob['kind']; trigger: string; origin: Origin; client?: string; label: string; approved_by?: string; started_at?: string; view: () => { state: string; /** the job is over: stop publishing it */ terminal?: boolean; progress?: RunningJob['progress']; transfer?: Transfer; live?: Live; run?: RunFacts }; cancel: () => void }): () => void {
  const ownerPid = deps.pid()
  const entry = (): RunningJob => { const v = o.view(); return { id: o.id, kind: o.kind, pid: ownerPid, host: hostname(), trigger: o.trigger, origin: o.origin, ...(o.client ? { mcp_client: o.client } : {}), started_at: o.started_at ?? iso(deps.now()), heartbeat_at: iso(deps.now()), state: v.state, ...(v.progress ? { progress: v.progress } : {}), ...(v.transfer ? { transfer: cleanTransfer(v.transfer) } : {}), ...(v.live ? { live: cleanLive(v.live) } : {}), ...(v.run ? { run: cleanRun(v.run) } : {}), label: o.label, ...(o.approved_by ? { approved_by: o.approved_by } : {}) } }
  let stopped = false, busy = false
  const beat = async () => {
    if (stopped || busy) return; busy = true
    try {
      let asked = false
      await mutate((jobs) => { const prev = jobs[o.id]; asked = !!prev?.cancel_requested; jobs[o.id] = entry() })   // the request is consumed: the owner acts on it once
      if (asked) { try { o.cancel() } catch { /* already over */ } }
      if (o.view().terminal) stop()
    } catch { /* the registry is best effort: a failing write never stops a job */ } finally { busy = false }
  }
  void beat()
  const timer = setInterval(() => { void beat() }, deps.heartbeatMs); timer.unref?.()
  const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); tracked.delete(o.id); void mutate((jobs) => { delete jobs[o.id] }).catch(() => undefined) }
  tracked.set(o.id, { stop }); return stop
}

let cache: External[] = [], refreshing: Promise<void> | null = null, refreshedAt = 0
/** Re-read the file (at most every 2 s): the other processes' live jobs, and those that died (once, as interrupted, then removed). */
export function refresh(): Promise<void> {
  if (refreshing) return refreshing
  if (deps.now() - refreshedAt < deps.heartbeatMs && refreshedAt) return Promise.resolve()
  refreshing = (async () => {
    const jobs = await read(), out: External[] = [], gone: string[] = []
    for (const j of Object.values(jobs)) {
      if (j.pid === deps.pid()) continue
      const fresh = deps.now() - Date.parse(j.heartbeat_at) < STALE_MS, alive = deps.alive(j.pid)
      if (alive && fresh) out.push({ ...j, external: true })
      else { out.push({ ...j, state: 'interrupted', external: true, interrupted: true }); gone.push(j.id) }
    }
    if (gone.length) await mutate((all) => { for (const id of gone) if (all[id] && all[id].pid !== deps.pid()) delete all[id] }).catch(() => undefined)
    cache = out; refreshedAt = deps.now()
  })().finally(() => { refreshing = null })
  return refreshing
}
/** The other processes' jobs of a kind, from the last refresh (synchronous, from memory); an interrupted one is returned once. A call also schedules a refresh. */
export function externals(kind?: RunningJob['kind']): External[] {
  void refresh().catch(() => undefined)
  const out = cache.filter((j) => j.pid !== deps.pid() && (!kind || j.kind === kind))
  cache = cache.filter((j) => !j.interrupted)   // shown once
  return out
}
/** Ask the owner of a job in another process to cancel it (it polls the file). True when the job is known to be someone else's. */
export async function requestCancel(id: string): Promise<boolean> {
  let found = false
  await mutate((jobs) => { const j = jobs[id]; if (j && j.pid !== deps.pid()) { j.cancel_requested = true; found = true } })
  return found
}
export const knows = (id: string): boolean => cache.some((j) => j.id === id)
export function reset(): void { for (const t of [...tracked.values()]) t.stop(); tracked.clear(); cache = []; refreshing = null; refreshedAt = 0; setDeps(null) }
