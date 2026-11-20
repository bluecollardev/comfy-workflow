import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The logs a pod left behind (saved at the end of each run, when it stops and before it is deleted): the core over IPC in the app, the fake API in a browser.
const ipc = core && {
  list: (podId) => core.invoke('podlogs', 'list', [{ pod_id: podId }]),
  read: (name, tail) => core.invoke('podlogs', 'read', [name, { tail }]),
  save: (podId) => core.invoke('podlogs', 'save', [podId, { reason: 'asked for in the window' }]),
  purge: (podId) => core.invoke('podlogs', 'purge', [{ ...(podId ? { pod_id: podId } : {}), confirmed: true }]),
}
const http = {
  async list(podId) { return (await axios.get(`${API_BASE}/podlogs`, { params: { pod_id: podId } })).data },
  async read(name, tail) { return (await axios.get(`${API_BASE}/podlogs/read`, { params: { name, tail } })).data },
  async save(podId) { return (await axios.post(`${API_BASE}/podlogs/save`, { pod_id: podId })).data },
  async purge(podId) { return (await axios.post(`${API_BASE}/podlogs/purge`, { ...(podId ? { pod_id: podId } : {}), confirmed: true })).data },
}
const raw = ipc || http
export const podlogsAPI = {
  list: async (podId) => { try { const r = (await raw.list(podId)) || {}; return { logs: Array.isArray(r.logs) ? r.logs : [], dir: r.dir || '' } } catch { return { logs: [], dir: '' } } },
  read: async (name, tail) => (await raw.read(name, tail)) || { name, text: '' },
  save: async (podId) => raw.save(podId),
  purge: async (podId) => raw.purge(podId),
}
