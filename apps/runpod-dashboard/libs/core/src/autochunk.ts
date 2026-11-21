/**
 * The default path of a graph run (ADR-056, "make sure it's automatic"): probe, plan, chunk or run whole, guard, merge-check.
 * runflows.runOne calls `runGraph` for every graph of every entry point (run_pod_workflows, the queue's run tasks, Import Round); nobody asks for it.
 *
 *  1. A graph the app has not seen is PROBED: its first ~10 frames run as a real chunk (their files are real, nothing is wasted) with the container RAM sampled.
 *  2. RAM per frame is kept per graph in graph-memory.json (next to graph-durations.json): a repeat run needs no probe.
 *  3. PLAN: whole when the estimated peak stays under 60% of the container RAM, else chunks of the size that does (never more than 50 frames).
 *  4. GUARD: at 85% the run is interrupted and the chunk resubmitted as two halves (graphchunks.runChunks); at the smallest chunk it fails with the RAM-guard error and the queue escalates by GPU count (cards.escalateRam).
 *  5. MERGE CHECK: the chunks that finished make the graph's whole frame range, no gap, no repeat, or the graph fails.
 * It refuses to guess: a graph whose frame window it cannot find runs whole with the RAM guard only, and says so.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CoreError } from './errors.js'
import { configDir } from './paths.js'
import * as gc from './graphchunks.js'

export const PROBE_FRAMES = 10
/** Below this many frames a graph is small enough to run whole (guarded) without a probe. */
export const NO_PROBE_UNDER = 2 * PROBE_FRAMES
const GIB = 2 ** 30

export interface MemRecord { per_frame_gib: number; ram_gib: number; chunk: number; frames: number; measured_at: string }
const memFile = () => join(configDir(), 'graph-memory.json')
let memory: Map<string, MemRecord> | null = null
async function loadMemory(): Promise<Map<string, MemRecord>> {
  if (memory) return memory
  memory = new Map()
  try { for (const [k, v] of Object.entries(JSON.parse(await readFile(memFile(), 'utf8')) as Record<string, MemRecord>)) if (v && v.per_frame_gib > 0) memory.set(k, v) } catch { /* none yet */ }
  return memory
}
export const memoryOf = async (path: string): Promise<MemRecord | null> => (await loadMemory()).get(path) ?? null
export async function remember(path: string, rec: MemRecord): Promise<void> {
  try { const m = await loadMemory(); m.set(path, rec); const f = memFile(), t = `${f}.${process.pid}.tmp`; await mkdir(dirname(f), { recursive: true }); await writeFile(t, JSON.stringify(Object.fromEntries(m), null, 1)); await rename(t, f) } catch { /* a missing record only means a probe next time */ }
}
export const resetMemory = (): void => { memory = null }

export interface RamNow { used: number; limit: number; pct: number }
export interface RunCtx {
  path: string
  ui: unknown
  api: Record<string, unknown>
  submit: (api: Record<string, unknown>) => Promise<string>
  /** one look at a prompt: null while running; 'done'; or the error. Accumulating the outputs is the caller's. */
  outcome: (promptId: string) => Promise<'done' | { error: string } | null>
  ram: () => Promise<RamNow | null>
  interrupt: () => Promise<void>; free: () => Promise<void>; sleep: (ms: number) => Promise<void>
  /** a line for the task's events and the History */ say: (text: string) => void
  guardPct?: number; targetPct?: number; pad?: number; maxChunk?: number; pollMs?: number
}
export interface RunSummary { mode: 'whole' | 'chunked' | 'guard-only'; chunks: number; attempts: number; text: string }

const apiNodes = (api: Record<string, unknown>, type: string) => Object.values(api).filter((n): n is { class_type: string; inputs: Record<string, unknown> } => !!n && typeof n === 'object' && (n as { class_type?: string }).class_type === type)

/** A graph with no window it can narrow: submit it whole and watch the RAM; at the guard interrupt (nothing smaller to try) and fail with the RAM-guard error. */
async function wholeGuarded(c: RunCtx, why: string): Promise<RunSummary> {
  const guard = c.guardPct ?? gc.GUARD_PCT
  c.say(`chunking: not applied (${why}); running the graph whole with the RAM guard only (interrupt at ${guard}%)`)
  const id = await c.submit(c.api)
  for (;;) {
    const out = await c.outcome(id)
    if (out === 'done') return { mode: 'guard-only', chunks: 1, attempts: 1, text: `whole, guard only: ${why}` }
    if (out) throw new CoreError(500, out.error)
    const r = await c.ram()
    if (r && r.pct >= guard) { await c.interrupt(); await c.free(); throw new CoreError(507, `RAM guard: the container is at ${r.pct}% (${(r.used / GIB).toFixed(1)} of ${(r.limit / GIB).toFixed(1)} GiB), over the ${guard}% limit, and this graph has no frame window to split (${why}). Stopped before the kernel kills ComfyUI: it needs a pod with more RAM.`) }
    await c.sleep(c.pollMs ?? 10_000)
  }
}

export async function runGraph(c: RunCtx): Promise<RunSummary> {
  const guard = c.guardPct ?? gc.GUARD_PCT, target = c.targetPct ?? gc.TARGET_RAM_PCT, pad = c.pad ?? gc.DEFAULT_PAD, maxChunk = c.maxChunk ?? gc.DEFAULT_CHUNK_FRAMES
  let win: gc.GraphWindow
  try {
    win = gc.describeGraph(c.ui)
    if (apiNodes(c.api, 'OCIORead').length !== 1 || apiNodes(c.api, 'OCIOWrite').length !== 1) throw new CoreError(422, 'the converted graph does not have one OCIORead and one OCIOWrite')
  } catch (e) { return wholeGuarded(c, (e as Error).message) }
  const sourceStart = Number(apiNodes(c.api, 'OCIOWrite')[0].inputs.source_start) || win.sourceStart
  const first = await c.ram()
  const ramBytes = first?.limit ?? 0
  let rec = await memoryOf(c.path)
  const sample = { idle: first?.used ?? 0, peak: 0 }
  const track = async (): Promise<number | null> => { const r = await c.ram(); if (r) sample.peak = Math.max(sample.peak, r.used); return r ? r.pct : null }
  const run = (chunks: gc.GraphChunk[]) => gc.runChunks({
    build: async (ch) => gc.narrowApi(c.api, ch, sourceStart), submit: c.submit, outcome: c.outcome, ram: track,
    interrupt: c.interrupt, free: c.free, sleep: c.sleep,
  }, chunks, { guardPct: guard, pad, pollMs: c.pollMs ?? 10_000, win })
  const done: gc.GraphChunk[] = []; let attempts = 0
  const step = async (chunks: gc.GraphChunk[]) => { const out = await run(chunks); attempts += out.attempts.length; for (const a of out.attempts) if (a.state === 'split') c.say(`chunking: ${a.error}`); if (!out.ok) throw new CoreError(/RAM guard/.test(out.attempts.at(-1)?.error ?? '') ? 507 : 500, out.attempts.at(-1)?.error ?? 'a chunk failed'); done.push(...out.final) }
  let from = win.first

  // 1. the probe: only a graph that is big enough to matter and has no record yet
  if (!rec && win.count > NO_PROBE_UNDER) {
    if (!ramBytes) { c.say('chunking: the container RAM cannot be read here, so the graph is not probed; running it in default chunks without a RAM guard') }
    else {
      const probe = gc.planGraphChunks({ first: win.first, last: win.first + PROBE_FRAMES - 1, startNumber: win.startNumber }, PROBE_FRAMES, pad).map((p) => ({ ...p, readLast: Math.min(win.last, p.last + pad) }))
      c.say(`chunking: new graph, probing frames ${win.first}-${win.first + PROBE_FRAMES - 1} with the container RAM sampled (${(ramBytes / GIB).toFixed(1)} GiB limit)`)
      sample.peak = 0; await step(probe)
      const readFrames = probe[0].readLast - probe[0].readFirst + 1
      const perFrame = Math.max(0.01, (sample.peak - sample.idle) / GIB / readFrames)
      rec = { per_frame_gib: Math.round(perFrame * 1000) / 1000, ram_gib: Math.round(ramBytes / GIB * 10) / 10, chunk: 0, frames: readFrames, measured_at: new Date().toISOString() }
      from = probe[0].last + 1
      c.say(`chunking: probe: ${perFrame.toFixed(2)} GiB per frame (peak ${((sample.peak - sample.idle) / GIB).toFixed(1)} GiB over ${readFrames} frames, idle ${(sample.idle / GIB).toFixed(1)} GiB)`)
    }
  } else if (rec) c.say(`chunking: remembered ${rec.per_frame_gib.toFixed(2)} GiB per frame for this graph (measured ${rec.measured_at.slice(0, 10)}): no probe`)

  // 2. the plan
  const rest = { first: from, last: win.last, startNumber: win.startNumber + (from - win.first) }
  let size = maxChunk
  if (rec && ramBytes) {
    const perFrame = rec.per_frame_gib * GIB
    const whole = perFrame * (win.last - from + 1)
    if (whole <= ramBytes * target / 100) { size = win.last - from + 1; c.say(`chunking: ${win.last - from + 1} frames need about ${(whole / GIB).toFixed(1)} GiB, under ${target}% of ${(ramBytes / GIB).toFixed(1)} GiB: running them whole`) }
    else { size = gc.chunkFor(ramBytes, perFrame, 0, pad, target, maxChunk); c.say(`chunking: ${win.last - from + 1} frames need about ${(whole / GIB).toFixed(1)} GiB, over ${target}% of ${(ramBytes / GIB).toFixed(1)} GiB: chunks of ${size} frames`) }
    rec.chunk = size; await remember(c.path, rec)
  }
  if (from <= win.last) {
    // the remainder: the first window keeps reading the probe's last frames as context only when there is a probe before it
    const chunks = gc.planGraphChunks(rest, size, pad).map((ch) => ({ ...ch, readFirst: Math.max(win.first, ch.first - pad) }))
    c.say(`chunking: ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} for frames ${rest.first}-${rest.last}`)
    await step(chunks)
  }
  // a guard split means the estimate was too low: remember a bigger one so the next run starts smaller
  if (rec && ramBytes && attempts > Math.ceil((win.last - win.first + 1) / size) + (done.length ? 0 : 1) && done.length > 0) { rec.per_frame_gib = Math.round(rec.per_frame_gib * 1.5 * 1000) / 1000; await remember(c.path, rec) }
  // 3. the merge check
  gc.checkCoverage(done, win.first, win.last)
  const text = `frames ${win.first}-${win.last} in ${done.length} chunk${done.length === 1 ? '' : 's'}, no gap, no repeat`
  c.say(`chunking: ${text}`)
  return { mode: done.length === 1 ? 'whole' : 'chunked', chunks: done.length, attempts, text }
}
