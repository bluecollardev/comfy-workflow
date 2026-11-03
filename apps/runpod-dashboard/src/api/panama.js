import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The Panama exchange bucket as an Import Shot Pack source (docs/ADR-015): rounds listed and downloaded to a staging
// folder with the AWS CLI profile `panama`; the import then runs on that folder. The core over IPC in the app; the
// same calls over HTTP against the fake API in a browser.
const ipc = core && {
  status: () => core.invoke('panama', 'status'),
  rounds: () => core.invoke('panama', 'rounds'),
  size: (round) => core.invoke('panama', 'size', [round]),
  pull: (round) => core.invoke('panama', 'pull', [round]),
  job: (id) => core.invoke('panama', 'job', [id]),
  cancel: (id) => core.invoke('panama', 'cancel', [id]),
}
const http = {
  async status() { const { data } = await axios.get(`${API_BASE}/panama/status`); return data },
  async rounds() { const { data } = await axios.get(`${API_BASE}/panama/rounds`); return data },
  async size(round) { const { data } = await axios.get(`${API_BASE}/panama/size`, { params: { round } }); return data },
  async pull(round) { const { data } = await axios.post(`${API_BASE}/panama/pull`, { round }); return data },
  async cancel(id) { const { data } = await axios.post(`${API_BASE}/panama/cancel`, { id }); return data },
  async job(id) { const { data } = await axios.get(`${API_BASE}/panama/job`, { params: { id } }); return data },
}
export const panamaAPI = ipc || http
