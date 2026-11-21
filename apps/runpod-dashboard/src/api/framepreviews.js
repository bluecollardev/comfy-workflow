import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Frame previews of DPX sequences: a JOB on a running pod writes one small JPEG per frame (docs/ADR-055 section 11). The core over IPC in the app, the fake API in a browser.
const call = async (op, o) => (core ? core.invoke('framepreviews', op, [o || {}]) : (await axios.post(`${API_BASE}/framepreviews/${op}`, o || {})).data)
export const framePreviewsAPI = {
  start: (o) => call('start', o),
  status: (o) => call('status', o),
  cancel: (o) => call('cancel', o),
  relaunch: (o) => call('relaunch', o),
  list: (o) => call('list', o),
}
