import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The wanted-models list (docs/ADR-042 section 12): model names as Hugging Face coordinates, kept in the configuration and exported with it, loadable onto any Shared volume.
// The core over IPC in the app; HTTP against the fake API in a browser. volumeId empty: the Shared volume, else the Default Configuration's.
const ipc = core && {
  list: () => core.invoke('wanted', 'list'),
  status: (volumeId) => core.invoke('wanted', 'status', [volumeId || '']),
  add: (items) => core.invoke('wanted', 'add', [items]),
  addList: (o) => core.invoke('wanted', 'addList', [o || {}]),
  saveInstalled: (volumeId) => core.invoke('wanted', 'saveInstalled', [volumeId || '']),
  remove: (keys, all) => core.invoke('wanted', 'remove', [keys || [], !!all]),
  load: (volumeId) => core.invoke('wanted', 'load', [volumeId || '']),
}
const http = {
  async list() { const { data } = await axios.get(`${API_BASE}/wanted`); return data },
  async status(volumeId) { const { data } = await axios.get(`${API_BASE}/wanted/status`, { params: { volume_id: volumeId || '' } }); return data },
  async add(items) { const { data } = await axios.post(`${API_BASE}/wanted/add`, { items }); return data },
  async addList(o) { const { data } = await axios.post(`${API_BASE}/wanted/add-list`, o || {}); return data },
  async saveInstalled(volumeId) { const { data } = await axios.post(`${API_BASE}/wanted/save-installed`, { volume_id: volumeId || '' }); return data },
  async remove(keys, all) { const { data } = await axios.post(`${API_BASE}/wanted/remove`, { keys: keys || [], all: !!all }); return data },
  async load(volumeId) { const { data } = await axios.post(`${API_BASE}/wanted/load`, { volume_id: volumeId || '' }); return data },
}
export const wantedAPI = ipc || http
