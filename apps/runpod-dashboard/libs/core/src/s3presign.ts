/**
 * AWS Signature Version 4 query authentication (a presigned GET) for an S3-compatible endpoint, in plain Node: no aws CLI, no SDK.
 * Used for RunPod's S3 API (docs/ADR-045): the main process presigns a read of one output file and fetches it, so a pod is not needed.
 * Pure: the secret goes in, a URL comes out; nothing is stored or logged here, and the caller must never hand the URL to a page or a log.
 */
import { createHash, createHmac } from 'node:crypto'

export interface PresignInput {
  method?: 'GET' | 'HEAD'
  /** the host the request goes to (path style: the endpoint's host; virtual-hosted: bucket.host) */
  host: string
  /** the absolute path, not yet encoded, starting with a slash: `/<bucket>/<key>` in path style */
  path: string
  accessKey: string
  secretKey: string
  region: string
  service?: string
  now?: Date
  /** seconds the URL stays valid (1 to 604800); default 300 */
  expires?: number
  scheme?: 'https' | 'http'
}

/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves ! ' ( ) * alone). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest()
const hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
/** `20130524T000000Z` */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function presign(i: PresignInput): string {
  const method = i.method ?? 'GET', service = i.service ?? 's3', now = i.now ?? new Date(), expires = i.expires ?? 300
  if (!(expires >= 1 && expires <= 604800)) throw new RangeError('expires is 1 to 604800 seconds')
  const amz = stamp(now), day = amz.slice(0, 8), scope = `${day}/${i.region}/${service}/aws4_request`
  const path = i.path.split('/').map(enc).join('/')
  const q: [string, string][] = [['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'], ['X-Amz-Credential', `${i.accessKey}/${scope}`], ['X-Amz-Date', amz], ['X-Amz-Expires', String(expires)], ['X-Amz-SignedHeaders', 'host']]
  const query = q.map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&')
  const canonical = [method, path, query, `host:${i.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, day), i.region), service), 'aws4_request')
  const sig = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  return `${i.scheme ?? 'https'}://${i.host}${path}?${query}&X-Amz-Signature=${sig}`
}

export interface SignInput extends Omit<PresignInput, 'expires'> {
  /** a Range header to send (it is signed with the request) */
  range?: string
  /** hex SHA-256 of the body; a GET has none */
  payloadHash?: string
}
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * SigV4 with an Authorization header, for a GET or HEAD: the headers to send (host is implied by the URL). RunPod's S3 API answers a presigned
 * (query-authenticated) URL with 401 "missing Authorization header" (checked live, 2026-11-17), so the main process signs each read this way instead.
 */
export function signHeaders(i: SignInput): { url: string; headers: Record<string, string> } {
  const method = i.method ?? 'GET', service = i.service ?? 's3', now = i.now ?? new Date()
  const amz = stamp(now), day = amz.slice(0, 8), scope = `${day}/${i.region}/${service}/aws4_request`, hash = i.payloadHash ?? EMPTY_SHA256
  const path = i.path.split('/').map(enc).join('/')
  const h: [string, string][] = [['host', i.host], ['x-amz-content-sha256', hash], ['x-amz-date', amz]]
  if (i.range) h.push(['range', i.range])
  h.sort((a, b) => (a[0] < b[0] ? -1 : 1))
  const signed = h.map(([k]) => k).join(';')
  const canonical = [method, path, '', `${h.map(([k, v]) => `${k}:${v}`).join('\n')}\n`, signed, hash].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, hex(canonical)].join('\n')
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretKey}`, day), i.region), service), 'aws4_request')
  const sig = createHmac('sha256', key).update(toSign, 'utf8').digest('hex')
  const headers: Record<string, string> = { 'x-amz-content-sha256': hash, 'x-amz-date': amz, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${sig}` }
  if (i.range) headers.range = i.range
  return { url: `${i.scheme ?? 'https'}://${i.host}${path}`, headers }
}
