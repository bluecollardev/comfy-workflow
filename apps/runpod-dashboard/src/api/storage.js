import axios from 'axios'
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
const NO_USAGE = { state: 'failed', error: RESTART, bytes: 0, objects: 0, as_of: '', price_per_tb_month: null }   // a core without storage.usage: the row says the size is unknown

const ipc = core && {
  list: guard(() => core.invoke('storage', 'list', []), OLD),
  save: guard((o) => core.invoke('storage', 'save', [o]), mustRestart),
  setEnabled: guard((id, on) => core.invoke('storage', 'setEnabled', [id, !!on]), mustRestart),
  remove: guard((id) => core.invoke('storage', 'remove', [id]), mustRestart),
  test: guard((id) => core.invoke('storage', 'test', [id]), mustRestart),
  reorder: guard((ids) => core.invoke('storage', 'reorder', [ids]), mustRestart),
  setDefault: guard((id) => core.invoke('storage', 'setDefault', [id]), mustRestart),
  uploads: guard(() => core.invoke('storage', 'uploads', []), { jobs: [] }),
  cancelUpload: guard((id) => core.invoke('storage', 'cancelUpload', [id]), mustRestart),
  browse: guard((id, prefix) => core.invoke('storage', 'browse', [id, prefix || '']), mustRestart),
  usage: guard((id) => core.invoke('storage', 'usage', [id]), NO_USAGE),
}
const http = {
  list: guard(async () => (await axios.get(`${API_BASE}/storage`)).data, OLD),
  save: guard(async (o) => (await axios.put(`${API_BASE}/storage`, o)).data, mustRestart),
  setEnabled: guard(async (id, on) => (await axios.post(`${API_BASE}/storage/${encodeURIComponent(id)}/${on ? 'enable' : 'disable'}`)).data, mustRestart),
  remove: guard(async (id) => (await axios.delete(`${API_BASE}/storage/${encodeURIComponent(id)}`)).data, mustRestart),
  test: guard(async (id) => (await axios.post(`${API_BASE}/storage/${encodeURIComponent(id)}/test`)).data, mustRestart),
  reorder: guard(async (ids) => (await axios.put(`${API_BASE}/storage/order`, { order: ids })).data, mustRestart),
  setDefault: guard(async (id) => (await axios.put(`${API_BASE}/storage/default`, { id })).data, mustRestart),
  uploads: guard(async () => (await axios.get(`${API_BASE}/storage/uploads`)).data, { jobs: [] }),
  cancelUpload: guard(async (id) => (await axios.post(`${API_BASE}/storage/uploads/${encodeURIComponent(id)}/cancel`)).data, mustRestart),
  browse: guard(async (id, prefix) => (await axios.get(`${API_BASE}/storage/${encodeURIComponent(id)}/browse`, { params: { prefix: prefix || '' } })).data, mustRestart),
  usage: guard(async (id) => (await axios.get(`${API_BASE}/storage/${encodeURIComponent(id)}/usage`)).data, NO_USAGE),
}
const raw = ipc || http
export const storageAPI = {
  list: async () => { const r = (await raw.list()) || {}; return { old: !!r.old, adapters: (Array.isArray(r.adapters) ? r.adapters : []) } },
  save: async (o) => { const r = (await raw.save(o)) || {}; return { old: false, adapters: (r.adapters || []) } },
  setEnabled: async (id, on) => { const r = (await raw.setEnabled(id, on)) || {}; return { old: false, adapters: (r.adapters || []) } },
  remove: async (id) => { const r = (await raw.remove(id)) || {}; return { old: false, adapters: (r.adapters || []) } },
  test: async (id) => (await raw.test(id)) || { ok: false, detail: '' },
  uploads: async () => { const r = (await raw.uploads()) || {}; return { jobs: Array.isArray(r.jobs) ? r.jobs : [] } },
  cancelUpload: async (id) => (await raw.cancelUpload(id)) || {},
  setDefault: async (id) => { const r = (await raw.setDefault(id)) || {}; return { old: false, adapters: (r.adapters || []) } },
  reorder: async (ids) => { const r = (await raw.reorder(ids)) || {}; return { old: false, adapters: (r.adapters || []) } },
  /** One level of the bucket, read-only: { prefix, folders: string[], files: [{ name, bytes, modified }], truncated }. */
  browse: async (id, prefix = '') => { const r = (await raw.browse(id, prefix)) || {}; return { ...r, prefix: r.prefix ?? prefix, folders: Array.isArray(r.folders) ? r.folders : [], files: Array.isArray(r.files) ? r.files : [] } },
  /** What the bucket holds (read-only, listed by the core): { bytes, objects, as_of, state: 'done' | 'listing' | 'failed', objects_so_far?, error?, price_per_tb_month: number | null }. */
  usage: async (id) => { const r = (await raw.usage(id)) || {}; return { bytes: 0, objects: 0, as_of: '', price_per_tb_month: null, ...r } },
}
