import axios from 'axios'
import { ref } from 'vue'
import { core } from './bridge'
import { API_BASE } from './pods'

// Storage adapters (docs/ADR-063): S3-compatible storages that publishing copies to and Panama pulls from. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates them answers "no core call storage.*": the list comes back empty with old: true, writes throw the advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Storage adapters'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true, adapters: [] }

const ipc = core && {
  list: guard(() => core.invoke('storage', 'list', []), OLD),
  save: guard((o) => core.invoke('storage', 'save', [o]), mustRestart),
  setEnabled: guard((id, on) => core.invoke('storage', 'setEnabled', [id, !!on]), mustRestart),
  remove: guard((id) => core.invoke('storage', 'remove', [id]), mustRestart),
  test: guard((id) => core.invoke('storage', 'test', [id]), mustRestart),
}
const http = {
  list: guard(async () => (await axios.get(`${API_BASE}/storage`)).data, OLD),
  save: guard(async (o) => (await axios.put(`${API_BASE}/storage`, o)).data, mustRestart),
  setEnabled: guard(async (id, on) => (await axios.post(`${API_BASE}/storage/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`)).data, mustRestart),
  remove: guard(async (id) => (await axios.delete(`${API_BASE}/storage/${encodeURIComponent(id)}`)).data, mustRestart),
  test: guard(async (id) => (await axios.post(`${API_BASE}/storage/${encodeURIComponent(id)}/test`)).data, mustRestart),
}
const raw = ipc || http
/** The names of the storages (other than the publish destination and Panama) that are on: Publishing says it also copies there. Every answer here refreshes it. */
export const mirrorNames = ref([])
const seen = (adapters) => { mirrorNames.value = adapters.filter((a) => a.enabled && a.kind !== 'publish' && a.kind !== 'panama').map((a) => a.name); return adapters }
export const storageAPI = {
  list: async () => { const r = (await raw.list()) || {}; return { old: !!r.old, adapters: seen(Array.isArray(r.adapters) ? r.adapters : []) } },
  save: async (o) => { const r = (await raw.save(o)) || {}; return { old: false, adapters: seen(r.adapters || []) } },
  setEnabled: async (id, on) => { const r = (await raw.setEnabled(id, on)) || {}; return { old: false, adapters: seen(r.adapters || []) } },
  remove: async (id) => { const r = (await raw.remove(id)) || {}; return { old: false, adapters: seen(r.adapters || []) } },
  test: async (id) => (await raw.test(id)) || { ok: false, detail: '' },
}
