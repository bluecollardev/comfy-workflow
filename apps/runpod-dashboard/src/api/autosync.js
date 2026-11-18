import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Auto sync (docs/ADR-046): per pod, the volume's new files come to this PC by themselves. The core over IPC in the app; HTTP against the fake API in a browser.
// A core started before auto sync existed answers "no core call autosync.*": the window and the cards still work, with nothing syncing, until the app is relaunched.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const DEFAULTS = { enabled: false, pull: true, push: false, approved_by: '' }
const RESTART = 'Restart the app to use Auto sync (its core is older than this window)'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const withDefaults = (s) => ({ ...DEFAULTS, ...(s || {}) })
const empty = () => ({ paused: false, items: [] })

const ipc = core && {
  get: guard((podId) => core.invoke('autosync', 'get', [podId]), DEFAULTS),
  set: guard((podId, settings) => core.invoke('autosync', 'set', [podId, settings]), mustRestart),
  status: guard(() => core.invoke('autosync', 'status', []), empty),
  pause: guard((on) => core.invoke('autosync', 'pause', [!!on]), mustRestart),
  syncNow: guard((podId) => core.invoke('autosync', 'syncNow', [podId]), mustRestart),
  approve: guard((podId, yes) => core.invoke('autosync', 'approve', [podId, !!yes]), mustRestart),
  dismiss: guard((podId) => core.invoke('autosync', 'dismiss', [podId]), mustRestart),
}
const http = {
  get: guard(async (podId) => (await axios.get(`${API_BASE}/autosync`, { params: { pod_id: podId } })).data, DEFAULTS),
  set: guard(async (podId, settings) => (await axios.put(`${API_BASE}/autosync`, { pod_id: podId, ...settings })).data, mustRestart),
  status: guard(async () => (await axios.get(`${API_BASE}/autosync/status`)).data, empty),
  pause: guard(async (on) => (await axios.post(`${API_BASE}/autosync/pause`, { on: !!on })).data, mustRestart),
  syncNow: guard(async (podId) => (await axios.post(`${API_BASE}/autosync/sync-now`, { pod_id: podId })).data, mustRestart),
  approve: guard(async (podId, yes) => (await axios.post(`${API_BASE}/autosync/approve`, { pod_id: podId, yes: !!yes })).data, mustRestart),
  dismiss: guard(async (podId) => (await axios.post(`${API_BASE}/autosync/dismiss`, { pod_id: podId })).data, mustRestart),
}
const raw = ipc || http
/** Answers are normalised: settings always have every field, status always has a list. */
export const autosyncAPI = {
  get: async (podId) => withDefaults(await raw.get(podId)),
  set: async (podId, settings) => withDefaults(await raw.set(podId, settings)),
  status: async () => { const s = (await raw.status()) || {}; return { paused: !!s.paused, items: Array.isArray(s.items) ? s.items : [] } },
  pause: (on) => raw.pause(on),
  syncNow: (podId) => raw.syncNow(podId),
  approve: (podId, yes) => raw.approve(podId, yes),
  dismiss: (podId) => raw.dismiss(podId),
}
