import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Run workflows (docs/ADR-037): the graphs in a pod's Workflows panel, and running chosen ones. The core over IPC in the app; HTTP against the fake API in a browser.
const ipc = core && {
  list: (podId) => core.invoke('runflows', 'list', [podId]),
  run: (podId, paths, approvedBy) => core.invoke('runflows', 'run', [podId, paths, approvedBy || '']),
  job: (id) => core.invoke('runflows', 'job', [id]),
  cancel: (id) => core.invoke('runflows', 'cancel', [id]),
}
const http = {
  async list(podId) { const { data } = await axios.get(`${API_BASE}/runflows`, { params: { pod_id: podId } }); return data },
  async run(podId, paths, approvedBy) { const { data } = await axios.post(`${API_BASE}/runflows`, { pod_id: podId, paths, approved_by: approvedBy }); return data },
  async job(id) { const { data } = await axios.get(`${API_BASE}/runflows/${id}`); return data },
  async cancel(id) { const { data } = await axios.delete(`${API_BASE}/runflows/${id}`); return data },
}
export const runflowsAPI = ipc || http
