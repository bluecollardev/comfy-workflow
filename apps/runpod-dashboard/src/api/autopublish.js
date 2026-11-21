import axios from 'axios'
import { core } from './bridge'
import { API_BASE } from './pods'

// Auto-publish (docs/ADR-050, amendment 2026-11-19): a standing rule that uploads approved review videos by itself, with a cancel window and a daily cap.
// The core over IPC in the app; HTTP against the fake API in a browser. A core without it answers "no core call autopublish.*": everything hides (old: true), writes throw the advice.
const NO_CALL = /no core call/i
const noCall = (e) => NO_CALL.test(String(e?.response?.data?.detail || e?.message || e))
export const RESTART = 'Restart the app to use Auto-publish'
const guard = (fn, fallback) => async (...a) => { try { return await fn(...a) } catch (e) { if (noCall(e)) return typeof fallback === 'function' ? fallback() : fallback; throw e } }
const mustRestart = () => { throw new Error(RESTART) }
const OLD = { old: true }
const ipc = core && {
  status: guard(() => core.invoke('autopublish', 'status', []), OLD),
  settings: guard(() => core.invoke('autopublish', 'settings', []), OLD),
  setSettings: guard((o) => core.invoke('autopublish', 'setSettings', [o]), mustRestart),
  off: guard(() => core.invoke('autopublish', 'off', []), mustRestart),
  reviews: guard(() => core.invoke('autopublish', 'reviews', []), OLD),
  approvals: guard(() => core.invoke('autopublish', 'approvals', []), OLD),
  approve: guard((o) => core.invoke('autopublish', 'approve', [o]), mustRestart),
  revoke: guard((o) => core.invoke('autopublish', 'revoke', [o]), mustRestart),
  cancel: guard((o) => core.invoke('autopublish', 'cancel', [o]), mustRestart),
  publishNow: guard((o) => core.invoke('autopublish', 'publishNow', [o]), mustRestart),
  publishAllDry: guard((o) => core.invoke('autopublish', 'publishAllDry', [o]), mustRestart),
  purgeDryRuns: guard((o) => core.invoke('autopublish', 'purgeDryRuns', [o]), mustRestart),
  restoreDryRuns: guard(() => core.invoke('autopublish', 'restoreDryRuns', []), mustRestart),
  scanVolume: guard(() => core.invoke('autopublish', 'scanVolume', []), mustRestart),
  dryRunReport: guard(() => core.invoke('autopublish', 'dryRunReport', []), { old: true }),
  hold: guard((o) => core.invoke('autopublish', 'hold', [o]), mustRestart),
  release: guard((o) => core.invoke('autopublish', 'release', [o]), mustRestart),
  holds: guard(() => core.invoke('autopublish', 'holds', []), { old: true }),
  generateExisting: guard((o) => core.invoke('autopublish', 'generateExisting', [o]), mustRestart),
}
const http = {
  status: guard(async () => (await axios.get(`${API_BASE}/autopublish/status`)).data, OLD),
  settings: guard(async () => (await axios.get(`${API_BASE}/autopublish/settings`)).data, OLD),
  setSettings: guard(async (o) => (await axios.put(`${API_BASE}/autopublish/settings`, o)).data, mustRestart),
  off: guard(async () => (await axios.post(`${API_BASE}/autopublish/off`)).data, mustRestart),
  reviews: guard(async () => (await axios.get(`${API_BASE}/autopublish/reviews`)).data, OLD),
  approvals: guard(async () => (await axios.get(`${API_BASE}/autopublish/approvals`)).data, OLD),
  approve: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/approve`, o)).data, mustRestart),
  revoke: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/revoke`, o)).data, mustRestart),
  cancel: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/cancel`, o)).data, mustRestart),
  publishNow: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/publish-now`, o)).data, mustRestart),
  publishAllDry: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/publish-all-dry`, o)).data, mustRestart),
  purgeDryRuns: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/purge-dry-runs`, o)).data, mustRestart),
  restoreDryRuns: guard(async () => (await axios.post(`${API_BASE}/autopublish/restore-dry-runs`, {})).data, mustRestart),
  scanVolume: guard(async () => (await axios.post(`${API_BASE}/autopublish/scan-volume`, {})).data, mustRestart),
  dryRunReport: guard(async () => (await axios.get(`${API_BASE}/autopublish/dry-run-report`)).data, { old: true }),
  hold: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/hold`, o)).data, mustRestart),
  release: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/release`, o)).data, mustRestart),
  holds: guard(async () => (await axios.get(`${API_BASE}/autopublish/holds`)).data, { old: true }),
  generateExisting: guard(async (o) => (await axios.post(`${API_BASE}/autopublish/generate-existing`, o)).data, mustRestart),
}
const raw = ipc || http
const list = (x) => (Array.isArray(x) ? x : Array.isArray(x?.items) ? x.items : [])
/** Normalised: lists are lists; old: true says the core predates Auto-publish. Secrets are never part of any of it. */
export const autopublishAPI = {
  status: async () => { const r = (await raw.status()) || {}; return r.old ? { old: true } : { old: false, enabled: !!r.enabled, dry_run: r.dry_run !== false, standing: r.standing || null, window_minutes: r.window_minutes ?? 10, daily_cap: r.daily_cap ?? null, targets: r.targets || { s3: true, slack: false, tunnel: false }, today: r.today || { count: 0, left: r.daily_cap ?? null }, destination: r.destination || '', slack_dry_run: r.slack_dry_run && typeof r.slack_dry_run === 'object' ? r.slack_dry_run : null, require_approval: typeof r.require_approval === 'boolean' ? r.require_approval : undefined, watching: r.watching && typeof r.watching === 'object' ? r.watching : null, generate: r.generate && typeof r.generate === 'object' ? r.generate : null, pending: list(r.pending), recent: list(r.recent) } },
  settings: async () => { const r = (await raw.settings()) || {}; return r.old ? { old: true } : { old: false, enabled: !!r.enabled, dry_run: r.dry_run !== false, window_minutes: r.window_minutes ?? 10, daily_cap: r.daily_cap ?? null, targets: r.targets || { s3: true, slack: !!r.slack, tunnel: false }, target_state: r.target_state || {}, standing: r.standing || null, destination: r.destination || '', ready: !!r.ready, problem: r.problem || '' } },
  setSettings: async (o) => (await raw.setSettings(o)) || {},
  off: async () => (await raw.off()) || {},
  reviews: async () => { const r = (await raw.reviews()) || {}; return r.old ? { old: true, reviews: [] } : { old: false, reviews: Array.isArray(r.reviews) ? r.reviews : list(r) } },
  approvals: async () => { const r = await raw.approvals(); return r?.old ? { old: true, approvals: [] } : { old: false, approvals: list(r) } },
  approve: async (o) => (await raw.approve(o)) || {},
  revoke: async (o) => (await raw.revoke(o)) || {},
  cancel: async (o) => (await raw.cancel(o)) || {},
  publishNow: async (o) => (await raw.publishNow(o)) || {},
  /** Publish every dry-run entry for real, one at a time, under a named yes (Queue > Publishing). */
  publishAllDry: async (o) => (await raw.publishAllDry(o)) || {},
  purgeDryRuns: async (o) => (await raw.purgeDryRuns(o)) || {},
  restoreDryRuns: async () => (await raw.restoreDryRuns()) || {},
  /** Scan now: list the volume's deliver/ at once (the core runs it on its own slower cycle too). */
  scanVolume: async () => (await raw.scanVolume()) || {},
  /** The Slack summary of a dry run as text (what the dry-run post says). */
  dryRunReport: async () => { const r = (await raw.dryRunReport()) || {}; return r.old ? { old: true, text: '' } : { old: false, text: String(r.text || '') } },
  /** A hold keeps a shot version from ever being auto-published; Release lifts it. `holds()` lists them ([] on an older core). */
  hold: async (o) => (await raw.hold(o)) || {},
  release: async (o) => (await raw.release(o)) || {},
  holds: async () => { const r = await raw.holds(); return r?.old ? { old: true, holds: [] } : { old: false, holds: Array.isArray(r) ? r : Array.isArray(r?.holds) ? r.holds : [] } },
  /** Generate for what is already there: `{ dry_run: true }` is the free preview, `{ confirm: true, approved_by, limit }` starts the renders. */
  generateExisting: async (o) => (await raw.generateExisting(o)) || {},
}
