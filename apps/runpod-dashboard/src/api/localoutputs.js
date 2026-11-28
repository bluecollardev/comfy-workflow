import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Outputs window's Local source: one folder of this PC's ComfyUI-Shared/output/ at a time, read-only. The core over IPC in the app; HTTP against the fake API in a browser.
export const localOutputsAPI = {
  browse: async (prefix = '') => {
    const r = core ? await core.invoke('localoutputs', 'browse', [prefix]) : (await axios.get(`${API_BASE}/local-outputs/browse`, { params: { prefix } })).data
    return { ...(r || {}), prefix: r?.prefix ?? prefix, folders: Array.isArray(r?.folders) ? r.folders : [], files: Array.isArray(r?.files) ? r.files : [] }
  },
}
