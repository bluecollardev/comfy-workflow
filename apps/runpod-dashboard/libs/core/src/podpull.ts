/**
 * Rounds on the network volume: a pod pulls a delivery round from the Panama bucket onto `/workspace/comfy-shared/temp/rounds/<round>`, checks it
 * against its manifests, and Delete removes it (docs/ADR-022, built on ADR-015's pull). The bytes never touch this PC.
 *
 * Two routes, chosen by `plan`:
 *  - active:    a pod the user already runs on the volume. The pull (or delete) runs on it over the Sync's SSH transport (`sync.sshTarget`),
 *               the script and the bucket keys on STDIN, never in an argument. Their pod is never tagged, stopped or deleted; its idle timer
 *               is held for the job (with a ceiling) and put back.
 *  - temporary: no pod runs. A pod is created through the app's own create path (`pods.create`) on the volume, cheapest card in stock (ADR-022
 *               2b, final: no CPU path), named `ComfyUI-Pull-<round>-<MMDD>` so it is recognisable in the manager (2c), registered with the idle
 *               watch with a CEILING of minutes for the length of the pull (2d: a pull queues nothing in ComfyUI, so it looks idle), followed
 *               through its log, and deleted when the job ends, fails or is cancelled. It is written to a small file BEFORE it is created, so
 *               a crash leaves a tag to find it by.
 *
 * What is on the volume cannot be read without a pod (a volume in EUR-IS-2 has no RunPod S3 API), so `rounds` answers from what the last pod
 * job reported, kept per volume with the time it was learned (`as_of`).
 *
 * No-spend mode (mounts.dryRun) simulates the whole job without RunPod or SSH. Spend: a temporary pod is a pod creation; it is recorded with
 * `approved_by` (the user's approval to build this feature); the agent rules (named yes, ceiling) are system-wide settings read where governance is (the MCP server); core keeps no ledger.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { CoreError, bad } from './errors.js'
import * as dry from './dry.js'
import * as history from './history.js'
import * as gpus from './gpus.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as panama from './panama.js'
import * as hf from './hf.js'
import { configDir } from './paths.js'
import * as place from './place.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as settings from './settings.js'
import * as sync from './sync.js'
import * as volumesMod from './volumes.js'

export const REMOTE_ROUNDS = '/workspace/comfy-shared/temp/rounds'
export const POD_PREFIX = 'ComfyUI-Pull-'
export const APPROVED_BY = 'Lucas'
/** Seconds-per-byte assumption for the ceiling (ADR-022 2d): a pull is expected to run at least this fast. */
export const ASSUMED_BYTES_PER_SECOND = 30e6
/** The same rule as panama.ts: one folder name under rounds/. A test keeps the two in step. */
const ROUND = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/
const assertRound = (round: string) => { if (typeof round !== 'string' || !ROUND.test(round)) throw bad(`Not a round name: ${round}`) }

/** How long the idle timer is held for a pull: the larger of 30 minutes and the round's size at 30 MB/s. */
/** The sync agent (a pod this job starts, or resumes) stops by itself after this many quiet minutes once the job is over. */
export const AGENT_IDLE_MINUTES = 15
export const ceilingMinutes = (bytes: number) => Math.max(30, Math.ceil(bytes / ASSUMED_BYTES_PER_SECOND / 60))
export const podName = (round: string, now = new Date()) => `${POD_PREFIX}${round}-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
export const s3PullFor = (round: string) => `${panama.bucket()}/rounds/${round}=${REMOTE_ROUNDS}/${round}`

// ----- what was last learned about each volume, and the temporary pods this app made -----

export type RoundState = panama.Staged['state']
interface RoundRec { state: RoundState; present: number; expected: number | null; missing: number | null; bytes: number; /** the shots copied, when the pull was of some shots only */ shots?: string[] }
interface VolRec { as_of: string; rounds: Record<string, RoundRec> }
const stateFile = () => process.env.VOLUME_ROUNDS_FILE || join(configDir(), 'volume-rounds.json')
/** The volume records used to share pod-rounds.json with the pod -> round map (a round deleted in the window then failed on an object where a name was expected). Move them to their own file once. */
function migrateState() {
  const f = stateFile(); if (existsSync(f)) return
  const old = process.env.POD_ROUNDS_FILE || join(configDir(), 'pod-rounds.json')
  const all = readJson<Record<string, unknown>>(old, {})
  const vols = Object.fromEntries(Object.entries(all).filter(([, v]) => v && typeof v === 'object'))
  if (!Object.keys(vols).length) return
  writeJson(f, vols)
  writeJson(old, Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v === 'string')))
}
const tempFile = () => process.env.PULL_PODS_FILE || join(configDir(), 'pull-pods.json')
const readJson = <T>(f: string, fallback: T): T => { try { return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback } catch { return fallback } }
const writeJson = (f: string, v: unknown) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
/** Simulated jobs never write over what a real volume reported. */
const volKey = (volumeId: string) => (mounts.dryRun(mounts.load()) ? `simulated:${volumeId}` : volumeId)

export function recordState(volumeId: string, round: string, rec: RoundRec | null, now = new Date()) {
  migrateState()
  const all = readJson<Record<string, VolRec>>(stateFile(), {})
  const v = (all[volKey(volumeId)] ||= { as_of: now.toISOString(), rounds: {} })
  if (rec) v.rounds[round] = rec; else delete v.rounds[round]
  v.as_of = now.toISOString()
  writeJson(stateFile(), all)
}
/** Everything known about the rounds on a volume is dropped (after its pulled rounds were erased). */
export function forgetVolume(volumeId: string): void { migrateState(); const all = readJson<Record<string, VolRec>>(stateFile(), {}); if (all[volKey(volumeId)]) { delete all[volKey(volumeId)]; writeJson(stateFile(), all) } }
export const knownState = (volumeId: string): VolRec | null => { migrateState(); return readJson<Record<string, VolRec>>(stateFile(), {})[volKey(volumeId)] ?? null }

export interface TempPod { round: string; kind: 'pull' | 'remove' | 'browse' | 'erase' | 'clone' | 'fetch'; name: string; pod_id: string | null; volume: string; created_at: string; approved_by: string }
/** The temporary pods this app has made and not yet deleted. One left behind (the app closed mid-job) is listed here and shows in the manager under its name. */
export const temporaryPods = (): TempPod[] => readJson<TempPod[]>(tempFile(), [])
const tempAdd = (t: TempPod) => writeJson(tempFile(), [...temporaryPods().filter((x) => x.name !== t.name), t])
const tempSetId = (name: string, podId: string) => writeJson(tempFile(), temporaryPods().map((x) => (x.name === name ? { ...x, pod_id: podId } : x)))
const tempDrop = (name: string) => writeJson(tempFile(), temporaryPods().filter((x) => x.name !== name))

// ----- availability, the volume, the plan -----

export interface Volume { id: string; name: string; datacenter: string }
const volCache = new Map<string, Volume>()
export function capability(): panama.PodCapability {
  const cfg = mounts.load()
  const id = (cfg.network_volume_id || '').trim()
  if (!id) return { available: false, reason: 'No network volume is set in Default Configuration: a pod needs the volume to pull onto.', volume: null }
  const vol = volCache.get(id) ?? { id, name: id, datacenter: cfg.data_center_id || '' }
  if (!mounts.dryRun(cfg) && !settings.lookup('RUNPOD_API_KEY')) return { available: false, reason: 'No RunPod API key: enter it in Default Configuration.', volume: vol }
  if (!panama.appKeys()) return { available: false, reason: 'A pod needs the Panama bucket keys stored in Default Configuration; an AWS profile on this PC cannot go to a pod.', volume: vol }
  return { available: true, reason: '', volume: vol }
}
panama.setPodCapability(capability)

/** Browse and erase work on any volume of the account over a short-lived pod: no bucket keys, only RunPod. */
function volumeJobCapability(): { available: boolean; reason: string } {
  if (!mounts.dryRun(mounts.load()) && !settings.lookup('RUNPOD_API_KEY')) return { available: false, reason: 'No RunPod API key: enter it in Default Configuration.' }
  return { available: true, reason: '' }
}

export interface AwsResult { code: number | null; stdout: string; stderr: string }
export type AwsRunner = (args: string[], env: Record<string, string>) => Promise<AwsResult>
export interface Opts {
  /** Runs the `aws` CLI (RunPod's S3 API for a volume). Tests inject one. */
  aws?: AwsRunner
  /** Makes the one-off SSH key pair a clone between two pods uses. Tests inject one. */
  keygen?: () => Promise<{ priv: string; pub: string; comment: string }>
  client?: rp.RunPodClient
  /** Runs a script on a pod over SSH. Tests inject one; the default is `ssh` itself. */
  ssh?: SshRunner
  /** The pod's recent log lines (container and system). Default: RunPod's log stream, read for a few seconds. */
  logs?: (podId: string) => Promise<{ ts: string; line: string }[]>
  sizeOf?: (round: string) => { files: number; bytes: number } | Promise<{ files: number; bytes: number }>
  listRounds?: () => string[]
  pollMs?: number
  /** How long a temporary pod is waited for to expose SSH so the round can be placed (ADR-033). Default 3 minutes; a pod without SSH fails the placing, not the pull. */
  placeWaitMs?: number
  now?: () => Date
  /** Where a pod download runs: on 'current' (the user's pod on the volume, started first if it is off) or on a 'temporary' pod of the cheapest card. Unset: the user's pod if it is running, else a temporary one. */
  route?: 'current' | 'temporary'
  /** Work on this volume instead of the Default Configuration's (browse and erase are about one volume of the account). */
  volumeId?: string
  /** Pull only these shots (and the round's shared files): the other shot folders are left in the bucket. Unset or all of them: the whole round. */
  shots?: string[]
  /** (set by pull) the shot folders left out, for the size of the plan */
  skipShots?: string[]
  /** (tests) the round's shot folders, instead of reading the bucket */
  shotDirs?: string[]
}

async function volumeOf(opts: Opts): Promise<Volume | null> {
  const cfg = mounts.load()
  const id = (opts.volumeId || cfg.network_volume_id || '').trim()
  if (!id) return null
  try {
    const v = await pods.volumeInfo(id, opts.client)
    if (v) { const vol = { id: v.id, name: v.name, datacenter: v.datacenter }; volCache.set(id, vol); return vol }
  } catch { /* fall back to what the configuration says */ }
  return volCache.get(id) ?? { id, name: id, datacenter: cfg.data_center_id || '' }
}

export interface PodPlan {
  round: string; route: 'active' | 'temporary' | 's3'; pod: { id: string; name: string; price_per_hour: number | null } | null
  /** A volume job that went through a pod: why it did not use RunPod's S3 API (the volume's datacenter has none, or no S3 keys are set) */
  s3_note?: 'datacenter' | 'keys'
  gpu: string; price_per_hour: number | null; bytes: number; idle_stop_minutes: number
  /** Beyond the contract: how long the idle timer is held for this job (decision 2d), and how many files the bucket has under the round. */
  ceiling_minutes: number; files: number; volume: Volume | null
  /** Set when the card is outside the app's table (none of the table's cards was free): the RunPod id the pod is created with. */
  gpu_type_id?: string
  /** Both ways to do the work, for the confirmation window: the user's own pod on the volume (running, or off and started first) and a temporary one of the cheapest card. */
  choices?: { current: { id: string; name: string; running: boolean; price_per_hour: number | null; gpu: string } | null; temporary: { gpu: string; price_per_hour: number | null; gpu_type_id?: string } }
}

const gpuName = (id: string) => Object.entries(gpus.GPUS).find(([, g]) => g.id === id)?.[0] || id
const sizeOf = async (round: string, opts: Opts) => {
  try { const s = await (opts.sizeOf ?? ((r: string) => panama.sizeAsync(r, opts.skipShots)))(round); return { files: s.files, bytes: s.bytes } } catch { return { files: 0, bytes: 0 } }
}

/** A pod of the user's on the configured volume that the Sync's SSH route can reach, if any: a running one first, else an off one (started before the job). Our own pull pods never count. */
async function findActivePod(cfg: mounts.MountsConfig, opts: Opts): Promise<{ id: string; name: string; price: number | null; gpu: string; running: boolean } | null> {
  if (mounts.dryRun(cfg)) {
    const all = dry.list().filter((x) => !x.name.startsWith(POD_PREFIX))
    const p = all.find((x) => x.status === 'running') ?? all.find((x) => x.status === 'stopped')
    return p ? { id: p.id, name: p.name, price: 0, gpu: p.gpu, running: p.status === 'running' } : null
  }
  const volume = (opts.volumeId || cfg.network_volume_id || '').trim()
  let off: { id: string; name: string; price: number | null; gpu: string; running: boolean } | null = null
  for (const raw of await rp.listPods(opts.client)) {
    if ((raw.networkVolumeId || '') !== volume || (raw.name || '').startsWith(POD_PREFIX)) continue
    if ((raw.runtime?.uptimeInSeconds ?? 0) > 0) {
      try { sync.sshTarget(raw) } catch { continue }
      return { id: raw.id, name: raw.name || raw.id, price: raw.costPerHr ?? null, gpu: raw.machine?.gpuDisplayName || '', running: true }
    }
    if (!off && raw.desiredStatus === 'EXITED') off = { id: raw.id, name: raw.name || raw.id, price: null, gpu: raw.machine?.gpuDisplayName || '', running: false }
  }
  return off
}

/** The shot folders a pull of `opts.shots` leaves out (none for the whole round). */
async function skipOf(round: string, opts: Opts): Promise<string[]> {
  if (!opts.shots?.length) return []
  const all = opts.shotDirs ? opts.shotDirs : panama.shotDirsOf((await panama.filesAsync(round)).entries)
  for (const s of opts.shots) if (!all.includes(s)) throw bad(`${s} is not a shot of ${round}: ${all.join(', ')}`)
  return all.filter((s) => !opts.shots!.includes(s))
}

export async function plan(round: string, opts: Opts = {}): Promise<PodPlan> {
  assertRound(round)
  const cap = opts.volumeId ? volumeJobCapability() : capability()   // a job on one volume needs RunPod, not the Panama keys
  if (!cap.available) throw bad(cap.reason)
  const cfg = mounts.load()
  const volume = await volumeOf(opts)
  const size = await sizeOf(round, { ...opts, skipShots: opts.skipShots ?? (await skipOf(round, opts)) })
  const base = { round, bytes: size.bytes, files: size.files, idle_stop_minutes: AGENT_IDLE_MINUTES, ceiling_minutes: ceilingMinutes(size.bytes), volume }
  const found = await findActivePod(cfg, opts)
  const current = found && opts.route !== 'temporary' && (found.running || opts.route === 'current') ? found : null
  const currentChoice = found ? { id: found.id, name: found.name, running: found.running, price_per_hour: found.price, gpu: found.gpu } : null
  if (opts.route === 'current' && !found) throw bad('No pod of yours is on this volume to do the work on: use a temporary pod.')
  if (mounts.dryRun(cfg)) {
    const temporary = { gpu: 'simulated', price_per_hour: 0 }
    const choices = { current: currentChoice, temporary }
    if (current) return { ...base, route: 'active', pod: { id: current.id, name: current.name, price_per_hour: current.price }, gpu: current.gpu, price_per_hour: current.price, choices }
    return { ...base, route: 'temporary', pod: null, ...temporary, choices }
  }
  // A pull needs no GPU: take the CHEAPEST card RunPod has free in the volume's datacenter, whatever its type, and create the pod with exactly that card (by its RunPod id),
  // so the price the user confirms is the price the pod pays. `auto` would take the table's preferred (biggest) card instead.
  let gpu = 'auto', price: number | null = null, gpuTypeId: string | undefined
  try {
    const table = new Set(gpus.autoCards().map((g) => g.id))   // not the explicit-only big cards (ADR-026)
    const anyCard = cfg.pull_any_card !== false   // the root setting (Default Configuration): off = only the table's cards, as before ADR-024
    const free = (volume?.datacenter ? await rp.freeCardsIn(volume.datacenter, opts.client) : []).filter((c) => anyCard || table.has(c.id))
    const pick = free[0]   // freeCardsIn is sorted by price
    if (pick) { gpu = table.has(pick.id) ? gpuName(pick.id) : pick.name; price = pick.price; gpuTypeId = pick.id }
    else {
      const first = (await pods.candidates(gpus.AUTO, opts.client, volume?.datacenter))[0]   // no answer about free cards: what the app would pick, as before
      if (first) { gpu = gpuName(first); price = (await rp.gpuStock([first], opts.client)).find((g) => g.id === first)?.price ?? null }
    }
  } catch { /* the card is chosen again at creation */ }
  const temporary = { gpu, price_per_hour: price, ...(gpuTypeId ? { gpu_type_id: gpuTypeId } : {}) }
  const choices = { current: currentChoice, temporary }
  if (current) return { ...base, route: 'active', pod: { id: current.id, name: current.name, price_per_hour: current.price }, gpu: current.gpu, price_per_hour: current.price, choices }
  return { ...base, route: 'temporary', pod: null, ...temporary, choices }
}

// ----- the job -----

export type JobState = 'creating' | 'starting' | 'pulling' | 'verifying' | 'placing' | 'deleting' | 'done' | 'failed' | 'cancelled'
export interface PodJob {
  id: string; round: string; kind: 'pull' | 'remove' | 'browse' | 'erase' | 'clone' | 'fetch'; route: 'active' | 'temporary' | 's3'; pod_id: string | null; pod_name: string | null
  /** The card the pod actually has and its price per hour, once the pod exists (the Queue shows them). */
  gpu?: string; price_per_hour?: number | null
  /** A volume job (`browse`, `erase`): the volume, what a browse found (folders with their sizes), what an erase was asked to clear and how many bytes it freed from each. */
  /** A pull of some shots: the shot folders it did not copy, and the ones it did */ skip_shots?: string[]; pulled_shots?: string[]
  /** A clone: which way the files go (a pod on the source pushes to an S3-capable target; a pod on the target pulls from an S3-capable source), from where to where */
  clone?: { mode: 'push' | 'pull' | 'rsync'; from: { id: string; datacenter: string; name: string }; to: { id: string; datacenter: string; name: string }; include_input: boolean }
  /** A browse: the folder it listed (default the whole volume) */
  browse_path?: string
  /** A model fetch: the files asked for (as Hugging Face describes them) and the names the pod reported done */ fetch_items?: hf.Resolved[]; fetched?: string[]
  volume_id?: string; listing?: { path: string; bytes: number }[]; erase_keys?: string[]; freed?: Record<string, number>
  state: JobState; files: number; lines: string[]; error?: string; verify?: panama.Verify; started_at: string
  /** ADR-033: what placing the verified round on the pod did (files linked, graphs written, conflicts); set only after a pull whose check passed. A placing failure is here, never the pull's. */
  place?: place.PlaceReport
  /** From rclone's stats line and its Copied lines, for the same bar and file list as a local download. */
  bytes_done: number; bytes_total: number | null; rate: number | null; recent: string[]
}
interface Internal { job: PodJob; cancelled: boolean; abort: AbortController; wake: (() => void) | null; seen: Set<string>; bad: string[]; totals: { listed: number; bad: number; extra: number } | null; outcome: Outcome | null; plan: PodPlan }
type Outcome = 'done' | 'check-failed' | 'unverified' | 'copy-failed' | 'removed' | 'refused'
const jobs = new Map<string, Internal>()
const busy = new Set<string>()   // rounds with a job in flight: one at a time
const TERMINAL: JobState[] = ['done', 'failed', 'cancelled']
const view = (i: Internal): PodJob => ({ ...i.job, lines: [...i.job.lines], recent: [...i.job.recent] })

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '')

/** Read one log or SSH line: count copied files, notice the stages, and catch the s3pull.sh verdict lines. */
function feed(i: Internal, raw: string, secrets: string[]) {
  let line = stripAnsi(raw).replace(/^\s*\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d\s+/, '').trimEnd()
  for (const s of secrets) if (s) line = line.split(s).join('***')
  if (!line) return
  const j = i.job
  j.lines.push(line); if (j.lines.length > 200) j.lines.shift()
  const copied = panama.rcloneCopiedPath(line)
  if (copied) { j.files++; j.recent.push(copied); if (j.recent.length > panama.RECENT_FILES) j.recent.shift() }
  const st = panama.parseRcloneStats(line)
  if (st) { j.bytes_done = st.bytes_done; j.bytes_total = st.bytes_total; j.rate = st.rate }
  if (copied) { /* counted above */ }
  else if (/^s3 pull: .+ -> /.test(line) && !TERMINAL.includes(j.state)) j.state = 'pulling'
  else if (/\b100%,/.test(line) && j.state === 'pulling') j.state = 'verifying'
  const t = /(\d+) listed, (\d+) bad, (\d+) on disk but not listed/.exec(line)
  if (t) i.totals = { listed: Number(t[1]), bad: Number(t[2]), extra: Number(t[3]) }
  if (/^(SHA256|SIZE|MISSING)\s+\S/.test(line)) i.bad.push(line)
  if (/s3 pull done \(manifest verified\)/.test(line)) i.outcome = 'done'
  else if (/s3 pull FAILED the manifest check/.test(line)) i.outcome = 'check-failed'
  else if (/s3 pull done, NOT verified/.test(line)) i.outcome = 'unverified'
  else if (/s3 pull refused|s3 pull FAILED: |S3_PULL set but/.test(line)) i.outcome = 'copy-failed'
  else if (/^(removed|nothing to remove at) /.test(line)) i.outcome = 'removed'
  else if (/^BROWSE \d+ \//.test(line)) { const m = /^BROWSE (\d+) (\/.*)$/.exec(line); if (m) (j.listing ||= []).push({ path: m[2], bytes: Number(m[1]) }) }
  else if (/^BROWSE-DONE/.test(line) || /^ERASE-DONE/.test(line) || /^CLONE-DONE/.test(line)) i.outcome = 'removed'
  else if (/^ERASED \w+ \d+/.test(line)) { const m = /^ERASED (\w+) (\d+)/.exec(line); if (m) (j.freed ||= {})[m[1]] = Number(m[2]) }
  else if (/^FETCHED /.test(line)) { const m = /^FETCHED (\S.*?) (\d+|skipped)$/.exec(line); if (m) (j.fetched ||= []).push(m[1]) }
  else if (/^FETCH-DONE/.test(line)) i.outcome = 'removed'
  else if (/^FETCH-FAILED/.test(line)) { i.outcome = 'refused'; j.error = line.replace(/^FETCH-FAILED /, 'Download failed: ') }
  else if (/^BROWSE-FAILED/.test(line)) i.outcome = 'refused'
  else if (/^refused/.test(line)) i.outcome = 'refused'
}

/** Keys come from the app's stored Panama keys; a pod cannot use an AWS profile on this PC. */
function keys() {
  const k = panama.appKeys()
  if (!k) throw bad('A pod needs the Panama bucket keys stored in Default Configuration.')
  return k
}

// ----- the scripts that run on a pod (secrets only ever on stdin) -----

const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`
export function pullScript(round: string, k: { id: string; secret: string }): string {
  assertRound(round)
  return [
    'set -u',
    `export S3_PULL=${q(s3PullFor(round))}`,
    `export AWS_ACCESS_KEY_ID=${q(k.id)}`, `export AWS_SECRET_ACCESS_KEY=${q(k.secret)}`, `export AWS_REGION=${q(settings.lookup('PANAMA_S3_REGION') || settings.PANAMA_DEFAULTS.region)}`,
    'exec /opt/comfy-app/s3pull.sh', '',
  ].join('\n')
}
/** Removes exactly one round folder under the constant root; the name has been checked against ROUND and the path is checked again on the pod. */
/** A pull of some shots over SSH (the pod needs no S3_PULL at start): the round without the shot folders in `skip`, then the manifest check for what was copied only. Same marker files and last lines as s3pull.sh, so the job reads it the same way. */
export function pullShotsScript(round: string, skip: string[], k: { id: string; secret: string }): string {
  assertRound(round)
  for (const s of skip) assertRound(s)
  const src = `${panama.bucket()}/rounds/${round}`, dst = `${REMOTE_ROUNDS}/${round}`
  const excl = skip.map((s) => `--exclude ${q(`/${s}/**`)}`).join(' ')
  return [
    'set -u',
    `export RCLONE_CONFIG_PODS3_TYPE=s3 RCLONE_CONFIG_PODS3_PROVIDER=AWS RCLONE_CONFIG_PODS3_ACCESS_KEY_ID=${q(k.id)} RCLONE_CONFIG_PODS3_SECRET_ACCESS_KEY=${q(k.secret)} RCLONE_CONFIG_PODS3_REGION=${q(settings.lookup('PANAMA_S3_REGION') || settings.PANAMA_DEFAULTS.region)}`,
    `src=${q(src)}; dst=${q(dst)}; SKIP=${q(skip.join(','))}`,
    'command -v rclone >/dev/null || { echo "s3 pull refused: rclone is not in this image" >&2; exit 65; }',
    'mkdir -p "$dst" && echo "s3 pull: $src -> $dst (shots left out: $SKIP)"',
    `if rclone copy "PODS3:$src" "$dst" ${excl} --transfers 8 --checksum --stats 30s --stats-one-line -v; then`,
    '  rm -f "$dst/.s3-pull.done" "$dst/.s3-pull.failed" "$dst/.s3-pull.unverified"',
    '  if [ -f "$dst/MANIFEST.json" ]; then',
    `    PY="$(command -v python3 || command -v python)"`,
    `    if "$PY" - "$dst" "$SKIP" > "$dst/.s3-pull.check" 2>&1 <<'PY'`,
    'import sys, os, importlib.util',
    "spec = importlib.util.spec_from_file_location('verify_round', '/opt/comfy-app/verify_round.py'); v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)",
    "root = sys.argv[1]; skip = set(x for x in sys.argv[2].split(',') if x)",
    'files = v.listed(root)',
    "if not files:",
    "    print('NO FILE LIST'); sys.exit(2)",
    'bad = []; n = 0',
    'for p, f in files.items():',
    "    if p.split(os.sep)[0] in skip: continue",
    '    n += 1; full = os.path.join(root, p)',
    "    if not os.path.isfile(full): bad.append('MISSING  ' + p)",
    "    elif os.path.getsize(full) != f['bytes']: bad.append('SIZE     ' + p)",
    "    elif v.sha256(full) != f['sha256']: bad.append('SHA256   ' + p)",
    "for b in bad[:50]: print(b)",
    "print('%d listed, %d bad, 0 on disk but not listed' % (n, len(bad)))",
    "print('OK' if not bad else 'FAIL')",
    'sys.exit(0 if not bad else 1)',
    'PY',
    '    then mv "$dst/.s3-pull.check" "$dst/.s3-pull.done" && echo "s3 pull done (manifest verified): $dst"',
    '    else mv "$dst/.s3-pull.check" "$dst/.s3-pull.failed"; echo "s3 pull FAILED the manifest check: $dst" >&2; tail -n 5 "$dst/.s3-pull.failed" >&2; exit 1',
    '    fi',
    '  else echo "no MANIFEST.json" > "$dst/.s3-pull.unverified"; echo "s3 pull done, NOT verified (no MANIFEST.json): $dst"',
    '  fi',
    'else echo "s3 pull FAILED: $src (rclone exit $?); run it again, a rerun carries on" >&2; exit 1',
    'fi', '',
  ].join('\n')
}
export function removeScript(round: string): string {
  assertRound(round)
  return [
    'set -eu', `d=${q(`${REMOTE_ROUNDS}/${round}`)}`,
    `case "$d" in ${REMOTE_ROUNDS}/?*) ;; *) echo "refused: $d"; exit 64 ;; esac`,
    'if [ -d "$d" ]; then rm -rf -- "$d" && echo "removed $d"; else echo "nothing to remove at $d"; fi', '',
  ].join('\n')
}
/** What Erase can clear on a volume: a fixed list, never a path from the caller. Each is a folder whose contents go and which stays. */
export const ERASABLE: Record<string, { path: string; label: string; json_only?: boolean }> = {
  seedflows: { path: '/workspace/comfy-shared/workflows', label: 'Seed Graphs', json_only: true },
  rounds: { path: '/workspace/comfy-shared/temp/rounds', label: 'Pulled rounds (temp/rounds)' },
  inputs: { path: '/workspace/comfy-shared/input', label: 'Inputs (input), including the files placed from rounds' },
  workflows: { path: '/workspace/comfy-shared/workflows/rounds', label: 'Round graphs (workflows/rounds)' },
  output: { path: '/workspace/comfy-shared/output', label: 'Outputs (output)' },
  models: { path: '/workspace/comfy-shared/models', label: 'Models (models)' },
}
/** The folders of a volume to depth 3 with their sizes, one `BROWSE <bytes> <path>` line each, then `BROWSE-DONE`. Read-only. */
/** A path to list inside a volume: /workspace and folders under it; names of plain characters only, no `..`. */
export function browsePathOf(p?: string): string {
  const path = String(p ?? '/workspace').replace(/\/+$/, '') || '/workspace'
  if (!/^\/workspace(\/[\w .+@=,()-]+){0,12}$/.test(path) || path.split('/').includes('..')) throw bad(`Not a path inside the volume: ${path}`)
  return path
}
export function browseScript(path = '/workspace'): string {
  return [
    'set -u', 'cd /workspace 2>/dev/null || { echo "BROWSE-FAILED no /workspace"; exit 64; }',
    `du -b --max-depth=3 ${q(browsePathOf(path))} 2>/dev/null | head -n 5000 | awk -F'\t' '{ print "BROWSE " $1 " " $2 }'`,
    'echo "BROWSE-DONE"', '',
  ].join('\n')
}
/** Empties the chosen folders (their contents; the folders stay). Keys are checked against ERASABLE here and the path again on the pod. */
export function eraseScript(keys: string[]): string {
  if (!keys.length) throw bad('Choose what to erase')
  const lines = ['set -u']
  for (const k of keys) {
    const e = ERASABLE[k]; if (!e) throw bad(`Not something Erase clears: ${k} (one of ${Object.keys(ERASABLE).join(', ')})`)
    lines.push(`d=${q(e.path)}`, 'case "$d" in /workspace/comfy-shared/?*) ;; *) echo "refused: $d"; exit 64 ;; esac',
      e.json_only
        ? `if [ -d "$d" ]; then b=$(find "$d" -maxdepth 1 -type f -name '*.json' -exec du -cb {} + 2>/dev/null | tail -n 1 | cut -f1); find "$d" -maxdepth 1 -type f -name '*.json' -delete && echo "ERASED ${k} \${b:-0}"; else echo "ERASED ${k} 0"; fi`   // only the loose .json files, never the folders in it
        : `if [ -d "$d" ]; then b=$(du -sb "$d" 2>/dev/null | cut -f1); find "$d" -mindepth 1 -delete && echo "ERASED ${k} \${b:-0}"; else echo "ERASED ${k} 0"; fi`)
  }
  lines.push('echo "ERASE-DONE"', '')
  return lines.join('\n')
}
/** Downloads the chosen files from Hugging Face onto the volume, on the pod: resumable, the size checked, then the sha256 Hugging Face gave; a file already there at the right size is left. Names, folders and URLs were fixed by `hf.resolve`; they are quoted here all the same. */
export function fetchScript(items: hf.Resolved[]): string {
  if (!items.length) throw bad('Choose at least one file.')
  const lines = ['set -u']
  for (const f of items) {
    lines.push(
      `d=/workspace/comfy-shared/models/${f.folder}; f="$d"/${q(f.name)}; mkdir -p "$d"`,
      `if [ -f "$f" ] && [ "$(stat -c %s "$f")" = "${f.bytes}" ]; then echo "FETCHED ${f.name} skipped"; else`,
      `  curl -fL --retry 5 --retry-delay 5 -C - -o "$f.part" ${q(f.url)} || { echo "FETCH-FAILED ${f.name} (curl $?)"; exit 1; }`,
      `  echo "${f.sha256}  $f.part" | sha256sum -c - >/dev/null 2>&1 || { rm -f "$f.part"; echo "FETCH-FAILED ${f.name} (the checksum does not match)"; exit 1; }`,
      `  mv "$f.part" "$f" && echo "FETCHED ${f.name} ${f.bytes}"`,
      'fi')
  }
  lines.push('echo "FETCH-DONE"', '')
  return lines.join('\n')
}
/** Which way a clone goes. With RunPod's S3 API on one side (some datacenters, and S3 keys) one pod does it: a target that has it is written to from a pod on the source (push); else a source that has it is read from a pod on the target (pull). Otherwise, and for any two volumes, RunPod to RunPod: a short pod on each, and the target's pod rsyncs from the source's over SSH. */
export function cloneMode(from: { datacenter: string }, to: { datacenter: string }, haveKeys: boolean): { mode: 'push' | 'pull' | 'rsync' } {
  const s3 = (d: string) => pods.S3_DATACENTERS.has(d)
  if (s3(to.datacenter) && haveKeys) return { mode: 'push' }   // one pod, on the source
  if (s3(from.datacenter) && haveKeys) return { mode: 'pull' }   // one pod, on the target
  return { mode: 'rsync' }   // RunPod to RunPod, no S3 needed: a pod on each volume, the target's pulls from the source's over SSH
}
/** The clone's copy, run on a pod over SSH: rclone against RunPod's S3 API (endpoint of the S3 side, bucket = its volume id). `input/` holds links of the rounds' files (a copy would double them): left out unless asked; placing the round again relinks it. */
export function cloneScript(c: NonNullable<PodJob['clone']>, k: { id: string; secret: string }): string {
  const s3 = c.mode === 'push' ? c.to : c.from
  const env = `export RCLONE_CONFIG_S3SIDE_TYPE=s3 RCLONE_CONFIG_S3SIDE_PROVIDER=Other RCLONE_CONFIG_S3SIDE_ENDPOINT=${q(sync.s3Endpoint(s3.datacenter))} RCLONE_CONFIG_S3SIDE_ACCESS_KEY_ID=${q(k.id)} RCLONE_CONFIG_S3SIDE_SECRET_ACCESS_KEY=${q(k.secret)} RCLONE_CONFIG_S3SIDE_REGION=${q(s3.datacenter)}`
  const [src, dst] = c.mode === 'push' ? ['/workspace', `S3SIDE:${s3.id}`] : [`S3SIDE:${s3.id}`, '/workspace']
  const excludes = [...(c.include_input ? [] : ["--exclude '/comfy-shared/input/**'"]), "--exclude '/lost+found/**'"].join(' ')
  return [
    'set -u', env,
    'command -v rclone >/dev/null || { echo "clone refused: rclone is not in this image" >&2; exit 65; }',
    `echo "clone: ${c.from.name} (${c.from.datacenter}) -> ${c.to.name} (${c.to.datacenter}), ${c.mode}"`,
    `if rclone copy ${q(src)} ${q(dst)} ${excludes} ${c.mode === 'push' ? '--copy-links ' : ''}--s3-no-check-bucket --transfers 8 --checksum --stats 30s --stats-one-line -v; then echo "CLONE-DONE"; else echo "clone FAILED (rclone exit $?); run it again, a rerun carries on" >&2; exit 1; fi`, '',
  ].join('\n')
}
/** The script a job runs on its pod. */
const scriptOf = (j: PodJob, k: { id: string; secret: string } | null): string => j.kind === 'clone' ? cloneScript(j.clone!, s3Keys()!) : j.kind === 'pull' ? (j.skip_shots?.length ? pullShotsScript(j.round, j.skip_shots, k!) : pullScript(j.round, k!)) : j.kind === 'browse' ? browseScript(j.browse_path) : j.kind === 'erase' ? eraseScript(j.erase_keys ?? []) : j.kind === 'fetch' ? fetchScript(j.fetch_items ?? []) : removeScript(j.round)
const KILL_SCRIPT = 'pkill -f /opt/comfy-app/s3pull.sh; pkill -x rclone; true\n'

export interface SshJob { host: string; port: number; script: string; onLine: (line: string) => void; signal: AbortSignal }
export type SshRunner = (job: SshJob) => Promise<{ code: number | null }>
/** `ssh -p <port> root@<ip> bash -s` with the script on stdin, the way the Sync reaches a pod (host and port from RunPod's own port list). */
/** The ssh arguments: where and how, never what. The script (and any key in it) goes on stdin. */
export const sshArgs = (host: string, port: number) => ['-p', String(port), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', host, 'bash -s']
export const runSsh: SshRunner = ({ host, port, script, onLine, signal }) => new Promise((resolve, reject) => {
  const child = spawn('ssh', sshArgs(host, port), { stdio: ['pipe', 'pipe', 'pipe'] })
  const onAbort = () => child.kill('SIGTERM')
  if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort)
  for (const s of [child.stdout, child.stderr]) createInterface({ input: s }).on('line', onLine)
  child.on('error', reject)
  child.on('close', (code) => { signal.removeEventListener('abort', onAbort); resolve({ code }) })
  child.stdin.on('error', () => { /* the pod closed first; the exit code says why */ })
  child.stdin.end(script)
})

// ----- running a job -----

const newJob = (round: string, kind: PodJob['kind'], p: PodPlan, now: Date): Internal => {
  // A pod job always has a route and a pod name from the start (the UI tells it from a local job by `route`, and shows the name at once): the user's pod on the active route,
  // the name the temporary pod will be created with on the other.
  const job: PodJob = { id: `${kind}-${round}-${now.getTime()}`, round, kind, route: p.route, pod_id: p.route === 'active' ? p.pod!.id : null, pod_name: p.route === 'active' ? p.pod!.name : p.route === 's3' ? null : podName(round, now), state: 'creating', files: 0, lines: [], started_at: now.toISOString(), bytes_done: 0, bytes_total: null, rate: null, recent: [] }
  const i: Internal = { job, cancelled: false, abort: new AbortController(), wake: null, seen: new Set(), bad: [], totals: null, outcome: null, plan: p }
  jobs.set(job.id, i)
  return i
}
const sleep = (i: Internal, ms: number) => new Promise<void>((res) => { const t = setTimeout(res, ms); i.wake = () => { clearTimeout(t); res() } })

async function defaultLogs(podId: string, client?: rp.RunPodClient, ms = 3500): Promise<{ ts: string; line: string }[]> {
  const out: { ts: string; line: string }[] = []
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try { await pods.logs(podId, { tail: 500 }, (e) => out.push({ ts: e.ts, line: e.line }), ac.signal, client) } finally { clearTimeout(t) }
  return out
}

/** Apply the verdict to the job and to what is known about the volume. Cancelled stays cancelled. */
function conclude(i: Internal) {
  const j = i.job, p = i.plan
  const vol = p.volume?.id || ''
  const done = (state: JobState, error?: string) => { if (j.state !== 'cancelled') { j.state = state; if (error) j.error = error } }
  if (i.cancelled) { j.state = 'cancelled'; if (vol && j.kind === 'pull' && j.files > 0) recordState(vol, j.round, { state: 'partial', present: j.files, expected: p.files || null, missing: p.files ? Math.max(p.files - j.files, 0) : null, bytes: p.bytes }); return }
  if (j.kind !== 'pull') {
    if (i.outcome === 'removed') { done('done'); if (j.kind === 'remove' && vol) recordState(vol, j.round, null); if (j.kind === 'erase' && vol && j.erase_keys?.includes('rounds')) forgetVolume(vol) } else done('failed', j.error || (i.outcome === 'refused' ? 'The pod refused the path.' : 'The delete did not report back.'))
    return
  }
  switch (i.outcome) {
    case 'done':
      j.verify = { listed: p.files, bad: [], extra: 0, ok: true }; done('done')
      if (vol) {
        // A round pulled by shots keeps which shots are there (added to what an earlier pull brought); a whole-round pull clears the list.
        const before = knownState(vol)?.rounds[j.round]
        const shots = j.pulled_shots ? [...new Set([...(before?.shots ?? []), ...j.pulled_shots])].sort() : undefined
        recordState(vol, j.round, { state: 'complete', present: p.files, expected: p.files, missing: 0, bytes: p.bytes, ...(shots && (before?.shots || !before) ? { shots } : {}) })
      }
      break
    case 'check-failed': {
      const t = i.totals
      j.verify = { listed: t?.listed ?? 0, bad: i.bad.slice(0, 50), extra: t?.extra ?? 0, ok: false }
      done('failed', `${t ? t.bad : i.bad.length} file(s) on the volume do not match the round's manifest: ${i.bad.slice(0, 3).join('; ')}`)
      if (vol && t) recordState(vol, j.round, { state: 'partial', present: t.listed - t.bad, expected: t.listed, missing: t.bad, bytes: p.bytes }); break
    }
    case 'unverified':
      done('failed', 'The round was copied but has no MANIFEST.json file list, so it cannot be verified.')
      if (vol) recordState(vol, j.round, { state: 'unverified', present: j.files, expected: null, missing: null, bytes: p.bytes }); break
    default: done('failed', j.error || 'The pull did not finish.')
  }
}

async function deleteTemp(i: Internal, podId: string, opts: Opts) {
  const was = i.job.state
  if (!i.cancelled) i.job.state = 'deleting'
  try { await pods.remove(podId, opts.client) }
  catch (e) { idle.register(podId, AGENT_IDLE_MINUTES); i.job.lines.push(`Could not delete pod ${podId}: ${(e as Error).message}. It still has its idle timer, and it is in the pod list under ${i.job.pod_name}.`); if (!i.job.error) i.job.error = `The pod ${i.job.pod_name} could not be deleted; delete it in the pod list.` }
  if (!i.cancelled) i.job.state = was
}

async function waitForSshTarget(i: Internal, podId: string, opts: Opts, deadline: number): Promise<{ host: string; port: number }> {
  for (;;) {
    if (i.cancelled) throw new CoreError(499, 'cancelled')
    const raw = await rp.getPod(podId, opts.client)
    if (raw && (raw.runtime?.uptimeInSeconds ?? 0) > 0) { try { return sync.sshTarget(raw) } catch { /* the port is not up yet */ } }
    if (Date.now() > deadline) throw new CoreError(504, `The pod ${podId} did not expose SSH in time.`)
    await sleep(i, opts.pollMs ?? 5000)
  }
}

async function runOnPod(i: Internal, host: string, port: number, script: string, opts: Opts, secrets: string[]) {
  const ssh = opts.ssh ?? runSsh
  const onLine = (l: string) => feed(i, l, secrets)
  i.abort.signal.addEventListener('abort', () => { void ssh({ host, port, script: KILL_SCRIPT, onLine: () => {}, signal: new AbortController().signal }).catch(() => {}) }, { once: true })
  const { code } = await ssh({ host, port, script, onLine, signal: i.abort.signal })
  if (i.cancelled) return
  if (code === 255) throw new CoreError(502, `Could not reach the pod over SSH (${host}:${port}). The Sync needs the same thing: an SSH public key on the RunPod account, added before the pod started.`)
  if (code === 127) throw new CoreError(502, 'The pod runs an older image without /opt/comfy-app/s3pull.sh: create a new pod from the current image.')
  if (code !== 0 && !i.outcome) throw new CoreError(502, `The command on the pod ended with exit code ${code}.`)
}

/** ADR-033: after a pull whose manifest check passed, put the round's inputs where its graphs look. Never fails the pull: the outcome (or the error) is on the job. */
async function placeAfter(i: Internal, host: string, port: number, opts: Opts) {
  if (i.job.kind !== 'pull' || i.outcome !== 'done' || i.cancelled) return
  i.job.state = 'placing'
  try {
    const r = await place.run(i.job.round, { host, port, ssh: opts.ssh ?? runSsh, dry_run: false, signal: i.abort.signal })
    i.job.place = r
    i.job.lines.push(r.ok ? `placed ${r.linked} file(s) (${r.already_there} already there), ${r.graphs.length} graph(s), ${r.conflicts.length} conflict(s)` : `placing: ${r.error ?? `missing ${r.missing.length} input(s)`}`)
  } catch (e) {
    i.job.place = place.failed(i.job.round, false, (e as Error).message)
    i.job.lines.push(`placing failed: ${(e as Error).message}`)
  }
}

async function runActive(i: Internal, opts: Opts) {
  const p = i.plan, pod = p.pod!, j = i.job
  const startedHere = p.choices?.current?.id === pod.id && p.choices.current.running === false
  let prev = idle.entry(pod.id)?.minutes ?? 0
  if (startedHere) {
    // The pod is off: start it, then wait for its SSH port. It stays ours afterwards, with the agent's idle stop.
    j.state = 'starting'
    idle.register(pod.id, p.ceiling_minutes)
    await pods.resume(pod.id, opts.client)
    prev = AGENT_IDLE_MINUTES
    try { await waitForSshTarget(i, pod.id, opts, Date.now() + (p.ceiling_minutes + 10) * 60_000) } catch (e) { idle.register(pod.id, prev); throw e }
  }
  const raw = await rp.getPod(pod.id, opts.client)
  if (!raw && !mounts.dryRun(mounts.load())) throw new CoreError(404, `Pod ${pod.id} is gone.`)
  const { host, port } = raw ? sync.sshTarget(raw) : { host: 'simulated', port: 22 }
  const k = j.kind === 'pull' ? keys() : null
  idle.register(pod.id, p.ceiling_minutes)   // held with a ceiling for the job, put back after (2d)
  try {
    j.state = j.kind === 'pull' ? 'pulling' : 'deleting'
    const s3k = j.kind === 'clone' ? s3Keys() : null
    await runOnPod(i, host, port, scriptOf(j, k), opts, k ? [k.secret, k.id] : s3k ? [s3k.secret, s3k.id] : [])
    if (j.kind === 'pull') await placeAfter(i, host, port, opts)
  } finally { idle.register(pod.id, prev) }
}

/** A pod of its own on a volume: the plan's card, else the next free card of the volume's datacenter (the cheapest one can be taken between the plan and the create: "No card available"), else the app's own choice, once. */
async function createTempPod(p: PodPlan, base: Record<string, unknown>, opts: Opts, cfg: mounts.MountsConfig): Promise<Awaited<ReturnType<typeof pods.create>>> {
  const tried = new Set<string>()
  let created: Awaited<ReturnType<typeof pods.create>> | null = null
  let next: string | undefined = p.gpu_type_id
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try { created = await pods.create({ ...base, ...(next ? { gpu_type_id: next } : { gpu: 'auto' }) } as never, opts.client) } catch (e) {
      if (!/No card available/.test((e as Error).message)) throw e
      if (next) tried.add(next)
      const dc = p.volume?.datacenter
      const more = dc ? (await rp.freeCardsIn(dc, opts.client).catch(() => [])).filter((c) => !tried.has(c.id) && (cfg.pull_any_card !== false || gpus.autoCards().some((g) => g.id === c.id))) : []
      if (!more.length && !next) throw e   // 'auto' failed as well: nothing is free
      next = more[0]?.id   // undefined: the app's own choice, once
      if (!next && attempt > 0 && tried.size > 0 && !more.length) { try { created = await pods.create({ ...base, gpu: 'auto' } as never, opts.client) } catch { throw e } }
    }
  }
  if (!created) throw new CoreError(502, 'No card available right now in the volume\'s datacenter (tried several). Try again in a few minutes.')
  return created
}

async function runTemporary(i: Internal, opts: Opts) {
  const p = i.plan, j = i.job, cfg = mounts.load()
  const name = j.pod_name!   // set when the job was created
  const k = j.kind === 'pull' ? keys() : null
  const secrets = k ? [k.secret, k.id] : []
  // A pull the app lost track of (it was closed mid-pull) left its pod running and still copying: take that pod over instead of making a second one that pulls the same round again.
  const prior = j.kind === 'pull' ? temporaryPods().find((t) => t.kind === 'pull' && t.round === j.round && t.pod_id && (t.volume || '') === (p.volume?.id || '')) : null
  let adopted: { id: string; name: string } | null = null
  if (prior?.pod_id) { const raw = await rp.getPod(prior.pod_id, opts.client).catch(() => null); if (raw && (raw.desiredStatus ?? 'RUNNING') === 'RUNNING') adopted = { id: prior.pod_id, name: raw.name || prior.name } }
  tempAdd({ round: j.round, kind: j.kind, name, pod_id: adopted?.id ?? null, volume: p.volume?.id || '', created_at: prior && adopted ? prior.created_at : new Date().toISOString(), approved_by: APPROVED_BY })   // before the pod exists
  let podId: string | null = null
  const deadline = Date.now() + (p.ceiling_minutes + 10) * 60_000
  try {
    const env: Record<string, string> = { ...cfg.env }
    const viaSsh = j.kind === 'pull' && !!j.skip_shots?.length   // a pull of some shots is run over SSH (the pod's own S3_PULL would copy the whole round)
    if (j.kind === 'pull' && !viaSsh) env.S3_PULL = s3PullFor(j.round); else delete env.S3_PULL   // a delete never carries a pull (or the keys podOverrides adds for one)
    // The cheapest free card can be taken between the plan and the create ("No card available"): try the next free card of the volume's datacenter, then the app's own choice.
    const onVol = opts.volumeId && p.volume ? { network_volume_id: p.volume.id, ...(p.volume.datacenter ? { data_center_id: p.volume.datacenter } : {}) } : {}   // a job on another volume than the default one
    const base = { name, round: j.round, image: 'configured', cuda_match: false, idle_stop_minutes: p.ceiling_minutes, config: { ...cfg, ...onVol, env } } as const
    let created: Awaited<ReturnType<typeof pods.create>> | null = adopted ? ({ id: adopted.id, name: adopted.name } as Awaited<ReturnType<typeof pods.create>>) : null
    if (adopted) j.lines.push(`taking over the pod ${adopted.name} (${adopted.id}) that was already pulling this round`)
    if (!created) created = await createTempPod(p, base, opts, cfg)
    podId = created.id; j.pod_id = podId; j.gpu = (created as { gpu?: string }).gpu ?? p.gpu; j.price_per_hour = p.price_per_hour; tempSetId(name, podId)
    if (i.cancelled) return
    j.state = 'starting'
    if (j.kind !== 'pull' || viaSsh) {   // remove, browse, erase, and a pull of some shots: one script over SSH
      const { host, port } = await waitForSshTarget(i, podId, opts, deadline)
      j.state = j.kind === 'browse' ? 'verifying' : j.kind === 'pull' || j.kind === 'fetch' ? 'pulling' : 'deleting'
      await runOnPod(i, host, port, scriptOf(j, k), opts, secrets)
      if (viaSsh && i.outcome === 'done' && !i.cancelled) await placeAfter(i, host, port, opts)   // the same placing as after a whole-round pull
      return
    }
    const logs = opts.logs ?? ((id: string) => defaultLogs(id, opts.client))
    let misses = 0
    while (!i.cancelled && !i.outcome) {
      await sleep(i, opts.pollMs ?? 5000)
      if (i.cancelled) break
      try {
        for (const e of await logs(podId)) { const key = `${e.ts}|${e.line}`; if (i.seen.has(key)) continue; i.seen.add(key); feed(i, e.line, secrets) }
        misses = 0
      } catch (e) {
        if (++misses >= 3 && !(await rp.getPod(podId, opts.client).catch(() => ({ id: podId })))) throw new CoreError(404, `The pod ${name} is gone: ${(e as Error).message}`)
      }
      if (Date.now() > deadline) throw new CoreError(504, `The pull did not finish within ${p.ceiling_minutes + 10} minutes; the pod is being deleted.`)
    }
    if (i.outcome === 'done' && !i.cancelled) {
      try { const { host, port } = await waitForSshTarget(i, podId, opts, Math.min(deadline, Date.now() + (opts.placeWaitMs ?? 180_000))); await placeAfter(i, host, port, opts) }
      catch (e) { if (i.cancelled) return; i.job.place = place.failed(i.job.round, false, (e as Error).message); i.job.lines.push(`placing failed: ${(e as Error).message}`) }
    }
  } finally {
    if (podId) await deleteTemp(i, podId, opts)
    tempDrop(name)
  }
}

/** No RunPod, no SSH: the whole job on a timer, with the same states, lines and verdict, for no-spend mode and the app's own tests. */
async function simulate(i: Internal, opts: Opts) {
  const j = i.job, ms = opts.pollMs ?? 400
  const temp = i.plan.route === 'temporary'
  let podId: string | null = null
  try {
    if (temp) {
      const created = await pods.create({ name: j.pod_name!, ...(i.plan.gpu_type_id ? { gpu_type_id: i.plan.gpu_type_id } : { gpu: 'auto' }), image: 'configured', cuda_match: false, idle_stop_minutes: i.plan.ceiling_minutes, round: j.round })
      podId = created.id; j.pod_id = podId; j.pod_name = created.name; j.gpu = i.plan.gpu; j.price_per_hour = i.plan.price_per_hour
    }
    const steps: [JobState, string[]][] = j.kind === 'pull'
      ? [['starting', ['no-spend mode: the pod is simulated']], ['pulling', [`s3 pull: ${panama.bucket()}/rounds/${j.round} -> ${REMOTE_ROUNDS}/${j.round}`, 'a.json: Copied (new)', 'b.json: Copied (new)']], ['verifying', ['100%, 0 B/s']], ['pulling', ['s3 pull done (manifest verified): ' + `${REMOTE_ROUNDS}/${j.round}`]]]
      : j.kind === 'browse' ? [['verifying', ['BROWSE 1000 /workspace', 'BROWSE 600 /workspace/comfy-shared', 'BROWSE 500 /workspace/comfy-shared/temp', 'BROWSE-DONE']]]
      : j.kind === 'clone' ? [['pulling', ['clone: simulated', 'CLONE-DONE']]]
      : j.kind === 'fetch' ? [['pulling', [...(j.fetch_items ?? []).map((f) => `FETCHED ${f.name} ${f.bytes}`), 'FETCH-DONE']]]
      : j.kind === 'erase' ? [['deleting', [...(j.erase_keys ?? []).map((k) => `ERASED ${k} 100`), 'ERASE-DONE']]]
      : [['deleting', [`removed ${REMOTE_ROUNDS}/${j.round}`]]]
    for (const [state, lines] of steps) {
      if (i.cancelled) return
      await sleep(i, ms)
      if (i.cancelled) return
      if (!TERMINAL.includes(j.state)) j.state = state
      for (const l of lines) feed(i, l, [])
    }
    if (!i.outcome && j.kind === 'pull') i.outcome = 'done'
    if (i.outcome === 'done' && !i.cancelled) { j.state = 'placing'; await sleep(i, ms); j.place = place.simulated(j.round, false); feed(i, 'placed 2 file(s), 1 graph(s)', []) }
  } finally {
    if (podId) { try { await pods.remove(podId) } catch { /* already gone */ } }
  }
}

/** Browse and Erase through RunPod's S3 API (the bucket is the volume id): `aws s3 ls` / `aws s3 rm` from this PC, the same job shape as over a pod. */
async function runS3(i: Internal, opts: Opts) {
  const j = i.job, vol = i.plan.volume!
  const a = s3Access(vol); if (!a.ok) throw new CoreError(400, `RunPod's S3 API is not available for this volume (${a.why}).`)
  const aws = opts.aws ?? defaultAws
  const env = { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }
  const common = ['--endpoint-url', a.endpoint, '--region', a.region]
  const run = async (args: string[]) => { const r = await aws([...args, ...common], env); if (r.code !== 0) throw new CoreError(502, `RunPod's S3 API: ${(r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`}`); return r.stdout }
  const sizes = async () => {   // every object: bytes by key
    const out = await run(['s3', 'ls', `s3://${a.bucket}/`, '--recursive'])
    return out.split('\n').map((l) => /^\S+\s+\S+\s+(\d+)\s+(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ bytes: Number(m[1]), key: m[2] }))
  }
  j.state = 'verifying'
  if (j.kind === 'browse') {
    const base = (j.browse_path ?? '/workspace').replace(/^\/workspace\/?/, '')   // '' = the whole volume; else the folder's key prefix
    const baseParts = base ? base.split('/') : []
    const dirs = new Map<string, number>(); let total = 0
    for (const o of await sizes()) {
      if (base && !o.key.startsWith(`${base}/`)) continue
      total += o.bytes
      const parts = o.key.split('/').slice(0, -1)
      for (let d = baseParts.length + 1; d <= Math.min(baseParts.length + 3, parts.length); d++) { const k = parts.slice(0, d).join('/'); dirs.set(k, (dirs.get(k) ?? 0) + o.bytes) }
    }
    j.listing = [{ path: j.browse_path ?? '/workspace', bytes: total }, ...[...dirs.entries()].sort(([x], [y]) => x.localeCompare(y)).slice(0, 5000).map(([k, b]) => ({ path: `/workspace/${k}`, bytes: b }))]
    i.outcome = 'removed'; return
  }
  if (j.kind === 'erase') {
    j.state = 'deleting'
    const all = await sizes()
    for (const key of j.erase_keys ?? []) {
      const e = ERASABLE[key]; if (!e) throw bad(`Not something Erase clears: ${key}`)
      const prefix = e.path.replace(/^\/workspace\//, '')   // /workspace/comfy-shared/input -> comfy-shared/input
      const mine = all.filter((o) => (e.json_only ? o.key.startsWith(`${prefix}/`) && !o.key.slice(prefix.length + 1).includes('/') && o.key.endsWith('.json') : o.key.startsWith(`${prefix}/`)))
      const bytes = mine.reduce((n, o) => n + o.bytes, 0)
      if (mine.length) await run(['s3', 'rm', `s3://${a.bucket}/${prefix}/`, '--recursive', ...(e.json_only ? ['--exclude', '*', '--include', '*.json', '--exclude', '*/*'] : [])])
      ;(j.freed ||= {})[key] = bytes
      j.lines.push(`ERASED ${key} ${bytes}`)
    }
    i.outcome = 'removed'; return
  }
  throw bad(`A ${j.kind} job does not go through the S3 API`)
}

const keygenDefault = async (): Promise<{ priv: string; pub: string; comment: string }> => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { execFile } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'clonekey-')), comment = `pod-manager-clone-${Date.now()}`
  try {
    await new Promise<void>((res, rej) => execFile('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', join(dir, 'k')], (e) => (e ? rej(new CoreError(500, `Could not make a one-off SSH key (ssh-keygen): ${e.message}`)) : res())))
    return { priv: readFileSync(join(dir, 'k'), 'utf8'), pub: readFileSync(join(dir, 'k.pub'), 'utf8').trim(), comment }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
/** The source pod lets the one-off key in (and takes it out afterwards by its comment). */
export const cloneAuthorizeScript = (pub: string) => ['set -eu', 'mkdir -p /root/.ssh && chmod 700 /root/.ssh', `printf '%s\\n' ${q(pub)} >> /root/.ssh/authorized_keys`, 'chmod 600 /root/.ssh/authorized_keys', 'echo "key added"', ''].join('\n')
export const cloneRevokeScript = (comment: string) => ['set -u', `grep -v ${q(comment)} /root/.ssh/authorized_keys > /tmp/ak.new 2>/dev/null; cat /tmp/ak.new > /root/.ssh/authorized_keys; rm -f /tmp/ak.new`, 'echo "key removed"', ''].join('\n')
/** On the target's pod: rsync the source's /workspace over SSH with the one-off key. -H keeps hard links (input/ is a set of links of the rounds' files), so inputs cost nothing extra when they are copied. */
export function cloneRsyncScript(c: NonNullable<PodJob['clone']>, src: { host: string; port: number }, priv: string): string {
  const excludes = [...(c.include_input ? [] : ["--exclude '/comfy-shared/input/'"]), "--exclude '/lost+found/'"].join(' ')
  const ssh = `ssh -i /tmp/clone_key -p ${src.port} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=30`
  return [
    'set -u',
    `umask 077; cat > /tmp/clone_key <<'CLONE_KEY'`, priv.trim(), 'CLONE_KEY', 'chmod 600 /tmp/clone_key',
    'command -v rsync >/dev/null || { echo "clone refused: rsync is not in this image" >&2; rm -f /tmp/clone_key; exit 65; }',
    `echo "clone: ${c.from.name} (${c.from.datacenter}) -> ${c.to.name} (${c.to.datacenter}), rsync over ssh"`,
    `if rsync -aH --partial --info=progress2,stats1 ${excludes} -e ${q(ssh)} ${q(`${src.host}:/workspace/`)} /workspace/; then rm -f /tmp/clone_key; echo "CLONE-DONE"; else code=$?; rm -f /tmp/clone_key; echo "clone FAILED (rsync exit $code); run it again, a rerun carries on" >&2; exit 1; fi`, '',
  ].join('\n')
}
/** A clone RunPod to RunPod: a short pod on the source volume and one on the target, a one-off SSH key from this app (never stored), and the target's pod pulls the files from the source's. Both pods are deleted at the end, the key is taken out of the source first. */
async function runCloneRsync(i: Internal, opts: Opts) {
  const j = i.job, c = j.clone!, cfg = mounts.load()
  const made: { id: string; name: string }[] = []
  const mk = async (vol: { id: string; datacenter: string; name: string }, side: 'src' | 'dst') => {
    const label = volLabel(vol.id)
    const p = await plan(label, { ...opts, volumeId: vol.id, route: 'temporary', sizeOf: () => ({ files: 0, bytes: 0 }) })
    const name = `${POD_PREFIX}clone-${side}-${vol.id}-${String(new Date().getMonth() + 1).padStart(2, '0')}${String(new Date().getDate()).padStart(2, '0')}`.slice(0, 60)
    const env: Record<string, string> = { ...cfg.env }; delete env.S3_PULL
    const base = { name, image: 'configured', cuda_match: false, idle_stop_minutes: Math.max(120, p.ceiling_minutes), config: { ...cfg, network_volume_id: vol.id, ...(vol.datacenter ? { data_center_id: vol.datacenter } : {}), env } }
    tempAdd({ round: label, kind: 'clone', name, pod_id: null, volume: vol.id, created_at: new Date().toISOString(), approved_by: APPROVED_BY })
    const created = await createTempPod(p, base, opts, cfg)
    tempSetId(name, created.id); made.push({ id: created.id, name }); j.lines.push(`${side === 'src' ? 'source' : 'target'} pod ${created.id} on ${vol.name}`)
    return created
  }
  try {
    const src = await mk(c.from, 'src'); j.pod_id = src.id; j.pod_name = (src as { name?: string }).name ?? null
    if (i.cancelled) return
    const dst = await mk(c.to, 'dst')
    j.state = 'starting'
    const deadline = Date.now() + 40 * 60_000
    const s = await waitForSshTarget(i, src.id, opts, deadline), d = await waitForSshTarget(i, dst.id, opts, deadline)
    if (i.cancelled) return
    const kp = await (opts.keygen ?? keygenDefault)()
    j.state = 'pulling'
    try {
      await runOnPod(i, s.host, s.port, cloneAuthorizeScript(kp.pub), opts, [])
      await runOnPod(i, d.host, d.port, cloneRsyncScript(c, s, kp.priv), opts, kp.priv.split('\n').filter((l) => l.length > 16))
    } finally { try { await runOnPod(i, s.host, s.port, cloneRevokeScript(kp.comment), opts, []) } catch { /* the pod is deleted next */ } }
  } finally {
    for (const m of made) { try { await pods.remove(m.id, opts.client) } catch { /* already gone */ } tempDrop(m.name) }
  }
}

async function run(i: Internal, opts: Opts) {
  try {
    if (mounts.dryRun(mounts.load())) await simulate(i, opts)
    else if (i.job.kind === 'clone' && i.job.clone?.mode === 'rsync') await runCloneRsync(i, opts)
    else if (i.plan.route === 's3') await runS3(i, opts)
    else if (i.plan.route === 'active') await runActive(i, opts)
    else await runTemporary(i, opts)
  } catch (e) {
    if (!(e instanceof CoreError && e.status === 499)) { i.job.error = (e as Error).message; if (!i.cancelled) i.job.lines.push(`Failed: ${(e as Error).message}`) }
  } finally {
    conclude(i)
    const jb = i.job
    if (jb.state === 'done' || jb.state === 'failed' || jb.state === 'cancelled') history.record({ kind: 'job', job: jb.kind, state: jb.state, started_at: jb.started_at, what: jb.round, pod_id: jb.pod_id ?? undefined, pod_name: jb.pod_name ?? undefined, files: jb.files, bytes: jb.bytes_done || i.plan.bytes, ...(jb.place ? { detail: placeSummary(jb.place) } : {}), ...(jb.error ? { error: jb.error } : {}) })
    busy.delete(i.job.round)
  }
}

export const placeSummary = (r: place.PlaceReport) => (r.error ? `placing failed: ${r.error}` : `placed: ${r.linked} linked, ${r.already_there} already there, ${r.graphs.length} graph(s), ${r.conflicts.length} conflict(s)${r.missing.length ? `, ${r.missing.length} input(s) missing` : ''}`)

const claim = (round: string, kind: PodJob['kind']) => {
  if (busy.has(round)) {
    const cur = [...jobs.values()].reverse().find((x) => x.job.round === round && !TERMINAL.includes(x.job.state))
    if (cur && cur.job.kind === kind) return cur
    throw new CoreError(409, `${round} is busy: wait for its ${cur?.job.kind ?? 'current'} job to finish.`)
  }
  busy.add(round)
  return null
}

/** Start pulling a round onto the volume. Returns the job at once (state `creating`); poll it with `job`. A second call for a round already being pulled returns that job. */
export async function pull(round: string, opts: Opts = {}): Promise<PodJob> {
  assertRound(round)
  const existing = claim(round, 'pull'); if (existing) return view(existing)
  try {
    // Only the shots asked for: every other shot folder of the round stays in the bucket (a shot is 1 to 15 GB; the whole round was 29 GB for a 1.3 GB shot).
    const skip = await skipOf(round, opts)
    const p = await plan(round, { ...opts, skipShots: skip })
    const i = newJob(round, 'pull', p, (opts.now ?? (() => new Date()))())
    if (skip.length) { i.job.skip_shots = skip; i.job.pulled_shots = [...opts.shots!].sort() }
    void run(i, opts)
    return view(i)
  } catch (e) { busy.delete(round); throw e }
}

/** Delete a round's copy from the volume (a pod action too: active pod over SSH, else a short-lived pod). Confined to one folder under temp/rounds. */
export async function remove(round: string, opts: Opts = {}): Promise<PodJob> {
  assertRound(round)
  const existing = claim(round, 'remove'); if (existing) return view(existing)
  try {
    const p = await plan(round, { ...opts, sizeOf: () => ({ files: 0, bytes: 0 }) })
    const i = newJob(round, 'remove', p, (opts.now ?? (() => new Date()))())
    void run(i, opts)
    return view(i)
  } catch (e) { busy.delete(round); throw e }
}

// ----- one volume: browse and erase (a short-lived pod, or the user's own pod on it) -----

const volLabel = (volumeId: string) => { if (!/^[A-Za-z0-9]{3,40}$/.test(volumeId)) throw bad(`Not a network volume id: ${volumeId}`); return `vol-${volumeId}` }
/** What a job on this volume would cost and where it runs, before it starts. */
/** RunPod's S3 API reads and writes a volume's files with no pod, but only in some datacenters and with S3 keys (Default Configuration): the keys and the endpoint, or why not. */
/** The RunPod S3 keys of Default Configuration, or none. */
function s3Keys(): { id: string; secret: string } | null { const id = settings.lookup('RUNPOD_S3_ACCESS_KEY') || '', secret = settings.lookup('RUNPOD_S3_SECRET_KEY') || ''; return id && secret ? { id, secret } : null }
function s3Access(vol: Volume | null): { ok: true; id: string; secret: string; endpoint: string; bucket: string; region: string } | { ok: false; why: 'datacenter' | 'keys' } {
  if (!vol || !pods.S3_DATACENTERS.has(vol.datacenter)) return { ok: false, why: 'datacenter' }
  const id = settings.lookup('RUNPOD_S3_ACCESS_KEY') || '', secret = settings.lookup('RUNPOD_S3_SECRET_KEY') || ''
  if (!id || !secret) return { ok: false, why: 'keys' }
  return { ok: true, id, secret, endpoint: sync.s3Endpoint(vol.datacenter), bucket: vol.id, region: vol.datacenter }
}
const defaultAws: AwsRunner = (args, env) => new Promise((res) => {
  const c = spawn('aws', args, { env: { ...process.env, ...env, AWS_EC2_METADATA_DISABLED: 'true' } })
  let stdout = '', stderr = ''
  c.stdout.on('data', (d) => { stdout += d }); c.stderr.on('data', (d) => { stderr += d })
  c.on('error', (e) => res({ code: 127, stdout, stderr: `${stderr}${e.message}` }))
  c.on('close', (code) => res({ code, stdout, stderr }))
})
export async function volumePlan(volumeId: string, opts: Opts = {}): Promise<PodPlan> {
  const p = await plan(volLabel(volumeId), { ...opts, volumeId, sizeOf: () => ({ files: 0, bytes: 0 }) })
  const a = s3Access(p.volume)
  // The S3 API when the volume's datacenter has it and the keys are set: no pod, no cost. Otherwise a pod does it, and the plan says why.
  return a.ok ? { ...p, route: 's3', pod: null, gpu: '', price_per_hour: 0, choices: undefined } : { ...p, s3_note: a.why }
}
async function startVolumeJob(volumeId: string, kind: 'browse' | 'erase', keys: string[], opts: Opts, path?: string): Promise<PodJob> {
  const label = volLabel(volumeId)
  const live = [...jobs.values()].find((x) => !TERMINAL.includes(x.job.state) && x.plan.volume?.id === volumeId)
  if (live && !(live.job.kind === kind && kind === 'browse')) throw new CoreError(409, `A ${live.job.kind} job is running on this volume (${live.job.round}): wait for it to finish.`)
  const existing = claim(label, kind); if (existing) return view(existing)
  try {
    const p = await volumePlan(volumeId, opts)
    const i = newJob(label, kind, p, (opts.now ?? (() => new Date()))())
    i.job.volume_id = volumeId; if (kind === 'erase') i.job.erase_keys = keys; if (kind === 'browse') i.job.browse_path = browsePathOf(path)
    void run(i, { ...opts, volumeId })
    return view(i)
  } catch (e) { busy.delete(label); throw e }
}
/** Copy one volume's files to another (an existing one, or a new one made here) through RunPod's S3 API, by a short pod: the source is never changed, and a rerun carries on (rclone copy, checksums). Spends: the new volume's monthly price and the pod's minutes, so it needs `approved_by`. */
export async function cloneVolume(sourceId: string, o: { approved_by?: string; to_volume_id?: string; new_volume?: { name: string; size_gb: number; datacenter: string }; include_input?: boolean }, opts: Opts = {}): Promise<PodJob> {
  volLabel(sourceId)
  if (!String(o.approved_by ?? '').trim()) throw new CoreError(400, 'Cloning needs a name behind it: approved_by.')
  if (!!o.to_volume_id === !!o.new_volume) throw bad('Say where to: an existing volume (to_volume_id) or a new one (new_volume: name, size_gb, datacenter).')
  const from = await volumeOf({ ...opts, volumeId: sourceId }); if (!from) throw new CoreError(404, `No network volume ${sourceId}.`)
  let to: Volume | null = null
  if (o.to_volume_id) { volLabel(o.to_volume_id); if (o.to_volume_id === sourceId) throw bad('A volume cannot be cloned onto itself.'); to = await volumeOf({ ...opts, volumeId: o.to_volume_id }); if (!to) throw new CoreError(404, `No network volume ${o.to_volume_id}.`) }
  const targetDc = to?.datacenter ?? o.new_volume!.datacenter
  const way = cloneMode(from, { datacenter: targetDc }, !!s3Keys())
  if (!to) { const v = await volumesMod.create(o.new_volume!, opts.client); to = { id: v.id, name: v.name, datacenter: v.datacenter } }   // the volume's monthly price starts here
  const podVol = way.mode === 'pull' ? to : from   // the pod mounts the side that is not served by S3 (rsync: both get a pod; the job is about the source)
  const label = volLabel(podVol.id)
  const live = [...jobs.values()].find((x) => !TERMINAL.includes(x.job.state) && (x.plan.volume?.id === podVol.id || (way.mode === 'rsync' && x.plan.volume?.id === to!.id)))
  if (live) throw new CoreError(409, `A ${live.job.kind} job is running on ${podVol.name}: wait for it to finish (the new volume ${to.id} stays).`)
  const existing = claim(label, 'clone'); if (existing) return view(existing)
  try {
    const p = await plan(label, { ...opts, volumeId: podVol.id, sizeOf: () => ({ files: 0, bytes: 0 }), ...(way.mode === 'rsync' ? { route: 'temporary' as const } : {}) })
    const i = newJob(label, 'clone', p, (opts.now ?? (() => new Date()))())
    i.job.volume_id = podVol.id
    i.job.clone = { mode: way.mode, from: { id: from.id, datacenter: from.datacenter, name: from.name }, to: { id: to.id, datacenter: to.datacenter, name: to.name }, include_input: !!o.include_input }
    void run(i, { ...opts, volumeId: podVol.id })
    return view(i)
  } catch (e) { busy.delete(label); throw e }
}
/** List a volume's folders to depth 3 with their sizes. Read-only; costs the short pod's minutes (or nothing on a pod of yours that is running). */
export const browseVolume = (volumeId: string, opts: Opts & { path?: string } = {}) => startVolumeJob(volumeId, 'browse', [], opts, opts.path)
/** Empty chosen folders of a volume (keys of ERASABLE). Not reversible: it needs the user's name behind it (`approved_by`) and the volume's name typed back (`confirm_name`). Refused while a pull, place or other job is running on the volume. */
export async function eraseVolume(volumeId: string, keys: string[], o: { approved_by?: string; confirm_name?: string }, opts: Opts = {}): Promise<PodJob> {
  const label = volLabel(volumeId)
  if (!String(o.approved_by ?? '').trim()) throw new CoreError(400, 'Erasing needs a name behind it: approved_by.')
  const ks = [...new Set(keys)]; if (!ks.length) throw bad('Choose what to erase')
  for (const k of ks) if (!ERASABLE[k]) throw bad(`Not something Erase clears: ${k} (one of ${Object.keys(ERASABLE).join(', ')})`)
  const vol = (await volumeOf({ ...opts, volumeId })) ?? { id: volumeId, name: volumeId, datacenter: '' }
  if (String(o.confirm_name ?? '') !== vol.name) throw new CoreError(400, `Type the volume's name (${vol.name}) to confirm: this cannot be undone.`)
  void label
  return startVolumeJob(volumeId, 'erase', ks, opts)
}

/** What a volume holds under comfy-shared/models/<folder>/, read over RunPod's S3 API (no pod, no cost): one entry per file with its folder and size. null when the S3 API cannot be used for this volume (no keys, or a datacenter without it): only a pod could say. */
export async function modelsOnVolume(volumeId: string, opts: Opts = {}): Promise<{ folder: string; name: string; bytes: number }[] | null> {
  volLabel(volumeId)
  if (mounts.dryRun(mounts.load())) return [{ folder: 'diffusion_models', name: 'simulated_model_fp16.safetensors', bytes: 1000 }, { folder: 'vae', name: 'simulated_vae.safetensors', bytes: 500 }]
  const vol = await volumeOf({ ...opts, volumeId })
  const a = s3Access(vol); if (!a.ok) return null
  const r = await (opts.aws ?? defaultAws)(['s3', 'ls', `s3://${a.bucket}/comfy-shared/models/`, '--recursive', '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret })
  if (r.code !== 0) throw new CoreError(502, `RunPod's S3 API: ${(r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`}`)
  const out: { folder: string; name: string; bytes: number }[] = []
  for (const line of r.stdout.split('\n')) {
    const m = /^\S+\s+\S+\s+(\d+)\s+comfy-shared\/models\/([^/]+)\/(.+)$/.exec(line)
    if (m) out.push({ folder: m[2], name: m[3], bytes: Number(m[1]) })
  }
  return out.sort((x, y) => x.folder.localeCompare(y.folder) || x.name.localeCompare(y.name))
}

/** One small text file from a volume over RunPod's S3 API (no pod, no cost), e.g. Binc's pull list; null when the S3 API cannot be used for this volume. */
export async function readVolumeText(volumeId: string, key: string, opts: Opts = {}): Promise<string | null> {
  volLabel(volumeId)
  if (!/^[\w .+@=,()/-]{1,300}$/.test(key) || key.split('/').includes('..')) throw bad(`Not a path inside the volume: ${key}`)
  if (mounts.dryRun(mounts.load())) return null
  const vol = await volumeOf({ ...opts, volumeId })
  const a = s3Access(vol); if (!a.ok) return null
  const r = await (opts.aws ?? defaultAws)(['s3', 'cp', `s3://${a.bucket}/${key}`, '-', '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret })
  if (r.code !== 0) throw new CoreError(502, `RunPod's S3 API: ${(r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`}`)
  return r.stdout
}

/** Put model files from Hugging Face onto a volume (ADR-042): a short pod (or yours running on it) downloads them straight into `comfy-shared/models/<folder>/`. Spends the pod's minutes. From the window the click is the yes (`approved_by` is optional and, when absent, the History says it was clicked in the app); the MCP tool still requires a name, as an agent's spend does (shared/governance/policy/agent-permissions.md). The files are looked up on Hugging Face again here; see hf.resolve. */
export async function fetchModels(volumeId: string, items: hf.FetchItem[], o: { approved_by?: string }, opts: Opts & { fetchFn?: typeof fetch } = {}): Promise<PodJob> {
  const label = volLabel(volumeId)
  const resolved = await hf.resolve(items, opts.fetchFn)
  const live = [...jobs.values()].find((x) => !TERMINAL.includes(x.job.state) && x.plan.volume?.id === volumeId)
  if (live) throw new CoreError(409, `A ${live.job.kind} job is running on this volume (${live.job.round}): wait for it to finish.`)
  const existing = claim(label, 'fetch'); if (existing) return view(existing)
  try {
    const p = await plan(label, { ...opts, volumeId, sizeOf: () => ({ files: 0, bytes: 0 }) })   // always a pod: the download happens there, not over S3
    const i = newJob(label, 'fetch', p, (opts.now ?? (() => new Date()))())
    i.job.volume_id = volumeId; i.job.fetch_items = resolved; i.job.lines.push(`Approved by ${String(o.approved_by ?? '').trim() || 'a click in the app window'}.`)
    void run(i, { ...opts, volumeId })
    return view(i)
  } catch (e) { busy.delete(label); throw e }
}

export function job(id: string): PodJob | null { const i = jobs.get(id); return i ? view(i) : null }

/** Stop a job. A temporary pod is deleted by the job's own cleanup; on the user's pod the SSH session is cut and the remote rclone stopped. */
export function cancel(id: string): PodJob {
  const i = jobs.get(id)
  if (!i) throw new CoreError(404, `No pod job ${id}`)
  if (TERMINAL.includes(i.job.state)) return view(i)
  i.cancelled = true
  i.job.state = 'cancelled'
  i.abort.abort()
  i.wake?.()
  return view(i)
}

/** The bucket's rounds with what the last pod job learned about each on the volume. */
export async function rounds(opts: Opts = {}): Promise<{ as_of: string | null; volume: Volume | null; rounds: { name: string; staged: boolean; state: RoundState; present: number; expected: number | null; missing: number | null; bytes: number }[] }> {
  const names = await (opts.listRounds ?? (async () => (await panama.roundsAsync()).map((r) => r.name)))()
  const volume = await volumeOf(opts)
  const rec = volume ? knownState(volume.id) : null
  return {
    as_of: rec?.as_of ?? null, volume,
    rounds: names.map((name) => { const r = rec?.rounds[name]; return { name, staged: r?.state === 'complete', state: r?.state ?? 'none', present: r?.present ?? 0, expected: r?.expected ?? null, missing: r?.missing ?? null, bytes: r?.bytes ?? 0 } }),
  }
}

/**
 * Place a round that is already on the volume (ADR-033), on a running pod of the user's: the pod named, or the one on the configured volume. Dry run by default:
 * it reads and reports, writes nothing. Idempotent. A real run is recorded in History as an import.
 */
export async function placeRound(round: string, o: { pod_id?: string; dry_run?: boolean } = {}, opts: Opts = {}): Promise<place.PlaceReport> {
  assertRound(round)
  const dryRun = o.dry_run !== false
  const cfg = mounts.load()
  if (mounts.dryRun(cfg)) return place.simulated(round, dryRun)
  let raw: rp.RawPod | null = null
  if (o.pod_id) raw = await rp.getPod(o.pod_id, opts.client)
  else { const f = await findActivePod(cfg, opts); if (f?.running) raw = await rp.getPod(f.id, opts.client) }
  if (!raw) throw bad(o.pod_id ? `Pod ${o.pod_id} was not found.` : 'No running pod of yours is on this volume: start one, or pass pod_id.')
  if ((raw.runtime?.uptimeInSeconds ?? 0) <= 0) throw bad(`Pod ${raw.name || raw.id} is not running: placing needs a running pod.`)
  const { host, port } = sync.sshTarget(raw)
  const r = await place.run(round, { host, port, ssh: opts.ssh ?? runSsh, dry_run: dryRun })
  if (!dryRun) history.record({ kind: 'change', area: 'import', action: 'place', what: round, detail: placeSummary(r) })
  return r
}
