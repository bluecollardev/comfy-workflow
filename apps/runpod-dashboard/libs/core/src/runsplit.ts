/**
 * Split one element across several pods (ADR-056, "Ranges and splitting one element across pods"): a graph's frame window is cut into contiguous RANGES on chunk boundaries and each range is
 * run on its own pod at the same time, through the ordinary chunked run (`runflows.run` with a `ranges` entry). The numbering of the files is absolute (graphchunks.planRange), so the runs write
 * into one folder without overlapping and meet exactly where one run would have put its seams. When every range has finished the union of the written frame numbers is checked: exactly
 * startNumber .. startNumber + frames - 1, no gap, no repeat.
 *
 * Rules:
 *  - Only the pods the caller names (`pod_ids`) and the pods this job creates are ever used. `exclude_pod_ids` removes pods from the caller's list (another session's pod, a foreign one); a created pod is
 *    always a new one. Nothing is stopped or deleted here: stopping an idle pod afterwards is the caller's.
 *  - A pod is created only when fewer pods than ranges were named, only up to `create` of them (and never past `max_pods` pods in all), as `gpu_count` x `gpu` (default 2 x RTX PRO 4500: 116 GiB for ~50-frame chunks).
 *  - A range that fails is run once more, alone, on the same pod (the frames it wrote are idempotent by file number); a second failure fails the job and says which range.
 *  - The job is in memory and in the running jobs (kind render, progress in ranges); it does not survive a restart of this process (each range's own chunk record does: see reattach.ts).
 * Pure over injected deps: tests pass fake pods.
 */
import { CoreError } from './errors.js'
import * as gc from './graphchunks.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as pods from './pods.js'
import * as runflows from './runflows.js'

export interface SplitRequest {
  /** the graph's panel path, e.g. base_v008/photoreal-013/photoreal-013__f23__base_v008.json */ path: string
  /** running pods on the volume to use; each gets one range */ pod_ids?: string[]
  /** how many ranges (default: one per pod, created ones included) */ parts?: number
  /** pods to leave alone even if listed */ exclude_pod_ids?: string[]
  /** how many new pods this job may create when `pod_ids` has fewer than `parts` (default 0) */ create?: number
  /** the most pods this job uses in all (default 6) */ max_pods?: number
  /** card key for created pods (default rtxpro4500) and GPUs per pod (default 2) */ gpu?: string; gpu_count?: number
  /** frames per unit the range boundaries are aligned to (default 50, the chunk size) */ unit?: number
  approved_by?: string
}
export interface SplitRange { index: number; pod_id: string; pod_name?: string; created: boolean; first: number; last: number; frames: number; state: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; attempts: number; job_id?: string; started_at?: string; finished_at?: string; seconds?: number; error?: string; files?: number }
export interface SplitJob {
  id: string; path: string; state: 'running' | 'done' | 'failed' | 'cancelled'; started_at: string; finished_at?: string
  window?: { first: number; last: number; startNumber: number; frames: number }
  ranges: SplitRange[]
  union?: { ok: boolean; frames: number; expected: number; problem?: string }
  error?: string; log: string[]
}
export interface Deps {
  /** the graph's frame window, read from the UI graph on a pod */ graphWindow: (podId: string, path: string) => Promise<gc.GraphWindow>
  run: (podId: string, paths: string[], o: runflows.RunOpts) => Promise<{ id: string }>
  job: (id: string) => runflows.RunJob | null
  cancelJob: (id: string) => void
  /** a new pod with the card and count; resolves when it is running */ createPod: (o: { name: string; gpu: string; gpu_count: number }) => Promise<{ id: string; name: string }>
  sleep: (ms: number) => Promise<void>; now: () => number; pollMs: number
}
const real = (): Deps => ({
  graphWindow: async (podId, path) => {
    const pod = await pods.get(podId)
    if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: it cannot give the graph's frame window.`)
    const base = pod.web_ui_url.replace(/\/$/, '')
    const x = await fetch(`${base}/api/userdata/${encodeURIComponent(`workflows/${path}`)}`, { signal: AbortSignal.timeout(60_000) })
    if (x.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${x.status} for the graph ${path}`)
    return gc.describeGraph(await x.json())
  },
  run: (podId, paths, o) => runflows.run(podId, paths, o),
  job: (id) => runflows.job(id),
  cancelJob: (id) => { try { runflows.cancel(id) } catch { /* already over */ } },
  createPod: async (o) => {
    const p = await pods.create({ name: o.name, gpu: o.gpu, gpu_count: o.gpu_count })
    for (const until = Date.now() + 15 * 60_000; ; ) {   // a run needs a RUNNING pod: wait for this one (up to 15 minutes)
      await new Promise((r) => setTimeout(r, 15_000))
      try { const q = await pods.get(p.id); if (q.status === 'running' && q.web_ui_url) return { id: q.id, name: q.name } } catch { /* asked again */ }
      if (Date.now() > until) throw new CoreError(504, `pod ${p.id} was created but is not running after 15 minutes`)
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(), pollMs: 20_000,
})
let deps: Deps = real()
export const setDeps = (d: Partial<Deps> | null): void => { deps = d ? { ...deps, ...d } : real() }

const jobs = new Map<string, { job: SplitJob; abort: { stop: boolean } }>()
const view = (j: SplitJob): SplitJob => JSON.parse(JSON.stringify(j))
const iso = (ms: number): string => new Date(ms).toISOString()
const frameNames = (files: runflows.OutputFile[] | undefined): string[] => (files ?? []).filter((f) => f.type === 'output' && /\.\d+\.dpx$/i.test(f.filename)).map((f) => f.filename)

/** The plan, with nothing started: the window, the ranges and which pods they would get (created ones are named `new`). Read-only apart from reading the graph from a named pod. */
export async function plan(req: SplitRequest): Promise<{ window: NonNullable<SplitJob['window']>; ranges: { index: number; pod_id: string; first: number; last: number; frames: number }[]; create: number }> {
  const { pool, toCreate } = pickPods(req)
  if (!pool.length) throw new CoreError(400, 'Name at least one running pod in pod_ids: the graph is read from it.')
  const win = await deps.graphWindow(pool[0], req.path)
  const parts = Math.max(1, Math.min(req.parts ?? pool.length + toCreate, pool.length + toCreate))
  const ranges = gc.splitRanges(win, parts, req.unit)
  return { window: { first: win.first, last: win.last, startNumber: win.startNumber, frames: win.count }, ranges: ranges.map((r, i) => ({ index: i, pod_id: pool[i] ?? 'new', first: r.first, last: r.last, frames: r.last - r.first + 1 })), create: Math.max(0, ranges.length - pool.length) }
}

function pickPods(req: SplitRequest): { pool: string[]; toCreate: number } {
  if (!req.path || typeof req.path !== 'string') throw new CoreError(400, 'path (the graph to split) is required')
  const excl = new Set(req.exclude_pod_ids ?? [])
  const pool = [...new Set((req.pod_ids ?? []).filter((id) => !excl.has(id)))]
  const cap = Math.max(1, Math.floor(req.max_pods ?? 6))
  if (req.parts !== undefined && (!Number.isInteger(req.parts) || req.parts < 1)) throw new CoreError(400, 'parts must be a whole number, 1 or more')
  const want = req.parts ?? pool.length + Math.max(0, Math.floor(req.create ?? 0))
  const have = pool.slice(0, cap)
  const toCreate = Math.max(0, Math.min(Math.floor(req.create ?? 0), want - have.length, cap - have.length))
  if (!have.length && !toCreate) throw new CoreError(400, 'No pod to use: name running pods in pod_ids (not excluded), or allow `create`.')
  return { pool: have, toCreate }
}

/** Start the split. Returns the job at once; follow it with `status`. */
export async function start(req: SplitRequest): Promise<SplitJob> {
  const { pool, toCreate } = pickPods(req)
  if (!pool.length) throw new CoreError(400, 'Name at least one running pod in pod_ids: the graph is read from it before any pod is created.')
  const win = await deps.graphWindow(pool[0], req.path)
  const parts = Math.max(1, Math.min(req.parts ?? pool.length + toCreate, pool.length + toCreate))
  const ranges = gc.splitRanges(win, parts, req.unit)
  const id = `split-${deps.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const job: SplitJob = {
    id, path: req.path, state: 'running', started_at: iso(deps.now()), window: { first: win.first, last: win.last, startNumber: win.startNumber, frames: win.count },
    ranges: ranges.map((r, i) => ({ index: i, pod_id: pool[i] ?? '', created: i >= pool.length, first: r.first, last: r.last, frames: r.last - r.first + 1, state: 'pending' as const, attempts: 0 })), log: [],
  }
  const ctl = { stop: false }
  jobs.set(id, { job, abort: ctl })
  const say = (t: string) => { job.log.push(`${iso(deps.now()).slice(11, 19)} ${t}`); try { history.record({ kind: 'change', area: 'queue', action: 'split run', what: req.path, detail: t } as never) } catch { /* the History never blocks a run */ } }
  say(`split ${req.path}: frames ${win.first}-${win.last} (${win.count}) in ${ranges.length} range${ranges.length === 1 ? '' : 's'}: ${job.ranges.map((r) => `${r.first}-${r.last}`).join(', ')}`)
  const stopTrack = jobsregistry.track({
    id, kind: 'render', trigger: 'manual', origin: 'mcp', label: `split run ${req.path} (${ranges.length} ranges)`, started_at: job.started_at,
    view: () => ({ state: job.state === 'running' ? 'running' : job.state === 'done' ? 'done' : 'failed', terminal: job.state !== 'running', progress: { done: job.ranges.filter((r) => r.state === 'done').length, total: job.ranges.length, unit: 'ranges' } }),
    cancel: () => cancel(id),
  })
  void (async () => {
    try { await execute(job, req, ctl, say, toCreate) } catch (e) { if (job.state === 'running') { job.state = 'failed'; job.error = (e as Error).message; say(`failed: ${job.error}`) } }
    job.finished_at = iso(deps.now()); stopTrack()
  })()
  return view(job)
}

async function execute(job: SplitJob, req: SplitRequest, ctl: { stop: boolean }, say: (t: string) => void, toCreate: number): Promise<void> {
  // 1. the pods of the ranges that have none yet: new ones, all at once
  const made = job.ranges.filter((r) => !r.pod_id)
  if (made.length && toCreate) {
    const n = Math.min(made.length, toCreate), gpu = req.gpu ?? 'rtxpro4500', count = req.gpu_count ?? 2
    say(`creating ${n} pod${n === 1 ? '' : 's'} (${count} x ${gpu})`)
    await Promise.all(made.slice(0, n).map((r) => deps.createPod({ name: `split-${job.id.slice(-4)}-${r.index + 1}`, gpu, gpu_count: count }).then((p) => { r.pod_id = p.id; r.pod_name = p.name; say(`pod ${p.id} created for range ${r.first}-${r.last}`) })))
  }
  const unassigned = job.ranges.filter((r) => !r.pod_id)
  if (unassigned.length) throw new CoreError(409, `${unassigned.length} range${unassigned.length === 1 ? '' : 's'} have no pod (create is ${toCreate}); nothing was started`)
  // 2. every range at once, each with one retry alone
  const written = new Map<number, string[]>()
  await Promise.all(job.ranges.map((r) => runRange(r, req, ctl, say, written)))
  if (ctl.stop) { job.state = 'cancelled'; say('cancelled'); return }
  const failed = job.ranges.filter((r) => r.state !== 'done')
  if (failed.length) throw new CoreError(500, `range ${failed.map((r) => `${r.first}-${r.last} on ${r.pod_id}: ${r.error ?? r.state}`).join('; ')}`)
  // 3. the union of the written frames
  const win = job.window!
  const names = [...written.values()].flat()
  try { gc.checkWritten(names, win.startNumber, win.frames); job.union = { ok: true, frames: names.length, expected: win.frames }; say(`union: ${names.length} of ${win.frames} frames, no gap, no repeat`) } catch (e) {
    job.union = { ok: false, frames: names.length, expected: win.frames, problem: (e as Error).message }
    throw new CoreError(422, `the ranges finished but the frames do not make the element: ${(e as Error).message}`)
  }
  job.state = 'done'
}

async function runRange(r: SplitRange, req: SplitRequest, ctl: { stop: boolean }, say: (t: string) => void, written: Map<number, string[]>): Promise<void> {
  for (r.attempts = 0; r.attempts < 2; ) {
    if (ctl.stop) { r.state = 'cancelled'; return }
    r.attempts++; r.state = 'running'; r.started_at = iso(deps.now()); delete r.error
    let jobId = ''
    try {
      jobId = (await deps.run(r.pod_id, [req.path], { ranges: { [req.path]: { first: r.first, last: r.last } }, ...(req.approved_by ? { approvedBy: req.approved_by } : {}) })).id
      r.job_id = jobId; say(`range ${r.first}-${r.last} started on ${r.pod_id}${r.attempts > 1 ? ' (second try)' : ''}: job ${jobId}`)
      for (;;) {
        if (ctl.stop) { deps.cancelJob(jobId); r.state = 'cancelled'; return }
        const j = deps.job(jobId)
        if (!j) throw new CoreError(500, 'the run job is gone (the process that held it stopped)')
        if (j.state !== 'running') {
          const res = j.results[0]
          if (j.state === 'done' && res && res.state !== 'failed') {
            r.state = 'done'; r.finished_at = iso(deps.now()); r.seconds = Math.round((deps.now() - Date.parse(r.started_at!)) / 100) / 10
            const names = frameNames(res.files); r.files = names.length; written.set(r.index, names)
            say(`range ${r.first}-${r.last} done on ${r.pod_id}: ${names.length} frames in ${r.seconds} s`)
            return
          }
          throw new CoreError(500, res?.error || res?.failure_text || j.error || `the run ${j.state}`)
        }
        await deps.sleep(deps.pollMs)
      }
    } catch (e) {
      r.error = (e as Error).message; r.state = 'failed'; r.finished_at = iso(deps.now())
      say(`range ${r.first}-${r.last} on ${r.pod_id} failed${r.attempts < 2 ? ', run once more alone' : ''}: ${r.error.slice(0, 200)}`)
    }
  }
}

/** One job (by id), or every job, newest first. */
export const status = (id?: string): SplitJob[] => {
  const all = [...jobs.values()].map((x) => view(x.job)).sort((a, b) => b.started_at.localeCompare(a.started_at))
  if (!id) return all
  const one = all.find((j) => j.id === id)
  if (!one) throw new CoreError(404, `No split job ${id}`)
  return [one]
}
/** Stop a split: its range runs are cancelled (frames already written stay). */
export function cancel(id: string): SplitJob {
  const x = jobs.get(id)
  if (!x) throw new CoreError(404, `No split job ${id}`)
  x.abort.stop = true
  for (const r of x.job.ranges) if (r.job_id && (r.state === 'running' || r.state === 'pending')) deps.cancelJob(r.job_id)
  if (x.job.state === 'running') { x.job.state = 'cancelled'; x.job.finished_at = iso(deps.now()) }
  return view(x.job)
}
export const reset = (): void => { jobs.clear() }
