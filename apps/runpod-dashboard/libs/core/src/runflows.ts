/**
 * Run workflows (ADR-037): list the graphs in a pod's Workflows panel, and (next) run chosen ones on that pod, logging every error to the history.
 * The panel holds UI graphs; ComfyUI queues only API graphs, so running converts each one first (see ADR-037).
 */
import { writtenFiles } from './writers.js'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { configDir } from './paths.js'
import { CoreError } from './errors.js'
import * as history from './history.js'
import * as failures from './failures.js'
import * as mounts from './mounts.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as podpull from './podpull.js'
import * as podmodels from './podmodels.js'
import * as shots from './shots.js'
import * as outputruns from './outputruns.js'
import * as autosync from './autosync.js'
import * as sync from './sync.js'
import * as ui2api from './ui2api.js'
import * as cards from './cards.js'
import * as idle from './idle.js'

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
  // ComfyUI answers 404 "Directory not found" when user/default/workflows does not exist yet (a fresh ComfyUI): that is an empty panel, not a failure.
  if (r.status === 404) return { pod_id: podId, pod_name: pod.name, count: 0, workflows: [] }
  if (r.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${r.status} listing its workflows`)
  const w = toFiles(await r.json())
  return { pod_id: podId, pod_name: pod.name, count: w.length, workflows: w }
}

// ----- the pod's model choice (ADR-042) -----

/** The pod's chosen VAE / diffusion model (empty slots: the graphs keep their own) and the files its ComfyUI offers for each. */
export interface PodModels { pod_id: string; chosen: podmodels.Choice; choices: Record<podmodels.Slot, string[]>; running: boolean }
export async function models(podId: string, client?: rp.RunPodClient, fetchFn: typeof fetch = fetch): Promise<PodModels> {
  const chosen = podmodels.effective(podId)
  if (mounts.dryRun(mounts.load())) return { pod_id: podId, chosen, running: true, choices: { vae: ['simulated_vae.safetensors', 'ae.safetensors'], diffusion_model: ['simulated_model_fp16.safetensors'] } }
  const pod = await pods.get(podId, client)
  if (pod.status !== 'running' || !pod.web_ui_url) return { pod_id: podId, chosen, running: false, choices: { vae: [], diffusion_model: [] } }
  return { pod_id: podId, chosen, running: true, choices: await podmodels.choices(pod.web_ui_url.replace(/\/$/, ''), fetchFn) }
}
/** Choose the pod's files: a slot with a name sets it, an empty one clears it. Our side only, no spend. */
export const setModels = (podId: string, choice: podmodels.Choice): podmodels.Choice => podmodels.set(podId, choice)

// ----- running -----

/** One file a run produced, as ComfyUI's history names it: fetched with GET /view?filename=&subfolder=&type=. `output` is a saved result, `temp` a preview node's file. */
export interface OutputFile { filename: string; subfolder: string; type: 'output' | 'temp'; kind: 'image' | 'video' | 'audio' | 'other'; node?: string }
export interface RunResult { /** the pod ran out of memory on this graph (container killed, or a memory error): trying again on the same card cannot help; the queue retries on a bigger one */ oom?: boolean; /** what kind of failure it was: oom, restart, transient, graph */ failure_kind?: string; /** when a transient failure will be tried again */ retry_at?: string; /** the failure in words: stage, node, message, missing models, recovery, retryable (what the MCP shows) */ failure_text?: string; /** what to do about it, whether trying again can help, the model files it is missing and the node's type (from the failures log) */ recovery?: string; retryable?: boolean; missing_models?: failures.MissingModel[]; node_type?: string; /** where it failed (load, validate, queue, execute): kept for the failures log */ stage?: failures.Stage; /** when this graph started (ISO), for its elapsed time */ started_at?: string; /** the model files the pod's choice put into this graph, and what was left alone */ models?: string[]; path: string; state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; prompt_id?: string; seconds?: number; error?: string; node?: string; outputs?: number; files?: OutputFile[] }
export interface RunJob {
  id: string; pod_id: string; pod_name: string; /** the pod's ComfyUI address: where each result's files are fetched (GET /view) */ base_url?: string; state: 'running' | 'done' | 'failed' | 'cancelled'; started_at: string; finished_at?: string
  results: RunResult[]; ok: number; failed: number; error?: string
  /** One line per step, newest last (at most 500): what the window's log shows and the MCP returns. */ log: LogLine[]
}
export interface LogLine { ts: string; level: 'info' | 'warn' | 'error'; text: string; /** the graph it is about; none for the run as a whole */ path?: string }
export interface RunOpts {
  /** waits before the retries of a transient failure (default 5 then 20 minutes); tests pass short ones */ backoffMs?: number[]
  /** how long to wait for a starting ComfyUI to answer before the first graph (default 5 minutes), and how often to ask (default 5 s) */ waitComfyMs?: number; pollComfyMs?: number; /** how many times to try the graph conversion (default 8) and the wait between tries (default 30 s) */ convertTries?: number; convertWaitMs?: number; /** the graph fetch: tries (default 3), the first wait for an answer (default 60 s, longer each try) and the pause between tries (default 10 s) */ fetchTries?: number; fetchTimeoutMs?: number; fetchWaitMs?: number
  /** a graph that neither runs nor is in the queue for this long has stalled (default 10 minutes) */ stallMs?: number
  /** how long ComfyUI may stay silent (a restart, a busy proxy) while a graph runs before the graph is failed (default 3 minutes): the poll asks again meanwhile */ outageMs?: number
  /** the pod's own log lines since a time (RunPod's system log: `triggered memory limits (OOM)`), to tell an out-of-memory kill from a plain 5xx; tests inject one */ oomEvidence?: (podId: string, sinceIso: string) => Promise<string[]>
  /** which try this is (1 = the first; a retry of a failure passes the next) */ attempt?: number
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
idle.addBusyCheck((podId) => [...jobs.values()].some((i) => i.job.pod_id === podId && i.job.state === 'running'))   // a pod with a run on it is working, whether or not ComfyUI answers the idle probe in time
const view = (i: Internal): RunJob => JSON.parse(JSON.stringify(i.job))
const LOG_MAX = 500
function note(i: Internal, text: string, path?: string, level: LogLine['level'] = 'info') {
  const log = i.job.log; log.push({ ts: new Date().toISOString(), level, text, ...(path ? { path } : {}) })
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
}
export function job(id: string): RunJob | null { const i = jobs.get(id); return i ? view(i) : null }
/** The pod's current run: the one still running, else the newest. Lets the window find its run again after it was closed (the jobs live here, in the core, not in the window). */
export function latest(podId: string): RunJob | null {
  let best: Internal | null = null
  for (const i of jobs.values()) {
    if (i.job.pod_id !== podId) continue
    if (!best || (i.job.state === 'running') > (best.job.state === 'running') || ((i.job.state === 'running') === (best.job.state === 'running') && i.job.started_at >= best.job.started_at)) best = i
  }
  return best ? view(best) : null
}
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

const KIND_BY_EXT: Record<string, OutputFile['kind']> = { png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image', mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', wav: 'audio', mp3: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio' }
export const kindOf = (filename: string): OutputFile['kind'] => KIND_BY_EXT[(filename.split('.').pop() || '').toLowerCase()] ?? 'other'
/** The files a finished run produced: every item with a filename under a node's outputs (images, gifs, videos, audio, files), the saved ones first. The `input` echoes of a loader node are the source media, not a result, and are left out. */
export function filesOf(outputs: Record<string, unknown> | undefined, api?: unknown): OutputFile[] {
  const out: OutputFile[] = []
  for (const [node, v] of Object.entries(outputs || {})) {
    if (!v || typeof v !== 'object') continue
    for (const list of Object.values(v as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      for (const it of list as { filename?: unknown; subfolder?: unknown; type?: unknown }[]) {
        if (!it || typeof it !== 'object' || typeof it.filename !== 'string') continue
        const type = it.type === 'temp' ? 'temp' : it.type === 'output' ? 'output' : null
        if (!type) continue
        out.push({ filename: it.filename, subfolder: typeof it.subfolder === 'string' ? it.subfolder : '', type, kind: kindOf(it.filename), node })
      }
    }
  }
  for (const w of writtenFiles(outputs, api)) if (!out.some((f) => f.filename === w.filename && f.subfolder === w.subfolder)) out.push({ filename: w.filename, subfolder: w.subfolder, type: 'output', kind: kindOf(w.filename), node: w.node })   // a writer that reports only its first file and a count (writers.ts)
  return out.sort((a, b) => Number(a.type === 'temp') - Number(b.type === 'temp'))
}

/** Read one finished history entry into ok / the failure ComfyUI recorded. */
export function outcomeOf(entry: { status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>?][] }; outputs?: Record<string, unknown>; prompt?: unknown[] } | undefined): { done: boolean; error?: string; node?: string; outputs: number; files?: OutputFile[] } | null {
  if (!entry) return null
  const st = entry.status
  const err = (st?.messages || []).find((m) => m[0] === 'execution_error')?.[1] as { exception_message?: string; node_id?: string; node_type?: string } | undefined
  if (st?.status_str === 'error' || err) return { done: true, error: `${err?.exception_message ?? 'The run failed'}${err?.node_type ? ` (node ${err.node_id}, ${err.node_type})` : ''}`.trim(), node: err?.node_id, outputs: 0 }
  if (st?.status_str === 'success' || st?.completed) return { done: true, outputs: Object.keys(entry.outputs || {}).length, files: filesOf(entry.outputs, entry.prompt?.[2]) }
  return null
}

/** A panel graph as an API graph ready to queue: fetched from the pod, converted, the pod's model choice applied, the locked-shot rule checked. */
export async function apiGraph(podId: string, path: string, base: string, o: RunOpts, fetchFn: typeof fetch): Promise<{ api: Record<string, unknown>; models?: string[] }> {
  // a ComfyUI that is busy or still loading can take longer than 30 s to hand over a 40 KB graph: ask again (up to 3 times, the wait growing) before the graph is failed with "The operation was aborted due to timeout"
  const getJson = async (url: string) => {
    for (let k = 1; ; k++) {
      try { const x = await fetchFn(url, { signal: AbortSignal.timeout((o.fetchTimeoutMs ?? 60_000) * k) }); if (x.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${x.status} for ${url.replace(base, '')}`); return await x.json() } catch (e) {
        if (k >= (o.fetchTries ?? 6) || !/aborted|timeout|timed out|fetch failed|ECONN|answered HTTP (404|502|503|504)/i.test((e as Error).message)) throw e   // a cold pod answers 502/404 while ComfyUI and its workflow files come up: ask again
        await new Promise((r) => setTimeout(r, o.fetchWaitMs ?? 20_000))
      }
    }
  }
  const ui = await getJson(`${base}/api/userdata/${encodeURIComponent(`workflows/${path}`)}`)
  if (!Array.isArray((ui as { nodes?: unknown }).nodes)) throw new CoreError(422, `${path} is not a UI graph (it has no nodes list).`)
  // a fresh pod's ComfyUI page may need more than the converter's own 60 s to come up (Page.wait_for_function: Timeout): try the conversion again, a few times, before the graph is failed
  let api: Record<string, unknown> = {}, tries = 0
  for (;;) {
    try { api = await (o.convert ?? defaultConvert)(ui, { base, podId }); break } catch (e) {
      tries++; if (tries >= (o.convertTries ?? 8) || !/wait_for_function|Timeout \d+ms exceeded|net::ERR|Target (page|closed)/i.test((e as Error).message)) throw e
      await new Promise((r) => setTimeout(r, o.convertWaitMs ?? 20_000))
    }
  }
  const chosen = podmodels.apply(api, podmodels.effective(podId))   // the pod's own VAE / diffusion model (ADR-042)
  const models = chosen.applied.length || chosen.skipped.length ? [...chosen.applied.map((a) => `${a.slot}: ${a.to} (was ${a.from || 'unset'})`), ...chosen.skipped] : undefined
  const gate = shots.lockedIn(api, o.projectRoot)
  if (gate.locked.length) throw new CoreError(403, `Refused: the graph names locked shot${gate.locked.length === 1 ? '' : 's'} ${gate.locked.join(', ')}; client-approved shots are never run by us.`)
  return { api, models }
}

/** The pod's own log lines (RunPod's system log and the container's) since `sinceIso`, read for a few seconds: where "triggered memory limits (OOM)" and "exit code 137" show up when the container is killed. Never throws. */
const defaultEvidence = (client?: rp.RunPodClient) => async (podId: string, sinceIso: string): Promise<string[]> => {
  const out: string[] = [], since = Date.parse(sinceIso) || 0, ac = new AbortController(), t = setTimeout(() => ac.abort(), 12_000)
  try { await pods.logs(podId, { tail: 600 }, (e) => { const at = Date.parse(e.ts); if (!Number.isFinite(at) || at >= since - 60_000) out.push(`${e.ts} ${e.line}`) }, ac.signal, client) } catch { /* what arrived is kept */ } finally { clearTimeout(t) }
  return out
}

// ----- how long a graph took last time (its hard time limit is 3x that), kept in the config folder -----
const durFile = () => join(configDir(), 'graph-durations.json')
let durations: Map<string, number> | null = null
async function loadDurations(): Promise<Map<string, number>> { if (durations) return durations; durations = new Map(); try { for (const [k, v] of Object.entries(JSON.parse(await readFile(durFile(), 'utf8')) as Record<string, number>)) if (typeof v === 'number' && v > 0) durations.set(k, v) } catch { /* none yet */ } return durations }
const graphSeconds = async (path: string): Promise<number | null> => (await loadDurations()).get(path) ?? null
async function rememberSeconds(path: string, seconds: number): Promise<void> { try { const m = await loadDurations(); m.set(path, Math.max(0.01, seconds)); const f = durFile(), t = `${f}.${process.pid}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(t, JSON.stringify(Object.fromEntries(m))); await rename(t, f) } catch { /* a missing record only makes the limit 2 hours */ } }
export const resetDurations = (): void => { durations = null }
async function runOne(i: Internal, r: RunResult, base: string, o: RunOpts, fetchFn: typeof fetch) {
  const signal = i.abort.signal
  const getJson = async (url: string) => { const x = await fetchFn(url, { signal: AbortSignal.timeout(30_000) }); if (x.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${x.status} for ${url.replace(base, '')}`); return x.json() }
  note(i, 'Converting the graph to an API graph', r.path); r.stage = 'load'
  const { api, models } = await apiGraph(i.job.pod_id, r.path, base, o, fetchFn)
  if (models) { r.models = models; note(i, `Pod models applied: ${models.join('; ')}`, r.path) }
  r.stage = 'queue'
  const q = await fetchFn(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: api, client_id: 'pod-manager-runflows', extra_data: { pod_manager: { workflow: r.path } } }), signal: AbortSignal.timeout(60_000) })
  const qb = await q.json().catch(() => ({}))
  if (q.status !== 200) { const d = describeRejection(qb); r.node = d.node; if (q.status === 400) r.stage = 'validate'; throw new CoreError(q.status === 400 ? 400 : 502, q.status === 400 ? d.text : `ComfyUI answered HTTP ${q.status} for /prompt: ${d.text}`) }   // a 400 names the invalid nodes: the graph is wrong; any other answer is the pod
  r.prompt_id = (qb as { prompt_id: string }).prompt_id
  note(i, `Queued on the pod as prompt ${r.prompt_id}`, r.path); r.stage = 'execute'
  const t0 = Date.now(), prev = await graphSeconds(r.path), limit = o.graphTimeoutS !== undefined ? o.graphTimeoutS * 1000 : prev ? Math.max(1000, Math.round(3 * prev * 1000)) : 2 * 3600 * 1000, stallMs = o.stallMs ?? 10 * 60_000   // a hard limit: 3x the last successful run of this graph, else 2 hours
  let beat = t0, lastAlive = t0, outageAt = 0, wasDown = false
  for (;;) {
    if (signal.aborted) { await fetchFn(`${base}/interrupt`, { method: 'POST' }).catch(() => {}); throw new CoreError(499, 'cancelled') }
    // a heavy graph keeps ComfyUI so busy that a poll can time out, and a crash makes the proxy answer 502 until the container is back: neither is the end of the graph. Ask again for up to `outageMs`.
    let h: Record<string, Parameters<typeof outcomeOf>[0]> = {}
    try { h = (await getJson(`${base}/history/${r.prompt_id}`)) as typeof h; if (outageAt) { outageAt = 0; wasDown = true } } catch (e) {
      if (signal.aborted) throw e
      outageAt ||= Date.now()
      if (Date.now() - outageAt > (o.outageMs ?? 180_000)) throw new CoreError(502, `ComfyUI stopped answering for ${Math.round((Date.now() - outageAt) / 1000)} s while the graph ran (${(e as Error).message}); the pod's container was probably killed or restarted (its system log says why).`)
      if (Date.now() - beat >= 30_000) { beat = Date.now(); note(i, `ComfyUI does not answer (${(e as Error).message}): asking again`, r.path, 'warn') }
      await sleep(o.pollMs ?? 2000, signal); continue
    }
    const out = outcomeOf(h?.[r.prompt_id])
    if (out) { r.seconds = Math.round((Date.now() - t0) / 100) / 10; r.outputs = out.outputs; r.files = out.files; r.node = out.node; if (out.error) throw new CoreError(500, out.error); void rememberSeconds(r.path, r.seconds); try { autosync.notifyOutputs(i.job.pod_id, null, out.files ?? []) } catch { /* Auto sync never fails a run */ }; void outputruns.ctxFor(i.job.pod_id, o.client).then((ctx) => outputruns.record(ctx, [{ prompt_id: r.prompt_id!, status: 'success', workflow: r.path, started_at: new Date(t0).toISOString(), duration_s: r.seconds, outputs: (out.files || []).map((f) => ({ filename: f.filename, subfolder: f.subfolder, type: f.type })) }]))   // saved outputs
    note(i, `Finished in ${r.seconds} s, ${out.outputs} output${out.outputs === 1 ? '' : 's'}`, r.path); return }
    // ComfyUI answered again after a silence and has no record of the prompt: it restarted and the graph is lost (history and queue live in its memory). Say so now, not after ten minutes of stall.
    if (wasDown) {
      wasDown = false
      try { const qq = (await getJson(`${base}/queue`)) as { queue_running?: unknown[][]; queue_pending?: unknown[][] }; const held = [...(qq.queue_running ?? []), ...(qq.queue_pending ?? [])].some((e) => e?.[1] === r.prompt_id); if (!held && !outcomeOf(h?.[r.prompt_id])) throw new CoreError(502, `ComfyUI restarted while the graph ran: prompt ${r.prompt_id} is gone (the pod's container was killed or restarted; its system log says why).`) } catch (e) { if (e instanceof CoreError && /restarted while/.test(e.message)) throw e }
    }
    // a stall: the pod's queue no longer holds the prompt and ComfyUI has no result for it, for ten minutes
    try { const qq = (await getJson(`${base}/queue`)) as { queue_running?: unknown[][]; queue_pending?: unknown[][] }; const held = [...(qq.queue_running ?? []), ...(qq.queue_pending ?? [])].some((e) => e?.[1] === r.prompt_id); if (held) lastAlive = Date.now() } catch { lastAlive = Date.now() }   // no answer: not proof of a stall
    if (Date.now() - lastAlive > stallMs) throw new CoreError(504, `Stalled: prompt ${r.prompt_id} is neither running nor queued on the pod and has no result after ${Math.round(stallMs / 60000)} minutes (the pod may have restarted).`)
    if (Date.now() - beat >= 30_000) { beat = Date.now(); note(i, `Still running: ${Math.round((beat - t0) / 1000)} s`, r.path) }
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
  const j: RunJob = { id: `run-${podId}-${Date.now()}`, pod_id: podId, pod_name: podName, base_url: base, state: 'running', started_at: new Date().toISOString(), results: paths.map((path) => ({ path, state: 'pending' })), ok: 0, failed: 0, log: [] }
  const i: Internal = { job: j, abort: new AbortController() }
  jobs.set(j.id, i)
  note(i, `Run started: ${paths.length} workflow${paths.length === 1 ? '' : 's'} on ${podName}`)
  void (async () => {
    // fail fast and continue (docs/ADR-050): a graph or validation error fails at once and is never retried; a transient cause (pod stopped, network, 5xx) is
    // retried at most twice, 5 then 20 minutes later, AFTER the other graphs (a failed graph never blocks the next); three graphs in a row failing for the same cause pause the dispatch once.
    // a fresh pod's ComfyUI answers 502 (or does not answer) for a minute or two after the pod is "ready", and again for a minute after its container was killed and restarted in the middle of a run:
    // wait for it before EVERY graph (up to 5 minutes each), instead of failing the graph with the proxy's 502
    const waitComfy = async (): Promise<void> => {
      const until = Date.now() + (o.waitComfyMs ?? 300_000); let first = true
      for (;;) {
        let down = false
        try { const rs = await fetchFn(`${base}/system_stats`, { signal: AbortSignal.timeout(8_000) }); down = rs.status === 502 || rs.status === 503 || rs.status === 504 } catch { down = false }   // only the proxy's own 502, 503 or 504 means "still starting"; anything else goes on
        if (!down || i.abort.signal.aborted || Date.now() > until) break
        if (first) { note(i, 'ComfyUI is not answering on the pod (starting or restarted): waiting for it'); first = false }
        await new Promise((r) => setTimeout(r, o.pollComfyMs ?? 5_000))
      }
    }
    const backoff = o.backoffMs ?? [5 * 60_000, 20 * 60_000], later: { r: RunResult; at: number; attempt: number }[] = []
    let streak: { sig: string; graphs: string[] } = { sig: '', graphs: [] }, paused = false
    const exec = async (r: RunResult, label: string, attempt: number): Promise<void> => {
      await waitComfy()
      r.state = 'running'; r.started_at = new Date().toISOString()
      note(i, label, r.path)
      const t0 = Date.now()
      try {
        if (mounts.dryRun(mounts.load())) { await sleep(o.pollMs ?? 300, i.abort.signal); r.state = 'done'; r.seconds = 0.3; r.outputs = 1; r.files = [{ filename: 'simulated_00001_.png', subfolder: '', type: 'output', kind: 'image', node: '9' }] }
        else { await runOne(i, r, base, o, fetchFn); r.state = 'done' }
        j.ok++
      } catch (e) {
        const cancelled = e instanceof CoreError && e.status === 499
        r.state = cancelled ? 'skipped' : 'failed'
        if (!cancelled) {
          r.error = (e as Error).message; j.failed++; note(i, `Failed${r.node ? ` at node ${r.node}` : ''}: ${r.error}`, r.path, 'error')
          const nt = /\(node (\S+), ([^)]+)\)/.exec(r.error) ?? /node (\S+) \(([^)]+)\)/.exec(r.error); const stage = r.stage ?? 'load'
          const rec = failures.record({ stage, message: r.error, job_id: j.id, graph: r.path, pod_id: podId, pod_name: podName, node_id: r.node ?? nt?.[1] ?? '', node_type: nt?.[2] ?? '', log_tail: j.log.slice(-20).map((l) => l.text), quiet: true, attempt })
          r.recovery = rec.recovery; r.retryable = rec.retryable; r.missing_models = rec.missing_models; r.node_type = rec.node_type; r.failure_text = failures.describe(rec)
          // 5xx, a timeout or a restart on a heavy graph is usually the container being killed for memory: ask the pod's own log, so the failure says so and is not retried on the same card
          if (/\b5\d\d\b|aborted due to timeout|stopped answering|restarted while|ECONN|fetch failed|out of memory|OutOfMemory|\bOOM\b/i.test(r.error)) {
            const lines = await (o.oomEvidence ?? defaultEvidence(o.client))(podId, j.started_at).catch(() => [] as string[])
            const c = cards.classify({ message: r.error, podLog: lines }); r.failure_kind = c.kind
            if (c.kind === 'oom') {
              r.oom = true; r.retryable = false
              r.recovery = `Out of memory (${c.why}). The same card would fail again, so it is not retried here: the queue retries it on a bigger card (cards.escalate).`
              r.failure_text = `${r.failure_text}\nkind: out of memory\nrecovery: ${r.recovery}`
              note(i, `Out of memory: ${c.why}`, r.path, 'error')
            }
          }
        } else note(i, 'Cancelled: the running graph was interrupted', r.path, 'warn')
        r.seconds ??= Math.round((Date.now() - t0) / 100) / 10
      }
      try { history.record({ kind: 'job', job: 'run', state: r.state === 'done' ? 'done' : r.state === 'skipped' ? 'cancelled' : 'failed', started_at: new Date(t0).toISOString(), what: r.path, pod_id: podId, pod_name: podName, ...(r.error ? { error: r.error } : {}), detail: `${r.prompt_id ? `prompt ${r.prompt_id}; ` : ''}${r.seconds ?? 0}s${r.node ? `; node ${r.node}` : ''}` }) } catch { /* the History could not be written: the run goes on */ }

      if (r.state === 'done') streak = { sig: '', graphs: [] }
      else if (r.state === 'failed') {
        const rec = failures.classify(r.stage ?? 'load', r.error ?? ''), sig = `${r.stage ?? 'load'}:${(r.error ?? '').replace(/\b[0-9a-f]{6,}\b|\d+|node \S+/gi, '#').slice(0, 80)}`
        if (rec.retryable && !r.oom && attempt <= backoff.length) { r.retry_at = new Date(Date.now() + backoff[attempt - 1]).toISOString(); later.push({ r, at: Date.now() + backoff[attempt - 1], attempt: attempt + 1 }); note(i, `Will be tried again at ${r.retry_at} (attempt ${attempt + 1} of ${backoff.length + 1}): a transient cause`, r.path, 'warn') }
        streak = streak.sig === sig && !streak.graphs.includes(r.path) ? { sig, graphs: [...streak.graphs, r.path] } : { sig, graphs: [r.path] }
        if (streak.graphs.length >= 3 && !paused) {
          paused = true; const why = `Dispatch paused: ${streak.graphs.length} graphs in a row (${streak.graphs.join(', ')}) failed with the same cause: ${(r.error ?? '').slice(0, 200)}`
          note(i, why, undefined, 'error')
          try { history.record({ kind: 'job', job: 'run', state: 'failed', what: 'dispatch paused', pod_id: podId, pod_name: podName, error: why.slice(0, 500), detail: 'three graphs failed for the same cause; the rest of this run was not started' }) } catch { /* never breaks a run */ }
          void (async () => { try { const pub = await import('./publish.js'); await pub.notifySlack(`*RunPod Manager: dispatch paused*\n${why}`) } catch { /* Slack is not connected */ } })()
        }
      }
    }
    let k = 0
    for (const r of j.results) {
      k++
      if (paused) { r.state = 'skipped'; r.error = 'Not started: dispatch was paused after three graphs failed for the same cause'; note(i, 'Skipped (dispatch paused)', r.path, 'warn'); continue }
      if (i.abort.signal.aborted) { r.state = 'skipped'; note(i, 'Skipped (cancelled)', r.path, 'warn'); continue }
      await exec(r, `Starting ${k} of ${paths.length}`, o.attempt ?? 1)
    }
    while (later.length && !paused && !i.abort.signal.aborted) {
      later.sort((a, b) => a.at - b.at); const n = later.shift()!
      await sleep(Math.max(0, n.at - Date.now()), i.abort.signal); if (i.abort.signal.aborted) break
      j.failed = Math.max(0, j.failed - 1); n.r.state = 'running'; n.r.error = undefined; delete n.r.retry_at; await exec(n.r, `Trying again (attempt ${n.attempt})`, n.attempt)
    }
    j.state = i.abort.signal.aborted ? 'cancelled' : j.failed && !j.ok ? 'failed' : 'done'
    j.finished_at = new Date().toISOString()
    note(i, `Run ${j.state}: ${j.ok} finished, ${j.failed} failed of ${j.results.length}`, undefined, j.failed ? 'warn' : 'info')
  })().catch((e) => { j.state = 'failed'; j.error = (e as Error).message; j.finished_at = new Date().toISOString() })   // whatever throws, the run never stays 'running'
  return view(i)
}
