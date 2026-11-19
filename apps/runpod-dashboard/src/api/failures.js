import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Graph failures (the core's failures.list): one record per failed graph run with its stage, node, message, log tail, missing models and recovery. The core over IPC in the app; HTTP against the fake API in a browser.
// A core without it answers "no core call failures.*": old: true, and the Failures section is hidden.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return fallback; throw e } }
const ipc = core && { list: guard(() => core.invoke('failures', 'list', []), { old: true }), retry: guard((id) => core.invoke('failures', 'retry', [id]), { old: true }) }
const http = {
  list: guard(async () => (await axios.get(`${API_BASE}/failures`)).data, { old: true }),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/failures/retry`, { id })).data, { old: true }),
}
const raw = ipc || http
/** The core's record (libs/core/src/failures.ts): time, graph + graph_version, node_id + node_type, log_tail (lines), missing_models [{ name, where_on_volume }], attempt. The older names (at, version, node, retries) still work. */
const rec = (r) => {
  const time = r.time || r.at || '', nodeId = r.node_id ?? r.node?.id ?? '', nodeType = r.node_type ?? r.node?.type ?? ''
  const attempt = Number(r.attempt ?? (r.retries != null ? r.retries + 1 : 1)) || 1
  return { ...r, id: r.id || `${time}|${r.shot}|${r.graph}`, time, version: r.graph_version ?? r.version ?? '', node: nodeId || nodeType ? { id: String(nodeId), type: nodeType } : null, attempt,
    log_text: Array.isArray(r.log_tail) ? r.log_tail.join('\n') : String(r.log_tail || ''), missing_models: (Array.isArray(r.missing_models) ? r.missing_models : []).map((m) => ({ name: m.name, where: Array.isArray(m.where) ? m.where : m.where_on_volume ? [String(m.where_on_volume)] : [] })), retryable: !!r.retryable }
}
export const failuresAPI = {
  list: async () => { const r = await raw.list(); if (r?.old) return { old: true, items: [] }; const items = Array.isArray(r) ? r : Array.isArray(r?.failures) ? r.failures : Array.isArray(r?.items) ? r.items : []; return { old: false, items: items.map(rec).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))) } },
  retry: async (id) => { const r = await raw.retry(id); if (r?.old) throw new Error('Restart the app to retry a failure'); return r || {} },
}
