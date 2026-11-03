import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// MCP servers this app uses (docs/ADR-019): BH's Panama console. The core over IPC in the app; HTTP against the fake API in a browser.
const ipc = core && {
  status: () => core.invoke('remote', 'status'),
  check: () => core.invoke('remote', 'check'),
  setKey: (key) => core.invoke('remote', 'setKey', [key ?? null]),
}
const http = {
  async status() { const { data } = await axios.get(`${API_BASE}/remote/status`); return data },
  async check() { const { data } = await axios.post(`${API_BASE}/remote/check`); return data },
  async setKey(key) { const { data } = await axios.put(`${API_BASE}/remote/key`, { key: key ?? null }); return data },
}
export const remoteAPI = ipc || http
