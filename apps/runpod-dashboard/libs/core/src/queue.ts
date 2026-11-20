/**
 * The round-import queue (ADR-038): importing a round makes a `pull` task (which also places the round, ADR-033) and one `run` task per shot (ADR-037); pool pods take the tasks.
 * State lives in ~/.config/runpod-pod-manager/queue.json so it survives a restart; a task that was running then is `interrupted` (Retry runs it again). The scheduler is `tick`,
 * run on a timer while the app (or MCP server) is up. Every outside effect goes through `Deps`, so the tests run it with fakes and no pod.
 */
import { timedTick } from './ticks.js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CoreError } from './errors.js'
import * as failures from './failures.js'
import * as gpus from './gpus.js'
import * as history from './history.js'
import * as autosyncstore from './autosyncstore.js'
import * as mounts from './mounts.js'
import { queueFile } from './paths.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as podrounds from './podrounds.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as runflows from './runflows.js'
import * as volumes from './volumes.js'
import * as volumeround from './volumeround.js'

export type TaskKind = 'pull' | 'run'
export type TaskState = 'waiting' | 'running' | 'done' | 'failed' | 'held' | 'cancelled' | 'interrupted'
export interface Task {
  id: string; import_id: string; round: string; shot: string | null; kind: TaskKind; state: TaskState
  depends_on: string[]; pod_id: string | null; pod_name: string | null
  /** `pod` while a run task waits for its pod to come up; `job` once the pull or run job exists. */
  phase?: 'pod' | 'job'; job_id?: string; graphs?: string[]
  /** The card chosen for this shot: its run gets a pod of its own with that card (no pool pod is reused). Absent = the pool, else the default card. */
  gpu?: string; price?: number | null
  /** The cards chosen for this shot, in the person's order (`gpu` is the first). Every new pod of the task asks them in this order, from the first: the first with a card free is used. */
  gpus?: string[]
  /** What happened to this task and when: pod chosen / created / resumed, pod ready, job stages, results. The Queue shows it. */
  events?: { at: string; text: string }[]
  /** The live stage of the pull job or the run (`pulling`, `placing`, `running 3/12 graphs`...). */
  stage?: string
  /** The card of the pod this task actually runs on, when the queue created it (the chosen card, else the pool's default): shown in the Queue for every task. */
  card?: string
  /** A pod could not be had because RunPod had no card free: the run waits and asks again (not before `retry_at`), up to MAX_CARD_WAITS times. */
  retry_at?: string; attempts?: number
  started_at?: string; finished_at?: string; error?: string; /** for a failed task: the failure in structured words (stage, node, message, missing models, recovery, retryable, text) */ failure?: failures.Explained; detail?: string; held_reason?: string
}
export interface ImportRec {
  id: string; round: string; approved_by: string; created_at: string; state: 'active' | 'done' | 'cancelled'
  /** Auto sync for every pod this import CREATES (docs/ADR-046), with this import's approver as the named yes; pods reused from the pool are not changed */
  auto_sync?: { pull: boolean; push: boolean }
  max_pods: number | null; cost_cap_usd: number | null; cap_enabled: boolean
  est_total_usd: number | null; spent_usd: number
  /** The shots this import brings: the pull copies only these (and the round's shared files), the runs are of these */
  shots?: string[]
  /** Pods this import started or created: stopped when the import has no more tasks for them. A pod that was already running is never in here. */
  started_pods: string[]
  price_per_hour: number | null
  /** `volume`: a round that already sits on a network volume, run in place (ADR-044): no pull task, the graphs are named at the start; `volume_id` is where. */
  source?: 'volume'; volume_id?: string; graphs?: number; seconds_per_graph?: number
}
interface QueueFile { version: 1; imports: ImportRec[]; tasks: Task[] }

export interface VolPod { id: string; name: string; state: 'running' | 'starting' | 'off'; price: number | null; gpu?: string }
export interface Deps {
  shotsOf: (round: string) => Promise<string[]>
  volumePods: () => Promise<VolPod[]>
  podReady: (id: string) => Promise<{ ready: boolean; price: number | null }>
  resumePod: (id: string) => Promise<void>
  createPod: (name: string, round: string, gpu?: string) => Promise<{ id: string; name: string }>
  /** Turn Auto sync on for a pod this import created (ADR-046); true when it was switched on */
  autoSync: (podId: string, approvedBy: string, a: { pull: boolean; push: boolean }) => boolean
  cardPrice: (gpu: string) => Promise<number | null>
  /** Put the pod in the round and name the shot it works on, so the pod card says so (ADR-039). */
  assignShot: (podId: string, round: string, shot: string) => void
  /** Make sure the volume the pods and the pull use exists; `id` (when given) becomes the Default Configuration's volume first. */
  ensureVolume: (id?: string) => Promise<void>
  stopPod: (id: string) => Promise<void>
  planPull: (round: string, shots?: string[]) => Promise<{ price_per_hour: number | null; ceiling_minutes: number; bytes: number }>
  pull: (round: string, shots?: string[]) => Promise<{ id: string }>
  pullJob: (id: string) => ReturnType<typeof podpull.job>
  cancelPull: (id: string) => void
  run: (podId: string, paths: string[]) => Promise<{ id: string }>
  runJob: (id: string) => runflows.RunJob | null
  cancelRun: (id: string) => void
  /** ADR-044: what a round on a volume holds (shots, graphs as the Workflows panel names them, the locked shots), read-only over S3. */
  describeVolumeRound: (volumeId: string, round: string) => Promise<volumeround.RoundInfo>
  /** The History's median seconds per graph (null: none recorded) and what the USD 100 rule leaves (null: no cap set). */
  runSeconds: () => { seconds: number | null; samples: number }
  remainingUsd: () => number | null
  now: () => Date
}

/** The card the pool is made of when the queue has to create a pod. */
/** The card a pool pod gets when none was chosen for its shot: the system-wide default card (Default Configuration), not a constant. */
export const poolGpu = () => mounts.load().default_gpu
/** A run's duration is unknown: this many hours per shot go into the estimate. */
export const RUN_ESTIMATE_H = 0.5

const realDeps: Deps = {
  shotsOf: async (round) => panama.shotDirsOf((await panama.filesAsync(round)).entries),   // the shot folders (with their own MANIFEST.json), not templates/
  volumePods: async () => {
    const vol = (mounts.load().network_volume_id || '').trim()
    return (await rp.listPods()).filter((p) => (p.networkVolumeId || '') === vol && !(p.name || '').startsWith(podpull.POD_PREFIX)).map((p) => ({
      id: p.id, name: p.name || p.id, price: p.costPerHr ?? null, gpu: p.machine?.gpuDisplayName,
      state: p.desiredStatus === 'EXITED' ? 'off' : (p.runtime?.uptimeInSeconds ?? 0) > 0 ? 'running' : 'starting',
    }) as VolPod)
  },
  podReady: async (id) => { const p = await pods.get(id); const raw = await rp.getPod(id); return { ready: p.status === 'running' && !!p.web_ui_url && p.comfy_ready !== false, price: raw?.costPerHr ?? null } },
  resumePod: async (id) => { await pods.resume(id) },
  autoSync: (podId, by, a) => autosyncstore.applyFromConfig(podId, { enabled: true, pull: a.pull, push: a.push, approved_by: by }, 'import'),
  createPod: async (name, round, gpu) => { const p = await pods.create({ name, gpu: gpu || poolGpu(), apply_mounts: true, round }); return { id: p.id, name: p.name } },
  assignShot: (podId, round, shot) => { if (podrounds.get(podId) !== round) podrounds.set(podId, round); podrounds.setShot(podId, shot) },
  ensureVolume: async (id) => {
    const want = (id || mounts.load().network_volume_id || '').trim()
    if (!want) throw new CoreError(400, 'No network volume: pick one for the import (or set the default volume).')
    const vol = (await volumes.list()).find((v) => v.id === want)
    if (!vol) throw new CoreError(400, `The network volume "${want}" is not one of your volumes: pick a volume for the import.`)
    if (!vol.is_default) await volumes.useAsDefault(want)
  },
  cardPrice: async (gpu) => (await pods.gpuMenu()).gpus.find((g) => g.value === gpu)?.price ?? null,
  stopPod: async (id) => { await pods.stop(id) },
  planPull: async (round, shots) => { const p = await podpull.plan(round, shots?.length ? { shots } : {}); return { price_per_hour: p.price_per_hour, ceiling_minutes: p.ceiling_minutes, bytes: p.bytes } },
  pull: async (round, shots) => podpull.pull(round, shots?.length ? { shots } : {}),
  pullJob: (id) => podpull.job(id),
  cancelPull: (id) => { try { podpull.cancel(id) } catch { /* already over */ } },
  run: async (podId, paths) => runflows.run(podId, paths),
  runJob: (id) => runflows.job(id),
  cancelRun: (id) => { try { runflows.cancel(id) } catch { /* already over */ } },
  describeVolumeRound: (volumeId, round) => volumeround.describeRound(volumeId, round),
  runSeconds: () => volumeround.medianSecondsPerGraph(),
  remainingUsd: () => volumeround.governanceRemainingUsd(),
  now: () => new Date(),
}
let deps: Deps = realDeps
/** Tests replace the outside world; `reset()` puts the real one back. */
export const configure = (d: Partial<Deps>) => { deps = { ...realDeps, ...d } }
export const reset = () => { deps = realDeps }

// ----- storage -----
const load = (): QueueFile => {
  const f = queueFile()
  if (!existsSync(f)) return { version: 1, imports: [], tasks: [] }
  try { const q = JSON.parse(readFileSync(f, 'utf8')) as QueueFile; return { version: 1, imports: q.imports || [], tasks: q.tasks || [] } } catch { return { version: 1, imports: [], tasks: [] } }
}
let cache: QueueFile | null = null
const state = (): QueueFile => (cache ??= (() => { const q = load(); for (const t of q.tasks) if (t.state === 'running') { t.state = 'interrupted'; t.error = 'The app stopped while this was running; Retry runs it again.' } return q })())
const save = () => { const f = queueFile(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(state(), null, 2)); for (const l of listeners) { try { l() } catch { /* never breaks a save */ } } }
/** Forget the in-memory copy (tests use a fresh file per run). */
export const forget = () => { cache = null }
const listeners = new Set<() => void>()
export function onChange(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }

const TERMINAL: TaskState[] = ['done', 'failed', 'cancelled']
const live = (t: Task) => !TERMINAL.includes(t.state)

export interface QueueView { imports: (ImportRec & { counts: Record<string, number> })[]; tasks: Task[]; active: number }
export function list(): QueueView {
  const q = state()
  const imports = q.imports.map((i) => ({ ...i, counts: q.tasks.filter((t) => t.import_id === i.id).reduce((c, t) => { c[t.state] = (c[t.state] || 0) + 1; return c }, {} as Record<string, number>) }))
  return { imports, tasks: q.tasks.map((t) => (t.error && (t.state === 'failed' || t.state === 'interrupted' || t.state === 'held') ? { ...t, failure: failures.explain(t.error, { stage: t.kind === 'pull' ? 'transfer' : undefined, log_tail: t.events?.slice(-5).map((e) => e.text) }) } : t)), active: q.tasks.filter((t) => t.state === 'waiting' || t.state === 'running' || t.state === 'held').length }
}

// ----- planning and importing -----
export interface ImportPlan {
  round: string; shots: string[]; price_per_hour: number | null; pull_hours: number; est_total_usd: number | null
  max_pods: number | null; cost_cap_usd: number | null; cap_enabled: boolean; over_cap: boolean
  /** ADR-044 volume source only: what was assumed, what was refused, and the cap left. */
  source?: 'volume'; volume_id?: string
  graphs?: number; graphs_by_shot?: Record<string, number>; seconds_per_graph?: number; samples?: number
  /** Locked shots (cgi-042, anything under 04_GRAPH): listed, never run. `refused` are the ones asked for by name. */
  locked?: string[]; refused?: string[]
  /** What is left of the caps: the import's cap, and Binc's USD 100 rule (the History's spend against it). */
  remaining_usd?: number | null; assumption?: string; blocked?: string
}
export interface ImportOpts { /** true: every pod this import creates pulls its volume's changes to this PC (Auto sync, ADR-046); { pull, push } to choose. Needs approved_by (already required). */ auto_sync?: boolean | { pull?: boolean; push?: boolean }; /** the network volume the pods and the pull use; it becomes the default volume */ volume_id?: string; /** shot -> card (a GPU key); a shot without one takes the pool */ cards?: Record<string, string | string[]>; shots?: string[]; run_workflows?: boolean; max_pods?: number; cost_cap_usd?: number; approved_by?: string
  /** `volume`: the round already sits on `volume_id` and is run in place (ADR-044). Default: a BH round, pulled first. */ source?: string
  /** Refused on a volume source (guard a): Binc's rule, nothing on the volume is overwritten. Accepted by nothing; named so a caller that sends it gets a clear error. */ replace?: boolean; overwrite?: boolean }

/** A shot's card as an ordered list of keys: a string is one card, an array keeps the person's order (duplicates dropped, blanks ignored). */
export const cardList = (v: string | string[] | undefined | null): string[] => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((c) => String(c || '').trim()).filter(Boolean))]
/** Every key of every shot must be a card we know (or `auto`). */
function checkCards(o: ImportOpts) {
  for (const [shot, v] of Object.entries(o.cards ?? {})) {
    if (Array.isArray(v) && !cardList(v).length) throw new CoreError(400, `Cards for ${shot}: an empty list. Leave the shot out to use the pool, or name a card.`)
    if (Array.isArray(v) && v.some((c) => typeof c !== 'string')) throw new CoreError(400, `Cards for ${shot}: give card keys (a string, or a list of strings).`)
    for (const card of cardList(v)) if (card !== gpus.AUTO && !gpus.GPUS[card]) throw new CoreError(400, `Unknown card "${card}" for ${shot}: use a key from list_gpus.`)
  }
}
/** The price per hour used for each shot that has a card: with several, the MOST EXPENSIVE one (conservative: whichever the pod gets, the cap is not passed). A card we cannot price is left out: the pull's price stands in. */
async function cardPrices(shots: string[], o: ImportOpts): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}, seen: Record<string, number | null> = {}
  for (const s of shots) {
    const list = cardList(o.cards?.[s]); if (!list.length) continue
    const ps: number[] = []
    for (const g of list) { if (!(g in seen)) seen[g] = await deps.cardPrice(g).catch(() => null); if (seen[g] != null) ps.push(seen[g] as number) }
    out[s] = ps.length ? Math.max(...ps) : null
  }
  return out
}
const severalCards = (o: ImportOpts) => Object.values(o.cards ?? {}).some((v) => cardList(v).length > 1)
const MOST_EXPENSIVE = 'Where a shot has several cards, the most expensive one is priced (a pod may get any of them, so the cap is never passed).'
const taskCards = (o: ImportOpts, shot: string | null) => { const l = shot ? cardList(o.cards?.[shot]) : []; return l.length ? { gpu: l[0], ...(l.length > 1 ? { gpus: l } : {}) } : {} }
/** What importing the round would do and cost, before it does anything. */
export async function planImport(round: string, o: ImportOpts = {}): Promise<ImportPlan> {
  if (o.source === 'volume') return planVolumeImport(round, o)
  if (o.source && o.source !== 'panama-s3') throw new CoreError(400, `Unknown source "${o.source}": use panama-s3 (BH) or volume.`)
  checkCards(o)
  const cfg = mounts.load()
  const [all, p] = await Promise.all([deps.shotsOf(round), deps.planPull(round, o.shots)])   // both read the round's listing (shared), the pull plan also asks RunPod
  const shots = o.shots?.length ? all.filter((s) => o.shots!.includes(s)) : all
  const pullH = p.ceiling_minutes / 60
  const prices = await cardPrices(shots, o)
  const runCost = o.run_workflows === false ? 0 : shots.reduce((a, s) => a + (prices[s] ?? p.price_per_hour ?? 0) * RUN_ESTIMATE_H, 0)
  const est = p.price_per_hour == null ? null : Math.round((p.price_per_hour * pullH + runCost) * 100) / 100
  const capOn = cfg.import_cap_enabled
  const max = capOn ? (o.max_pods ?? cfg.import_max_pods) : (o.max_pods ?? null)
  const cap = capOn ? (o.cost_cap_usd ?? cfg.import_cost_cap_usd) : null
  return { round, shots, price_per_hour: p.price_per_hour, pull_hours: Math.round(pullH * 100) / 100, est_total_usd: est, max_pods: max, cost_cap_usd: cap, cap_enabled: capOn, over_cap: cap != null && est != null && est > cap, ...(severalCards(o) ? { assumption: MOST_EXPENSIVE } : {}) }
}

// ----- a round that already sits on a volume (ADR-044): run in place, never pulled, never written -----

/** Guard (a): a volume source never offers or accepts Replace / overwrite. Binc: nothing is renamed, moved, overwritten or deleted. */
function refuseOverwrite(o: ImportOpts) {
  if (o.replace || o.overwrite) throw new CoreError(400, 'A volume round is run in place and never overwritten: there is no Replace for a volume source (Binc: nothing is overwritten, moved or deleted).')
}
const volumeIdOf = (o: ImportOpts) => (o.volume_id || volumeround.defaultVolumeId()).trim()

/** What running a volume round's shots would do and cost, before it does anything: the shots (locked ones listed and refused when asked for), the graphs as the Workflows panel names them, and the estimate against the caps. Reads the volume's listing only. */
export async function planVolumeImport(round: string, o: ImportOpts = {}): Promise<ImportPlan> {
  refuseOverwrite(o)
  checkCards(o)
  const volumeId = volumeIdOf(o)
  if (!volumeId) throw new CoreError(400, 'No network volume: pick the volume the round sits on (volume_id).')
  const cfg = mounts.load()
  const info = await deps.describeVolumeRound(volumeId, round)
  const locked = new Set(info.locked)
  const asked = o.shots?.length ? o.shots : null
  if (asked) for (const s of asked) if (!info.shots.includes(s)) throw new CoreError(404, `${round} on ${volumeId} has no shot ${s} (has: ${info.shots.join(', ')}).`)
  const refused = asked ? asked.filter((s) => locked.has(s)) : []
  const shots = (asked ?? info.shots).filter((s) => !locked.has(s))
  const graphsBy: Record<string, number> = {}
  for (const s of shots) graphsBy[s] = (info.by_shot[s] ?? []).filter((g) => !volumeround.isLockedPath(g)).length
  const graphs = Object.values(graphsBy).reduce((a, b) => a + b, 0)
  const med = deps.runSeconds()
  const secs = med.seconds ?? volumeround.DEFAULT_SECONDS_PER_GRAPH
  const poolPrice = await deps.cardPrice(poolGpu()).catch(() => null)
  const prices = await cardPrices(shots, o)
  const est = poolPrice == null && shots.some((s) => prices[s] == null) ? null : Math.round(shots.reduce((a, s) => a + graphsBy[s] * (secs / 3600) * ((prices[s] ?? poolPrice) as number), 0) * 100) / 100
  const capOn = cfg.import_cap_enabled
  const max = capOn ? (o.max_pods ?? cfg.import_max_pods) : (o.max_pods ?? null)
  const cap = capOn ? (o.cost_cap_usd ?? cfg.import_cost_cap_usd) : (o.cost_cap_usd ?? null)
  const remaining = deps.remainingUsd()
  const limit = [cap, remaining].filter((x): x is number => x != null).reduce<number | null>((a, x) => (a == null ? x : Math.min(a, x)), null)
  const over = limit != null && est != null && est > limit
  const assumption = `${graphs} graph(s) x ${secs} s each (${med.seconds != null ? `the median of ${med.samples} run(s) in the History` : `no run in the History: the default ${volumeround.DEFAULT_SECONDS_PER_GRAPH} s`}) x the pod's hourly price (${poolPrice != null ? `$${poolPrice}/h for the pool card ${poolGpu()}` : 'the pool card has no price'}; a card chosen for a shot is priced at its own).${severalCards(o) ? ` ${MOST_EXPENSIVE}` : ''}`
  const blocked = refused.length ? `${refused.join(', ')} ${refused.length === 1 ? 'is' : 'are'} locked (client-approved, or under 04_GRAPH): listed for reference, never run (Binc's rules).` : over ? `The estimate $${est} passes the ${cap != null && est! > cap ? `cap $${cap}` : `USD ${remaining} left of the agent spend cap`}: raise the cap on purpose, or choose fewer shots.` : est == null ? 'The pool card has no price: choose a card for the shots.' : undefined
  return { round, shots, price_per_hour: poolPrice, pull_hours: 0, est_total_usd: est, max_pods: max, cost_cap_usd: cap, cap_enabled: capOn, over_cap: over,
    source: 'volume', volume_id: volumeId, graphs, graphs_by_shot: graphsBy, seconds_per_graph: secs, samples: med.samples, locked: info.locked, refused, remaining_usd: remaining, assumption, ...(blocked ? { blocked } : {}) }
}

/** Queue a volume round: NO pull (nothing is copied, nothing on the volume is touched); one run task per shot, with the shot's graph paths as the Workflows panel names them. Guards (b) locked shots and (c) the cap are enforced here, before anything starts. */
async function importVolumeRound(round: string, o: ImportOpts): Promise<ImportRec> {
  refuseOverwrite(o)
  const by = (o.approved_by || '').trim()
  if (!by) throw new CoreError(400, 'An import spends money on pods: say who approves it (approved_by).')
  if (o.run_workflows === false) throw new CoreError(400, 'A volume round is already where the pods mount it: importing it means running its shots, so there is nothing to do without run_workflows.')
  const volumeId = volumeIdOf(o)
  const plan = await planVolumeImport(round, o)
  if (plan.refused?.length) throw new CoreError(403, `Refused: ${plan.blocked}`)   // guard (b)
  if (!plan.shots.length) throw new CoreError(404, `No shots to run in ${round}${plan.locked?.length ? ` (${plan.locked.join(', ')} ${plan.locked.length === 1 ? 'is' : 'are'} locked)` : ''}.`)
  if (plan.est_total_usd == null) throw new CoreError(400, plan.blocked || 'The cost cannot be estimated: choose a card with a price.')
  if (plan.over_cap) throw new CoreError(402, `Refused: ${plan.blocked}`)   // guard (c)
  await deps.ensureVolume(volumeId)
  const q = state()
  if (q.imports.some((i) => i.round === round && i.state === 'active')) throw new CoreError(409, `${round} is already being imported: see the queue.`)
  const info = await deps.describeVolumeRound(volumeId, round)
  const imp: ImportRec = { id: newId('imp'), round, approved_by: by, created_at: deps.now().toISOString(), state: 'active', ...(autoOf(o.auto_sync) ? { auto_sync: autoOf(o.auto_sync) } : {}), max_pods: plan.max_pods, cost_cap_usd: plan.cost_cap_usd, cap_enabled: plan.cap_enabled, est_total_usd: plan.est_total_usd, spent_usd: 0, started_pods: [], shots: [...plan.shots], price_per_hour: plan.price_per_hour,
    source: 'volume', volume_id: volumeId, graphs: plan.graphs, seconds_per_graph: plan.seconds_per_graph }
  q.imports.push(imp)
  const prices = await cardPrices(plan.shots, o)
  for (const shot of plan.shots) {
    const graphs = (info.by_shot[shot] ?? []).filter((g) => !volumeround.isLockedPath(g) && !info.locked.includes(shot))   // paths relative to workflows/, as the pod's panel names them
    q.tasks.push({ id: newId('t'), import_id: imp.id, round, shot, kind: 'run', state: 'waiting', depends_on: [], pod_id: null, pod_name: null, graphs, ...(cardList(o.cards?.[shot]).length ? { ...taskCards(o, shot), price: prices[shot] ?? null } : {}) })
  }
  history.record({ kind: 'change', area: 'import', action: 'queued a volume round', what: `${round} on ${volumeId}`, detail: `${plan.shots.length} shot(s), ${plan.graphs} graph(s), est $${plan.est_total_usd}; run in place, nothing copied or written`, approved_by: by } as never)
  save(); start()
  return imp
}

/** The Auto sync choice of an import: true is pull only; an object chooses; false or nothing is none. */
export const autoOf = (a: ImportOpts['auto_sync']): { pull: boolean; push: boolean } | undefined => (a === true ? { pull: true, push: false } : a && typeof a === 'object' && (a.pull !== false || a.push === true) ? { pull: a.pull !== false, push: a.push === true } : undefined)

let seq = 0
const newId = (p: string) => `${p}-${deps.now().getTime().toString(36)}-${(seq++).toString(36)}`

/** Queue the import: one pull, one run per shot. `approved_by` is the one approval for everything it starts. */
export async function importRound(round: string, o: ImportOpts = {}): Promise<ImportRec> {
  if (o.source === 'volume') return importVolumeRound(round, o)
  const by = (o.approved_by || '').trim()
  if (!by) throw new CoreError(400, 'An import spends money on pods: say who approves it (approved_by).')
  await deps.ensureVolume(o.volume_id)   // before any pod is created: a missing volume fails here, loudly, not in each pull
  const plan = await planImport(round, o)
  if (!plan.shots.length) throw new CoreError(404, `No shots found in ${round}.`)
  const q = state()
  if (q.imports.some((i) => i.round === round && i.state === 'active')) throw new CoreError(409, `${round} is already being imported: see the queue.`)
  const imp: ImportRec = { id: newId('imp'), round, approved_by: by, created_at: deps.now().toISOString(), state: 'active', ...(autoOf(o.auto_sync) ? { auto_sync: autoOf(o.auto_sync) } : {}), max_pods: plan.max_pods, cost_cap_usd: plan.cost_cap_usd, cap_enabled: plan.cap_enabled, est_total_usd: plan.est_total_usd, spent_usd: 0, started_pods: [], shots: [...plan.shots], price_per_hour: plan.price_per_hour }
  const pull: Task = { id: newId('t'), import_id: imp.id, round, shot: null, kind: 'pull', state: 'waiting', depends_on: [], pod_id: null, pod_name: null }
  q.imports.push(imp); q.tasks.push(pull)
  const prices = await cardPrices(plan.shots, o)
  if (o.run_workflows !== false) for (const shot of plan.shots) q.tasks.push({ id: newId('t'), import_id: imp.id, round, shot, kind: 'run', state: 'waiting', depends_on: [pull.id], pod_id: null, pod_name: null, ...(cardList(o.cards?.[shot]).length ? { ...taskCards(o, shot), price: prices[shot] ?? null } : {}) })
  save(); start()
  return imp
}

export interface RoundItem { auto_sync?: boolean | { pull?: boolean; push?: boolean }; round: string; shots?: string[]; cards?: Record<string, string | string[]>; max_pods?: number }
/** Several rounds on one approval (the window's and MCP's one path): each round is its own import; `cost_cap_usd` is the TOTAL and is split evenly, so the caps never add up to more.
 *  Every round is planned first, so a bad round or card queues nothing; `max_pods` (per round) may be set per item. */
export async function importRounds(items: RoundItem[], o: Omit<ImportOpts, 'shots' | 'cards'> = {}): Promise<ImportRec[]> {
  if (!Array.isArray(items) || !items.length) throw new CoreError(400, 'Which rounds? Give at least one.')
  if (!(o.approved_by || '').trim()) throw new CoreError(400, 'An import spends money on pods: say who approves it (approved_by).')
  const names = items.map((i) => i.round)
  if (new Set(names).size !== names.length) throw new CoreError(400, 'A round is listed twice.')
  if (o.source === 'volume') refuseOverwrite(o)
  await deps.ensureVolume(o.source === 'volume' ? volumeIdOf(o) : o.volume_id)
  o = { ...o, ...(o.source === 'volume' ? { volume_id: volumeIdOf(o) } : { volume_id: undefined }) }   // done once for all the rounds (a volume round keeps its volume: it is where the round sits)
  const each = o.cost_cap_usd != null ? Math.round((o.cost_cap_usd / items.length) * 100) / 100 : undefined
  const opts = (i: RoundItem): ImportOpts => ({ ...o, ...(i.auto_sync !== undefined ? { auto_sync: i.auto_sync } : {}), shots: i.shots, cards: i.cards, ...(each != null ? { cost_cap_usd: each } : {}), ...(i.max_pods != null ? { max_pods: i.max_pods } : {}) })
  for (const i of items) { const p = await planImport(i.round, opts(i)); if (p.refused?.length) throw new CoreError(403, `Refused: ${p.blocked}`); if (p.source === 'volume' && p.over_cap) throw new CoreError(402, `Refused: ${p.blocked}`); if (!p.shots.length) throw new CoreError(404, `No shots found in ${i.round}.`); if (state().imports.some((x) => x.round === i.round && x.state === 'active')) throw new CoreError(409, `${i.round} is already being imported: see the queue.`) }
  const out: ImportRec[] = []
  for (const i of items) out.push(await importRound(i.round, opts(i)))
  return out
}

// ----- the scheduler -----
/** Waiting for a card to be free again: ask again every minute, for half an hour. */
export const CARD_RETRY_MS = 60_000
export const MAX_CARD_WAITS = 30
/** A run that never started because its pull did not finish says so, and why. */
const NOT_STARTED = 'Not started: its pull did not finish'
const ev = (t: Task, text: string) => { (t.events ||= []).push({ at: deps.now().toISOString(), text }); if (t.events.length > 60) t.events.splice(0, t.events.length - 60) }
const logTask = (t: Task, imp: ImportRec) => history.record({ kind: 'job', job: 'queue', state: t.state === 'done' ? 'done' : t.state === 'cancelled' ? 'cancelled' : 'failed', started_at: t.started_at, what: `${t.round} ${t.kind}${t.shot ? ` ${t.shot}` : ''}`, pod_id: t.pod_id ?? undefined, pod_name: t.pod_name ?? undefined, ...(t.error ? { error: t.error } : {}), detail: `import ${imp.id}; approved by ${imp.approved_by}${t.detail ? `; ${t.detail}` : ''}` })
const finish = (t: Task, imp: ImportRec, s: 'done' | 'failed' | 'cancelled', error?: string) => { ev(t, error ? `${s}: ${error}` : s); t.stage = undefined; t.state = s; t.finished_at = deps.now().toISOString(); if (error) t.error = error; if (s === 'failed' && error) { const ex = failures.explain(error, { stage: t.kind === 'pull' ? 'transfer' : undefined }); failures.record({ stage: ex.stage, message: error, job_id: t.id, round: imp.round ?? '', shot: t.shot ?? '', graph: t.kind === 'run' ? `${t.shot ?? ''} (import task)` : `pull ${imp.round ?? ''}`, pod_id: t.pod_id ?? '', pod_name: t.pod_name ?? '', node_id: ex.node_id, node_type: ex.node_type, quiet: true }) }; logTask(t, imp) }   // every failed import task is in the failures log too

let ticking = false
/** One scheduler pass: read the running tasks' jobs, start what can start, stop pods the imports no longer need. Never throws. */
export async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const q = state(); let dirty = false
    for (const imp of q.imports.filter((i) => i.state === 'active')) {
      const tasks = q.tasks.filter((t) => t.import_id === imp.id)
      // 1. running tasks: follow their jobs
      for (const t of tasks.filter((x) => x.state === 'running')) { if (await follow(t, imp, tasks)) dirty = true }
      // 2. waiting tasks whose dependencies are done
      for (const t of tasks.filter((x) => x.state === 'waiting')) {
        const deps_ = t.depends_on.map((id) => q.tasks.find((x) => x.id === id))
        if (deps_.some((d) => d && (d.state === 'failed' || d.state === 'cancelled' || d.state === 'interrupted'))) { const why = deps_.find((d) => d && (d.state === 'failed' || d.state === 'cancelled' || d.state === 'interrupted')); finish(t, imp, 'failed', `${NOT_STARTED}${why?.error ? `: ${why.error}` : ''}`); dirty = true; continue }
        if (!deps_.every((d) => !d || d.state === 'done')) continue
        if (await begin(t, imp, tasks)) dirty = true
      }
      // 3. nothing left: the import is over. The pods it started are LEFT RUNNING (Lucas, 2026-11-15: stopping a pod the moment its run failed threw away a booted card that RunPod would not give back); the idle stop (30 quiet minutes) ends them.
      if (!tasks.some(live)) {
        imp.state = tasks.every((t) => t.state === 'cancelled') ? 'cancelled' : 'done'
        imp.started_pods = []; dirty = true
      }
    }
    if (dirty) save()
  } catch (e) { console.error(`queue tick failed: ${(e as Error).message}`) } finally { ticking = false }
}

async function follow(t: Task, imp: ImportRec, tasks: Task[]): Promise<boolean> {
  if (t.kind === 'run' && t.phase === 'pod') {
    const r = await deps.podReady(t.pod_id!)
    if (!r.ready) { if (t.stage !== 'waiting for the pod to come up') { t.stage = 'waiting for the pod to come up'; return true } return false }
    if (!t.graphs?.length) { t.detail = 'no graphs for this shot in the round'; ev(t, 'no graphs for this shot in the round'); finish(t, imp, 'done'); return true }
    ev(t, `pod ${t.pod_name} is ready: running ${t.graphs.length} graph(s)`)
    t.job_id = (await deps.run(t.pod_id!, t.graphs)).id; t.phase = 'job'; t.stage = `running 0/${t.graphs.length} graphs`; return true
  }
  if (t.kind === 'pull') {
    const j = t.job_id ? deps.pullJob(t.job_id) : null
    if (!j) { finish(t, imp, 'failed', 'The pull job is gone (the app restarted?).'); return true }
    if (j.state === 'failed' || j.state === 'cancelled') { finish(t, imp, j.state === 'cancelled' ? 'cancelled' : 'failed', j.error || `The pull ${j.state}.`); return true }
    if (j.state === 'done') {
      ev(t, `pull done: ${j.files} file(s)${j.place ? `, placed ${j.place.linked}, ${j.place.graphs?.length ?? 0} graph(s)` : ''}`)
      for (const run of tasks.filter((x) => x.kind === 'run')) run.graphs = (j.place?.graphs ?? []).filter((g) => g.shot === run.shot).map((g) => g.path.replace(/^.*?workflows\//, ''))
      t.pod_id = j.pod_id; t.pod_name = j.pod_name; t.detail = `${j.files} file(s)${j.place ? `, placed ${j.place.linked}` : ''}`
      finish(t, imp, 'done'); return true
    }
    const stage = `${j.state}${j.files ? `: ${j.files} file(s)` : ''}${j.bytes_total ? `, ${Math.round((j.bytes_done / j.bytes_total) * 100)}%` : ''}`
    let changed = false
    if (t.stage !== stage) { if (!t.stage?.startsWith(j.state)) ev(t, `${j.state}${j.pod_name ? ` on ${j.pod_name}` : ''}`); t.stage = stage; changed = true }
    if (j.gpu && t.card !== j.gpu) { t.card = j.gpu; if (j.price_per_hour != null) t.price = j.price_per_hour; changed = true }   // the card the pull's pod really has
    if (j.pod_name && t.pod_name !== j.pod_name) { ev(t, `pod ${j.pod_name} (${j.pod_id}${j.gpu ? `, ${j.gpu}` : ''}${j.price_per_hour != null ? `, $${j.price_per_hour}/h` : ''})`); changed = true }
    t.pod_id = j.pod_id; t.pod_name = j.pod_name; return changed
  }
  const j = t.job_id ? deps.runJob(t.job_id) : null
  if (!j) { finish(t, imp, 'failed', 'The run job is gone (the app restarted?).'); return true }
  if (j.state === 'running') { const stage = `running ${j.ok + j.failed}/${j.results.length} graphs${j.failed ? `, ${j.failed} failed` : ''}`; if (t.stage !== stage) { t.stage = stage; return true } return false }
  ev(t, `finished: ${j.ok} ok, ${j.failed} failed of ${j.results.length}`)
  const hours = (deps.now().getTime() - new Date(t.started_at!).getTime()) / 3_600_000
  imp.spent_usd = Math.round((imp.spent_usd + (t.price ?? imp.price_per_hour ?? 0) * hours) * 100) / 100
  t.detail = `${j.ok} ok, ${j.failed} failed of ${j.results.length}`
  const firstErr = j.results.find((r) => r.error)
  finish(t, imp, j.state === 'cancelled' ? 'cancelled' : j.failed ? 'failed' : 'done', j.failed ? `${firstErr?.path}: ${firstErr?.error}` : undefined)
  return true
}

async function begin(t: Task, imp: ImportRec, tasks: Task[]): Promise<boolean> {
  if (t.kind === 'pull') {
    try { t.job_id = (await deps.pull(t.round, imp.shots)).id; t.state = 'running'; t.started_at = deps.now().toISOString(); t.phase = 'job'; ev(t, `pull of ${t.round} started (a short-lived pod of the cheapest free card, or a pod of yours)`) } catch (e) { finish(t, imp, 'failed', (e as Error).message) }
    return true
  }
  if (t.retry_at && new Date(t.retry_at).getTime() > deps.now().getTime()) return false   // waiting for a card to be free again
  // a run task needs a pod: within the import's pod limit and dollar cap
  const running = tasks.filter((x) => x.kind === 'run' && x.state === 'running').length
  if (imp.max_pods != null && running >= imp.max_pods) return false   // wait for a pod to free up: not an error
  const rate = Math.max(imp.price_per_hour ?? 0, t.price ?? 0) || null   // a dearer card counts at its own price
  if (imp.cap_enabled && imp.cost_cap_usd != null && rate != null && imp.spent_usd + rate * RUN_ESTIMATE_H > imp.cost_cap_usd) {
    if (t.state !== 'held') { t.state = 'held'; t.held_reason = `cap: spent about $${imp.spent_usd} of $${imp.cost_cap_usd}`; return true }
    return false
  }
  try {
    const busy = new Set(q().tasks.filter((x) => x.state === 'running' && x.pod_id).map((x) => x.pod_id))
    const pool = (await deps.volumePods()).filter((p) => !busy.has(p.id))
    const pick = (t.gpus?.length || t.gpu) ? undefined : pool.find((p) => p.state === 'running') ?? pool.find((p) => p.state === 'starting') ?? pool.find((p) => p.state === 'off')
    let podId: string, podName: string
    if (pick) {
      podId = pick.id; podName = pick.name; if (pick.gpu) t.card = pick.gpu   // the card the reused pod really has
      if (pick.state === 'off') { await deps.resumePod(pick.id); imp.started_pods.push(pick.id); ev(t, `restarted your stopped pod ${pick.name}${pick.gpu ? ` (${pick.gpu})` : ''}`) } else ev(t, `reusing the pod ${pick.name} (${pick.gpu ? `${pick.gpu}, ` : ''}${pick.state})`)
    } else {
      // Cards in the person's order, always from the FIRST (so every pod gets the first choice while RunPod has one free; later pods start again from the first). Only a definite no-card goes on to the next card: any other error stops here, so at most ONE pod is made per attempt.
      const order = t.gpus?.length ? t.gpus : [t.gpu]   // [undefined]: the pool's default card
      let c: { id: string; name: string } | undefined, got: string | undefined, noCard: unknown
      for (const g of order) {
        try { c = await deps.createPod(`queue-${imp.round}-${tasks.filter((x) => x.pod_id).length + 1}`.slice(0, 60), imp.round, g); got = g || poolGpu(); break } catch (e) {
          if ((e as { code?: string })?.code !== 'no_card' || order.length === 1) throw e
          noCard = e; ev(t, `no ${g} free: trying the next card`)
        }
      }
      if (!c) throw noCard
      podId = c.id; podName = c.name; t.card = got; imp.started_pods.push(c.id); ev(t, `created pod ${c.name} (${got}) in round ${imp.round}`)
      if (imp.auto_sync) { try { if (deps.autoSync(c.id, imp.approved_by, imp.auto_sync)) ev(t, 'Auto sync on for this pod (pull' + (imp.auto_sync.push ? ' and push' : '') + `), named yes: ${imp.approved_by}`) } catch { /* never fails a run */ } }
    }
    if (t.shot) { try { deps.assignShot(podId, imp.round, t.shot); ev(t, `pod card: round ${imp.round}, shot ${t.shot}`) } catch { /* the card label is ours only: never fail a run over it */ } }
    t.pod_id = podId; t.pod_name = podName; t.phase = 'pod'; t.state = 'running'; t.retry_at = undefined; t.attempts = undefined; t.stage = undefined; t.started_at = deps.now().toISOString(); delete t.held_reason
  } catch (e) {
    const msg = (e as Error).message
    if (/No card available/.test(msg) && (t.attempts ?? 0) < MAX_CARD_WAITS) {   // RunPod has none free right now: wait and ask again, as the datacenter table says "if we have to wait we have to wait"
      t.attempts = (t.attempts ?? 0) + 1; t.retry_at = new Date(deps.now().getTime() + CARD_RETRY_MS).toISOString()
      t.stage = `waiting for a free ${t.gpus && t.gpus.length > 1 ? t.gpus.join(' or ') : t.gpu || poolGpu()}${t.gpu ? '' : ' (the pool default: no card was chosen for this shot)'} (try ${t.attempts} of ${MAX_CARD_WAITS}, next at ${t.retry_at.slice(11, 19)} UTC)`
      if (t.attempts === 1) ev(t, `no card free right now: ${msg.slice(0, 160)}. Waiting and asking again every minute.`)
      return true
    }
    finish(t, imp, 'failed', msg)
  }
  return true
}
const q = () => state()

// ----- actions -----
export function cancelTask(id: string): Task {
  const t = state().tasks.find((x) => x.id === id); if (!t) throw new CoreError(404, `No such task: ${id}`)
  const imp = state().imports.find((i) => i.id === t.import_id)!
  if (!live(t)) return t
  if (t.state === 'running' && t.job_id) { if (t.kind === 'pull') deps.cancelPull(t.job_id); else deps.cancelRun(t.job_id) }
  finish(t, imp, 'cancelled'); save(); return t
}
export function cancelImport(id: string): ImportRec {
  const imp = state().imports.find((i) => i.id === id); if (!imp) throw new CoreError(404, `No such import: ${id}`)
  for (const t of state().tasks.filter((x) => x.import_id === id && live(x))) cancelTask(t.id)
  return imp
}
/** Purge finished imports and their tasks from the queue (the history keeps what they did). Only on a yes: `confirmed` must be true, so a caller has asked the user first.
 *  `import_id` purges that one import; `older_than_days` only those finished that long ago. An import with a task still waiting, running or held is never purged. */
export function purge(o: { confirmed?: boolean; import_id?: string; older_than_days?: number } = {}): { removed_imports: number; removed_tasks: number } {
  if (o.confirmed !== true) throw new CoreError(400, 'Purging the queue needs the user\'s yes: ask them, then call again with confirmed: true.')
  const q = state(), cutoff = o.older_than_days != null ? Date.now() - o.older_than_days * 86_400_000 : null
  if (o.import_id && !q.imports.some((i) => i.id === o.import_id)) throw new CoreError(404, `No such import: ${o.import_id}`)
  const done = (i: ImportRec) => {
    const ts = q.tasks.filter((t) => t.import_id === i.id)
    if (ts.some(live)) return false
    if (o.import_id && i.id !== o.import_id) return false
    if (cutoff != null) { const last = Math.max(0, ...ts.map((t) => Date.parse(t.finished_at || '') || 0), Date.parse(i.created_at || '') || 0); if (last > cutoff) return false }
    return true
  }
  const gone = new Set(q.imports.filter(done).map((i) => i.id))
  const before = q.tasks.length
  q.imports = q.imports.filter((i) => !gone.has(i.id)); q.tasks = q.tasks.filter((t) => !gone.has(t.import_id))
  if (gone.size) save()
  return { removed_imports: gone.size, removed_tasks: before - q.tasks.length }
}
/** Change an import's limits (raise the cap so held tasks can go on: Retry them after). null removes a limit. */
export function setImportLimits(id: string, o: { max_pods?: number | null; cost_cap_usd?: number | null }): ImportRec {
  const imp = state().imports.find((i) => i.id === id); if (!imp) throw new CoreError(404, `No such import: ${id}`)
  if (o.max_pods !== undefined) imp.max_pods = o.max_pods
  if (o.cost_cap_usd !== undefined) imp.cost_cap_usd = o.cost_cap_usd
  save(); return imp
}
/** Run a failed, held, interrupted or cancelled task again (and its import, if it had ended). */
export function retryTask(id: string): Task {
  const t = state().tasks.find((x) => x.id === id); if (!t) throw new CoreError(404, `No such task: ${id}`)
  if (live(t) && t.state !== 'held' && t.state !== 'interrupted') throw new CoreError(409, `Task ${id} is ${t.state}: nothing to retry.`)
  Object.assign(t, { state: 'waiting', error: undefined, detail: undefined, held_reason: undefined, job_id: undefined, phase: undefined, pod_id: null, pod_name: null, finished_at: undefined })
  // retrying a pull also puts back the runs that failed only because it did not finish
  if (t.kind === 'pull') for (const r of state().tasks) if (r.import_id === t.import_id && r.kind === 'run' && r.state === 'failed' && (!!r.error?.startsWith(NOT_STARTED) || r.error === 'Its pull did not finish.')) Object.assign(r, { state: 'waiting', error: undefined, finished_at: undefined, events: [...(r.events ?? []), { at: deps.now().toISOString(), text: 'its pull was retried: waiting for it again' }] })
  const imp = state().imports.find((i) => i.id === t.import_id)!; imp.state = 'active'
  save(); start(); return t
}

let timer: ReturnType<typeof setInterval> | null = null
/** Run the scheduler every few seconds while this process is up (idempotent). */
export function start(everyMs = 3000) { if (!timer) { timer = setInterval(() => { void timedTick('queue.tick', () => tick()) }, everyMs); if (typeof timer === 'object' && 'unref' in timer) timer.unref() } }
export function stop() { if (timer) { clearInterval(timer); timer = null } }
