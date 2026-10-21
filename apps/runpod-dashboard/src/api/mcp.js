import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Connect › MCP tab: the two endpoints with their client snippets (the bridge's target URL flows into
// them), what the bridge can point at, and Check (the core spawns the server over stdio and lists its tools).
const ipc = core && {
  endpoints: (comfy) => core.invoke('mcp', 'endpoints', [comfy || '']),
  targets: () => core.invoke('mcp', 'targets'),
  probe: (id, comfy) => core.invoke('mcp', 'probe', [id, comfy || '']),
}
const http = {
  async endpoints(comfy) { const { data } = await axios.get(`${API_BASE}/mcp/endpoints`, { params: comfy ? { comfy } : {} }); return data },
  async targets() { const { data } = await axios.get(`${API_BASE}/mcp/targets`); return data },
  async probe(id, comfy) { const { data } = await axios.post(`${API_BASE}/mcp/probe`, { id, comfy: comfy || null }); return data },
}
export const mcpAPI = ipc || http
