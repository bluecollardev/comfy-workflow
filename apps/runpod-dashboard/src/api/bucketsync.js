import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Copy a network volume, a storage or the BH exchange bucket into a storage through a running pod (docs/ADR-067 amendment): plan, then start. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates it answers "no core call bucketsync.*": status is empty with old: true, the rest throws the advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Bucket To Bucket Sync'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true, jobs: [] }
const U = encodeURIComponent

const ipc = core && {
  plan: guard((req) => core.invoke('bucketsync', 'plan', [req]), mustRestart),
  planStatus: guard((id) => core.invoke('bucketsync', 'planStatus', [id]), mustRestart),
  cancelPlan: guard((id) => core.invoke('bucketsync', 'cancelPlan', [id]), mustRestart),
  start: guard((req) => core.invoke('bucketsync', 'start', [req]), mustRestart),
  status: guard((id) => core.invoke('bucketsync', 'status', id ? [id] : []), OLD),
  cancel: guard((id) => core.invoke('bucketsync', 'cancel', [id]), mustRestart),
  retry: guard((id) => core.invoke('bucketsync', 'retry', [id]), mustRestart),
}
const http = {
  plan: guard(async (req) => (await axios.post(`${API_BASE}/bucketsync/plan`, req)).data, mustRestart),
  planStatus: guard(async (id) => (await axios.get(`${API_BASE}/bucketsync/plan/${U(id)}`)).data, mustRestart),
  cancelPlan: guard(async (id) => (await axios.post(`${API_BASE}/bucketsync/plan/${U(id)}/cancel`)).data, mustRestart),
  start: guard(async (req) => (await axios.post(`${API_BASE}/bucketsync/start`, req)).data, mustRestart),
  status: guard(async (id) => (await axios.get(`${API_BASE}/bucketsync/status`, { params: id ? { job_id: id } : {} })).data, OLD),
  cancel: guard(async (id) => (await axios.post(`${API_BASE}/bucketsync/job/${U(id)}/cancel`)).data, mustRestart),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/bucketsync/job/${U(id)}/retry`)).data, mustRestart),
}
const raw = ipc || http
export const bucketsyncAPI = {
  /** { source: { type: 'volume', volume_id } | { type: 'storage', storage_id }, target: { storage_id }, prefix?, skip_folders?, run_on: { pod_id } } -> { plan_id } */
  plan: async (req) => (await raw.plan(req)) || {},
  /** { state: 'listing' | 'done' | 'failed' | 'cancelled', files_so_far, error?, plan? } */
  planStatus: async (id) => (await raw.planStatus(id)) || { state: 'failed', files_so_far: 0 },
  cancelPlan: async (id) => raw.cancelPlan(id),
  /** -> { job_id } */
  /** { plan_id, approved_by? } */
  start: async (req) => (await raw.start(req)) || {},
  /** { jobs: Job[] } (one job when an id is given) */
  status: async (id) => { const r = (await raw.status(id)) || {}; return { old: !!r.old, jobs: Array.isArray(r.jobs) ? r.jobs : [] } },
  cancel: async (id) => raw.cancel(id),
  /** -> { job_id } of the new job that sends only the failed files again */
  retry: async (id) => (await raw.retry(id)) || {},
}
