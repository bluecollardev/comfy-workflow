import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The history store (libs/core/src/history.ts): pod and job events, spend worked out from them, and the ComfyUI runs of a
// running pod. The core over IPC in the app; the same calls over HTTP against the fake API in a browser.
const ipc = core && {
  list: (kind, limit) => core.invoke('history', 'list', [kind, limit]),
  spend: () => core.invoke('history', 'spend'),
  runs: (podId) => core.invoke('history', 'runs', [podId]),
  export: (format, what) => core.invoke('history', 'export', [{ format, what }]),
}
const http = {
  async list(kind, limit) { const { data } = await axios.get(`${API_BASE}/history`, { params: { kind, limit } }); return data },
  async spend() { const { data } = await axios.get(`${API_BASE}/history/spend`); return data },
  async export(format, what) { const { data } = await axios.get(`${API_BASE}/history/export`, { params: { format, what } }); return data },
  async runs(podId) { const { data } = await axios.get(`${API_BASE}/history/runs`, { params: { pod_id: podId } }); return data },
}
export const historyAPI = ipc || http
