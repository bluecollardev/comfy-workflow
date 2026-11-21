import { roundTemplateProblem } from './publish.js'
/** Auto-publish (docs/ADR-050 amendment), pure helpers: the countdown, an entry's line, a review version from its folder, the validation of the settings. `npm run dpx:test`. */
export const WINDOW_MAX = 120, CAP_MAX = 100
/** A volume scan is shown as "scanning" only for its first `SCAN_SHORT_MS`; a longer one is a background job (state 'slow': no spinner, no banner) and a failed one is 'error' (with its reason and a Retry). Never an endless spinner (Lucas, 2026-11-21). */
export const SCAN_SHORT_MS = 90_000
/** @returns {{ state: 'idle'|'scanning'|'slow'|'error', last: string|null, error: string, startedAt: string|null, minutes: number, progress: { shotsDone: number, shotsTotal: number, versionsDone: number }|null }} from `status.watching.volume` and `now` (ms). */
export function volumeScan(volume, now = Date.now()) {
  const v = volume && typeof volume === 'object' ? volume : {}, started = Date.parse(v.scan_started_at || ''), age = Number.isFinite(started) ? Math.max(0, now - started) : Infinity
  const pr = v.scanning && v.scan_progress && Number(v.scan_progress.shots_total) > 0 ? { shotsDone: Number(v.scan_progress.shots_done) || 0, shotsTotal: Number(v.scan_progress.shots_total), versionsDone: Number(v.scan_progress.versions_done) || 0 } : null
  const base = { last: v.scanned_at || null, error: v.scan_error?.reason || v.error || '', startedAt: v.scan_started_at || null, minutes: Number.isFinite(age) ? Math.max(1, Math.round(age / 60_000)) : 0, progress: pr }
  if (v.scanning) return { state: age <= SCAN_SHORT_MS ? 'scanning' : 'slow', ...base }
  if (base.error) return { state: 'error', ...base }
  return { state: 'idle', ...base }
}
/** 'v002' from 2. */
// a review version is the folder name ('v003', as the core sends it) or a number; never read 'v003' as a number (that made every version 'v000')
export const versionTag = (v) => { const t = String(v ?? '').trim().replace(/^v/i, ''); return `v${(/^\d+$/.test(t) ? t : String(Number(t) || 0)).padStart(3, '0')}` }
/** Seconds until `due` (ISO) from `now` (ms); never below 0; null when there is no time. */
export function secondsUntil(due, now = Date.now()) { const t = Date.parse(due); return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 1000)) : null }
/** 'm:ss' (minutes may pass 59: 61:05). */
export const countdownText = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`)
/** 'archival-085 v002 · 3 files · 2.1 GB' with the byte formatter given. */
export const entryLine = (e, size) => `${e.shot} ${versionTag(e.version)} · ${e.files} ${Number(e.files) === 1 ? 'file' : 'files'} · ${size(e.bytes || 0)}`
/** The shot and version of a review folder under deliver/: `deliver/archival-085/v003` -> { shot, version: 3 }; null for anything else (a file, another folder, a proxy). */
export function parseReviewPath(path) { const m = /^(?:output\/)?deliver\/([^/]+)\/v(\d+)\/?$/.exec(String(path || '')); return m ? { shot: m[1], version: Number(m[2]) } : null }
/** The folder of an Auto-generate key `<dir>/<stem>`: the dir, relative to the volume's output/ folder; '' when the key has no folder. */
export const folderOf = (key) => { const k = String(key || ''), i = k.lastIndexOf('/'); return i > 0 ? k.slice(0, i) : '' }
/** The review folder of a row, relative to the volume's output/ folder (what the Outputs window's folder listing takes): `deliver/archival-085/v002` from shot 'archival-085' and version 2 or 'v002'. */
export const reviewFolder = (shot, version) => `deliver/${shot}/${versionTag(version)}`
/**
 * Where "View In Outputs" on an Auto-publish row goes, or why it cannot: { ok: true, pod_id, folder }, or { ok: false, reason } with reason
 * 'nofolder' (no shot or version to name a folder), 'nothing' (no files: the review is not generated yet) or 'nopod' (no pod is attached to the volume, so there is no Outputs window to open it in).
 * "Generated" means the row's review has files: the row's own count, else the review's file list (a held row has none of its own). The folder is deliver/<shot>/<vNNN> on the volume,
 * whether Auto-publish found the review on the volume or on this PC (a PC copy is the synced volume folder). The window opens on a pod attached to the volume: a running one first, else any (the volume listing needs no running pod).
 */
export function outputsTarget(row, { review = null, pods = [], volumeId = '' } = {}) {
  if (row && typeof row.folder === 'string') {   // an Auto-generate row has a render's own folder, not a shot and version
    if (!row.folder) return { ok: false, reason: 'nofolder' }
    if (row.files === 0) return { ok: false, reason: 'nothing' }
    const attached = (pods || []).filter((p) => p && p.id && (!volumeId || p.volume_id === volumeId)), host = attached.find((p) => p.status === 'running') || attached[0]
    return host ? { ok: true, pod_id: host.id, folder: row.folder } : { ok: false, reason: 'nopod' }
  }
  const shot = String(row?.shot || '').trim(), version = row?.version
  if (!shot || version === undefined || version === null || version === '') return { ok: false, reason: 'nofolder' }
  const files = row?.files != null ? Number(row.files) : Array.isArray(review?.files) ? review.files.length : 0
  if (!(files > 0)) return { ok: false, reason: 'nothing' }
  const onVolume = (pods || []).filter((p) => p && p.id && (!volumeId || p.volume_id === volumeId))
  const pod = onVolume.find((p) => p.status === 'running') || onVolume[0]
  if (!pod) return { ok: false, reason: 'nopod' }
  return { ok: true, pod_id: pod.id, folder: reviewFolder(shot, version) }
}
/** Why the footer Save must wait: the cancel window is a whole number of minutes from 0 to 120, the daily cap a whole number from 1 to 100, or 0 / empty for no limit; '' when fine. */
export function settingsProblem({ window_minutes, daily_cap, targets, round, sources, volume_scan_minutes, generate, approved_by, require_review, max_gb_per_day, scope }) {
  const w = Number(window_minutes), c = Number(daily_cap)
  if (scope !== undefined && scope !== 'edl' && scope !== 'all') return 'scope'
  if (window_minutes === '' || !Number.isInteger(w) || w < 0 || w > WINDOW_MAX) return 'window'
  if (daily_cap !== null && daily_cap !== undefined && daily_cap !== '' && Number(daily_cap) !== 0 && (!Number.isInteger(c) || c < 1 || c > CAP_MAX)) return 'cap'
  if (targets && !targets.s3 && !targets.slack) return 'targets'
  if (round !== undefined && roundTemplateProblem(round)) return 'round'
  if (sources && !sources.local && !sources.volume) return 'sources'
  if (generate && generate.enabled) {
    const m = generate.settle_minutes
    if (m === '' || !Number.isInteger(Number(m)) || Number(m) < 1 || Number(m) > 120) return 'settle'
    if (generate.max_per_day !== null && generate.max_per_day !== undefined && generate.max_per_day !== '' && (!Number.isInteger(Number(generate.max_per_day)) || Number(generate.max_per_day) < 1)) return 'genmax'
    if ((generate.where === 'pod' || generate.start_pod || generate.colour_in) && !String(approved_by || '').trim()) return 'approver'
    if (generate.start_pod && generate.max_spend_usd_per_day !== undefined && (generate.max_spend_usd_per_day === '' || !(Number(generate.max_spend_usd_per_day) > 0))) return 'spend'
  }
  if (require_review === false && !String(approved_by || '').trim()) return 'approver'
  if (max_gb_per_day !== undefined && max_gb_per_day !== null && max_gb_per_day !== '' && !(Number(max_gb_per_day) > 0)) return 'maxgb'
  if (volume_scan_minutes !== undefined && (volume_scan_minutes === '' || !Number.isInteger(Number(volume_scan_minutes)) || Number(volume_scan_minutes) < 1 || Number(volume_scan_minutes) > 120)) return 'minutes'
  return ''
}
export const AP_ROUND = 'tunnel-v11_{date}_r01'   // the default round template of Auto-publish (a core that has `round`)
/** The defaults of `auto_publish.generate` (rendering the outputs automatically): off, on this PC, the review, 20 a day, 5 minutes to settle. */
export const GEN_DEFAULTS = { enabled: false, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false }
const GEN_EXTRA = { start_pod: false, stop_when_done: true, max_spend_usd_per_day: 25, colour_in: null }   // newer keys: default only when the core has them
export const genIsDefault = (g) => { const d = { ...GEN_DEFAULTS }; for (const k of Object.keys(GEN_EXTRA)) if (g && k in g) d[k] = GEN_EXTRA[k]; return JSON.stringify({ ...d, ...(g || {}) }) === JSON.stringify(d) }
export const LIVE_STATES = ['waiting', 'uploading']
/** The defaults of the configuration's `auto_publish`: where it publishes is a group of targets (Tunnel is not available yet and can never be on). */
export const AP_TARGETS = { s3: true, slack: false, tunnel: false }
/** The daily cap is optional and OFF by default: `daily_cap` null (or missing, on an older core) is no limit; a number is 1 to 100 (0 is no limit too). When ticked in the window it starts at CAP_START. */
export const CAP_START = 5
export const AP_DEFAULTS = { enabled: false, dry_run: true, window_minutes: 10, scope: 'edl', targets: { ...AP_TARGETS } }
/** A copy of a configuration's `auto_publish` with the defaults filled in; a core that has only the old `slack` boolean becomes targets (S3 plus Slack when it was on). */
export function apFill(o) {
  const { slack, targets, ...rest } = o || {}
  return { ...AP_DEFAULTS, ...rest, ...(rest.generate ? { generate: { ...GEN_DEFAULTS, ...rest.generate } } : {}), targets: { ...AP_TARGETS, ...(targets || (slack != null ? { slack: !!slack } : {})) } }
}
/** Whether it is exactly the defaults (nothing on, no standing approval): then an untouched configuration need not carry it. */
export const apIsDefault = (o) => { const a = apFill(o); return !a.standing && JSON.stringify(a.targets) === JSON.stringify(AP_TARGETS) && a.daily_cap == null && (a.dry_run_first ?? true) === true && (a.include_dpx ?? false) === false && (a.fix_dpx ?? true) === true && (a.scope ?? 'edl') === 'edl' && (a.round ?? AP_ROUND) === AP_ROUND && (a.require_approval ?? false) === false && (a.require_review ?? true) === true && (a.max_gb_per_day ?? null) === null && genIsDefault(a.generate) && (a.sources?.local ?? true) === true && (a.sources?.volume ?? true) === true && (a.volume_scan_minutes ?? 5) === 5 && ['enabled', 'dry_run', 'window_minutes'].every((k) => a[k] === AP_DEFAULTS[k]) }
/** 'Today: 3 of 5' with a cap, 'Today: 3 uploaded' without one; the cap line 'No daily limit'. */
export function todayText(status, t) {
  const count = status?.today?.count ?? 0, cap = status?.daily_cap
  return cap == null ? t('autopublish.today.noCap', { count }) : t('autopublish.today.ofCap', { count, cap })
}
/** 'scanned 2 minutes ago' from an ISO time; '' when unknown. */
export function agoText(iso, t, now = Date.now()) {
  const ms = new Date(iso).getTime()
  if (!iso || Number.isNaN(ms)) return ''
  const m = Math.max(0, Math.round((now - ms) / 60000))
  return m < 1 ? t('autopublish.watch.justNow') : m < 60 ? t('autopublish.watch.minutesAgo', { n: m }) : t('autopublish.watch.hoursAgo', { n: Math.round(m / 60) })
}
/** What Auto-publish is doing, as small text for the header chip: '· uploading 41%', 'generating 2', '1 waiting 9:41', 'scanning volume'; '' when idle. */
export function activityText(status, pending = [], publishJobs = [], now = Date.now(), t) {
  const jobs = (publishJobs || []).filter((j) => j.trigger === 'auto-publish' && ['queued', 'uploading', 'posting'].includes(j.state))
  const j = jobs[0], up = (pending || []).find((e) => e.state === 'uploading')
  if (j || up) { const pct = j?.bytes_total ? Math.round((100 * (j.bytes_done || 0)) / j.bytes_total) : null; return j?.state === 'posting' ? t('autopublish.chip.posting') : t('autopublish.chip.uploading', { pct: pct == null ? '' : ` ${pct}%` }) }
  const g = status?.generate, n = Array.isArray(g?.generating) ? g.generating.length : Number(g?.generating) || 0
  if (g?.enabled && n > 0) return t('autopublish.chip.generating', { n })
  const waiting = (pending || []).filter((e) => e.state === 'waiting')
  if (waiting.length) return t('autopublish.chip.waiting', { n: waiting.length, t: countdownText(Math.min(...waiting.map((e) => secondsUntil(e.due_at, now)))) })
  if (volumeScan(status?.watching?.volume, now).state === 'scanning' || status?.watching?.local?.scanning) return t('autopublish.chip.scanning')
  return ''
}
/** 'S3 + Slack' from targets as an object ({ s3: true, ... }) or a list (['s3', 'slack']). */
export function targetsText(t) {
  const on = Array.isArray(t) ? t : Object.entries(t || {}).filter(([, v]) => v).map(([k]) => k)
  const L = { s3: 'S3', slack: 'Slack', tunnel: 'Tunnel' }
  return ['s3', 'slack', 'tunnel'].filter((k) => on.includes(k)).map((k) => L[k]).join(' + ')
}
