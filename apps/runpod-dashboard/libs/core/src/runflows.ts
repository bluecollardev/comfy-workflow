/**
 * Run workflows (ADR-037): list the graphs in a pod's Workflows panel, and (next) run chosen ones on that pod, logging every error to the history.
 * The panel holds UI graphs; ComfyUI queues only API graphs, so running converts each one first (see ADR-037).
 */
import { CoreError } from './errors.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as podpull from './podpull.js'
import * as shots from './shots.js'
import * as sync from './sync.js'
import * as ui2api from './ui2api.js'

export interface WorkflowFile {
  /** Path under the panel's `workflows/`, e.g. `rounds/brynley-comfy-2026-10-22/cgi-042/cgi-042-common-nodes-v13.json`. */
  path: string
  /** Its folder: the shot or round the graph belongs to (`''` for the top level). */
  group: string
  name: string
  size: number | null
  modified: number | null
}
export interface WorkflowList { pod_id: string; pod_name: string; count: number; workflows: WorkflowFile[] }

/** Not graphs: the inputs manifests ADR-033 writes, and API-format twins (`*_api.json`, `*-api.json`) which are already what ComfyUI queues. */
const isGraphPath = (p: string) => /\.json$/i.test(p) && !/-inputs-manifest\.json$/i.test(p) && !/[-_]api\.json$/i.test(p)

export function toFiles(raw: unknown): WorkflowFile[] {
  const rows = Array.isArray(raw) ? raw : []
  const out: WorkflowFile[] = []
  for (const r of rows) {
    const path = typeof r === 'string' ? r : (r as { path?: string })?.path
    if (!path || !isGraphPath(path)) continue
    const slash = path.lastIndexOf('/')
    const o = typeof r === 'object' ? (r as { size?: number; modified?: number }) : {}
    out.push({ path, group: slash < 0 ? '' : path.slice(0, slash), name: path.slice(slash + 1), size: o.size ?? null, modified: o.modified ?? null })
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
}

/** The graphs in a running pod's Workflows panel (its `comfy-shared/workflows`), grouped by folder. */
export async function list(podId: string, client?: rp.RunPodClient, fetchFn: typeof fetch = fetch): Promise<WorkflowList> {
  const cfg = mounts.load()
  if (mounts.dryRun(cfg)) {
    const w = toFiles([{ path: 'rounds/simulated-round/cgi-042/cgi-042-stereo-v01.json', size: 1000, modified: 0 }, { path: 'rounds/simulated-round/cgi-042/cgi-042-common-nodes-v13.json', size: 2000, modified: 0 }])
    return { pod_id: podId, pod_name: 'simulated', count: w.length, workflows: w }
  }
  const pod = await pods.get(podId, client)
  if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: start it to list its workflows`)
  const base = pod.web_ui_url.replace(/\/$/, '')
  const r = await fetchFn(`${base}/api/userdata?dir=workflows&recurse=true&split=false&full_info=true`, { signal: AbortSignal.timeout(15_000) })
  if (r.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${r.status} listing its workflows`)
  const w = toFiles(await r.json())
  return { pod_id: podId, pod_name: pod.name, count: w.length, workflows: w }
}

// ----- running -----

export interface RunResult { path: string; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; prompt_id?: string; seconds?: number; error?: string; node?: string; outputs?: number }
export interface RunJob {
  id: string; pod_id: string; pod_name: string; state: 'running' | 'done' | 'failed' | 'cancelled'; started_at: string; finished_at?: string
  results: RunResult[]; ok: number; failed: number; error?: string
}
export interface RunOpts {
  client?: rp.RunPodClient; fetchFn?: typeof fetch
  /** How a UI graph becomes an API graph; default: the pod's own Chromium if the image has it, else Chrome on this PC. Tests inject one. */
  convert?: (graph: unknown, ctx: { base: string; podId: string }) => Promise<Record<string, unknown>>
  /** Project root for the locked-shot rule (client-approved shots are never run by us). */
  projectRoot?: string | null
  /** How long one graph may run before the wait gives up (the prompt keeps running on the pod). */
  graphTimeoutS?: number
  pollMs?: number
  approvedBy?: string
}
interface Internal { job: RunJob; abort: AbortController }
const jobs = new Map<string, Internal>()
const view = (i: Internal): RunJob => JSON.parse(JSON.stringify(i.job))
export function job(id: string): RunJob | null { const i = jobs.get(id); return i ? view(i) : null }
export function cancel(id: string): RunJob {
  const i = jobs.get(id); if (!i) throw new CoreError(404, `No such run: ${id}`)
  if (i.job.state === 'running') i.abort.abort()
  return view(i)
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res) => { const t = setTimeout(res, ms); signal.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true }) })

/** The first thing wrong with a rejected prompt, in words: ComfyUI's 400 names the invalid nodes. */
export function describeRejection(body: unknown): { text: string; node?: string } {
  const b = body as { error?: { message?: string; details?: string }; node_errors?: Record<string, { class_type?: string; errors?: { message?: string; details?: string }[] }> }
  const ne = Object.entries(b?.node_errors || {})
  if (ne.length) {
    const [id, e] = ne[0]
    const first = e.errors?.[0]
    return { text: `${b.error?.message || 'Prompt rejected'}: node ${id} (${e.class_type || '?'}): ${first?.message || ''}${first?.details ? ` ${first.details}` : ''}${ne.length > 1 ? ` (and ${ne.length - 1} more node${ne.length > 2 ? 's' : ''})` : ''}`.trim(), node: id }
  }
  return { text: b?.error?.message ? `${b.error.message}${b.error.details ? `: ${b.error.details}` : ''}` : 'ComfyUI rejected the prompt' }
}

/** Read one finished history entry into ok / the failure ComfyUI recorded. */
export function outcomeOf(entry: { status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>?][] }; outputs?: Record<string, unknown> } | undefined): { done: boolean; error?: string; node?: string; outputs: number } | null {
  if (!entry) return null
  const st = entry.status
  const err = (st?.messages || []).find((m) => m[0] === 'execution_error')?.[1] as { exception_message?: string; node_id?: string; node_type?: string } | undefined
  if (st?.status_str === 'error' || err) return { done: true, error: `${err?.exception_message ?? 'The run failed'}${err?.node_type ? ` (node ${err.node_id}, ${err.node_type})` : ''}`.trim(), node: err?.node_id, outputs: 0 }
  if (st?.status_str === 'success' || st?.completed) return { done: true, outputs: Object.keys(entry.outputs || {}).length }
  return null
}

async function runOne(i: Internal, r: RunResult, base: string, o: RunOpts, fetchFn: typeof fetch) {
  const signal = i.abort.signal
  const getJson = async (url: string) => { const x = await fetchFn(url, { signal: AbortSignal.timeout(30_000) }); if (x.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${x.status} for ${url.replace(base, '')}`); return x.json() }
  const ui = await getJson(`${base}/api/userdata/${encodeURIComponent(`workflows/${r.path}`)}`)
  if (!Array.isArray((ui as { nodes?: unknown }).nodes)) throw new CoreError(422, `${r.path} is not a UI graph (it has no nodes list).`)
  const api = await (o.convert ?? defaultConvert)(ui, { base, podId: i.job.pod_id })
  const gate = shots.lockedIn(api, o.projectRoot)
  if (gate.locked.length) throw new CoreError(403, `Refused: the graph names locked shot${gate.locked.length === 1 ? '' : 's'} ${gate.locked.join(', ')}; client-approved shots are never run by us.`)
  const q = await fetchFn(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: api, client_id: 'pod-manager-runflows' }), signal: AbortSignal.timeout(60_000) })
  const qb = await q.json().catch(() => ({}))
  if (q.status !== 200) { const d = describeRejection(qb); r.node = d.node; throw new CoreError(400, d.text) }
  r.prompt_id = (qb as { prompt_id: string }).prompt_id
  const t0 = Date.now(), limit = (o.graphTimeoutS ?? 4 * 3600) * 1000
  for (;;) {
    if (signal.aborted) { await fetchFn(`${base}/interrupt`, { method: 'POST' }).catch(() => {}); throw new CoreError(499, 'cancelled') }
    const h = (await getJson(`${base}/history/${r.prompt_id}`)) as Record<string, Parameters<typeof outcomeOf>[0]>
    const out = outcomeOf(h?.[r.prompt_id])
    if (out) { r.seconds = Math.round((Date.now() - t0) / 100) / 10; r.outputs = out.outputs; r.node = out.node; if (out.error) throw new CoreError(500, out.error); return }
    if (Date.now() - t0 > limit) throw new CoreError(504, `Still running after ${Math.round(limit / 60000)} minutes; it keeps running on the pod (prompt ${r.prompt_id}).`)
    await sleep(o.pollMs ?? 2000, signal)
  }
}

/** Convert on the pod when its image has ui2api (a headless Chromium on the pod), else with Chrome on this PC. Replaced in tests. */
async function defaultConvert(graph: unknown, ctx: { base: string; podId: string }): Promise<Record<string, unknown>> {
  try {
    const raw = await rp.getPod(ctx.podId)
    const { host, port } = sync.sshTarget(raw!)
    const lines: string[] = []
    const { code } = await podpull.runSsh({ host, port, script: ui2api.podScript(graph), onLine: (l) => lines.push(l), signal: new AbortController().signal })
    if (lines.some((l) => l.startsWith('UI2API-'))) return ui2api.parsePodOutput(lines)
    throw new CoreError(501, `The pod has no ui2api (exit ${code}).`)   // an older image: fall back below
  } catch (e) {
    if (e instanceof CoreError && e.status === 502) throw e   // the pod ran it and the graph failed to convert: that is the answer
  }
  return ui2api.browserConverter(ctx.base)(graph)
}

/** Start running the chosen graphs, one after another, on a running pod. Returns the job at once; poll it with `job`. Every graph's outcome (and every error) is written to the History. */
export async function run(podId: string, paths: string[], o: RunOpts = {}): Promise<RunJob> {
  if (!paths.length) throw new CoreError(400, 'Choose at least one workflow to run.')
  for (const p of paths) if (!isGraphPath(p) || p.includes('..') || p.startsWith('/')) throw new CoreError(400, `Not a workflow path: ${p}`)
  const fetchFn = o.fetchFn ?? fetch
  let base = 'http://simulated', podName = 'simulated'
  if (!mounts.dryRun(mounts.load())) {
    const pod = await pods.get(podId, o.client)
    if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: start it to run workflows.`)
    base = pod.web_ui_url.replace(/\/$/, ''); podName = pod.name
  }
  const j: RunJob = { id: `run-${podId}-${Date.now()}`, pod_id: podId, pod_name: podName, state: 'running', started_at: new Date().toISOString(), results: paths.map((path) => ({ path, state: 'pending' })), ok: 0, failed: 0 }
  const i: Internal = { job: j, abort: new AbortController() }
  jobs.set(j.id, i)
  void (async () => {
    for (const r of j.results) {
      if (i.abort.signal.aborted) { r.state = 'skipped'; continue }
      r.state = 'running'
      const t0 = Date.now()
      try {
        if (mounts.dryRun(mounts.load())) { await sleep(o.pollMs ?? 300, i.abort.signal); r.state = 'done'; r.seconds = 0.3; r.outputs = 1 }
        else { await runOne(i, r, base, o, fetchFn); r.state = 'done' }
        j.ok++
      } catch (e) {
        const cancelled = e instanceof CoreError && e.status === 499
        r.state = cancelled ? 'skipped' : 'failed'
        if (!cancelled) { r.error = (e as Error).message; j.failed++ }
        r.seconds ??= Math.round((Date.now() - t0) / 100) / 10
      }
      history.record({ kind: 'job', job: 'run', state: r.state === 'done' ? 'done' : r.state === 'skipped' ? 'cancelled' : 'failed', started_at: new Date(t0).toISOString(), what: r.path, pod_id: podId, pod_name: podName, ...(r.error ? { error: r.error } : {}), detail: `${r.prompt_id ? `prompt ${r.prompt_id}; ` : ''}${r.seconds ?? 0}s${r.node ? `; node ${r.node}` : ''}` })
    }
    j.state = i.abort.signal.aborted ? 'cancelled' : j.failed && !j.ok ? 'failed' : 'done'
    j.finished_at = new Date().toISOString()
  })()
  return view(i)
}
