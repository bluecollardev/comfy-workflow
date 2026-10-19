/**
 * Idle stop: a pod that has had nothing queued in its ComfyUI for N minutes is stopped.
 *
 * RunPod bills a running pod by the hour whether or not it renders, and the one bill nobody plans
 * for is the pod someone forgot. Each pod created with idle_stop_minutes > 0 is registered here
 * (~/.config/runpod-pod-manager/idle.json); a sweep probes each registered running pod's ComfyUI
 * through RunPod's proxy: /queue (anything running or pending) and /history (a new prompt finished).
 * Either counts as activity. After N quiet minutes the pod is stopped and the entry dropped. A pod
 * the probe cannot reach is treated as quiet: a pod that is up but unreachable still costs money.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { idleFile } from './paths.js'

export interface IdleEntry { minutes: number; last_activity: string; last_prompt: string | null }
export interface ProbeResult { busy: boolean; last_prompt: string | null; reachable: boolean }
export const PROBE_EVERY_MS = 60_000

/** RunPod's HTTP proxy for a pod port. */
export const proxyUrl = (podId: string, port = 8188) => `https://${podId}-${port}.proxy.runpod.net`

export function load(): Record<string, IdleEntry> {
  const f = idleFile()
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}

export function save(reg: Record<string, IdleEntry>): void {
  const f = idleFile()
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, JSON.stringify(reg, null, 2) + '\n')
}

/** Watch a pod; minutes <= 0 removes it from the watch. */
export function register(podId: string, minutes: number, now = new Date()): void {
  const reg = load()
  if (minutes <= 0) delete reg[podId]
  else reg[podId] = { minutes: Math.floor(minutes), last_activity: now.toISOString(), last_prompt: null }
  save(reg)
}

export function forget(podId: string): void {
  const reg = load()
  if (podId in reg) { delete reg[podId]; save(reg) }
}

export const entry = (podId: string): IdleEntry | undefined => load()[podId]

/** What ComfyUI on the pod is doing, through RunPod's proxy. */
export async function probe(podId: string, fetchFn: typeof fetch = fetch): Promise<ProbeResult> {
  const base = proxyUrl(podId)
  try {
    const q = (await (await fetchFn(`${base}/queue`, { signal: AbortSignal.timeout(8000) })).json()) as { queue_running?: unknown[]; queue_pending?: unknown[] }
    const busy = !!(q.queue_running?.length || q.queue_pending?.length)
    const h = (await (await fetchFn(`${base}/history?max_items=1`, { signal: AbortSignal.timeout(8000) })).json()) as Record<string, unknown>
    const last = h && typeof h === 'object' ? Object.keys(h)[0] ?? null : null
    return { busy, last_prompt: last, reachable: true }
  } catch {
    return { busy: false, last_prompt: null, reachable: false }
  }
}

/** Update one registry entry from a probe; returns the entry and whether to stop now. */
export function decide(e: IdleEntry, p: ProbeResult, now: Date): [IdleEntry, boolean] {
  const out = { ...e }
  const active = p.busy || (!!p.last_prompt && p.last_prompt !== e.last_prompt)
  if (p.last_prompt) out.last_prompt = p.last_prompt
  if (active) { out.last_activity = now.toISOString(); return [out, false] }
  const quietS = (now.getTime() - new Date(e.last_activity).getTime()) / 1000
  return [out, quietS >= e.minutes * 60]
}

/** One pass over the registry. `running` lists the pod ids RunPod says are running; `stop` stops one. */
export async function sweep(running: () => Promise<Set<string>> | Set<string>, stop: (id: string) => Promise<void> | void,
  probeFn: (id: string) => Promise<ProbeResult> = probe, now = new Date()): Promise<string[]> {
  const reg = load()
  if (!Object.keys(reg).length) return []
  const live = await running()
  const stopped: string[] = []
  for (const podId of Object.keys(reg)) {
    if (!live.has(podId)) continue   // stopped or gone: keep the entry in case it is resumed
    const [e, stopNow] = decide(reg[podId], await probeFn(podId), now)
    reg[podId] = e
    if (stopNow) {
      try { await stop(podId); stopped.push(podId); delete reg[podId] } catch (err) { console.error(`idle stop of ${podId} failed: ${(err as Error).message}`) }
    }
  }
  save(reg)
  return stopped
}

/** The loop an adapter starts: sweep every minute, forever, never throwing. Returns a stop function. */
export function loop(running: () => Promise<Set<string>> | Set<string>, stop: (id: string) => Promise<void> | void): () => void {
  const timer = setInterval(() => { sweep(running, stop).catch((e) => console.error(`idle sweep failed: ${(e as Error).message}`)) }, PROBE_EVERY_MS)
  return () => clearInterval(timer)
}
