import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// The EDL (docs/ADR-050, Kyle 2026-11-19): the core reads the V11 EDL itself; the app asks what is loaded, loads it, lists the elements and looks a clip up. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates it answers "no core call edl.*": everything comes back old: true and the app hides what depends on it.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return fallback; throw e } }
const OLD = { old: true }

const ipc = core && {
  status: guard(() => core.invoke('edl', 'status', []), OLD),
  load: guard((o) => core.invoke('edl', 'load', o ? [o] : []), OLD),
  elements: guard(() => core.invoke('edl', 'elements', []), OLD),
  lookup: guard((o) => core.invoke('edl', 'lookup', [o]), OLD),
}
const http = {
  status: guard(async () => (await axios.get(`${API_BASE}/edl/status`)).data, OLD),
  load: guard(async (o) => (await axios.post(`${API_BASE}/edl/load`, o || {})).data, OLD),
  elements: guard(async () => (await axios.get(`${API_BASE}/edl/elements`)).data, OLD),
  lookup: guard(async (o) => (await axios.post(`${API_BASE}/edl/lookup`, o)).data, OLD),
}
const raw = ipc || http
const norm = (r) => (r?.old ? { old: true, loaded: false } : { old: false, loaded: !!r?.loaded, source: r?.source || '', sha256: r?.sha256 || '', events: r?.events ?? 0, elements: r?.elements ?? 0, loaded_at: r?.loaded_at || '', error: r?.error || '' })

export const edlAPI = {
  status: async () => norm(await raw.status()),
  /** Load (or reload) the EDL; `opts.source` is a bucket/key or a local file. Returns the new status; a failure throws with the core's text. */
  load: async (opts) => norm(await raw.load(opts)),
  elements: async () => { const r = await raw.elements(); return Array.isArray(r) ? r : Array.isArray(r?.elements) ? r.elements : [] },
  lookup: async (o) => (await raw.lookup(o)) || { match: 'none' },
}
