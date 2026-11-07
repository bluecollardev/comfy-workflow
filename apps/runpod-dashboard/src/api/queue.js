import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The round-import queue (docs/ADR-038). The core over IPC in the app; HTTP against the fake API in a browser.
const ipc = core && {
  plan: (round, opts) => core.invoke('queue', 'plan', [round, opts]),
  import: (round, opts) => core.invoke('queue', 'import', [round, opts]),
  list: () => core.invoke('queue', 'list'),
  cancelTask: (id) => core.invoke('queue', 'cancelTask', [id]),
  cancelImport: (id) => core.invoke('queue', 'cancelImport', [id]),
  retryTask: (id) => core.invoke('queue', 'retryTask', [id]),
  setLimits: (id, limits) => core.invoke('queue', 'setLimits', [id, limits]),
}
const http = {
  async plan(round, opts) { const { data } = await axios.post(`${API_BASE}/queue/plan`, { round, ...opts }); return data },
  async import(round, opts) { const { data } = await axios.post(`${API_BASE}/queue/import`, { round, ...opts }); return data },
  async list() { const { data } = await axios.get(`${API_BASE}/queue`); return data },
  async cancelTask(id) { const { data } = await axios.post(`${API_BASE}/queue/tasks/${id}/cancel`); return data },
  async cancelImport(id) { const { data } = await axios.post(`${API_BASE}/queue/imports/${id}/cancel`); return data },
  async retryTask(id) { const { data } = await axios.post(`${API_BASE}/queue/tasks/${id}/retry`); return data },
  async setLimits(id, limits) { const { data } = await axios.post(`${API_BASE}/queue/imports/${id}/limits`, limits); return data },
}
export const queueAPI = ipc || http
