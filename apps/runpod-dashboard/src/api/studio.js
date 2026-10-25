import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Adapter Studio (docs/ADR-009): the chat step, the save with the agent's check, the package's tree and files. The core over
// IPC in the app; the same calls over HTTP against the fake API in a browser.
const ipc = core && {
  step: (state) => core.invoke('studio', 'step', [state]),
  saveChecked: (id, text, folder) => core.invoke('studio', 'saveChecked', [id, text, folder || null]),
  document: (id) => core.invoke('studio', 'document', [id]),
  tree: (folder) => core.invoke('studio', 'tree', [folder]),
  file: (folder, path) => core.invoke('studio', 'file', [folder, path]),
  context: (folder) => core.invoke('studio', 'context', [folder]),
}
const http = {
  async step(state) { const { data } = await axios.post(`${API_BASE}/studio/step`, { state }); return data },
  async saveChecked(id, text, folder) { const { data } = await axios.post(`${API_BASE}/studio/save-checked`, { id, text, folder: folder || null }); return data },
  async document(id) { const { data } = await axios.post(`${API_BASE}/studio/document`, { id }); return data },
  async tree(folder) { const { data } = await axios.get(`${API_BASE}/studio/tree`, { params: { folder } }); return data },
  async file(folder, path) { const { data } = await axios.get(`${API_BASE}/studio/file`, { params: { folder, path } }); return data },
  async context(folder) { const { data } = await axios.get(`${API_BASE}/studio/context`, { params: { folder } }); return data },
}
export const studioAPI = ipc || http
