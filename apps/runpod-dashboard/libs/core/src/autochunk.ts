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
  /** run only these frames of the graph's window (source frame numbers, inclusive; ADR-056, "Ranges and splitting one element across pods"): numbering stays absolute, the pad reads past the range edges */ range?: gc.FrameRange
  ui: unknown
  api: Record<string, unknown>
  submit: (api: Record<string, unknown>) => Promise<string>
  /** one look at a prompt: null while running; 'done'; or the error. Accumulating the outputs is the caller's. */
  outcome: (promptId: string) => Promise<'done' | { error: string } | null>
  ram: () => Promise<RamNow | null>
  interrupt: () => Promise<void>; free: () => Promise<void>; sleep: (ms: number) => Promise<void>
  /** a line for the task's events and the History */ say: (text: string) => void
  guardPct?: number; targetPct?: number; pad?: number; maxChunk?: number; pollMs?: number
  /** called after every change of the plan or of a chunk, with a copy the caller may keep (the re-attach record) */ checkpoint?: (cp: Checkpoint) => void | Promise<void>
  /** an adopted run (another process started it and is gone): continue this plan instead of probing and planning */ resume?: Checkpoint
  /** a prompt submitted before the restart is about to be waited for: register it for `outcome` */ adopt?: (promptId: string) => void
}

/** One chunk of a persisted run. `running` has the prompt id the pod was given; `split` has the halves that replaced it. */
export interface CpState { state: 'running' | 'done' | 'split' | 'failed'; prompt_id?: string; halves?: gc.GraphChunk[]; error?: string }
/**
 * What a chunked run needs to be continued by another process after a restart (ADR-056, "Re-attach after a restart"): the plan and what each chunk has done. Small, no secrets;
 * the API graph is not kept (it is converted again from the graph on the pod) and neither are the files (the next outcome call finds them in ComfyUI's history).
 * `phase` is `probe` while the first ten frames run (the RAM per frame is not known yet), `main` after.
 */
export interface Checkpoint {
  version: 1; phase: 'probe' | 'main'
  win: { first: number; last: number; startNumber: number; sourceStart: number }
  /** the frames this run owns when it was limited to a range of the window (absent: the whole window) */ range?: gc.FrameRange
  pad: number; guardPct: number; targetPct: number; maxChunk: number; size: number
  plan: gc.GraphChunk[]; states: Record<string, CpState>
}
export const resumeStateOf = (cp: Checkpoint): gc.ResumeState => {
  const rs: gc.ResumeState = { done: new Set(), running: new Map(), split: new Map() }
  for (const [k, v] of Object.entries(cp.states)) { if (v.state === 'done') rs.done.add(k); else if (v.state === 'running' && v.prompt_id) rs.running.set(k, v.prompt_id); else if (v.state === 'split' && v.halves?.length) rs.split.set(k, v.halves) }
  return rs
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
  } catch (e) {
    if (c.range || c.resume?.range) throw new CoreError(422, `a frame range needs a graph with one OCIORead window and one OCIOWrite sequence: ${(e as Error).message}`)   // a range cannot be honoured by a run that is not chunked: refuse, never run the whole graph instead
    return wholeGuarded(c, (e as Error).message)
  }
  const range = c.resume?.range ?? c.range ? gc.checkRange(win, (c.resume?.range ?? c.range)!) : undefined
  const lo = range?.first ?? win.first, hi = range?.last ?? win.last, count = hi - lo + 1
  const numberOf = (f: number) => win.startNumber + (f - win.first)   // absolute: the file number of frame f is the same whichever run writes it
  const sourceStart = Number(apiNodes(c.api, 'OCIOWrite')[0].inputs.source_start) || win.sourceStart
  const first = await c.ram()
  const ramBytes = first?.limit ?? 0
  let rec = await memoryOf(c.path)
  const sample = { idle: first?.used ?? 0, peak: 0 }
  const track = async (): Promise<number | null> => { const r = await c.ram(); if (r) sample.peak = Math.max(sample.peak, r.used); return r ? r.pct : null }
  // what a process that adopts this run after a restart needs (ADR-056, "Re-attach after a restart"): the plan and each chunk's state, handed to c.checkpoint after every change
  const cp: Checkpoint = c.resume ? JSON.parse(JSON.stringify(c.resume)) : { version: 1, phase: 'probe', win: { first: win.first, last: win.last, startNumber: win.startNumber, sourceStart }, pad, guardPct: guard, targetPct: target, maxChunk, size: 0, plan: [], states: {}, ...(range ? { range } : {}) }
  const emit = async () => { if (c.checkpoint) { try { await c.checkpoint(JSON.parse(JSON.stringify(cp))) } catch { /* the record is best effort: it never stops a run */ } } }
  const onEvent = (e: gc.ChunkEvent) => {
    const k = gc.chunkKey(e.chunk)
    cp.states[k] = e.type === 'submit' ? { state: 'running', prompt_id: e.promptId } : e.type === 'done' ? { state: 'done', prompt_id: e.promptId } : e.type === 'split' ? { state: 'split', halves: e.halves } : { state: 'failed', prompt_id: e.promptId, error: e.error }
    void emit()
  }
  const run = (chunks: gc.GraphChunk[], resume?: gc.ResumeState) => gc.runChunks({
    build: async (ch) => gc.narrowApi(c.api, ch, sourceStart), submit: c.submit, outcome: c.outcome, ram: track,
    interrupt: c.interrupt, free: c.free, sleep: c.sleep, onEvent, adopt: c.adopt,
  }, chunks, { guardPct: guard, pad, pollMs: c.pollMs ?? 10_000, win, resume })
  const done: gc.GraphChunk[] = []; let attempts = 0
  const step = async (chunks: gc.GraphChunk[], resume?: gc.ResumeState) => { const out = await run(chunks, resume); attempts += out.attempts.length; for (const a of out.attempts) if (a.state === 'split') c.say(`chunking: ${a.error}`); if (!out.ok) throw new CoreError(/RAM guard/.test(out.attempts.at(-1)?.error ?? '') ? 507 : 500, out.attempts.at(-1)?.error ?? 'a chunk failed'); done.push(...out.final) }
  let from = lo, probePlan: gc.GraphChunk[] = [], resumedProbe = false
  const finish = async (): Promise<RunSummary> => {
    gc.checkCoverage(done, lo, hi)
    const text = `frames ${lo}-${hi}${range ? ` (range of ${win.first}-${win.last})` : ''} in ${done.length} chunk${done.length === 1 ? '' : 's'}, no gap, no repeat`
    c.say(`chunking: ${text}`)
    return { mode: done.length === 1 ? 'whole' : 'chunked', chunks: done.length, attempts, text }
  }

  // 0. an adopted run: another process started it and is gone. Its prompts are still on the pod: finished ones are counted, running ones are waited for, gone ones are submitted again (once).
  if (c.resume) {
    const rs = resumeStateOf(cp)
    c.say(`chunking: re-attached after a restart (${cp.phase} phase): ${rs.done.size} chunk${rs.done.size === 1 ? '' : 's'} done, ${rs.running.size} on the pod, ${cp.plan.length} in the plan`)
    for (const v of Object.values(cp.states)) if (v.state === 'done' && v.prompt_id) { c.adopt?.(v.prompt_id); try { await c.outcome(v.prompt_id) } catch { /* only so its files reach the History */ } }
    for (const [k, id] of [...rs.running]) {
      c.adopt?.(id)
      const out = await c.outcome(id)
      if (out === 'done') { rs.running.delete(k); rs.done.add(k); cp.states[k] = { state: 'done', prompt_id: id }; c.say(`chunking: chunk ${k}: prompt ${id} finished while nobody was watching`) }
      else if (out) { rs.running.delete(k); delete cp.states[k]; c.say(`chunking: chunk ${k}: prompt ${id} is gone or failed (${out.error.slice(0, 120)}): submitted again, once`) }
    }
    await emit()
    if (cp.phase === 'main') { await step(cp.plan, rs); return finish() }
    probePlan = cp.plan; await step(probePlan, rs)   // the probe chunk: its frames are real, so it is finished (or waited for) like any other
    from = probePlan[0].last + 1; resumedProbe = true; rec = null
    c.say('chunking: the probe was cut short by the restart, so its RAM figure is lost; the rest is planned in smaller chunks with the guard on')
  // 1. the probe: only a graph that is big enough to matter and has no record yet
  } else if (!rec && count > NO_PROBE_UNDER) {
    if (!ramBytes) { c.say('chunking: the container RAM cannot be read here, so the graph is not probed; running it in default chunks without a RAM guard') }
    else {
      const probe = gc.planGraphChunks({ first: lo, last: lo + PROBE_FRAMES - 1, startNumber: numberOf(lo) }, PROBE_FRAMES, pad).map((p) => ({ ...p, readFirst: Math.max(win.first, p.first - pad), readLast: Math.min(win.last, p.last + pad) }))
      c.say(`chunking: new graph, probing frames ${lo}-${lo + PROBE_FRAMES - 1} with the container RAM sampled (${(ramBytes / GIB).toFixed(1)} GiB limit)`)
      probePlan = probe; cp.phase = 'probe'; cp.plan = probe; await emit()
      sample.peak = 0; await step(probe)
      const readFrames = probe[0].readLast - probe[0].readFirst + 1
      const perFrame = Math.max(0.01, (sample.peak - sample.idle) / GIB / readFrames)
      rec = { per_frame_gib: Math.round(perFrame * 1000) / 1000, ram_gib: Math.round(ramBytes / GIB * 10) / 10, chunk: 0, frames: readFrames, measured_at: new Date().toISOString() }
      from = probe[0].last + 1
      c.say(`chunking: probe: ${perFrame.toFixed(2)} GiB per frame (peak ${((sample.peak - sample.idle) / GIB).toFixed(1)} GiB over ${readFrames} frames, idle ${(sample.idle / GIB).toFixed(1)} GiB)`)
    }
  } else if (rec) c.say(`chunking: remembered ${rec.per_frame_gib.toFixed(2)} GiB per frame for this graph (measured ${rec.measured_at.slice(0, 10)}): no probe`)

  // 2. the plan
  const rest = { first: from, last: hi, startNumber: numberOf(from) }
  let size = resumedProbe ? Math.min(maxChunk, 20) : maxChunk
  if (rec && ramBytes) {
    const perFrame = rec.per_frame_gib * GIB
    const whole = perFrame * (hi - from + 1)
    if (whole <= ramBytes * target / 100) { size = hi - from + 1; c.say(`chunking: ${hi - from + 1} frames need about ${(whole / GIB).toFixed(1)} GiB, under ${target}% of ${(ramBytes / GIB).toFixed(1)} GiB: running them whole`) }
    else { size = gc.chunkFor(ramBytes, perFrame, 0, pad, target, maxChunk); c.say(`chunking: ${hi - from + 1} frames need about ${(whole / GIB).toFixed(1)} GiB, over ${target}% of ${(ramBytes / GIB).toFixed(1)} GiB: chunks of ${size} frames`) }
    rec.chunk = size; await remember(c.path, rec)
  }
  if (from <= hi) {
    // the remainder: the first window keeps reading the probe's last frames as context only when there is a probe before it
    const chunks = gc.planGraphChunks(rest, size, pad).map((ch) => ({ ...ch, readFirst: Math.max(win.first, ch.first - pad), readLast: Math.min(win.last, ch.last + pad) }))   // the pad is clamped by the graph's whole window, so a range edge reads its neighbour's frames as a single run would
    c.say(`chunking: ${chunks.length} chunk${chunks.length === 1 ? '' : 's'} for frames ${rest.first}-${rest.last}`)
    cp.phase = 'main'; cp.size = size; cp.plan = [...probePlan, ...chunks]; await emit()
    await step(chunks)
  }
  // a guard split means the estimate was too low: remember a bigger one so the next run starts smaller
  if (rec && ramBytes && attempts > Math.ceil(count / size) + (done.length ? 0 : 1) && done.length > 0) { rec.per_frame_gib = Math.round(rec.per_frame_gib * 1.5 * 1000) / 1000; await remember(c.path, rec) }
  // 3. the merge check
  return finish()
}
