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
 * `approved_by` (the user's approval to build this feature); the USD 100 cap is enforced where governance is (the MCP server), core keeps no ledger.
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
import { configDir } from './paths.js'
import * as place from './place.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as settings from './settings.js'
import * as sync from './sync.js'

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
interface RoundRec { state: RoundState; present: number; expected: number | null; missing: number | null; bytes: number }
interface VolRec { as_of: string; rounds: Record<string, RoundRec> }
const stateFile = () => process.env.POD_ROUNDS_FILE || join(configDir(), 'pod-rounds.json')
const tempFile = () => process.env.PULL_PODS_FILE || join(configDir(), 'pull-pods.json')
const readJson = <T>(f: string, fallback: T): T => { try { return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback } catch { return fallback } }
const writeJson = (f: string, v: unknown) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
/** Simulated jobs never write over what a real volume reported. */
const volKey = (volumeId: string) => (mounts.dryRun(mounts.load()) ? `simulated:${volumeId}` : volumeId)

export function recordState(volumeId: string, round: string, rec: RoundRec | null, now = new Date()) {
  const all = readJson<Record<string, VolRec>>(stateFile(), {})
  const v = (all[volKey(volumeId)] ||= { as_of: now.toISOString(), rounds: {} })
  if (rec) v.rounds[round] = rec; else delete v.rounds[round]
  v.as_of = now.toISOString()
  writeJson(stateFile(), all)
}
export const knownState = (volumeId: string): VolRec | null => readJson<Record<string, VolRec>>(stateFile(), {})[volKey(volumeId)] ?? null

export interface TempPod { round: string; kind: 'pull' | 'remove'; name: string; pod_id: string | null; volume: string; created_at: string; approved_by: string }
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

export interface Opts {
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
}

async function volumeOf(opts: Opts): Promise<Volume | null> {
  const cfg = mounts.load()
  const id = (cfg.network_volume_id || '').trim()
  if (!id) return null
  try {
    const v = await pods.volumeInfo(id, opts.client)
    if (v) { const vol = { id: v.id, name: v.name, datacenter: v.datacenter }; volCache.set(id, vol); return vol }
  } catch { /* fall back to what the configuration says */ }
  return volCache.get(id) ?? { id, name: id, datacenter: cfg.data_center_id || '' }
}

export interface PodPlan {
  round: string; route: 'active' | 'temporary'; pod: { id: string; name: string; price_per_hour: number | null } | null
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
  try { const s = await (opts.sizeOf ?? panama.sizeAsync)(round); return { files: s.files, bytes: s.bytes } } catch { return { files: 0, bytes: 0 } }
}

/** A pod of the user's on the configured volume that the Sync's SSH route can reach, if any: a running one first, else an off one (started before the job). Our own pull pods never count. */
async function findActivePod(cfg: mounts.MountsConfig, opts: Opts): Promise<{ id: string; name: string; price: number | null; gpu: string; running: boolean } | null> {
  if (mounts.dryRun(cfg)) {
    const all = dry.list().filter((x) => !x.name.startsWith(POD_PREFIX))
    const p = all.find((x) => x.status === 'running') ?? all.find((x) => x.status === 'stopped')
    return p ? { id: p.id, name: p.name, price: 0, gpu: p.gpu, running: p.status === 'running' } : null
  }
  const volume = (cfg.network_volume_id || '').trim()
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

export async function plan(round: string, opts: Opts = {}): Promise<PodPlan> {
  assertRound(round)
  const cap = capability()
  if (!cap.available) throw bad(cap.reason)
  const cfg = mounts.load()
  const volume = await volumeOf(opts)
  const size = await sizeOf(round, opts)
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
  id: string; round: string; kind: 'pull' | 'remove'; route: 'active' | 'temporary'; pod_id: string | null; pod_name: string | null
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
export function removeScript(round: string): string {
  assertRound(round)
  return [
    'set -eu', `d=${q(`${REMOTE_ROUNDS}/${round}`)}`,
    `case "$d" in ${REMOTE_ROUNDS}/?*) ;; *) echo "refused: $d"; exit 64 ;; esac`,
    'if [ -d "$d" ]; then rm -rf -- "$d" && echo "removed $d"; else echo "nothing to remove at $d"; fi', '',
  ].join('\n')
}
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
  const job: PodJob = { id: `${kind}-${round}-${now.getTime()}`, round, kind, route: p.route, pod_id: p.route === 'active' ? p.pod!.id : null, pod_name: p.route === 'active' ? p.pod!.name : podName(round, now), state: 'creating', files: 0, lines: [], started_at: now.toISOString(), bytes_done: 0, bytes_total: null, rate: null, recent: [] }
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
  if (j.kind === 'remove') {
    if (i.outcome === 'removed') { done('done'); if (vol) recordState(vol, j.round, null) } else done('failed', j.error || (i.outcome === 'refused' ? 'The pod refused the path.' : 'The delete did not report back.'))
    return
  }
  switch (i.outcome) {
    case 'done':
      j.verify = { listed: p.files, bad: [], extra: 0, ok: true }; done('done')
      if (vol) recordState(vol, j.round, { state: 'complete', present: p.files, expected: p.files, missing: 0, bytes: p.bytes }); break
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
    await runOnPod(i, host, port, j.kind === 'pull' ? pullScript(j.round, k!) : removeScript(j.round), opts, k ? [k.secret, k.id] : [])
    await placeAfter(i, host, port, opts)
  } finally { idle.register(pod.id, prev) }
}

async function runTemporary(i: Internal, opts: Opts) {
  const p = i.plan, j = i.job, cfg = mounts.load()
  const name = j.pod_name!   // set when the job was created
  const k = j.kind === 'pull' ? keys() : null
  const secrets = k ? [k.secret, k.id] : []
  tempAdd({ round: j.round, kind: j.kind, name, pod_id: null, volume: p.volume?.id || '', created_at: new Date().toISOString(), approved_by: APPROVED_BY })   // before the pod exists
  let podId: string | null = null
  const deadline = Date.now() + (p.ceiling_minutes + 10) * 60_000
  try {
    const env: Record<string, string> = { ...cfg.env }
    if (j.kind === 'pull') env.S3_PULL = s3PullFor(j.round); else delete env.S3_PULL   // a delete never carries a pull (or the keys podOverrides adds for one)
    // The cheapest free card can be taken between the plan and the create ("No card available"): try the next free card of the volume's datacenter, then the app's own choice.
    const base = { name, round: j.round, image: 'configured', cuda_match: false, idle_stop_minutes: p.ceiling_minutes, config: { ...cfg, env } } as const
    const tried = new Set<string>()
    let created: Awaited<ReturnType<typeof pods.create>> | null = null
    let next: string | undefined = p.gpu_type_id
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      try { created = await pods.create({ ...base, ...(next ? { gpu_type_id: next } : { gpu: 'auto' }) }, opts.client) } catch (e) {
        if (!/No card available/.test((e as Error).message)) throw e
        if (next) tried.add(next)
        const dc = p.volume?.datacenter
        const more = dc ? (await rp.freeCardsIn(dc, opts.client).catch(() => [])).filter((c) => !tried.has(c.id) && (cfg.pull_any_card !== false || gpus.autoCards().some((g) => g.id === c.id))) : []
        if (!more.length && !next) throw e   // 'auto' failed as well: nothing is free
        next = more[0]?.id   // undefined: the app's own choice, once
        if (!next && attempt > 0 && tried.size > 0 && !more.length) { try { created = await pods.create({ ...base, gpu: 'auto' }, opts.client) } catch { throw e } }
      }
    }
    if (!created) throw new CoreError(502, 'No card available right now in the volume\'s datacenter (tried several). Try again in a few minutes.')
    podId = created.id; j.pod_id = podId; tempSetId(name, podId)
    if (i.cancelled) return
    j.state = 'starting'
    if (j.kind === 'remove') {
      const { host, port } = await waitForSshTarget(i, podId, opts, deadline)
      j.state = 'deleting'
      await runOnPod(i, host, port, removeScript(j.round), opts, secrets)
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
      podId = created.id; j.pod_id = podId; j.pod_name = created.name
    }
    const steps: [JobState, string[]][] = j.kind === 'pull'
      ? [['starting', ['no-spend mode: the pod is simulated']], ['pulling', [`s3 pull: ${panama.bucket()}/rounds/${j.round} -> ${REMOTE_ROUNDS}/${j.round}`, 'a.json: Copied (new)', 'b.json: Copied (new)']], ['verifying', ['100%, 0 B/s']], ['pulling', ['s3 pull done (manifest verified): ' + `${REMOTE_ROUNDS}/${j.round}`]]]
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

async function run(i: Internal, opts: Opts) {
  try {
    if (mounts.dryRun(mounts.load())) await simulate(i, opts)
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
    const p = await plan(round, opts)
    const i = newJob(round, 'pull', p, (opts.now ?? (() => new Date()))())
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
