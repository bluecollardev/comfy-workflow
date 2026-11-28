/**
 * Storage adapters (docs/ADR-063): an adapter here is one S3-compatible storage, never code: endpoint (blank = AWS), region, bucket, directory,
 * keys and an `enabled` switch. Three are built in: `publish-s3` (the Publishing destination, whose values stay in publish.json), `panama-s3`
 * (the Panama BH exchange bucket, whose values stay in the PANAMA_* settings) and `wasabi`; people add more. Publishing mirrors each uploaded file
 * to every other enabled adapter. Keys live in storage-adapters.json (mode 0600) and are never returned, logged or put in an error: a hint only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import * as history from './history.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import * as syncrules from './syncrules.js'
import * as uploads from './storageuploads.js'
import { configDir } from './paths.js'

export const PUBLISH_ID = 'publish-s3', PANAMA_ID = 'panama-s3', WASABI_ID = 'wasabi'
export const BUILTIN_IDS = [PUBLISH_ID, PANAMA_ID, WASABI_ID]
const RESERVED = new Set(BUILTIN_IDS)
export interface Rec { /** LEGACY (docs/ADR-064/068): migrated once into sync-rules.json (docs/ADR-069), then ignored by sending; kept valid, never read by forEvent */ volumes?: string[]; id: string; name: string; endpoint: string; region: string; bucket: string; prefix: string; enabled: boolean; access_key_id: string; secret_access_key: string; /** LEGACY: see `volumes`; sending is driven by syncrules (docs/ADR-069) */ events?: string[] }
/** The moments that send files to a storage (docs/ADR-064). 'generating' and 'publishing' were removed by Lucas (2026-11-28): Generated is the one for renders, Published the one after a publish; a stored old name is ignored. */
export const EVENTS = ['generated', 'approved', 'published'] as const
export type Event = (typeof EVENTS)[number]
const eventsOf = (r: Rec): string[] => (Array.isArray(r.events) ? r.events.filter((e) => (EVENTS as readonly string[]).includes(e)) : [])
export interface Store { flags: Record<string, { enabled: boolean; events?: string[]; name?: string }>; adapters: Rec[]; /** the default storage (id): what a picker offers first (docs/ADR-067) */ default?: string; /** the order the cards are shown in (ids; Lucas drags them), docs/ADR-064 */ order?: string[] }
export interface View { /** the volumes this storage receives from on an event; empty or missing = every volume (docs/ADR-068) */ volumes?: string[]; /** the default storage (one at a time) */ default?: boolean; id: string; name: string; builtin: boolean; kind: 'publish' | 'panama' | 'wasabi' | 'custom'; enabled: boolean; endpoint: string; region: string; bucket: string; prefix: string; ready: boolean; problem?: string; key_hint: string; /** the events it uploads on (ADR-064) */ events: string[]; /** where the values are edited when not here */ edit?: 'publish' | 'panama' }

export const storageFile = () => process.env.STORAGE_ADAPTERS_FILE || join(configDir(), 'storage-adapters.json')
function read(): Store {
  try { const j = JSON.parse(readFileSync(storageFile(), 'utf8')); return { flags: j?.flags && typeof j.flags === 'object' ? j.flags : {}, adapters: Array.isArray(j?.adapters) ? j.adapters : [], order: Array.isArray(j?.order) ? j.order.filter((x: unknown) => typeof x === 'string') : [], default: typeof j?.default === 'string' ? j.default : undefined } } catch { return { flags: {}, adapters: [] } }
}
function write(s: Store): void {
  const f = storageFile(); mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s, null, 1), { mode: 0o600 }); renameSync(tmp, f)
}

/** Wasabi's endpoint for a region: us-east-1 is `s3.wasabisys.com`, the others `s3.<region>.wasabisys.com`. */
export const wasabiEndpoint = (region: string): string => (!region || region === 'us-east-1' ? 'https://s3.wasabisys.com' : `https://s3.${region}.wasabisys.com`)
const hint = (v: string): string => (v ? `…${v.slice(-4)}` : '')

const WASABI_DEFAULT: Rec = { id: WASABI_ID, name: 'Wasabi', endpoint: '', region: 'us-east-1', bucket: '', prefix: '', enabled: false, access_key_id: '', secret_access_key: '' }
const recOf = (s: Store, id: string): Rec | undefined => s.adapters.find((a) => a.id === id) ?? (id === WASABI_ID ? { ...WASABI_DEFAULT } : undefined)
const endpointOf = (r: Rec): string => r.endpoint || (r.id === WASABI_ID ? wasabiEndpoint(r.region) : '')

/** Whether an adapter is on. Unknown ids are off; `publish-s3` and `panama-s3` start on (they are what the app did before adapters). */
export function isEnabled(id: string): boolean {
  const s = read()
  if (id === PUBLISH_ID || id === PANAMA_ID) return s.flags[id]?.enabled !== false
  return !!recOf(s, id)?.enabled
}
/** panama.ts calls this before any command that touches the bucket. */
export function assertPanamaOn(): void { if (!isEnabled(PANAMA_ID)) throw bad('The Panama S3 adapter is off: switch it on in Configuration > Adapters') }

const problemOf = (r: Rec): string | undefined => !r.bucket ? 'Add a bucket' : !r.region ? 'Add a region' : !(r.access_key_id && r.secret_access_key) ? 'Add the access key and secret key' : undefined
function viewOf(r: Rec, enabled: boolean): View {
  const p = problemOf(r)
  return { id: r.id, name: r.name, builtin: r.id === WASABI_ID, kind: r.id === WASABI_ID ? 'wasabi' : 'custom', enabled, endpoint: endpointOf(r), region: r.region, bucket: r.bucket, prefix: r.prefix, ready: !p, ...(p ? { problem: p } : {}), key_hint: hint(r.access_key_id), events: eventsOf(r), volumes: [...(r.volumes ?? [])] }
}
export async function list(): Promise<{ adapters: View[] }> {
  const s = read(), out: View[] = []
  const ps = await publish.settings().catch(() => null)
  if (ps) out.push({ id: PUBLISH_ID, name: s.flags[PUBLISH_ID]?.name || 'Panama BH (S3)', builtin: true, kind: 'publish', enabled: s.flags[PUBLISH_ID]?.enabled !== false, endpoint: ps.s3.endpoint, region: ps.s3.region, bucket: ps.s3.bucket, prefix: ps.s3.prefix, ready: ps.s3.ready, ...(ps.s3.problem ? { problem: ps.s3.problem } : {}), key_hint: ps.s3.access_key_hint, events: (s.flags[PUBLISH_ID]?.events ?? ['approved']).filter((e) => (EVENTS as readonly string[]).includes(e)), edit: 'publish' })
  const pk = panama.appKeys()
  out.push({ id: PANAMA_ID, name: s.flags[PANAMA_ID]?.name || 'Panama BH exchange (S3)', builtin: true, kind: 'panama', enabled: s.flags[PANAMA_ID]?.enabled !== false, endpoint: '', region: panama.region(), bucket: panama.bucket(), prefix: 'rounds/', ready: !!pk || !!panama.profile(), key_hint: pk ? hint(pk.id) : '', events: (s.flags[PANAMA_ID]?.events ?? []).filter((e) => (EVENTS as readonly string[]).includes(e)), edit: 'panama' })
  const wasabi = recOf(s, WASABI_ID)!
  out.push(viewOf(wasabi, !!wasabi.enabled))
  for (const r of s.adapters) if (r.id !== WASABI_ID) out.push(viewOf(r, !!r.enabled))
  const o = s.order ?? [], at = (id: string) => { const i = o.indexOf(id); return i < 0 ? o.length : i }
  const def = s.default && out.some((v) => v.id === s.default && v.kind !== 'panama' && v.kind !== 'publish') ? s.default : ''
  for (const v of out) if (v.id === def) v.default = true
  return { adapters: out.map((v, i) => ({ v, i })).sort((a, b) => at(a.v.id) - at(b.v.id) || a.i - b.i).map((x) => x.v) }
}
/** Make one storage the default (a picker offers it first: the Sync window, docs/ADR-067); '' clears it. The publish destination and the Panama exchange cannot be the default: they are not storages in that sense. */
export async function setDefault(id: unknown): Promise<{ adapters: View[] }> {
  const s = read()
  if (id === '' || id === null || id === undefined) { delete s.default; write(s); return list() }
  if (typeof id !== 'string' || id === PUBLISH_ID || id === PANAMA_ID || !recOf(s, id)) throw bad('the default is Wasabi or a storage of your own')
  s.default = id; write(s)
  history.record({ kind: 'change', area: 'configuration', action: 'default storage set', what: id, detail: '' })
  return list()
}
/** Save the order the cards are shown in. Unknown ids are dropped; a storage not named goes last, in its usual place. */
export async function reorder(ids: unknown): Promise<{ adapters: View[] }> {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw bad('order is a list of storage ids')
  const have = new Set((await list()).adapters.map((a) => a.id)), s = read()
  s.order = [...new Set(ids as string[])].filter((x) => have.has(x)); write(s)
  return list()
}

const ID = /^[a-z0-9][a-z0-9-]{1,30}$/
export interface SaveInput { id?: string; name?: string; endpoint?: string; region?: string; bucket?: string; prefix?: string; enabled?: boolean; access_key_id?: string; secret_access_key?: string; events?: string[]; volumes?: string[] }
const checkEvents = (v: unknown): string[] => { if (!Array.isArray(v) || v.some((e) => !(EVENTS as readonly string[]).includes(e as string))) throw bad(`events are some of: ${EVENTS.join(', ')}`); return EVENTS.filter((e) => (v as string[]).includes(e)) }
const clean = (i: SaveInput, base: Rec): Rec => {
  const r: Rec = { ...base }
  const str = (v: unknown, f: string): string => { if (typeof v !== 'string') throw bad(`${f} is text`); return v.trim() }
  if (i.name !== undefined) { r.name = str(i.name, 'name'); if (!r.name || r.name.length > 60) throw bad('name is 1 to 60 characters') }
  if (i.bucket !== undefined) { r.bucket = str(i.bucket, 'bucket'); if (r.bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(r.bucket)) throw bad('bucket is a bucket name: lower case letters, digits, dots and hyphens, 3 to 63 characters') }
  if (i.region !== undefined) { r.region = str(i.region, 'region'); if (r.region && !/^[a-z0-9][a-z0-9-]{1,30}$/.test(r.region)) throw bad('region is a region like us-east-1 or eu-central-1') }
  if (i.prefix !== undefined) {
    let p = str(i.prefix, 'prefix'); if (p.startsWith('/')) throw bad('prefix must not start with a slash'); if (p.split('/').includes('..')) throw bad('prefix must not contain ..'); if (p.length > 200) throw bad('prefix is at most 200 characters')
    p = p.replace(/\/+$/, ''); r.prefix = p ? `${p}/` : ''
  }
  if (i.endpoint !== undefined) {
    const t = str(i.endpoint, 'endpoint')
    if (t) { let u: URL; try { u = new URL(t) } catch { throw bad('endpoint is an https URL') } if (u.protocol !== 'https:' || u.username || u.password) throw bad('endpoint is an https URL with no user name or password in it'); r.endpoint = t.replace(/\/+$/, '') } else r.endpoint = ''
  }
  if (i.enabled !== undefined) r.enabled = !!i.enabled
  if (i.events !== undefined) r.events = checkEvents(i.events)
  if (i.volumes !== undefined) { if (!Array.isArray(i.volumes) || i.volumes.length > 50 || i.volumes.some((v) => typeof v !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/.test(v))) throw bad('volumes is a list of volume ids (up to 50); empty means every volume'); r.volumes = [...new Set(i.volumes)] }
  const idv = i.access_key_id, sec = i.secret_access_key
  if (idv) { if (typeof idv !== 'string' || /\s/.test(idv.trim()) || idv.trim().length < 8 || idv.trim().length > 128) throw bad('access_key_id looks wrong (8 to 128 characters, no spaces)'); r.access_key_id = idv.trim() }
  if (sec) { if (typeof sec !== 'string' || /\s/.test(sec.trim()) || sec.trim().length < 16 || sec.trim().length > 256) throw bad('secret_access_key looks wrong (16 to 256 characters, no spaces)'); r.secret_access_key = sec.trim() }
  return r
}
/** Add a storage (no `id`: one is made from the name) or change one (Wasabi or your own). Secrets: an empty field keeps what is stored. */
export async function save(i: SaveInput): Promise<{ adapters: View[] }> {
  const s = read()
  let id = i.id
  if ((id === PUBLISH_ID || id === PANAMA_ID) && Object.keys(i).every((k) => k === 'id' || k === 'name' || k === 'events')) {   // a title and the events are kept here; the bucket and keys live where they always did
    const f = s.flags[id] ?? { enabled: true }
    if (i.name !== undefined) { const n = String(i.name ?? '').trim(); if (n.length > 60) throw bad('name is 1 to 60 characters'); if (n) f.name = n; else delete f.name }
    if (i.events !== undefined) f.events = checkEvents(i.events)
    s.flags[id] = f; write(s); history.record({ kind: 'change', area: 'configuration', action: 'storage adapter saved', what: id, detail: `${f.name ?? 'default title'}${f.events ? `, events: ${f.events.join(', ') || 'none'}` : ''}` }); return list()
  }
  if (id && (id === PUBLISH_ID || id === PANAMA_ID)) throw bad(`${id} is edited where its values live: Publishing / Panama settings (docs/ADR-063)`)
  if (!id) {
    const slug = String(i.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
    if (!ID.test(slug) || RESERVED.has(slug)) throw bad('name needs letters or digits (and is not one of the built-in names)')
    id = slug; let n = 2; while (recOf(s, id)) id = `${slug.slice(0, 27)}-${n++}`
  } else if (!ID.test(id)) throw bad('id is lower case letters, digits and hyphens')
  const base = recOf(s, id) ?? { id, name: id, endpoint: '', region: '', bucket: '', prefix: '', enabled: false, access_key_id: '', secret_access_key: '' }
  const next = clean(i, base)
  if (next.enabled && problemOf(next)) throw bad(`${next.name} cannot be switched on: ${problemOf(next)}`)
  s.adapters = [...s.adapters.filter((a) => a.id !== id), next]
  write(s)
  history.record({ kind: 'change', area: 'configuration', action: 'storage adapter saved', what: id, detail: `${next.name}${next.enabled ? ', on' : ', off'}` })
  return list()
}
export async function setEnabled(id: string, enabled: boolean): Promise<{ adapters: View[] }> {
  const s = read()
  if (id === PUBLISH_ID || id === PANAMA_ID) { s.flags[id] = { ...s.flags[id], enabled: !!enabled } }
  else {
    const r = recOf(s, id); if (!r) throw bad(`no storage adapter ${id}`)
    if (enabled && problemOf(r)) throw bad(`${r.name} cannot be switched on: ${problemOf(r)}`)
    s.adapters = [...s.adapters.filter((a) => a.id !== id), { ...r, enabled: !!enabled }]
  }
  write(s)
  history.record({ kind: 'change', area: 'configuration', action: `storage adapter ${enabled ? 'on' : 'off'}`, what: id, detail: '' })
  return list()
}
/** Delete your own; Wasabi is built in, so removing it only clears its values and keys (it goes back to off). */
export async function remove(id: string): Promise<{ adapters: View[] }> {
  if (id === PUBLISH_ID || id === PANAMA_ID) throw bad(`${id} is built in: switch it off instead`)
  const s = read(); if (!s.adapters.some((a) => a.id === id)) throw bad(`no storage adapter ${id}`)
  if (s.default === id) throw bad('The default storage cannot be deleted: make another storage the default first (its contents can still be erased)')   // Lucas, 2026-11-28
  syncrules.removeStorage(id)   // migrates first when needed, then drops it from every rule
  s.adapters = s.adapters.filter((a) => a.id !== id); write(s)
  history.record({ kind: 'change', area: 'configuration', action: 'storage adapter removed', what: id, detail: '' })
  return list()
}

// ----- using one -----
export interface Access { id: string; name: string; bucket: string; prefix: string; env: Record<string, string>; common: string[]; /** for a pod's signed link (docs/ADR-064) */ endpoint: string; region: string; keys: { id: string; secret: string } }
const accessOf = (r: Rec): Access => { const ep = endpointOf(r); return { id: r.id, name: r.name, bucket: r.bucket, prefix: r.prefix, endpoint: ep, region: r.region, keys: { id: r.access_key_id, secret: r.secret_access_key }, env: { AWS_ACCESS_KEY_ID: r.access_key_id, AWS_SECRET_ACCESS_KEY: r.secret_access_key, AWS_REGION: r.region }, common: ['--region', r.region, ...(ep ? ['--endpoint-url', ep] : [])] } }
/** docs/ADR-066: the access (keys, endpoint, region, bucket, directory) of a storage by id, switched on or off. Wasabi and your own only: the publish destination and the Panama exchange are not storages in this sense. Throws a plain refusal; the keys go only to the caller's signing and are never returned to a window. */
export function storageAccess(id: string): Access {
  if (id === PUBLISH_ID || id === PANAMA_ID) throw bad('The publish destination and the Panama exchange cannot be the target of a volume sync: choose Wasabi or a storage of your own')
  const r = recOf(read(), id); if (!r) throw bad(`no storage ${id}`)
  const p = problemOf(r); if (p) throw bad(`${r.name} is not ready: ${p}`)
  return accessOf(r)
}
/** docs/ADR-067 amendment: how the BH exchange bucket (the Panama bucket, `panama-s3`; `publish-s3` is the same bucket) is READ as a source: the app keys (Default Configuration) or the AWS profile, exactly as storageusage.accessFor does. Never a target. `keys` is null when only the AWS profile exists (a signed link cannot be made then). Refuses when the Panama switch is off. */
export interface PanamaAccess { id: string; name: string; bucket: string; prefix: string; env: Record<string, string>; common: string[]; endpoint: string; region: string; keys: { id: string; secret: string } | null }
export function panamaAccess(): PanamaAccess {
  assertPanamaOn()
  const k = panama.appKeys(), name = read().flags[PANAMA_ID]?.name || 'Panama BH exchange (S3)'
  return { id: PANAMA_ID, name, bucket: panama.bucket(), prefix: '', endpoint: '', region: panama.region(), keys: k, env: k ? { AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: panama.region() } : {}, common: [...(k ? [] : ['--profile', panama.profile()]), '--region', panama.region()] }
}
/** `publish-s3` and `panama-s3` are the one BH bucket. */
export const isBh = (id: string): boolean => id === PUBLISH_ID || id === PANAMA_ID
/** The adapters a publish mirrors to: enabled and complete, never `publish-s3` itself (that one is the destination) and never the Panama bucket. */
/** The storages that take files on this event for this volume (docs/ADR-069): the ones the rules name for (volume, event) if that volume has a list for the event (empty = nowhere), else for ('*', event); enabled and complete only. No volume id: the '*' rules only. The old `events`/`volumes` fields of a record are ignored here once the rules exist (they are migrated once, syncrules.ts). */
export function forEvent(ev: Event, volumeId?: string | null): Access[] {
  const s = read(), out: Access[] = []
  for (const id of syncrules.storageIdsFor(ev, volumeId)) { const r = id === PUBLISH_ID || id === PANAMA_ID ? undefined : recOf(s, id); if (r && r.enabled && !problemOf(r)) out.push(accessOf(r)) }
  return out
}
/** For syncrules: a storage that can be a destination (Wasabi or your own; never the BH bucket). */
export const isRealStorage = (id: string): boolean => id !== PUBLISH_ID && id !== PANAMA_ID && !!recOf(read(), id)
/** For syncrules' one-time migration: each real storage's old events and volumes (docs/ADR-064/068), only those with an event that sends. */
export function legacyEventRecords(): { id: string; events: Event[]; volumes: string[] }[] {
  const s = read(), all = [recOf(s, WASABI_ID)!, ...s.adapters.filter((a) => a.id !== WASABI_ID)]
  return all.map((r) => ({ id: r.id, events: eventsOf(r) as Event[], volumes: [...(r.volumes ?? [])] })).filter((r) => r.events.length)
}
/** True when the bucket already has this key at the file's size (a file sent on two events goes once). A failed look is "no": the copy decides. */
async function thereSameBytes(m: Access, bytes: number, key: string): Promise<boolean> {
  try { const r = await runAws(['s3', 'ls', `s3://${m.bucket}/${m.prefix}${key}`, ...m.common], m.env, { stallMs: 15_000 }); const sz = r.code === 0 ? Number(r.stdout.trim().split(/\s+/)[2]) : NaN; return sz === bytes } catch { return false }
}
async function thereSame(m: Access, abs: string, key: string): Promise<boolean> { try { return await thereSameBytes(m, (await stat(abs)).size, key) } catch { return false } }
/** docs/ADR-072: what has just reached a storage also comes down when This PC pulls from it. Best effort, and loaded only when asked for (an import cycle otherwise). */
function pullBack(ev: Event, storageId: string, keys: string[]): void {
  if (keys.length && syncrules.storageWantsLocal(ev, storageId)) void import('./localcopy.js').then((c) => c.fromStorage(ev, storageId, keys)).catch(() => undefined)
}
/** Upload files on an event to every adapter that listens; weights never go. Returns warnings (a failed copy is one, never an error). */
export async function uploadOn(ev: Event, files: { abs: string; key: string }[], signal?: AbortSignal, volumeId?: string | null): Promise<string[]> {
  const out: string[] = [], list = forEvent(ev, volumeId); if (!list.length) return out
  const ok = files.filter((f) => !publish.isWeight(f.abs))
  const sizes = await Promise.all(ok.map((f) => stat(f.abs).then((x) => x.size).catch(() => 0)))
  const job = uploads.open({ event: ev, targets: list.map((m) => m.name), source: 'pc', files_total: ok.length * list.length, bytes_total: sizes.reduce((a, b) => a + b, 0) * list.length, signal })
  try {
    for (const m of list) {
      let sent = 0
      const there: string[] = []
      for (let i = 0; i < ok.length && !job.signal.aborted; i++) {
        const f = ok[i]; job.current(f.key)
        if (await thereSame(m, f.abs, f.key)) { sent++; there.push(f.key); job.file('skipped', 0); continue }
        const why = await mirrorCopy(m, f.abs, f.key, job.signal).catch((e) => publish.redact((e as Error).message))
        if (why) { if (!job.signal.aborted) { const w = `${m.name}: ${f.key.split('/').pop()}: ${why}`; out.push(w); job.warn(w); job.file('failed', 0) } } else { sent++; there.push(f.key); job.file('sent', sizes[i]) }
      }
      history.record({ kind: 'change', area: 'configuration', action: `storage upload on ${ev}`, what: m.name, detail: `${sent} of ${ok.length} file(s)` })
      pullBack(ev, m.id, there)
    }
  } finally { job.end() }
  return out
}

type Aws = podpull.AwsRunner
let awsFn: Aws | null = null
export const setAws = (f: Aws | null) => { awsFn = f }
const runAws: Aws = (a, e, o) => (awsFn ?? podpull.defaultAws)(a, e, o)
/** The runner storage commands use (tests inject a fake with setAws). */
export const aws: Aws = runAws
const text = (r: podpull.AwsResult): string => publish.redact((r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`)
/** Copy one local file to a mirror below its directory. '' when it went, else the reason (redacted). */
export async function mirrorCopy(m: Access, localPath: string, key: string, signal?: AbortSignal): Promise<string> {
  const r = await runAws(['s3', 'cp', localPath, `s3://${m.bucket}/${m.prefix}${key}`, ...m.common], m.env, { signal, stallMs: 300_000 })
  return r.code === 0 ? '' : r.transient ? podpull.STORAGE_UNREACHABLE : text(r)
}
/** A read-only look at the bucket: { ok, detail }. For `publish-s3` it is the publish test; for `panama-s3` a listing of rounds/. */
export async function test(id: string): Promise<{ ok: boolean; detail: string }> {
  if (id === PUBLISH_ID) return publish.test({ target: 's3' })
  if (id === PANAMA_ID) {
    const k = panama.appKeys(), cmd = panama.listCmd().slice(1)
    const r = await runAws(cmd, k ? { AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: panama.region() } : {}, { stallMs: 15_000 })
    return r.code === 0 || (r.code === 1 && !r.stdout.trim() && !r.stderr.trim()) ? { ok: true, detail: `${panama.bucket()} answered` } : { ok: false, detail: text(r) }
  }
  const r = recOf(read(), id); if (!r) throw bad(`no storage adapter ${id}`)
  const p = problemOf(r); if (p) return { ok: false, detail: p }
  const m = accessOf(r), ls = await runAws(['s3', 'ls', `s3://${m.bucket}/${m.prefix}`, ...m.common], m.env, { stallMs: 15_000 })
  return ls.code === 0 || (ls.code === 1 && !ls.stdout.trim() && !ls.stderr.trim()) ? { ok: true, detail: `${m.bucket} answered` } : { ok: false, detail: text(ls) }
}

/** docs/ADR-064: the POD sends its own files to every adapter that listens to this event: a signed link per file, `curl -T` on the pod, nothing through this PC. A file over 5 GB is a warning (one PUT is the limit); a file already there at the same size is skipped. Returns warnings. */
export interface PodFile { /** the key under /workspace on the pod */ source_key: string; /** the key below the adapter's directory */ key: string; bytes: number }
export async function uploadFromPod(ev: Event, pod: publish.PodRef, files: PodFile[], signal?: AbortSignal, volumeId?: string | null): Promise<string[]> {
  const out: string[] = [], list = forEvent(ev, volumeId); if (!list.length) return out
  const ok = files.filter((f) => !publish.isWeight(f.source_key))
  const job = uploads.open({ event: ev, targets: list.map((m) => m.name), source: 'pod', source_name: pod.name, files_total: ok.length * list.length, bytes_total: ok.reduce((a, f) => a + (f.bytes > publish.PUT_MAX_BYTES ? 0 : f.bytes), 0) * list.length, signal })
  try {
    for (const m of list) {
      let sent = 0, skipped = 0
      const there: string[] = []
      for (const f of ok) {
        if (job.signal.aborted) break
        const name = f.key.split('/').pop() ?? f.key; job.current(f.key)
        if (f.bytes > publish.PUT_MAX_BYTES) { const w = `${m.name}: ${name}: over 5 GB, not uploaded (multipart is a later step)`; out.push(w); job.warn(w); job.file('failed', 0); continue }
        if (await thereSameBytes(m, f.bytes, f.key)) { skipped++; there.push(f.key); job.file('skipped', 0); continue }
        const r = await publish.podPutTo(pod, f.source_key, f.bytes, m, `${m.prefix}${f.key}`, job.signal).catch((e) => ({ ok: false, error: publish.redact((e as Error).message) }))
        if (r.ok) { sent++; there.push(f.key); job.file('sent', f.bytes) } else if (!job.signal.aborted) { const w = `${m.name}: ${name}: ${publish.redact(r.error)}`; out.push(w); job.warn(w); job.file('failed', 0) }
      }
      history.record({ kind: 'change', area: 'configuration', action: `storage upload on ${ev}`, what: `${m.name} from pod ${pod.name}`, detail: `${sent} sent, ${skipped} already there, of ${ok.length} file(s)` })
      pullBack(ev, m.id, there)
    }
  } finally { job.end() }
  return out
}

/** Files that are only on the network volume go to every adapter that listens to this event, with no pod: each is read once over the volume's S3 API into a temporary file
 * on this PC, copied on, and removed. Skips and warnings as for the other uploads. */
export async function uploadFromVolume(ev: Event, volumeId: string, files: PodFile[], signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [], list = forEvent(ev, volumeId); if (!list.length) return out
  const ok = files.filter((f) => !publish.isWeight(f.source_key)); if (!ok.length) return out
  const v = await publish.volumeS3Access(volumeId)
  if (!v.ok) return [`the volume cannot be read: ${v.reason}`]
  const venv = { AWS_ACCESS_KEY_ID: v.id, AWS_SECRET_ACCESS_KEY: v.secret, AWS_REGION: v.region }
  const job = uploads.open({ event: ev, targets: list.map((m) => m.name), source: 'volume', source_name: volumeId, files_total: ok.length * list.length, bytes_total: ok.reduce((a, f) => a + f.bytes, 0) * list.length, signal })
  const dir = await mkdtemp(join(tmpdir(), 'storage-relay-'))
  const sent = new Map(list.map((m) => [m.id, { name: m.name, sent: 0, there: [] as string[] }]))
  try {
    for (const f of ok) {
      if (job.signal.aborted) break
      const name = f.key.split('/').pop() ?? f.key, need: Access[] = []
      job.current(f.key)
      for (const m of list) { if (await thereSameBytes(m, f.bytes, f.key)) { sent.get(m.id)!.there.push(f.key); job.file('skipped', 0) } else need.push(m) }
      if (!need.length) continue
      const tmp = join(dir, 'file')
      const got = await runAws(['s3', 'cp', `s3://${v.bucket}/${f.source_key}`, tmp, '--region', v.region, '--endpoint-url', v.endpoint], venv, { signal: job.signal, stallMs: 300_000 })
      for (const m of need) {
        const why = got.code !== 0 ? `not read from the volume: ${text(got)}` : await mirrorCopy(m, tmp, f.key, job.signal).catch((e) => publish.redact((e as Error).message))
        if (why) { if (!job.signal.aborted) { const w = `${m.name}: ${name}: ${why}`; out.push(w); job.warn(w); job.file('failed', 0) } } else { const s = sent.get(m.id)!; s.sent++; s.there.push(f.key); job.file('sent', f.bytes) }
      }
      await rm(tmp, { force: true })
    }
    for (const [id, s] of sent) {
      history.record({ kind: 'change', area: 'configuration', action: `storage upload on ${ev}`, what: `${s.name} from the volume`, detail: `${s.sent} sent, ${s.there.length - s.sent} already there, of ${ok.length} file(s)` })
      pullBack(ev, id, s.there)
    }
  } finally { await rm(dir, { recursive: true, force: true }); job.end() }
  return out
}

/** The Upload On jobs for the Queue: running first, then the newest finished (docs/ADR-064). */
export const uploadJobs = uploads.status
export const cancelUpload = uploads.cancel


// ----- travelling in a configuration file (docs/ADR-023, ADR-070): the records WITHOUT keys; the keys go in the file's `secrets` block -----
export const TITLE_IDS = [PUBLISH_ID, PANAMA_ID] as const
export interface PortableRec { id: string; name: string; endpoint: string; region: string; bucket: string; prefix: string; enabled: boolean }
export interface PortableStorages { adapters: PortableRec[]; /** the Default Storage id; '' = none */ default: string; /** the order the cards are shown in (ids) */ order: string[]; /** the titles of publish-s3 and panama-s3 (only the ones that were renamed) */ titles: Partial<Record<'publish-s3' | 'panama-s3', string>> }
export type KeyPair = { access_key_id: string; secret_access_key: string }
const portableOf = (s: Store): PortableStorages => ({
  adapters: s.adapters.map((r) => ({ id: r.id, name: r.name, endpoint: r.endpoint, region: r.region, bucket: r.bucket, prefix: r.prefix, enabled: !!r.enabled })),
  default: s.default && s.adapters.some((a) => a.id === s.default) ? s.default : '',
  order: [...(s.order ?? [])],
  titles: Object.fromEntries(TITLE_IDS.filter((id) => s.flags[id]?.name).map((id) => [id, s.flags[id].name as string])),
})
/** The storages as they travel: no keys. */
export const portable = (): PortableStorages => portableOf(read())
/** The keys of the storages that have both, by id, for the export's `secrets` block. Never returned to a window. */
export function exportKeys(): Record<string, KeyPair> {
  return Object.fromEntries(read().adapters.filter((r) => r.access_key_id && r.secret_access_key).map((r) => [r.id, { access_key_id: r.access_key_id, secret_access_key: r.secret_access_key }]))
}
/** The ids of the storages here (Wasabi is always one). */
export const realIds = (): string[] => { const s = read(); return [...new Set([WASABI_ID, ...s.adapters.map((a) => a.id)])] }
/** Whether a pair of keys looks right (same rules as a save). Null when fine; the message never carries a value. */
export function checkKeyPair(k: unknown): string | null {
  if (!k || typeof k !== 'object') return 'the keys are { access_key_id, secret_access_key }'
  const { access_key_id: a, secret_access_key: b } = k as Record<string, unknown>
  if (typeof a !== 'string' || /\s/.test(a.trim()) || a.trim().length < 8 || a.trim().length > 128) return 'access_key_id looks wrong (8 to 128 characters, no spaces)'
  if (typeof b !== 'string' || /\s/.test(b.trim()) || b.trim().length < 16 || b.trim().length > 256) return 'secret_access_key looks wrong (16 to 256 characters, no spaces)'
  return null
}
/** A storages section from a file, checked like a save: a bad value is an error that names the storage and the field. Unknown fields are ignored. */
export function checkPortable(v: unknown): { value: PortableStorages; error: string | null } {
  const out: PortableStorages = { adapters: [], default: '', order: [], titles: {} }
  const fail = (m: string) => ({ value: out, error: m })
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('storages is an object')
  const o = v as Record<string, unknown>
  if (o.adapters !== undefined && !Array.isArray(o.adapters)) return fail('storages.adapters is a list')
  for (const [i, raw] of ((o.adapters ?? []) as unknown[]).entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(`storages.adapters[${i}] is an object`)
    const r = raw as Record<string, unknown>, id = r.id
    if (typeof id !== 'string' || !(id === WASABI_ID || (ID.test(id) && !RESERVED.has(id)))) return fail(`storages.adapters[${i}].id is "wasabi" or lower case letters, digits and hyphens (not a built-in name)`)
    if (out.adapters.some((a) => a.id === id)) return fail(`storages.adapters: ${id} is listed twice`)
    if (typeof r.enabled !== 'boolean') return fail(`storages.adapters[${id}].enabled is true or false`)
    try {
      const c = clean({ name: r.name as string, endpoint: (r.endpoint ?? '') as string, region: (r.region ?? '') as string, bucket: (r.bucket ?? '') as string, prefix: (r.prefix ?? '') as string }, { id, name: id, endpoint: '', region: '', bucket: '', prefix: '', enabled: false, access_key_id: '', secret_access_key: '' })
      out.adapters.push({ id, name: c.name, endpoint: c.endpoint, region: c.region, bucket: c.bucket, prefix: c.prefix, enabled: r.enabled })
    } catch (e) { return fail(`storages.adapters[${id}]: ${(e as Error).message}`) }
  }
  if (o.default !== undefined && o.default !== '' && o.default !== null) { if (typeof o.default !== 'string' || !(o.default === WASABI_ID || ID.test(o.default))) return fail('storages.default is a storage id'); out.default = o.default }
  if (o.order !== undefined) { if (!Array.isArray(o.order) || o.order.some((x) => typeof x !== 'string' || x.length > 64)) return fail('storages.order is a list of storage ids'); out.order = [...new Set(o.order as string[])].slice(0, 100) }
  if (o.titles !== undefined) {
    if (!o.titles || typeof o.titles !== 'object' || Array.isArray(o.titles)) return fail('storages.titles maps publish-s3 and panama-s3 to a title')
    for (const [id, t] of Object.entries(o.titles as Record<string, unknown>)) {
      if (!(TITLE_IDS as readonly string[]).includes(id)) continue
      if (typeof t !== 'string' || t.trim().length > 60) return fail(`storages.titles.${id} is a title of at most 60 characters`)
      if (t.trim()) out.titles[id as 'publish-s3' | 'panama-s3'] = t.trim()
    }
  }
  return { value: out, error: null }
}
/**
 * Merge a checked storages section into what is here (what is here stays; the file's values win per storage) and, unless `dryRun`, write it (0600). `keys` are the
 * keys that will exist after the import: a storage that is `enabled` stays on only when it is complete with them, else it arrives off and a warning names it.
 * The Default Storage and the order keep only ids that exist after the merge. Returns what the file would hold (no keys) and the warnings.
 */
export function importStorages(p: PortableStorages, keys: Record<string, KeyPair>, opts: { dryRun?: boolean } = {}): { incoming: PortableStorages; warnings: string[] } {
  const s = read(), warnings: string[] = []
  const have = new Map(s.adapters.map((a) => [a.id, a]))
  for (const r of p.adapters) {
    const base = have.get(r.id) ?? (r.id === WASABI_ID ? { ...WASABI_DEFAULT } : { id: r.id, name: r.name, endpoint: '', region: '', bucket: '', prefix: '', enabled: false, access_key_id: '', secret_access_key: '' })
    const next: Rec = { ...base, name: r.name, endpoint: r.endpoint, region: r.region, bucket: r.bucket, prefix: r.prefix }
    const k = keys[r.id]; if (k && !checkKeyPair(k)) { next.access_key_id = k.access_key_id.trim(); next.secret_access_key = k.secret_access_key.trim() }
    next.enabled = r.enabled
    const problem = r.enabled ? problemOf(next) : undefined
    if (problem) { next.enabled = false; warnings.push(`Storage "${r.name}" arrives off: ${problem.toLowerCase()} (import the Keys and tokens with it, or add them here).`) }
    have.set(r.id, next)
  }
  const flags = { ...s.flags }
  for (const id of TITLE_IDS) if (p.titles[id]) flags[id] = { ...(flags[id] ?? { enabled: true }), name: p.titles[id] }
  const exists = (id: string) => id === WASABI_ID || have.has(id)
  let def = s.default
  if (p.default) { if (exists(p.default)) def = p.default; else warnings.push(`The Default Storage "${p.default}" is not in the file or on this machine: the default is unchanged.`) }
  const known = new Set<string>([...BUILTIN_IDS, ...have.keys()])
  const order = p.order.length ? p.order.filter((id) => known.has(id)) : [...(s.order ?? [])]
  const dropped = p.order.filter((id) => !known.has(id)); if (dropped.length) warnings.push(`Not in the order, no such storage: ${dropped.slice(0, 10).join(', ')}.`)
  const next: Store = { flags, adapters: [...have.values()], order, ...(def ? { default: def } : {}) }
  if (!opts.dryRun) write(next)
  return { incoming: portableOf(next), warnings }
}
/** Put the keys of an import onto storages that exist here (Wasabi always does); returns the ids it had no record for. Writes nothing when none applies. */
export function setKeys(keys: Record<string, KeyPair>): string[] {
  const s = read(), skipped: string[] = []; let changed = false
  for (const [id, k] of Object.entries(keys)) {
    const r = id === WASABI_ID ? recOf(s, id) : s.adapters.find((a) => a.id === id)
    if (!r || checkKeyPair(k)) { skipped.push(id); continue }
    s.adapters = [...s.adapters.filter((a) => a.id !== id), { ...r, access_key_id: k.access_key_id.trim(), secret_access_key: k.secret_access_key.trim() }]; changed = true
  }
  if (changed) write(s)
  return skipped
}
/** Hints (last four characters of the access key id) of every storage's keys here, for a preview. */
export const keyHints = (): Record<string, string> => Object.fromEntries(read().adapters.filter((r) => r.access_key_id).map((r) => [r.id, hint(r.access_key_id)]))
