/**
 * Auto-publish (docs/ADR-050, "Amendment 2026-11-19: Auto-publish"): a standing rule that uploads finished, APPROVED review videos to the publish
 * destination by itself. It is off by default, needs a named standing approval, starts in dry-run, waits out a cancel window, obeys a daily cap, and is
 * built ON publish.run (same plan, same weights refusal, same streaming), so nothing can leave that a manual publish could not. Everything is async and
 * restart safe: the approvals, the settings and the state (uploaded versions, today's count) are small files written atomically.
 */
import { timedTick } from './ticks.js'
import { lstat, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as autogenerate from './autogenerate.js'
import * as dpxprep from './dpxprep.js'
import * as edl from './edl.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import { configDir, mountsFile } from './paths.js'
import * as publish from './publish.js'

export const WINDOW_DEFAULT = 10, RETRY_MS = 10 * 60_000, MAX_RETRIES = 2, TICK_MS = 5000, CONSIDER_MS = 60_000, MAX_REVIEWS = 2000, KEEP_RECENT = 20
export const NEEDS_NAME_APPROVE = 'Approving a shot version needs the name of who says yes'
export const NEEDS_NAME_NOW = 'Publishing now needs the name of who says yes'
const SHOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/, VERSION_RE = /^v\d{3,}$/
const MOVIE = /\.(mov|mp4)$/i

// ----- dependencies (injectable) -----
export interface Deps { now(): number; outputRoot(): string | null }
const defaults = (): Deps => ({ now: () => Date.now(), outputRoot: () => publish.localOutputRoot() })
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

// ----- files -----
const file = (n: string) => join(configDir(), n)
const approvalsFile = () => file('approvals.json'), stateFile = () => file('autopublish-state.json')
async function readJson<T>(f: string, fallback: T): Promise<T> { try { const j = JSON.parse(await readFile(f, 'utf8')); return j && typeof j === 'object' ? j : fallback } catch { return fallback } }
async function writeJson(f: string, v: unknown): Promise<void> { await mkdir(dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(v, null, 1), { mode: 0o600 }); await rename(tmp, f) }

export interface Approval { shot: string; version: string; approved_by: string; at: string }
export interface Standing { approved_by: string; at: string }
type Stored = mounts.AutoPublishConfig
export type Targets = mounts.AutoPublishTargets
interface StateFile { /** the last dry-run Slack summary: the set it described and when */ dryslack?: { sig: string; at: number }; uploaded?: Record<string, { at: string; job_id?: string; manual?: boolean; already?: boolean }>; day?: string; count?: number; cancelled?: string[]; /** shot/version keys a person holds back: never auto-published until released */ held?: string[]; inflight?: Record<string, string>; would?: Record<string, string> }
export interface TargetState { ready: boolean; problem?: string; label: string }
export interface Settings { /** Auto-generate: render the new finished sequences too (off by default) */ generate: mounts.AutoGenerateConfig; /** where Auto-publish looks (this PC and/or the volume) and how often the volume is listed */ sources: { local: boolean; volume: boolean }; volume_scan_minutes: number; /** the round a shot is published into (`{date}` = the local day) */ round: string; include_dpx: boolean; /** with include_dpx: the corrected copy is made (dpx_fix) and uploaded; off: no DPX at all */ fix_dpx: boolean; /** `edl` (the default): only elements of the loaded EDL are generated and published, the rest is skipped with the reason; `all`: everything found */ scope: 'edl' | 'all'; /** each review version needs a person's approval (true), or every eligible review goes under the standing approval (false, the default) */ require_approval: boolean; enabled: boolean; dry_run: boolean; dry_run_first: boolean; window_minutes: number; daily_cap: number | null; targets: Targets; target_state: { s3: TargetState; slack: TargetState; tunnel: TargetState }; standing: Standing | null; destination: string; ready: boolean; problem?: string }

const clean = (v: unknown): string => String(v ?? '').replace(/[{}\r\n]/g, ' ').trim().slice(0, 80)
const keyOf = (shot: string, version: string) => `${shot}/${version}`
const localDay = (ms: number): string => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const iso = (ms: number) => new Date(ms).toISOString()

// ----- the pending entries (memory) -----
export type EntryState = 'waiting' | 'uploading' | 'would_upload' | 'capped' | 'failed' | 'cancelled' | 'done'
interface Entry { /** where the review was found */ source: 'local' | 'volume'; metas?: Found['metas']; id: string; key: string; shot: string; version: string; files: string[]; bytes: number; due_at: number; state: EntryState; reason?: string; job_id?: string; approved_by: string; targets: string[]; attempts: number; retry_at?: number; finished_at?: number; /** a dry run: the exact keys, the manifest and inventory keys and the access check; nothing is written */ dry_run_plan?: publish.DryRunPlan; manual?: boolean; reason_who?: string; queued?: boolean; run?: Promise<void> }
const entries = new Map<string, Entry>()
let recent: Entry[] = [], seq = 0, loaded: Promise<void> | null = null
const inDestination = new Map<string, boolean>()
let timers: NodeJS.Timeout[] = []

const view = (e: Entry) => ({ ...(e.dry_run_plan ? { dry_run_plan: e.dry_run_plan } : {}), id: e.id, shot: e.shot, version: e.version, files: e.files.length, bytes: e.bytes, due_at: iso(e.due_at), state: e.state, ...(e.reason ? { reason: e.reason } : {}), ...(e.job_id ? { job_id: e.job_id } : {}), approved_by: e.approved_by, targets: e.targets, ...(e.finished_at ? { finished_at: iso(e.finished_at) } : {}) })
const finish = (e: Entry, state: 'done' | 'cancelled', reason?: string) => { e.state = state; if (reason) e.reason = reason; e.finished_at = deps.now(); entries.delete(e.id); recent.unshift(e); recent.length = Math.min(recent.length, KEEP_RECENT) }

/** The settings live in the Default Configuration (mounts.json): read again whenever the file changes (a cheap cache keyed by its mtime and size), so a change made in the configuration window applies at the next tick. */
async function stored(): Promise<Stored> {
  const f = mountsFile()
  try {
    // always read the file (a few KB): a cache keyed on its time and size served the old dry_run right after a write (the tool answered "dry run" while the file said live)
    const data = JSON.parse(await readFile(f, 'utf8')) as { auto_publish?: unknown }
    return mounts.normalizeAutoPublish(data.auto_publish)
  } catch { return mounts.normalizeAutoPublish(undefined) }
}
/** Write through the configuration store (its own file, the other settings untouched). */
function writeStored(next: Stored): void { const cur = mounts.load(); mounts.save({ ...cur, auto_publish: mounts.normalizeAutoPublish(next) }) }
async function stateOf(): Promise<StateFile> { return readJson<StateFile>(stateFile(), {}) }
/** Every change to the state file is read, changed and written inside one lock, so concurrent steps never lose each other's update. */
let stateLock: Promise<unknown> = Promise.resolve()
function mutate(fn: (st: StateFile) => void): Promise<void> { const run = stateLock.then(async () => { const st = await stateOf(); fn(st); await saveState(st) }); stateLock = run.catch(() => undefined); return run }
const saveState = (s: StateFile) => writeJson(stateFile(), s)
async function approvalList(): Promise<Approval[]> { const a = await readJson<{ approvals?: Approval[] }>(approvalsFile(), {}); return Array.isArray(a.approvals) ? a.approvals : [] }

// ----- settings -----
export async function settings(): Promise<Settings> {
  const s = await stored(), ps = await publish.settings()
  const problem = ps.s3.ready ? undefined : ps.s3.problem
  return { generate: { ...s.generate }, sources: { ...s.sources }, volume_scan_minutes: s.volume_scan_minutes, round: s.round, include_dpx: s.include_dpx, fix_dpx: s.fix_dpx !== false, scope: s.scope, require_approval: s.require_approval === true, enabled: s.enabled === true && !!s.standing, dry_run: s.dry_run !== false, dry_run_first: s.dry_run_first !== false, window_minutes: s.window_minutes, daily_cap: s.daily_cap, targets: { ...s.targets }, standing: s.standing ?? null,
    target_state: { s3: { ready: ps.s3.ready, ...(ps.s3.problem ? { problem: ps.s3.problem } : {}), label: 'S3' }, slack: { ready: ps.slack.ready, ...(ps.slack.problem ? { problem: ps.slack.problem } : {}), label: 'Slack' }, tunnel: { ready: false, problem: 'Tunnel is not available yet', label: 'Tunnel' } },
    destination: `s3://${ps.s3.bucket}/${ps.s3.prefix}`, ready: ps.s3.ready, ...(problem ? { problem } : {}) }
}
export interface SettingsInput { generate?: Partial<mounts.AutoGenerateConfig>; sources?: { local?: boolean; volume?: boolean }; volume_scan_minutes?: number; round?: string; include_dpx?: boolean; fix_dpx?: boolean; /** `edl` (default) or `all`: which sequences and reviews are touched */ scope?: 'edl' | 'all'; /** true: each review version needs a person's approval; false (default): every eligible review goes */ require_approval?: boolean; enabled?: boolean; dry_run?: boolean; /** what turning it on does: dry run first (default) or live at once */ dry_run_first?: boolean; window_minutes?: number; /** 1..50, or null / 0 for no limit */ daily_cap?: number | null; targets?: Partial<Targets>; approved_by?: string; understood?: boolean }
/** Save. Turning ON needs a name AND `understood: true`, and starts in dry-run unless it was already live; going live needs the standing approval and a fresh name in the same call. The destination is never set here. */
export async function setSettings(input: SettingsInput): Promise<Settings> {
  const i = input ?? {}, cur = await stored(), was = cur.enabled === true && !!cur.standing, name = clean(i.approved_by)
  const next: Stored = { ...cur, targets: { ...cur.targets }, sources: { ...cur.sources }, generate: { ...cur.generate } }, notes: string[] = []
  if (i.window_minutes !== undefined) { if (!(Number.isInteger(i.window_minutes) && i.window_minutes >= 0 && i.window_minutes <= 120)) throw bad('window_minutes is a whole number of minutes from 0 to 120'); next.window_minutes = i.window_minutes; notes.push('window_minutes') }
  if (i.daily_cap !== undefined) { const c = i.daily_cap === 0 ? null : i.daily_cap; if (c !== null && !(Number.isInteger(c) && c >= 1 && c <= 100)) throw bad('daily_cap is empty or 0 (no limit) or a whole number from 1 to 100'); next.daily_cap = c; notes.push(`daily_cap (${c === null ? 'no limit' : c})`) }
  if (i.targets !== undefined) {
    if (!i.targets || typeof i.targets !== 'object') throw bad('targets is { s3, slack }')
    for (const k of ['s3', 'slack', 'tunnel'] as const) { const v = (i.targets as Record<string, unknown>)[k]; if (v === undefined) continue; if (typeof v !== 'boolean') throw bad(`targets.${k} is true or false`); next.targets[k] = v }
    notes.push(`targets (${targetList(next.targets).join(', ') || 'none'})`)
  }
  if (i.generate !== undefined) {
    const g = i.generate as Record<string, unknown>, ng = { ...next.generate } as Record<string, unknown>
    for (const k of ['enabled', 'where', 'preset', 'max_per_day', 'settle_minutes', 'fallback_local', 'colour_in']) if (g[k] !== undefined) ng[k] = g[k] === '' ? null : g[k]
    if (g.max_per_day === 0) ng.max_per_day = null
    const merged = mounts.normalizeAutoGenerate({ ...ng, enabled_at: next.generate.enabled_at ?? '', enabled: ng.enabled }); mounts.validateAutoGenerate(merged)
    if (merged.colour_in && merged.colour_in !== (cur.generate.colour_in ?? null)) {   // a person states the colour of the frames: the name is needed and recorded
      if (!name) throw bad("Stating the colour of frames is a person's act: put the approver's name")
      history.record({ kind: 'change', area: 'configuration', action: 'auto-generate colour stated', what: 'auto-publish', detail: `frames are ${merged.colour_in}, stated by ${name}`, approved_by: name })
    }
    if (merged.where === 'pod' && cur.generate.where !== 'pod' && !name) throw bad("Rendering on a pod spends money: put the approver's name")
    next.generate = { ...merged, ...(merged.enabled && !cur.generate.enabled ? { enabled_at: iso(deps.now()) } : merged.enabled ? (cur.generate.enabled_at ? { enabled_at: cur.generate.enabled_at } : {}) : {}) }
    if (!merged.enabled) delete next.generate.enabled_at
    notes.push(`generate (${merged.enabled ? `on, ${merged.where}, ${merged.preset}` : 'off'})${merged.where === 'pod' && cur.generate.where !== 'pod' ? `, rendering on a pod approved by ${name}` : ''}`)
  }
  if (i.sources !== undefined) { const so = i.sources as Record<string, unknown>; for (const k of ['local', 'volume'] as const) { if (so[k] === undefined) continue; if (typeof so[k] !== 'boolean') throw bad(`sources.${k} is true or false`); next.sources[k] = so[k] as boolean } if (!next.sources.local && !next.sources.volume) throw bad('Choose at least one place to watch'); notes.push(`sources (${[next.sources.local ? 'this PC' : '', next.sources.volume ? 'volume' : ''].filter(Boolean).join(' + ')})`) }
  if (i.volume_scan_minutes !== undefined) { const n = i.volume_scan_minutes; if (!(Number.isInteger(n) && n >= 1 && n <= 120)) throw bad('volume_scan_minutes is a whole number of minutes from 1 to 120'); next.volume_scan_minutes = n; notes.push('volume_scan_minutes') }
  if (i.round !== undefined) { next.round = String(i.round).trim() || mounts.AUTO_PUBLISH_DEFAULT.round; notes.push('round') }
  if (i.require_approval !== undefined) { if (typeof i.require_approval !== 'boolean') throw bad('require_approval is true or false'); next.require_approval = i.require_approval; notes.push(`require_approval (${i.require_approval})`) }
  if (i.fix_dpx !== undefined) { if (typeof i.fix_dpx !== 'boolean') throw bad('fix_dpx is true or false'); next.fix_dpx = i.fix_dpx; notes.push(`fix_dpx (${i.fix_dpx})`) }
  if (i.include_dpx !== undefined) { if (typeof i.include_dpx !== 'boolean') throw bad('include_dpx is true or false'); next.include_dpx = i.include_dpx; notes.push(`include_dpx (${i.include_dpx})`) }
  if (i.scope !== undefined) { if (i.scope !== 'edl' && i.scope !== 'all') throw bad("scope is 'edl' (only elements of the loaded EDL) or 'all'"); next.scope = i.scope; notes.push(`scope (${i.scope === 'edl' ? 'only EDL elements' : 'everything'})`) }
  if (i.dry_run !== undefined && typeof i.dry_run !== 'boolean') throw bad('dry_run is true or false')
  if (i.enabled !== undefined && typeof i.enabled !== 'boolean') throw bad('enabled is true or false')
  if (i.dry_run_first !== undefined) { if (typeof i.dry_run_first !== 'boolean') throw bad('dry_run_first is true or false'); next.dry_run_first = i.dry_run_first; notes.push(`dry_run_first (${i.dry_run_first})`) }
  if (next.targets.tunnel) throw bad('targets.tunnel: Tunnel is not available yet')
  if (next.targets.slack && !next.targets.s3) throw bad('targets.slack: Slack announces an upload: turn S3 on')
  if (i.enabled === false) { await off(); await refreshMemo(); return settings() }
  const turningOn = i.enabled === true && !was
  if (turningOn) {
    if (!name) throw bad('approved_by is needed: the name of who allows Auto-publish')
    if (i.understood !== true) throw bad('understood must be true: the person confirms that this allows the app to upload approved review videos by itself')
    next.enabled = true; next.standing = { approved_by: name, at: iso(deps.now()) }; next.dry_run = next.dry_run_first !== false
    notes.push(next.dry_run ? `enabled (standing approval of ${name}), starting in dry run` : `turned on LIVE (no dry run first; standing approval of ${name})`)
  }
  if (turningOn) { /* what turning it on does is dry_run_first's: a dry run, or live at once */ }
  else if (i.dry_run === false && next.dry_run !== false) {   // going live on a running rule: the standing approval already holds a name
    if (!(was && cur.standing)) throw bad('Going live needs the standing approval: turn Auto-publish on first')
    if (i.understood !== true) throw bad('Confirm that the next approved version will really be uploaded')
    next.dry_run = false; notes.push('dry_run off: LIVE')
  } else if (i.dry_run === true && next.dry_run === false) { next.dry_run = true; notes.push('dry_run') }
  if (next.enabled && !next.targets.s3 && !next.targets.slack) throw bad('targets: at least one of s3 or slack must be on while Auto-publish is on')
  if (notes.length) {
    mounts.validateAutoPublish(mounts.normalizeAutoPublish(next))
    writeStored(next)
    history.record({ kind: 'change', area: 'configuration', action: 'auto-publish settings changed', what: 'auto-publish', detail: `${notes.join(', ')}; targets now: ${targetList(next.targets).join(', ') || 'none'}` })   // field names, never a secret
  }
  if (next.dry_run === false && next.enabled === true) { for (const e of [...entries.values()]) if (e.state === 'would_upload') { e.state = 'waiting'; e.due_at = deps.now() + next.window_minutes * 60_000; delete e.reason } }
  void consider().catch(() => undefined)
  await refreshMemo()
  return settings()
}
const targetList = (t: Targets): string[] => (['s3', 'slack', 'tunnel'] as const).filter((k) => t[k])
const publishTargets = (t: Targets): ('s3' | 'slack')[] => [...(t.s3 ? ['s3' as const] : []), ...(t.slack && t.s3 ? ['slack' as const] : [])]

/** One generation pass (Auto-generate): render the new finished sequences, within the settings. Runs with the 60 s look (and by hand in the tests); does nothing unless Auto-publish and generating are both on. It never approves and never publishes. */
export async function generatePass(): Promise<{ started: number }> {
  const s = await stored()
  if (!(s.enabled === true && s.standing) || !s.generate.enabled) { await autogenerate.pass({ ...s.generate, enabled: false }, ''); return { started: 0 } }
  if (!s.generate.enabled_at) { writeStored({ ...s, generate: { ...s.generate, enabled_at: iso(deps.now()) } }); return { started: 0 } }   // the first look sets the baseline: nothing older is rendered
  return autogenerate.pass(s.generate, s.standing.approved_by, undefined, s.scope)
}
/** Instant off: the rule stops, the standing approval is cleared, every pending entry is cancelled. */
let offGen = 0   // bumped by every off(): a consider() pass that began before it must not add an entry after it (it may have read the settings just before the file was rewritten)
export async function off(): Promise<number> {
  offGen++
  const cur = await stored(); let n = autogenerate.cancelAll(); await autogenerate.clearPending()
  for (const e of [...entries.values()]) { if (e.state === 'uploading') continue; finish(e, 'cancelled', 'turned off'); n++ }
  if (cur.enabled || cur.standing) { writeStored({ ...cur, enabled: false, standing: undefined }); history.record({ kind: 'change', area: 'configuration', action: 'auto-publish turned off', what: 'auto-publish', detail: `${n} pending cancelled` }) }
  await refreshMemo()
  return n
}
export async function offCount(): Promise<{ cancelled: number }> { return { cancelled: await off() } }

// ----- approvals -----
const checkShotVersion = (shot: unknown, version: unknown): { shot: string; version: string } => {
  if (typeof shot !== 'string' || !SHOT_RE.test(shot)) throw bad('shot is a shot name like archival-085')
  if (typeof version !== 'string' || !VERSION_RE.test(version)) throw bad('version is a review version like v002')
  return { shot, version }
}
export async function approvals(): Promise<Approval[]> { return approvalList() }
export async function approve(o: { shot?: unknown; version?: unknown; approved_by?: unknown }): Promise<Approval & { already?: boolean }> {
  const { shot, version } = checkShotVersion(o?.shot, o?.version), who = clean(o?.approved_by)
  if (!who) throw bad(NEEDS_NAME_APPROVE)
  const found = await resolve(shot, version)
  if (!found) { const s0 = await stored(); throw new CoreError(404, `There is no review ${shot} ${version} on this PC${s0.sources.volume ? (vol.at ? ` or in the last volume scan (${Math.round((deps.now() - vol.at) / 60_000)} min ago)` : ' (the volume has not been scanned yet: Scan now)') : ''}`) }
  const all = await approvalList(), have = all.find((a) => a.shot === shot && a.version === version)
  if (have) return { ...have, already: true }
  const a: Approval = { shot, version, approved_by: who, at: iso(deps.now()) }
  await writeJson(approvalsFile(), { approvals: [...all, a] })
  history.record({ kind: 'change', area: 'configuration', action: 'review version approved', what: `${shot} ${version}`, detail: `marked approved by ${who}`, approved_by: who })
  void consider().catch(() => undefined)
  return a
}
export async function revoke(o: { shot?: unknown; version?: unknown }): Promise<{ revoked: boolean; cancelled: number }> {
  const { shot, version } = checkShotVersion(o?.shot, o?.version), key = keyOf(shot, version)
  const all = await approvalList(), had = all.some((a) => a.shot === shot && a.version === version)
  if (had) await writeJson(approvalsFile(), { approvals: all.filter((a) => !(a.shot === shot && a.version === version)) })
  let n = 0
  for (const e of [...entries.values()]) if (e.key === key && e.state !== 'uploading') { finish(e, 'cancelled', 'approval revoked'); n++ }
  await mutate((st) => { if (st.cancelled?.includes(key)) st.cancelled = st.cancelled.filter((k) => k !== key) })
  if (had || n) history.record({ kind: 'change', area: 'configuration', action: 'review approval revoked', what: `${shot} ${version}`, detail: `${n} pending auto-publish cancelled` })
  return { revoked: had, cancelled: n }
}

/** A hold: this shot version is never auto-published until a person releases it (the MCP may hold; only the window releases). A waiting entry is cancelled. */
export async function hold(o: { shot?: unknown; version?: unknown }): Promise<{ held: boolean; cancelled: number }> {
  const { shot, version } = checkShotVersion(o?.shot, o?.version), key = keyOf(shot, version); let n = 0
  await mutate((st) => { st.held = [...new Set([...(st.held ?? []), key])] })
  for (const e of [...entries.values()]) if (e.key === key && e.state !== 'uploading') { finish(e, 'cancelled', 'held by a person'); n++ }
  history.record({ kind: 'change', area: 'configuration', action: 'review version held', what: `${shot} ${version}`, detail: `${n} pending auto-publish cancelled` })
  return { held: true, cancelled: n }
}
export async function release(o: { shot?: unknown; version?: unknown }): Promise<{ released: boolean }> {
  const { shot, version } = checkShotVersion(o?.shot, o?.version), key = keyOf(shot, version); let had = false
  await mutate((st) => { had = !!st.held?.includes(key); if (had) st.held = st.held!.filter((k) => k !== key) })
  if (had) { history.record({ kind: 'change', area: 'configuration', action: 'review version released', what: `${shot} ${version}`, detail: 'a hold was removed' }); void consider().catch(() => undefined) }
  return { released: had }
}
export async function holds(): Promise<{ holds: { shot: string; version: string }[] }> { const st = await stateOf(); return { holds: (st.held ?? []).map((k) => { const [shot, version] = k.split('/'); return { shot, version } }) } }

/** ADR-050, 'Generate for what is already there': a one-time, confirmed action. Without `confirm` it is a PREVIEW (nothing starts); with it the sequences start as ordinary renders. */
export async function generateExisting(o: { dry_run?: boolean; approved_by?: string; confirm?: boolean; limit?: number } = {}): Promise<autogenerate.ExistingResult> {
  const s = await stored(), run = o.confirm === true && o.dry_run !== true
  return autogenerate.existing(s.generate, { run, approver: (o.approved_by ?? '').trim(), ...(o.limit !== undefined ? { limit: o.limit } : {}), ...(s.standing?.approved_by ? { standing: s.standing.approved_by } : {}) })
}

// ----- looking at a review version on this PC -----
interface Found { shot: string; version: string; files: { name: string; bytes: number; codec?: string }[]; bytes: number; complete: boolean; why?: string; weights: boolean; refusedColour: boolean; /** where this review was found: this PC, or the volume (the last scan) */ source: 'local' | 'volume'; /** each movie's sidecar, as read (the source DPX frames are named there) */ metas: Record<string, Record<string, unknown>> }
/** The checks every review passes, wherever it was found: a movie, no partial file, DELIVERY.md, a sidecar per movie that says review, not partial, colour not refused, and no model weight. */
async function judge(shot: string, version: string, rawFiles: { name: string; bytes: number }[], source: Found['source'], readMeta: (name: string) => Promise<Record<string, unknown>>): Promise<Found> {
  const files: Found['files'] = rawFiles.map((f) => ({ name: f.name, bytes: f.bytes, ...(MOVIE.test(f.name) ? { codec: /\.mov$/i.test(f.name) ? 'prores422hq' : 'h264' } : {}) })).sort((x, y) => x.name.localeCompare(y.name))
  const weights = files.some((f) => publish.isWeight(f.name)), partial = files.some((f) => /_partial/i.test(f.name))
  const movies = files.filter((f) => MOVIE.test(f.name)), names = new Set(files.map((f) => f.name)), metas: Found['metas'] = {}
  let why: string | undefined, refusedColour = false
  if (!movies.length) why = 'no review video (.mov or .mp4) in the folder'
  else if (partial) why = 'a partial file is in the folder'
  else if (!names.has('DELIVERY.md')) why = 'DELIVERY.md is missing'
  else if (movies.some((m) => !names.has(`${m.name}.meta.json`))) why = 'a sidecar (.meta.json) is missing'
  if (!why) for (const m of movies) {
    const meta = await readMeta(`${m.name}.meta.json`); metas[m.name] = meta
    if (meta.unreadable === true) { why = `the sidecar ${m.name}.meta.json cannot be read (it is not valid JSON)`; continue }
    const colour = (meta.colour ?? {}) as { verdict?: string }, verdict = (meta.colour_verdict as string | undefined) ?? colour.verdict
    if (verdict === 'refused') { refusedColour = true; why = 'the sidecar says the colour was refused' }
    else if (meta.kind !== undefined && meta.kind !== 'review') why = 'the sidecar says this is not a review video'
    else if (meta.partial === true) why = 'the sidecar says it is partial'
  }
  if (weights) why = 'a model weight is in the folder'
  return { shot, version, files, bytes: files.reduce((x, f) => x + f.bytes, 0), complete: !why, ...(why ? { why } : {}), weights, refusedColour, source, metas }
}
async function lookAt(base: string, shot: string, version: string): Promise<Found | null> {
  const dir = join(base, 'deliver', shot, version)
  let ents: import('node:fs').Dirent[]; try { ents = await readdir(dir, { withFileTypes: true }) } catch { return null }
  const files: { name: string; bytes: number }[] = []
  for (const d of ents) {
    if (d.isSymbolicLink() || d.isDirectory()) continue
    const st = await lstat(join(dir, d.name)).catch(() => null); if (st) files.push({ name: d.name, bytes: st.size })
  }
  return judge(shot, version, files, 'local', (name) => readJson<Record<string, unknown>>(join(dir, name), {}))
}

// ----- the volume: comfy-shared/output/deliver/<shot>/<version>/, listed one level at a time (never the whole tree), on its own slower cycle -----
/** A sidecar as text. A value the pod left empty (`"render_fps": ` with nothing after it, which made the whole file invalid JSON and silently dropped the source frames) is read as null; text that is still not JSON is `{ unreadable: true }`, which the review is held for with a reason instead of going without its frames. */
export function parseSidecar(text: string): Record<string, unknown> {
  for (const t of [text, text.replace(/("(?:[^"\\]|\\.)*"\s*:)\s*(?=[,}\]])/g, '$1 null')]) { try { const j = JSON.parse(t); if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown> } catch { /* try the repair */ } }
  return { unreadable: true }
}
export const VOLUME_MAX_VERSIONS = 500, VOLUME_MAX_OBJECTS = 5000, SIDECAR_MAX = 256 * 1024
interface VolState { at: number; scanning: boolean; error?: string; id: string; reviews: Found[]; promise?: Promise<void>; ac?: AbortController }
const vol: VolState = { at: 0, scanning: false, id: '', reviews: [] }
/** List the volume's reviews now ("Scan now"): one scan at a time (a second call waits for the one running), shot folders, then version folders, then the files of each version, capped at 500 versions and 5,000 objects, chunked with yields, abortable; each sidecar is read as a small object (at most 256 KB) and judged by the SAME checks as a local review. A volume that cannot be listed is reported in the status and never breaks the local tick. */
export async function scanVolume(): Promise<{ scanned: boolean; reviews: number; error?: string; scanned_at: string | null }> {
  const s = await stored()
  if (!s.sources.volume) return { scanned: false, reviews: vol.reviews.length, scanned_at: vol.at ? iso(vol.at) : null, error: 'The volume is not one of the places Auto-publish watches' }
  if (!vol.promise) {
    const ac = new AbortController(); vol.ac = ac; vol.scanning = true
    vol.promise = doScanVolume(ac.signal).then(() => { delete vol.error }, (e) => { vol.error = publish.redact((e as Error).message).slice(0, 300) }).finally(() => { vol.scanning = false; vol.at = deps.now(); vol.promise = undefined; vol.ac = undefined; watchMemo.at = 0 })
  }
  await vol.promise
  void consider().catch(() => undefined)
  return { scanned: !vol.error, reviews: vol.reviews.length, scanned_at: iso(vol.at), ...(vol.error ? { error: vol.error } : {}) }
}
async function doScanVolume(signal: AbortSignal): Promise<void> {
  vol.id = publish.volumeIdNow()
  const out: Found[] = [], yieldLoop = () => new Promise<void>((res) => setImmediate(res))
  const shots = (await publish.volumeBrowse('deliver', signal)).dirs.filter((d) => SHOT_RE.test(d)).sort()
  let versions = 0, objects = 0
  outer: for (const shot of shots) {
    const vs = (await publish.volumeBrowse(`deliver/${shot}`, signal)).dirs.filter((d) => VERSION_RE.test(d)).sort()
    for (const v of vs) {
      if (signal.aborted) throw new CoreError(499, 'The volume scan was cancelled')
      if (++versions > VOLUME_MAX_VERSIONS) break outer
      const ls = await publish.volumeBrowse(`deliver/${shot}/${v}`, signal); objects += ls.files.length
      if (!ls.files.length) continue   // an EMPTY version folder (a failed render left it) is not a review: neither counted nor listed
      if (objects > VOLUME_MAX_OBJECTS) break outer
      const keyOf2 = new Map(ls.files.map((f) => [f.name, f]))
      out.push(await judge(shot, v, ls.files.map((f) => ({ name: f.name, bytes: f.bytes })), 'volume', async (name) => { const f = keyOf2.get(name); if (!f || f.bytes > SIDECAR_MAX) return {}; const text = await publish.volumeReadText(f.key, SIDECAR_MAX, signal).catch(() => null); return text === null ? {} : parseSidecar(text) }))
      await yieldLoop()
    }
  }
  vol.reviews = out
}
/** The volume scan's own timer: lists again when volume_scan_minutes have passed. Called every 30 s by the scheduler (and by the tests). */
export async function volumeTick(): Promise<boolean> {
  const s = await stored(); if (!(s.enabled === true && s.standing) || !s.sources.volume || vol.scanning) return false
  if (vol.at && deps.now() - vol.at < s.volume_scan_minutes * 60_000) return false
  await scanVolume(); void consider().catch(() => undefined); return true   // a volume-only review queues as soon as it is listed
}
export function cancelVolumeScan(): void { vol.ac?.abort() }
/** The review of a version: this PC's when it has one (this PC wins), else the last volume scan's. */
async function resolve(shot: string, version: string): Promise<Found | null> {
  const s = await stored(), base = deps.outputRoot()
  if (s.sources.local && base) { const f = await lookAt(base, shot, version); if (f) return f }
  if (s.sources.volume) { const v = vol.reviews.find((x) => x.shot === shot && x.version === version); if (v) return v }
  return null
}
async function scanReviews(): Promise<{ shot: string; version: string }[]> {
  const base = deps.outputRoot(); if (!base) return []
  const out: { shot: string; version: string }[] = []
  let shots: import('node:fs').Dirent[]; try { shots = await readdir(join(base, 'deliver'), { withFileTypes: true }) } catch { return [] }
  for (const sd of shots.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!sd.isDirectory() || sd.isSymbolicLink() || !SHOT_RE.test(sd.name)) continue
    let vs: import('node:fs').Dirent[]; try { vs = await readdir(join(base, 'deliver', sd.name), { withFileTypes: true }) } catch { continue }
    for (const v of vs.sort((a, b) => a.name.localeCompare(b.name))) { if (v.isDirectory() && !v.isSymbolicLink() && VERSION_RE.test(v.name)) out.push({ shot: sd.name, version: v.name }); if (out.length >= MAX_REVIEWS) return out }
  }
  return out
}

export interface ReviewRow { shot: string; version: string; /** where it was found: this PC, or the volume (this PC wins when both have it) */ source: 'local' | 'volume'; files: { name: string; bytes: number; codec?: string }[]; bytes: number; complete: boolean; on_pc: boolean; approved: { approved_by: string; at: string } | null; state: 'not approved' | 'waiting' | 'would_upload' | 'uploading' | 'uploaded' | 'capped' | 'failed' | 'cancelled'; in_destination: boolean }
/** Every review the enabled places hold, merged by shot and version (this PC wins). */
async function allReviews(): Promise<Found[]> {
  const s = await stored(), base = deps.outputRoot(), out = new Map<string, Found>()
  if (s.sources.local && base) for (const r of await scanReviews()) { const f = await lookAt(base, r.shot, r.version); if (f) out.set(keyOf(r.shot, r.version), f) }
  if (s.sources.volume) for (const v of vol.reviews) if (!out.has(keyOf(v.shot, v.version))) out.set(keyOf(v.shot, v.version), v)
  return [...out.values()].sort((a, b) => a.shot.localeCompare(b.shot) || a.version.localeCompare(b.version))
}
export async function reviews(): Promise<{ reviews: ReviewRow[] }> {
  const ap = await approvalList(), st = await stateOf(), rows: ReviewRow[] = []
  for (const f of await allReviews()) {
    const key = keyOf(f.shot, f.version), a = ap.find((x) => x.shot === f.shot && x.version === f.version), e = [...entries.values()].find((x) => x.key === key), r0 = recent.find((x) => x.key === key)
    const uploaded = !!st.uploaded?.[key]
    const state: ReviewRow['state'] = uploaded ? 'uploaded' : e ? (e.state === 'done' || e.state === 'cancelled' ? 'waiting' : e.state) : r0?.state === 'cancelled' ? 'cancelled' : a ? 'waiting' : 'not approved'
    rows.push({ shot: f.shot, version: f.version, source: f.source, files: f.files, bytes: f.bytes, complete: f.complete, on_pc: f.source === 'local', approved: a ? { approved_by: a.approved_by, at: a.at } : null, state, in_destination: uploaded || inDestination.get(key) === true })
  }
  return { reviews: rows }
}

// ----- the rule -----
/** The scope rule (ADR-050 amendment, 2026-11-21): with `scope: 'edl'` only a review whose element is in the loaded EDL is queued. The element comes from the movie names of the review (`edl.lookup` tries the exact clip name, then the shot and element the name carries: `ARCHIVAL-080_ASSEMBLY_...` is archival-080 / assembly, which the EDL does not list). With no EDL loaded nothing is queued ('no EDL loaded'), never everything. '' = in scope. */
export const NOT_IN_EDL = 'not in the EDL', NO_EDL = 'no EDL loaded'
const SCOPE_MOVIE = /\.(mov|mp4|m4v|mxf|webm|avi|mkv)$/i
export async function scopeReason(scope: 'edl' | 'all', f: { shot: string; files: { name: string }[] }): Promise<string> {
  if (scope !== 'edl') return ''
  await edl.ensure(); if (!edl.isLoaded()) return NO_EDL
  const names = f.files.map((x) => x.name).filter((n) => SCOPE_MOVIE.test(n))
  for (const n of names) if (edl.lookup({ clip: n }).match !== 'not-in-edl') return ''
  if (!names.length && edl.lookup({ shot: f.shot }).match !== 'not-in-edl') return ''
  return NOT_IN_EDL
}
type Check = { ok: true; found: Found; approved: Approval; /** visible warnings (a waived EDL check in a test round) */ warnings?: string[] } | { ok: false; reason: string; inDest?: boolean }
async function check(shot: string, version: string, o: { pendingOk?: boolean; manual?: boolean } = {}): Promise<Check> {
  const s = await stored(), key = keyOf(shot, version)
  if ((await stateOf()).held?.includes(key)) return { ok: false, reason: 'held by a person' }
  if (!o.manual && !(s.enabled === true && s.standing)) return { ok: false, reason: 'Auto-publish is not on (no standing approval)' }
  const f = await resolve(shot, version); if (!f) return { ok: false, reason: deps.outputRoot() || s.sources.volume ? 'the review version is not on this PC or in the last volume scan' : 'The ComfyUI-Shared folder is not mapped on this PC' }
  if (!f.complete) return { ok: false, reason: f.why ?? 'the review is not complete' }
  if (!o.manual) { const sr = await scopeReason(s.scope, f); if (sr) return { ok: false, reason: sr } }   // a person's own Publish Now is not limited by the scope
  const a = (await approvalList()).find((x) => x.shot === shot && x.version === version) ?? (!s.require_approval && s.standing ? { shot, version, approved_by: s.standing.approved_by, at: iso(deps.now()) } : undefined)   // without require_approval the standing approver stands for every eligible review
  if (!a && !o.manual) return { ok: false, reason: 'this version is not approved' }
  const st = await stateOf()
  if (st.uploaded?.[key]) return { ok: false, reason: 'already uploaded', inDest: true }
  if (st.held?.includes(key)) return { ok: false, reason: 'held by a person' }
  if (!o.manual && st.cancelled?.includes(key)) return { ok: false, reason: 'cancelled by a person' }
  if (!o.pendingOk && [...entries.values()].some((e) => e.key === key)) return { ok: false, reason: 'already pending' }
  // the destination: the same files with the same sizes make it done already (publish's own skip)
  let pl: Awaited<ReturnType<typeof publish.plan>>
  try { pl = await publish.plan({ items: reviewItems(f), targets: ['s3'], round: s.round.replace(/\{date\}/g, localDay(deps.now())) }) } catch (e) { return { ok: false, reason: (e as Error).message } }
  if (pl.refused.length) return { ok: false, reason: pl.refused[0].reason }
  if (pl.blockers.length) return { ok: false, reason: pl.blockers[0] }
  if (pl.items.length && pl.items.every((i) => i.skip === 'same size already there')) { inDestination.set(key, true); return { ok: false, reason: 'already at the destination', inDest: true } }
  inDestination.set(key, false)
  // the EDL judges the sequences a return would carry, in a dry run as well as live (the same blockers); a test round waives only the frame count
  const edlv = dpxOn(s) ? await dpxCheck(f, key, s.round.replace(/\{date\}/g, localDay(deps.now()))) : { held: '', warnings: [] as string[] }   // ADR-057 decision 7: the DPX that go are the corrected copies, so this is the plan of the fix (the EDL's flags), not of the original frames
  if (edlv.held) return { ok: false, reason: edlv.held }
  return { ok: true, found: f, approved: a ?? { shot, version, approved_by: '', at: '' }, ...(edlv.warnings.length ? { warnings: edlv.warnings } : {}) }
}
/** The files of a review as publish items: paths under this PC's output/, or `{ where: 'volume' }` for a review found on the volume (streamed, never downloaded). */
const reviewItems = (f: Pick<Found, 'shot' | 'version' | 'files' | 'source'>): unknown[] => f.files.map((x) => (f.source === 'volume' ? { where: 'volume', path: `deliver/${f.shot}/${f.version}/${x.name}` } : `deliver/${f.shot}/${f.version}/${x.name}`))
/** DPX frames go with a review only when they are included AND the automatic fix is on (`fix_dpx`, default on): the upload carries the corrected copies; with the fix off there are no DPX at all. */
const dpxOn = (s: { include_dpx: boolean; fix_dpx?: boolean }): boolean => s.include_dpx === true && s.fix_dpx !== false
/** The sequences a review's sidecars name (source_dir, name): what `dpxprep` fixes. */
async function seqsOf(e: Pick<Entry, 'source' | 'shot' | 'version' | 'files' | 'metas'>): Promise<dpxprep.SeqRef[]> {
  const base = deps.outputRoot(), out: dpxprep.SeqRef[] = []
  for (const f of e.files.filter((x) => MOVIE.test(x))) {
    const meta = (e.source === 'volume' ? e.metas?.[f] : base ? await readJson<Record<string, unknown>>(join(base, 'deliver', e.shot, e.version, `${f}.meta.json`), {}) : undefined) as { source_dir?: string; name?: string } | undefined
    if (meta && typeof meta.name === 'string' && typeof meta.source_dir === 'string') out.push({ source_dir: meta.source_dir, name: meta.name })
  }
  return out
}
const dpxMemo = new Map<string, { at: number; value: { held: string; warnings: string[] } }>(), dpxFailUntil = new Map<string, { until: number; why: string }>()
/** The plan of the fix for a review (nothing is written): the flags hold the review back with their reason, kept five minutes per version; a fix that failed at upload holds it for ten minutes. */
async function dpxCheck(f: Found, key: string, round: string): Promise<{ held: string; warnings: string[] }> {
  const fail = dpxFailUntil.get(key); if (fail && fail.until > deps.now()) { edlHold.set(key, fail.why); return { held: fail.why, warnings: [] } }
  const memoKey = `${key}|${f.files.map((x) => x.name).join(',')}`, hit = dpxMemo.get(memoKey)
  if (hit && deps.now() - hit.at < 5 * 60_000) return hit.value
  let value = { held: '', warnings: [] as string[] }
  try {
    const pr = await dpxprep.prepare({ seqs: await seqsOf({ source: f.source, shot: f.shot, version: f.version, files: f.files.map((x) => x.name), metas: f.metas }), approvedBy: '', dry: true, testRound: /^_TEST_/.test(round) })
    value = pr.held ? { held: `held back: ${pr.held}`, warnings: [] } : { held: '', warnings: [...pr.skipped, ...pr.notes].slice(0, 5) }
  } catch { /* the plan could not be made: the other checks stand */ }
  dpxMemo.set(memoKey, { at: deps.now(), value }); if (value.held) edlHold.set(key, value.held); else edlHold.delete(key)
  return value
}
const edlHold = new Map<string, string>(), edlMemo = new Map<string, { at: number; value: { held: string; warnings: string[] } }>()   // why a review is held back (shown in Skipped); edlMemo is kept for reset()
export const eligibility = check

/** Look for review versions that are ready: queue each (dry-run: record `would_upload`). Runs when a render ends, at start, on an approval and every 60 s. */
let considering: Promise<unknown> = Promise.resolve()
export function consider(): Promise<{ queued: number }> { const run = considering.then(doConsider, doConsider); considering = run.catch(() => undefined); return run }
async function doConsider(): Promise<{ queued: number }> {
  await ensureLoaded()
  const gen0 = offGen
  const s = await stored(); if (!(s.enabled === true && s.standing)) return { queued: 0 }
  const dry = s.dry_run !== false, window = (s.window_minutes ?? WINDOW_DEFAULT) * 60_000; let queued = 0
  const ap: Approval[] = s.require_approval ? await approvalList() : (await allReviews()).map((f) => ({ shot: f.shot, version: f.version, approved_by: s.standing!.approved_by, at: iso(deps.now()) }))   // every eligible review under the standing approval, or only the approved ones
  if (!dry) for (const e of entries.values()) if (e.state === 'would_upload') { e.state = 'waiting'; e.due_at = deps.now() + window; delete e.reason }   // it went live: the cancel window starts now
  for (const r of ap) {
    const c = await check(r.shot, r.version)
    if (!c.ok) {
      if (c.inDest && c.reason === 'already at the destination') { await mutate((s2) => { s2.uploaded = { ...(s2.uploaded ?? {}), [keyOf(r.shot, r.version)]: { at: iso(deps.now()), already: true } as never } }) }
      continue
    }
    const key = keyOf(r.shot, r.version), st = await stateOf()
    const again = await stored(); if (!(again.enabled === true && again.standing)) return { queued }   // turned off while this pass was looking
    const e: Entry = { source: c.found.source, metas: c.found.metas, id: `ap-${deps.now().toString(36)}-${(seq++).toString(36)}`, key, shot: r.shot, version: r.version, files: c.found.files.map((f) => f.name), bytes: c.found.bytes, due_at: deps.now() + (dry ? 0 : window), state: dry ? 'would_upload' : 'waiting', approved_by: r.approved_by, targets: publishTargets(s.targets), attempts: 0 }
    if (offGen !== gen0) return { queued }   // turned off while this pass was looking: add nothing (no await between this check and the add)
    entries.set(e.id, e); queued++
    if (dry) {
      e.reason = `dry run: nothing is sent${c.warnings?.length ? `; ${c.warnings.join('; ')}` : ''}`
      if (!st.would?.[key]) {   // once per version: History, and Slack when ticked
        await mutate((s2) => { s2.would = { ...(s2.would ?? {}), [key]: iso(deps.now()) } })
        history.record({ kind: 'change', area: 'configuration', action: 'auto-publish would upload', what: `${r.shot} ${r.version}`, detail: `dry run: ${e.files.length} files (${publish.fmtSize(e.bytes)})${c.warnings?.length ? `, ${c.warnings.join('; ')}` : ''}, approved by ${r.approved_by}; would use ${publishTargets(s.targets).join(' + ')}; nothing was sent`, approved_by: s.standing.approved_by })
      }
      try {   // the whole pipeline except the writes: the exact keys, the manifest, the access check
        const cn: Record<string, string> = {}, items = [...reviewItems({ shot: e.shot, version: e.version, source: e.source, files: e.files.map((name) => ({ name, bytes: 0 })) }), ...(dpxOn(s) ? (await dpxprep.prepare({ seqs: await seqsOf(e), approvedBy: '', dry: true, testRound: /^_TEST_/.test(s.round) })).items : [])]
        e.dry_run_plan = await publish.dryRun({ items, round: s.round.replace(/\{date\}/g, localDay(deps.now())), clip_names: cn })
      } catch (err) { e.reason = `${e.reason}; the dry-run plan could not be made: ${publish.redact((err as Error).message).slice(0, 160)}` }
    }
  }
  if (dry && queued) await dryRunSlack(s).catch(() => undefined)
  return { queued }
}

// ----- the dry-run summary: one Slack message for the set of would-upload entries (ADR-050) -----
const DRYSLACK_EVERY_MS = 10 * 60_000
/** The text the dry-run Slack summary posts (also for the MCP and the window: preview only). */
export async function dryRunReport(): Promise<{ text: string; versions: number; signature: string; posted_at: string | null }> {
  const s = await stored(), list = [...entries.values()].filter((e) => e.state === 'would_upload').sort((a, b) => a.key.localeCompare(b.key)), st = await stateOf()
  const files = list.reduce((a, e) => a + e.files.length, 0), bytes = list.reduce((a, e) => a + e.bytes, 0), round = s.round.replace(/\{date\}/g, localDay(deps.now())), plan0 = list.find((e) => e.dry_run_plan)?.dry_run_plan
  const dest = `s3://${plan0?.bucket || '(bucket)'}/${plan0?.prefix ?? ''}${round}/`, who = s.standing?.approved_by ?? '(nobody)'
  const lines = list.slice(0, 12).map((e) => { const p = e.dry_run_plan, dpx = p ? p.files.some((f) => /\.dpx$/i.test(f.key)) : false, notes = [...new Set((p?.sequences ?? []).flatMap((q) => q.notes))].slice(0, 3)
    return `• ${clean(e.shot)} ${e.version}: ${e.files.length} file${e.files.length === 1 ? '' : 's'}, ${publish.fmtSize(e.bytes)}, DPX frames ${dpx ? `included (${p!.files.filter((f) => /\.dpx$/i.test(f.key)).length})` : 'not included'}${notes.length ? `; ${notes.map(clean).join('; ')}` : ''}` })
  const access = plan0?.access ? `S3 access: ${plan0.access.ok ? 'ok' : 'NOT ok'}: ${clean(plan0.access.detail)}` : 'S3 access: not checked'
  const text = list.length ? [`*DRY RUN: nothing was uploaded*`, `Would upload ${list.length} review video${list.length === 1 ? '' : 's'} (${files} files, ${publish.fmtSize(bytes)}) to ${dest} ${s.window_minutes > 0 ? `after a ${s.window_minutes}-minute window` : 'right away (no cancel window)'}`, ...lines, ...(list.length > 12 ? [`…and ${list.length - 12} more`] : []), access, `Under the standing approval of ${clean(who)}; targets ${publishTargets(s.targets).join(' + ')}.`, `A live run posts one message per shot: "Auto-publish: <shot> <version>, N file(s), size, destination, approved by ${clean(who)}".`, 'To go live, switch off Dry run in RunPod Manager (Queue > Auto-publish).'].join('\n') : '*DRY RUN: nothing was uploaded*\nNothing is waiting.'
  return { text: publish.redact(text), versions: list.length, signature: list.map((e) => `${e.key}:${e.files.length}:${e.bytes}`).join('|'), posted_at: st.dryslack ? iso(st.dryslack.at) : null }
}
/** Post the summary when the SET changed (never the same set twice) and at most once in 10 minutes; only when Slack is a target. */
async function dryRunSlack(s: Awaited<ReturnType<typeof stored>>): Promise<void> {
  if (!s.targets.slack) return
  const r = await dryRunReport(); if (!r.versions) return
  const st = await stateOf(); if (st.dryslack?.sig === r.signature || (st.dryslack && deps.now() - st.dryslack.at < DRYSLACK_EVERY_MS)) return
  await mutate((x) => { x.dryslack = { sig: r.signature, at: deps.now() } })
  void publish.notifySlack(r.text).catch(() => undefined)
}

/** One scheduler pass (every 5 s): start what is due. Returns how many uploads it started. */
export async function tick(): Promise<number> {
  await ensureLoaded()
  const s = await stored(); let started = 0
  const on = s.enabled === true && !!s.standing
  for (const e of [...entries.values()]) {
    if (e.state === 'uploading' || e.queued) continue
    if (!on) { finish(e, 'cancelled', 'turned off'); continue }
    if (e.state === 'would_upload') { if (s.dry_run !== false) continue; e.state = 'waiting'; e.due_at = deps.now() + s.window_minutes * 60_000; delete e.reason }   // it went live: the cancel window starts now
    const retry = e.state === 'failed' && e.attempts <= MAX_RETRIES && (e.retry_at ?? 0) <= deps.now()
    if (e.state === 'failed' && !retry) continue
    if (e.state !== 'failed' && e.due_at > deps.now()) continue
    e.run = queueUpload(e, s); started++
  }
  return started
}

/** One upload at a time: the cap is checked against the true count, and the state file has one writer. */
let uploadChain: Promise<unknown> = Promise.resolve()
function queueUpload(e: Entry, s: Stored): Promise<void> { e.queued = true; const run = uploadChain.then(() => upload(e, s)).catch(() => undefined).then(() => { e.queued = false }); uploadChain = run; return run }
async function upload(e: Entry, s: Stored): Promise<void> {
  const st0 = await stateOf(), day = localDay(deps.now())
  const count = st0.day === day ? st0.count ?? 0 : 0
  if (!e.manual) {
    // re-check everything at the moment of sending
    if (s.enabled !== true || !s.standing) return finish(e, 'cancelled', 'turned off')
    if (!s.require_approval ? false : !(await approvalList()).some((a) => a.shot === e.shot && a.version === e.version)) return finish(e, 'cancelled', 'approval revoked')   // without require_approval the standing approver stands for every eligible review (as in check() and the queueing), so there is no record to look for; the standing approval itself was re-checked on the line above
    if (s.dry_run !== false) { e.state = 'would_upload'; return }
    if (s.daily_cap !== null && count >= s.daily_cap) { e.state = 'capped'; e.reason = 'daily cap reached; it goes next day, or use Publish now'; e.due_at = deps.now() + 5 * 60_000; return }
    const c = await check(e.shot, e.version, { pendingOk: true })
    if (!c.ok) { if (c.inDest) { await markUploaded(e, undefined, false); return finish(e, 'done', c.reason) } return finish(e, 'cancelled', c.reason) }
  }
  e.state = 'uploading'; delete e.reason
  await mutate((st) => { st.inflight = { ...(st.inflight ?? {}), [e.key]: iso(deps.now()) } })
  const standing = s.standing?.approved_by ?? '', who = e.manual ? e.reason_who ?? standing : standing
  try {
    const round = s.round.replace(/\{date\}/g, localDay(deps.now())), clipNames: Record<string, string> = {}, items: unknown[] = reviewItems({ shot: e.shot, version: e.version, source: e.source, files: e.files.map((name) => ({ name, bytes: 0 })) })
    if (dpxOn(s)) {   // ADR-057 decision 7: the corrected copy is made first and is what goes; a flagged plan, a failed fix or no approver holds the whole review back
      const pr = await dpxprep.prepare({ seqs: await seqsOf(e), approvedBy: standing || who, dry: false, testRound: /^_TEST_/.test(round) })
      if (pr.held) { const why = `held back: ${pr.held}`; dpxFailUntil.set(e.key, { until: deps.now() + 10 * 60_000, why }); edlHold.set(e.key, why); await mutate((st2) => { if (st2.inflight) delete st2.inflight[e.key] }); return finish(e, 'cancelled', why) }
      items.push(...pr.items); if (pr.skipped.length) e.reason = `video only for: ${pr.skipped.join('; ')}`.slice(0, 300)
      const pl0 = await publish.plan({ items, round, clip_names: clipNames, targets: publishTargets(s.targets) }), held = (pl0.sequences ?? []).filter((x) => x.blocked)   // ADR-050: what the EDL does not allow is still held back with its reason
      if (held.length) {
        const why = held.map((x) => `${x.clip}: ${x.reason}`).join(' | ').slice(0, 300)
        if (!pl0.items.some((i) => i.skip === null || i.skip === 'same size already there')) return finish(e, 'cancelled', `skipped: ${why}`)
        e.reason = `held back: ${why}`
      }
    }
    const { job_id } = await publish.run({
      items, round, clip_names: clipNames, targets: publishTargets(s.targets), approved_by: who, trigger: e.manual ? 'auto-publish:manual' : 'auto-publish',
      note: `${e.manual ? 'published now by' : 'automatic upload; standing approval of'} ${who}; ${e.shot} ${e.version} approved by ${e.approved_by}; targets ${publishTargets(s.targets).join(' + ')}`,
      message: `Auto-publish: ${clean(e.shot)} ${clean(e.version)}\n{count} file(s), {size}\nDestination: {dest}\n{files}\n${e.manual ? 'Published now by' : 'Uploaded automatically under the standing approval of'} {approved_by}; this shot version was approved by ${clean(e.approved_by)}.`,
    })
    e.job_id = job_id; await publish.settled()
    const j = publish.status(job_id).jobs[0]
    if (j && (j.state === 'done' || j.state === 'done_with_warning')) { await markUploaded(e, job_id, !e.manual); if (j.state === 'done_with_warning') e.reason = 'files uploaded; the Slack message failed'; return finish(e, 'done', e.reason) }
    throw new Error(j?.error ?? j?.summary ?? 'the upload did not finish')
  } catch (err) {
    e.attempts++; e.state = 'failed'; e.reason = publish.redact((err as Error).message).slice(0, 300); e.retry_at = deps.now() + RETRY_MS
    await mutate((st2) => { if (st2.inflight) delete st2.inflight[e.key] })
    history.record({ kind: 'change', area: 'configuration', action: 'auto-publish failed', what: `${e.shot} ${e.version}`, detail: `attempt ${e.attempts}: ${e.reason}${e.attempts <= MAX_RETRIES ? '; tries again in 10 minutes' : '; gave up'}` })
  }
}
async function markUploaded(e: Entry, job_id: string | undefined, counted: boolean): Promise<void> {
  const day = localDay(deps.now())
  await mutate((st) => {
    st.uploaded = { ...(st.uploaded ?? {}), [e.key]: { at: iso(deps.now()), ...(job_id ? { job_id } : {}), ...(e.manual ? { manual: true } : {}) } }
    if (st.day !== day) { st.day = day; st.count = 0 }
    if (counted) st.count = (st.count ?? 0) + 1
    if (st.inflight) delete st.inflight[e.key]
    if (st.would) delete st.would[e.key]
  })
  inDestination.set(e.key, true)
}

// ----- status and the person's actions -----
export interface Watching { local: { enabled: boolean; root: string | null; root_exists: boolean; reviews: number }; volume: { enabled: boolean; id: string; reviews: number; scanned_at: string | null; scanning: boolean; error?: string }; /** this PC's folder (kept from the first version of this field) and the totals over the places watched */ root: string | null; root_exists: boolean; shots: number; reviews: number; approved: number; eligible: number; queued: number; uploaded_today: number; /** what was uploaded today: the review, when, and whether a person pressed Publish now (additive) */ uploaded?: { shot: string; version: string; at: string; manual?: boolean; already?: boolean }[]; skipped: { shot: string; version: string; reason: string }[]; /** the scope in force and, with `edl` and no EDL loaded, why nothing is generated or queued */ scope: 'edl' | 'all'; scope_warning?: string; summary: string }
export function status(): { generate: autogenerate.GenerateStatus; watching: Watching; enabled: boolean; dry_run: boolean; dry_run_first: boolean; standing: Standing | null; window_minutes: number; daily_cap: number | null; targets: Targets; today: { count: number; left: number | null }; destination: string; /** the DPX of an upload: included or not, fixed first (ADR-057 decision 7) or off, and how many sequences are being corrected now */ dpx: { include: boolean; fix: boolean; mode: string; fixing: number }; pending: ReturnType<typeof view>[]; recent: ReturnType<typeof view>[] } {
  void ensureLoaded()
  const m = memo
  return { generate: autogenerate.status(memo.generate), watching: watchMemo.value, enabled: m.enabled, dry_run: m.dry_run, dry_run_first: m.dry_run_first, standing: m.standing, window_minutes: m.window_minutes, daily_cap: m.daily_cap, targets: { ...m.targets }, today: { count: m.count, left: m.daily_cap === null ? null : Math.max(0, m.daily_cap - m.count) }, destination: m.destination, dpx: { include: m.include_dpx, fix: m.fix_dpx, mode: !m.include_dpx ? 'not included' : m.fix_dpx ? 'corrected copies (dpx_fix first)' : 'off: fix_dpx is off, so no DPX frames are uploaded (the review video only)', fixing: dpxprep.fixingCount() }, pending: [...entries.values()].map((e) => ({ ...view(e), targets: publishTargets(m.targets) })), recent: recent.map(view) }
}
/** The settings and today's count as the status answers them, from memory (refreshed on every change and every tick). */
const memo = { generate: { ...mounts.AUTO_GENERATE_DEFAULT } as mounts.AutoGenerateConfig, enabled: false, dry_run: true, dry_run_first: true, standing: null as Standing | null, targets: { s3: true, slack: false, tunnel: false } as Targets, window_minutes: WINDOW_DEFAULT, daily_cap: null as number | null, include_dpx: false, fix_dpx: true, count: 0, destination: '' }
async function refreshMemo(): Promise<void> {
  const s = await settings(), st = await stateOf()
  Object.assign(memo, { generate: s.generate, enabled: s.enabled, dry_run: s.dry_run, dry_run_first: s.dry_run_first, standing: s.standing, targets: s.targets, window_minutes: s.window_minutes, daily_cap: s.daily_cap, include_dpx: s.include_dpx, fix_dpx: s.fix_dpx !== false, destination: s.destination, count: st.day === localDay(deps.now()) ? st.count ?? 0 : 0 })
}
/** What Auto-publish is looking at, in one sentence, and why each review it saw is not going out. It reads this PC's deliver/ only (volume-side scanning is a later decision). Cached for 10 s so the window's polling is never a listing storm. */
const emptyWatching = (): Watching => ({ local: { enabled: true, root: null, root_exists: false, reviews: 0 }, volume: { enabled: true, id: '', reviews: 0, scanned_at: null, scanning: false }, root: null, root_exists: false, shots: 0, reviews: 0, approved: 0, eligible: 0, queued: 0, uploaded_today: 0, skipped: [], scope: 'edl', summary: '' })
const watchMemo: { at: number; value: Watching } = { at: 0, value: emptyWatching() }
async function computeWatching(): Promise<Watching> {
  const cfg = await stored(), root = deps.outputRoot(), exists = async (p: string) => { try { return (await stat(p)).isDirectory() } catch { return false } }
  const w = emptyWatching(); w.queued = entries.size; w.root = root; w.local.enabled = cfg.sources.local; w.local.root = root; w.volume.enabled = cfg.sources.volume
  w.volume.id = vol.id || (cfg.sources.volume ? publish.volumeIdNow() : ''); w.volume.scanned_at = vol.at ? iso(vol.at) : null; w.volume.scanning = vol.scanning; if (vol.error) w.volume.error = vol.error
  w.root_exists = !!root && (await exists(root)); w.local.root_exists = w.root_exists
  const hasDeliver = !!root && (await exists(join(root, 'deliver')))
  const st = await stateOf(), ap = await approvalList(), found = await allReviews(), pend = new Set([...entries.values()].map((e) => e.key))
  await edl.ensure(); w.scope = cfg.scope; if (cfg.scope === 'edl' && !edl.isLoaded()) w.scope_warning = 'No EDL is loaded: with Only EDL Elements nothing is generated or queued until it is (load it in the EDL panel, or set Scope to Everything).'
  w.local.reviews = found.filter((f) => f.source === 'local').length; w.volume.reviews = cfg.sources.volume ? vol.reviews.length : 0
  w.uploaded_today = st.day === localDay(deps.now()) ? st.count ?? 0 : 0
  w.uploaded = Object.entries(st.uploaded ?? {}).filter(([, u]) => u.at && localDay(Date.parse(u.at)) === localDay(deps.now())).map(([k, u]) => { const i = k.lastIndexOf('/'); return { shot: k.slice(0, i), version: k.slice(i + 1), at: u.at, ...(u.manual ? { manual: true } : {}), ...(u.already ? { already: true } : {}) } }).sort((a, b) => a.at.localeCompare(b.at)).slice(-200); w.shots = new Set(found.map((f) => f.shot)).size; w.reviews = found.length
  let published = 0
  for (const f of found) {
    const key = keyOf(f.shot, f.version), approved = !cfg.require_approval ? f.complete : ap.some((a) => a.shot === f.shot && a.version === f.version), uploaded = !!st.uploaded?.[key]
    if (approved) w.approved++
    const sr = uploaded ? '' : await scopeReason(cfg.scope, f)
    const reason = uploaded ? 'already published' : sr ? sr : edlHold.get(key) && !pend.has(key) ? edlHold.get(key) : inDestination.get(key) ? 'already at the destination' : !f.complete ? f.why ?? 'not complete' : !approved ? 'not approved' : st.held?.includes(key) ? 'held by a person' : st.cancelled?.includes(key) ? 'cancelled by a person' : ''
    if (approved && uploaded) published++
    if (!reason) { if (!pend.has(key)) w.eligible++ } else if (w.skipped.length < 50) w.skipped.push({ shot: f.shot, version: f.version, reason })
  }
  const n = w.reviews, plural = (k: number, x: string) => `${k} ${x}${k === 1 ? '' : 's'}`
  const tail = !cfg.require_approval ? `${w.eligible + w.queued} eligible, ${w.queued} waiting for their window${published ? `, ${published} already published` : ''}` : w.approved === 0 ? 'none approved yet (Approve a review, or Binc says yes)' : published >= w.approved && !w.queued ? `all ${w.approved} approved review${w.approved === 1 ? ' is' : 's are'} already published` : `${w.approved} approved, ${w.queued} waiting for their window`
  const ago = vol.scanning ? 'scanning now' : vol.at ? `scanned ${Math.max(0, Math.round((deps.now() - vol.at) / 60_000))} minute${Math.round((deps.now() - vol.at) / 60_000) === 1 ? '' : 's'} ago` : 'not scanned yet'
  const volText = `the volume (${plural(w.volume.reviews, 'review')}, ${ago}${vol.error ? `; it could not be listed: ${vol.error}` : ''})`
  if (cfg.sources.local && cfg.sources.volume) w.summary = `Watching this PC (${plural(w.local.reviews, 'review')}) and ${volText}: ${tail}`
  else if (cfg.sources.volume) w.summary = `Watching ${volText}: ${tail}`
  else if (!root) w.summary = 'The local output folder is not set'
  else if (!hasDeliver) w.summary = `Watching ${root}: it has no deliver/ folder (reviews are found only on this PC: turn on Sync the renders to this PC)`
  else if (n === 0) w.summary = `Watching ${root}: its deliver/ folder holds no reviews yet`
  else if (w.approved === 0) w.summary = `Watching ${root}: ${plural(n, 'review')} found, ${tail}`
  else w.summary = w.approved > 0 && published >= w.approved && !w.queued ? `All ${w.approved} approved review${w.approved === 1 ? ' is' : 's are'} already published` : tail.charAt(0).toUpperCase() === tail.charAt(0) ? tail : tail
  const gs = autogenerate.status(cfg.generate)
  if (cfg.scope === 'edl') w.summary += w.scope_warning ? ' Scope: only EDL elements, but no EDL is loaded, so nothing is generated or queued.' : ' Scope: only EDL elements.'
  if (cfg.generate.enabled) w.summary += ` Auto-generate is on (${cfg.generate.where}${cfg.generate.preset === 'tunnel' ? ', Tunnel proxy' : ''}): ${gs.waiting_to_settle.length} waiting to settle, ${gs.generating} rendering${gs.waiting_for_pod ? ', waiting for a running pod' : ''}, ${gs.generated_today} started today.`
  return w
}
export async function statusNow() { await refreshMemo(); if (deps.now() - watchMemo.at > 10_000 || !watchMemo.value.summary) { watchMemo.value = await computeWatching(); watchMemo.at = deps.now() } return status() }

export async function cancel(o: { id?: string }): Promise<{ id: string; state: EntryState }> {
  const e = entries.get(String(o?.id ?? '')); if (!e) throw new CoreError(404, `No such pending auto-publish: ${o?.id}`)
  if (e.state === 'uploading') throw bad('That upload has started; it cannot be cancelled here')
  await mutate((st) => { st.cancelled = [...new Set([...(st.cancelled ?? []), e.key])]; if (st.would) delete st.would[e.key] })
  finish(e, 'cancelled', 'cancelled by a person')
  history.record({ kind: 'change', area: 'configuration', action: 'auto-publish cancelled', what: `${e.shot} ${e.version}`, detail: 'not retried until revoked and approved again, or published now' })
  return { id: e.id, state: e.state }
}
export async function publishNow(o: { id?: string; approved_by?: string }): Promise<{ id: string; started: boolean }> {
  const who = clean(o?.approved_by); if (!who) throw bad(NEEDS_NAME_NOW)
  const e = entries.get(String(o?.id ?? '')); if (!e) throw new CoreError(404, `No such pending auto-publish: ${o?.id}`)
  if (e.state === 'uploading') throw bad('That upload has already started')
  const s = await stored(); e.manual = true; e.reason_who = who
  const c = await check(e.shot, e.version, { pendingOk: true, manual: true }); if (!c.ok && !c.inDest) { e.manual = false; throw bad(`Cannot publish: ${c.reason}`) }
  e.run = queueUpload(e, s)
  return { id: e.id, started: true }
}

// ----- life cycle -----
async function ensureLoaded(): Promise<void> { await (loaded ??= recover()) }
/** At start: a version that was uploading when the app died is checked against the destination before it is tried again; approvals made while the app was closed are picked up by `consider`. */
async function recover(): Promise<void> {
  const st = await stateOf(); const inflight = Object.keys(st.inflight ?? {})
  for (const key of inflight) {
    const [shot, version] = key.split('/'); const base = deps.outputRoot(); if (!base || !shot || !version) continue
    const f = await lookAt(base, shot, version); if (!f) continue
    try {
      const pl = await publish.plan({ items: f.files.map((x) => `deliver/${shot}/${version}/${x.name}`), targets: ['s3'], round: (await stored()).round.replace(/\{date\}/g, localDay(deps.now())) })
      if (pl.items.length && pl.items.every((i) => i.skip === 'same size already there')) { await mutate((s2) => { s2.uploaded = { ...(s2.uploaded ?? {}), [key]: { at: iso(deps.now()) } }; if (s2.inflight) delete s2.inflight[key] }); inDestination.set(key, true); continue }
    } catch { /* destination unreadable: it will be tried again as a new upload */ }
    await mutate((s3) => { if (s3.inflight) delete s3.inflight[key] })
  }
  await refreshMemo()
}
export async function start(): Promise<void> {
  stop(); await ensureLoaded(); await refreshMemo(); void volumeTick().catch(() => undefined); void consider().catch(() => undefined)
  timers = [setInterval(() => { void timedTick('autopublish.tick', () => tick()).then(refreshMemo).catch(() => undefined) }, TICK_MS), setInterval(() => { void timedTick('autopublish.consider', () => consider()).then(() => generatePass()).then(refreshMemo).catch(() => undefined) }, CONSIDER_MS), setInterval(() => { void timedTick('autopublish.volumeTick', () => volumeTick()).catch(() => undefined) }, 30_000)]
  for (const t of timers) t.unref?.()
}
export function stop(): void { for (const t of timers) clearInterval(t); timers = [] }
export const settled = async (): Promise<void> => { for (const e of [...entries.values()]) await e.run; await publish.settled() }
/** Called where a review render ends: best effort, never throws, never delays the render. */
export function considerSoon(): void { try { void consider().then(refreshMemo).catch(() => undefined) } catch { /* never fails a render */ } }
/** Forget everything in memory (tests). */
export function reset(): void { edlMemo.clear(); edlHold.clear(); dpxMemo.clear(); dpxFailUntil.clear(); dpxprep.reset(); autogenerate.reset(); Object.assign(memo, { generate: { ...mounts.AUTO_GENERATE_DEFAULT } }); watchMemo.at = 0; watchMemo.value = emptyWatching(); vol.ac?.abort(); Object.assign(vol, { at: 0, scanning: false, id: '', reviews: [], promise: undefined, ac: undefined }); delete vol.error; uploadChain = Promise.resolve(); stateLock = Promise.resolve(); considering = Promise.resolve(); ; stop(); entries.clear(); recent = []; seq = 0; loaded = null; inDestination.clear(); Object.assign(memo, { enabled: false, dry_run: true, dry_run_first: true, standing: null, targets: { s3: true, slack: false, tunnel: false }, window_minutes: WINDOW_DEFAULT, daily_cap: null, count: 0, destination: '' }); setDeps(null) }
