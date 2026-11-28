import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Configure Sync rules (docs/ADR-069): for a volume and an event, where it sends. Assumed core interface: get(volumeId|'*') -> { volume_id, rules, inherited? }; set(volumeId|'*', event, destinations) -> same shape; all() -> { rules }. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates it answers "no core call syncrules.*": status is empty with old: true, the rest throws the advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Configure Sync'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true, rules: {} }
const U = encodeURIComponent

const ipc = core && {
  get: guard((v) => core.invoke('syncrules', 'get', [v]), mustRestart),
  set: guard((v, ev, d) => core.invoke('syncrules', 'set', [v, ev, d]), mustRestart),
  all: guard(() => core.invoke('syncrules', 'all', []), OLD),
}
const http = {
  get: guard(async (v) => (await axios.get(`${API_BASE}/syncrules`, { params: { volume_id: v } })).data, mustRestart),
  set: guard(async (v, ev, d) => (await axios.put(`${API_BASE}/syncrules`, { volume_id: v, event: ev, destinations: d })).data, mustRestart),
  all: guard(async () => (await axios.get(`${API_BASE}/syncrules/all`)).data, OLD),
}
const raw = ipc || http
const EMPTY = { generated: [], approved: [], published: [] }
export const EVENTS = ['generated', 'approved', 'published']
export const syncrulesAPI = {
  /** { volume_id, rules: { generated, approved, published }, inherited? } */
  get: async (v) => { const r = (await raw.get(v)) || {}; return { ...r, volume_id: r.volume_id ?? v, rules: { ...EMPTY, ...(r.rules || {}) } } },
  /** destinations: [{ type: 'storage', id }] -> the same shape as get */
  set: async (v, ev, d) => { const r = (await raw.set(v, ev, d)) || {}; return { ...r, volume_id: r.volume_id ?? v, rules: { ...EMPTY, ...(r.rules || {}) } } },
  /** { rules: { [volume_id | '*']: { generated, approved, published } }, old? } */
  all: async () => { const r = (await raw.all()) || {}; return { old: !!r.old, rules: r.rules || {} } },
}
