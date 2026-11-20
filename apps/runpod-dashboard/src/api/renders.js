import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Render sequences (docs/ADR-048): the core renders each DPX sequence into an H.264 proxy, on the pod or on this PC (the `where` adapters), and the app plays it.
// The core over IPC in the app; HTTP against the fake API in a browser. A core started before this existed answers "no core call renders.*":
// plan and proxies come back empty with old: true (the panel says to restart the app) and start throws the same advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Render sequences'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true }

const ipc = core && {
  plan: guard((o) => core.invoke('renders', 'plan', [o]), OLD),
  start: guard((o) => core.invoke('renders', 'start', [o]), mustRestart),
  status: guard((id) => core.invoke('renders', 'status', id ? [id] : []), OLD),
  cancel: guard((id) => core.invoke('renders', 'cancel', [id]), mustRestart),
  retry: guard((id) => core.invoke('renders', 'retry', [id]), mustRestart),
  proxies: guard((o) => core.invoke('renders', 'proxies', [o]), OLD),
  clearLocal: guard(() => core.invoke('renders', 'clearLocal', []), mustRestart),
}
const http = {
  plan: guard(async (o) => (await axios.post(`${API_BASE}/renders/plan`, o)).data, OLD),
  start: guard(async (o) => (await axios.post(`${API_BASE}/renders/start`, o)).data, mustRestart),
  status: guard(async (id) => (await axios.get(`${API_BASE}/renders/status`, { params: id ? { job_id: id } : {} })).data, OLD),
  cancel: guard(async (id) => (await axios.post(`${API_BASE}/renders/cancel`, { job_id: id })).data, mustRestart),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/renders/retry`, { job_id: id })).data, mustRestart),
  proxies: guard(async (o) => (await axios.post(`${API_BASE}/renders/proxies`, o)).data, OLD),
  clearLocal: guard(async () => (await axios.delete(`${API_BASE}/renders/local`)).data, mustRestart),
}
const raw = ipc || http
/** An error from the core keeps its `code` (no_ffmpeg, ffmpeg_broken) on the Error so the panel can show the right advice. */
const withCode = (fn) => async (...a) => { try { return await fn(...a) } catch (e) { const code = e?.code || e?.response?.data?.code; if (code && !e.code) e.code = code; throw e } }

/** Answers are normalised: lists are always lists; old: true says the core predates Render sequences. */
export const rendersAPI = {
  plan: async (o) => {
    const r = (await raw.plan(o)) || {}
    if (r.old) return { old: true, pod_ok: false, reason: RESTART, adapters: [], total_frames: 0, sequences: [] }
    return { old: false, pod_ok: !!r.pod_ok, reason: r.reason || '', adapters: Array.isArray(r.adapters) ? r.adapters : [], total_frames: r.total_frames ?? 0, sequences: Array.isArray(r.sequences) ? r.sequences : [], pod_cpu: r.pod_cpu || null, notes: Array.isArray(r.notes) ? r.notes : [], totals: r.totals || null, source_summary: r.source_summary || null, colour_summary: r.colour_summary || null, settings: r.settings || null, settings_source: r.settings_source || '', warnings: Array.isArray(r.warnings) ? r.warnings : [] }
  },
  start: withCode(async (o) => (await raw.start(o)) || {}),
  status: async (id) => { const r = await raw.status(id); return { old: !!r?.old, jobs: Array.isArray(r?.jobs) ? r.jobs : [] } },
  cancel: withCode(async (id) => (await raw.cancel(id)) || {}),
  retry: withCode(async (id) => (await raw.retry(id)) || {}),
  proxies: async (o) => { const r = await raw.proxies(o); return { old: !!r?.old, items: Array.isArray(r?.items) ? r.items : [], deliverables: Array.isArray(r?.deliverables) ? r.deliverables : [] } },
  clearLocal: withCode(async () => { const r = (await raw.clearLocal()) || {}; return { removed: r.removed ?? 0, bytes: r.bytes ?? 0 } }),
}
