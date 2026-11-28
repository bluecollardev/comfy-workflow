/**
 * Sync a network volume's outputs to a storage (docs/ADR-066). Two steps: `plan` lists the volume over RunPod's S3 API (no pod, no cost) and the storage under its
 * directory and counts; `start` copies from that plan with a RUNNING pod on the volume, which uploads its own files to signed PUT links (publish.podPutTo): nothing
 * passes through this PC, nothing is deleted on either side, weights never go, a file already there at the same size is skipped, a file over 5 GB is a warning.
 * No key, link or ssh text is ever in a result, a message or a History line. Jobs are in memory (and the Queue, kind 'volume-sync'); finished ones are kept in a small file.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as mounts from './mounts.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import * as rp from './runpod.js'
import * as storage from './storage.js'
import { configDir } from './paths.js'

export const DEFAULT_PREFIX = 'comfy-shared/output/', RATE_MB_S = 11, PLAN_KEEP_MS = 3_600_000, KEEP_JOBS = 20, TOP_NAME = '(this folder)'
const WORKERS = 3, BREAKER = 5, POD_RECHECK_MS = 10_000, MAX_FAILED_KEPT = 2000
const NO_POD = 'No pod is running on this volume. Resume one (the app never starts a pod for this), then Start.'

export interface Plan {
  plan_id: string; volume_id: string; storage_id: string; storage: { name: string; bucket: string; prefix: string; region: string }; prefix: string
  files: number; bytes: number; to_copy: { files: number; bytes: number }; already_there: { files: number; bytes: number }; too_big: { files: number; names: string[] }
  excluded_weights: number; folders: { name: string; files: number; bytes: number; skipped: boolean }[]
  pod: { id: string; name: string; cost_per_hr: number | null } | null; estimate: { hours: number; usd: number; rate_mb_s: number }; can_start: boolean; reason?: string
}
export interface PlanStatus { state: 'listing' | 'done' | 'failed' | 'cancelled'; files_so_far: number; error?: string; plan?: Plan }
export type JobState = 'uploading' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
export interface Job {
  job_id: string; kind: 'volume-sync'; state: JobState; volume_id: string; storage_id: string; storage_name: string; started_at: string; finished_at?: string
  files_total: number; files_done: number; files_skipped: number; files_failed: number; bytes_total: number; bytes_done: number; rate: number; current: string; warnings: string[]; error?: string
}
export interface Req { volume_id: string; storage_id: string; prefix?: string; skip_folders?: string[]; pod_id?: string }
interface Item { key: string; rel: string; bytes: number }

export interface Deps { now(): number; /** the pod's hourly price, null when unknown */ podPrice(podId: string): Promise<number | null>; workers: number }
const defaults = (): Deps => ({
  now: () => Date.now(), workers: WORKERS,
  podPrice: async (id) => { try { if (mounts.dryRun(mounts.load())) return 0; const r = await rp.getPod(id); return typeof r?.costPerHr === 'number' && r.costPerHr >= 0 ? r.costPerHr : null } catch { return null } },
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

interface PlanRec { id: string; req: { volume_id: string; storage_id: string; prefix: string; skip: string[]; pod_id?: string }; ac: AbortController; state: PlanStatus['state']; seen: number; error?: string; plan?: Plan; todo: Item[]; done: Set<string>; at: number; podCheckedAt: number; done_p?: Promise<void> }
interface JobRec { view: Job; ac: AbortController; items: Item[]; failed: Item[]; volume_id: string; storage_id: string; prefix: string; pod_id: string; plan_id: string; done: Promise<void>; stop?: () => void; ended: boolean }
const plans = new Map<string, PlanRec>(), jobs = new Map<string, JobRec>()
let finished: (Job & { _failed?: { key: string; rel: string; bytes: number }[]; _prefix?: string; _pod_id?: string })[] = [], loaded: Promise<void> | null = null, writing: Promise<void> = Promise.resolve(), seq = 0
const iso = () => new Date(deps.now()).toISOString()
const jobsFile = () => process.env.VOLUME_SYNC_JOBS_FILE || join(configDir(), 'volume-sync-jobs.json')
const ensureLoaded = (): Promise<void> => (loaded ??= readFile(jobsFile(), 'utf8').then((t) => { const j = JSON.parse(t); if (Array.isArray(j) && !finished.length) finished = j.slice(0, KEEP_JOBS) }).catch(() => undefined))
const persist = (): void => {
  writing = writing.then(async () => { const f = jobsFile(), tmp = `${f}.${process.pid}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(tmp, JSON.stringify(finished), { mode: 0o600 }); await rename(tmp, f) }).catch(() => undefined)
}
/** Plain text only: no key, link or long ssh text. */
const scrub = (t: string, extra: (string | undefined)[] = []): string => {
  let s = publish.redact(String(t).split('\n')[0].trim() || 'failed').slice(0, 200)
  for (const v of extra) if (v) s = s.split(v).join('***')
  return s.replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, '***').replace(/https?:\/\/\S+/g, '(link)')
}
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`

function cleanPrefix(p: unknown): string {
  const s = p === undefined || p === null || p === '' ? DEFAULT_PREFIX : String(p)
  if (!/^[\w .+@=,()/-]{1,300}$/.test(s) || s.startsWith('/') || s.split('/').includes('..') || s.includes('//')) throw bad(`Not a folder on the volume: ${s.slice(0, 80)}`)
  return s.replace(/\/+$/, '') + '/'
}
const parseLs = (out: string): Map<string, number> => {
  const m = new Map<string, number>()
  for (const line of out.split('\n')) { const f = /^\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d\s+(\d+)\s+(.+)$/.exec(line); if (f && !f[2].endsWith('/')) m.set(f[2], Number(f[1])) }
  return m
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

// ----- plan -----
export async function plan(req: Req): Promise<{ plan_id: string }> {
  const r = (req ?? {}) as Req, volume_id = String(r.volume_id ?? '').trim(), storage_id = String(r.storage_id ?? '').trim()
  if (!volume_id) throw bad('volume_id is needed')
  if (!storage_id) throw bad('storage_id is needed')
  const prefix = cleanPrefix(r.prefix)
  if (r.skip_folders !== undefined && (!Array.isArray(r.skip_folders) || r.skip_folders.some((x) => typeof x !== 'string'))) throw bad('skip_folders is a list of folder names')
  if (r.pod_id !== undefined && !/^[A-Za-z0-9]{6,32}$/.test(String(r.pod_id))) throw bad('pod_id looks wrong')
  storage.storageAccess(storage_id)   // refuses early: not a storage of this kind, or not ready
  const id = `vs-plan-${deps.now().toString(36)}-${(++seq).toString(36)}`
  for (const [k, p] of plans) if (deps.now() - p.at > PLAN_KEEP_MS) plans.delete(k)
  const rec: PlanRec = { id, req: { volume_id, storage_id, prefix, skip: (r.skip_folders ?? []).map(String), ...(r.pod_id ? { pod_id: String(r.pod_id) } : {}) }, ac: new AbortController(), state: 'listing', seen: 0, todo: [], done: new Set(), at: deps.now(), podCheckedAt: 0 }
  plans.set(id, rec)
  rec.done_p = doPlan(rec).catch((e) => { if (rec.ac.signal.aborted) rec.state = 'cancelled'; else { rec.state = 'failed'; rec.error = scrub((e as Error).message) } })
  return { plan_id: id }
}

async function resolvePod(volumeId: string, wanted?: string): Promise<{ pod: Plan['pod']; reason?: string }> {
  let list: publish.PodRef[] = []
  try { list = await publish.runningPodsOn(volumeId) } catch { list = [] }
  const p = wanted ? list.find((x) => x.id === wanted) : list[0]
  if (!p) return { pod: null, reason: wanted ? 'That pod is not running on this volume. Resume it or choose another, then Start.' : NO_POD }
  return { pod: { id: p.id, name: p.name, cost_per_hr: await deps.podPrice(p.id).catch(() => null) } }
}
const estimateOf = (bytes: number, perHr: number | null): Plan['estimate'] => { const hours = bytes / (RATE_MB_S * 1e6) / 3600; return { hours: round(hours, 2), usd: perHr ? round(hours * perHr, 2) : 0, rate_mb_s: RATE_MB_S } }

async function doPlan(rec: PlanRec): Promise<void> {
  const { volume_id, storage_id, prefix, skip } = rec.req, sig = rec.ac.signal
  const abortable = <T>(p: Promise<T>): Promise<T> => new Promise<T>((res, rej) => { const on = () => rej(new CoreError(499, 'The plan was cancelled')); if (sig.aborted) return on(); sig.addEventListener('abort', on, { once: true }); p.then(res, rej).finally(() => sig.removeEventListener('abort', on)) })
  const st = storage.storageAccess(storage_id)
  const keys = await abortable(publish.listVolume(volume_id, prefix, { signal: sig, onSeen: (n) => { rec.seen = Math.max(rec.seen, n) } }))
  if (keys === null) throw new CoreError(502, "RunPod's S3 API cannot be used for this volume (no keys in Default Configuration, or a datacenter without it)")
  rec.seen = Math.max(rec.seen, keys.length)
  // the storage under its directory
  let there = new Map<string, number>()
  try {
    const ls = await abortable(storage.aws(['s3', 'ls', `s3://${st.bucket}/${st.prefix}`, '--recursive', ...st.common], st.env, { signal: sig, stallMs: 120_000 }))
    if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new CoreError(502, `The storage could not be read: ${ls.transient ? podpull.STORAGE_UNREACHABLE : scrub(ls.stderr || ls.stdout, [st.keys.id, st.keys.secret])}`)
    there = parseLs(ls.stdout)
  } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(502, `The storage could not be read: ${scrub((e as Error).message, [st.keys.id, st.keys.secret])}`) }
  if (sig.aborted) throw new CoreError(499, 'The plan was cancelled')

  const folders = new Map<string, { files: number; bytes: number }>(), skipSet = new Set(rec.req.skip)
  let files = 0, bytes = 0, weights = 0, bigFiles = 0, thereF = 0, thereB = 0, copyB = 0
  const big: string[] = [], todo: Item[] = []
  for (const k of keys) {
    if (!k.key.startsWith(prefix) || k.key.endsWith('/')) continue
    const rel = k.key.slice(prefix.length)
    if (!rel || rel.split('/').some((s) => !s || s === '.' || s === '..')) continue
    if (publish.isWeight(rel)) { weights++; continue }
    const segs = rel.split('/'), top = segs.length > 1 ? segs[0] : TOP_NAME
    const f = folders.get(top) ?? { files: 0, bytes: 0 }; f.files++; f.bytes += k.bytes; folders.set(top, f)
    if (top !== TOP_NAME && skipSet.has(top)) continue
    files++; bytes += k.bytes
    if (k.bytes > publish.PUT_MAX_BYTES) { bigFiles++; if (big.length < 20) big.push(rel); continue }
    if (there.get(`${st.prefix}${rel}`) === k.bytes) { thereF++; thereB += k.bytes; continue }
    todo.push({ key: k.key, rel, bytes: k.bytes }); copyB += k.bytes
  }
  rec.todo = todo
  const { pod, reason } = await resolvePod(volume_id, rec.req.pod_id)
  rec.podCheckedAt = deps.now()
  const p: Plan = {
    plan_id: rec.id, volume_id, storage_id, storage: { name: st.name, bucket: st.bucket, prefix: st.prefix, region: st.region }, prefix, files, bytes,
    to_copy: { files: todo.length, bytes: copyB }, already_there: { files: thereF, bytes: thereB }, too_big: { files: bigFiles, names: big }, excluded_weights: weights,
    folders: [...folders].map(([name, v]) => ({ name, ...v, skipped: name !== TOP_NAME && skipSet.has(name) })).sort((a, b) => a.name.localeCompare(b.name)),
    pod, estimate: estimateOf(copyB, pod?.cost_per_hr ?? null), can_start: false,
  }
  setStart(p)
  if (reason && !pod) p.reason = reason
  rec.plan = p; rec.state = 'done'
}
function setStart(p: Plan): void {
  if (!p.pod) { p.can_start = false; p.reason = p.reason || NO_POD }
  else if (!p.to_copy.files) { p.can_start = false; p.reason = p.already_there.files ? 'Everything is already in the storage.' : 'There is nothing to copy.' }
  else { p.can_start = true; delete p.reason }
}

export async function planStatus(plan_id: string): Promise<PlanStatus> {
  const rec = plans.get(String(plan_id))
  if (!rec) throw new CoreError(404, 'No such plan (a plan is kept for an hour): plan again')
  if (rec.state === 'done' && rec.plan && !rec.plan.pod && deps.now() - rec.podCheckedAt > POD_RECHECK_MS) {   // a person may have resumed a pod since: look again (not more than every 10 s)
    rec.podCheckedAt = deps.now()
    const { pod, reason } = await resolvePod(rec.req.volume_id, rec.req.pod_id)
    if (pod) { rec.plan.pod = pod; rec.plan.estimate = estimateOf(rec.plan.to_copy.bytes, pod.cost_per_hr); delete rec.plan.reason } else if (reason) rec.plan.reason = reason
    setStart(rec.plan)
  }
  return { state: rec.state, files_so_far: rec.seen, ...(rec.error ? { error: rec.error } : {}), ...(rec.plan ? { plan: structuredClone(rec.plan) } : {}) }
}
/** Stop a plan that is still listing. */
export async function cancelPlan(plan_id: string): Promise<PlanStatus> {
  const rec = plans.get(String(plan_id)); if (!rec) throw new CoreError(404, 'No such plan')
  if (rec.state === 'listing') { rec.ac.abort(); rec.state = 'cancelled'; await rec.done_p }
  return planStatus(plan_id)
}

// ----- start -----
export async function start(req: { plan_id: string; approved_by?: string }): Promise<{ job_id: string }> {
  await ensureLoaded()
  const rec = plans.get(String(req?.plan_id ?? ''))
  if (!rec) throw new CoreError(404, 'No such plan (a plan is kept for an hour): plan again')
  if (rec.state !== 'done' || !rec.plan) throw bad(rec.state === 'listing' ? 'The plan is still listing the volume' : 'The plan did not finish: plan again')
  const p = rec.plan, st = storage.storageAccess(p.storage_id)
  const items = rec.todo.filter((i) => !rec.done.has(i.rel))
  if (!items.length) throw bad('Everything in this plan is already in the storage.')
  const { pod, reason } = await resolvePod(p.volume_id, rec.req.pod_id)
  if (!pod) throw bad(reason || NO_POD)
  const warnings = p.too_big.names.map((n) => `${n}: over 5 GB, not uploaded (one upload is at most 5 GB)`)
  if (p.too_big.files > p.too_big.names.length) warnings.push(`${p.too_big.files - p.too_big.names.length} more file(s) over 5 GB were not uploaded`)
  return launch({ plan_id: rec.id, volume_id: p.volume_id, storage_id: p.storage_id, storage_name: st.name, prefix: p.prefix, pod, items, skipped: p.already_there.files, warnings, approved_by: req.approved_by, on_done: (rel) => rec.done.add(rel) })
}

function launch(o: { plan_id: string; volume_id: string; storage_id: string; storage_name: string; prefix: string; pod: NonNullable<Plan['pod']>; items: Item[]; skipped: number; warnings: string[]; approved_by?: string; on_done?: (rel: string) => void }): { job_id: string } {
  const id = `vs-${deps.now().toString(36)}-${(++seq).toString(36)}`, ac = new AbortController(), who = history.currentOrigin()
  const bytes_total = o.items.reduce((a, i) => a + i.bytes, 0)
  const view: Job = { job_id: id, kind: 'volume-sync', state: 'uploading', volume_id: o.volume_id, storage_id: o.storage_id, storage_name: o.storage_name, started_at: iso(), files_total: o.items.length + o.skipped, files_done: 0, files_skipped: o.skipped, files_failed: 0, bytes_total, bytes_done: 0, rate: 0, current: '', warnings: [...o.warnings] }
  const rec: JobRec = { view, ac, items: o.items, failed: [], volume_id: o.volume_id, storage_id: o.storage_id, prefix: o.prefix, pod_id: o.pod.id, plan_id: o.plan_id, done: Promise.resolve(), ended: false }
  jobs.set(id, rec)
  const by = o.approved_by ?? who?.approved_by, tag = by ? ` approved by ${String(by).slice(0, 80)}` : ''
  history.record({ kind: 'change', area: 'volume', action: 'volume sync started', what: `${o.volume_id} to ${o.storage_name}`, detail: `${o.items.length} file(s), ${gb(bytes_total)}, pod ${o.pod.name}${tag}` })
  const origin: jobsregistry.Origin = who?.source === 'mcp' ? 'mcp' : 'window'
  rec.stop = jobsregistry.track({ id, kind: 'volume-sync', trigger: 'manual', origin, ...(origin === 'mcp' && who?.client ? { client: who.client } : {}), ...(by ? { approved_by: String(by).slice(0, 80) } : {}), label: `sync ${o.volume_id} to ${o.storage_name}`, started_at: view.started_at,
    view: () => ({ state: view.state, terminal: rec.ended, progress: { done: view.files_done + view.files_skipped, total: view.files_total, unit: 'files' }, transfer: { bytes_done: view.bytes_done, bytes_total: view.bytes_total, rate_bps: view.rate, ...(view.current ? { current: view.current } : {}), skipped: view.files_skipped, pods: [o.pod.name] } }),
    cancel: () => { void cancel(id).catch(() => undefined) } })
  rec.done = run(rec, o.pod, o.on_done).catch((e) => { if (view.state === 'uploading') { view.state = ac.signal.aborted ? 'cancelled' : 'failed'; if (view.state === 'failed') view.error = scrub((e as Error).message) } }).finally(() => end(rec))
  return { job_id: id }
}

async function run(rec: JobRec, podRef: NonNullable<Plan['pod']>, onDone?: (rel: string) => void): Promise<void> {
  const v = rec.view, sig = rec.ac.signal
  const st = storage.storageAccess(rec.storage_id)
  const pods = await publish.runningPodsOn(rec.volume_id).catch(() => [] as publish.PodRef[]), pod = pods.find((x) => x.id === podRef.id)
  if (!pod) throw new Error('The pod stopped running before the copy began')
  const queue = [...rec.items], t0 = deps.now()
  let streak = 0, tripped = false
  const worker = async () => {
    while (!sig.aborted && !tripped) {
      const it = queue.shift(); if (!it) return
      v.current = basename(it.rel)
      const r = await publish.podPutTo(pod, it.key, it.bytes, st, `${st.prefix}${it.rel}`, sig).catch((e) => ({ ok: false, error: (e as Error).message }))
      if (sig.aborted) { if (!r.ok) return }
      if (r.ok) { streak = 0; v.files_done++; v.bytes_done += it.bytes; onDone?.(it.rel) } else {
        streak++; v.files_failed++; rec.failed.push(it)
        if (v.warnings.length < 50) v.warnings.push(`${basename(it.rel)}: ${scrub(r.error, [st.keys.id, st.keys.secret])}`)
        if (streak >= BREAKER && !tripped) { tripped = true; v.error = `${BREAKER} files in a row failed: the pod may have stopped. The rest were not tried; Retry Failed sends them again.` }
      }
      const secs = Math.max(1, (deps.now() - t0) / 1000); v.rate = Math.round(v.bytes_done / secs)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(deps.workers, rec.items.length)) }, worker))
  if (tripped) { for (const it of queue) { rec.failed.push(it); v.files_failed++ } queue.length = 0 }
  if (sig.aborted) { v.state = 'cancelled'; return }
  v.state = tripped ? 'failed' : v.files_failed || v.warnings.length ? 'done_with_warning' : 'done'
}
function end(rec: JobRec): void {
  const v = rec.view; if (rec.ended) return
  rec.ended = true; v.current = ''; v.finished_at = iso(); rec.stop?.()
  history.record({ kind: 'change', area: 'volume', action: `volume sync ${v.state.replace(/_/g, ' ')}`, what: `${v.volume_id} to ${v.storage_name}`, detail: `${v.files_done} sent (${gb(v.bytes_done)}), ${v.files_skipped} already there, ${v.files_failed} failed${v.error ? `; ${v.error}` : ''}` })
  for (const w of v.warnings.slice(0, 5)) if (v.files_failed) history.record({ kind: 'change', area: 'volume', action: 'volume sync file failed', what: `${v.volume_id} to ${v.storage_name}`, detail: w })
  finished = [{ ...structuredClone(v), _failed: rec.failed.slice(0, MAX_FAILED_KEPT).map((i) => ({ key: i.key, rel: i.rel, bytes: i.bytes })), _prefix: rec.prefix, _pod_id: rec.pod_id }, ...finished.filter((f) => f.job_id !== v.job_id)].slice(0, KEEP_JOBS)
  jobs.delete(v.job_id); persist()
}

// ----- status, cancel, retry -----
const pub = (j: Job): Job => { const { job_id, kind, state, volume_id, storage_id, storage_name, started_at, finished_at, files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings, error } = j; return { job_id, kind, state, volume_id, storage_id, storage_name, started_at, ...(finished_at ? { finished_at } : {}), files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings: [...warnings], ...(error ? { error } : {}) } }
export async function status(job_id?: string): Promise<{ jobs: Job[] }> {
  await ensureLoaded()
  const all = [...[...jobs.values()].map((r) => pub(r.view)).reverse(), ...finished.filter((f) => !jobs.has(f.job_id)).map(pub)]
  if (job_id) { const j = all.find((x) => x.job_id === job_id); if (!j) throw new CoreError(404, `No such volume sync job: ${job_id}`); return { jobs: [j] } }
  return { jobs: all }
}
export async function cancel(job_id: string): Promise<Job> {
  const rec = jobs.get(String(job_id))
  if (!rec) { const f = (await status(job_id).catch(() => null))?.jobs[0]; if (f) return f; throw new CoreError(404, `No such volume sync job: ${job_id}`) }
  rec.ac.abort(); if (rec.view.state === 'uploading') rec.view.state = 'cancelled'
  await rec.done
  return pub(rec.view)
}
export async function retry(job_id: string): Promise<{ job_id: string }> {
  await ensureLoaded()
  const id = String(job_id)
  if (jobs.has(id)) throw bad('That job is still running')
  const f = finished.find((x) => x.job_id === id); if (!f) throw new CoreError(404, `No such volume sync job: ${id}`)
  const failed = f._failed ?? []
  if (!failed.length) throw bad('That job has no failed files')
  const st = storage.storageAccess(f.storage_id)
  const { pod, reason } = await resolvePod(f.volume_id, f._pod_id)
  const use = pod ?? (await resolvePod(f.volume_id)).pod
  if (!use) throw bad(reason || NO_POD)
  return launch({ plan_id: '', volume_id: f.volume_id, storage_id: f.storage_id, storage_name: st.name, prefix: f._prefix ?? DEFAULT_PREFIX, pod: use, items: failed.map((x) => ({ ...x })), skipped: 0, warnings: [] })
}

/** Tests: forget everything. */
export function reset(): void { for (const r of jobs.values()) { r.ac.abort(); r.stop?.() } for (const p of plans.values()) p.ac.abort(); jobs.clear(); plans.clear(); finished = []; loaded = null; writing = Promise.resolve(); seq = 0; setDeps(null) }
