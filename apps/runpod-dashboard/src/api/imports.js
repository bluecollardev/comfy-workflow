import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Connect › Import tab (docs/ADR-008): a folder through an adapter into ComfyUI-Shared. The core over IPC in the
// app; the same calls over HTTP against the fake API in a browser.
const ipc = core && {
  adapters: () => core.invoke('imports', 'list'),
  plan: (source, adapter, options) => core.invoke('imports', 'plan', [source, adapter || null, options || {}]),
  apply: (plan, opts) => core.invoke('imports', 'apply', [plan, opts || {}]),
  approve: (id) => core.invoke('imports', 'approve', [id]),
  source: (id) => core.invoke('imports', 'source', [id]),
  draftPreview: (dir) => core.invoke('imports', 'draftPreview', [dir]),
  draft: (dir) => core.invoke('imports', 'draft', [dir]),
}
const http = {
  async adapters() { const { data } = await axios.get(`${API_BASE}/imports/adapters`); return data },
  async plan(source, adapter, options) { const { data } = await axios.post(`${API_BASE}/imports/plan`, { source, adapter: adapter || null, options: options || {} }); return data },
  async apply(plan, opts) { const { data } = await axios.post(`${API_BASE}/imports/apply`, { plan, ...(opts || {}) }); return data },
  async approve(id) { const { data } = await axios.post(`${API_BASE}/imports/approve`, { id }); return data },
  async source(id) { const { data } = await axios.get(`${API_BASE}/imports/source`, { params: { id } }); return data },
  async draftPreview(dir) { const { data } = await axios.get(`${API_BASE}/imports/draft-preview`, { params: { source: dir } }); return data },
  async draft(dir) { const { data } = await axios.post(`${API_BASE}/imports/draft`, { source: dir }); return data },
}
export const importsAPI = ipc || http
