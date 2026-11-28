/**
 * Download to this PC from a network volume or a storage (docs/ADR-067, phase 1). Two steps like volumesync: `plan` lists the source (a volume over RunPod's S3 API, no pod; a storage under
 * its directory) and looks at this PC's folder, `start` downloads from that plan with `aws s3 cp` (3 at a time). Nothing is ever deleted or overwritten here: a file already on this PC at the
 * same size is skipped, a file of ANOTHER size is a conflict (listed in the plan, left alone, a warning), weights never come, a download goes to a temp name and is renamed so a stopped copy
 * never leaves a half file, keys that could leave the destination (`..`, absolute, a link on the way) are refused. No key or link is ever in a result, a message or a History line.
 * Jobs are in memory (and the Queue, kind 'source-sync'); finished ones are kept in a small file.
 */
import { lstat, mkdir, readFile, realpath, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { bad, CoreError } from './errors.js'
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'
import * as mounts from './mounts.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import * as storage from './storage.js'
import { configDir } from './paths.js'

export const MAPPED = ['comfy-shared', 'project', 'plates'] as const
export const PLAN_KEEP_MS = 3_600_000, KEEP_JOBS = 20, TOP_NAME = '(this folder)', SPACE_MARGIN = 1024 ** 3, NOT_MAPPED = 'not mapped on this PC'
const WORKERS = 3, BREAKER = 5, MAX_FAILED_KEPT = 2000, MAX_NAMES = 20

export type Source = { type: 'volume'; volume_id: string } | { type: 'storage'; storage_id: string }
export interface SourceRef { type: 'volume' | 'storage'; id: string; name: string }
export interface Req { source: Source; prefix?: string; skip_folders?: string[]; dest_dir?: string }
export interface Folder { name: string; files: number; bytes: number; skipped: boolean; reason?: string; /** where this folder lands on this PC (a volume source with the mapped folders) */ dir?: string }
export interface Plan {
  plan_id: string; source: SourceRef; prefix: string; dest: { dir: string; note?: string; dirs?: { name: string; dir: string }[] }
  files: number; bytes: number; to_copy: { files: number; bytes: number }; already_there: { files: number; bytes: number }
  conflicts: { files: number; names: string[] }; unsafe: { files: number; names: string[] }
  excluded_weights: number; folders: Folder[]; free_bytes: number | null; can_start: boolean; reason?: string
}
export interface PlanStatus { state: 'listing' | 'done' | 'failed' | 'cancelled'; files_so_far: number; error?: string; plan?: Plan }
export type JobState = 'downloading' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
export interface Job {
  job_id: string; kind: 'source-sync'; state: JobState; source: SourceRef; dest_dir: string; started_at: string; finished_at?: string
  files_total: number; files_done: number; files_skipped: number; files_failed: number; bytes_total: number; bytes_done: number; rate: number; current: string; warnings: string[]; error?: string
}
/** key: the object key; root: the local folder it lands in; sub: the path below root (a plain relative path, checked again before every download) */
interface Item { key: string; root: string; sub: string; bytes: number }
interface Unit { listPrefix: string; relStrip: string; subStrip: string; root: string | null; reason?: string }

export interface Deps { now(): number; workers: number; /** free bytes on the disk that holds this path (an existing folder) */ free(path: string): Promise<number | null> }
const defaults = (): Deps => ({ now: () => Date.now(), workers: WORKERS, free: async (p) => { try { const s = await statfs(p); return Number(s.bavail) * Number(s.bsize) } catch { return null } } })
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

interface PlanRec { id: string; req: { source: Source; prefix: string; skip: string[]; dest_dir?: string }; ac: AbortController; state: PlanStatus['state']; seen: number; error?: string; plan?: Plan; todo: Item[]; done: Set<string>; at: number; done_p?: Promise<void> }
interface JobRec { view: Job; ac: AbortController; items: Item[]; failed: Item[]; source: Source; plan_id: string; done: Promise<void>; stop?: () => void; ended: boolean }
const plans = new Map<string, PlanRec>(), jobs = new Map<string, JobRec>()
type Finished = Job & { _failed?: Item[]; _source?: Source }
let finished: Finished[] = [], loaded: Promise<void> | null = null, writing: Promise<void> = Promise.resolve(), seq = 0
const iso = () => new Date(deps.now()).toISOString()
const jobsFile = () => process.env.SOURCE_SYNC_JOBS_FILE || join(configDir(), 'source-sync-jobs.json')
const ensureLoaded = (): Promise<void> => (loaded ??= readFile(jobsFile(), 'utf8').then((t) => { const j = JSON.parse(t); if (Array.isArray(j) && !finished.length) finished = j.slice(0, KEEP_JOBS) }).catch(() => undefined))
const persist = (): void => {
  writing = writing.then(async () => { const f = jobsFile(), tmp = `${f}.${process.pid}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(tmp, JSON.stringify(finished), { mode: 0o600 }); await rename(tmp, f) }).catch(() => undefined)
}
/** Plain text only: no key, link or long text. */
const scrub = (t: string, extra: (string | undefined)[] = []): string => {
  let s = publish.redact(String(t).split('\n')[0].trim() || 'failed').slice(0, 200)
  for (const v of extra) if (v) s = s.split(v).join('***')
  return s.replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, '***').replace(/https?:\/\/\S+/g, '(link)')
}
const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`

function cleanPrefix(p: unknown): string {
  const s = p === undefined || p === null ? '' : String(p)
  if (!s) return ''
  if (!/^[\w .+@=,()/-]{1,300}$/.test(s) || s.startsWith('/') || s.split('/').includes('..') || s.includes('//')) throw bad(`Not a folder in the source: ${s.slice(0, 80)}`)
  return s.replace(/\/+$/, '') + '/'
}
const parseLs = (out: string): { key: string; bytes: number }[] => {
  const r: { key: string; bytes: number }[] = []
  for (const line of out.split('\n')) { const f = /^\d{4}-\d\d-\d\d\s+\d\d:\d\d:\d\d\s+(\d+)\s+(.+)$/.exec(line); if (f && !f[2].endsWith('/')) r.push({ key: f[2], bytes: Number(f[1]) }) }
  return r
}
const safeSub = (rel: string): boolean => !!rel && !rel.includes('\0') && !isAbsolute(rel) && rel.split('/').every((s) => s && s !== '.' && s !== '..')
const absDir = (d: string): boolean => isAbsolute(d) && !d.includes('\0') && !d.split(/[\\/]/).includes('..')

// ----- where things go -----
/** A storage, or the BH exchange bucket (`panama-s3`, also `publish-s3`: the one Panama bucket; app keys or the AWS profile; refused when its switch is off). A SOURCE only. */
interface Acc { name: string; bucket: string; prefix: string; env: Record<string, string>; common: string[]; secrets: string[] }
function stAcc(id: string): Acc {
  if (storage.isBh(id)) { const a = storage.panamaAccess(); return { name: a.name, bucket: a.bucket, prefix: a.prefix, env: a.env, common: a.common, secrets: a.keys ? [a.keys.id, a.keys.secret] : [] } }
  const a = storage.storageAccess(id); return { name: a.name, bucket: a.bucket, prefix: a.prefix, env: a.env, common: a.common, secrets: [a.keys.id, a.keys.secret] }
}
function sourceOf(s: Source): SourceRef {
  if (s.type === 'storage') return { type: 'storage', id: s.storage_id, name: stAcc(s.storage_id).name }
  return { type: 'volume', id: s.volume_id, name: s.volume_id }
}
function normSource(raw: unknown): Source {
  const s = (raw ?? {}) as Record<string, unknown>
  if (s.type === 'volume') { const id = String(s.volume_id ?? '').trim(); if (!id) throw bad('source.volume_id is needed'); return { type: 'volume', volume_id: id } }
  if (s.type === 'storage') { const id = String(s.storage_id ?? '').trim(); if (!id) throw bad('source.storage_id is needed'); return { type: 'storage', storage_id: storage.isBh(id) ? storage.PANAMA_ID : id } }
  throw bad("source.type is 'volume' or 'storage'")
}
/** The listing units of a plan: what to list, how a key becomes `rel` (for skip and folders) and a path below its local root. */
function unitsOf(source: Source, prefix: string, destDir: string | undefined, cfg: mounts.MountsConfig): Unit[] {
  const local = (n: string) => (cfg.folders[n] || '').trim()
  if (source.type === 'storage') return [{ listPrefix: prefix, relStrip: prefix, subStrip: prefix, root: destDir ?? (local('comfy-shared') ? join(local('comfy-shared'), 'output') : null) }]
  if (destDir) return [{ listPrefix: prefix, relStrip: prefix, subStrip: prefix, root: destDir }]
  if (!prefix) return MAPPED.map((n) => ({ listPrefix: `${n}/`, relStrip: '', subStrip: `${n}/`, root: local(n) || null, ...(local(n) ? {} : { reason: NOT_MAPPED }) }))
  const top = prefix.split('/')[0], ok = (MAPPED as readonly string[]).includes(top) && local(top)
  return [{ listPrefix: prefix, relStrip: prefix, subStrip: `${top}/`, root: ok ? local(top) : null, ...(ok ? {} : { reason: NOT_MAPPED }) }]
}
/** The nearest existing folder at or above a path, and its device. */
async function existingAncestor(p: string): Promise<{ path: string; dev: number } | null> {
  let cur = resolve(p)
  for (let i = 0; i < 64; i++) { try { const s = await stat(cur); if (s.isDirectory()) return { path: cur, dev: s.dev } } catch { /* not there yet */ } const up = dirname(cur); if (up === cur) return null; cur = up }
  return null
}
/** Free space per disk against what each disk must take: `free` is the smallest free figure, `ok` false names the first disk that is short. */
async function space(needs: { root: string; bytes: number }[]): Promise<{ free: number | null; ok: boolean; reason?: string }> {
  const byDev = new Map<number, { path: string; bytes: number }>()
  for (const n of needs) { const a = await existingAncestor(n.root); if (!a) continue; const e = byDev.get(a.dev) ?? { path: a.path, bytes: 0 }; e.bytes += n.bytes; byDev.set(a.dev, e) }
  let free: number | null = null, reason: string | undefined
  for (const e of byDev.values()) {
    const f = await deps.free(e.path); if (f === null) continue
    free = free === null ? f : Math.min(free, f)
    if (!reason && e.bytes > 0 && e.bytes + SPACE_MARGIN > f) reason = `Not enough free space on this PC: ${gb(e.bytes)} to copy, ${gb(f)} free (1 GB is kept spare).`
  }
  return { free, ok: !reason, ...(reason ? { reason } : {}) }
}

// ----- plan -----
export async function plan(req: Req): Promise<{ plan_id: string }> {
  const r = (req ?? {}) as Req, source = normSource(r.source), prefix = cleanPrefix(r.prefix)
  if (r.skip_folders !== undefined && (!Array.isArray(r.skip_folders) || r.skip_folders.some((x) => typeof x !== 'string'))) throw bad('skip_folders is a list of folder names')
  let dest_dir: string | undefined
  if (r.dest_dir !== undefined && r.dest_dir !== null && r.dest_dir !== '') {
    dest_dir = String(r.dest_dir).replace(/(.)\/+$/, '$1')
    if (!absDir(dest_dir)) throw bad('dest_dir must be a full folder path on this PC (no "..")')
    if (source.type === 'volume' && !prefix) throw bad('dest_dir with a volume needs a prefix naming one folder (the mapped folders are used otherwise)')
  }
  sourceOf(source)   // refuses early: a storage that is not ready, or not of this kind
  if (source.type === 'storage' && !dest_dir && !(mounts.load().folders['comfy-shared'] || '').trim()) throw bad('No local folder is mapped for a storage download: map ComfyUI-Shared in Default Configuration, or give dest_dir.')
  const id = `ss-plan-${deps.now().toString(36)}-${(++seq).toString(36)}`
  for (const [k, p] of plans) if (deps.now() - p.at > PLAN_KEEP_MS) plans.delete(k)
  const rec: PlanRec = { id, req: { source, prefix, skip: (r.skip_folders ?? []).map(String), ...(dest_dir ? { dest_dir } : {}) }, ac: new AbortController(), state: 'listing', seen: 0, todo: [], done: new Set(), at: deps.now() }
  plans.set(id, rec)
  rec.done_p = doPlan(rec).catch((e) => { if (rec.ac.signal.aborted) rec.state = 'cancelled'; else { rec.state = 'failed'; rec.error = scrub((e as Error).message) } })
  return { plan_id: id }
}

async function volumeAccess(volumeId: string): Promise<{ env: Record<string, string>; common: string[]; bucket: string; secrets: string[] }> {
  const a = await publish.volumeS3Access(volumeId)
  if (!a.ok) throw new CoreError(502, scrub(a.reason))
  return { env: { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret, AWS_REGION: a.region }, common: ['--endpoint-url', a.endpoint, '--region', a.region], bucket: a.bucket, secrets: [a.id, a.secret] }
}

async function listUnit(rec: PlanRec, u: Unit, sig: AbortSignal, base: number): Promise<{ key: string; bytes: number }[]> {
  const { source } = rec.req
  const abortable = <T>(p: Promise<T>): Promise<T> => new Promise<T>((res, rej) => { const on = () => rej(new CoreError(499, 'The plan was cancelled')); if (sig.aborted) return on(); sig.addEventListener('abort', on, { once: true }); p.then(res, rej).finally(() => sig.removeEventListener('abort', on)) })
  if (source.type === 'volume') {
    const keys = await abortable(publish.listVolume(source.volume_id, u.listPrefix, { signal: sig, onSeen: (n) => { rec.seen = Math.max(rec.seen, base + n) } }))
    if (keys === null) throw new CoreError(502, "RunPod's S3 API cannot be used for this volume (no keys in Default Configuration, or a datacenter without it)")
    return keys.filter((k) => k.key.startsWith(u.listPrefix))
  }
  const st = stAcc(source.storage_id)
  try {
    const ls = await abortable(storage.aws(['s3', 'ls', `s3://${st.bucket}/${st.prefix}${u.listPrefix}`, '--recursive', ...st.common], st.env, { signal: sig, stallMs: 120_000, onLines: (n) => { rec.seen = Math.max(rec.seen, base + n) } }))
    if (ls.code !== 0 && !(ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim())) throw new CoreError(502, `The storage could not be read: ${ls.transient ? podpull.STORAGE_UNREACHABLE : scrub(ls.stderr || ls.stdout, st.secrets)}`)
    return parseLs(ls.stdout).filter((k) => k.key.startsWith(st.prefix)).map((k) => ({ key: k.key.slice(st.prefix.length), bytes: k.bytes }))
  } catch (e) { if (e instanceof CoreError) throw e; throw new CoreError(502, `The storage could not be read: ${scrub((e as Error).message, st.secrets)}`) }
}

async function doPlan(rec: PlanRec): Promise<void> {
  const { source, prefix, dest_dir } = rec.req, sig = rec.ac.signal, skipSet = rec.req.skip
  const units = unitsOf(source, prefix, dest_dir, mounts.load())
  const skipped = (rel: string): boolean => { const s0 = rel.split('/')[0]; return skipSet.some((s) => { const t = s.replace(/\/+$/, ''); return t === s0 || (t.includes('/') && (rel === t || rel.startsWith(`${t}/`))) }) }
  const folders = new Map<string, Folder>(), todo: Item[] = [], conflictNames: string[] = [], unsafeNames: string[] = []
  let files = 0, bytes = 0, weights = 0, thereF = 0, thereB = 0, copyB = 0, conflictN = 0, unsafeN = 0, listed = 0
  const needs = new Map<string, number>()
  for (const u of units) {
    if (sig.aborted) throw new CoreError(499, 'The plan was cancelled')
    const keys = await listUnit(rec, u, sig, listed); listed += keys.length; rec.seen = Math.max(rec.seen, listed)
    const checks: { it: Item; rel: string }[] = []
    for (const k of keys) {
      if (k.key.endsWith('/') || !k.key.startsWith(u.relStrip)) continue
      const rel = k.key.slice(u.relStrip.length), top = rel.includes('/') ? rel.split('/')[0] : TOP_NAME
      if (!rel) continue
      if (!safeSub(rel)) { unsafeN++; if (unsafeNames.length < MAX_NAMES) unsafeNames.push(rel.slice(0, 120)); continue }
      if (publish.isWeight(rel)) { weights++; continue }
      const f = folders.get(top) ?? { name: top, files: 0, bytes: 0, skipped: false }
      f.files++; f.bytes += k.bytes; folders.set(top, f)
      if (!u.root) { f.skipped = true; f.reason = u.reason ?? NOT_MAPPED; continue }
      if (top !== TOP_NAME && skipSet.some((x) => x.replace(/\/+$/, '') === top)) { f.skipped = true; continue }
      if (skipped(rel)) continue
      const sub = k.key.slice(u.subStrip.length)
      if (!safeSub(sub)) { unsafeN++; if (unsafeNames.length < MAX_NAMES) unsafeNames.push(rel.slice(0, 120)); continue }
      files++; bytes += k.bytes
      checks.push({ it: { key: k.key, root: u.root, sub, bytes: k.bytes }, rel })
    }
    if (u.root && !needs.has(u.root)) needs.set(u.root, 0)
    for (let i = 0; i < checks.length; i += 64) {
      await Promise.all(checks.slice(i, i + 64).map(async ({ it, rel }) => {
        let ls: Awaited<ReturnType<typeof lstat>> | null = null
        try { ls = await lstat(join(it.root, it.sub)) } catch { ls = null }
        if (ls && ls.isFile() && ls.size === it.bytes) { thereF++; thereB += it.bytes; return }
        if (ls) { conflictN++; if (conflictNames.length < MAX_NAMES) conflictNames.push(rel.slice(0, 120)); return }
        todo.push(it); copyB += it.bytes; needs.set(it.root, (needs.get(it.root) ?? 0) + it.bytes)
      }))
    }
  }
  if (sig.aborted) throw new CoreError(499, 'The plan was cancelled')
  const roots = [...new Set(units.filter((u) => u.root).map((u) => u.root as string))]
  const sp = await space([...needs].map(([root, b]) => ({ root, bytes: b })))
  const single = roots.length === 1 ? roots[0] : ''
  const named = units.filter((u) => u.root && source.type === 'volume' && !dest_dir).map((u) => ({ name: u.subStrip.replace(/\/+$/, ''), dir: u.root as string }))
  const p: Plan = {
    plan_id: rec.id, source: sourceOf(source), prefix, dest: { dir: single, ...(roots.length > 1 ? { note: 'Each top-level folder goes to its mapped folder on this PC', dirs: named } : roots.length === 0 ? { note: units[0]?.reason ?? NOT_MAPPED } : source.type === 'storage' && !dest_dir ? { note: 'The mapped ComfyUI-Shared output folder' } : source.type === 'volume' && !dest_dir && named.length === 1 ? { note: `The folder mapped for ${named[0].name}`, dirs: named } : {}) },
    files, bytes, to_copy: { files: todo.length, bytes: copyB }, already_there: { files: thereF, bytes: thereB }, conflicts: { files: conflictN, names: conflictNames }, unsafe: { files: unsafeN, names: unsafeNames },
    excluded_weights: weights, folders: [...folders.values()].map((f) => ({ ...f, ...(dirOf(f, units) ? { dir: dirOf(f, units) } : {}) })).sort((a, b) => a.name.localeCompare(b.name)), free_bytes: sp.free, can_start: false,
  }
  if (!roots.length) p.reason = `Nothing to copy: ${units[0]?.reason ?? NOT_MAPPED}`
  else if (sp.reason) p.reason = sp.reason
  else if (!todo.length) p.reason = thereF ? 'Everything is already on this PC.' : conflictN ? 'Nothing to copy: the files that differ are left alone (see the conflicts).' : 'There is nothing to copy.'
  p.can_start = !p.reason
  rec.todo = todo; rec.plan = p; rec.state = 'done'
}
function dirOf(f: Folder, units: Unit[]): string | undefined {
  if (units.length === 1) return undefined
  return units.find((u) => u.subStrip === `${f.name}/` && u.root)?.root ?? undefined
}

export async function planStatus(plan_id: string): Promise<PlanStatus> {
  const rec = plans.get(String(plan_id))
  if (!rec) throw new CoreError(404, 'No such plan (a plan is kept for an hour): plan again')
  return { state: rec.state, files_so_far: rec.seen, ...(rec.error ? { error: rec.error } : {}), ...(rec.plan ? { plan: structuredClone(rec.plan) } : {}) }
}
/** Stop a plan that is still listing. */
export async function cancelPlan(plan_id: string): Promise<PlanStatus> {
  const rec = plans.get(String(plan_id)); if (!rec) throw new CoreError(404, 'No such plan')
  if (rec.state === 'listing') { rec.ac.abort(); rec.state = 'cancelled'; await rec.done_p }
  return planStatus(plan_id)
}

// ----- start -----
const bytesByRoot = (items: Item[]) => { const m = new Map<string, number>(); for (const i of items) m.set(i.root, (m.get(i.root) ?? 0) + i.bytes); return [...m].map(([root, bytes]) => ({ root, bytes })) }
export async function start(req: { plan_id: string; approved_by?: string }): Promise<{ job_id: string }> {
  await ensureLoaded()
  const rec = plans.get(String(req?.plan_id ?? ''))
  if (!rec) throw new CoreError(404, 'No such plan (a plan is kept for an hour): plan again')
  if (rec.state !== 'done' || !rec.plan) throw bad(rec.state === 'listing' ? 'The plan is still listing the source' : 'The plan did not finish: plan again')
  const p = rec.plan, items = rec.todo.filter((i) => !rec.done.has(i.sub + '\0' + i.root))
  if (!items.length) throw bad(p.reason || 'There is nothing to copy.')
  if (p.dest.dir === '' && !p.dest.dirs?.length) throw bad(p.reason || 'No local folder is mapped')
  const sp = await space(bytesByRoot(items)); if (!sp.ok) throw bad(sp.reason as string)
  const warnings: string[] = []
  if (p.conflicts.files) warnings.push(`${p.conflicts.files} file(s) on this PC have another size and were left alone: ${p.conflicts.names.slice(0, 5).join(', ')}${p.conflicts.files > 5 ? ', ...' : ''}`)
  if (p.unsafe.files) warnings.push(`${p.unsafe.files} key(s) with an unsafe path were refused: ${p.unsafe.names.slice(0, 5).join(', ')}`)
  const dirText = p.dest.dir || (p.dest.dirs ?? []).map((d) => d.dir).join(', ')
  return launch({ plan_id: rec.id, source: rec.req.source, ref: p.source, dest_dir: dirText, items, skipped: p.already_there.files, warnings, approved_by: req.approved_by, on_done: (i) => rec.done.add(i.sub + '\0' + i.root) })
}

function launch(o: { plan_id: string; source: Source; ref: SourceRef; dest_dir: string; items: Item[]; skipped: number; warnings: string[]; approved_by?: string; on_done?: (i: Item) => void }): { job_id: string } {
  const id = `ss-${deps.now().toString(36)}-${(++seq).toString(36)}`, ac = new AbortController(), who = history.currentOrigin()
  const bytes_total = o.items.reduce((a, i) => a + i.bytes, 0)
  const view: Job = { job_id: id, kind: 'source-sync', state: 'downloading', source: { ...o.ref }, dest_dir: o.dest_dir, started_at: iso(), files_total: o.items.length + o.skipped, files_done: 0, files_skipped: o.skipped, files_failed: 0, bytes_total, bytes_done: 0, rate: 0, current: '', warnings: [...o.warnings] }
  const rec: JobRec = { view, ac, items: o.items, failed: [], source: o.source, plan_id: o.plan_id, done: Promise.resolve(), ended: false }
  jobs.set(id, rec)
  const by = o.approved_by ?? who?.approved_by, tag = by ? ` approved by ${String(by).slice(0, 80)}` : ''
  const what = `${o.ref.name} to this PC`
  history.record({ kind: 'change', area: 'volume', action: 'source sync started', what, detail: `${o.items.length} file(s), ${gb(bytes_total)}${tag}` })
  const origin: jobsregistry.Origin = who?.source === 'mcp' ? 'mcp' : 'window'
  rec.stop = jobsregistry.track({ id, kind: 'source-sync', trigger: 'manual', origin, ...(origin === 'mcp' && who?.client ? { client: who.client } : {}), ...(by ? { approved_by: String(by).slice(0, 80) } : {}), label: `download ${o.ref.name} to this PC`, started_at: view.started_at,
    view: () => ({ state: view.state, terminal: rec.ended, progress: { done: view.files_done + view.files_skipped, total: view.files_total, unit: 'files' }, transfer: { bytes_done: view.bytes_done, bytes_total: view.bytes_total, rate_bps: view.rate, ...(view.current ? { current: view.current } : {}), skipped: view.files_skipped, pods: [] } }),
    cancel: () => { void cancel(id).catch(() => undefined) } })
  rec.done = run(rec, o.on_done).catch((e) => { if (view.state === 'downloading') { view.state = ac.signal.aborted ? 'cancelled' : 'failed'; if (view.state === 'failed') view.error = scrub((e as Error).message) } }).finally(() => end(rec))
  return { job_id: id }
}

type One = { ok: true; skipped?: boolean } | { ok: false; error: string; conflict?: boolean }
async function fetchOne(it: Item, src: { bucket: string; env: Record<string, string>; common: string[]; secrets: string[] }, sig: AbortSignal): Promise<One> {
  let tmp = ''
  try {
    if (!safeSub(it.sub) || !absDir(it.root)) return { ok: false, error: 'refused: an unsafe path' }
    await mkdir(it.root, { recursive: true })
    const real = await realpath(it.root), parts = it.sub.split('/')
    let cur = real
    for (const part of parts.slice(0, -1)) {   // a plain folder at each step: never a link
      cur = join(cur, part)
      let ls = await lstat(cur).catch(() => null)
      if (!ls) { await mkdir(cur, { recursive: true }); ls = await lstat(cur) }   // recursive: two workers may make the same folder
      if (ls.isSymbolicLink() || !ls.isDirectory()) return { ok: false, error: `refused: ${part} is not a plain folder on this PC` }
    }
    const name = parts[parts.length - 1], target = join(cur, name)
    if (!target.startsWith(real + sep) || (await realpath(cur)) !== cur) return { ok: false, error: 'refused: the path leaves the destination' }
    const there = await lstat(target).catch(() => null)
    if (there) { if (there.isFile() && !there.isSymbolicLink() && there.size === it.bytes) return { ok: true, skipped: true }; return { ok: false, conflict: true, error: 'a different file is already there; left alone' } }
    tmp = join(cur, `.${name.slice(0, 200)}.part`)
    const r = await storage.aws(['s3', 'cp', `s3://${src.bucket}/${it.key}`, tmp, ...src.common], src.env, { signal: sig, stallMs: 300_000 })
    if (sig.aborted) return { ok: false, error: 'cancelled' }
    if (r.code !== 0) return { ok: false, error: r.transient ? podpull.STORAGE_UNREACHABLE : scrub(r.stderr || r.stdout, src.secrets) }
    const got = await lstat(tmp).catch(() => null)
    if (!got || !got.isFile() || got.size !== it.bytes) return { ok: false, error: `the download is ${got ? got.size : 0} bytes, expected ${it.bytes}` }
    if (await lstat(target).catch(() => null)) return { ok: false, conflict: true, error: 'a file appeared there meanwhile; left alone' }
    await rename(tmp, target); tmp = ''
    return { ok: true }
  } catch (e) { return { ok: false, error: scrub((e as Error).message, src.secrets) } } finally { if (tmp) await rm(tmp, { force: true }).catch(() => undefined) }
}

async function run(rec: JobRec, onDone?: (i: Item) => void): Promise<void> {
  const v = rec.view, sig = rec.ac.signal, s = rec.source
  let src: { bucket: string; env: Record<string, string>; common: string[]; secrets: string[] }
  let storagePrefix = ''
  if (s.type === 'storage') { const st = stAcc(s.storage_id); storagePrefix = st.prefix; src = { bucket: st.bucket, env: st.env, common: st.common, secrets: st.secrets } } else src = await volumeAccess(s.volume_id)
  const queue = [...rec.items], t0 = deps.now()
  let streak = 0, tripped = false
  const worker = async () => {
    while (!sig.aborted && !tripped) {
      const it = queue.shift(); if (!it) return
      v.current = basename(it.sub)
      const r = await fetchOne({ ...it, key: s.type === 'storage' ? `${storagePrefix}${it.key}` : it.key }, src, sig)
      if (sig.aborted && !r.ok) return
      if (r.ok) { streak = 0; if (r.skipped) { v.files_skipped++ } else { v.files_done++; v.bytes_done += it.bytes } onDone?.(it) }
      else if (r.conflict) { if (v.warnings.length < 50) v.warnings.push(`${it.sub}: ${r.error}`) }
      else {
        streak++; v.files_failed++; rec.failed.push(it)
        if (v.warnings.length < 50) v.warnings.push(`${basename(it.sub)}: ${r.error}`)
        if (streak >= BREAKER && !tripped) { tripped = true; v.error = `${BREAKER} files in a row failed: the source or this PC's connection may be down. The rest were not tried; Retry Failed tries them again.` }
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
  const what = `${v.source.name} to this PC`
  history.record({ kind: 'change', area: 'volume', action: `source sync ${v.state.replace(/_/g, ' ')}`, what, detail: `${v.files_done} downloaded (${gb(v.bytes_done)}), ${v.files_skipped} already there, ${v.files_failed} failed${v.error ? `; ${v.error}` : ''}` })
  for (const w of v.warnings.slice(0, 5)) if (v.files_failed) history.record({ kind: 'change', area: 'volume', action: 'source sync file failed', what, detail: w })
  finished = [{ ...structuredClone(v), _failed: rec.failed.slice(0, MAX_FAILED_KEPT).map((i) => ({ ...i })), _source: rec.source }, ...finished.filter((f) => f.job_id !== v.job_id)].slice(0, KEEP_JOBS)
  jobs.delete(v.job_id); persist()
}

// ----- status, cancel, retry -----
const pub = (j: Job): Job => { const { job_id, kind, state, source, dest_dir, started_at, finished_at, files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings, error } = j; return { job_id, kind, state, source: { ...source }, dest_dir, started_at, ...(finished_at ? { finished_at } : {}), files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate, current, warnings: [...warnings], ...(error ? { error } : {}) } }
export async function status(job_id?: string): Promise<{ jobs: Job[] }> {
  await ensureLoaded()
  const all = [...[...jobs.values()].map((r) => pub(r.view)).reverse(), ...finished.filter((f) => !jobs.has(f.job_id)).map(pub)]
  if (job_id) { const j = all.find((x) => x.job_id === job_id); if (!j) throw new CoreError(404, `No such source sync job: ${job_id}`); return { jobs: [j] } }
  return { jobs: all }
}
export async function cancel(job_id: string): Promise<Job> {
  const rec = jobs.get(String(job_id))
  if (!rec) { const f = (await status(job_id).catch(() => null))?.jobs[0]; if (f) return f; throw new CoreError(404, `No such source sync job: ${job_id}`) }
  rec.ac.abort(); if (rec.view.state === 'downloading') rec.view.state = 'cancelled'
  await rec.done
  return pub(rec.view)
}
export async function retry(job_id: string): Promise<{ job_id: string }> {
  await ensureLoaded()
  const id = String(job_id)
  if (jobs.has(id)) throw bad('That job is still running')
  const f = finished.find((x) => x.job_id === id); if (!f) throw new CoreError(404, `No such source sync job: ${id}`)
  const failed = f._failed ?? []
  if (!failed.length || !f._source) throw bad('That job has no failed files')
  const ref = f._source.type === 'storage' ? sourceOf(f._source) : f.source
  const sp = await space(bytesByRoot(failed)); if (!sp.ok) throw bad(sp.reason as string)
  return launch({ plan_id: '', source: f._source, ref, dest_dir: f.dest_dir, items: failed.map((x) => ({ ...x })), skipped: 0, warnings: [] })
}

/** Tests: forget everything. */
export function reset(): void { for (const r of jobs.values()) { r.ac.abort(); r.stop?.() } for (const p of plans.values()) p.ac.abort(); jobs.clear(); plans.clear(); finished = []; loaded = null; writing = Promise.resolve(); seq = 0; setDeps(null) }
