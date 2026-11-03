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
  remove: (round) => core.invoke('panama', 'remove', [round]),
  // Pod mode (docs/ADR-022): the round staged on the network volume, pulled by a pod. The core reports status().pod.available.
  podRounds: () => core.invoke('panama', 'podRounds'),
  podPlan: (round) => core.invoke('panama', 'podPlan', [round]),
  podPull: (round) => core.invoke('panama', 'podPull', [round]),
  podJob: (id) => core.invoke('panama', 'podJob', [id]),
  podCancel: (id) => core.invoke('panama', 'podCancel', [id]),
  podRemove: (round) => core.invoke('panama', 'podRemove', [round]),
}
const http = {
  async status() { const { data } = await axios.get(`${API_BASE}/panama/status`); return data },
  async rounds() { const { data } = await axios.get(`${API_BASE}/panama/rounds`); return data },
  async size(round) { const { data } = await axios.get(`${API_BASE}/panama/size`, { params: { round } }); return data },
  async pull(round) { const { data } = await axios.post(`${API_BASE}/panama/pull`, { round }); return data },
  async remove(round) { const { data } = await axios.delete(`${API_BASE}/panama/staged`, { params: { round } }); return data },
  async cancel(id) { const { data } = await axios.post(`${API_BASE}/panama/cancel`, { id }); return data },
  async job(id) { const { data } = await axios.get(`${API_BASE}/panama/job`, { params: { id } }); return data },
  async podRounds() { const { data } = await axios.get(`${API_BASE}/panama/pod/rounds`); return data },
  async podPlan(round) { const { data } = await axios.get(`${API_BASE}/panama/pod/plan`, { params: { round } }); return data },
  async podPull(round) { const { data } = await axios.post(`${API_BASE}/panama/pod/pull`, { round }); return data },
  async podJob(id) { const { data } = await axios.get(`${API_BASE}/panama/pod/job`, { params: { id } }); return data },
  async podCancel(id) { const { data } = await axios.post(`${API_BASE}/panama/pod/cancel`, { id }); return data },
  async podRemove(round) { const { data } = await axios.delete(`${API_BASE}/panama/pod/staged`, { params: { round } }); return data },
}
export const panamaAPI = ipc || http
