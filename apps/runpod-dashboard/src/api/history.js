import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The history store (libs/core/src/history.ts): pod and job events, spend worked out from them, and the ComfyUI runs of a
// running pod. The core over IPC in the app; the same calls over HTTP against the fake API in a browser.
const ipc = core && {
  list: (kind, limit) => core.invoke('history', 'list', [kind, limit]),
  spend: () => core.invoke('history', 'spend'),
  note: (e) => core.invoke('history', 'note', [e]),
  runs: (podId) => core.invoke('history', 'runs', [podId]),
  saved: (podId, volumeId) => core.invoke('history', 'saved', [{ ...(podId ? { pod_id: podId } : {}), ...(volumeId ? { volume_id: volumeId } : {}) }]),
  export: (format, what) => core.invoke('history', 'export', [{ format, what }]),
  outputSources: (ctx) => core.invoke('history', 'outputSources', [ctx || {}]),
  listOutputs: (ctx, o) => core.invoke('history', 'listOutputs', [ctx || {}, o || {}]),
  outputsStatus: (jobId) => core.invoke('history', 'outputsStatus', [jobId]),
  outputsCancel: (jobId) => core.invoke('history', 'outputsCancel', [jobId]),
  logs: (podId, level, lines) => core.invoke('history', 'logs', [podId, { level: LEVEL[level] || 'all', lines }]),
}
const http = {
  async list(kind, limit) { const { data } = await axios.get(`${API_BASE}/history`, { params: { kind, limit } }); return data },
  async note(e) { const { data } = await axios.post(`${API_BASE}/history/note`, e); return data },
  async spend() { const { data } = await axios.get(`${API_BASE}/history/spend`); return data },
  async export(format, what) { const { data } = await axios.get(`${API_BASE}/history/export`, { params: { format, what } }); return data },
  async runs(podId) { const { data } = await axios.get(`${API_BASE}/history/runs`, { params: { pod_id: podId } }); return data },
  /** The saved runs (libs/core/src/outputruns.ts): what runs wrote, kept past a pod stop; newest first, narrowed to a pod and/or the network volume. */
  async saved(podId, volumeId) { const { data } = await axios.get(`${API_BASE}/history/saved`, { params: { pod_id: podId, volume_id: volumeId } }); return data },
  /** Which output sources can answer (docs/ADR-045): [{ id, name, hint, ok, reason }]. */
  async outputSources(ctx) { const { data } = await axios.get(`${API_BASE}/history/output-sources`, { params: ctx || {} }); return data },
  /** The output sources merged (or one `source`): { sources, runs, folders, prefix, capped, total, volume_id }; `prefix` browses the volume's comfy-shared/output/. */
  async listOutputs(ctx, o) { const { data } = await axios.get(`${API_BASE}/history/outputs`, { params: { ...(ctx || {}), source: o?.source, prefix: o?.prefix, fresh: o?.fresh ? 1 : undefined, all: o?.all ? 1 : undefined, job: o?.job ? 1 : undefined } }); return data },
  /** The whole-tree listing as a job (`all` with `job`): { state: 'listing'|'done'|'failed'|'cancelled', files_seen, folders_seen, elapsed_s, result? }. */
  async outputsStatus(jobId) { const { data } = await axios.get(`${API_BASE}/history/outputs/status`, { params: { job_id: jobId } }); return data },
  async outputsCancel(jobId) { const { data } = await axios.post(`${API_BASE}/history/outputs/cancel`, { job_id: jobId }); return data },
  /** ComfyUI's own server log of a pod: { entries: [{ ts, level: 'error'|'warning'|'info', text }] (newest last), truncated }. */
  async logs(podId, level, lines) { const { data } = await axios.get(`${API_BASE}/history/logs`, { params: { pod_id: podId, level: LEVEL[level] || 'all', lines } }); return data },
}
/** Call `cb` when the history changes; returns the stop function. In the app the main process pushes; where it cannot (a browser, an older host) the page asks again every 5 seconds. */
export function onHistoryChange(cb, pollMs = 5000) {
  if (core?.history?.onChange) return core.history.onChange(cb)
  const t = setInterval(cb, pollMs)
  return () => clearInterval(t)
}
/** The window says warning / error; the core's log filter says warnings / errors. */
const LEVEL = { all: 'all', warning: 'warnings', error: 'errors' }
export const historyAPI = ipc || http
