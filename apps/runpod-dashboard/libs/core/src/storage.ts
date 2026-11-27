/**
 * Storage adapters (docs/ADR-063): an adapter here is one S3-compatible storage, never code: endpoint (blank = AWS), region, bucket, directory,
 * keys and an `enabled` switch. Three are built in: `publish-s3` (the Publishing destination, whose values stay in publish.json), `panama-s3`
 * (the Panama BH exchange bucket, whose values stay in the PANAMA_* settings) and `wasabi`; people add more. Publishing mirrors each uploaded file
 * to every other enabled adapter. Keys live in storage-adapters.json (mode 0600) and are never returned, logged or put in an error: a hint only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import * as history from './history.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import { configDir } from './paths.js'

export const PUBLISH_ID = 'publish-s3', PANAMA_ID = 'panama-s3', WASABI_ID = 'wasabi'
export const BUILTIN_IDS = [PUBLISH_ID, PANAMA_ID, WASABI_ID]
const RESERVED = new Set(BUILTIN_IDS)
export interface Rec { id: string; name: string; endpoint: string; region: string; bucket: string; prefix: string; enabled: boolean; access_key_id: string; secret_access_key: string; /** the moments it receives files (docs/ADR-064); missing = ['publishing'], what adapters did before events */ events?: string[] }
export const EVENTS = ['generating', 'generated', 'approved', 'publishing', 'published'] as const
export type Event = (typeof EVENTS)[number]
const eventsOf = (r: Rec): string[] => (Array.isArray(r.events) ? r.events.filter((e) => (EVENTS as readonly string[]).includes(e)) : ['publishing'])
interface Store { flags: Record<string, { enabled: boolean; events?: string[]; name?: string }>; adapters: Rec[]; /** the order the cards are shown in (ids; Lucas drags them), docs/ADR-064 */ order?: string[] }
export interface View { id: string; name: string; builtin: boolean; kind: 'publish' | 'panama' | 'wasabi' | 'custom'; enabled: boolean; endpoint: string; region: string; bucket: string; prefix: string; ready: boolean; problem?: string; key_hint: string; /** the events it uploads on (ADR-064) */ events: string[]; /** where the values are edited when not here */ edit?: 'publish' | 'panama' }

const file = () => process.env.STORAGE_ADAPTERS_FILE || join(configDir(), 'storage-adapters.json')
function read(): Store {
  try { const j = JSON.parse(readFileSync(file(), 'utf8')); return { flags: j?.flags && typeof j.flags === 'object' ? j.flags : {}, adapters: Array.isArray(j?.adapters) ? j.adapters : [], order: Array.isArray(j?.order) ? j.order.filter((x: unknown) => typeof x === 'string') : [] } } catch { return { flags: {}, adapters: [] } }
}
function write(s: Store): void {
  const f = file(); mkdirSync(dirname(f), { recursive: true })
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
  return { id: r.id, name: r.name, builtin: r.id === WASABI_ID, kind: r.id === WASABI_ID ? 'wasabi' : 'custom', enabled, endpoint: endpointOf(r), region: r.region, bucket: r.bucket, prefix: r.prefix, ready: !p, ...(p ? { problem: p } : {}), key_hint: hint(r.access_key_id), events: eventsOf(r) }
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
  return { adapters: out.map((v, i) => ({ v, i })).sort((a, b) => at(a.v.id) - at(b.v.id) || a.i - b.i).map((x) => x.v) }
}
/** Save the order the cards are shown in. Unknown ids are dropped; a storage not named goes last, in its usual place. */
export async function reorder(ids: unknown): Promise<{ adapters: View[] }> {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw bad('order is a list of storage ids')
  const have = new Set((await list()).adapters.map((a) => a.id)), s = read()
  s.order = [...new Set(ids as string[])].filter((x) => have.has(x)); write(s)
  return list()
}

const ID = /^[a-z0-9][a-z0-9-]{1,30}$/
export interface SaveInput { id?: string; name?: string; endpoint?: string; region?: string; bucket?: string; prefix?: string; enabled?: boolean; access_key_id?: string; secret_access_key?: string; events?: string[] }
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
  s.adapters = s.adapters.filter((a) => a.id !== id); write(s)
  history.record({ kind: 'change', area: 'configuration', action: 'storage adapter removed', what: id, detail: '' })
  return list()
}

// ----- using one -----
export interface Access { id: string; name: string; bucket: string; prefix: string; env: Record<string, string>; common: string[] }
const accessOf = (r: Rec): Access => { const ep = endpointOf(r); return { id: r.id, name: r.name, bucket: r.bucket, prefix: r.prefix, env: { AWS_ACCESS_KEY_ID: r.access_key_id, AWS_SECRET_ACCESS_KEY: r.secret_access_key, AWS_REGION: r.region }, common: ['--region', r.region, ...(ep ? ['--endpoint-url', ep] : [])] } }
/** The adapters a publish mirrors to: enabled and complete, never `publish-s3` itself (that one is the destination) and never the Panama bucket. */
export function mirrors(): Access[] { return forEvent('publishing') }
/** The adapters that take files on this event (ADR-064): enabled, complete and with the event ticked. */
export function forEvent(ev: Event): Access[] { return read().adapters.filter((r) => r.enabled && !problemOf(r) && eventsOf(r).includes(ev)).map(accessOf) }
/** True when the bucket already has this key at the file's size (a file sent on two events goes once). A failed look is "no": the copy decides. */
async function thereSame(m: Access, abs: string, key: string): Promise<boolean> {
  try { const [st, r] = [await stat(abs), await runAws(['s3', 'ls', `s3://${m.bucket}/${m.prefix}${key}`, ...m.common], m.env, { stallMs: 15_000 })]; const sz = r.code === 0 ? Number(r.stdout.trim().split(/\s+/)[2]) : NaN; return sz === st.size } catch { return false }
}
/** Upload files on an event to every adapter that listens; weights never go. Returns warnings (a failed copy is one, never an error). */
export async function uploadOn(ev: Event, files: { abs: string; key: string }[], signal?: AbortSignal): Promise<string[]> {
  const out: string[] = [], list = forEvent(ev); if (!list.length) return out
  const ok = files.filter((f) => !publish.isWeight(f.abs))
  for (const m of list) {
    let sent = 0
    for (const f of ok) { if (await thereSame(m, f.abs, f.key)) { sent++; continue }; const why = await mirrorCopy(m, f.abs, f.key, signal).catch((e) => publish.redact((e as Error).message)); if (why) { if (!signal?.aborted) out.push(`${m.name}: ${f.key.split('/').pop()}: ${why}`) } else sent++ }
    history.record({ kind: 'change', area: 'configuration', action: `storage upload on ${ev}`, what: m.name, detail: `${sent} of ${ok.length} file(s)` })
  }
  return out
}

type Aws = podpull.AwsRunner
let awsFn: Aws | null = null
export const setAws = (f: Aws | null) => { awsFn = f }
const runAws: Aws = (a, e, o) => (awsFn ?? podpull.defaultAws)(a, e, o)
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
