import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Import Shot Pack modal (docs/ADR-008): a folder through an adapter into ComfyUI-Shared. The core over IPC in the
// app; the same calls over HTTP against the fake API in a browser.
const ipc = core && {
  adapters: () => core.invoke('imports', 'list'),
  plan: (source, adapter, options) => core.invoke('imports', 'plan', [source, adapter || null, options || {}]),
  apply: (plan, opts) => core.invoke('imports', 'apply', [plan, opts || {}]),
  source: (id) => core.invoke('imports', 'source', [id]),
  describe: (dir) => core.invoke('imports', 'describe', [dir]),
  syncAfter: (podId) => core.invoke('imports', 'syncAfter', [podId || null]),
  save: (id, text) => core.invoke('imports', 'save', [id, text]),
  remove: (id) => core.invoke('imports', 'remove', [id]),
  template: (id, name) => core.invoke('imports', 'template', [id, name || null]),
  getPrompt: (id) => core.invoke('imports', 'getPrompt', [id]),
  savePrompt: (id, text) => core.invoke('imports', 'savePrompt', [id, text]),
  rename: (id, to) => core.invoke('imports', 'rename', [id, to]),
  duplicate: (from, id) => core.invoke('imports', 'duplicate', [from, id]),
  validate: (text, id) => core.invoke('imports', 'validateSource', [text, id || null]),
}
const http = {
  async adapters() { const { data } = await axios.get(`${API_BASE}/imports/adapters`); return data },
  async plan(source, adapter, options) { const { data } = await axios.post(`${API_BASE}/imports/plan`, { source, adapter: adapter || null, options: options || {} }); return data },
  async apply(plan, opts) { const { data } = await axios.post(`${API_BASE}/imports/apply`, { plan, ...(opts || {}) }); return data },
  async source(id) { const { data } = await axios.get(`${API_BASE}/imports/source`, { params: { id } }); return data },
  async describe(dir) { const { data } = await axios.post(`${API_BASE}/imports/describe`, { source: dir }); return data },
  async save(id, text) { const { data } = await axios.post(`${API_BASE}/imports/save`, { id, text }); return data },
  async remove(id) { const { data } = await axios.delete(`${API_BASE}/imports/adapters/${encodeURIComponent(id)}`); return data },
  async template(id, name) { const { data } = await axios.get(`${API_BASE}/imports/template`, { params: { id, name } }); return data },
  async getPrompt(id) { const { data } = await axios.get(`${API_BASE}/imports/prompt`, { params: { id } }); return data },
  async savePrompt(id, text) { const { data } = await axios.put(`${API_BASE}/imports/prompt`, { id, text }); return data },
  async rename(id, to) { const { data } = await axios.post(`${API_BASE}/imports/rename`, { id, ...to }); return data },
  async duplicate(from, id) { const { data } = await axios.get(`${API_BASE}/imports/duplicate`, { params: { from, id } }); return data },
  async validate(text, id) { const { data } = await axios.post(`${API_BASE}/imports/validate`, { text, id: id || null }); return data },
  async syncAfter(podId) { const { data } = await axios.post(`${API_BASE}/imports/sync-after`, { pod_id: podId || null }); return data },
}
export const importsAPI = ipc || http
