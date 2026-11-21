/**
 * Memory-safe graph runs (ADR-056, sections 2.2 and 2.3): a base_v008 graph is run as consecutive frame windows instead of whole.
 *
 * The graphs read a video window with OCIORead (widgets: start_frame, end_frame; 1-based, inclusive), scale, run SeedVR2, and write a DPX
 * sequence with OCIOWrite (widgets: first_frame, last_frame = which batch frames to write, start_number = the number of the first file,
 * source_start = the logical number of the batch's first frame). Narrowing those two nodes gives the same frames with the same numbers.
 *
 *  - `planGraphChunks`   the windows. Each chunk OWNS a frame range; it READS `pad` frames more on each side (temporal context for SeedVR2) and
 *                        OCIOWrite drops them, so a seam is computed from real neighbours and every frame is written exactly once.
 *  - `narrowGraph`       a narrowed COPY of a UI graph (the original on the volume is never edited); `narrowApi` the same for an API graph.
 *  - `checkCoverage`, `checkWritten`   the merge check: no gap, no repeat.
 *  - `runChunks`         the live RAM guard: interrupt at the guard, resubmit the chunk as two smaller ones.
 * Pure over injected deps: no pod is touched here.
 */
import { CoreError } from './errors.js'

export const DEFAULT_CHUNK_FRAMES = 50
export const DEFAULT_PAD = 8
export const MIN_CHUNK_FRAMES = 5
export const TARGET_RAM_PCT = 60
export const GUARD_PCT = 85

export interface GraphWindow { readId: string; writeId: string; source: string; first: number; last: number; count: number; startNumber: number; sourceStart: number; filename: string; folder: string }
export interface GraphChunk { n: number; /** frames this chunk writes (source frame numbers) */ first: number; last: number; /** frames it reads */ readFirst: number; readLast: number; /** number of its first written file */ startNumber: number }

type UiNode = { id: number | string; type: string; widgets_values?: unknown[] }
type UiGraph = { nodes: UiNode[] }
const isUi = (g: unknown): g is UiGraph => !!g && typeof g === 'object' && Array.isArray((g as UiGraph).nodes)
const READ = { start: 5, end: 6 }
const WRITE = { first: 9, last: 10, startNumber: 11, sourceStart: 12, folder: 15, filename: 16 }

/** The frame window and the numbering a graph has now. Throws when it is not the one-read, one-write shape the planner understands. */
export function describeGraph(ui: unknown): GraphWindow {
  if (!isUi(ui)) throw new CoreError(422, 'Not a UI graph (no nodes): chunking edits the Workflows panel format.')
  const reads = ui.nodes.filter((n) => n.type === 'OCIORead'), writes = ui.nodes.filter((n) => n.type === 'OCIOWrite')
  if (reads.length !== 1 || writes.length !== 1) throw new CoreError(422, `Chunking needs exactly one OCIORead and one OCIOWrite; this graph has ${reads.length} and ${writes.length}.`)
  const r = reads[0].widgets_values ?? [], w = writes[0].widgets_values ?? []
  if (r[1] !== 'video') throw new CoreError(422, `OCIORead frame_mode is ${JSON.stringify(r[1])}: only video windows are chunked.`)
  const first = Number(r[READ.start]), last = Number(r[READ.end])
  if (!(first >= 1) || !(last >= first)) throw new CoreError(422, `OCIORead has no frame window (start ${r[READ.start]}, end ${r[READ.end]}): a whole-clip read has no frame count to split.`)
  if (w[3] !== 'sequence') throw new CoreError(422, `OCIOWrite container is ${JSON.stringify(w[3])}: only a sequence is chunked.`)
  if (w[8] !== false) throw new CoreError(422, 'OCIOWrite auto_range is on: the write range would follow the read. Set the four numbers explicitly.')
  return { readId: String(reads[0].id), writeId: String(writes[0].id), source: String(r[0]), first, last, count: last - first + 1, startNumber: Number(w[WRITE.startNumber]), sourceStart: Number(w[WRITE.sourceStart]) || 1, folder: String(w[WRITE.folder]), filename: String(w[WRITE.filename]) }
}

/** Windows over the graph's frames. `chunk` frames per window, `pad` read either side (not past the graph's own window). */
export function planGraphChunks(win: Pick<GraphWindow, 'first' | 'last' | 'startNumber'>, chunk = DEFAULT_CHUNK_FRAMES, pad = DEFAULT_PAD): GraphChunk[] {
  if (!Number.isInteger(chunk) || chunk < 1) throw new CoreError(400, 'chunk must be a whole number of frames, 1 or more')
  if (!Number.isInteger(pad) || pad < 0) throw new CoreError(400, 'pad must be a whole number of frames, 0 or more')
  const out: GraphChunk[] = []
  for (let a = win.first; a <= win.last; a += chunk) {
    const b = Math.min(a + chunk - 1, win.last)
    out.push({ n: out.length + 1, first: a, last: b, readFirst: Math.max(win.first, a - pad), readLast: Math.min(win.last, b + pad), startNumber: win.startNumber + (a - win.first) })
  }
  return out
}

/** Which of the OCIOWrite numbers a chunk needs: the batch starts at readFirst, so the frames to keep are at offset (first - readFirst). */
const writeNumbers = (c: GraphChunk, sourceStart: number) => ({ first: sourceStart + (c.first - c.readFirst), last: sourceStart + (c.last - c.readFirst), startNumber: c.startNumber })

/** A narrowed COPY of a UI graph. */
export function narrowGraph(ui: unknown, c: GraphChunk): UiGraph {
  const win = describeGraph(ui)
  const copy: UiGraph = JSON.parse(JSON.stringify(ui))
  const r = copy.nodes.find((n) => String(n.id) === win.readId)!.widgets_values!, w = copy.nodes.find((n) => String(n.id) === win.writeId)!.widgets_values!
  r[READ.start] = c.readFirst; r[READ.end] = c.readLast
  const x = writeNumbers(c, win.sourceStart)
  w[WRITE.first] = x.first; w[WRITE.last] = x.last; w[WRITE.startNumber] = x.startNumber
  return copy
}
/** The same for an API graph (inputs by name), in place on a copy. */
export function narrowApi(api: Record<string, unknown>, c: GraphChunk, sourceStart = 1): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(api)) as Record<string, { class_type?: string; inputs: Record<string, unknown> }>
  const reads = Object.values(copy).filter((n) => n?.class_type === 'OCIORead'), writes = Object.values(copy).filter((n) => n?.class_type === 'OCIOWrite')
  if (reads.length !== 1 || writes.length !== 1) throw new CoreError(422, `Chunking needs exactly one OCIORead and one OCIOWrite; this API graph has ${reads.length} and ${writes.length}.`)
  reads[0].inputs.start_frame = c.readFirst; reads[0].inputs.end_frame = c.readLast
  const x = writeNumbers(c, sourceStart)
  Object.assign(writes[0].inputs, { first_frame: x.first, last_frame: x.last, start_number: x.startNumber })
  return copy
}
/** `<graph>.json` -> `<graph>__chunk03.json`, next to it. */
export const chunkPath = (path: string, n: number) => path.replace(/\.json$/i, '') + `__chunk${String(n).padStart(2, '0')}.json`

// ----- the merge check -----

/** The chunks' written ranges make first..last with no gap and no repeat, in order. Throws naming the first problem. */
export function checkCoverage(chunks: Pick<GraphChunk, 'n' | 'first' | 'last'>[], first: number, last: number): void {
  const s = [...chunks].sort((a, b) => a.first - b.first)
  let next = first
  for (const c of s) {
    if (c.last < c.first) throw new CoreError(422, `chunk ${c.n} is empty (${c.first}-${c.last})`)
    if (c.first > next) throw new CoreError(422, `gap: frames ${next}-${c.first - 1} are in no chunk (before chunk ${c.n})`)
    if (c.first < next) throw new CoreError(422, `repeat: frames ${c.first}-${Math.min(c.last, next - 1)} are in chunk ${c.n} and an earlier one`)
    next = c.last + 1
  }
  if (next <= last) throw new CoreError(422, `gap: frames ${next}-${last} are in no chunk (after the last)`)
  if (next > last + 1) throw new CoreError(422, `chunks run past the last frame (${next - 1} > ${last})`)
}
/** The file numbers found on disk are exactly startNumber .. startNumber+count-1. `names` are file names `<stem>.<number>.<ext>`. */
export function checkWritten(names: string[], startNumber: number, count: number): void {
  const nums = names.map((f) => /\.(\d+)\.[a-z0-9]+$/i.exec(f)?.[1]).filter((x): x is string => !!x).map(Number).sort((a, b) => a - b)
  const seen = new Set<number>()
  for (const n of nums) { if (seen.has(n)) throw new CoreError(422, `repeat: file number ${n} appears twice`); seen.add(n) }
  const miss: number[] = [], extra: number[] = []
  for (let i = 0; i < count; i++) if (!seen.has(startNumber + i)) miss.push(startNumber + i)
  for (const n of nums) if (n < startNumber || n >= startNumber + count) extra.push(n)
  if (miss.length || extra.length) throw new CoreError(422, `frames do not match: ${nums.length} files for ${count} expected${miss.length ? `; missing ${miss.slice(0, 8).join(', ')}${miss.length > 8 ? ` (+${miss.length - 8})` : ''}` : ''}${extra.length ? `; unexpected ${extra.slice(0, 8).join(', ')}` : ''}`)
}

// ----- RAM: the estimate before, the guard during -----

/** Peak container RAM for a chunk that reads `frames` frames: base + perFrame x frames (the probe measures both). */
export const estimatePeak = (frames: number, perFrameBytes: number, baseBytes = 0) => baseBytes + perFrameBytes * frames
/** Owned frames per chunk so that the peak stays under `targetPct` of the container's RAM, after the pad both sides. At least MIN_CHUNK_FRAMES, never more than `max`. */
export function chunkFor(ramBytes: number, perFrameBytes: number, baseBytes = 0, pad = DEFAULT_PAD, targetPct = TARGET_RAM_PCT, max = Infinity): number {
  if (!(ramBytes > 0) || !(perFrameBytes > 0)) throw new CoreError(400, 'ramBytes and perFrameBytes must be positive')
  const read = Math.floor((ramBytes * targetPct / 100 - baseBytes) / perFrameBytes)
  return Math.max(MIN_CHUNK_FRAMES, Math.min(max, read - 2 * pad))
}

/** The key of a chunk in a persisted run: the frames it writes (a chunk and its halves never share one). */
export const chunkKey = (c: Pick<GraphChunk, 'first' | 'last'>): string => `${c.first}-${c.last}`
/** What happened to one chunk, for the re-attach record (ADR-056, "Re-attach after a restart"). */
export interface ChunkEvent { type: 'submit' | 'done' | 'split' | 'failed'; chunk: GraphChunk; promptId?: string; halves?: GraphChunk[]; error?: string }
/** What a run adopted after a restart already knows: chunks that finished, prompts still on the pod (key -> prompt id), and chunks that were split (key -> their halves). */
export interface ResumeState { done: Set<string>; running: Map<string, string>; split: Map<string, GraphChunk[]> }

export interface RunDeps {
  /** The API graph for a chunk (convert the narrowed UI copy, or narrowApi). */ build: (c: GraphChunk) => Promise<Record<string, unknown>>
  submit: (api: Record<string, unknown>) => Promise<string>
  /** null while running; an error text when it failed; 'done' when finished. */ outcome: (promptId: string) => Promise<'done' | { error: string } | null>
  /** Container RAM percent, null when it cannot be read (the guard is then off). */ ram: () => Promise<number | null>
  interrupt: () => Promise<void>; free: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  /** told at each step of a chunk (the re-attach record keeps them) */ onEvent?: (e: ChunkEvent) => void
  /** a prompt that was submitted before a restart is about to be waited for (register it for the outcome poll) */ adopt?: (promptId: string) => void
}
export interface ChunkRun { chunk: GraphChunk; state: 'done' | 'failed' | 'split'; peakPct?: number; error?: string; promptId?: string; seconds?: number }
/**
 * Run chunks in order. A chunk whose container RAM reaches `guardPct` is interrupted (before the kernel kills the container), ComfyUI is told to
 * free memory, and the chunk's frames are resubmitted as two halves (never below MIN_CHUNK_FRAMES: then it fails with 507). A failed chunk stops the run.
 * The returned list holds every attempt, including the 'split' ones; `final` are the chunks that completed, which checkCoverage accepts.
 */
export async function runChunks(deps: RunDeps, chunks: GraphChunk[], o: { guardPct?: number; pollMs?: number; pad?: number; win: Pick<GraphWindow, 'first' | 'last'>; /** an adopted run: skip what is done, wait for what is on the pod */ resume?: ResumeState }): Promise<{ attempts: ChunkRun[]; final: GraphChunk[]; ok: boolean }> {
  const guard = o.guardPct ?? GUARD_PCT, poll = o.pollMs ?? 2000, pad = o.pad ?? DEFAULT_PAD
  const queue = [...chunks], attempts: ChunkRun[] = [], final: GraphChunk[] = []
  while (queue.length) {
    const c = queue.shift()!
    const key = chunkKey(c), rs = o.resume
    if (rs?.done.has(key)) { attempts.push({ chunk: c, state: 'done' }); final.push(c); continue }   // finished before the restart: never run again
    const kids = rs?.split.get(key)
    if (kids?.length) { attempts.push({ chunk: c, state: 'split', error: 'split before the restart' }); queue.unshift(...kids); continue }
    const t0 = Date.now(), run: ChunkRun = { chunk: c, state: 'failed' }
    attempts.push(run)
    try {
      const known = rs?.running.get(key)
      if (known) { rs!.running.delete(key); deps.adopt?.(known); run.promptId = known }   // still on the pod: wait for it, do not submit it again
      else { run.promptId = await deps.submit(await deps.build(c)); deps.onEvent?.({ type: 'submit', chunk: c, promptId: run.promptId }) }
      let peak = 0
      for (;;) {
        const out = await deps.outcome(run.promptId)
        if (out === 'done') { run.state = 'done'; deps.onEvent?.({ type: 'done', chunk: c, promptId: run.promptId }); break }
        if (out) throw new CoreError(500, out.error)
        const pct = await deps.ram()
        if (pct != null) {
          peak = Math.max(peak, pct); run.peakPct = peak
          if (pct >= guard) {
            await deps.interrupt(); await deps.free()
            const size = c.last - c.first + 1
            if (size < 2 * MIN_CHUNK_FRAMES) throw new CoreError(507, `RAM guard: ${pct}% at the guard (${guard}%) on chunk ${c.n} (${c.first}-${c.last}), already the smallest chunk: more RAM is needed (more GPUs on the pod, cards.escalateRam).`)
            const mid = c.first + Math.floor(size / 2) - 1
            const halves = planGraphChunks({ first: c.first, last: c.last, startNumber: c.startNumber }, mid - c.first + 1, 0).map((h, i) => ({ ...h, n: c.n * 10 + i + 1, readFirst: Math.max(o.win.first, h.first - pad), readLast: Math.min(o.win.last, h.last + pad) }))
            run.state = 'split'; run.error = `RAM ${pct}% at the guard: resubmitted as ${halves.map((h) => `${h.first}-${h.last}`).join(' and ')}`
            queue.unshift(...halves); deps.onEvent?.({ type: 'split', chunk: c, promptId: run.promptId, halves })
            break
          }
        }
        await deps.sleep(poll)
      }
      run.seconds = Math.round((Date.now() - t0) / 100) / 10
      if (run.state === 'done') final.push(c)
    } catch (e) {
      run.state = 'failed'; run.error = (e as Error).message; deps.onEvent?.({ type: 'failed', chunk: c, promptId: run.promptId, error: run.error })
      return { attempts, final, ok: false }
    }
  }
  return { attempts, final, ok: true }
}
