/**
 * The round-import queue (ADR-038): importing a round makes a `pull` task (which also places the round, ADR-033) and one `run` task per shot (ADR-037); pool pods take the tasks.
 * State lives in ~/.config/runpod-pod-manager/queue.json so it survives a restart; a task that was running then is `interrupted` (Retry runs it again). The scheduler is `tick`,
 * run on a timer while the app (or MCP server) is up. Every outside effect goes through `Deps`, so the tests run it with fakes and no pod.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CoreError } from './errors.js'
import * as gpus from './gpus.js'
import * as history from './history.js'
import * as mounts from './mounts.js'
import { queueFile } from './paths.js'
import * as panama from './panama.js'
import * as podpull from './podpull.js'
import * as podrounds from './podrounds.js'
import * as pods from './pods.js'
import * as rp from './runpod.js'
import * as runflows from './runflows.js'
import * as volumes from './volumes.js'

export type TaskKind = 'pull' | 'run'
export type TaskState = 'waiting' | 'running' | 'done' | 'failed' | 'held' | 'cancelled' | 'interrupted'
export interface Task {
  id: string; import_id: string; round: string; shot: string | null; kind: TaskKind; state: TaskState
  depends_on: string[]; pod_id: string | null; pod_name: string | null
  /** `pod` while a run task waits for its pod to come up; `job` once the pull or run job exists. */
  phase?: 'pod' | 'job'; job_id?: string; graphs?: string[]
  /** The card chosen for this shot: its run gets a pod of its own with that card (no pool pod is reused). Absent = the pool, else the default card. */
  gpu?: string; price?: number | null
  /** What happened to this task and when: pod chosen / created / resumed, pod ready, job stages, results. The Queue shows it. */
  events?: { at: string; text: string }[]
  /** The live stage of the pull job or the run (`pulling`, `placing`, `running 3/12 graphs`...). */
  stage?: string
  /** The card of the pod this task actually runs on, when the queue created it (the chosen card, else the pool's default): shown in the Queue for every task. */
  card?: string
  /** A pod could not be had because RunPod had no card free: the run waits and asks again (not before `retry_at`), up to MAX_CARD_WAITS times. */
  retry_at?: string; attempts?: number
  started_at?: string; finished_at?: string; error?: string; detail?: string; held_reason?: string
}
export interface ImportRec {
  id: string; round: string; approved_by: string; created_at: string; state: 'active' | 'done' | 'cancelled'
  max_pods: number | null; cost_cap_usd: number | null; cap_enabled: boolean
  est_total_usd: number | null; spent_usd: number
  /** Pods this import started or created: stopped when the import has no more tasks for them. A pod that was already running is never in here. */
  started_pods: string[]
  price_per_hour: number | null
}
interface QueueFile { version: 1; imports: ImportRec[]; tasks: Task[] }

export interface VolPod { id: string; name: string; state: 'running' | 'starting' | 'off'; price: number | null }
export interface Deps {
  shotsOf: (round: string) => Promise<string[]>
  volumePods: () => Promise<VolPod[]>
  podReady: (id: string) => Promise<{ ready: boolean; price: number | null }>
  resumePod: (id: string) => Promise<void>
  createPod: (name: string, round: string, gpu?: string) => Promise<{ id: string; name: string }>
  cardPrice: (gpu: string) => Promise<number | null>
  /** Put the pod in the round and name the shot it works on, so the pod card says so (ADR-039). */
  assignShot: (podId: string, round: string, shot: string) => void
  /** Make sure the volume the pods and the pull use exists; `id` (when given) becomes the Default Configuration's volume first. */
  ensureVolume: (id?: string) => Promise<void>
  stopPod: (id: string) => Promise<void>
  planPull: (round: string) => Promise<{ price_per_hour: number | null; ceiling_minutes: number; bytes: number }>
  pull: (round: string) => Promise<{ id: string }>
  pullJob: (id: string) => ReturnType<typeof podpull.job>
  cancelPull: (id: string) => void
  run: (podId: string, paths: string[]) => Promise<{ id: string }>
  runJob: (id: string) => runflows.RunJob | null
  cancelRun: (id: string) => void
  now: () => Date
}

/** The card the pool is made of when the queue has to create a pod. */
export const POOL_GPU = 'h100'
/** A run's duration is unknown: this many hours per shot go into the estimate. */
export const RUN_ESTIMATE_H = 0.5

const realDeps: Deps = {
  shotsOf: async (round) => [...new Set((await panama.filesAsync(round)).entries.filter((e) => e.dir && !e.path.includes('/')).map((e) => e.path))].sort(),
  volumePods: async () => {
    const vol = (mounts.load().network_volume_id || '').trim()
    return (await rp.listPods()).filter((p) => (p.networkVolumeId || '') === vol && !(p.name || '').startsWith(podpull.POD_PREFIX)).map((p) => ({
      id: p.id, name: p.name || p.id, price: p.costPerHr ?? null,
      state: p.desiredStatus === 'EXITED' ? 'off' : (p.runtime?.uptimeInSeconds ?? 0) > 0 ? 'running' : 'starting',
    }) as VolPod)
  },
  podReady: async (id) => { const p = await pods.get(id); const raw = await rp.getPod(id); return { ready: p.status === 'running' && !!p.web_ui_url && p.comfy_ready !== false, price: raw?.costPerHr ?? null } },
  resumePod: async (id) => { await pods.resume(id) },
  createPod: async (name, round, gpu) => { const p = await pods.create({ name, gpu: gpu || POOL_GPU, apply_mounts: true, round }); return { id: p.id, name: p.name } },
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
  planPull: async (round) => { const p = await podpull.plan(round); return { price_per_hour: p.price_per_hour, ceiling_minutes: p.ceiling_minutes, bytes: p.bytes } },
  pull: async (round) => podpull.pull(round),
  pullJob: (id) => podpull.job(id),
  cancelPull: (id) => { try { podpull.cancel(id) } catch { /* already over */ } },
  run: async (podId, paths) => runflows.run(podId, paths),
  runJob: (id) => runflows.job(id),
  cancelRun: (id) => { try { runflows.cancel(id) } catch { /* already over */ } },
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
  return { imports, tasks: q.tasks, active: q.tasks.filter((t) => t.state === 'waiting' || t.state === 'running' || t.state === 'held').length }
}

// ----- planning and importing -----
export interface ImportPlan {
  round: string; shots: string[]; price_per_hour: number | null; pull_hours: number; est_total_usd: number | null
  max_pods: number | null; cost_cap_usd: number | null; cap_enabled: boolean; over_cap: boolean
}
export interface ImportOpts { /** the network volume the pods and the pull use; it becomes the default volume */ volume_id?: string; /** shot -> card (a GPU key); a shot without one takes the pool */ cards?: Record<string, string>; shots?: string[]; run_workflows?: boolean; max_pods?: number; cost_cap_usd?: number; approved_by?: string }

/** The price per hour of the card chosen for each shot that has one (a card we cannot price is left out: the pull's price stands in). */
async function cardPrices(shots: string[], o: ImportOpts): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {}, seen: Record<string, number | null> = {}
  for (const s of shots) { const g = o.cards?.[s]; if (!g) continue; if (!(g in seen)) seen[g] = await deps.cardPrice(g).catch(() => null); out[s] = seen[g] }
  return out
}
/** What importing the round would do and cost, before it does anything. */
export async function planImport(round: string, o: ImportOpts = {}): Promise<ImportPlan> {
  for (const [shot, card] of Object.entries(o.cards ?? {})) if (card && card !== gpus.AUTO && !gpus.GPUS[card]) throw new CoreError(400, `Unknown card "${card}" for ${shot}: use a key from list_gpus.`)
  const cfg = mounts.load()
  const all = await deps.shotsOf(round)
  const shots = o.shots?.length ? all.filter((s) => o.shots!.includes(s)) : all
  const p = await deps.planPull(round)
  const pullH = p.ceiling_minutes / 60
  const prices = await cardPrices(shots, o)
  const runCost = o.run_workflows === false ? 0 : shots.reduce((a, s) => a + (prices[s] ?? p.price_per_hour ?? 0) * RUN_ESTIMATE_H, 0)
  const est = p.price_per_hour == null ? null : Math.round((p.price_per_hour * pullH + runCost) * 100) / 100
  const capOn = cfg.import_cap_enabled
  const max = capOn ? (o.max_pods ?? cfg.import_max_pods) : (o.max_pods ?? null)
  const cap = capOn ? (o.cost_cap_usd ?? cfg.import_cost_cap_usd) : null
  return { round, shots, price_per_hour: p.price_per_hour, pull_hours: Math.round(pullH * 100) / 100, est_total_usd: est, max_pods: max, cost_cap_usd: cap, cap_enabled: capOn, over_cap: cap != null && est != null && est > cap }
}

let seq = 0
const newId = (p: string) => `${p}-${deps.now().getTime().toString(36)}-${(seq++).toString(36)}`

/** Queue the import: one pull, one run per shot. `approved_by` is the one approval for everything it starts. */
export async function importRound(round: string, o: ImportOpts = {}): Promise<ImportRec> {
  const by = (o.approved_by || '').trim()
  if (!by) throw new CoreError(400, 'An import spends money on pods: say who approves it (approved_by).')
  await deps.ensureVolume(o.volume_id)   // before any pod is created: a missing volume fails here, loudly, not in each pull
  const plan = await planImport(round, o)
  if (!plan.shots.length) throw new CoreError(404, `No shots found in ${round}.`)
  const q = state()
  if (q.imports.some((i) => i.round === round && i.state === 'active')) throw new CoreError(409, `${round} is already being imported: see the queue.`)
  const imp: ImportRec = { id: newId('imp'), round, approved_by: by, created_at: deps.now().toISOString(), state: 'active', max_pods: plan.max_pods, cost_cap_usd: plan.cost_cap_usd, cap_enabled: plan.cap_enabled, est_total_usd: plan.est_total_usd, spent_usd: 0, started_pods: [], price_per_hour: plan.price_per_hour }
  const pull: Task = { id: newId('t'), import_id: imp.id, round, shot: null, kind: 'pull', state: 'waiting', depends_on: [], pod_id: null, pod_name: null }
  q.imports.push(imp); q.tasks.push(pull)
  const prices = await cardPrices(plan.shots, o)
  if (o.run_workflows !== false) for (const shot of plan.shots) q.tasks.push({ id: newId('t'), import_id: imp.id, round, shot, kind: 'run', state: 'waiting', depends_on: [pull.id], pod_id: null, pod_name: null, ...(o.cards?.[shot] ? { gpu: o.cards[shot], price: prices[shot] ?? null } : {}) })
  save(); start()
  return imp
}

export interface RoundItem { round: string; shots?: string[]; cards?: Record<string, string>; max_pods?: number }
/** Several rounds on one approval (the window's and MCP's one path): each round is its own import; `cost_cap_usd` is the TOTAL and is split evenly, so the caps never add up to more.
 *  Every round is planned first, so a bad round or card queues nothing; `max_pods` (per round) may be set per item. */
export async function importRounds(items: RoundItem[], o: Omit<ImportOpts, 'shots' | 'cards'> = {}): Promise<ImportRec[]> {
  if (!Array.isArray(items) || !items.length) throw new CoreError(400, 'Which rounds? Give at least one.')
  if (!(o.approved_by || '').trim()) throw new CoreError(400, 'An import spends money on pods: say who approves it (approved_by).')
  const names = items.map((i) => i.round)
  if (new Set(names).size !== names.length) throw new CoreError(400, 'A round is listed twice.')
  await deps.ensureVolume(o.volume_id)
  o = { ...o, volume_id: undefined }   // done once for all the rounds
  const each = o.cost_cap_usd != null ? Math.round((o.cost_cap_usd / items.length) * 100) / 100 : undefined
  const opts = (i: RoundItem): ImportOpts => ({ ...o, shots: i.shots, cards: i.cards, ...(each != null ? { cost_cap_usd: each } : {}), ...(i.max_pods != null ? { max_pods: i.max_pods } : {}) })
  for (const i of items) { const p = await planImport(i.round, opts(i)); if (!p.shots.length) throw new CoreError(404, `No shots found in ${i.round}.`); if (state().imports.some((x) => x.round === i.round && x.state === 'active')) throw new CoreError(409, `${i.round} is already being imported: see the queue.`) }
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
const finish = (t: Task, imp: ImportRec, s: 'done' | 'failed' | 'cancelled', error?: string) => { ev(t, error ? `${s}: ${error}` : s); t.stage = undefined; t.state = s; t.finished_at = deps.now().toISOString(); if (error) t.error = error; logTask(t, imp) }

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
      // 3. nothing left: the import is over; stop the pods it started
      if (!tasks.some(live)) {
        imp.state = tasks.every((t) => t.state === 'cancelled') ? 'cancelled' : 'done'
        for (const id of imp.started_pods) { try { await deps.stopPod(id) } catch (e) { history.record({ kind: 'job', job: 'queue', state: 'failed', what: `${imp.round} stop pod ${id}`, pod_id: id, error: (e as Error).message }) } }
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
    if (j.pod_name && t.pod_name !== j.pod_name) { ev(t, `pod ${j.pod_name} (${j.pod_id})`); changed = true }
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
    try { t.job_id = (await deps.pull(t.round)).id; t.state = 'running'; t.started_at = deps.now().toISOString(); t.phase = 'job'; ev(t, `pull of ${t.round} started (a short-lived pod of the cheapest free card, or a pod of yours)`) } catch (e) { finish(t, imp, 'failed', (e as Error).message) }
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
    const pick = t.gpu ? undefined : pool.find((p) => p.state === 'running') ?? pool.find((p) => p.state === 'starting') ?? pool.find((p) => p.state === 'off')
    let podId: string, podName: string
    if (pick) {
      podId = pick.id; podName = pick.name
      if (pick.state === 'off') { await deps.resumePod(pick.id); imp.started_pods.push(pick.id); ev(t, `restarted your stopped pod ${pick.name}`) } else ev(t, `reusing the pod ${pick.name} (${pick.state})`)
    } else {
      const c = await deps.createPod(`queue-${imp.round}-${tasks.filter((x) => x.pod_id).length + 1}`.slice(0, 60), imp.round, t.gpu); podId = c.id; podName = c.name; t.card = t.gpu || POOL_GPU; imp.started_pods.push(c.id); ev(t, `created pod ${c.name} (${t.gpu || POOL_GPU}) in round ${imp.round}`)
    }
    if (t.shot) { try { deps.assignShot(podId, imp.round, t.shot); ev(t, `pod card: round ${imp.round}, shot ${t.shot}`) } catch { /* the card label is ours only: never fail a run over it */ } }
    t.pod_id = podId; t.pod_name = podName; t.phase = 'pod'; t.state = 'running'; t.retry_at = undefined; t.attempts = undefined; t.stage = undefined; t.started_at = deps.now().toISOString(); delete t.held_reason
  } catch (e) {
    const msg = (e as Error).message
    if (/No card available/.test(msg) && (t.attempts ?? 0) < MAX_CARD_WAITS) {   // RunPod has none free right now: wait and ask again, as the datacenter table says "if we have to wait we have to wait"
      t.attempts = (t.attempts ?? 0) + 1; t.retry_at = new Date(deps.now().getTime() + CARD_RETRY_MS).toISOString()
      t.stage = `waiting for a free ${t.gpu || POOL_GPU} (try ${t.attempts} of ${MAX_CARD_WAITS}, next at ${t.retry_at.slice(11, 19)} UTC)`
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
export function start(everyMs = 3000) { if (!timer) { timer = setInterval(() => { void tick() }, everyMs); if (typeof timer === 'object' && 'unref' in timer) timer.unref() } }
export function stop() { if (timer) { clearInterval(timer); timer = null } }
