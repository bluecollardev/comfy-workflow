/**
 * The card ladder and the out-of-memory rule (Lucas, 2026-11-21: "when a graph fails because of out of memory the queue must select a bigger card automatically and retry on its own").
 *
 * One place for both: which card is "bigger" (the ladder, 32 -> 48 -> 80 -> 96 GB, never B200, B300 or the H200s: Lucas excluded them), and how a failure is told apart from the pod's own signals:
 *  - `oom`       the container was killed for memory (RunPod's system log says "triggered memory limits (OOM)" / "exit code 137"), or the error says CUDA / host memory ran out;
 *  - `restart`   ComfyUI went away and came back with the graph lost, or the pod restarted, but nothing says why (retried like a transient failure; one more such event on the same card counts as memory);
 *  - `transient` a 5xx, a timeout, a network error: asking again can help;
 *  - `graph`     a validation error, a missing model, a node error: the graph is wrong, a bigger card does not help.
 * Pure functions: no pod is touched here (the evidence is passed in), so it is all unit tested.
 */
import { GPUS } from './gpus.js'

/** Cards that are never chosen by an escalation, whatever their size (Lucas, 2026-11-20: "B200, B300, H200 jesus exclude these"). */
export const EXCLUDED = new Set(['b200', 'b300', 'h200', 'h200nvl'])
/** The tiers, smallest first; inside a tier the order is the order tried (the cheaper or more often in stock first). A tier is skipped when the task has already used a card of that size or more. */
export const LADDER: { gb: number; cards: string[] }[] = [
  { gb: 32, cards: ['rtxpro4500', 'rtxpro4500se', 'rtx5090'] },
  { gb: 48, cards: ['rtxpro5000', 'l40s', 'rtx6000ada', 'a6000', 'a40', 'l40'] },
  { gb: 80, cards: ['a100pcie', 'a100', 'h100pcie', 'h100'] },
  { gb: 96, cards: ['rtxpro6000', 'rtxpro6000wk', 'rtxpro6000q'] },
]
export const MAX_ESCALATIONS = 3

const knownKey = (k: string): string | null => {
  if (k in GPUS) return k
  for (const [key, g] of Object.entries(GPUS)) if (k === g.id || k === g.name) return key
  return null
}
/** GB of video memory of a card (a key, RunPod's id or its short name); 0 when unknown. */
export const gbOf = (card: string | null | undefined): number => { const k = card ? knownKey(card) : null; return k ? GPUS[k].vram : 0 }
export const nameOf = (card: string | null | undefined): string => { const k = card ? knownKey(card) : null; return k ? `${GPUS[k].name} (${GPUS[k].vram} GB)` : card || 'the pool card' }

/**
 * The cards to ask for the next try, in the order to ask them: every ladder card BIGGER than the one that ran out of memory, tier by tier (the whole next tier first, then the one above it), never an excluded card.
 * `current` may be a key, RunPod's id or its name. A card the task already tried in a list passed as `tried` is not repeated. Empty when nothing bigger is left (the task then fails with its error).
 */
export function escalate(current: string | null | undefined, tried: string[] = []): string[] {
  const have = gbOf(current), skip = new Set(tried.map((t) => knownKey(t)).filter(Boolean) as string[])
  const out: string[] = []
  for (const tier of LADDER) {
    if (tier.gb <= have) continue
    for (const c of tier.cards) if (c in GPUS && !EXCLUDED.has(c) && !skip.has(c) && !out.includes(c)) out.push(c)
  }
  return out
}

export type FailureKind = 'oom' | 'restart' | 'transient' | 'graph'
export interface Evidence {
  /** the graph's error text */ message?: string
  /** lines of the pod's own logs (RunPod's system log and the container's) written since the graph started */ podLog?: string[]
  /** the pod's uptime went backwards or its status passed through starting while the graph ran */ uptimeReset?: boolean
  /** the container's cgroup counters, when they could be read: memory.events oom_kill / oom */ oomKills?: number
}
const OOM_TEXT = /out of memory|OutOfMemory|CUDA error: out of memory|\bOOM\b|RAM guard|cannot allocate memory|std::bad_alloc|MemoryError/i
const OOM_POD = /triggered memory limits|\(OOM\)|exit code 137|oom[-_ ]?kill|killed process|out of memory/i
const RESTART_TEXT = /ComfyUI restarted|prompt .* is gone|no longer (known|running)|the pod may have restarted/i
const TRANSIENT_TEXT = /\b(5\d\d)\b|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up|network|timed? ?out|aborted due to timeout|not running|stopped|unreachable|Page\.wait_for_function|Target (page|closed)/i
const GRAPH_TEXT = /validation|Value not in list|Required input|rejected the (prompt|graph)|not in \[|is not a UI graph|locked shot|Missing model|node .* (failed|raised)/i
/** What kind of failure is this? Order matters: memory evidence beats everything, a graph error beats a transient look-alike. */
export function classify(e: Evidence): { kind: FailureKind; why: string } {
  const msg = e.message ?? ''
  if ((e.oomKills ?? 0) > 0) return { kind: 'oom', why: `the container's memory.events counted ${e.oomKills} OOM kill${e.oomKills === 1 ? '' : 's'}` }
  const podHit = (e.podLog ?? []).find((l) => OOM_POD.test(l))
  if (podHit) return { kind: 'oom', why: `the pod's log says: ${podHit.replace(/^\S+\s+/, '').slice(0, 140)}` }
  if (OOM_TEXT.test(msg)) return { kind: 'oom', why: 'the error says memory ran out' }
  if (GRAPH_TEXT.test(msg) && !/\b5\d\d\b/.test(msg)) return { kind: 'graph', why: 'the graph or its inputs are wrong' }
  if (RESTART_TEXT.test(msg) || e.uptimeReset) return { kind: 'restart', why: e.uptimeReset ? 'the pod restarted while the graph ran' : 'ComfyUI restarted and lost the graph' }
  if (TRANSIENT_TEXT.test(msg)) return { kind: 'transient', why: 'the pod or the network did not answer' }
  return { kind: 'graph', why: 'not a pod problem' }
}

// ----- RAM, not VRAM (ADR-056 section 2.4) -----
/**
 * Container RAM comes with the GPU count and the host, not the VRAM: 1x RTX PRO 4500 = 57.7 GiB, 2x = 116.4, 4x = 232.8; 1x RTX PRO 6000 = 87.5; 1x RTX PRO 6000 WK = 262.6 (observed, EU-RO-1, 2026-11-21).
 * Per GPU. A card not listed is not chosen by the RAM escalation.
 */
export const RAM_GIB_PER_GPU: Record<string, number> = { rtxpro4500: 58, rtxpro6000: 87.5, rtxpro6000wk: 262.6 }
export const GPU_COUNTS = [1, 2, 4]
export interface RamStep { kind: 'chunk' | 'gpus' | 'card'; chunk?: number; card?: string; gpuCount?: number; why: string }
/**
 * The next step after a chunk that did not fit its pod (the guard tripped at its smallest, or the container was killed), in ADR-056's order:
 * a smaller chunk while it is above twice `minChunk`, then more GPUs of the same card (1 -> 2 -> 4: the extra GPUs idle, the pod pays for the RAM), then a card with more RAM per GPU.
 * Null when nothing is left (the task fails with its error). Never B200, B300 or the H200s.
 */
export function escalateRam(cur: { card: string; gpuCount: number; chunk: number }, minChunk = 5): RamStep | null {
  const key = knownKey(cur.card) ?? cur.card
  if (cur.chunk > minChunk * 2) { const chunk = Math.max(minChunk, Math.floor(cur.chunk / 2)); return { kind: 'chunk', chunk, why: `chunks of ${cur.chunk} frames did not fit: ${chunk}` } }
  const more = GPU_COUNTS.find((n) => n > cur.gpuCount)
  if (more && key in RAM_GIB_PER_GPU) return { kind: 'gpus', card: key, gpuCount: more, why: `${cur.chunk}-frame chunks still did not fit ${cur.gpuCount}x ${nameOf(key)}: ${more} GPUs of the same card (RAM comes with the GPU count)` }
  const next = Object.keys(RAM_GIB_PER_GPU).filter((c) => !EXCLUDED.has(c) && RAM_GIB_PER_GPU[c] > (RAM_GIB_PER_GPU[key] ?? 0)).sort((a, b) => RAM_GIB_PER_GPU[a] - RAM_GIB_PER_GPU[b])[0]
  return next ? { kind: 'card', card: next, gpuCount: 1, why: `${cur.gpuCount}x ${nameOf(key)} is out of GPU steps: ${nameOf(next)}, which has more RAM per GPU` } : null
}
