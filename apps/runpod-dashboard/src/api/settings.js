import axios from 'axios'
import { API_BASE } from './pods'
import { core } from './bridge'

// Secrets and machine-wide settings: the RunPod API key. The panel only ever sees whether it is
// set and its last four characters. Stored by the core in ~/.config/runpod-pod-manager/.env.
const ipc = core && {
  get: () => core.invoke('settings', 'get'),
  set: (values) => core.invoke('settings', 'set', [values]),
}
const http = {
  async get() { const { data } = await axios.get(`${API_BASE}/settings`); return data },
  async set(values) { const { data } = await axios.put(`${API_BASE}/settings`, values); return data },
}
export const settingsAPI = ipc || http
