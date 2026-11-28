/**
 * Bucket to bucket through a running pod (docs/ADR-067, "Amendment 2026-11-28"). From a network volume (over RunPod's S3 API), a storage, or the BH exchange bucket (a source only) TO a storage
 * (Wasabi or your own; never the BH bucket). Two steps like volumesync/sourcesync: `plan` lists the source and the target under its directory and counts (no pod, no cost); `start` copies from
 * that plan with ONE running pod (any pod, on any volume: it only needs internet). For each file the app signs a GET link for the source object and a PUT link for the target object and the pod
 * pipes one curl into the other (`curl GET | curl -T - -H Content-Length`): nothing is written to the pod's disk and nothing passes through this PC. Both links reach the pod only inside the ssh
 * script on stdin (as curl config read through process substitution, never on a command line). Nothing is ever deleted, a file already at the target at the same size is skipped, weights never go,
 * a file over 5 GB is a named warning (one PUT is the limit). No key or link is ever in a result, a message or a History line. Jobs are in memory (and the Queue, kind 'bucket-sync'); finished
 * ones are kept in a small file.
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
import { presign, signHeaders } from './s3presign.js'
import * as storage from './storage.js'
import { configDir } from './paths.js'

export const VOLUME_DEFAULT_PREFIX = 'comfy-shared/output/', RATE_MB_S = 11, PLAN_KEEP_MS = 3_600_000, KEEP_JOBS = 20, TOP_NAME = '(this folder)'
const WORKERS = 3, BREAKER = 5, POD_RECHECK_MS = 10_000, MAX_FAILED_KEPT = 2000
export const NO_POD = 'Needs a running pod to carry it'
export const NEEDS_PANAMA_KEYS = 'Needs the Panama keys saved in the app'

export type Source = { type: 'volume'; volume_id: string } | { type: 'storage'; storage_id: string }
export interface SourceRef { type: 'volume' | 'storage'; id: string; name: string }
export interface Req { source: Source; target: { storage_id: string }; prefix?: string; skip_folders?: string[]; run_on?: { pod_id?: string } }
export interface PodChoice { id: string; name: string; cost_per_hr: number | null }
export interface Plan {
  plan_id: string; source: SourceRef; target: { storage_id: string; name: string; bucket: string; prefix: string; region: string }; prefix: string
  files: number; bytes: number; to_copy: { files: number; bytes: number }; already_there: { files: number; bytes: number }; too_big: { files: number; names: string[] }
  excluded_weights: number; folders: { name: string; files: number; bytes: number; skipped: boolean }[]
  /** the pod that will carry it (run_on.pod_id, else the first running pod with SSH), null when none */
  pod: PodChoice | null; /** every running pod with SSH, for a Run On picker */ pods: { id: string; name: string }[]
  estimate: { hours: number; usd: number; rate_mb_s: number }; can_start: boolean; reason?: string
}
export interface PlanStatus { state: 'listing' | 'done' | 'failed' | 'cancelled'; files_so_far: number; error?: string; plan?: Plan }
export type JobState = 'copying' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
export interface Job {
  job_id: string; kind: 'bucket-sync'; state: JobState; source: SourceRef; target: { storage_id: string; name: string }; pod: { id: string; name: string }; started_at: string; finished_at?: string
  files_total: number; files_done: number; files_skipped: number; files_failed: number; bytes_total: number; bytes_done: number; rate: number; current: string; warnings: string[]; error?: string
}
/** key: the FULL object key in the source bucket (a storage's directory included); rel: the path below the plan's prefix (the target key is the target directory + rel) */
interface Item { key: string; rel: string; bytes: number }

export interface Deps { now(): number; /** the pod's hourly price, null when unknown */ podPrice(podId: string): Promise<number | null>; workers: number }
const defaults = (): Deps => ({
  now: () => Date.now(), workers: WORKERS,
  podPrice: async (id) => { try { if (mounts.dryRun(mounts.load())) return 0; const r = await rp.getPod(id); return typeof r?.costPerHr === 'number' && r.costPerHr >= 0 ? r.costPerHr : null } catch { return null } },
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

interface PlanRec { id: string; req: { source: Source; target_id: string; prefix: string; skip: string[]; pod_id?: string }; ac: AbortController; state: PlanStatus['state']; seen: number; error?: string; plan?: Plan; todo: Item[]; done: Set<string>; at: number; podCheckedAt: number; done_p?: Promise<void> }
interface JobRec { view: Job; ac: AbortController; items: Item[]; failed: Item[]; source: Source; target_id: string; prefix: string; pod_id: string; plan_id: string; done: Promise<void>; stop?: () => void; ended: boolean }
const plans = new Map<string, PlanRec>(), jobs = new Map<string, JobRec>()
type Finished = Job & { _failed?: Item[]; _source?: Source; _target?: string; _prefix?: string; _pod_id?: string }
let finished: Finished[] = [], loaded: Promise<void> | null = null, writing: Promise<void> = Promise.resolve(), seq = 0
const iso = () => new Date(deps.now()).toISOString()
const jobsFile = () => process.env.BUCKET_SYNC_JOBS_FILE || join(configDir(), 'bucket-sync-jobs.json')
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
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

function cleanPrefix(p: unknown, def: string): string {
  const s = p === undefined || p === null ? def : String(p)
  if (!s) return ''
  if (!/^[\w .+@=,()/-]{1,300}$/.test(s) || s.startsWith('/') || s.split('/').includes('..') || s.includes('//')) throw bad(`Not a folder in the source: ${s.slice(0, 80)}`)
  return s.replace(/\/+$/, '') + '/'
}
const parseLs = (out: string): { key: string; bytes: number }[] => {
  const r: { key: string; bytes: number }[] = []
  for (const line of out.split('\n')) { const f = /^\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d\s+(\d+)\s+(.+)$/.exec(line); if (f && !f[2].endsWith('/')) r.push({ key: f[2], bytes: Number(f[1]) }) }
  return r
}
function normSource(raw: unknown): Source {
  const s = (raw ?? {}) as Record<string, unknown>
  if (s.type === 'volume') { const id = String(s.volume_id ?? '').trim(); if (!id) throw bad('source.volume_id is needed'); return { type: 'volume', volume_id: id } }
  if (s.type === 'storage') { const id = String(s.storage_id ?? '').trim(); if (!id) throw bad('source.storage_id is needed'); return { type: 'storage', storage_id: storage.isBh(id) ? storage.PANAMA_ID : id } }
  throw bad("source.type is 'volume' or 'storage'")
}

// ----- access -----
/** A storage or the BH bucket as a source: how to list it and how to sign a read. `keys` null: only an AWS profile (listing works, a signed link cannot be made). */
interface BucketAcc { name: string; bucket: string; prefix: string; env: Record<string, string>; common: string[]; endpoint: string; region: string; keys: { id: string; secret: string } | null; bh: boolean }
function bucketAcc(id: string): BucketAcc {
  if (storage.isBh(id)) { const a = storage.panamaAccess(); return { ...a, bh: true } }
  return { ...storage.storageAccess(id), bh: false }
}
const secretsOf = (...a: ({ keys: { id: string; secret: string } | null } | null)[]): string[] => a.flatMap((x) => (x?.keys ? [x.keys.id, x.keys.secret] : []))
/** The target is a real storage: Wasabi or your own. The BH bucket is never a target (publishing to the client stays in Publishing). */
function targetAcc(id: string): storage.Access {
  if (storage.isBh(id)) throw bad('The BH exchange bucket is never a target here: publishing to the client stays in Publishing (its own approval and guards)')
  return storage.storageAccess(id)
}
function sourceRef(s: Source): SourceRef { return s.type === 'storage' ? { type: 'storage', id: s.storage_id, name: bucketAcc(s.storage_id).name } : { type: 'volume', id: s.volume_id, name: s.volume_id } }

/** host and path of one object: a custom endpoint and the BH bucket are path style; AWS with a plain bucket name is virtual-hosted. */
function where(a: { bucket: string; endpoint: string; region: string }, key: string, pathStyle: boolean): { host: string; path: string } {
  if (a.endpoint) return { host: new URL(a.endpoint).host, path: `/${a.bucket}/${key}` }
  if (!pathStyle && !a.bucket.includes('.')) return { host: `${a.bucket}.s3.${a.region}.amazonaws.com`, path: `/${key}` }
  return { host: `s3.${a.region}.amazonaws.com`, path: `/${a.bucket}/${key}` }
}
interface Link { url: string; headers: string[] }
interface Reader { link(key: string): Link; secrets: string[] }
const EXPIRES_S = publish.PUT_EXPIRES_S
/** How a source object is read: a storage or the BH bucket by a presigned GET; a network volume (RunPod's S3 API answers a presigned URL with 401) by a signed Authorization header. */
async function readerFor(s: Source, now: () => number): Promise<Reader | { problem: string }> {
  if (s.type === 'volume') {
    const a = await publish.volumeS3Access(s.volume_id)
    if (!a.ok) return { problem: scrub(a.reason) }
    const host = new URL(a.endpoint).host
    return { secrets: [a.id, a.secret], link: (key) => { const h = signHeaders({ host, path: `/${a.bucket}/${key}`, accessKey: a.id, secretKey: a.secret, region: a.region, now: new Date(now()) }); return { url: h.url, headers: Object.entries(h.headers).map(([k, v]) => `${k}: ${v}`) } } }
  }
  const a = bucketAcc(s.storage_id)
  if (!a.keys) return { problem: NEEDS_PANAMA_KEYS }
  const keys = a.keys
  return { secrets: [keys.id, keys.secret], link: (key) => { const w = where(a, key, a.bh); return { url: presign({ method: 'GET', host: w.host, path: w.path, accessKey: keys.id, secretKey: keys.secret, region: a.region, expires: EXPIRES_S, now: new Date(now()) }), headers: [] } } }
}
function putLink(t: storage.Access, key: string, now: () => number): string {
  const w = where(t, key, false)
  return presign({ method: 'PUT', host: w.host, path: w.path, accessKey: t.keys.id, secretKey: t.keys.secret, region: t.region, expires: EXPIRES_S, now: new Date(now()) })
}

/**
 * The script one pod runs for one file. Both links (and a volume's signed headers) are curl config text inside this script, which travels on ssh's stdin; each curl reads its config through
 * process substitution (`-K <(...)`, a pipe, no file, never an argument), because the pipe's own stdin is the data. The GET streams into `curl -T -` with the known Content-Length, so a short
 * body makes the PUT fail, and `pipefail` fails the file when either side fails. Prints PUBLISH-PID, then PUBLISH-OK or PUBLISH-FAIL, like publish.putScript.
 */
export function streamScript(get: Link, putUrl: string, bytes: number): string {
  const okUrl = (u: string) => /^https:\/\/[\w.-]+(:\d+)?\/[^\s"'`\\$]+$/.test(u)
  if (!okUrl(get.url) || !okUrl(putUrl)) throw new Error('the signed link looks wrong')
  if (get.headers.some((h) => !/^[\w-]+: [^\r\n"\\]+$/.test(h))) throw new Error('the signed header looks wrong')
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('the size looks wrong')
  const opts = '-fsS --connect-timeout 30 --speed-limit 1024 --speed-time 120'
  return ['set -u', 'set -o pipefail', 'echo "PUBLISH-PID $$"',
    'bucket_get_cfg() { cat <<\'BUCKET_GET\'', `url = "${get.url}"`, ...get.headers.map((h) => `header = "${h}"`), 'BUCKET_GET', '}',
    'bucket_put_cfg() { cat <<\'BUCKET_PUT\'', `url = "${putUrl}"`, 'BUCKET_PUT', '}',
    `curl ${opts} -o - -K <(bucket_get_cfg) | curl ${opts} -o /dev/null -T - -H "Transfer-Encoding:" -H "Content-Length: ${bytes}" -K <(bucket_put_cfg)`,
    'rc=$?; if [ $rc -eq 0 ]; then echo "PUBLISH-OK"; else echo "PUBLISH-FAIL curl exit $rc"; fi', 'exit $rc', ''].join('\n')
}

// ----- plan -----
export async function plan(req: Req): Promise<{ plan_id: string }> {
  const r = (req ?? {}) as Req, source = normSource(r.source), target_id = String(r.target?.storage_id ?? '').trim()
  if (!target_id) throw bad('target.storage_id is needed')
  const prefix = cleanPrefix(r.prefix, source.type === 'volume' ? VOLUME_DEFAULT_PREFIX : '')
  if (r.skip_folders !== undefined && (!Array.isArray(r.skip_folders) || r.skip_folders.some((x) => typeof x !== 'string'))) throw bad('skip_folders is a list of folder names')
  const pod_id = r.run_on?.pod_id
  if (pod_id !== undefined && pod_id !== null && pod_id !== '' && !/^[A-Za-z0-9]{6,32}$/.test(String(pod_id))) throw bad('run_on.pod_id looks wrong')
  targetAcc(target_id)   // refuses early: the BH bucket, a missing storage, one that is not ready
  if (source.type === 'storage' && source.storage_id === target_id) throw bad('A storage cannot be both From and To: choose another target')
  sourceRef(source)   // refuses early: a storage that is not ready, or the BH bucket while its switch is off
  const id = `bs-plan-${deps.now().toString(36)}-${(++seq).toString(36)}`
  for (const [k, p] of plans) if (deps.now() - p.at > PLAN_KEEP_MS) plans.delete(k)
  const rec: PlanRec = { id, req: { source, target_id, prefix, skip: (r.skip_folders ?? []).map(String), ...(pod_id ? { pod_id: String(pod_id) } : {}) }, ac: new AbortController(), state: 'listing', seen: 0, todo: [], done: new Set(), at: deps.now(), podCheckedAt: 0 }
  plans.set(id, rec)
  rec.done_p = doPlan(rec).catch((e) => { if (rec.ac.signal.aborted) rec.state = 'cancelled'; else { rec.state = 'failed'; rec.error = scrub((e as Error).message) } })
  return { plan_id: id }
}

async function resolvePod(wanted?: string): Promise<{ pod: PodChoice | null; pods: { id: string; name: string }[]; ref?: publish.PodRef; reason?: string }> {
  let list: publish.PodRef[] = []
  try { list = await publish.runningPodsAny() } catch { list = [] }
  const pods = list.map((p) => ({ id: p.id, name: p.name })), p = wanted ? list.find((x) => x.id === wanted) : list[0]
  if (!p) return { pod: null, pods, reason: wanted ? 'That pod is not running. Resume it or choose another, then Start.' : NO_POD }
  return { pod: { id: p.id, name: p.name, cost_per_hr: await deps.podPrice(p.id).catch(() => null) }, pods, ref: p }
}
const estimateOf = (bytes: number, perHr: number | null): Plan['estimate'] => { const hours = bytes / (RATE_MB_S * 1e6) / 3600; return { hours: round(hours, 2), usd: perHr ? round(hours * perHr, 2) : 0, rate_mb_s: RATE_MB_S } }

async function doPlan(rec: PlanRec): Promise<void> {
  const { source, target_id, prefix, skip } = rec.req, sig = rec.ac.signal
  const abortable = <T>(p: Promise<T>): Promise<T> => new Promise<T>((res, rej) => { const on = () => rej(new CoreError(499, 'The plan was cancelled')); if (sig.aborted) return on(); sig.addEventListener('abort', on, { once: true }); p.then(res, rej).finally(() => sig.removeEventListener('abort', on)) })
  const tgt = targetAcc(target_id), src = source.type === 'storage' ? bucketAcc(source.storage_id) : null
  const secrets = secretsOf(tgt, src)
  // the source
  let keys: { key: string; bytes: number }[]
  if (source.type === 'volume') {
    const ks = await abortable(publish.listVolume(source.volume_id, prefix, { signal: sig, onSeen: (n) => { rec.seen = Math.max(rec.seen, n) } }))
    if (ks === null) throw new CoreError(502, "RunPod's S3 API cannot be used for this volume (no keys in Default Configuration, or a datacenter without it)")
    keys = ks.filter((k) => k.key.startsWith(prefix))
  } else {
    const s = src as BucketAcc
    try {
      const ls = await abortable(storage.aws(['s3', 'ls', `s3://${s.bucket}/${s.prefix}${prefix}`, '--recursive', ...s.common], s.env, { signal: sig, stallMs: 120_000, onLines: (n) => { rec.seen = Math.max(rec.seen, n) } }))
      if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new CoreError(502, `The source could not be read: ${ls.transient ? podpull.STORAGE_UNREACHABLE : scrub(ls.stderr || ls.stdout, secrets)}`)
      keys = parseLs(ls.stdout).filter((k) => k.key.startsWith(s.prefix)).map((k) => ({ key: k.key, bytes: k.bytes }))   // full keys; the storage's directory stays in
    } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(502, `The source could not be read: ${scrub((e as Error).message, secrets)}`) }
  }
  rec.seen = Math.max(rec.seen, keys.length)
  const base = src ? src.prefix : ''   // what a key carries before the plan's prefix
  // the target under its directory
  let there = new Map<string, number>()
  try {
    const ls = await abortable(storage.aws(['s3', 'ls', `s3://${tgt.bucket}/${tgt.prefix}`, '--recursive', ...tgt.common], tgt.env, { signal: sig, stallMs: 120_000 }))
    if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new CoreError(502, `The target storage could not be read: ${ls.transient ? podpull.STORAGE_UNREACHABLE : scrub(ls.stderr || ls.stdout, secrets)}`)
    for (const k of parseLs(ls.stdout)) there.set(k.key, k.bytes)
  } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(502, `The target storage could not be read: ${scrub((e as Error).message, secrets)}`) }
  if (sig.aborted) throw new CoreError(499, 'The plan was cancelled')

  const folders = new Map<string, { files: number; bytes: number }>(), skipSet = new Set(skip.map((s) => s.replace(/\/+$/, '')))
  let files = 0, bytes = 0, weights = 0, bigFiles = 0, thereF = 0, thereB = 0, copyB = 0
  const big: string[] = [], todo: Item[] = []
  for (const k of keys) {
    if (k.key.endsWith('/') || !k.key.startsWith(base + prefix)) continue
    const rel = k.key.slice(base.length + prefix.length)
    if (!rel || rel.split('/').some((s) => !s || s === '.' || s === '..')) continue
    if (publish.isWeight(rel)) { weights++; continue }
    const segs = rel.split('/'), top = segs.length > 1 ? segs[0] : TOP_NAME
    const f = folders.get(top) ?? { files: 0, bytes: 0 }; f.files++; f.bytes += k.bytes; folders.set(top, f)
    if (top !== TOP_NAME && skipSet.has(top)) continue
    files++; bytes += k.bytes
    if (k.bytes > publish.PUT_MAX_BYTES) { bigFiles++; if (big.length < 20) big.push(rel); continue }
    if (there.get(`${tgt.prefix}${rel}`) === k.bytes) { thereF++; thereB += k.bytes; continue }
    todo.push({ key: k.key, rel, bytes: k.bytes }); copyB += k.bytes
  }
  rec.todo = todo
  const rp0 = await resolvePod(rec.req.pod_id)
  rec.podCheckedAt = deps.now()
  const p: Plan = {
    plan_id: rec.id, source: sourceRef(source), target: { storage_id: tgt.id, name: tgt.name, bucket: tgt.bucket, prefix: tgt.prefix, region: tgt.region }, prefix, files, bytes,
    to_copy: { files: todo.length, bytes: copyB }, already_there: { files: thereF, bytes: thereB }, too_big: { files: bigFiles, names: big }, excluded_weights: weights,
    folders: [...folders].map(([name, v]) => ({ name, ...v, skipped: name !== TOP_NAME && skipSet.has(name) })).sort((a, b) => a.name.localeCompare(b.name)),
    pod: rp0.pod, pods: rp0.pods, estimate: estimateOf(copyB, rp0.pod?.cost_per_hr ?? null), can_start: false,
  }
  if (rp0.reason && !rp0.pod) p.reason = rp0.reason
  setStart(p, source)
  rec.plan = p; rec.state = 'done'
}
function setStart(p: Plan, source: Source): void {
  if (!p.pod) { p.can_start = false; p.reason = p.reason || NO_POD }
  else if (source.type === 'storage' && storage.isBh(source.storage_id) && !storage.panamaAccess().keys) { p.can_start = false; p.reason = NEEDS_PANAMA_KEYS }
  else if (!p.to_copy.files) { p.can_start = false; p.reason = p.already_there.files ? 'Everything is already in the storage.' : 'There is nothing to copy.' }
  else { p.can_start = true; delete p.reason }
}

export async function planStatus(plan_id: string): Promise<PlanStatus> {
  const rec = plans.get(String(plan_id))
  if (!rec) throw new CoreError(404, 'No such plan (a plan is kept for an hour): plan again')
  if (rec.state === 'done' && rec.plan && !rec.plan.pod && deps.now() - rec.podCheckedAt > POD_RECHECK_MS) {   // a person may have resumed a pod since: look again (not more than every 10 s)
    rec.podCheckedAt = deps.now()
    const r = await resolvePod(rec.req.pod_id)
    rec.plan.pods = r.pods
    if (r.pod) { rec.plan.pod = r.pod; rec.plan.estimate = estimateOf(rec.plan.to_copy.bytes, r.pod.cost_per_hr); delete rec.plan.reason } else if (r.reason) rec.plan.reason = r.reason
    try { setStart(rec.plan, rec.req.source) } catch { /* the switch went off meanwhile: Start says so */ }
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
  if (rec.state !== 'done' || !rec.plan) throw bad(rec.state === 'listing' ? 'The plan is still listing the source' : 'The plan did not finish: plan again')
  const p = rec.plan, tgt = targetAcc(p.target.storage_id)
  const items = rec.todo.filter((i) => !rec.done.has(i.rel))
  if (!items.length) throw bad('Everything in this plan is already in the storage.')
  const reader = await readerFor(rec.req.source, deps.now); if ('problem' in reader) throw bad(reader.problem)
  const { pod, reason } = await resolvePod(rec.req.pod_id)
  if (!pod) throw bad(reason || NO_POD)
  const warnings = p.too_big.names.map((n) => `${n}: over 5 GB, not copied (one upload is at most 5 GB)`)
  if (p.too_big.files > p.too_big.names.length) warnings.push(`${p.too_big.files - p.too_big.names.length} more file(s) over 5 GB were not copied`)
  return launch({ plan_id: rec.id, source: rec.req.source, ref: p.source, target_id: tgt.id, target_name: tgt.name, prefix: p.prefix, pod, items, skipped: p.already_there.files, warnings, approved_by: req.approved_by, on_done: (rel) => rec.done.add(rel) })
}

function launch(o: { plan_id: string; source: Source; ref: SourceRef; target_id: string; target_name: string; prefix: string; pod: PodChoice; items: Item[]; skipped: number; warnings: string[]; approved_by?: string; on_done?: (rel: string) => void }): { job_id: string } {
  const id = `bs-${deps.now().toString(36)}-${(++seq).toString(36)}`, ac = new AbortController(), who = history.currentOrigin()
  const bytes_total = o.items.reduce((a, i) => a + i.bytes, 0)
  const view: Job = { job_id: id, kind: 'bucket-sync', state: 'copying', source: { ...o.ref }, target: { storage_id: o.target_id, name: o.target_name }, pod: { id: o.pod.id, name: o.pod.name }, started_at: iso(), files_total: o.items.length + o.skipped, files_done: 0, files_skipped: o.skipped, files_failed: 0, bytes_total, bytes_done: 0, rate: 0, current: '', warnings: [...o.warnings] }
  const rec: JobRec = { view, ac, items: o.items, failed: [], source: o.source, target_id: o.target_id, prefix: o.prefix, pod_id: o.pod.id, plan_id: o.plan_id, done: Promise.resolve(), ended: false }
  jobs.set(id, rec)
  const by = o.approved_by ?? who?.approved_by, tag = by ? ` approved by ${String(by).slice(0, 80)}` : ''
  const what = `${o.ref.name} to ${o.target_name}`
  history.record({ kind: 'change', area: 'volume', action: 'bucket sync started', what, detail: `${o.items.length} file(s), ${gb(bytes_total)}, pod ${o.pod.name}${tag}` })
  const origin: jobsregistry.Origin = who?.source === 'mcp' ? 'mcp' : 'window'
  rec.stop = jobsregistry.track({ id, kind: 'bucket-sync', trigger: 'manual', origin, ...(origin === 'mcp' && who?.client ? { client: who.client } : {}), ...(by ? { approved_by: String(by).slice(0, 80) } : {}), label: `sync ${o.ref.name} to ${o.target_name}`, started_at: view.started_at,
    view: () => ({ state: view.state, terminal: rec.ended, progress: { done: view.files_done + view.files_skipped, total: view.files_total, unit: 'files' }, transfer: { bytes_done: view.bytes_done, bytes_total: view.bytes_total, rate_bps: view.rate, ...(view.current ? { current: view.current } : {}), skipped: view.files_skipped, pods: [o.pod.name] } }),
    cancel: () => { void cancel(id).catch(() => undefined) } })
  rec.done = run(rec, o.on_done).catch((e) => { if (view.state === 'copying') { view.state = ac.signal.aborted ? 'cancelled' : 'failed'; if (view.state === 'failed') view.error = scrub((e as Error).message) } }).finally(() => end(rec))
  return { job_id: id }
}

async function run(rec: JobRec, onDone?: (rel: string) => void): Promise<void> {
  const v = rec.view, sig = rec.ac.signal
  const tgt = targetAcc(rec.target_id), reader = await readerFor(rec.source, deps.now)
  if ('problem' in reader) throw new Error(reader.problem)
  const secrets = [...reader.secrets, tgt.keys.id, tgt.keys.secret]
  const pods = await publish.runningPodsAny().catch(() => [] as publish.PodRef[]), pod = pods.find((x) => x.id === rec.pod_id)
  if (!pod) throw new Error('The pod stopped running before the copy began')
  const queue = [...rec.items], t0 = deps.now()
  let streak = 0, tripped = false
  const worker = async () => {
    while (!sig.aborted && !tripped) {
      const it = queue.shift(); if (!it) return
      v.current = basename(it.rel)
      let r: { ok: boolean; error: string }
      try {
        const script = streamScript(reader.link(it.key), putLink(tgt, `${tgt.prefix}${it.rel}`, deps.now), it.bytes)   // signed just before the file; the script is never logged
        r = await publish.podStream(pod, script, it.bytes, sig, secrets)
      } catch (e) { r = { ok: false, error: (e as Error).message } }
      if (sig.aborted && !r.ok) return
      if (r.ok) { streak = 0; v.files_done++; v.bytes_done += it.bytes; onDone?.(it.rel) } else {
        streak++; v.files_failed++; rec.failed.push(it)
        if (v.warnings.length < 50) v.warnings.push(`${basename(it.rel)}: ${scrub(r.error, secrets)}`)
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
  const what = `${v.source.name} to ${v.target.name}`
  history.record({ kind: 'change', area: 'volume', action: `bucket sync ${v.state.replace(/_/g, ' ')}`, what, detail: `${v.files_done} sent (${gb(v.bytes_done)}), ${v.files_skipped} already there, ${v.files_failed} failed${v.error ? `; ${v.error}` : ''}` })
  for (const w of v.warnings.slice(0, 5)) if (v.files_failed) history.record({ kind: 'change', area: 'volume', action: 'bucket sync file failed', what, detail: w })
  finished = [{ ...structuredClone(v), _failed: rec.failed.slice(0, MAX_FAILED_KEPT).map((i) => ({ ...i })), _source: rec.source, _target: rec.target_id, _prefix: rec.prefix, _pod_id: rec.pod_id }, ...finished.filter((f) => f.job_id !== v.job_id)].slice(0, KEEP_JOBS)
  jobs.delete(v.job_id); persist()
}

// ----- status, cancel, retry -----
const pub = (j: Job): Job => { const { job_id, kind, state, source, target, pod, started_at, finished_at, files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings, error } = j; return { job_id, kind, state, source: { ...source }, target: { ...target }, pod: { ...pod }, started_at, ...(finished_at ? { finished_at } : {}), files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings: [...warnings], ...(error ? { error } : {}) } }
export async function status(job_id?: string): Promise<{ jobs: Job[] }> {
  await ensureLoaded()
  const all = [...[...jobs.values()].map((r) => pub(r.view)).reverse(), ...finished.filter((f) => !jobs.has(f.job_id)).map(pub)]
  if (job_id) { const j = all.find((x) => x.job_id === job_id); if (!j) throw new CoreError(404, `No such bucket sync job: ${job_id}`); return { jobs: [j] } }
  return { jobs: all }
}
export async function cancel(job_id: string): Promise<Job> {
  const rec = jobs.get(String(job_id))
  if (!rec) { const f = (await status(job_id).catch(() => null))?.jobs[0]; if (f) return f; throw new CoreError(404, `No such bucket sync job: ${job_id}`) }
  rec.ac.abort(); if (rec.view.state === 'copying') rec.view.state = 'cancelled'
  await rec.done
  return pub(rec.view)
}
export async function retry(job_id: string): Promise<{ job_id: string }> {
  await ensureLoaded()
  const id = String(job_id)
  if (jobs.has(id)) throw bad('That job is still running')
  const f = finished.find((x) => x.job_id === id); if (!f) throw new CoreError(404, `No such bucket sync job: ${id}`)
  const failed = f._failed ?? []
  if (!failed.length || !f._source || !f._target) throw bad('That job has no failed files')
  const tgt = targetAcc(f._target), ref = sourceRef(f._source)
  const reader = await readerFor(f._source, deps.now); if ('problem' in reader) throw bad(reader.problem)
  const first = await resolvePod(f._pod_id), use = first.pod ?? (await resolvePod()).pod
  if (!use) throw bad(first.reason || NO_POD)
  return launch({ plan_id: '', source: f._source, ref, target_id: tgt.id, target_name: tgt.name, prefix: f._prefix ?? '', pod: use, items: failed.map((x) => ({ ...x })), skipped: 0, warnings: [] })
}

/** Tests: forget everything. */
export function reset(): void { for (const r of jobs.values()) { r.ac.abort(); r.stop?.() } for (const p of plans.values()) p.ac.abort(); jobs.clear(); plans.clear(); finished = []; loaded = null; writing = Promise.resolve(); seq = 0; setDeps(null) }
