/**
 * Graph failures, logged (Lucas: 'make sure any graph failures are logged'). Every graph that fails to load, validate, queue or execute on a pod
 * becomes ONE structured record, appended as a JSON line to failures.jsonl in the config folder (async, size-capped, no credential or URL ever
 * written) and as a History line. `list` reads them back (IPC `failures.list`, MCP tool `failures`). The same fields feed the MCP texts of a failed job.
 */
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CoreError } from './errors.js'
import * as history from './history.js'
import { configDir } from './paths.js'
import * as settings from './settings.js'

export type Stage = 'load' | 'validate' | 'queue' | 'execute' | 'encode' | 'transfer'
export interface MissingModel { name: string; where_on_volume: string }
export interface FailureRecord {
  /** a stable id (the page and `failures.retry` use it), the same time as `at`, and the node and the retries so far in the page's words */ id: string; at: string; node: string | null; retries: number; time: string; job_id: string; round: string; shot: string; graph: string; graph_version: string; pod_id: string; pod_name: string; gpu: string
  stage: Stage; node_id: string; node_type: string; message: string; log_tail: string[]; missing_models: MissingModel[]; recovery: string; retryable: boolean; attempt: number
}
export const MAX_BYTES = 20 * 1024 * 1024, MAX_READ = 4 * 1024 * 1024
const file = () => join(configDir(), 'failures.jsonl')
let clock = () => Date.now()
export const setClock = (f: (() => number) | null) => { clock = f ?? (() => Date.now()) }

/** No credential and no URL (a signed link carries one) in anything written: the stored secrets are replaced, URLs become <url>. */
export function clean(text: string): string {
  let t = String(text ?? '')
  for (const v of Object.values(settings.secretValues())) if (typeof v === 'string' && v.length >= 6) t = t.split(v).join('•••')
  return t.replace(/https?:\/\/\S+/gi, '<url>').replace(/(AKIA|ASIA)[A-Z0-9]{12,}/g, '•••').replace(/(secret|token|password|api[_-]?key)(["'\s:=]+)[^\s"',;]{6,}/gi, '$1$2•••')
}
const FOLDER: Record<string, string> = { ckpt_name: 'checkpoints', lora_name: 'loras', vae_name: 'vae', unet_name: 'diffusion_models', clip_name: 'text_encoders', control_net_name: 'controlnet', model_name: 'upscale_models' }
/** The model files a ComfyUI message says are missing ("Value not in list: ckpt_name: 'x.safetensors' not in [...]") and where they belong on the volume. */
export function missingModels(text: string): MissingModel[] {
  const out: MissingModel[] = [], re = /(\w+_name|\w+_path)?[:\s]*'([^']+\.(?:safetensors|ckpt|pt|pth|bin|gguf|onnx))'\s+not in/gi
  for (const m of String(text).matchAll(re)) { const folder = FOLDER[(m[1] ?? '').toLowerCase()] ?? 'models'; if (!out.some((x) => x.name === m[2])) out.push({ name: m[2], where_on_volume: `comfy-shared/models/${folder}/${m[2]}` }) }
  return out
}
const TRANSIENT = /\b(5\d\d)\b|restarted while|stopped answering|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|timed? ?out|not running|stopped|pod .* gone|503|502|504|unreachable/i
/** Which part of the run failed, whether trying again can help, and what to do: derived from the message and where it happened. */
export function classify(stage: Stage, message: string): { retryable: boolean; recovery: string } {
  const miss = missingModels(message)
  if (miss.length) return { retryable: false, recovery: `Missing model${miss.length === 1 ? '' : 's'}: ${miss.map((m) => m.name).join(', ')}. Fetch ${miss.length === 1 ? 'it' : 'them'} to ${miss[0].where_on_volume.replace(/[^/]+$/, '')} on the volume (models_fetch, or the wanted-models list) and run again. Not retried.` }
  if (/RAM guard|out of memory|\bOOM\b/i.test(message)) return { retryable: false, recovery: 'Memory ran out: use a bigger card or a smaller chunk (run_shot_chunked `chunk`), and resume from the frame named in the message. Not retried: the same graph would fail the same way.' }
  if (stage === 'validate') return { retryable: false, recovery: 'ComfyUI rejected the graph: fix the node and input named above (the graph, not the pod, is wrong) and queue it again. Not retried.' }
  if (stage === 'load') return TRANSIENT.test(message) ? { retryable: true, recovery: 'The pod could not be reached to read the graph: check that it is running, then run again (retried with backoff).' } : { retryable: false, recovery: 'The graph could not be read or converted: open it in ComfyUI on the pod and re-save it, or check the file. Not retried.' }
  if (TRANSIENT.test(message)) return { retryable: true, recovery: 'A transient problem (the pod stopped, the network, or a 5xx): retried at most twice, 5 then 20 minutes apart.' }
  if (stage === 'execute') return { retryable: false, recovery: 'The node failed while running: see node and message; an out-of-memory error needs a bigger card or smaller inputs. Not retried: the same graph would fail the same way.' }
  return { retryable: false, recovery: 'See the message; fix the cause and run again.' }
}

let writing: Promise<void> = Promise.resolve(), counter = 0
export interface RecordInput extends Partial<Omit<FailureRecord, 'stage' | 'message'>> { stage: Stage; message: string; /** the caller records its own History line (the run's), so none is added here */ quiet?: boolean }
/** Record a failure: a JSON line in failures.jsonl and a History line. Never throws. Returns the record (so the caller can show the same fields). */
export function record(i: RecordInput): FailureRecord {
  const message = clean(i.message).slice(0, 500), c = classify(i.stage, i.message)
  const stamp = new Date(clock()).toISOString(), r: FailureRecord = { id: `f-${clock().toString(36)}-${(counter++).toString(36)}`, at: stamp, node: (i.node_id ?? '') ? `${i.node_id}${i.node_type ? ` (${i.node_type})` : ''}` : null, retries: Math.max(0, (i.attempt ?? 1) - 1), time: stamp, job_id: i.job_id ?? '', round: i.round ?? '', shot: i.shot ?? '', graph: i.graph ?? '', graph_version: i.graph_version ?? '', pod_id: i.pod_id ?? '', pod_name: i.pod_name ?? '', gpu: i.gpu ?? '',
    stage: i.stage, node_id: i.node_id ?? '', node_type: i.node_type ?? '', message, log_tail: (i.log_tail ?? []).slice(-20).map((l) => clean(l).slice(0, 300)), missing_models: i.missing_models ?? missingModels(i.message), recovery: i.recovery ?? c.recovery, retryable: i.retryable ?? c.retryable, attempt: i.attempt ?? 1 }
  const line = `${JSON.stringify(r)}\n`
  writing = writing.then(async () => {
    const f = file(); await mkdir(dirname(f), { recursive: true })
    const size = (await stat(f).catch(() => null))?.size ?? 0
    if (size + line.length > MAX_BYTES) await rename(f, `${f}.1`).catch(() => undefined)   // rotation: the old file is kept once
    await appendFile(f, line, { mode: 0o600 })
  }).catch(() => undefined)
  if (!i.quiet) try { history.record({ kind: 'job', job: 'run', state: 'failed', what: `graph failed: ${r.graph || r.shot || r.job_id}`, ...(r.pod_id ? { pod_id: r.pod_id } : {}), ...(r.pod_name ? { pod_name: r.pod_name } : {}), error: `${r.stage}${r.node_id ? ` at node ${r.node_id}${r.node_type ? ` (${r.node_type})` : ''}` : ''}: ${message}`.slice(0, 500), detail: `${r.retryable ? 'retryable' : 'not retried'}; ${r.recovery}`.slice(0, 600) }) } catch { /* the history never breaks a run */ }
  return r
}
export const settled = (): Promise<void> => writing
/** The records, newest first; `since` is an ISO time; `shot` and `job_id` filter; reads at most the last 4 MB of the file. */
export async function list(o: { limit?: number; since?: string; shot?: string; job_id?: string } = {}): Promise<{ failures: FailureRecord[]; file: string }> {
  await writing
  const lim = Math.max(1, Math.min(500, Math.floor(Number(o.limit) || 50)))
  let text = ''; try { const t = await readFile(file(), 'utf8'); text = t.length > MAX_READ ? t.slice(-MAX_READ) : t } catch { /* none yet */ }
  const out: FailureRecord[] = []
  for (const l of text.split('\n').reverse()) {
    if (!l.trim()) continue
    let r: FailureRecord; try { r = JSON.parse(l) } catch { continue }
    if (o.since && r.time < o.since) continue; if (o.shot && r.shot !== o.shot) continue; if (o.job_id && r.job_id !== o.job_id) continue
    out.push(r); if (out.length >= lim) break
  }
  return { failures: out, file: file() }
}
export interface Explained { stage: Stage; node_id: string; node_type: string; message: string; missing_models: MissingModel[]; recovery: string; retryable: boolean; text: string }
/**
 * Any failure message in structured words, for the MCP texts of failed jobs (never just 'failed' or 'aws exited 1'): the stage (guessed from the
 * message unless given), the node when the message names one, the missing model files, what to do, whether trying again can help, and an
 * explicit "not obtained" for what the message does not say.
 */
export function explain(message: string, o: { stage?: Stage; node_id?: string | null; node_type?: string | null; log_tail?: string[] } = {}): Explained {
  const raw = String(message ?? ''), nt = /\(node (\S+), ([^)]+)\)/.exec(raw) ?? /node (\S+) \(([^)]+)\)/.exec(raw)
  const stage: Stage = o.stage ?? (/validation|Value not in list|Required input|rejected the prompt/i.test(raw) ? 'validate' : /\b(aws|s3|rsync|ssh|pull|sync|upload|download|exited \d+)\b/i.test(raw) ? 'transfer' : /ffmpeg|ffprobe|encode|frames? (missing|incomplete)/i.test(raw) ? 'encode' : /convert|not a UI graph|no nodes|workflow .*not found|could not read/i.test(raw) ? 'load' : /\/prompt|queue(d)? |HTTP 5\d\d/i.test(raw) ? 'queue' : 'execute')
  const m = clean(raw).slice(0, 500), c = classify(stage, raw), miss = missingModels(raw)
  const node_id = o.node_id ?? nt?.[1] ?? '', node_type = o.node_type ?? nt?.[2] ?? ''
  const rec = { stage, node_id, node_type, message: m, missing_models: miss, recovery: c.recovery, retryable: c.retryable, ...(o.log_tail ? { log_tail: o.log_tail.slice(-5).map(clean) } : {}) }
  return { stage, node_id, node_type, message: m, missing_models: miss, recovery: c.recovery, retryable: c.retryable, text: describe(rec) }
}
/** Run the failed graph again (the window's Retry): only a retryable failure (a transient cause), at most twice (attempt 3 is the last); a graph or validation error is never retried. */
export async function retry(id: string): Promise<{ job_id: string; attempt: number; graph: string }> {
  const rec = (await list({ limit: 500 })).failures.find((f) => f.id === id)
  if (!rec) throw new CoreError(404, `No such failure: ${id}`)
  if (!rec.retryable) throw new CoreError(400, `That failure is not retried: ${rec.recovery}`)
  if (rec.attempt >= 3) throw new CoreError(400, `That graph was tried ${rec.attempt} times already (a transient cause is retried at most twice): ${rec.recovery}`)
  if (!rec.pod_id || !rec.graph) throw new CoreError(400, 'That failure names no pod or graph to run again.')
  const rf = await import('./runflows.js'), j = await rf.run(rec.pod_id, [rec.graph], { attempt: rec.attempt + 1 })
  history.record({ kind: 'change', area: 'configuration', action: 'failed graph retried', what: rec.graph, detail: `attempt ${rec.attempt + 1}; job ${j.id}; was ${rec.stage}: ${rec.message.slice(0, 160)}` })
  return { job_id: j.id, attempt: rec.attempt + 1, graph: rec.graph }
}
/** A failure in words for an MCP text: stage, node, message, missing model, recovery; says so when a field could not be obtained. */
export function describe(r: Partial<FailureRecord>): string {
  const miss = r.missing_models?.length ? r.missing_models.map((m) => `${m.name} (belongs in ${m.where_on_volume})`).join(', ') : ''
  return [`stage: ${r.stage ?? 'not obtained'}`, `node: ${r.node_id ? `${r.node_id}${r.node_type ? ` (${r.node_type})` : ''}` : 'not obtained (the failure names no node)'}`, `message: ${r.message || 'not obtained'}`, ...(miss ? [`missing model: ${miss}`] : []), `retryable: ${r.retryable === undefined ? 'not obtained' : r.retryable ? 'yes' : 'no'}`, `recovery: ${r.recovery || 'not obtained'}`, ...(r.log_tail?.length ? [`log tail:\n  ${r.log_tail.slice(-5).join('\n  ')}`] : ['log tail: not obtained'])].join('\n')
}
void writeFile
