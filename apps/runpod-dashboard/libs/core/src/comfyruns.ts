/**
 * ComfyUI runs: what a pod's ComfyUI has run, read from the pod itself (GET /history and /queue), newest first.
 * Nothing is stored here: ComfyUI keeps its own history and loses it when the pod is recreated.
 */
import { CoreError } from './errors.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'

export interface RunOutput { filename: string; type: string; subfolder: string }
export interface ComfyRun {
  prompt_id: string
  status: 'success' | 'error' | 'running' | 'pending'
  started_at: string | null
  duration_s: number | null
  /** What the run's seconds cost at the pod's hourly price (USD): an estimate (RunPod bills the pod by the second whether ComfyUI is busy or not), null while it has no duration or the price is unknown. */
  cost_estimate?: number | null
  outputs: RunOutput[]
  error?: string
  /** ComfyUI's own status.messages timeline for the run. */
  messages: RunMessage[]
  /** For a failed run: where and why it failed, from the execution_error message. */
  error_detail?: ErrorDetail
}
export interface RunMessage { type: string; ts: string | null; data: Record<string, unknown> }
export interface ErrorDetail { message: string; node_id: string | null; node_type: string | null; exception_type: string | null; traceback: string[] }

type Msg = [string, { timestamp?: number; exception_message?: string; [k: string]: unknown }?]
interface Entry { outputs?: Record<string, Record<string, unknown>>; status?: { status_str?: string; completed?: boolean; messages?: Msg[] } }

function flatten(outputs: Entry['outputs']): RunOutput[] {
  const out: RunOutput[] = []
  for (const node of Object.values(outputs || {})) {
    for (const v of Object.values(node || {})) {
      if (!Array.isArray(v)) continue
      for (const f of v) if (f && typeof f === 'object' && typeof (f as RunOutput).filename === 'string') out.push({ filename: (f as RunOutput).filename, type: (f as RunOutput).type || 'output', subfolder: (f as RunOutput).subfolder || '' })
    }
  }
  return out
}

const BIG = 2000
/** A message's data without the timestamp and without huge fields (long strings are cut, big objects dropped). */
function slim(d: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d || {})) {
    if (k === 'timestamp') continue
    if (typeof v === 'string') out[k] = v.length > BIG ? v.slice(0, BIG) + '…' : v
    else if (v && typeof v === 'object' && JSON.stringify(v).length > BIG) continue
    else out[k] = v
  }
  return out
}
const toIso = (t: unknown) => (typeof t === 'number' && Number.isFinite(t) ? new Date(t).toISOString() : null)

function errorDetail(d: Record<string, unknown>): ErrorDetail {
  const tb = d.traceback
  const traceback = Array.isArray(tb) ? tb.map(String) : typeof tb === 'string' ? tb.split('\n') : []
  const str = (v: unknown) => (v === undefined || v === null ? null : String(v))
  return { message: String(d.exception_message || 'execution error').trim(), node_id: str(d.node_id), node_type: str(d.node_type), exception_type: str(d.exception_type), traceback }
}

function fromEntry(id: string, e: Entry): ComfyRun {
  const msgs = e.status?.messages || []
  const at = (t: string) => msgs.find((m) => m[0] === t)?.[1]
  const start = at('execution_start')?.timestamp
  const errMsg = at('execution_error')
  const end = (at('execution_success') || errMsg)?.timestamp
  const failed = e.status?.status_str === 'error' || !!errMsg
  const status: ComfyRun['status'] = failed ? 'error' : e.status?.status_str === 'success' || e.status?.completed ? 'success' : 'running'
  const run: ComfyRun = {
    prompt_id: id, status,
    started_at: typeof start === 'number' ? new Date(start).toISOString() : null,
    duration_s: typeof start === 'number' && typeof end === 'number' ? Math.round((end - start)) / 1000 : null,
    outputs: flatten(e.outputs),
    messages: msgs.filter((m) => Array.isArray(m) && typeof m[0] === 'string').map((m) => ({ type: m[0], ts: toIso(m[1]?.timestamp), data: slim(m[1]) })),
  }
  if (errMsg) run.error_detail = errorDetail(errMsg)
  if (errMsg) run.error = String(errMsg.exception_message || 'execution error').trim()
  else if (failed) run.error = 'execution error'
  return run
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const r = await fetchFn(url, { signal: AbortSignal.timeout(15_000) })
  if (r.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${r.status} for ${url}`)
  return r.json()
}

/** The runs on a pod's ComfyUI, newest first: queued and running ones (from /queue) then finished ones (from /history). */
export async function runs(podId: string, client?: rp.RunPodClient, fetchFn: typeof fetch = fetch): Promise<ComfyRun[]> {
  const pod = await pods.get(podId, client)
  if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: start it to read its ComfyUI history`)
  const base = pod.web_ui_url.replace(/\/$/, '')
  const hist = (await getJson(`${base}/history?max_items=50`, fetchFn)) as Record<string, Entry>
  const finished = Object.entries(hist || {}).map(([id, e]) => fromEntry(id, e))
  // ComfyUI lists history oldest first as an object; the run's start time orders them, those without one keep the server's order (last = newest).
  const indexed = finished.map((r, i) => ({ r, i }))
  indexed.sort((a, b) => (b.r.started_at && a.r.started_at ? b.r.started_at.localeCompare(a.r.started_at) : b.i - a.i))
  const done = indexed.map((x) => x.r)
  let live: ComfyRun[] = []
  try {
    const q = (await getJson(`${base}/queue`, fetchFn)) as { queue_running?: unknown[][]; queue_pending?: unknown[][] }
    const mk = (status: 'running' | 'pending') => (rows: unknown[][] | undefined) => (rows || []).map((x) => ({ prompt_id: String(x[1]), status, started_at: null, duration_s: null, outputs: [] as RunOutput[], messages: [] as RunMessage[] }))
    live = [...mk('pending')(q.queue_pending).reverse(), ...mk('running')(q.queue_running)]
  } catch { /* the queue is a bonus: the history still answers */ }
  const seen = new Set(done.map((r) => r.prompt_id))
  let rate: number | null = null
  try { const raw = await rp.getPod(podId, client); rate = typeof raw?.costPerHr === 'number' && raw.costPerHr > 0 ? raw.costPerHr : null } catch { /* no price: no estimate */ }
  const priced = (r: ComfyRun): ComfyRun => ({ ...r, cost_estimate: rate !== null && r.duration_s !== null ? Math.round((r.duration_s / 3600) * rate * 1_000_000) / 1_000_000 : null })
  return [...live.filter((r) => !seen.has(r.prompt_id)), ...done].map(priced)
}

export interface LogEntry { ts: string | null; level: 'error' | 'warning' | 'info'; text: string }
export interface LogsResult { entries: LogEntry[]; truncated: boolean }
export interface LogsOpts { level?: 'all' | 'warnings' | 'errors'; lines?: number }

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g
const ERR = /\b(error|exception|traceback|failed|fatal|cuda out of memory|oom)\b/i
const WARN = /\bwarn(ing)?\b|deprecat/i
const TB = /^\s*(File ".*", line \d+|Traceback \(most recent call last\))|^\s{2,}\S/

function classify(text: string, inTb: boolean): LogEntry['level'] {
  if (ERR.test(text) || inTb) return 'error'
  return WARN.test(text) ? 'warning' : 'info'
}

/** ComfyUI's own server log from the pod (GET /internal/logs/raw, else /internal/logs), classified, newest last. */
export async function logs(podId: string, opts: LogsOpts = {}, client?: rp.RunPodClient, fetchFn: typeof fetch = fetch): Promise<LogsResult> {
  const level = opts.level || 'all'
  if (!['all', 'warnings', 'errors'].includes(level)) throw new CoreError(400, `level must be all, warnings or errors, not ${level}`)
  const n = Math.min(2000, Math.max(1, Math.floor(Number(opts.lines)) || 300))
  const pod = await pods.get(podId, client)
  if (pod.status !== 'running' || !pod.web_ui_url) throw new CoreError(409, `Pod ${podId} is not running: start it to read its ComfyUI history`)
  const base = pod.web_ui_url.replace(/\/$/, '')
  const get = (path: string) => fetchFn(`${base}${path}`, { signal: AbortSignal.timeout(15_000) })
  let raw: { ts: string | null; text: string }[]
  let r = await get('/internal/logs/raw')
  if (r.status === 200) {
    const j = (await r.json()) as { entries?: { t?: string; m?: string }[] }
    raw = []
    for (const e of j.entries || []) {
      const ts = e.t && !Number.isNaN(Date.parse(e.t)) ? e.t : null
      for (const line of String(e.m ?? '').split(/\r?\n/)) raw.push({ ts, text: line })
    }
  } else if (r.status === 404) {
    r = await get('/internal/logs')
    if (r.status === 404) throw new CoreError(501, 'This ComfyUI has no log endpoint (neither /internal/logs/raw nor /internal/logs): it is too old to serve its log')
    if (r.status !== 200) throw new CoreError(502, `ComfyUI answered HTTP ${r.status} for ${base}/internal/logs`)
    raw = (await r.text()).split(/\r?\n/).map((text) => ({ ts: null, text }))
  } else throw new CoreError(502, `ComfyUI answered HTTP ${r.status} for ${base}/internal/logs/raw`)
  let inTb = false
  const all: LogEntry[] = []
  for (const x of raw) {
    const text = x.text.replace(ANSI, '').replace(/\s+$/, '')
    if (!text.trim()) continue
    if (/^\s*Traceback \(most recent call last\)/.test(text)) inTb = true
    else if (inTb && !TB.test(text) && !/^\w[\w.]*(Error|Exception)\b/.test(text)) inTb = false
    all.push({ ts: x.ts, level: classify(text, inTb), text })
  }
  const keep = level === 'all' ? all : all.filter((e) => (level === 'errors' ? e.level === 'error' : e.level !== 'info'))
  return { entries: keep.slice(-n), truncated: keep.length > n }
}
