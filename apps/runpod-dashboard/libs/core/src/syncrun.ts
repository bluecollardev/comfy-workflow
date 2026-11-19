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
import { lstat, mkdtemp, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as idle from './idle.js'
import * as mounts from './mounts.js'
import * as podconfigs from './podconfigs.js'
import * as podvolume from './podvolume.js'
import * as rp from './runpod.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as journal from './journal.js'
import { registry } from './syncruns.js'
import * as sync from './sync.js'
import * as syncdelete from './syncdelete.js'
import * as settings from './settings.js'
import { volumeInfo } from './pods.js'
import { SHARED_TEMP } from './paths.js'

/** The subfolders of ComfyUI-Shared a push can carry: ComfyUI's input, its models, what pods write (output) and the graphs. */
export const SHARED_DIRS = mounts.SYNC_SHARED
export interface SyncRequest {
  pod_id: string; direction: 'push' | 'pull'; only?: string[]; plates?: boolean; approved_by?: string; skip_renders?: boolean; skip_tests?: boolean; existing?: sync.Existing
  /** A push of ComfyUI-Shared: which of SHARED_DIRS go up. Left out, the pod's own configuration decides (else the Default Configuration's `sync_shared`); the app's confirmation sends the choice shown. Anything else in the folder always goes. */
  shared?: string[]
  /** Folders or files this push leaves out, for this run (rsync patterns relative to each step's local root: `/X/` the top-level folder, `X/` folders anywhere, `X` anything named X); added to the configuration's `sync_exclude`. Only ever removes things from a push. */
  exclude?: string[]
  /** A push with exclusions also REMOVES, before copying, what the patterns match on the volume (a targeted, guarded removal: never rsync --delete-excluded). Default: the configuration's `sync_exclude_delete`. Needs `approved_by` when anything would be removed. Not for a pull or a files list. */
  delete_excluded?: boolean
  /** Only these files (docs/ADR-046): paths relative to the local ComfyUI-Shared root (`output/proxy_v004/a.dpx`), each inside the root (no `..`, not absolute, in one of SHARED_DIRS).
   *  Over SSH they become rsync `--files-from`, over the S3 transport one `aws s3 cp` each. Additive, never deletes, never the project tree or plates; with `paths`, a pull's `only` and a push's `plates` are ignored. */
  paths?: string[]
  /** A pull with `paths`: the files' sizes on the volume. A file already here with that size is skipped (the S3 copy has no other way to tell). */
  path_sizes?: Record<string, number>
  /** Who started it, for the History (ADR-046): 'auto-sync:output' | 'auto-sync:feed' | 'auto-sync:reconcile' | 'auto-sync:push'; left out for a person's Sync */
  trigger?: string
  /** Words the caller adds to the History entry (e.g. the conflicts it skipped) */
  note?: string
}
export interface SyncEvent {
  kind: 'plan' | 'listing' | 'totals' | 'step' | 'line' | 'file' | 'progress' | 'problem' | 'warning' | 'delete' | 'step-done' | 'done' | 'error'
  key?: string; local?: string; remote?: string; text?: string; /** a step's exit code; on a warning `skipped`, on an error `volume_full`, `disk_full` or `over_capacity` */ code?: number | string; steps?: sync.Step[]; path?: string
  streams?: number                              // step: how many copies run at once for a `paths` sync (sync_parallel, or fewer files)
  stream?: string                               // the top-level directory this line came from, when the folder went in streams
  /** totals (a push): the volume's size, its free space when the pod answered `df` (null: unknown), and whether the push cannot fit; error/done: `volume_full` or `disk_full` when a disk filled */
  /** delete: what is being removed from the volume (`state`: removing, removed, failed); totals: how much a removal frees */ state?: string; bytes?: number | null; would_delete_bytes?: number | null
  capacity_bytes?: number | null; free_bytes?: number | null; over_capacity?: boolean; /** warning `symlink`: where the link points */ target?: string; /** warning: why a step was skipped; error: the steps not started or unfinished */ reason?: string; not_done?: string[]
  total_files?: number; total_bytes?: number   // step: that folder's, from the listing; totals: the run's; line: openrsync's own count
  file_percent?: number; bytes_done?: number; run_bytes_done?: number; rate_bps?: number; eta_s?: number   // progress
}
export interface SyncResult { steps: number; failed: number; warned: number; cancelled: boolean; /** `volume_full` (a push) or `disk_full` (a pull on this PC) when a disk filled, with the message */ code?: string; message?: string }
export interface Counts { /** a push's room (docs/ADR-011): the volume's size and free space (null: unknown) and whether this much cannot fit */ capacity_bytes?: number | null; free_bytes?: number | null; over_capacity?: boolean; total_files?: number; total_bytes?: number; scanned_files?: number /* every file in scope, sent or not: the difference is what was skipped */ }
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

/** The volume this pod's sync reaches, for the journal: its own configuration's, else the Default Configuration's network or Shared volume. */
/** The pod's volume: its own saved configuration, else the volume last seen while it ran (a STOPPED pod has none in the RunPod API), else the Default Configuration's. */
export const volumeIdFor = (podId: string): string => { const own = podconfigs.get(podId)?.network_volume_id, d = mounts.load(); return (own || podvolume.recall(podId) || d.network_volume_id || d.shared_volume_id || '').trim() }

export const DEFAULT_PARALLEL = 8, MAX_PARALLEL = 32
/** How many files are copied at once for a `paths` sync (and the auto pull): the pod's own configuration's sync_parallel, else the Default Configuration's, else 8; clamped 1..32. */
export function parallelFor(podId: string): number {
  const own = podconfigs.get(podId)?.sync_parallel, def = mounts.load().sync_parallel
  const n = [own, def].find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 1)
  return Math.max(1, Math.min(MAX_PARALLEL, Math.floor((n as number | undefined) ?? DEFAULT_PARALLEL)))
}
/** A list split into at most n contiguous chunks of about the same size. */
export const chunksOf = <T>(items: T[], n: number): T[][] => { const size = Math.max(1, Math.ceil(items.length / Math.max(1, n))), out: T[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out }
export const MAX_PATHS = 50_000
/** The `paths` of a request, checked: a list of files relative to the local ComfyUI-Shared root, each inside it. Files the sync never carries (OS litter, git, caches) are dropped. Throws on anything else. */
export function validatePaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || !paths.length) throw bad('paths is a list of files relative to ComfyUI-Shared')
  if (paths.length > MAX_PATHS) throw bad(`At most ${MAX_PATHS} paths in one sync`)
  const out = new Set<string>()
  for (const p of paths) {
    if (typeof p !== 'string' || !p || p.length > 1024) throw bad(`Not a path inside ComfyUI-Shared: ${String(p).slice(0, 80)}`)
    // eslint-disable-next-line no-control-regex
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.includes('\\') || /[\u0000-\u001f]/.test(p) || p.endsWith('/') || p.split('/').some((x) => x === '..' || x === '.' || x === '')) throw bad(`Not a path inside ComfyUI-Shared: ${p.slice(0, 80)}`)
    const top = p.split('/')[0]
    if (!(SHARED_DIRS as readonly string[]).includes(top) || p === top) throw bad(`${p.slice(0, 80)} is not in a ComfyUI-Shared folder a sync carries (${SHARED_DIRS.join(', ')})`)
    if (p.split('/').some((seg) => excluded(seg))) continue
    out.add(p)
  }
  if (!out.size) throw bad('Nothing to copy: every path is a file a sync never carries')
  return [...out].sort()
}

/** The ComfyUI-Shared subfolders this pod's pushes carry: the request's choice, else the pod's own configuration, else the default. */
export const effectiveShared = (req: Pick<SyncRequest, 'pod_id' | 'shared'>): string[] => req.shared ?? configFor(req.pod_id).sync_shared ?? [...mounts.SYNC_SHARED_DEFAULT]
/** The request with that choice filled in, so the plan, the counts and the run agree. */
const resolved = (req: SyncRequest): SyncRequest => {
  if (req.exclude !== undefined) mounts.validateExcludes(req.exclude, 'exclude')
  if (req.delete_excluded === true && (req.direction !== 'push' || req.paths)) throw bad('Removing excluded folders from the volume is only for a push of folders (not a pull, not a files list)')
  const withPaths = req.paths === undefined ? req : { ...req, paths: validatePaths(req.paths) }
  return withPaths.direction === 'push' ? { ...withPaths, shared: withPaths.paths ? withPaths.shared ?? [...SHARED_DIRS] : effectiveShared(withPaths) } : withPaths
}
/** The folder of ComfyUI-Shared a step carries a `paths` file under ('' for the push of the whole root), and the file relative to the step. */
const stepDir = (req: SyncRequest, step: sync.Step): string => (req.direction === 'push' ? '' : step.key === 'output' ? 'output' : step.key.replace(/^shared\//, ''))
export const stepPaths = (req: SyncRequest, step: sync.Step): string[] => { const d = stepDir(req, step); return (req.paths ?? []).filter((p) => !d || p.startsWith(`${d}/`)).map((p) => (d ? p.slice(d.length + 1) : p)) }

/** What a run would copy, without running it (the confirmation shows this). */
export function planFor(request: SyncRequest, warn: (msg: string) => void = () => {}): sync.Step[] {
  const req = resolved(request)
  const cfg = configFor(req.pod_id)
  const only = new Set(req.only || [])
  if (req.paths) {   // a files filter touches ComfyUI-Shared only: never the project tree, the plates or the repo's workflows
    if (req.direction === 'pull') return sync.pullPlan(cfg, [], new Set()).filter((s) => stepPaths(req, s).length)
    return sync.plan(cfg, new Set(['comfy-shared']), false).filter((s) => s.key === 'comfy-shared')
  }
  if (req.direction === 'pull') return sync.pullPlan(cfg, sync.listShots(cfg.folders.project || ''), only)
  if (req.plates && !req.approved_by?.trim()) throw bad('Plates leaving this PC need a named yes: give approved_by (shared/governance/policy/agent-permissions.md)')
  const steps = sync.plan(cfg, only, !!req.plates, warn)
  // the graphs step puts the repo's workflows into ComfyUI-Shared/workflows: unchecked, it goes too
  return req.shared && !req.shared.includes('workflows') ? steps.filter((s) => s.key !== 'workflows') : steps
}
/** The excludes a step takes beyond sync.EXCLUDE, on a push: the shots' renders (project, with skip_renders: `NAME/`, at any depth) and the
 *  ComfyUI-Shared subfolders that were not chosen (`/NAME/`, a leading slash: the top level of that folder only, so an `output` folder deeper down is not touched). */
/** The patterns a push leaves out: the pod's own `sync_exclude` (else the Default Configuration's) UNION the request's `exclude`. */
/** Per-folder defaults for ONE step: the pod's own map replaces the Default's per key; a key the pod lacks falls back to the Default's; an empty list in the pod clears that key for the pod. */
export const folderExcludesFor = (podId: string, stepKey: string): string[] => { const own = podconfigs.get(podId)?.folder_excludes; return (own && stepKey in own ? own[stepKey] : mounts.load().folder_excludes?.[stepKey]) ?? [] }
/** The patterns ONE step of a push leaves out, relative to THAT step's root: the global list (pod's else Default's) UNION this step's per-folder list UNION the request's. A pattern saved for project never reaches comfy-shared. */
export const effectiveExcludesFor = (req: Pick<SyncRequest, 'pod_id' | 'exclude'>, stepKey: string): string[] => [...new Set([...effectiveExcludes(req), ...folderExcludesFor(req.pod_id, stepKey)])]
/** Every pattern in play for a push, across its steps (the History's count). */
export const allExcludes = (req: Pick<SyncRequest, 'pod_id' | 'exclude'>): string[] => [...new Set([...effectiveExcludes(req), ...mounts.FOLDER_EXCLUDE_KEYS.flatMap((k) => folderExcludesFor(req.pod_id, k))])]
export const effectiveExcludes = (req: Pick<SyncRequest, 'pod_id' | 'exclude'>): string[] => [...new Set([...(podconfigs.get(req.pod_id)?.sync_exclude ?? mounts.load().sync_exclude ?? []), ...mounts.validateExcludes(req.exclude, 'exclude')])]
/** Whether this push also removes what the patterns match on the volume: the request's choice, else the pod's own configuration, else the Default's. */
export const wantsDelete = (req: Pick<SyncRequest, 'pod_id' | 'delete_excluded' | 'direction' | 'paths'>): boolean => req.direction === 'push' && !req.paths && (req.delete_excluded ?? podconfigs.get(req.pod_id)?.sync_exclude_delete ?? mounts.load().sync_exclude_delete ?? false)
export const excludesFor = (req: SyncRequest, step: sync.Step, graphsViaOwnStep = false): string[] => {
  if (req.direction !== 'push') return []
  const out: string[] = []
  if (req.skip_renders && step.key === 'project') out.push(...RENDER_DIRS.map((d) => `${d}/`))
  if (req.skip_tests && step.key === 'project') out.push(`/${TEST_DIR}/`)
  if (step.key === 'comfy-shared') out.push(`/${SHARED_TEMP}/`)   // temp/ (staged Panama rounds, scratch) stays on this PC
  if (step.key === 'comfy-shared' && graphsViaOwnStep && !out.includes('/workflows/')) out.push('/workflows/')   // the graphs step already pushes that folder (from the mapped ComfyUI-Shared): not twice
  if (!req.paths) out.push(...effectiveExcludesFor(req, step.key))   // what the person leaves out of THIS step: the configuration's lists (global, this folder's) and this run's
  if (step.key === 'comfy-shared' && req.shared) out.push(...SHARED_DIRS.filter((d) => !req.shared!.includes(d)).map((d) => `/${d}/`))
  return [...new Set(out)]
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
  const sum = (k: 'total_files' | 'total_bytes' | 'scanned_files') => (list.length === expected && list.every((c) => c[k] !== undefined) ? list.reduce((a, c) => a + c[k]!, 0) : undefined)
  return { total_files: sum('total_files'), total_bytes: sum('total_bytes'), scanned_files: sum('scanned_files') }
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
export const excluded = (name: string) => sync.EXCLUDE.some((p) => new RegExp('^' + p.replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(name))
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
/** The simulated copy of a `paths` request: those files themselves. */
const simPathNames = (req: SyncRequest, step: sync.Step) => { const d = stepDir(req, step); return stepPaths(req, step).map((p) => (d ? `${d}/${p}` : p)) }
const simStatsOf = (names: string[]) => [`Number of files transferred: ${names.length}`, `Total transferred file size: ${names.length * SIM_FILE_BYTES} B`]
const withScanned = (c: Counts): Counts => ({ ...c, scanned_files: c.total_files })   // the simulated copy finds nothing already there
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
  const ro = req.existing && req.existing !== 'update' ? { ...o, existing: req.existing } : o   // SSH only: the S3 copy (aws s3 cp) has no such choice
  return req.direction === 'push' ? sync.rsyncCmd(local, transport.host!, transport.port!, remote, ro) : sync.rsyncPullCmd(transport.host!, transport.port!, remote, local, ro)
}

/** What a run would send, from the listing passes: all of it, and with the request's own skips (the renders, the test bucket) when the plan has the project. The confirmation shows the one the switches describe. */
export async function countFor(request: SyncRequest, client?: rp.RunPodClient, exec: Exec = runCommand): Promise<{ all: Counts; without_renders?: Counts; would_delete?: syncdelete.Match[]; would_delete_bytes?: number | null }> {
  const req = resolved(request)
  if (req.paths) return { all: { total_files: req.paths.length, ...(req.path_sizes ? { total_bytes: req.paths.reduce((a, p) => a + (req.path_sizes![p] ?? 0), 0) } : {}) } }
  let steps = planFor(req)
  const none = { capacity: null, free: null }
  if (req.direction === 'push' && !mounts.dryRun(mounts.load())) steps = (await Promise.all(steps.map(async (st) => ((await isDirAsync(st.local)) ? st : null)))).filter((x): x is sync.Step => !!x)   // as the run does: a missing local folder is skipped
  const gv = steps.some((st) => st.key === 'workflows' && st.source === 'shared')
  const project = req.direction === 'push' && steps.some((s) => s.key === 'project')
  if (mounts.dryRun(mounts.load())) {
    const all = sumCounts(steps.map((s, n) => withScanned(parseStats(simStats(n, excludesFor({ ...req, skip_renders: false, skip_tests: false }, s, gv))))), steps.length)
    return { all: withRoom(all, none), ...(wantsDelete(req) ? { would_delete: [] as syncdelete.Match[], would_delete_bytes: 0 } : {}), without_renders: project ? withRoom(sumCounts(steps.map((s, n) => withScanned(parseStats(simStats(n, excludesFor(req, s, gv))))), steps.length), none) : undefined }
  }
  const transport = await transportFor(req.pod_id, client)
  const mountPath = configFor(req.pod_id).mount_path || '/workspace'
  const wd = await plannedDeletes(req, steps, transport, mountPath, exec, new AbortController().signal, transport.kind === 's3' ? { ...process.env, ...sync.s3Env(settings.lookup) } : process.env).catch((e) => { if (e instanceof CoreError) throw e; return { items: [] as syncdelete.Match[], bytes: 0 } })
  const dw = wantsDelete(req) ? { would_delete: wd.items, would_delete_bytes: wd.bytes } : {}
  if (transport.kind !== 'ssh') return { all: withRoom({}, none), ...dw }
  const progress = sync.progressFlag(await rsyncVersion())   // openrsync refuses --info=progress2 even on a dry run
  const signal = new AbortController().signal
  // what would be sent, and (a second pass that counts every file in scope, as if all were to be replaced) what is already there
  const list = async (step: sync.Step, exclude: string[]) => {
    const o = { progress, verbose: true, dryRun: true, stats: true, exclude }
    const sent = await listStep(commandFor(req, transport, step, mountPath, o), signal, process.env, exec)
    if (req.existing === 'replace' || transport.kind !== 'ssh') return { ...sent, scanned_files: sent.total_files }
    const scope = await listStep(commandFor({ ...req, existing: 'replace' }, transport, step, mountPath, o), signal, process.env, exec).catch(() => ({} as Counts))
    return { ...sent, scanned_files: scope.total_files }
  }
  const counts: Counts[] = []
  for (const step of steps) counts.push(await list(step, excludesFor({ ...req, skip_renders: false, skip_tests: false }, step, gv)))
  const all = sumCounts(counts, steps.length), room = await roomFor(req, transport, mountPath, client, exec)   // the room is looked up once; over_capacity is worked out for each variant
  if (!project) return { all: withRoom(all, room, wd.bytes ?? 0), ...dw }
  const without = await Promise.all(steps.map((step, i) => (step.key === 'project' ? list(step, excludesFor(req, step, gv)) : Promise.resolve(counts[i]))))
  return { all: withRoom(all, room, wd.bytes ?? 0), without_renders: withRoom(sumCounts(without, steps.length), room, wd.bytes ?? 0), ...dw }
}

/** Disk-full lines of rsync, aws and ssh: a volume quota, a full disk. One of them stops the whole run (docs/ADR-011, amendment 2026-11-18). */
export const FULL_RE = /Disk quota exceeded|No space left on device|ENOSPC/i
const fmtBytes = (b: number) => (b >= 1e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= 1e9 ? `${Math.round(b / 1e9).toLocaleString('en-US')} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.round(b / 1e3)} KB`)
const isDirAsync = async (p: string) => { try { return (await stat(p)).isDirectory() } catch { return false } }
/** The volume's size in bytes from RunPod's record (GB as RunPod counts them), or null. Async, best effort. */
async function volumeCapacity(podId: string, client?: rp.RunPodClient): Promise<number | null> {
  try { const vid = volumeIdFor(podId); if (!vid) return null; const v = await Promise.race([volumeInfo(vid, client), new Promise<null>((r) => { const t = setTimeout(() => r(null), 10_000); if (typeof t === 'object' && 'unref' in t) t.unref() })]); return v && v.size_gb > 0 ? v.size_gb * 1e9 : null } catch { return null }
}
/** The real free space where the volume is mounted on the pod: `df -Pk` over SSH, 10 seconds at most, best effort (null when it does not answer). */
async function dfFree(t: { host?: string; port?: number }, mountPath: string, exec: Exec): Promise<number | null> {
  if (!t.host || !t.port) return null
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 10_000), lines: string[] = []
  try {
    const code = await exec(['ssh', '-p', String(t.port), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', t.host, `df -Pk '${mountPath.replace(/'/g, `'\\''`)}'`], (l) => lines.push(l), ac.signal, process.env)
    if (code !== 0) return null
    const row = lines.map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 6 && /^\d+$/.test(f[3])).pop()
    return row ? Number(row[3]) * 1024 : null
  } catch { return null } finally { clearTimeout(timer) }
}

export const MAX_LINK_WARNINGS = 50
/** The links a push meets, without walking: a step's root that is itself a link (FOLLOWED: it is the folder the person chose, its contents are sent) and every TOP-LEVEL entry that is a link to a folder (copied as a link by rsync, skipped on the S3 route). One warning each, at most 50 and then "and N more". Cheap (one readdir per root), async, best effort. */
export async function symlinkWarnings(steps: sync.Step[], s3: boolean): Promise<SyncEvent[]> {
  const out: SyncEvent[] = []; let extra = 0
  const add = (e: SyncEvent) => { if (out.length < MAX_LINK_WARNINGS) out.push(e); else extra++ }
  for (const st of steps) {
    const root = st.local.replace(/\/+$/, '')
    try { if ((await lstat(root)).isSymbolicLink()) { const target = await readlink(root); add({ kind: 'warning', code: 'symlink', key: st.key, path: '', target, text: `${st.key}: ${root} is a link to ${target}: its contents are sent, because it is the folder you chose` }) } } catch { /* not a link */ }
    let entries: import('node:fs').Dirent[] = []
    try { entries = await readdir(root, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (!e.isSymbolicLink()) continue
      try { if (!(await stat(join(root, e.name))).isDirectory()) continue } catch { continue }   // a link to a file or to nowhere is not a folder link
      const target = await readlink(join(root, e.name)).catch(() => '?')
      add({ kind: 'warning', code: 'symlink', key: st.key, path: e.name, target, text: `${e.name} is a link to ${target}: it is copied as a link, not its contents${s3 ? ' (skipped on the S3 route)' : ''}` })
    }
  }
  if (extra) out.push({ kind: 'warning', code: 'symlink', text: `and ${extra} more link${extra === 1 ? '' : 's'}` })
  return out
}

/** The volume's room for a push: its size and the real free space (best effort, null when unknown). Nothing for a pull, a paths run, a simulated run or the S3 transport (no pod to ask). */
async function roomFor(req: SyncRequest, transport: Transport, mountPath: string, client: rp.RunPodClient | undefined, exec: Exec): Promise<{ capacity: number | null; free: number | null }> {
  if (req.direction !== 'push' || req.paths || mounts.dryRun(mounts.load()) || transport.kind !== 'ssh') return { capacity: null, free: null }
  const [capacity, free] = await Promise.all([volumeCapacity(req.pod_id, client), dfFree(transport, mountPath, exec)])
  return { capacity, free }
}
const withRoom = (c: Counts, room: { capacity: number | null; free: number | null }, freed = 0): Counts => { const r = room.free !== null ? room.free + freed : room.capacity; return { ...c, capacity_bytes: room.capacity, free_bytes: room.free, over_capacity: r !== null && c.total_bytes !== undefined && c.total_bytes > r } }
/** What a push with `delete_excluded` would remove from the volume (docs/ADR-011), with sizes: per matched top folder `{ step, path, bytes, files }` and the bytes it frees (null when none could be measured). Empty when it is not asked for. */
async function plannedDeletes(req: SyncRequest, steps: sync.Step[], transport: Transport, mountPath: string, exec: Exec, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env): Promise<{ items: syncdelete.Match[]; bytes: number | null }> {
  const none = { items: [] as syncdelete.Match[], bytes: 0 }
  if (!wantsDelete(req) || mounts.dryRun(mounts.load()) || transport.kind === 'none') return none
  if (!steps.some((st) => effectiveExcludesFor(req, st.key).length)) return none
  const target: syncdelete.Target = transport.kind === 'ssh' ? { kind: 'ssh', host: transport.host, port: transport.port } : { kind: 's3', volume: transport.volume, env }
  const found = await syncdelete.resolve({ exec, target, roots: steps.map((st) => ({ key: st.key, remote: st.remote })), patterns: (k) => effectiveExcludesFor(req, k), signal, mountPath })
  const seen = new Set<string>(), uniq = found.filter((m) => !seen.has(m.abs) && !!seen.add(m.abs))   // the graphs step's folder lies inside comfy-shared: once
  if (!uniq.length) return none
  const items = await syncdelete.measure({ exec, target, matches: uniq, signal, mountPath })
  const known = items.filter((m) => m.bytes !== null)
  return { items, bytes: known.length ? known.reduce((a, m) => a + (m.bytes ?? 0), 0) : null }
}

async function runSync(request: SyncRequest, send0: (e: SyncEvent) => void, outer: AbortSignal, client?: rp.RunPodClient, exec: Exec = runCommand): Promise<SyncResult> {
  const req = resolved(request)
  let written = 0
  const send = (e: SyncEvent) => { if (e.kind === 'file') written++; send0(e) }
  // one controller for the run: the person's cancel, and a full disk, both stop every stream at once
  const runAc = new AbortController()
  if (outer.aborted) runAc.abort(); else outer.addEventListener('abort', () => runAc.abort(), { once: true })
  const signal = runAc.signal
  const full: { hit: boolean; line: string } = { hit: false, line: '' }
  const watch = (text: string) => { if (!full.hit) { const m = FULL_RE.exec(text); if (m) { full.hit = true; full.line = m[0]; runAc.abort() } } }
  const warnings: string[] = []
  const planned = planFor(req, (m) => warnings.push(m))
  send({ kind: 'plan', steps: planned })
  for (const w of warnings) { const key = /^skip (\S+?):/.exec(w)?.[1] ?? (/workflows/i.test(w) ? 'workflows' : undefined); send({ kind: 'warning', code: 'skipped', ...(key ? { key } : {}), reason: w, text: w }) }
  let steps = req.direction === 'push' && !req.paths ? sync.orderForRun(planned) : planned   // the RUN order of a push: graphs, ComfyUI-Shared, project, plates (the panel keeps its own order)
  if (!steps.length) throw bad('Nothing to copy: map the folders in Default Configuration first')
  const cfg = configFor(req.pod_id)
  const dry = mounts.dryRun(mounts.load())
  if (req.direction === 'push' && !req.paths && !dry) {   // a step whose local folder is not there is skipped with a word, never a failed run
    const keep: sync.Step[] = []
    for (const st of steps) { if (await isDirAsync(st.local)) keep.push(st); else send({ kind: 'warning', code: 'skipped', key: st.key, reason: `${st.local} does not exist on this PC`, text: `Skipped ${st.key}: ${st.local} does not exist on this PC` }) }
    steps = keep
    if (!steps.length) throw bad('Nothing to copy: none of the chosen folders exists on this PC')
  }
  const finishedKeys = new Set<string>()
  const simN = (st: sync.Step) => Math.max(0, planned.findIndex((p) => p.key === st.key))   // the simulated files follow the panel's order, whatever the run order
  const graphsViaOwnStep = steps.some((st) => st.key === 'workflows' && st.source === 'shared')
  const result: SyncResult = { steps: steps.length, failed: 0, warned: 0, cancelled: false }
  const transport = await transportFor(req.pod_id, client)
  if (transport.kind === 'none') throw bad(transport.reason)
  send({ kind: 'line', text: `Copying ${transport.reason}` })
  if (req.direction === 'push' && !req.paths && !dry) for (const w of await symlinkWarnings(steps, transport.kind === 's3')) send(w)
  const mountPath = cfg.mount_path || '/workspace'
  const progress = dry || transport.kind !== 'ssh' ? '--progress' : sync.progressFlag(await rsyncVersion())
  const env = transport.kind === 's3' ? { ...process.env, ...sync.s3Env(settings.lookup) } : process.env
  const parallel = req.paths ? parallelFor(req.pod_id) : Math.max(1, cfg.sync_parallel || 1)
  const held = idle.entry(req.pod_id)?.minutes
  if (held) idle.register(req.pod_id, 0)   // not stopped mid-copy; restored below
  let listDir: string | undefined
  /** A list of relative paths for rsync's --files-from, written with fs.promises (a list can be tens of thousands of lines). */
  const writeList = async (name: string, list: string[]): Promise<string> => {
    listDir ??= await mkdtemp(join(tmpdir(), 'syncpaths-'))
    const file = join(listDir, `${name.replace(/\W/g, '_')}.txt`)
    await writeFile(file, list.join('\n') + '\n', { mode: 0o600 })
    return file
  }
  const filesFromFor = async (step: sync.Step): Promise<string | undefined> => (!req.paths || transport.kind !== 'ssh' || dry ? undefined : writeList(step.key, stepPaths(req, step)))
  try {
    // Every folder listed first, so the run's total is known before the first byte moves.
    const totals: Counts[] = []
    for (const [n, step] of steps.entries()) {
      if (signal.aborted) break
      send({ kind: 'listing', key: step.key })
      const exclude = excludesFor(req, step, graphsViaOwnStep)
      if (dry) totals.push(parseStats(req.paths ? simStatsOf(simPathNames(req, step)) : simStats(simN(step), exclude)))
      else if (transport.kind === 'ssh') totals.push(await listStep(commandFor(req, transport, step, mountPath, { progress, verbose: true, dryRun: true, stats: true, exclude, filesFrom: await filesFromFor(step) }), signal, env, exec))
      else if (req.paths) { const ps = stepPaths(req, step), d = stepDir(req, step); totals.push({ total_files: ps.length, ...(req.path_sizes ? { total_bytes: ps.reduce((a, p) => a + (req.path_sizes![d ? `${d}/${p}` : p] ?? 0), 0) } : {}) }) }
      else totals.push({})   // aws s3 sync has no cheap count
    }
    const sums = sumCounts(totals, steps.length)
    const meter = new RunMeter(); meter.total = sums.total_bytes
    // what a push with delete_excluded would remove from the volume: listed and measured first, so the free space AFTER the removal counts below, and the named yes is checked before anything moves
    const del = signal.aborted ? { items: [] as syncdelete.Match[], bytes: 0 } : await plannedDeletes(req, steps, transport, mountPath, exec, signal, env)
    if (del.items.length && !(req.approved_by ?? '').trim()) throw bad(syncdelete.NEEDS_YES)
    // PREFLIGHT before any byte moves: a push that cannot fit the volume is refused with the sizes (no override: fix the selection or the volume)
    let preflight: Pick<SyncEvent, 'capacity_bytes' | 'free_bytes' | 'over_capacity'> = {}, tooBig = ''
    if (req.direction === 'push' && !req.paths && !dry && transport.kind === 'ssh' && sums.total_bytes !== undefined && !signal.aborted) {
      const { capacity, free } = await roomFor(req, transport, mountPath, client, exec), room = free !== null ? free + (del.bytes ?? 0) : capacity
      const over = room !== null && sums.total_bytes > room
      preflight = { capacity_bytes: capacity, free_bytes: free, over_capacity: over }
      if (over) tooBig = `This push would send ${fmtBytes(sums.total_bytes)}; the volume is ${capacity ? `${Math.round(capacity / 1e9).toLocaleString('en-US')} GB` : 'too small'}${free !== null ? ` (about ${fmtBytes(free)} free)` : ''}. Nothing was copied. By step: ${steps.map((st, n) => `${st.key} ${fmtBytes(totals[n]?.total_bytes ?? 0)}`).join(', ')}. Push only the graphs (untick the project), or enlarge the volume.`
      else if (room !== null && capacity && room - sums.total_bytes < 0.05 * capacity) send({ kind: 'warning', text: `This push fits but leaves under 5% of the volume free (${fmtBytes(room - sums.total_bytes)} of ${fmtBytes(capacity)}).` })
    }
    send({ kind: 'totals', ...sums, ...preflight, ...(del.items.length ? { would_delete_bytes: del.bytes } : {}) })
    if (tooBig) { send({ kind: 'error', text: tooBig, code: 'over_capacity', not_done: steps.map((st) => st.key) }); throw new CoreError(400, tooBig, 'over_capacity') }
    // the removal, before any copy: one folder at a time; a failure stops the run here and says what was already removed
    const removed: string[] = []
    for (const m of del.items) {
      if (signal.aborted) break
      const root = steps.find((st) => st.key === m.step)!
      send({ kind: 'delete', key: m.step, path: m.path, bytes: m.bytes, state: 'removing', text: `Removing ${m.path} from the volume (${m.step})` })
      try { await syncdelete.removeOne({ exec, target: transport.kind === 'ssh' ? { kind: 'ssh', host: transport.host, port: transport.port } : { kind: 's3', volume: transport.volume, env }, root: { key: root.key, remote: root.remote }, match: m, signal, mountPath }); removed.push(`${m.step}/${m.path}`); send({ kind: 'delete', key: m.step, path: m.path, bytes: m.bytes, state: 'removed', text: `Removed ${m.path}` }) }
      catch (e) { send({ kind: 'delete', key: m.step, path: m.path, state: 'failed', text: (e as Error).message }); throw bad(`Removal failed at ${m.path} (${m.step}): ${(e as Error).message}. Removed before it: ${removed.length ? removed.join(', ') : 'nothing'}. Nothing was copied.`) }
    }
    for (const [n, step] of steps.entries()) {
      if (signal.aborted) { result.cancelled = !full.hit; break }
      const exclude = excludesFor(req, step, graphsViaOwnStep)
      send({ kind: 'step', key: step.key, local: step.local, remote: step.remote, ...totals[n], ...(req.paths ? { streams: Math.max(1, Math.min(parallel, stepPaths(req, step).length)) } : {}) })
      const tally = new StepTally(step.key, meter, send)
      const codes: number[] = []
      if (dry) {
        send({ kind: 'line', key: step.key, text: `simulated: ${step.local} -> ${step.remote} (no-spend mode: nothing is copied)` })
        const byDir = new Map<string, string[]>()
        for (const f of req.paths ? simPathNames(req, step) : simNames(simN(step), exclude)) { const d = f.split('/')[0]; byDir.set(d, [...(byDir.get(d) || []), f]) }
        await pool([...byDir.entries()], parallel, async ([dir, names]) => {
          const s = tally.stream(dir)
          for (const line of simLines(names)) { await simPause(); if (signal.aborted) break; s.line(line) }
          s.finish(); codes.push(0)
        })
      } else if (req.paths && transport.kind === 's3') {
        // the paths filter over the S3 transport: one `aws s3 cp` per file, up to sync_parallel at a time; a file already here with the size the volume has is skipped
        const d = stepDir(req, step)
        const all = stepPaths(req, step), todo: string[] = []
        for (let i = 0; i < all.length; i += 500) {   // stat in chunks, off the event loop
          const part = all.slice(i, i + 500)
          const need = await Promise.all(part.map(async (rel) => { if (req.direction !== 'pull') return true; const want = req.path_sizes?.[d ? `${d}/${rel}` : rel]; if (want === undefined) return true; try { return (await stat(`${step.local}${rel}`)).size !== want } catch { return true } }))
          part.forEach((rel, j) => { if (need[j]) todo.push(rel) })
        }
        await pool(todo.map((rel, k) => ({ rel, k })), parallel, async ({ rel, k }) => {
          if (signal.aborted) return
          const cmd = sync.s3FileCmd(req.direction, transport.volume!, step.remote, step.local, rel, { mountPath })
          send({ kind: 'line', key: step.key, text: '$ ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ') })
          const s = tally.stream(`k${k}`)
          codes.push(await exec(cmd, (text) => { watch(text); s.line(text) }, signal, env))
          s.finish()
        })
      } else if (req.paths && transport.kind === 'ssh') {
        // the paths filter over SSH: the list split into up to sync_parallel chunks, each its own rsync with its own --files-from, all at once
        const chunks = chunksOf(stepPaths(req, step), parallel)
        await pool(chunks.map((list, k) => ({ list, k })), parallel, async ({ list, k }) => {
          if (signal.aborted) return
          const filesFrom = await writeList(`${step.key}-${k}`, list)
          const cmd = commandFor(req, transport, step, mountPath, { progress, verbose: true, exclude, filesFrom })
          send({ kind: 'line', key: step.key, stream: `p${k}`, text: '$ ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ') })
          const s = tally.stream(`p${k}`)
          codes.push(await exec(cmd, (text) => { watch(text); s.line(text) }, signal, env))
          s.finish()
        })
      } else {
        const streams = req.direction === 'push' && transport.kind === 'ssh' && !req.paths ? streamsOf(step.local, step.remote, exclude) : [{ name: '.', local: step.local, remote: step.remote, shallow: false } as Stream]
        const one = async (u: Stream) => {
          if (signal.aborted) return
          const cmd = commandFor(req, transport, step, mountPath, { progress, verbose: true, exclude: u.name === '.' ? exclude : exclude.filter((e) => !e.startsWith('/')), shallow: u.shallow }, u.local, u.remote)
          send({ kind: 'line', key: step.key, stream: u.name === '.' ? undefined : u.name, text: '$ ' + cmd.map((c) => (/\s/.test(c) ? JSON.stringify(c) : c)).join(' ') })
          const s = tally.stream(u.name)
          codes.push(await exec(cmd, (text) => { watch(text); s.line(text) }, signal, env))
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
      if (!full.hit && !signal.aborted) finishedKeys.add(step.key)
      if (signal.aborted) { result.cancelled = !full.hit; break }
    }
  } finally {
    if (held) idle.register(req.pod_id, held)
    if (listDir) await rm(listDir, { recursive: true, force: true }).catch(() => undefined)
  }
  if (full.hit) {   // a full disk stops everything: say what was written and what was not done
    const push = req.direction === 'push', undone = steps.filter((st) => !finishedKeys.has(st.key)).map((st) => st.key)
    result.cancelled = false; result.failed = Math.max(1, result.failed); result.code = push ? 'volume_full' : 'disk_full'
    result.message = `${push ? `The volume is full (${full.line})` : `The disk on this PC is full (${full.line})`}. ${written} file${written === 1 ? ' was' : 's were'} written. Not done: ${undone.length ? undone.join(', ') : 'nothing more'}. ${push ? 'Free space or enlarge the volume' : 'Free space on this PC'}, then run again.`
    send({ kind: 'error', text: result.message, code: result.code, not_done: undone })
  }
  send({ kind: 'done', text: result.message ?? (result.cancelled ? 'cancelled' : result.failed ? `${result.failed} of ${result.steps} folders failed` : result.warned ? `${result.steps} folders in step, ${result.warned} with warnings` : `${result.steps} folders in step`) })
  return result
}

/** A sync run, recorded in the history when it ends (done, failed or cancelled). */
export async function run(request: SyncRequest, send: (e: SyncEvent) => void, signal: AbortSignal, client?: rp.RunPodClient, exec: Exec = runCommand): Promise<SyncResult> {
  const started = new Date().toISOString()
  const auto = !!request.trigger?.startsWith('auto-sync')
  const what = auto ? `auto sync ${request.direction} ${request.pod_id ?? ''}`.trim() : `sync ${request.pod_id ?? ''}`.trim()
  let streams = 0, moved = 0, movedBytes = 0
  const deleted: { path: string; bytes: number }[] = []
  const reg = registry.begin(request)   // the sync explorer and its logs (syncruns.ts): additive, it never changes the events or the History entry
  const seen = (e: SyncEvent) => { if (e.kind === 'step' && e.streams) streams = Math.max(streams, e.streams); else if (e.kind === 'file') moved++; else if (e.kind === 'progress' && e.run_bytes_done !== undefined) movedBytes = Math.max(movedBytes, e.run_bytes_done); else if (e.kind === 'delete' && e.state === 'removed') deleted.push({ path: `${e.key}/${e.path}`, bytes: Number(e.bytes ?? 0) }); reg.event(e); send(e) }
  // visible to the other processes while it runs (the Queue shows an MCP-started sync), and cancellable from them
  const ac = new AbortController(), fwd = () => ac.abort(); if (signal.aborted) ac.abort(); else signal.addEventListener('abort', fwd, { once: true })
  const who = history.currentOrigin(), origin: jobsregistry.Origin = auto ? 'auto-publish' : who?.source === 'mcp' ? 'mcp' : 'window'
  const stopTrack = jobsregistry.track({ id: `sync-${request.pod_id ?? 'local'}-${Date.parse(started).toString(36)}`, kind: 'sync', trigger: request.trigger ?? 'manual', origin: origin === 'auto-publish' ? 'script' : origin, ...(origin === 'mcp' && who?.client ? { client: who.client } : {}), label: what, started_at: started, view: () => ({ state: 'syncing' }), cancel: () => ac.abort() })
  try {
    const r = await runSync(request, seen, ac.signal, client, exec); stopTrack(); signal.removeEventListener('abort', fwd)
    reg.end(r, r.message)
    if (request.direction === 'push' && !r.cancelled && !r.failed) journalPush(request)
    // ONE entry per run (a `paths` run is one run, however many files). An automatic run that moved nothing records nothing (no noise).
    if (!(auto && !r.failed && !r.cancelled && moved === 0)) history.record({ kind: 'job', job: 'sync', state: r.cancelled ? 'cancelled' : r.failed ? 'failed' : 'done', started_at: started, what, pod_id: request.pod_id, ...(request.trigger ? { trigger: request.trigger } : {}), ...(request.paths ? runCounts(request, streams) : leftOut(request, deleted)), ...(deleted.length ? { approved_by: (request.approved_by ?? '').trim() } : {}), ...(r.code ? { files: moved, bytes: movedBytes } : {}), ...(r.failed ? { error: r.message ?? `${r.failed} of ${r.steps} folders failed` } : {}) })
    return r
  } catch (e) {
    stopTrack(); signal.removeEventListener('abort', fwd)
    reg.end(null, (e as Error).message)
    history.record({ kind: 'job', job: 'sync', state: 'failed', started_at: started, what, pod_id: request.pod_id, ...(request.trigger ? { trigger: request.trigger } : {}), ...(request.paths ? { files: request.paths.length } : leftOut(request, deleted)), ...(deleted.length ? { approved_by: (request.approved_by ?? '').trim() } : {}), error: (e as Error).message })
    throw e
  }
}

/** A push that landed changed the volume: ONE batch event for what it carried (docs/ADR-046). Best effort, after the fact, never in the way. A pull changes only this PC, so it writes no event
 *  (the feed would echo our own pull back at us). Only ComfyUI-Shared reaches the journal; the project tree and plates are not part of it. */
function journalPush(request: SyncRequest): void {
  try {
    const vol = volumeIdFor(request.pod_id)
    if (!vol) return
    const req = resolved(request)
    const dirs = req.paths ? [...new Set(req.paths.map((p) => p.split('/')[0]))] : (req.shared ?? [])
    if (req.paths) { void journal.emit(vol, { writer: 'app:sync', op: 'batch', prefix: dirs.length === 1 ? `${dirs[0]}/` : undefined, paths: req.paths.slice(0, journal.MAX_PATHS), files: req.paths.length, bytes: req.paths.reduce((a, p) => a + (req.path_sizes?.[p] ?? 0), 0) || undefined }); return }
    for (const d of dirs) void journal.emit(vol, { writer: 'app:sync', op: 'batch', prefix: `${d}/` })
  } catch { /* the journal never fails a sync */ }
}

/** The counts of a `paths` run for its History entry: files, bytes and a detail that says what it did (the trigger, the streams used, the first paths, what the caller noted). */
function runCounts(req: SyncRequest, streams: number): { files: number; bytes?: number; detail: string } {
  const paths = req.paths ?? [], bytes = paths.reduce((a, p) => a + (req.path_sizes?.[p] ?? 0), 0)
  const first = paths.slice(0, 3).join(', ') + (paths.length > 3 ? ` (+${paths.length - 3} more)` : '')
  const size = bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : bytes ? `${Math.round(bytes / 1e3)} KB` : ''
  const label = req.trigger ? req.trigger.replace('auto-sync:', 'automatic, ') : 'files filter'
  return { files: paths.length, ...(bytes ? { bytes } : {}), detail: `${label}: ${paths.length} file${paths.length === 1 ? '' : 's'}${size ? ` (${size})` : ''}${streams ? `, ${streams} stream${streams === 1 ? '' : 's'}` : ''}; ${first}${req.note ? `; ${req.note}` : ''}` }
}

/** The History's words for the folders a push left out: how many, and the first few. */
function leftOut(req: SyncRequest, deleted: { path: string; bytes: number }[] = []): { detail?: string } {
  try {
    if (req.direction !== 'push') return {}
    const ex = allExcludes(req); if (!ex.length) return {}
    const out = `left out ${ex.length} pattern${ex.length === 1 ? '' : 's'}: ${ex.slice(0, 3).join(', ')}${ex.length > 3 ? ` (+${ex.length - 3} more)` : ''}`
    const gb = deleted.reduce((a, d) => a + d.bytes, 0), size = gb >= 1e12 ? `${(gb / 1e12).toFixed(1)} TB` : gb >= 1e9 ? `${Math.round(gb / 1e9)} GB` : gb >= 1e6 ? `${Math.round(gb / 1e6)} MB` : `${Math.round(gb / 1e3)} KB`
    return { detail: deleted.length ? `${out}; removed ${deleted.length} folder${deleted.length === 1 ? '' : 's'} from the volume${gb ? ` (${size})` : ''}: ${deleted.slice(0, 3).map((d) => d.path).join(', ')}${deleted.length > 3 ? ` (+${deleted.length - 3} more)` : ''}; approved by ${(req.approved_by ?? '').trim()}` : out }
  } catch { return {} }
}
