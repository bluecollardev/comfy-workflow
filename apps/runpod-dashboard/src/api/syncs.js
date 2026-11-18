import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Sync explorer and Sync logs (docs/ADR-046): what is syncing now, what finished, the log of each run, and what auto sync is watching.
// The core over IPC in the app; HTTP against the fake API in a browser. A core started before this existed answers "no core call syncs.*":
// the lists come back empty with old: true (the window says to restart the app) and reading a log throws the same advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use the sync explorer (its core is older than this window)'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true }

const ipc = core && {
  active: guard(() => core.invoke('syncs', 'active', []), OLD),
  recent: guard((podId, limit) => core.invoke('syncs', 'recent', [podId || null, limit]), OLD),
  log: guard((runId, o) => core.invoke('syncs', 'log', [runId, o]), mustRestart),
  watch: guard(() => core.invoke('syncs', 'watch', []), OLD),
}
const http = {
  active: guard(async () => (await axios.get(`${API_BASE}/syncs/active`)).data, OLD),
  recent: guard(async (podId, limit) => (await axios.get(`${API_BASE}/syncs/recent`, { params: { ...(podId ? { pod_id: podId } : {}), limit } })).data, OLD),
  log: guard(async (runId, o) => (await axios.get(`${API_BASE}/syncs/log`, { params: { run_id: runId, ...o } })).data, mustRestart),
  watch: guard(async () => (await axios.get(`${API_BASE}/syncs/watch`)).data, OLD),
}
const raw = ipc || http
const list = (x) => (Array.isArray(x) ? x : Array.isArray(x?.items) ? x.items : [])
/** Answers are normalised: lists are always lists; old: true says the core predates the explorer. */
export const syncsAPI = {
  active: async () => { const r = await raw.active(); return { old: !!r?.old, items: list(r) } },
  recent: async (podId, limit = 30) => { const r = await raw.recent(podId, limit); return { old: !!r?.old, runs: Array.isArray(r) ? r : [] } },
  log: async (runId, { offset = 0, limit = 500, level = '' } = {}) => { const r = (await raw.log(runId, { offset, limit, ...(level ? { level } : {}) })) || {}; return { run_id: runId, lines: Array.isArray(r.lines) ? r.lines : [], total: r.total ?? 0, truncated: !!r.truncated } },
  watch: async () => { const r = (await raw.watch()) || {}; return { old: !!r.old, paused: !!r.paused, pull: r.pull || [], push: r.push || [], events: r.events || [] } },
}
