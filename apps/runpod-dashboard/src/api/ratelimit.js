import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// RunPod's request limit (ADR-042 section 18): whether the app is backing off, until when, how old the lists on screen are.
// Local state in the core: asking makes no request to RunPod.
const ipc = core && {
  status: () => core.invoke('ratelimit', 'status'),
}
const http = {
  async status() { const { data } = await axios.get(`${API_BASE}/ratelimit`); return data },
}
export const ratelimitAPI = ipc || http
