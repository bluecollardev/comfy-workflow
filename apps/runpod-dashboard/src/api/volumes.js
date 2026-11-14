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
  plan: (id) => core.invoke('volumes', 'plan', [id]),
  browse: (id) => core.invoke('volumes', 'browse', [id]),
  erase: (id, keys, o) => core.invoke('volumes', 'erase', [id, keys, o]),
  job: (id) => core.invoke('volumes', 'job', [id]),
  cancel: (id) => core.invoke('volumes', 'cancel', [id]),
  erasable: () => core.invoke('volumes', 'erasable'),
}
const http = {
  async list() { const { data } = await axios.get(`${API_BASE}/volumes`); return data },
  async create(input) { const { data } = await axios.post(`${API_BASE}/volumes`, input); return data },
  async resize(id, size_gb) { const { data } = await axios.patch(`${API_BASE}/volumes/${encodeURIComponent(id)}`, { size_gb }); return data },
  async remove(id) { const { data } = await axios.delete(`${API_BASE}/volumes/${encodeURIComponent(id)}`); return data },
  async plan(id) { const { data } = await axios.get(`${API_BASE}/volumes/${encodeURIComponent(id)}/plan`); return data },
  async browse(id) { const { data } = await axios.post(`${API_BASE}/volumes/${encodeURIComponent(id)}/browse`); return data },
  async erase(id, keys, o) { const { data } = await axios.post(`${API_BASE}/volumes/${encodeURIComponent(id)}/erase`, { keys, ...o }); return data },
  async job(id) { const { data } = await axios.get(`${API_BASE}/volumes/job`, { params: { id } }); return data },
  async cancel(id) { const { data } = await axios.post(`${API_BASE}/volumes/job/cancel`, { id }); return data },
  async erasable() { const { data } = await axios.get(`${API_BASE}/volumes/erasable`); return data },
  async useAsDefault(id) { const { data } = await axios.post(`${API_BASE}/volumes/${encodeURIComponent(id)}/default`); return data },
}
export const volumesAPI = ipc || http
