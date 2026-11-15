import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The agent shell guard (docs/ADR-042 section 10): is it switched on (a system-wide setting), and is its hook installed in this user's Claude Code settings.
// status() -> { enabled, installed, settings_file, script_file, error? }; set(on) switches it and returns the status. The core over IPC in the app; HTTP against the fake API in a browser.
const ipc = core && {
  status: () => core.invoke('agentguard', 'status'),
  set: (on) => core.invoke('agentguard', 'set', [!!on]),
}
const http = {
  async status() { const { data } = await axios.get(`${API_BASE}/agentguard`); return data },
  async set(on) { const { data } = await axios.post(`${API_BASE}/agentguard`, { enabled: !!on }); return data },
}
export const agentguardAPI = ipc || http
