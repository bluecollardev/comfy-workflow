/**
 * The change journal of a network volume (docs/ADR-046, phase 1): a small file per batch of changes under `comfy-shared/.journal/`, written by the app
 * (and the reconciler, changes.ts) over RunPod's S3 API, read back as a feed with ONE `StartAfter` listing. It works with no pod running.
 *
 *   key    comfy-shared/.journal/<yyyy>/<mm>/<dd>/<ulid>-<writer>.json     (UTC day; a time-sortable ULID, one file per batch, never a shared append file)
 *   event  { seq (the key), ts, writer, op, prefix and/or path (and paths), files, bytes, sha256 }
 *
 * Paths in an event are relative to `comfy-shared/` (`output/proxy_v004/a.dpx`); they are validated on the way in and on the way out. Events are untrusted data.
 * `emit` is best effort and NEVER throws into its caller (a journal that cannot be written must not slow or fail the write it describes); with no S3 keys, no S3 datacenter
 * or no-spend mode it does nothing. `prune` is the only deletion this module makes and it can only ever touch keys under `comfy-shared/.journal/` (a hard guard on every key).
 * The S3 keys are never logged and never put in an error.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'
import { CoreError, bad } from './errors.js'
import * as mounts from './mounts.js'
import * as podpull from './podpull.js'
import * as settings from './settings.js'

export const JOURNAL_PREFIX = 'comfy-shared/.journal/'
export const SHARED_ROOT = 'comfy-shared/'
export type Op = 'created' | 'modified' | 'deleted' | 'batch'
export const OPS: Op[] = ['created', 'modified', 'deleted', 'batch']
/** Who wrote an event: the app's own paths, a pod's agent (phase 2), or the reconciler. */
export const WRITERS = ['app:sync', 'app:import', 'app:models', 'app:pull', 'app:erase', 'reconciler'] as const
export const MAX_PATHS = 200
export const DEFAULT_LIMIT = 100, MAX_LIMIT = 500
export const COMPACT_AFTER_DAYS = 14, REMOVE_AFTER_DAYS = 90

export interface JournalEvent { seq: string; ts: string; writer: string; op: Op; prefix?: string; path?: string; paths?: string[]; files?: number; bytes?: number; sha256?: string }
export interface EventInput { writer: string; op: Op; prefix?: string; path?: string; paths?: string[]; files?: number; bytes?: number; sha256?: string; ts?: string }
export interface JournalOpts extends podpull.Opts { rand?: () => number; /** the volume's id and datacenter when the caller already knows them: the S3 reach is worked out from them with NO request to RunPod and no shared state touched (a finished volume job) */ known?: { id: string; name?: string; datacenter: string } }

// ----- ULID (26 Crockford base32 characters: 10 of time in ms, 16 of randomness; monotonic inside one millisecond) -----

const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const encodeTime = (ms: number): string => { let t = Math.max(0, Math.floor(ms)), s = ''; for (let i = 0; i < 10; i++) { s = CROCK[t % 32] + s; t = Math.floor(t / 32) } return s }
export const decodeTime = (ulid: string): number => { let t = 0; for (const c of ulid.slice(0, 10)) t = t * 32 + CROCK.indexOf(c); return t }
let lastMs = -1, lastRand: number[] = []
/** A ULID for this millisecond. Two in the same millisecond still sort in the order they were made. */
export function ulid(ms: number, rand: () => number = () => randomInt(32)): string {
  if (ms === lastMs && lastRand.length) {
    for (let i = lastRand.length - 1; i >= 0; i--) { if (lastRand[i] < 31) { lastRand[i]++; break } lastRand[i] = 0 }
  } else { lastMs = ms; lastRand = Array.from({ length: 16 }, () => Math.floor(rand() * 32) % 32) }
  return encodeTime(ms) + lastRand.map((n) => CROCK[n]).join('')
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}` }
const safeWriter = (w: string) => String(w || 'app').replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, 80) || 'app'
export const keyFor = (ms: number, id: string, writer: string): string => `${JOURNAL_PREFIX}${dayOf(ms)}/${id}-${safeWriter(writer)}.json`
const EVENT_KEY = /^comfy-shared\/\.journal\/\d{4}\/\d{2}\/\d{2}\/[0-9A-HJKMNP-TV-Z]{26}-[A-Za-z0-9:._-]{1,80}\.json$/
const COMPACTED_KEY = /^comfy-shared\/\.journal\/\d{4}\/\d{2}\/\d{2}\/_compacted\.json$/
/** The one test every deletion passes: a key of the journal's own shape, under `comfy-shared/.journal/`, nothing else. */
export const isJournalKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith(JOURNAL_PREFIX) && !key.includes('..') && !key.includes('//') && (EVENT_KEY.test(key) || COMPACTED_KEY.test(key))
export function assertJournalKey(key: string): string { if (!isJournalKey(key)) throw bad(`Refused: ${String(key).slice(0, 120)} is not a key of the change journal (only ${JOURNAL_PREFIX} is ever touched)`); return key }

/** A path inside ComfyUI-Shared as the volume holds it: relative, no `..`, no control characters, not the journal itself. Returns it normalised, or throws. */
export function sharedPath(p: unknown, what = 'path'): string {
  if (typeof p !== 'string' || !p || p.length > 1024) throw bad(`Not a ${what} inside comfy-shared: ${String(p).slice(0, 80)}`)
  // eslint-disable-next-line no-control-regex
  if (p.startsWith('/') || p.includes('\\') || /[\u0000-\u001f]/.test(p) || p.split('/').some((s) => s === '..' || s === '.')) throw bad(`Not a ${what} inside comfy-shared: ${p.slice(0, 80)}`)
  if (p.split('/')[0] === '.journal') throw bad(`The journal is not a ${what} to sync: ${p.slice(0, 80)}`)
  return p
}
export const sharedPrefix = (p: unknown): string => { const s = sharedPath(p, 'prefix'); return s.endsWith('/') ? s : s + '/' }

// ----- access (a volume's S3 reach, kept a few minutes) -----

export type Access = { id: string; secret: string; endpoint: string; bucket: string; region: string }
const accessCache = new Map<string, { at: number; a: Access | null }>()
export const forgetCache = () => accessCache.clear()
const nowMs = (o: JournalOpts) => (o.now ?? (() => new Date()))().getTime()
/** The volume's S3 reach, or null (no-spend mode, no keys, a datacenter without S3). The keys are checked BEFORE anything is asked of RunPod. */
export async function access(volumeId: string, opts: JournalOpts = {}): Promise<Access | null> {
  if (!volumeId || mounts.dryRun(mounts.load())) return null
  if (!settings.lookup('RUNPOD_S3_ACCESS_KEY') || !settings.lookup('RUNPOD_S3_SECRET_KEY')) return null
  if (opts.known && opts.known.id === volumeId) return podpull.s3AccessOf({ id: volumeId, name: opts.known.name ?? volumeId, datacenter: opts.known.datacenter })
  const hit = accessCache.get(volumeId)
  if (hit && nowMs(opts) - hit.at < 5 * 60_000) return hit.a
  let a: Access | null = null
  try { const r = await podpull.s3ReadAccess(volumeId, { ...opts, noCache: true }); a = r.ok ? r : null } catch { a = null }
  accessCache.set(volumeId, { at: nowMs(opts), a })
  return a
}
export const awsCall = (a: Access, args: string[], opts: JournalOpts, stallMs = podpull.S3_STALL_MS) =>
  (opts.aws ?? podpull.defaultAws)([...args, '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }, { stallMs })
const fail = (r: podpull.AwsResult) => podpull.s3Error(r)

// ----- emit -----

/** Validate the pieces of an event. Throws on a path outside comfy-shared. */
function clean(e: EventInput, ms: number, key: string): JournalEvent {
  if (!OPS.includes(e.op)) throw bad(`Not a journal op: ${String(e.op)}`)
  const out: JournalEvent = { seq: key, ts: e.ts ?? new Date(ms).toISOString(), writer: safeWriter(e.writer), op: e.op }
  if (e.prefix) out.prefix = sharedPrefix(e.prefix)
  if (e.path) out.path = sharedPath(e.path)
  if (e.paths?.length) out.paths = e.paths.slice(0, MAX_PATHS).map((p) => sharedPath(p))
  if (Number.isFinite(e.files)) out.files = Math.max(0, Math.round(e.files!))
  if (Number.isFinite(e.bytes)) out.bytes = Math.max(0, Math.round(e.bytes!))
  if (e.sha256 && /^[0-9a-f]{64}$/i.test(e.sha256)) out.sha256 = e.sha256.toLowerCase()
  if (!out.prefix && !out.path && !out.paths) throw bad('A journal event names a prefix or a path')
  return out
}

/** Write one event for a volume. Best effort: resolves to the event written, or null (nothing to write to, or it failed); never throws, never logs keys. */
export async function emit(volumeId: string, e: EventInput, opts: JournalOpts = {}): Promise<JournalEvent | null> {
  let dir: string | null = null
  try {
    const a = await access(volumeId, opts)
    if (!a) return null
    const ms = nowMs(opts), key = keyFor(ms, ulid(ms, opts.rand), e.writer), ev = clean(e, ms, key)
    dir = await mkdtemp(join(tmpdir(), 'journal-'))
    const file = join(dir, 'event.json')
    await writeFile(file, JSON.stringify(ev) + '\n', { mode: 0o600 })
    const r = await awsCall(a, ['s3', 'cp', file, `s3://${a.bucket}/${key}`, '--only-show-errors'], opts, 30_000)
    return r.code === 0 ? ev : null
  } catch { return null } finally { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined) }
}

// ----- the feed -----

export interface Feed { volume_id: string; cursor: string; events: JournalEvent[]; more: boolean; note?: string }
interface Listed { Key: string; Size?: number; LastModified?: string }
async function listKeys(a: Access, prefix: string, opts: JournalOpts, o: { startAfter?: string; max?: number } = {}): Promise<{ keys: Listed[]; more: boolean }> {
  const args = ['s3api', 'list-objects-v2', '--bucket', a.bucket, '--prefix', prefix, '--output', 'json', ...(o.startAfter ? ['--start-after', o.startAfter] : []), ...(o.max ? ['--max-items', String(o.max)] : [])]
  const r = await awsCall(a, args, opts)
  if (r.code !== 0) throw fail(r)
  const t = r.stdout.trim()
  let j: { Contents?: Listed[]; NextToken?: string } = {}
  if (t) { try { j = JSON.parse(t) } catch { throw new CoreError(502, "RunPod's S3 API answered something that is not a listing") } }
  return { keys: (j.Contents ?? []).filter((k) => k && typeof k.Key === 'string'), more: !!j.NextToken }
}

/** The key a feed starts after for a time: a ULID time prefix is a lower bound of every key made at or after it. */
export const startAfterFor = (ms: number): string => `${JOURNAL_PREFIX}${dayOf(ms)}/${encodeTime(ms)}`

/** `since` as the key a listing starts after: '' (the beginning), 'now', an ISO time, or a cursor (a journal key, or a key-shaped bound this module made). */
export function sinceToStartAfter(since: string | undefined, now: number): string | undefined {
  const s = (since ?? '').trim()
  if (!s) return undefined
  if (s === 'now' || s === 'latest') return startAfterFor(now)
  if (s.startsWith(JOURNAL_PREFIX) && !s.includes('..') && s.length < 400) return s
  const ms = Date.parse(s)
  if (Number.isFinite(ms)) return startAfterFor(ms)
  throw bad(`since is a cursor from an earlier call, an ISO time, or "now": ${s.slice(0, 60)}`)
}

const matches = (ev: JournalEvent, prefix: string): boolean => {
  if (!prefix) return true
  const targets = [ev.prefix, ev.path, ...(ev.paths ?? [])].filter(Boolean) as string[]
  return targets.some((t) => t.startsWith(prefix) || prefix.startsWith(t))
}
const asEvent = (key: string, v: unknown): JournalEvent | null => {
  const o = v as Partial<JournalEvent> | null
  if (!o || typeof o !== 'object' || !OPS.includes(o.op as Op) || typeof o.writer !== 'string') return null
  try {
    const e: JournalEvent = { seq: key, ts: typeof o.ts === 'string' ? o.ts : '', writer: o.writer, op: o.op as Op }
    if (o.prefix) e.prefix = sharedPrefix(o.prefix)
    if (o.path) e.path = sharedPath(o.path)
    if (Array.isArray(o.paths)) e.paths = o.paths.slice(0, MAX_PATHS).map((p) => sharedPath(p))
    if (Number.isFinite(o.files)) e.files = o.files
    if (Number.isFinite(o.bytes)) e.bytes = o.bytes
    if (typeof o.sha256 === 'string') e.sha256 = o.sha256
    return e.prefix || e.path || e.paths ? e : null
  } catch { return null }   // a path outside comfy-shared in the file: the event is dropped, it is never trusted
}

async function readEvents(a: Access, key: string, opts: JournalOpts): Promise<JournalEvent[]> {
  const r = await awsCall(a, ['s3', 'cp', `s3://${a.bucket}/${key}`, '-', '--only-show-errors'], opts, 30_000)
  if (r.code !== 0) return []
  try {
    const j = JSON.parse(r.stdout)
    if (COMPACTED_KEY.test(key)) return (Array.isArray(j?.events) ? j.events : []).map((x: { seq?: string }) => asEvent(typeof x?.seq === 'string' && isJournalKey(x.seq) ? x.seq : key, x)).filter(Boolean) as JournalEvent[]
    const e = asEvent(key, j); return e ? [e] : []
  } catch { return [] }
}
async function inParallel<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}

/**
 * The feed: events after `since`, oldest first, at most `limit` files of the journal (default 100, at most 500), optionally those that touch `prefix` (relative to comfy-shared).
 * ONE `StartAfter` listing of `.journal/`, then one small read per event; no scan of the data. `cursor` is the last key looked at, to pass as `since` next time (it
 * advances over events the prefix filter dropped, so it never stalls). `since: "now"` returns the end of the journal with no events: where a new reader starts.
 */
export async function list(o: { volume_id: string; since?: string; prefix?: string; limit?: number }, opts: JournalOpts = {}): Promise<Feed> {
  const volumeId = (o.volume_id || '').trim()
  const prefix = o.prefix ? sharedPrefix(o.prefix) : ''
  const limit = Math.max(1, Math.min(Math.floor(o.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT))
  const start = sinceToStartAfter(o.since, nowMs(opts))
  const a = await access(volumeId, opts)
  if (!a) throw new CoreError(409, (await podpull.volumeS3(volumeId, opts).catch((e) => ({ reason: (e as Error).message }))).reason || 'This volume cannot be read over the S3 API.')
  if ((o.since ?? '').trim() === 'now' || (o.since ?? '').trim() === 'latest') return { volume_id: volumeId, cursor: start!, events: [], more: false, note: 'The end of the journal now: pass this cursor as since to get what is written after it.' }
  const { keys, more } = await listKeys(a, JOURNAL_PREFIX, opts, { startAfter: start, max: limit })
  const mine = keys.map((k) => k.Key).filter(isJournalKey)
  const events = (await inParallel(mine, 6, (k) => readEvents(a, k, opts))).flat().filter((e) => matches(e, prefix))
  const cursor = keys.length ? keys[keys.length - 1].Key : (start ?? '')
  return { volume_id: volumeId, cursor, events, more }
}

/** Where a reader that wants only what happens from now on starts. */
export const tail = async (volumeId: string, opts: JournalOpts = {}): Promise<string> => (await list({ volume_id: volumeId, since: 'now' }, opts)).cursor

// ----- retention -----

export interface PruneReport { volume_id: string; days: number; compacted_days: string[]; removed_days: string[]; deleted_keys: number; skipped: number }
/** Remove one journal key. The ONLY delete in this module: it refuses anything that is not a journal key. */
async function deleteJournalKey(a: Access, key: string, opts: JournalOpts): Promise<boolean> {
  assertJournalKey(key)
  const r = await awsCall(a, ['s3', 'rm', `s3://${a.bucket}/${key}`, '--only-show-errors'], opts, 30_000)
  return r.code === 0
}
export const deleteKeyForTest = deleteJournalKey

/**
 * Retention (ADR-046): a day older than `compactAfterDays` (default 14) has its event files merged into one `_compacted.json`; a day older than `removeAfterDays`
 * (default 90) is removed. The journal is our own hidden folder; this deletes only its keys, and every key is checked by `assertJournalKey` right before it goes.
 * A listed key that is not a journal key is ignored, so a crafted listing (or option) cannot make this remove anything else.
 */
export async function prune(volumeId: string, o: { compactAfterDays?: number; removeAfterDays?: number } = {}, opts: JournalOpts = {}): Promise<PruneReport> {
  const compactAfter = o.compactAfterDays ?? COMPACT_AFTER_DAYS, removeAfter = o.removeAfterDays ?? REMOVE_AFTER_DAYS
  if (!(compactAfter >= 1) || !(removeAfter > compactAfter)) throw bad('Retention: compact after at least 1 day, remove after more than that')
  const a = await access(volumeId, opts)
  if (!a) throw new CoreError(409, 'This volume cannot be reached over the S3 API.')
  const { keys } = await listKeys(a, JOURNAL_PREFIX, opts)
  const byDay = new Map<string, string[]>()
  let skipped = 0
  for (const { Key } of keys) {
    if (!isJournalKey(Key)) { skipped++; continue }
    const day = Key.slice(JOURNAL_PREFIX.length, JOURNAL_PREFIX.length + 10)
    byDay.set(day, [...(byDay.get(day) ?? []), Key])
  }
  const now = nowMs(opts), rep: PruneReport = { volume_id: volumeId, days: byDay.size, compacted_days: [], removed_days: [], deleted_keys: 0, skipped }
  for (const [day, dayKeys] of [...byDay.entries()].sort()) {
    const age = (now - Date.parse(`${day.replace(/\//g, '-')}T00:00:00Z`)) / 86_400_000
    if (!Number.isFinite(age)) continue
    if (age >= removeAfter) {
      for (const k of dayKeys) if (await deleteJournalKey(a, k, opts)) rep.deleted_keys++
      rep.removed_days.push(day)
    } else if (age >= compactAfter) {
      const eventKeys = dayKeys.filter((k) => EVENT_KEY.test(k))
      if (!eventKeys.length) continue
      const compactedKey = `${JOURNAL_PREFIX}${day}/_compacted.json`
      const merged = (await inParallel([...dayKeys].sort(), 6, (k) => readEvents(a, k, opts))).flat().sort((x, y) => x.seq.localeCompare(y.seq))
      const dir = await mkdtemp(join(tmpdir(), 'journal-'))
      try {
        const file = join(dir, 'compacted.json')
        await writeFile(file, JSON.stringify({ compacted: true, events: merged }) + '\n', { mode: 0o600 })
        const w = await awsCall(a, ['s3', 'cp', file, `s3://${a.bucket}/${compactedKey}`, '--only-show-errors'], opts, 60_000)
        if (w.code !== 0) throw fail(w)   // the originals stay when the merged file did not land
      } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined) }
      for (const k of eventKeys) if (await deleteJournalKey(a, k, opts)) rep.deleted_keys++
      rep.compacted_days.push(day)
    }
  }
  return rep
}

// ----- the writers' hook: a volume job that ended -----

/** What a finished volume job (podpull.ts) wrote or removed, as journal events: one batch per prefix, after the job. Best effort; never throws. The fields it reads are the PodJob's. */
export async function emitForJob(j: { kind: string; round: string; state: string; fetch_items?: { name: string; folder?: string }[]; fetched?: string[]; erase_keys?: string[]; delete_items?: { folder: string }[]; place?: { linked?: number; graphs?: unknown[] } }, volumeId: string, opts: JournalOpts = {}): Promise<void> {
  try {
    if (!volumeId || j.state !== 'done') return
    const ev: EventInput[] = []
    if (j.kind === 'pull') {
      if (/^[\w.-]{1,80}$/.test(j.round)) ev.push({ writer: 'app:pull', op: 'batch', prefix: `temp/rounds/${j.round}/` })
      if (j.place?.linked) ev.push({ writer: 'app:pull', op: 'batch', prefix: 'input/' })
      if (j.place?.graphs?.length) ev.push({ writer: 'app:pull', op: 'batch', prefix: 'workflows/' })
    } else if (j.kind === 'fetch') {
      const done = new Set(j.fetched ?? [])
      for (const f of new Set((j.fetch_items ?? []).filter((x) => done.has(x.name) && typeof x.folder === 'string' && /^[\w.-]{1,80}$/.test(x.folder)).map((x) => x.folder!))) ev.push({ writer: 'app:models', op: 'batch', prefix: `models/${f}/` })
    } else if (j.kind === 'erase') {
      for (const k of j.erase_keys ?? []) { const p = podpull.ERASABLE[k]?.path; if (p?.startsWith('/workspace/comfy-shared/')) ev.push({ writer: 'app:erase', op: 'deleted', prefix: p.slice('/workspace/comfy-shared/'.length) + '/' }) }
    } else if (j.kind === 'delete-models') ev.push({ writer: 'app:models', op: 'deleted', prefix: 'models/' })
    for (const e of ev) await emit(volumeId, e, opts)
  } catch { /* the journal never fails a job */ }
}
