import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Corrected copies of DPX frames for delivery (ADR-055 section 3): written on a running pod, as copies, under output/_delivery_v11/. The core over IPC in the app, the fake API in a browser.
const raw = core
  ? { run: (o) => core.invoke('dpxfix', 'run', [o]) }
  : { run: async (o) => (await axios.post(`${API_BASE}/dpxfix/run`, o)).data }
export const dpxfixAPI = { run: async (o) => { const r = (await raw.run(o)) || {}; return { results: Array.isArray(r.results) ? r.results : [], out_root: r.out_root || '', settings: r.settings || null } } }
