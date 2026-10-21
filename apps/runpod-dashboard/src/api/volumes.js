import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Network volumes: the account's volumes with their pods, cost and datacenter; create, resize, delete, use as default.
const ipc = core && {
  list: () => core.invoke('volumes', 'list'),
  create: (input) => core.invoke('volumes', 'create', [input]),
  resize: (id, size_gb) => core.invoke('volumes', 'resize', [id, size_gb]),
  remove: (id) => core.invoke('volumes', 'remove', [id]),
  useAsDefault: (id) => core.invoke('volumes', 'useAsDefault', [id]),
}
const http = {
  async list() { const { data } = await axios.get(`${API_BASE}/volumes`); return data },
  async create(input) { const { data } = await axios.post(`${API_BASE}/volumes`, input); return data },
  async resize(id, size_gb) { const { data } = await axios.patch(`${API_BASE}/volumes/${encodeURIComponent(id)}`, { size_gb }); return data },
  async remove(id) { const { data } = await axios.delete(`${API_BASE}/volumes/${encodeURIComponent(id)}`); return data },
  async useAsDefault(id) { const { data } = await axios.post(`${API_BASE}/volumes/${encodeURIComponent(id)}/default`); return data },
}
export const volumesAPI = ipc || http
