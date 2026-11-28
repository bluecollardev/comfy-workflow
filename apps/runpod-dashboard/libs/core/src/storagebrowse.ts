/**
 * Read-only look into a storage adapter's bucket, one level at a time (Network Volumes > Storage > Explore). Only ever `aws s3 ls`.
 * storage.ts keeps its record reader private, so this file reads the same storage-adapters.json for the keys of your own storages and Wasabi;
 * `panama-s3` goes through panama.browse and `publish-s3` is only readable when it uses the Panama bucket (ADR-065). Keys are never returned or put in an error.
 */
import { readFileSync } from 'node:fs'
import { signHeaders } from './s3presign.js'
import { join } from 'node:path'
import { bad } from './errors.js'
import { configDir } from './paths.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as publish from './publish.js'
import * as storage from './storage.js'

export interface StorageFile { name: string; bytes: number; modified: string }
export interface StorageListing { id: string; bucket: string; prefix: string; folders: string[]; files: StorageFile[]; truncated: boolean }
const CAP = 2000
let awsFn: podpull.AwsRunner | null = null
/** Tests inject a fake runner. */
export const setAws = (f: podpull.AwsRunner | null) => { awsFn = f }

/** '' (the top of the bucket) or folders like `returns/BKK/`; no `..`, no leading slash. Returned with one trailing slash (or ''). */
export function cleanPrefix(prefix: unknown): string {
  const p = String(prefix ?? '')
  if (!/^[\w .+@=,()/-]{0,300}$/.test(p) || p.startsWith('/') || p.split('/').includes('..') || p.includes('//')) throw bad(`Not a folder in the bucket: ${p.slice(0, 80)}`)
  return p === '' ? '' : p.replace(/\/+$/, '') + '/'
}
/** Parse `aws s3 ls` output of one level: `PRE name/` lines are folders, `date time bytes name` lines are files. */
export function parseLs(out: string, cap = CAP): { folders: string[]; files: StorageFile[]; truncated: boolean } {
  const folders: string[] = [], files: StorageFile[] = []
  let truncated = false
  for (const line of out.split('\n')) {
    const d = /^\s*PRE\s+(.+)\/\s*$/.exec(line)
    const f = d ? null : /^(\d{4}-\d\d-\d\d)\s+(\d\d:\d\d:\d\d)\s+(\d+)\s+(.+)$/.exec(line)
    if (!d && !f) continue
    if (folders.length + files.length >= cap) { truncated = true; break }
    if (d) folders.push(d[1]); else if (f) files.push({ name: f[4], bytes: Number(f[3]), modified: `${f[1]}T${f[2]}` })
  }
  return { folders, files, truncated }
}

interface RawRec { id: string; name?: string; endpoint?: string; region?: string; bucket?: string; access_key_id?: string; secret_access_key?: string }
function record(id: string): RawRec | undefined {
  try {
    const j = JSON.parse(readFileSync(process.env.STORAGE_ADAPTERS_FILE || join(configDir(), 'storage-adapters.json'), 'utf8'))
    return (Array.isArray(j?.adapters) ? j.adapters : []).find((a: RawRec) => a?.id === id)
  } catch { return undefined }
}
const scrub = (t: string, keys: (string | undefined)[]): string => {
  let s = publish.redact((t.trim().split('\n')[0] || 'the listing failed').slice(0, 300))
  for (const v of keys) if (v) s = s.split(v).join('***')
  return s.replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, '***')
}

/** One level of an adapter's bucket: `prefix` is a folder in the bucket ('' = the top). */
export async function browse(id: string, prefix: string = ''): Promise<StorageListing> {
  id = String(id || ''); const dir = cleanPrefix(prefix)
  const view = (await storage.list()).adapters.find((a) => a.id === id)
  if (!view) throw bad(`no storage adapter ${id}`)
  if (id === storage.PANAMA_ID) {
    const r = await panama.browse(dir, awsFn ? { aws: awsFn } : {})
    return { id, bucket: r.bucket, prefix: r.prefix, folders: r.folders.map((f) => f.name), files: r.files.map((f) => ({ name: f.name, bytes: f.bytes, modified: f.modified })), truncated: r.truncated }
  }
  let env: Record<string, string>, common: string[], keys: (string | undefined)[]
  if (id === storage.PUBLISH_ID) {
    if (view.bucket && view.bucket === panama.bucket()) return { ...(await browse(storage.PANAMA_ID, dir)), id }   // the same bucket and keys as the exchange (ADR-065)
    throw bad('This destination has its own keys, which only the publisher can read: browsing it needs an accessor exported from storage.ts')
  } else {
    const r = record(id) ?? (id === storage.WASABI_ID ? { id } : undefined)
    if (!r) throw bad(`no storage adapter ${id}`)
    if (!view.ready || !r.access_key_id || !r.secret_access_key || !view.bucket) throw bad(view.problem || 'Add a bucket, a region and keys first')
    env = { AWS_ACCESS_KEY_ID: r.access_key_id, AWS_SECRET_ACCESS_KEY: r.secret_access_key, AWS_REGION: view.region }
    common = ['--region', view.region, ...(view.endpoint ? ['--endpoint-url', view.endpoint] : [])]
    keys = [r.access_key_id, r.secret_access_key]
  }
  const run = awsFn ?? podpull.defaultAws
  let r: podpull.AwsResult
  try { r = await run(['s3', 'ls', `s3://${view.bucket}/${dir}`, ...common], env, { stallMs: 60_000 }) } catch (e) { throw bad(`The bucket could not be read: ${scrub(String((e as Error).message), keys)}`) }
  if (r.code !== 0 && !(r.code === 1 && !r.stdout.trim() && !r.stderr.trim())) throw bad(`The bucket could not be read: ${r.transient ? 'The storage did not answer (the connection failed)' : scrub(r.stderr || r.stdout, keys)}`)
  return { id, bucket: view.bucket, prefix: dir, ...parseLs(r.stdout) }
}

/** The address a page uses for one object of a storage: `s3file://storage.<id>/<url-encoded key>` (the same read-only protocol as a volume's files, served by the main process). */
export function guardStorageUrl(url: string): { id: string; key: string } {
  const no = (why: string) => new Error(`Only files of a storage the app knows are served here (${why}).`)
  let u: URL; try { u = new URL(String(url)) } catch { throw no('not a URL') }
  const m = /^storage\.([a-z0-9][a-z0-9-]{1,30})$/.exec(u.hostname.toLowerCase())
  if (u.protocol !== 's3file:' || !m) throw no('not a storage address')
  let key: string; try { key = decodeURIComponent(u.pathname.replace(/^\/+/, '')) } catch { throw no('bad encoding') }
  if (u.search || u.hash || !key || key.endsWith('/') || key.length > 1024 || key.split('/').some((s) => !s || s === '.' || s === '..') || /[\\\u0000-\u001f]/.test(key)) throw no('bad path')
  return { id: m[1], key }
}
/** A signed read of one object (SigV4 headers, Range included) for the main process; keys stay here. Read-only: GET only. */
export async function signGet(url: string, opts: { range?: string | null; now?: Date } = {}): Promise<{ url: string; headers: Record<string, string> }> {
  const g = guardStorageUrl(url), view = (await storage.list()).adapters.find((a) => a.id === g.id)
  if (!view || !view.ready || !view.bucket) throw bad(`no storage ${g.id} that is ready`)
  let id: string | undefined, secret: string | undefined
  if (g.id === storage.PANAMA_ID || (g.id === storage.PUBLISH_ID && view.bucket === panama.bucket())) { const k = panama.appKeys(); id = k?.id; secret = k?.secret }
  else if (g.id === storage.PUBLISH_ID) throw bad('This destination has its own keys, which only the publisher can read')
  else { const r = record(g.id); id = r?.access_key_id; secret = r?.secret_access_key }
  if (!id || !secret) throw bad('The storage has no keys the app can use')
  const host = view.endpoint ? new URL(view.endpoint).host : `s3.${view.region}.amazonaws.com`
  const range = opts.range && /^bytes=\d*-\d*$/.test(opts.range) ? opts.range : undefined
  return signHeaders({ host, path: `/${view.bucket}/${g.key}`, accessKey: id, secretKey: secret, region: view.region, now: opts.now, range })
}
