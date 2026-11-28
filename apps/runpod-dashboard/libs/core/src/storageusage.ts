/**
 * How big a storage's bucket is (docs/ADR-066: the details a storage row shows beside a volume's "2500 GB in EU-RO-1 · about $145 a month"). A read-only listing of the
 * bucket under its directory through the same `aws` runner as storage.ts: it runs in the background, counts as lines arrive, and the answer is kept 10 minutes.
 * No keys, no links in any message. The price is a guess a person can check: Wasabi's pay-as-you-go list price (wasabi.com/pricing), nothing for the others.
 */
import * as panama from './panama.js'
import * as storage from './storage.js'
import * as publish from './publish.js'

export interface Usage { bytes: number; objects: number; as_of: string; state: 'done' | 'listing' | 'failed'; objects_so_far?: number; error?: string; price_per_tb_month: number | null }
export const WASABI_USD_PER_TB_MONTH = 7.99, KEEP_MS = 10 * 60_000
interface Entry { u: Usage; at: number; ac?: AbortController }
const cache = new Map<string, Entry>()
let now = () => Date.now()
export const setClock = (f: (() => number) | null) => { now = f ?? (() => Date.now()) }
export const reset = () => { for (const e of cache.values()) e.ac?.abort(); cache.clear() }

const price = (id: string): number | null => (id === storage.WASABI_ID ? WASABI_USD_PER_TB_MONTH : null)
/** The access for any storage; the publish destination and the Panama exchange are the one Panama bucket, listed whole. */
function accessFor(id: string): { bucket: string; prefix: string; env: Record<string, string>; common: string[] } {
  if (id === storage.PUBLISH_ID || id === storage.PANAMA_ID) {
    const k = panama.appKeys()
    return { bucket: panama.bucket(), prefix: '', env: k ? { AWS_ACCESS_KEY_ID: k.id, AWS_SECRET_ACCESS_KEY: k.secret, AWS_REGION: panama.region() } : {}, common: [...(k ? [] : ['--profile', panama.profile()]), '--region', panama.region()] }
  }
  const a = storage.storageAccess(id)
  return { bucket: a.bucket, prefix: a.prefix, env: a.env, common: a.common }
}

async function run(id: string, e: Entry): Promise<void> {
  const ac = new AbortController(); e.ac = ac
  let rest = '', bytes = 0, objects = 0
  const eat = (chunk: string) => {
    rest += chunk
    const lines = rest.split('\n'); rest = lines.pop() ?? ''
    for (const l of lines) { const m = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\s+(\d+)\s/.exec(l); if (m) { bytes += Number(m[1]); objects++ } }
    e.u.objects_so_far = objects
  }
  try {
    const a = accessFor(id)
    const r = await storage.aws(['s3', 'ls', `s3://${a.bucket}/${a.prefix}`, '--recursive', ...a.common], a.env, { signal: ac.signal, stallMs: 90_000, onData: eat })
    eat('\n')
    if (ac.signal.aborted) return
    const empty = r.code === 1 && !r.stdout.trim() && !r.stderr.trim()   // an empty bucket exits 1 with no text
    if (r.code !== 0 && !empty) { e.u = { ...e.u, state: 'failed', error: publish.redact((r.stderr || r.stdout).trim().split('\n').pop() || `aws exited ${r.code}`).slice(0, 200) }; return }
    e.u = { bytes, objects, as_of: new Date(now()).toISOString(), state: 'done', price_per_tb_month: price(id) }
  } catch (err) {
    if (!ac.signal.aborted) e.u = { ...e.u, state: 'failed', error: publish.redact((err as Error).message).slice(0, 200) }
  } finally { e.ac = undefined; e.at = now() }
}

/** The size of a storage's bucket. Returns at once: the cached answer, or `listing` with the objects counted so far (a listing starts when there is none or it is older than 10 minutes). Poll it. */
export function usage(id: string): Usage {
  const hit = cache.get(id)
  if (hit && (hit.u.state === 'listing' || now() - hit.at < KEEP_MS)) return { ...hit.u }
  const e: Entry = { u: { bytes: hit?.u.bytes ?? 0, objects: hit?.u.objects ?? 0, as_of: hit?.u.as_of ?? '', state: 'listing', objects_so_far: 0, price_per_tb_month: price(id) }, at: now() }
  cache.set(id, e)
  try { accessFor(id) } catch (err) { e.u = { ...e.u, state: 'failed', error: (err as Error).message }; return { ...e.u } }
  void run(id, e)
  return { ...e.u }
}
