/**
 * ComfyUI runs: what a pod's ComfyUI has run, read from the pod itself (GET /history and /queue), newest first.
 * Nothing is stored here: ComfyUI keeps its own history and loses it when the pod is recreated.
 */
import { CoreError } from './errors.js'
import * as pods from './pods.js'
import type * as rp from './runpod.js'

export interface RunOutput { filename: string; type: string; subfolder: string }
export interface ComfyRun {
  prompt_id: string
  status: 'success' | 'error' | 'running' | 'pending'
  started_at: string | null
  duration_s: number | null
  outputs: RunOutput[]
  error?: string
}

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
  }
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
    const mk = (status: 'running' | 'pending') => (rows: unknown[][] | undefined) => (rows || []).map((x) => ({ prompt_id: String(x[1]), status, started_at: null, duration_s: null, outputs: [] as RunOutput[] }))
    live = [...mk('pending')(q.queue_pending).reverse(), ...mk('running')(q.queue_running)]
  } catch { /* the queue is a bonus: the history still answers */ }
  const seen = new Set(done.map((r) => r.prompt_id))
  return [...live.filter((r) => !seen.has(r.prompt_id)), ...done]
}
