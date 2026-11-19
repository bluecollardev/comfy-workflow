import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Publishing (S3 and Slack): settings, the local output tree, a plan, a run with progress, links. The core over IPC in the app; HTTP against the fake API in a browser.
// A core that predates it answers "no core call publish.*": settings come back with old: true (the window hides or says to restart) and the other calls throw the same advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Publishing'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true }

const ipc = core && {
  settings: guard(() => core.invoke('publish', 'settings', []), OLD),
  setSettings: guard((o) => core.invoke('publish', 'setSettings', [o]), mustRestart),
  test: guard((o) => core.invoke('publish', 'test', [o]), mustRestart),
  local: guard((o) => core.invoke('publish', 'local', [o]), mustRestart),
  volume: guard((o) => core.invoke('publish', 'volume', [o]), mustRestart),
  volumeSize: guard((o) => core.invoke('publish', 'volumeSize', [o]), mustRestart),
  plan: guard((o) => core.invoke('publish', 'plan', [o]), mustRestart),
  run: guard((o) => core.invoke('publish', 'run', [o]), mustRestart),
  status: guard((id) => core.invoke('publish', 'status', id ? [id] : []), OLD),
  cancel: guard((id) => core.invoke('publish', 'cancel', [id]), mustRestart),
  rounds: guard(() => core.invoke('publish', 'rounds', []), { rounds: [] }),
  retry: guard((id) => core.invoke('publish', 'retry', [id]), mustRestart),
  slack: guard((o) => core.invoke('publish', 'slack', [o]), mustRestart),
  backfillScan: guard((o) => core.invoke('publish', 'backfill', ['scan', o]), mustRestart),
  backfillInventory: guard((id) => core.invoke('publish', 'backfill', ['inventory', { job_id: id }]), mustRestart),
  backfillPlan: guard((o) => core.invoke('publish', 'backfill', ['plan', o]), mustRestart),
  backfillRun: guard((o) => core.invoke('publish', 'backfill', ['run', o]), mustRestart),
}
const http = {
  settings: guard(async () => (await axios.get(`${API_BASE}/publish/settings`)).data, OLD),
  setSettings: guard(async (o) => (await axios.put(`${API_BASE}/publish/settings`, o)).data, mustRestart),
  test: guard(async (o) => (await axios.post(`${API_BASE}/publish/test`, o)).data, mustRestart),
  local: guard(async (o) => (await axios.get(`${API_BASE}/publish/local`, { params: { dir: o?.dir || '' } })).data, mustRestart),
  volume: guard(async (o) => (await axios.get(`${API_BASE}/publish/volume`, { params: { dir: o?.dir || '' } })).data, mustRestart),
  volumeSize: guard(async (o) => (await axios.get(`${API_BASE}/publish/volume-size`, { params: { path: o?.path || '' } })).data, mustRestart),
  plan: guard(async (o) => (await axios.post(`${API_BASE}/publish/plan`, o)).data, mustRestart),
  run: guard(async (o) => (await axios.post(`${API_BASE}/publish/run`, o)).data, mustRestart),
  status: guard(async (id) => (await axios.get(`${API_BASE}/publish/status`, { params: id ? { job_id: id } : {} })).data, OLD),
  cancel: guard(async (id) => (await axios.post(`${API_BASE}/publish/cancel`, { job_id: id })).data, mustRestart),
  rounds: guard(async () => (await axios.get(`${API_BASE}/publish/rounds`)).data, { rounds: [] }),
  retry: guard(async (id) => (await axios.post(`${API_BASE}/publish/retry`, { child_id: id })).data, mustRestart),
  slack: guard(async (o) => (await axios.post(`${API_BASE}/publish/slack`, o)).data, mustRestart),
  backfillScan: guard(async (o) => (await axios.post(`${API_BASE}/publish/backfill/scan`, o)).data, mustRestart),
  backfillInventory: guard(async (id) => (await axios.get(`${API_BASE}/publish/backfill/inventory`, { params: { job_id: id } })).data, mustRestart),
  backfillPlan: guard(async (o) => (await axios.post(`${API_BASE}/publish/backfill/plan`, o)).data, mustRestart),
  backfillRun: guard(async (o) => (await axios.post(`${API_BASE}/publish/backfill/run`, o)).data, mustRestart),
}
const raw = ipc || http
const EMPTY = { s3: { ready: false }, slack: { ready: false }, defaults: { targets: [], message: '' } }

/** Answers are normalised; old: true says the core predates Publishing. Secrets never come back, only hints. */
export const publishAPI = {
  settings: async () => { const r = (await raw.settings()) || {}; return r.old ? { old: true, ...EMPTY } : { old: false, s3: r.s3 || EMPTY.s3, slack: r.slack || EMPTY.slack, defaults: { targets: r.defaults?.targets || [], message: r.defaults?.message || '' } } },
  setSettings: async (o) => { const r = (await raw.setSettings(o)) || {}; return { old: false, s3: r.s3 || EMPTY.s3, slack: r.slack || EMPTY.slack, defaults: { targets: r.defaults?.targets || [], message: r.defaults?.message || '' } } },
  test: async (o) => (await raw.test(o)) || { ok: false, detail: '' },
  volume: async (o) => { const r = (await raw.volume(o)) || {}; return { dir: r.dir || '', parent: r.parent ?? null, entries: Array.isArray(r.entries) ? r.entries : [], truncated: r.truncated || 0 } },
  volumeSize: async (o) => { const r = (await raw.volumeSize(o)) || {}; return { files: r.files ?? 0, bytes: r.bytes ?? 0 } },
  local: async (o) => { const r = (await raw.local(o)) || {}; return { dir: r.dir || '', parent: r.parent ?? null, entries: Array.isArray(r.entries) ? r.entries : [], truncated: r.truncated || 0 } },
  plan: async (o) => { const r = (await raw.plan(o)) || {}; return { streamed_files: r.streamed_files ?? 0, streamed_bytes: r.streamed_bytes ?? 0, ok: !!r.ok, blockers: r.blockers || [], items: r.items || [], total_bytes: r.total_bytes ?? 0, files: r.files ?? (r.items || []).length, s3: r.s3 || null, slack: r.slack || null, refused: r.refused || [], layout: r.layout || '', round: r.round || '', sequences: Array.isArray(r.sequences) ? r.sequences : [], previews: Array.isArray(r.previews) ? r.previews : [], warnings: Array.isArray(r.warnings) ? r.warnings : [] } },
  run: async (o) => (await raw.run(o)) || {},
  status: async (id) => { const r = await raw.status(id); return { old: !!r?.old, jobs: Array.isArray(r?.jobs) ? r.jobs : [] } },
  cancel: async (id) => (await raw.cancel(id)) || {},
  /** The rounds already in the destination, newest first (a datalist for the Round field); [] on an older core. */
  rounds: async () => { const r = (await raw.rounds()) || {}; return Array.isArray(r.rounds) ? r.rounds.map((x) => (typeof x === 'string' ? { name: x } : x)).filter((x) => x?.name) : [] },
  retry: async (id) => (await raw.retry(id)) || {},
  slack: async (o) => (await raw.slack(o)) || {},
  /** Scan and backfill: a read-only scan of the four sources into an inventory, a plan over chosen rows, a run (as publish.run, with the streaming phase). */
  backfill: {
    scan: async (o) => (await raw.backfillScan(o)) || {},
    inventory: async (id) => { const r = (await raw.backfillInventory(id)) || {}; return { state: r.state || 'done', rows: Array.isArray(r.rows) ? r.rows : [], by_shot: r.by_shot || {}, totals: r.totals || null, unreadable: Array.isArray(r.unreadable) ? r.unreadable : [], scanned: r.scanned ?? null } },
    plan: async (o) => { const r = (await raw.backfillPlan(o)) || {}; return { ok: !!r.ok, blockers: r.blockers || [], items: r.items || [], total_bytes: r.total_bytes ?? 0, files: r.files ?? (r.items || []).length, s3: r.s3 || null, slack: r.slack || null, refused: r.refused || [], layout: r.layout || '', round: r.round || '', sequences: Array.isArray(r.sequences) ? r.sequences : [], previews: Array.isArray(r.previews) ? r.previews : [], warnings: Array.isArray(r.warnings) ? r.warnings : [] } },
    run: async (o) => (await raw.backfillRun(o)) || {},
  },
}
