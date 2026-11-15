import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Models (docs/ADR-042): search Hugging Face, list a repo's weight files, load chosen files onto the Shared volume by a short pod
// (a volume job: poll it with volumesAPI.job), and see what the volume already holds. The core over IPC in the app; HTTP against the fake API in a browser.
// volumeId empty: the Shared volume, else the Default Configuration's.
const ipc = core && {
  search: (q) => core.invoke('models', 'search', [q]),
  files: (repo, revision) => core.invoke('models', 'files', [repo, revision || 'main']),
  fetch: (volumeId, items) => core.invoke('models', 'fetch', [volumeId || '', items]),
  status: (volumeId) => core.invoke('models', 'status', [volumeId || '']),
  folders: () => core.invoke('models', 'folders'),
}
const http = {
  async search(q) { const { data } = await axios.get(`${API_BASE}/models/search`, { params: { q } }); return data },
  async files(repo, revision) { const { data } = await axios.get(`${API_BASE}/models/files`, { params: { repo, revision: revision || 'main' } }); return data },
  async fetch(volumeId, items) { const { data } = await axios.post(`${API_BASE}/models/fetch`, { volume_id: volumeId || '', items }); return data },
  async status(volumeId) { const { data } = await axios.get(`${API_BASE}/models/status`, { params: { volume_id: volumeId || '' } }); return data },
  async folders() { const { data } = await axios.get(`${API_BASE}/models/folders`); return data },
}
export const modelsAPI = ipc || http
