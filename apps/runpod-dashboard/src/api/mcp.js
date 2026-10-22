import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Connect › MCP tab: the two endpoints with their client snippets (the bridge's target URL flows into
// them), what the bridge can point at, Check (the core spawns the server over stdio and lists its tools, or asks the app's own HTTP endpoint) and the
// "Serve from the app" switch with its port.
const ipc = core && {
  endpoints: (comfy) => core.invoke('mcp', 'endpoints', [comfy || '']),
  targets: () => core.invoke('mcp', 'targets'),
  probe: (id, comfy) => core.invoke('mcp', 'probe', [id, comfy || '']),
  serve: (id, enabled, port) => core.invoke('mcp', 'serve', [id, !!enabled, port ?? null]),
}
const http = {
  async endpoints(comfy) { const { data } = await axios.get(`${API_BASE}/mcp/endpoints`, { params: comfy ? { comfy } : {} }); return data },
  async targets() { const { data } = await axios.get(`${API_BASE}/mcp/targets`); return data },
  async serve(id, enabled, port) { const { data } = await axios.put(`${API_BASE}/mcp/serve`, { id, enabled: !!enabled, port: port ?? null }); return data },
  async probe(id, comfy) { const { data } = await axios.post(`${API_BASE}/mcp/probe`, { id, comfy: comfy || null }); return data },
}
export const mcpAPI = ipc || http
