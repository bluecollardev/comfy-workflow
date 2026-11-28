import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Download a network volume or a storage into folders on this PC (docs/ADR-067): plan, then start. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates it answers "no core call sourcesync.*": status is empty with old: true, the rest throws the advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Download To This PC'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true, jobs: [] }
const U = encodeURIComponent

const ipc = core && {
  plan: guard((req) => core.invoke('sourcesync', 'plan', [req]), mustRestart),
  planStatus: guard((id) => core.invoke('sourcesync', 'planStatus', [id]), mustRestart),
  cancelPlan: guard((id) => core.invoke('sourcesync', 'cancelPlan', [id]), mustRestart),
  start: guard((req) => core.invoke('sourcesync', 'start', [req]), mustRestart),
  status: guard((id) => core.invoke('sourcesync', 'status', id ? [id] : []), OLD),
  cancel: guard((id) => core.invoke('sourcesync', 'cancel', [id]), mustRestart),
  retry: guard((id) => core.invoke('sourcesync', 'retry', [id]), mustRestart),
}
const http = {
  plan: guard(async (req) => (await axios.post(`${API_BASE}/sourcesync/plan`, req)).data, mustRestart),
  planStatus: guard(async (id) => (await axios.get(`${API_BASE}/sourcesync/plan/${U(id)}`)).data, mustRestart),
  cancelPlan: guard(async (id) => (await axios.post(`${API_BASE}/sourcesync/plan/${U(id)}/cancel`)).data, mustRestart),
  start: guard(async (req) => (await axios.post(`${API_BASE}/sourcesync/start`, req)).data, mustRestart),
  status: guard(async (id) => (await axios.get(`${API_BASE}/sourcesync/status`, { params: id ? { job_id: id } : {} })).data, OLD),
  cancel: guard(async (id) => (await axios.post(`${API_BASE}/sourcesync/job/${U(id)}/cancel`)).data, mustRestart),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/sourcesync/job/${U(id)}/retry`)).data, mustRestart),
}
const raw = ipc || http
export const sourcesyncAPI = {
  /** { source: { type: 'volume' | 'storage', volume_id | storage_id }, prefix?, skip_folders?, dest_dir? } -> { plan_id } */
  plan: async (req) => (await raw.plan(req)) || {},
  /** { state: 'listing' | 'done' | 'failed' | 'cancelled', files_so_far, error?, plan? } */
  planStatus: async (id) => (await raw.planStatus(id)) || { state: 'failed', files_so_far: 0 },
  cancelPlan: async (id) => raw.cancelPlan(id),
  /** -> { job_id } */
  start: async (req) => (await raw.start(req)) || {},
  /** { jobs: Job[] } (one job when an id is given) */
  status: async (id) => { const r = (await raw.status(id)) || {}; return { old: !!r.old, jobs: Array.isArray(r.jobs) ? r.jobs : [] } },
  cancel: async (id) => raw.cancel(id),
  /** -> { job_id } of the new job that sends only the failed files again */
  retry: async (id) => (await raw.retry(id)) || {},
}
