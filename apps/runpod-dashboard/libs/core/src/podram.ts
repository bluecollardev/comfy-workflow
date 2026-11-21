/**
 * The container memory a running pod really has, for the pod card.
 *
 * Source: the container's cgroup (`memory.max` / `memory.current`), read over SSH by chunking.readRam, the same
 * reading the RAM guard trusts. Not used, on purpose:
 *  - ComfyUI's `/system_stats` `ram_total`: it reports the HOST's memory, not the container's limit (docs/CHUNKING.md).
 *  - RunPod's `memoryInGb`: not checked against the observed limits (57.7 GiB for 1x RTX PRO 4500, 116.4 GiB for
 *    2x, 87.5 GiB for 1x RTX PRO 6000), so it is never shown as the limit.
 * Unknown (pod stopped, SSH fails, no limit) means no figure, never a guess.
 *
 * The list is polled often and an SSH read is not cheap: one read per pod is cached for TTL_MS (a failure for
 * FAIL_TTL_MS), at most one is in flight per pod, and list() never waits for it. The card gets the figure on a
 * later poll.
 */
export interface PodRam { ram_gb: number; ram_used_gb: number; ram_pct: number; ram_source: 'cgroup' }
export interface RamReading { used: number; limit: number; pct: number }
export type Reader = (podId: string) => Promise<RamReading | null>

export const TTL_MS = 60_000
export const FAIL_TTL_MS = 300_000
const GIB = 2 ** 30
const round1 = (n: number) => Math.round(n * 10) / 10

const defaultReader: Reader = async (id) => (await import('./chunking.js')).readRam(id)   // lazy: chunking imports pods
const cache = new Map<string, { at: number; value: PodRam | null }>()
const inflight = new Set<string>()
let reader: Reader = defaultReader
export const setReader = (r: Reader | null) => { reader = r ?? defaultReader }
export const clear = () => { cache.clear(); inflight.clear() }

/** A cgroup reading as the card's fields (GiB, one decimal). */
export function toFields(r: RamReading | null): PodRam | null {
  if (!r || !(r.limit > 0)) return null
  return { ram_gb: round1(r.limit / GIB), ram_used_gb: round1(r.used / GIB), ram_pct: r.pct, ram_source: 'cgroup' }
}

/** What is known now for a running pod; starts a background read when the cache is stale. Never waits, never throws. */
export function peek(podId: string, now = Date.now()): PodRam | null {
  const c = cache.get(podId)
  const age = c ? now - c.at : Infinity
  if (age >= (c && !c.value ? FAIL_TTL_MS : TTL_MS) && !inflight.has(podId)) {
    inflight.add(podId)
    reader(podId).then(toFields, () => null).then((value) => { cache.set(podId, { at: Date.now(), value }) }).finally(() => inflight.delete(podId))
  }
  return c?.value ?? null
}

/** A pod that stopped or went away: forget its figure so a restart does not show the old one. */
export const forget = (podId: string) => { cache.delete(podId) }
