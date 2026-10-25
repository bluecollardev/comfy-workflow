/**
 * Sync, run from the app: push the folders mapped on this PC onto the pod's network volume over
 * SSH (rsync, additive, never deletes), or pull the renders back. The plan comes from sync.ts; this
 * module runs it step by step in the main process, streaming every rsync line to the page, holding
 * the pod's idle stop while it runs (a stop mid-copy cut the first attempts), and restoring it after.
 * The run outlives the window that started it; cancel aborts the rsync.
 *
 * Progress (Lucas, 2026-10-21: "an accurate progress bar of what's being uploaded", files first):
 * - Before any copy, a listing pass per folder (`rsync -n --stats`, bounded by LIST_TIMEOUT_MS) counts the
 *   files and bytes to transfer; they ride on the 'step' event, and a 'totals' event carries the run's sums
 *   once every folder is listed. A listing that fails or runs out leaves that folder's totals unknown.
 * - A folder's measure is files: the 'file' events (a name as rsync prints it when a file starts) plus the
 *   'problem' lines, over its total. openrsync's "Transfer starting: N files" stands in as the total when the
 *   listing gave none.
 * - Bytes come from the same lines: rsync 3's --info=progress2 prints the folder's running total; openrsync's
 *   --progress (macOS) prints the current file's bytes, so a tally sums the finished files and adds the one
 *   under way. 'progress' events carry bytes done, the run's rate and remaining time, and the current file's
 *   own percentage, at most PROGRESS_EVERY_MS apart.
 *
 * Streams: a push over SSH splits each folder into its top-level directories, one rsync each, up to the
 * configuration's sync_parallel at a time (the loose files in the folder's root go first, on their own, which
 * also creates the folder and its subfolders on the pod). The Mac's uplink is the limit either way; streams keep
 * it full across thousands of small files. Pull and the S3 transport are one stream (the AWS CLI already
 * uploads in parallel).
 *
 * Renders: a push of the project skips the shots' existing renders (05_TEMPS, 06_REVIEW, 07_DELIVER) unless
 * asked not to (`skip_renders`, on by default; 18,983 of CANALV2's 23,547 files on 2026-10-21); Pull is what
 * brings renders back. countFor() gives the confirmation both figures.
 *
 * No-spend mode simulates all of it: each folder its own few files, printed the way openrsync prints and read
 * by the same tally, fanned out the same way, paced by SYNC_SIM_MS between lines (0, the default, runs at once).
 */
import { execFile, spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bad } from './errors.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as rp from './runpod.js'
import * as sync from './sync.js'
import * as settings from './settings.js'
import { volumeInfo } from './pods.js'

/** The subfolders of ComfyUI-Shared a push can carry: ComfyUI's input, its models, what pods write (output) and the graphs. */
export const SHARED_DIRS = mounts.SYNC_SHARED
export interface SyncRequest {
  pod_id: string; direction: 'push' | 'pull'; only?: string[]; plates?: boolean; approved_by?: string; skip_renders?: boolean; skip_tests?: boolean
  /** A push of ComfyUI-Shared: which of SHARED_DIRS go up. Left out, the pod's own configuration decides (else the Default Configuration's `sync_shared`); the app's confirmation sends the choice shown. Anything else in the folder always goes. */
  shared?: string[]
}
export interface SyncEvent {
  kind: 'plan' | 'listing' | 'totals' | 'step' | 'line' | 'file' | 'progress' | 'problem' | 'step-done' | 'done' | 'error'
  key?: string; local?: string; remote?: string; text?: string; code?: number; steps?: sync.Step[]; path?: string
  stream?: string                               // the top-level directory this line came from, when the folder went in streams
  total_files?: number; total_bytes?: number   // step: that folder's, from the listing; totals: the run's; line: openrsync's own count
  file_percent?: number; bytes_done?: number; run_bytes_done?: number; rate_bps?: number; eta_s?: number   // progress
}
export interface SyncResult { steps: number; failed: number; warned: number; cancelled: boolean }
export interface Counts { total_files?: number; total_bytes?: number }
/** rsync exit codes that still copied everything they could: a warning on the folder, not a failed one.
 *  23: some files or attributes were not transferred (the volume refuses a chown or a time; the lines above name them).
 *  24: a file vanished on this PC while rsync read it. The run goes on either way; the result counts them as warned. */
export const WARN_CODES: Record<number, string> = {
  23: 'some files or attributes were not transferred (the lines above say which); everything else landed',
  24: 'a file vanished on this PC while it was being copied; everything else landed',
}
export const LIST_TIMEOUT_MS = 3 * 60_000
export const PROGRESS_EVERY_MS = 250
/** A shot's render folders (CANALV2's structure): what a push leaves behind with skip_renders. Matched by name at any depth; no top-level folder is named so. */
export const RENDER_DIRS = ['05_TEMPS', '06_REVIEW', '07_DELIVER']
/** Binc's scratch folder for quick tests (00_POLICY/project_v002.md): no shot's graph reads it. Top level of the project only (`/80_TEST-BUCKET/`). */
export const TEST_DIR = '80_TEST-BUCKET'

/** The effective configuration for a pod: its own, else the default. */
const configFor = (podId: string) => podconfigs.get(podId) ?? mounts.load()

/** The ComfyUI-Shared subfolders this pod's pushes carry: the request's choice, else the pod's own configuration, else the default. */
export const effectiveShared = (req: Pick<SyncRequest, 'pod_id' | 'shared'>): string[] => req.shared ?? configFor(req.pod_id).sync_shared ?? [...mounts.SYNC_SHARED_DEFAULT]
/** The request with that choice filled in, so the plan, the counts and the run agree. */
const resolved = (req: SyncRequest): SyncRequest => (req.direction === 'push' ? { ...req, shared: effectiveShared(req) } : req)

/** What a run would copy, without running it (the confirmation shows this). */
export function planFor(request: SyncRequest): sync.Step[] {
  const req = resolved(request)
  const cfg = configFor(req.pod_id)
  const only = new Set(req.only || [])
  if (req.direction === 'pull') return sync.pullPlan(cfg, sync.listShots(cfg.folders.project || ''), only)
  if (req.plates && !req.approved_by?.trim()) throw bad('Plates leaving this PC need a named yes: give approved_by (shared/governance/policy/agent-permissions.md)')
  const steps = sync.plan(cfg, only, !!req.plates)
  // the graphs step puts the repo's workflows into ComfyUI-Shared/workflows: unchecked, it goes too
  return req.shared && !req.shared.includes('workflows') ? steps.filter((s) => s.key !== 'workflows') : steps
}
/** The excludes a step takes beyond sync.EXCLUDE, on a push: the shots' renders (project, with skip_renders: `NAME/`, at any depth) and the
 *  ComfyUI-Shared subfolders that were not chosen (`/NAME/`, a leading slash: the top level of that folder only, so an `output` folder deeper down is not touched). */
export const excludesFor = (req: SyncRequest, step: sync.Step): string[] => {
  if (req.direction !== 'push') return []
  const out: string[] = []
  if (req.skip_renders && step.key === 'project') out.push(...RENDER_DIRS.map((d) => `${d}/`))
  if (req.skip_tests && step.key === 'project') out.push(`/${TEST_DIR}/`)
  if (step.key === 'comfy-shared' && req.shared) out.push(...SHARED_DIRS.filter((d) => !req.shared!.includes(d)).map((d) => `/${d}/`))
  return out
}

const num = (s: string) => Number(s.replace(/,/g, ''))

/** One rsync or aws line read. A bare path is a file that starts (a trailing slash makes it a directory, not a file);
 *  a percentage is progress: rsync 3's progress2 line (with "(xfr#n, to-chk=…)") carries the folder's bytes so far,
 *  openrsync's and aws's carry the current file's, final when openrsync closes it with "(xfer#n, to-check=…)";
 *  an rsync complaint is a problem; openrsync's "Transfer starting: N files" is a line that knows the count. */
export interface Parsed { kind: 'line' | 'file' | 'progress' | 'problem'; text: string; path?: string; bytes?: number; cumulative?: boolean; percent?: number; final?: boolean; total_files?: number }
export function classify(line: string): Parsed {
  const aws = line.match(/^(upload|download|copy): (.+?) to (.+)$/)
  if (aws) { const key = [aws[2], aws[3]].find((x) => x.startsWith('s3://')) || aws[3]; return { kind: 'file', path: key.replace(/^s3:\/\/[^/]+\//, ''), text: line } }
  const done = line.match(/^Completed ([\d.]+) ([KMGT]iB)\/~?([\d.]+) ([KMGT]iB)/)
  if (done) { const u: Record<string, number> = { KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }; const a = Number(done[1]) * u[done[2]], b = Number(done[3]) * u[done[4]]; return { kind: 'progress', bytes: Math.round(a), cumulative: true, percent: b ? Math.min(100, Math.round((a / b) * 100)) : 0, text: line } }
  const starting = line.match(/^Transfer starting: (\d+) files?$/)
  if (starting) return { kind: 'line', text: line, total_files: Number(starting[1]) }
  const pct = line.match(/^\s*([\d,]+)\s+(\d{1,3})%/)
  if (pct) {
    const cumulative = /\(xfr#\d+, (?:to|ir)-chk=/.test(line)
    return { kind: 'progress', bytes: num(pct[1]), percent: Math.min(100, Number(pct[2])), cumulative, final: !cumulative && /\(xfer#\d+, to-check=/.test(line), text: line }
  }
  if (/^rsync(\(\d+\))?:|^rsync error|No such file|Permission denied|cannot run|Connection refused|unexpected end of file|failed/i.test(line)) return { kind: 'problem', text: line }
  if (/^(sending incremental|receiving incremental|building file list|sent \d|total size|delta-transmission|\$ |done$|\.\/$|Number of|Total |Unmatched data|Matched data|File list |Literal data|Total bytes)/.test(line) || !line.trim()) return { kind: 'line', text: line }
  if (/^\S/.test(line) && !/\s{2,}/.test(line) && !/^Transferred/.test(line)) return /\/$/.test(line) ? { kind: 'line', text: line } : { kind: 'file', path: line, text: line }
  return { kind: 'line', text: line }
}

/** What `rsync -n --stats` says a folder would transfer (openrsync prints "N B", rsync 3 "N bytes", both the same labels). */
export function parseStats(lines: string[]): Counts {
  const out: Counts = {}
  for (const l of lines) {
    const f = l.match(/^Number of (?:regular )?files transferred: ([\d,]+)/); if (f) out.total_files = num(f[1])
    const b = l.match(/^Total transferred file size: ([\d,]+) (?:B|bytes)/); if (b) out.total_bytes = num(b[1])
  }
  return out
}
const sumCounts = (list: Counts[], expected: number): Counts => {
  const sum = (k: keyof Counts) => (list.length === expected && list.every((c) => c[k] !== undefined) ? list.reduce((a, c) => a + c[k]!, 0) : undefined)
  return { total_files: sum('total_files'), total_bytes: sum('total_bytes') }
}

/** The run's pace: bytes over the time since the first byte, and what is left at that rate when the total is known. */
export class RunMeter {
  before = 0                       // bytes of the folders already done
  total?: number
  private startedAt?: number
  constructor(private now: () => number = Date.now) {}
  pace(bytes: number, t = this.now()): { rate_bps?: number; eta_s?: number } {
    if (this.startedAt === undefined) { this.startedAt = t; return {} }
    const s = (t - this.startedAt) / 1000
    if (s < 1 || !bytes) return {}
    const rate = bytes / s
    return { rate_bps: Math.round(rate), eta_s: this.total !== undefined ? Math.max(0, Math.round((this.total - bytes) / rate)) : undefined }
  }
}

/** One folder's lines as events, from one or more streams at once: each stream sums its own bytes (finished files plus
 *  the one under way), the tally adds them up and sends 'progress' at most every PROGRESS_EVERY_MS; close() flushes
 *  and hands the folder's bytes to the run. */
export class StepTally {
  private bytes = new Map<string, number>()
  private lastSent = -Infinity
  private filePercent?: number
  constructor(private key: string, private run: RunMeter, private send: (e: SyncEvent) => void, private now: () => number = Date.now) {}
  total(): number { let t = 0; for (const b of this.bytes.values()) t += b; return t }
  private emit(force: boolean) {
    const t = this.now()
    if (!force && t - this.lastSent < PROGRESS_EVERY_MS) return
    this.lastSent = t
    const bytes = this.total()
    this.send({ kind: 'progress', key: this.key, bytes_done: bytes, run_bytes_done: this.run.before + bytes, file_percent: this.filePercent, ...this.run.pace(this.run.before + bytes, t) })
  }
  stream(name = '.') {
    let fileBytes = 0, doneBytes = 0
    const stream = name === '.' ? undefined : name
    const set = () => this.bytes.set(name, doneBytes + fileBytes)
    return {
      line: (text: string) => {
        const p = classify(text)
        if (p.kind === 'file') { doneBytes += fileBytes; fileBytes = 0; this.filePercent = undefined; set(); this.send({ kind: 'file', key: this.key, stream, path: p.path, text }); return }
        if (p.kind === 'progress') {
          if (p.cumulative) { doneBytes = p.bytes ?? doneBytes; fileBytes = 0 }
          else if (p.final) { doneBytes += p.bytes ?? fileBytes; fileBytes = 0; this.filePercent = 100 }
          else { fileBytes = p.bytes ?? fileBytes; this.filePercent = p.percent }
          set(); this.emit(false); return
        }
        this.send({ kind: p.kind, key: this.key, stream, text, total_files: p.total_files })
      },
      finish: () => set(),
    }
  }
  close() { this.emit(true); this.run.before += this.total() }
}
/** The tally for a folder that goes in one stream. */
export function stepMeter(key: string, run: RunMeter, send: (e: SyncEvent) => void, now: () => number = Date.now) {
  const tally = new StepTally(key, run, send, now)
  const s = tally.stream()
  return { line: s.line, finish: () => { s.finish(); tally.close() } }
}

export interface Transport { kind: 'ssh' | 's3' | 'none'; reason: string; volume?: { id: string; datacenter: string; name: string }; host?: string; port?: number }
/** How this pod's volume can be reached now: SSH into the pod while it runs; RunPod's S3 API onto the volume when
 *  it is off and the volume's datacenter serves it (keys needed); else nothing, with the reason. */
export async function transportFor(podId: string, client?: rp.RunPodClient): Promise<Transport> {
  const cfg = configFor(podId)
  if (mounts.dryRun(mounts.load())) return { kind: 'ssh', reason: `no-spend mode: the copy is simulated, up to ${cfg.sync_parallel} streams` }
  const raw = await rp.getPod(podId, client)
  if (!raw) return { kind: 'none', reason: `No pod ${podId}` }
  if ((raw.runtime?.uptimeInSeconds ?? 0) > 0) {
    try { const { host, port } = sync.sshTarget(raw); return { kind: 'ssh', reason: `over SSH into the running pod (${host}:${port}), up to ${cfg.sync_parallel} rsync streams at a time`, host, port } }
    catch (e) { return { kind: 'none', reason: (e as Error).message } }
  }
  const vid = raw.networkVolumeId || cfg.network_volume_id
  if (!vid) return { kind: 'none', reason: 'The pod is off and has no network volume: start it, or give it a volume' }
  const v = await volumeInfo(vid, client)
  if (!v) return { kind: 'none', reason: `The pod is off and its volume ${vid} is not on this account` }
  if (!v.s3) return { kind: 'none', reason: `The pod is off and ${v.name} lives in ${v.datacenter}, which does not serve the S3 API: start the pod, or use a volume in an S3 datacenter (ADR-007)` }
  const keys = sync.s3Env(settings.lookup)
  if (!keys.AWS_ACCESS_KEY_ID || !keys.AWS_SECRET_ACCESS_KEY) return { kind: 'none', reason: `The pod is off; ${v.name} takes uploads over S3 with no pod, but the S3 keys are not set: enter them in Default Configuration (RunPod console, Settings, S3 API keys)` }
  return { kind: 's3', reason: `over RunPod's S3 API onto ${v.name} in ${v.datacenter}, no pod needed; the AWS CLI uploads in parallel on its own`, volume: { id: v.id, datacenter: v.datacenter, name: v.name } }
}

/** How a folder splits into streams: the loose files in its root (first, on its own: that creates the folder and its
 *  subfolders on the pod), then each top-level directory that the excludes do not drop. A folder that cannot be read is one stream. */
export interface Stream { name: string; local: string; remote: string; shallow: boolean }
const excluded = (name: string) => sync.EXCLUDE.some((p) => new RegExp('^' + p.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(name))
export function streamsOf(local: string, remote: string, exclude: string[] = []): Stream[] {
  const root: Stream = { name: '.', local, remote, shallow: true }
  try {
    const dirs = readdirSync(local, { withFileTypes: true }).filter((d) => d.isDirectory() && !excluded(d.name) && !exclude.some((e) => e.replace(/^\//, '') === d.name + '/')).map((d) => d.name).sort()
    return [root, ...dirs.map((name) => ({ name, local: join(local, name) + '/', remote: remote + name + '/', shallow: false }))]
  } catch { return [{ ...root, shallow: false }] }
}
/** Up to n at a time, in order. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { while (i < items.length) await fn(items[i++]) }))
}
/** A folder's exit code from its streams': a failure first, else a warning, else 0. */
export const worstCode = (codes: number[]): number => codes.find((c) => c !== 0 && !WARN_CODES[c]) ?? codes.find((c) => c !== 0) ?? 0

/** The simulated copy: a different set of files, so a different progress sequence, per folder in the plan; the second
 *  file of each is a big one that reports once on its way; the first folder carries a shot render that skip_renders
 *  drops. Printed as openrsync prints, one stream per top-level directory, so the tally is the real one. */
const SIM_FILES = [
  ['models/checkpoints/sim.safetensors', '10_CORROSION/corrosion-001/06_REVIEW/comp_v001/frame_0001.dpx', 'input/frame_0002.png'],
  ['input/frame_0003.png', 'output/render_0001.exr', 'output/render_0002.exr', 'output/render_0003.exr'],
  ['graphs/stereo_v26.json', 'graphs/corrosion_v26.json'],
]
export const SIM_FILE_BYTES = 1.5 * 1024 ** 3
/** Whether an exclude drops a simulated file: `/NAME/` is the top level, `NAME/` is that folder at any depth below the top. */
const simDrops = (excludes: string[], f: string) => excludes.some((e) => (e.startsWith('/') ? f.startsWith(e.slice(1)) : f.includes(`/${e}`)))
const simNames = (n: number, excludes: string[]) => SIM_FILES[n % SIM_FILES.length].filter((f) => !simDrops(excludes, f))
const simStats = (n: number, excludes: string[]) => [`Number of files transferred: ${simNames(n, excludes).length}`, `Total transferred file size: ${simNames(n, excludes).length * SIM_FILE_BYTES} B`]
function* simLines(names: string[]): Generator<string> {
  yield `Transfer starting: ${names.length} files`
  for (const [i, name] of names.entries()) {
    yield name
    if (i === 1) yield `      ${SIM_FILE_BYTES / 2}  50%   10.05MB/s   00:00:01`
    yield `     ${SIM_FILE_BYTES} 100%   13.94MB/s   00:00:02 (xfer#${i + 1}, to-check=${i}/${names.length})`
  }
  yield `sent ${names.length * SIM_FILE_BYTES} bytes  received 170 bytes  15477730 bytes/sec`
  yield `total size is ${names.length * SIM_FILE_BYTES}  speedup is 1.00`
}
const simPause = () => { const ms = Number(process.env.SYNC_SIM_MS || 0); return ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve() }

const rsyncVersion = () => new Promise<string>((res) => execFile('rsync', ['--version'], { timeout: 10_000 }, (_e, out) => res(String(out || ''))))

export type Exec = (cmd: string[], onLine: (text: string) => void, signal: AbortSignal, env?: NodeJS.ProcessEnv) => Promise<number>
/** Spawn a command, a line at a time (\r too: rsync rewrites its progress line), and resolve with its exit code when it closes. */
export function runCommand(cmd: string[], onLine: (text: string) => void, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env })
    let buf = ''
    const feed = (chunk: Buffer) => {
      buf += chunk.toString()
      const parts = buf.split(/\r\n|\r|\n/); buf = parts.pop() || ''
      for (const p of parts) if (p.trim()) onLine(p)
    }
    child.stdout.on('data', feed); child.stderr.on('data', feed)
    const kill = () => child.kill('SIGTERM')
    signal.addEventListener('abort', kill, { once: true })
    child.on('error', (e) => { onLine(`cannot run ${cmd[0]}: ${e.message}`); resolve(127) })
    child.on('close', (code) => { if (buf.trim()) onLine(buf); signal.removeEventListener('abort', kill); resolve(code ?? 1) })
  })
}

/** The listing pass for one folder: the same rsync with -n --stats, no transfer, cut off after timeoutMs (then nothing is known). */
export async function listStep(cmd: string[], signal: AbortSignal, env: NodeJS.ProcessEnv, exec: Exec = runCommand, timeoutMs = LIST_TIMEOUT_MS): Promise<Counts> {
  const lines: string[] = []
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const onAbort = () => ac.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const code = await exec(cmd, (l) => lines.push(l), ac.signal, env)
    if (ac.signal.aborted || (code !== 0 && !WARN_CODES[code])) return {}
    return parseStats(lines)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
}

/** The commands for a step on a transport, given the run's progress flag. */
function commandFor(req: SyncRequest, transport: Transport, step: sync.Step, mountPath: string, o: sync.RsyncOptions, local = step.local, remote = step.remote): string[] {
  if (transport.kind === 's3') return req.direction === 'push' ? sync.s3Cmd(step.local, transport.volume!, step.remote, { mountPath, exclude: o.exclude }) : sync.s3PullCmd(transport.volume!, step.remote, step.local, { mountPath })
  return req.direction === 'push' ? sync.rsyncCmd(local, transport.host!, transport.port!, remote, o) : sync.rsyncPullCmd(transport.host!, transport.port!, remote, local, o)
}

/** What a run would send, from the listing passes: all of it, and with the request's own skips (the renders, the test bucket) when the plan has the project. The confirmation shows the one the switches describe. */
export async function countFor(request: SyncRequest, client?: rp.RunPodClient, exec: Exec = runCommand): Promise<{ all: Counts; without_renders?: Counts }> {
  const req = resolved(request)
  const steps = planFor(req)
  const project = req.direction === 'push' && steps.some((s) => s.key === 'project')
  if (mounts.dryRun(mounts.load())) {
    const all = sumCounts(steps.map((s, n) => parseStats(simStats(n, excludesFor({ ...req, skip_renders: false, skip_tests: false }, s)))), steps.length)
    return { all, without_renders: project ? sumCounts(steps.map((s, n) => parseStats(simStats(n, excludesFor(req, s)))), steps.length) : undefined }
  }
  const transport = await transportFor(req.pod_id, client)
  if (transport.kind !== 'ssh') return { all: {} }
  const mountPath = configFor(req.pod_id).mount_path || '/workspace'
  const progress = sync.progressFlag(await rsyncVersion())   // openrsync refuses --info=progress2 even on a dry run
  const signal = new AbortController().signal
  const list = (step: sync.Step, exclude: string[]) => listStep(commandFor(req, transport, step, mountPath, { progress, verbose: true, dryRun: true, stats: true, exclude }), signal, process.env, exec)
  const counts: Counts[] = []
  for (const step of steps) counts.push(await list(step, excludesFor({ ...req, skip_renders: false, skip_tests: false }, step)))
  const all = sumCounts(counts, steps.length)
  if (!project) return { all }
  const without = await Promise.all(steps.map((step, i) => (step.key === 'project' ? list(step, excludesFor(req, step)) : Promise.resolve(counts[i]))))
  return { all, without_renders: sumCounts(without, steps.length) }
}

export async function run(request: SyncRequest, send: (e: SyncEvent) => void, signal: AbortSignal, client?: rp.RunPodClient, exec: Exec = runCommand): Promise<SyncResult> {
  const req = resolved(request)
  const steps = planFor(req)
  send({ kind: 'plan', steps })
  if (!steps.length) throw bad('Nothing to copy: map the folders in Default Configuration first')
  const cfg = configFor(req.pod_id)
  const dry = mounts.dryRun(mounts.load())
  const result: SyncResult = { steps: steps.length, failed: 0, warned: 0, cancelled: false }
  const transport = await transportFor(req.pod_id, client)
  if (transport.kind === 'none') throw bad(transport.reason)
  send({ kind: 'line', text: `Copying ${transport.reason}` })
  const mountPath = cfg.mount_path || '/workspace'
  const progress = dry || transport.kind !== 'ssh' ? '--progress' : sync.progressFlag(await rsyncVersion())
  const env = transport.kind === 's3' ? { ...process.env, ...sync.s3Env(settings.lookup) } : process.env
  const parallel = Math.max(1, cfg.sync_parallel || 1)
  const held = idle.entry(req.pod_id)?.minutes
  if (held) idle.register(req.pod_id, 0)   // not stopped mid-copy; restored below
  try {
    // Every folder listed first, so the run's total is known before the first byte moves.
    const totals: Counts[] = []
    for (const [n, step] of steps.entries()) {
      if (signal.aborted) break
      send({ kind: 'listing', key: step.key })
      const exclude = excludesFor(req, step)
      if (dry) totals.push(parseStats(simStats(n, exclude)))
      else if (transport.kind === 'ssh') totals.push(await listStep(commandFor(req, transport, step, mountPath, { progress, verbose: true, dryRun: true, stats: true, exclude }), signal, env, exec))
      else totals.push({})   // aws s3 sync has no cheap count
    }
    const meter = new RunMeter(); meter.total = sumCounts(totals, steps.length).total_bytes
    send({ kind: 'totals', ...sumCounts(totals, steps.length) })
    for (const [n, step] of steps.entries()) {
      if (signal.aborted) { result.cancelled = true; break }
      const exclude = excludesFor(req, step)
      send({ kind: 'step', key: step.key, local: step.local, remote: step.remote, ...totals[n] })
      const tally = new StepTally(step.key, meter, send)
      const codes: number[] = []
      if (dry) {
        send({ kind: 'line', key: step.key, text: `simulated: ${step.local} -> ${step.remote} (no-spend mode: nothing is copied)` })
        const byDir = new Map<string, string[]>()
        for (const f of simNames(n, exclude)) { const d = f.split('/')[0]; byDir.set(d, [...(byDir.get(d) || []), f]) }
        await pool([...byDir.entries()], parallel, async ([dir, names]) => {
          const s = tally.stream(dir)
          for (const line of simLines(names)) { await simPause(); if (signal.aborted) break; s.line(line) }
          s.finish(); codes.push(0)
        })
      } else {
        const streams = req.direction === 'push' && transport.kind === 'ssh' ? streamsOf(step.local, step.remote, exclude) : [{ name: '.', local: step.local, remote: step.remote, shallow: false } as Stream]
        const one = async (u: Stream) => {
          if (signal.aborted) return
          const cmd = commandFor(req, transport, step, mountPath, { progress, verbose: true, exclude: u.name === '.' ? exclude : exclude.filter((e) => !e.startsWith('/')), shallow: u.shallow }, u.local, u.remote)
          send({ kind: 'line', key: step.key, stream: u.name === '.' ? undefined : u.name, text: '$ ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ') })
          const s = tally.stream(u.name)
          codes.push(await exec(cmd, (text) => s.line(text), signal, env))
          s.finish()
        }
        await one(streams[0])   // the root first: the folder exists on the pod before the streams write into it
        await pool(streams.slice(1), parallel, one)
      }
      tally.close()
      const code = worstCode(codes)
      if (code !== 0 && !signal.aborted) {
        if (WARN_CODES[code]) { result.warned++; send({ kind: 'line', key: step.key, text: `rsync exit ${code}: ${WARN_CODES[code]}` }) }
        else result.failed++
      }
      send({ kind: 'step-done', key: step.key, code })
      if (signal.aborted) { result.cancelled = true; break }
    }
  } finally {
    if (held) idle.register(req.pod_id, held)
  }
  send({ kind: 'done', text: result.cancelled ? 'cancelled' : result.failed ? `${result.failed} of ${result.steps} folders failed` : result.warned ? `${result.steps} folders in step, ${result.warned} with warnings` : `${result.steps} folders in step` })
  return result
}
