/**
 * Output sources (docs/ADR-045, the spirit of ADR-017's adapters, for a run's OUTPUT files): where the Outputs gallery gets its runs.
 *   pod-history  the running pod's own ComfyUI history (comfyruns.ts), unchanged
 *   saved        the record the app keeps past a stop (outputruns.ts), unchanged
 *   volume-s3    the files on the network volume under comfy-shared/output/, listed over RunPod's S3 API with no pod (read-only, no spend)
 * Every source answers with the same OutputRun shape, tagged with its `source`, and `address` says where its files are fetched from.
 * volume-s3 serves bytes through `s3file://<volume>/<key>` (electron/main.cjs): `guardS3FileUrl` and `signGet` here decide what may be read and
 * sign the read; the keys and the signature stay in the main process. Nothing here writes, renames or deletes on the volume.
 */
import { CoreError, bad } from './errors.js'
import * as comfyruns from './comfyruns.js'
import * as mounts from './mounts.js'
import * as outputruns from './outputruns.js'
import * as pods from './pods.js'
import * as podpull from './podpull.js'
import * as settings from './settings.js'
import * as volumeround from './volumeround.js'
import { signHeaders } from './s3presign.js'

export type SourceId = 'pod-history' | 'saved' | 'volume-s3'
export interface OutputFile { filename: string; subfolder: string; type: 'output' | 'temp'; bytes?: number; modified?: string }
export interface OutputRun {
  prompt_id: string; workflow: string | null; started_at: string | null; duration_s?: number | null; files: OutputFile[]
  source: SourceId
  /** volume-s3: the folder under output/ this run is (a frame sequence, a video folder) */
  folder?: string
}
export interface OutputCtx { pod_id?: string; volume_id?: string; shot?: string; round?: string }
export interface ListOpts extends volumeround.VolumeOpts { prefix?: string; /** volume-s3: the WHOLE comfy-shared/output/ tree in one recursive listing ("All outputs"), see listAll */ all?: boolean; /** with `all`: start the listing as a job and return `{ job_id }` (outputsJob / outputsStatus) */ job?: boolean; /** stops an `all` listing */ signal?: AbortSignal; /** `all`: how many lines the listing has produced so far */ onProgress?: (lines: number) => void }
export interface OutputListing { source: SourceId; runs: OutputRun[]; /** volume-s3: the folders under `prefix` (names) */ folders: string[]; /** `all`: false when the listing stopped counting at the hard limit (total is then a floor) */ total_exact?: boolean; /** volume-s3: per folder name, what a one-key probe found (`empty: true` is a shell with no files; absent when unknown). `folders` stays an array of names. */ folder_info?: Record<string, { empty?: boolean }>; /** volume-s3: the prefix listed, relative to output/ ('' = the root) */ prefix: string; capped: boolean; total: number; start_note?: string }
export interface OutputSource {
  id: SourceId; name: string; hint: string
  available(ctx: OutputCtx, opts?: ListOpts): Promise<{ ok: boolean; reason: string }>
  list(ctx: OutputCtx, opts?: ListOpts): Promise<OutputListing>
  /** The fetchable base for this source's files: a pod's https address, or `s3file://<volume>`; '' when none can serve them now. */
  address(file: OutputFile | null, ctx: OutputCtx, opts?: ListOpts): Promise<string>
}

export const OUTPUT_ROOT = 'comfy-shared/output'
export const MAX_OBJECTS = 3000
export const MAX_OBJECTS_ALL = 25_000, HARD_LIMIT = 200_000, ALL_CACHE_MS = 60_000
export const PRIORITY: SourceId[] = ['pod-history', 'saved', 'volume-s3']
const listing = (source: SourceId, runs: OutputRun[]): OutputListing => ({ source, runs, folders: [], prefix: '', capped: false, total: runs.length })
const when = (r: OutputRun) => r.started_at || ''

// ----- pod-history and saved: the two existing readers, wrapped -----

const runningBase = async (ctx: OutputCtx, opts: ListOpts): Promise<string> => {
  try {
    if (ctx.pod_id) { const p = await pods.get(ctx.pod_id, opts.client); if (p.status === 'running' && p.web_ui_url) return p.web_ui_url.replace(/\/$/, '') }
    if (ctx.volume_id) { const all = await pods.list(opts.client); return all.find((p) => p.status === 'running' && p.web_ui_url && p.volume_id === ctx.volume_id)?.web_ui_url?.replace(/\/$/, '') || '' }
  } catch { /* no pod answers: no base */ }
  return ''
}

export const podHistory: OutputSource = {
  id: 'pod-history', name: 'Pod history', hint: "The running pod's own ComfyUI history.",
  async available(ctx, opts = {}) {
    if (!ctx.pod_id) return { ok: false, reason: 'No pod named.' }
    try { const p = await pods.get(ctx.pod_id, opts.client); return p.status === 'running' && p.web_ui_url ? { ok: true, reason: '' } : { ok: false, reason: `Pod ${ctx.pod_id} is not running: start it to read its ComfyUI history.` } } catch (e) { return { ok: false, reason: (e as Error).message } }
  },
  async list(ctx, opts = {}) {
    if (!ctx.pod_id) throw bad('pod-history needs a pod_id')
    const runs = await comfyruns.runs(ctx.pod_id, opts.client)
    return listing('pod-history', runs.filter((r) => r.status === 'success').map((r) => ({
      prompt_id: r.prompt_id, workflow: r.workflow || null, started_at: r.started_at, duration_s: r.duration_s,
      files: r.outputs.filter((o) => o.type === 'output' || o.type === 'temp').map((o) => ({ filename: o.filename, subfolder: o.subfolder || '', type: o.type as 'output' | 'temp' })), source: 'pod-history' as const,
    })).filter((r) => r.files.length))
  },
  address: (_f, ctx, opts = {}) => runningBase(ctx.pod_id ? { pod_id: ctx.pod_id } : ctx, opts),
}

export const saved: OutputSource = {
  id: 'saved', name: 'Saved record', hint: 'What past runs wrote, kept by the app past a stop.',
  async available() { return { ok: true, reason: '' } },
  async list(ctx) {
    const rows = outputruns.saved({ ...(ctx.pod_id ? { pod_id: ctx.pod_id } : {}), ...(ctx.volume_id ? { volume_id: ctx.volume_id } : {}) })
    return listing('saved', rows.map((r) => ({ prompt_id: r.prompt_id, workflow: r.workflow, started_at: r.started_at, duration_s: r.duration_s, files: r.files.map((f) => ({ filename: f.filename, subfolder: f.subfolder, type: 'output' as const })), source: 'saved' as const })).filter((r) => r.files.length))
  },
  address: (_f, ctx, opts = {}) => runningBase(ctx, opts),
}

// ----- volume-s3 -----

/** A folder name or path relative to output/: no dots-dots, no backslash, no control characters. */
export function cleanPrefix(p: string | undefined): string {
  const v = String(p ?? '').replace(/^\/+|\/+$/g, '')
  if (!v) return ''
  if (v.split('/').some((s) => !s || s === '..' || s === '.') || /[\\\u0000-\u001f]/.test(v) || v.length > 280) throw bad(`Not a folder under ${OUTPUT_ROOT}/: ${p}`)
  return v
}

const seenVolumes = new Set<string>()
/** The volumes this app knows: the configuration's, the saved runs', and any a listing already reached through a pod or an explicit id RunPod answered for. */
export function knownVolumes(): string[] {
  const c = mounts.load(), ids = new Set<string>([c.shared_volume_id, c.network_volume_id, ...seenVolumes].filter(Boolean).map((x) => String(x).trim()))
  for (const r of outputruns.load()) if (r.volume_id) ids.add(r.volume_id)
  return [...ids]
}

async function volumeOfCtx(ctx: OutputCtx, opts: ListOpts): Promise<string> {
  if (ctx.volume_id) return ctx.volume_id.trim()
  if (ctx.pod_id) { try { const p = await pods.get(ctx.pod_id, opts.client); if (p.volume_id) return p.volume_id } catch { /* fall through to the default */ } }
  return volumeround.defaultVolumeId()
}

const baseName = (k: string) => k.slice(k.lastIndexOf('/') + 1)
const dirName = (k: string) => (k.includes('/') ? k.slice(0, k.lastIndexOf('/')) : '')

/** Where a pod's shot lives: the first output/<top>/<shot>/ (the pod's round's folder first, then the highest-sorted top folder). */
async function startPrefix(volumeId: string, ctx: OutputCtx, opts: ListOpts): Promise<{ prefix: string; note?: string }> {
  const shot = (ctx.shot || '').trim()
  if (!shot || shot === 'All Shots' || !/^[\w.-]{1,80}$/.test(shot)) return { prefix: '' }
  const top = (await volumeround.listPrefix(volumeId, OUTPUT_ROOT, { recursive: false }, opts)).filter((k) => k.key.endsWith('/')).map((k) => k.key.slice(OUTPUT_ROOT.length + 1, -1)).sort()
  const ordered = [...top.filter((t) => ctx.round && t.includes(ctx.round)), ...top.filter((t) => !(ctx.round && t.includes(ctx.round))).reverse()].slice(0, 12)
  for (const t of ordered) {
    const sub = await volumeround.listPrefix(volumeId, `${OUTPUT_ROOT}/${t}`, { recursive: false }, opts)
    if (sub.some((k) => k.key === `${OUTPUT_ROOT}/${t}/${shot}/`)) return { prefix: `${t}/${shot}`, note: `Started in ${t}/${shot}, the pod's shot.` }
  }
  return { prefix: '', note: `No output folder for the shot ${shot}: showing the top level.` }
}

/** The files of a listing grouped into runs by folder, newest first (what the deep listing and the "all" listing both do). */
function buildRuns(id: string, shown: { key: string; bytes: number; modified?: string }[]): OutputRun[] {
  const groups = new Map<string, OutputFile[]>()
  for (const f of shown) {
    const dir = dirName(f.key.slice(OUTPUT_ROOT.length + 1))
    const arr = groups.get(dir) || []; arr.push({ filename: baseName(f.key), subfolder: dir, type: 'output', bytes: f.bytes, ...(f.modified ? { modified: f.modified } : {}) }); groups.set(dir, arr)
  }
  return [...groups].map(([dir, fs]) => {
    fs.sort((a, b) => a.filename.localeCompare(b.filename))
    const newest = fs.reduce((m, f) => (f.modified && f.modified > m ? f.modified : m), '')
    return { prompt_id: `volume:${id}:${dir || '.'}`, workflow: null, started_at: newest || null, files: fs, source: 'volume-s3' as const, folder: dir }
  }).sort((a, b) => when(b).localeCompare(when(a)))
}

// ----- "All outputs": the whole output/ tree of the volume in one listing -----
const allCache = new Map<string, { at: number; listing: OutputListing }>(), allRunning = new Map<string, AbortController>()
/** Every file under comfy-shared/output/ in ONE recursive listing (never one call per folder), parsed in chunks with yields, grouped into runs by folder like the deep listing. At most MAX_OBJECTS_ALL files are materialised; `total` counts what the listing found up to HARD_LIMIT (`total_exact` says if it stopped). Cached 60 s per volume (`fresh` bypasses); a second request for the same volume cancels the one still running; `signal` stops it. folder_info comes free from the listing: every folder found, empty or not. */
export async function listAll(id: string, opts: ListOpts = {}): Promise<OutputListing> {
  const nowMs = (opts.now ?? (() => new Date()))().getTime(), hit = allCache.get(id)
  if (!opts.fresh && hit && nowMs - hit.at < ALL_CACHE_MS) return hit.listing
  allRunning.get(id)?.abort()
  const ac = new AbortController(); allRunning.set(id, ac)
  const stop = () => ac.abort(); opts.signal?.addEventListener('abort', stop, { once: true }); if (opts.signal?.aborted) ac.abort()
  try {
    const r = await podpull.listVolumeKeysChunked(id, OUTPUT_ROOT, { signal: ac.signal, ...(opts.onProgress ? { onSeen: opts.onProgress } : {}), keep: MAX_OBJECTS_ALL, hardLimit: HARD_LIMIT }, opts)
    if (r === null) throw new CoreError(409, (await volumeround.availability(id, opts)).reason || 'This volume cannot be listed over the S3 API.')
    const runs = buildRuns(id, r.keys), folder_info: Record<string, { empty?: boolean }> = {}
    for (const [d, n] of r.dirs) folder_info[d] = { empty: n === 0 }
    const folders = [...r.dirs.keys()].filter((d) => !d.includes('/')).sort()
    const listing: OutputListing = { source: 'volume-s3', runs, folders, folder_info, prefix: '', capped: r.counted > MAX_OBJECTS_ALL, total: r.counted, total_exact: !r.limited, all: true } as OutputListing
    allCache.set(id, { at: nowMs, listing }); return listing
  } finally { opts.signal?.removeEventListener('abort', stop); if (allRunning.get(id) === ac) allRunning.delete(id) }
}
export const forgetAll = (): void => { allCache.clear(); for (const c of allRunning.values()) c.abort(); allRunning.clear() }

export const volumeS3: OutputSource = {
  id: 'volume-s3', name: 'Network volume (S3)', hint: 'The files under comfy-shared/output/ on the volume, read over RunPod\'s S3 API with no pod.',
  async available(ctx, opts = {}) {
    const id = await volumeOfCtx(ctx, opts)
    if (!id) return { ok: false, reason: 'No network volume: the pod mounts none and no Shared or default volume is set in Configuration.' }
    const a = await volumeround.availability(id, opts)
    return { ok: a.ok, reason: a.ok ? '' : a.reason }
  },
  async list(ctx, opts = {}) {
    const id = await volumeOfCtx(ctx, opts)
    const av = await volumeS3.available({ ...ctx, volume_id: id }, opts)
    if (!av.ok) throw new CoreError(409, av.reason)
    seenVolumes.add(id)
    if (opts.all && opts.prefix === undefined) return listAll(id, opts)
    let prefix = '', note: string | undefined
    if (opts.prefix === undefined) ({ prefix, note } = await startPrefix(id, ctx, opts)); else prefix = cleanPrefix(opts.prefix)
    // The root and a top folder are one level (cheap); deeper, everything under the prefix (a shot's folders), capped.
    const deep = prefix.split('/').filter(Boolean).length >= 2
    const base = prefix ? `${OUTPUT_ROOT}/${prefix}` : OUTPUT_ROOT
    const keys = await volumeround.listPrefix(id, base, { recursive: deep }, opts)
    const rel = (k: string) => k.slice(base.length + 1)
    const folders = new Set<string>(), files: { key: string; bytes: number; modified?: string }[] = []
    for (const k of keys) {
      if (!k.key.startsWith(`${base}/`)) continue
      const r = rel(k.key)
      if (k.key.endsWith('/')) { const n = r.replace(/\/$/, ''); if (n && !n.includes('/')) folders.add(n); continue }
      if (r.includes('/')) folders.add(r.split('/')[0])
      files.push({ key: k.key, bytes: k.bytes, modified: k.modified })
    }
    const total = files.length, capped = total > MAX_OBJECTS
    const runs = buildRuns(id, files.slice(0, MAX_OBJECTS))
    const names = [...folders].sort(), folder_info: Record<string, { empty?: boolean }> = {}
    const acc = names.length ? await podpull.s3ReadAccess(id, opts).catch(() => null) : null
    if (acc && acc.ok) {
      const todo = names.slice(0, 200), aws = opts.aws ?? podpull.defaultAws
      let next = 0
      await Promise.all(Array.from({ length: Math.min(8, todo.length) }, async () => { while (next < todo.length) { const n = todo[next++]; const e = await podpull.probeEmpty(acc, `${base}/${n}/`, aws); folder_info[n] = e === undefined ? {} : { empty: e } } }))
    }
    return { source: 'volume-s3', runs, folders: names, folder_info, prefix, capped, total, ...(note ? { start_note: note } : {}) }
  },
  async address(_f, ctx, opts = {}) { const id = await volumeOfCtx(ctx, opts); return id ? `s3file://${id}` : '' },
}

export const SOURCES: Record<SourceId, OutputSource> = { 'pod-history': podHistory, saved, 'volume-s3': volumeS3 }
export const sources = (): OutputSource[] => PRIORITY.map((id) => SOURCES[id])

/** The combined runs, newest first, each tagged with its source. The same run in two sources shows once: live over saved over volume (by prompt id; a volume folder is the same run as a pod/saved run that wrote into it, matched by any shared file). */
export function mergeRuns(groups: Partial<Record<SourceId, OutputRun[]>> | OutputRun[][]): OutputRun[] {
  const lists: OutputRun[][] = Array.isArray(groups) ? groups : PRIORITY.map((id) => groups[id] || [])
  const ids = new Set<string>(), files = new Set<string>(), out: OutputRun[] = []
  for (const list of lists) {
    const add: OutputRun[] = []
    for (const r of list) {
      const isVol = r.source === 'volume-s3'
      if (!isVol && ids.has(r.prompt_id)) continue
      if (isVol && r.files.some((f) => files.has(`${f.subfolder}/${f.filename}`))) continue
      add.push(r)
    }
    for (const r of add) { ids.add(r.prompt_id); if (r.source !== 'volume-s3') for (const f of r.files) files.add(`${f.subfolder}/${f.filename}`); out.push(r) }
  }
  return out.map((r, i) => ({ r, i })).sort((a, b) => (when(a.r) && when(b.r) ? when(b.r).localeCompare(when(a.r)) : when(a.r) ? -1 : when(b.r) ? 1 : a.i - b.i)).map((x) => x.r)
}

export interface Answer { sources: { id: SourceId; name: string; hint: string; ok: boolean; reason: string }[]; runs: OutputRun[]; folders: string[]; folder_info: Record<string, { empty?: boolean }>; prefix: string; capped: boolean; total: number; /** false when an `all` listing stopped counting at the hard limit */ total_exact: boolean; volume_id: string; start_note?: string }
/** What the sources know: every one asked (or just `source`), a failing source reported with its reason and never throwing for the rest. */
export async function listOutputs(ctx: OutputCtx, o: ListOpts & { source?: string } = {}): Promise<Answer | { job_id: string }> {
  if (o.all && o.job) return startAllJob(ctx, o)
  const want = o.source ? [SOURCES[o.source as SourceId] ?? (() => { throw bad(`Unknown output source: ${o.source}. One of ${PRIORITY.join(', ')}.`) })()] : sources()
  const groups: Partial<Record<SourceId, OutputRun[]>> = {}, st: Answer['sources'] = []
  let vol: OutputListing | null = null
  for (const s of want) {
    try { const l = await s.list(ctx, o); groups[s.id] = l.runs; if (s.id === 'volume-s3') vol = l; st.push({ id: s.id, name: s.name, hint: s.hint, ok: true, reason: '' }) }
    catch (e) { st.push({ id: s.id, name: s.name, hint: s.hint, ok: false, reason: (e as Error).message }) }
  }
  return { sources: st, runs: mergeRuns(groups), folders: vol?.folders ?? [], folder_info: vol?.folder_info ?? {}, prefix: vol?.prefix ?? '', capped: !!vol?.capped, total: vol?.total ?? 0, total_exact: vol?.total_exact ?? true, volume_id: await volumeOfCtx(ctx, o).catch(() => ''), ...(vol?.start_note ? { start_note: vol.start_note } : {}) }
}
/** Which sources could answer for this context, with the reason when not (no listing). */
export async function availability(ctx: OutputCtx, opts: ListOpts = {}) {
  return Promise.all(sources().map(async (s) => ({ id: s.id, name: s.name, hint: s.hint, ...(await s.available(ctx, opts).catch((e) => ({ ok: false, reason: (e as Error).message }))) })))
}

// ----- s3file:// : what may be read, and the signed read (main process only) -----

/** `s3file://<volume>/<url-encoded key>` -> { volume_id, key }, or a 403 CoreError. Only keys under comfy-shared/output/ of a volume the app knows; never `..`. */
export function guardS3FileUrl(url: string): { volume_id: string; key: string } {
  const no = (why: string) => new CoreError(403, `Only files under ${OUTPUT_ROOT}/ of a known volume are served here (${why}).`)
  let u: URL
  try { u = new URL(String(url)) } catch { throw no('not a URL') }
  if (u.protocol !== 's3file:') throw no('not an s3file address')
  let key: string
  try { key = decodeURIComponent(u.pathname.replace(/^\/+/, '')) } catch { throw no('bad encoding') }
  if (u.search || u.hash) throw no('no query')
  const prefix = `${OUTPUT_ROOT}/`
  if (!key.startsWith(prefix) || key.length <= prefix.length || key.endsWith('/') || key.length > 1024) throw no('outside the output folder')
  if (key.split('/').some((s) => !s || s === '.' || s === '..') || /[\\\u0000-\u001f]/.test(key)) throw no('bad path')
  const known = knownVolumes().find((v) => v.toLowerCase() === u.hostname.toLowerCase())
  if (!known) throw no('unknown volume')
  return { volume_id: known, key }
}

// a viewer reads many frames: the volume's record (RunPod answers it) is asked once a minute, not once a file; the cache holds the keys in this process only
const accessCache = new Map<string, { at: number; keys: string; a: Extract<Awaited<ReturnType<typeof podpull.s3ReadAccess>>, { ok: true }> }>()

/** The URL and signed headers (SigV4, Authorization header) for a read of a guarded s3file:// address, for the main process to send. RunPod's S3 API refuses a presigned query URL (401), so the signature rides in a header; it still never leaves the main process: not to a page, not to a log. */
export async function signGet(url: string, opts: { client?: volumeround.VolumeOpts['client']; aws?: podpull.AwsRunner; now?: Date; range?: string | null } = {}): Promise<{ url: string; headers: Record<string, string> }> {
  const g = guardS3FileUrl(url)
  const hit = accessCache.get(g.volume_id), keysNow = `${settings.lookup('RUNPOD_S3_ACCESS_KEY') || ''}:${settings.lookup('RUNPOD_S3_SECRET_KEY') || ''}`
  let a = hit && Date.now() - hit.at < 60_000 && hit.keys === keysNow ? hit.a : undefined
  if (!a) {
    const r = await podpull.s3ReadAccess(g.volume_id, { client: opts.client, aws: opts.aws })
    if (!r.ok) throw new CoreError(409, r.reason)
    accessCache.set(g.volume_id, { at: Date.now(), keys: keysNow, a: r }); a = r
  }
  const e = new URL(a.endpoint), range = opts.range && /^bytes=\d*-\d*$/.test(opts.range) ? opts.range : undefined
  return signHeaders({ host: e.host, path: `/${a.bucket}/${g.key}`, accessKey: a.id, secretKey: a.secret, region: a.region, now: opts.now, range })
}

// ----- the listing as a job (a live count for the window; Stop cancels it) -----
export interface OutputsJobStatus { state: 'listing' | 'done' | 'failed' | 'cancelled'; /** lines the S3 listing has produced so far */ files_seen: number; /** known when the listing is done (one S3 listing has no folder count while it runs) */ folders_seen: number; elapsed_s: number; result?: Answer; error?: string }
interface OutputsJob { state: OutputsJobStatus['state']; files_seen: number; folders_seen: number; started: number; ended?: number; result?: Answer; error?: string; ac: AbortController }
const outJobs = new Map<string, OutputsJob>()
let outSeq = 0
function startAllJob(ctx: OutputCtx, o: ListOpts & { source?: string }): { job_id: string } {
  const id = `outputs-${Date.now().toString(36)}-${(outSeq++).toString(36)}`, ac = new AbortController()
  for (const j of outJobs.values()) if (j.state === 'listing') j.ac.abort()   // a second request cancels the one still running
  const job: OutputsJob = { state: 'listing', files_seen: 0, folders_seen: 0, started: Date.now(), ac }
  outJobs.set(id, job); while (outJobs.size > 10) outJobs.delete(outJobs.keys().next().value as string)
  void (async () => {
    try {
      const { job: _j, ...rest } = o
      const res = (await listOutputs(ctx, { ...rest, source: rest.source ?? 'volume-s3', signal: ac.signal, onProgress: (n) => { job.files_seen = n } })) as Answer
      if (ac.signal.aborted) { job.state = 'cancelled'; return }
      job.result = res; job.files_seen = Math.max(job.files_seen, res.total); job.folders_seen = Object.keys(res.folder_info ?? {}).length || res.folders.length; job.state = 'done'
    } catch (e) { job.state = ac.signal.aborted || (e as { status?: number }).status === 499 ? 'cancelled' : 'failed'; if (job.state === 'failed') job.error = (e as Error).message } finally { job.ended = Date.now() }
  })()
  return { job_id: id }
}
export function jobStatus(jobId: string): OutputsJobStatus {
  const j = outJobs.get(jobId); if (!j) throw new CoreError(404, `No such outputs listing: ${jobId}`)
  return { state: j.state, files_seen: j.files_seen, folders_seen: j.folders_seen, elapsed_s: Math.round(((j.ended ?? Date.now()) - j.started) / 100) / 10, ...(j.result ? { result: j.result } : {}), ...(j.error ? { error: j.error } : {}) }
}
export function jobCancel(jobId: string): OutputsJobStatus { const j = outJobs.get(jobId); if (!j) throw new CoreError(404, `No such outputs listing: ${jobId}`); if (j.state === 'listing') { j.ac.abort(); j.state = 'cancelled'; j.ended = Date.now() } return jobStatus(jobId) }
