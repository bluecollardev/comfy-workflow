/**
 * RunPod's API limits requests per minute and per hour (a 429 saying "rate limit exceeded for the hour window").
 * This is the one place the core remembers that: a core-wide backoff, a small cache of the read calls with
 * single flight (concurrent callers share one request), and the last good answer served as stale while RunPod
 * is limiting. Nothing here talks to RunPod; runpod.ts uses it around every call (ADR-042 section 18).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CoreError } from './errors.js'
import { configDir } from './paths.js'

export type LimitWindow = 'minute' | 'hour' | 'unknown'

/** RunPod is limiting requests: `retryAt` is when the core will try again (ISO). */
export class RateLimited extends CoreError {
  window: LimitWindow
  retryAt: string
  constructor(window: LimitWindow, retryAt: number, detail?: string) {
    super(429, `RunPod is limiting requests (${window} window): retrying at ${new Date(retryAt).toTimeString().slice(0, 5)}${detail ? ` (${detail})` : ''}`)
    this.window = window
    this.retryAt = new Date(retryAt).toISOString()
  }
}

let nowFn: () => number = () => Date.now()
/** Tests set the clock. */
export const setClock = (f: (() => number) | null) => { nowFn = f ?? (() => Date.now()) }

interface State { until: number; window: LimitWindow; since: number; strikes: number; message: string }
let state: State | null = null
let staleServed: { key: string; age_s: number; at: number } | null = null

/** What RunPod said, or what the message says, tells the window: "…for the minute window", "…the hour window". */
export function windowOf(text: string): LimitWindow {
  const m = /\b(minute|hour)\b/i.exec(text || '')
  return m ? (m[1].toLowerCase() as LimitWindow) : 'unknown'
}

/** Record a 429. `retryAfterS` is the Retry-After header when RunPod sent one. A minute window waits a minute; an hour window waits
 *  five minutes and then probes once, doubling (to fifteen) while RunPod still refuses. */
export function noteLimited(text: string, retryAfterS?: number | null): RateLimited {
  const now = nowFn()
  const win = windowOf(text)
  const strikes = (state?.strikes ?? 0) + (state && now >= state.until ? 1 : 0)
  let wait = win === 'minute' ? 60_000 : win === 'hour' ? [5, 10, 15][Math.min(strikes, 2)] * 60_000 : 2 * 60_000
  if (retryAfterS && retryAfterS > 0) wait = Math.max(wait, Math.min(retryAfterS * 1000, 60 * 60_000))
  state = { until: now + wait, window: win, since: state?.since ?? now, strikes, message: text }
  return new RateLimited(win, state.until, text.trim().slice(0, 120))
}

/** A call went through: the limit is over. */
export function noteOk(): void { if (state && nowFn() >= state.until) state = null }

/** Throws while backing off, so nothing hammers RunPod. */
export function guard(): void {
  if (state && nowFn() < state.until) throw new RateLimited(state.window, state.until, state.message.trim().slice(0, 120))
}

export interface Status { limited: boolean; window: LimitWindow | null; retry_at: string | null; since: string | null; stale_age_s: number | null; message: string | null }
/** For the window's banner and the MCP `rate_limited` field. `stale_age_s`: how old the last answer served from the cache was. */
export function status(): Status {
  const now = nowFn()
  if (!state || now >= state.until) {
    // Backed off long enough: the next call is allowed (a probe); until it answers, the banner stays only while an answer was served stale recently.
    const recentStale = staleServed && now - staleServed.at < 60_000
    return { limited: !!state && !!recentStale, window: state?.window ?? null, retry_at: state ? new Date(state.until).toISOString() : null, since: state ? new Date(state.since).toISOString() : null, stale_age_s: recentStale ? staleServed!.age_s : null, message: state?.message ?? null }
  }
  return { limited: true, window: state.window, retry_at: new Date(state.until).toISOString(), since: new Date(state.since).toISOString(), stale_age_s: staleServed && now - staleServed.at < 10 * 60_000 ? staleServed.age_s : null, message: state.message }
}
export const isLimited = () => !!state && nowFn() < state.until
export function reset(): void { state = null; staleServed = null; cache.clear() }

// ---- the cache -------------------------------------------------------------------------------------------------------------------------

interface Entry { value: unknown; at: number; inflight?: Promise<unknown> }
const cache = new Map<string, Entry>()

/** One shared answer per key for `ttlMs`; concurrent callers share one request. While RunPod limits (or the call is refused with a 429)
 *  the last good answer is returned, however old, and `status().stale_age_s` says how old. With no answer to fall back on the 429 is thrown. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = nowFn()
  const e = cache.get(key)
  if (e && e.value !== undefined && now - e.at < ttlMs) return e.value as T
  if (e?.inflight) return (await e.inflight) as T
  const stale = () => { const age = Math.round((nowFn() - (e?.at ?? 0)) / 1000); staleServed = { key, age_s: age, at: nowFn() }; return e!.value as T }
  if (isLimited()) { if (e?.value !== undefined) return stale(); guard() }
  const entry: Entry = e ?? { value: undefined, at: 0 }
  const p = (async () => {
    try {
      const v = await fn()
      entry.value = v; entry.at = nowFn()
      return v
    } catch (err) {
      if (err instanceof RateLimited && entry.value !== undefined) return stale()
      throw err
    } finally { entry.inflight = undefined }
  })()
  entry.inflight = p
  cache.set(key, entry)
  return (await p) as T
}

/** Drop cached answers whose key contains `part` (after a write: the next read asks RunPod). */
export function invalidate(part: string): void { for (const k of [...cache.keys()]) if (k.includes(part)) cache.delete(k) }
/** The cached value for a key whatever its age, or undefined. */
export const peek = <T>(key: string): T | undefined => cache.get(key)?.value as T | undefined

// ---- the last volumes seen, kept on disk ------------------------------------------------------------------------------------------------

export interface VolumeRecord { id: string; name: string; size: number; dataCenterId: string }
const volumesFile = () => process.env.VOLUMES_CACHE_FILE || join(configDir(), 'volumes-cache.json')
/** Remember the volumes RunPod last listed, so a restart during a rate limit still knows their names and datacenters. */
export function rememberVolumes(v: VolumeRecord[]): void {
  try { mkdirSync(dirname(volumesFile()), { recursive: true }); writeFileSync(volumesFile(), JSON.stringify({ at: new Date(nowFn()).toISOString(), volumes: v })) } catch { /* the cache is a convenience */ }
}
export function lastVolumes(): { at: string | null; volumes: VolumeRecord[] } {
  try { if (!existsSync(volumesFile())) return { at: null, volumes: [] }; const j = JSON.parse(readFileSync(volumesFile(), 'utf8')) as { at?: string; volumes?: VolumeRecord[] }; return { at: j.at ?? null, volumes: Array.isArray(j.volumes) ? j.volumes : [] } } catch { return { at: null, volumes: [] } }
}
export const lastVolume = (id: string): VolumeRecord | null => lastVolumes().volumes.find((v) => v.id === id) ?? null
