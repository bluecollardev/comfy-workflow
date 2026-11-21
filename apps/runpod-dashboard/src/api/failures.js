import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Graph failures (the core's failures.list): one record per failed graph run with its stage, node, message, log tail, missing models and recovery. The core over IPC in the app; HTTP against the fake API in a browser.
// A core without it answers "no core call failures.*": old: true, and the Failures section is hidden.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return fallback; throw e } }
const ipc = core && {
  list: guard((o) => core.invoke('failures', 'list', [o || {}]), { old: true }), retry: guard((id) => core.invoke('failures', 'retry', [id]), { old: true }),
  plan: guard((o) => core.invoke('failures', 'plan', [o]), { old: true }), dismiss: guard((o) => core.invoke('failures', 'dismiss', [o]), { old: true }), restore: guard((o) => core.invoke('failures', 'restore', [o]), { old: true }),
}
const http = {
  list: guard(async (o) => (await axios.get(`${API_BASE}/failures`, { params: o?.dismissed ? { dismissed: o.dismissed } : {} })).data, { old: true }),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/failures/retry`, { id })).data, { old: true }),
  plan: guard(async (o) => (await axios.post(`${API_BASE}/failures/plan`, o)).data, { old: true }),
  dismiss: guard(async (o) => (await axios.post(`${API_BASE}/failures/dismiss`, o)).data, { old: true }),
  restore: guard(async (o) => (await axios.post(`${API_BASE}/failures/restore`, o)).data, { old: true }),
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
  /** `o.dismissed`: 'hide' (default: what the Queue shows), 'only' (the dismissed ones) or 'all'; `dismissed_count` is how many are hidden (0 on a core that does not know dismissing). */
  list: async (o = {}) => { const r = await raw.list(o); if (r?.old) return { old: true, items: [], dismissed_count: 0 }; const items = Array.isArray(r) ? r : Array.isArray(r?.failures) ? r.failures : Array.isArray(r?.items) ? r.items : []; return { old: false, dismissed_count: Number(r?.dismissed_count) || 0, items: items.map(rec).sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))) } },
  /** Dismiss or restore: `{ ids }` or `{ all: true }`. plan({ ..., restore }) says how many it would cover and writes nothing. */
  plan: async (o) => { const r = await raw.plan(o); if (r?.old) throw new Error('Restart the app to dismiss failures'); return r },
  dismiss: async (o) => { const r = await raw.dismiss(o); if (r?.old) throw new Error('Restart the app to dismiss failures'); return r },
  restore: async (o) => { const r = await raw.restore(o); if (r?.old) throw new Error('Restart the app to restore failures'); return r },
  retry: async (id) => { const r = await raw.retry(id); if (r?.old) throw new Error('Restart the app to retry a failure'); return r || {} },
}
