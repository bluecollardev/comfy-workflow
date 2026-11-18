/**
 * Retry later (ADR-042 section 19). RunPod has no free GPU: a stopped pod cannot be resumed (it is pinned to its host) or a new pod cannot be created
 * (`no_card`). Instead of failing, the person (or an MCP client) can ask to keep trying: a watch retries the SAME resume or the SAME create request every
 * `every_s` (default 120, at least 60) until a card is free, up to `give_up_h` hours (default 12). It is kept in ~/.config/runpod-pod-manager/pod-watches.json,
 * so it survives a restart. Retrying spends exactly what a normal resume or create does.
 *
 * Rules that keep it safe:
 *  - Only "no free GPU" keeps a watch waiting. Any other answer (404, a rejected key, a bad request) stops it and says why.
 *  - RunPod's request limit (429) is not hammered: the watch waits for the core's own retry time.
 *  - A create never makes a second pod. The watch writes `creating` BEFORE it asks RunPod, and clears it only on a definite "no card". If the answer
 *    is lost (a dropped connection, a restart mid-call) the marker stays, and the next tick looks for a pod with that name first and adopts it.
 *  - Two processes (the app and an MCP server) may both tick: a watch carries a short claim (pid and time) and the other one waits it out.
 * Every effect goes through `Deps`, so the tests run it with fakes and no pod.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import { podWatchesFile } from './paths.js'
import * as ratelimit from './ratelimit.js'

export type WatchKind = 'resume' | 'create'
export type WatchState = 'waiting' | 'done' | 'stopped' | 'cancelled' | 'expired'
export interface Watch {
  id: string; kind: WatchKind; state: WatchState
  /** The pod to resume; for a create, the pod that was made once it is done. */
  pod_id?: string
  /** The pod's name (a create's request name). */
  name: string
  /** For the person: "Waiting for a free A100 SXM in EU-RO-1" */
  label: string
  /** A create watch keeps its request, to send again as it was. */
  request?: Record<string, unknown>
  /** A create made like another pod (the Retry Later choice 'Another GPU'): the pod it was made from, so that pod's card can show the wait. That pod is never touched. */
  from_pod_id?: string
  /** A create with more than one card to choose from (Retry Later > Another GPU, several chosen): the card keys in the order the person chose them. Each try asks them in that order and the first that has a card free is used; ONE pod is made. */
  gpus?: string[]
  every_s: number; give_up_at: string; created_at: string; next_at: string; attempts: number
  last_error?: string
  /** Set before a create is asked of RunPod, cleared on a definite "no card": while it is set the answer to the last ask is unknown. */
  creating?: string
  claim?: { pid: number; at: string }
  finished_at?: string; detail?: string
}

export interface Deps {
  resume(podId: string, note: string): Promise<unknown>
  create(req: Record<string, unknown>, note: string): Promise<{ id: string }>
  /** The id of a pod with this exact name that is not terminated, else null. */
  findByName(name: string): Promise<string | null>
}
let deps: Deps | null = null
/** pods.ts gives the real calls; a test gives fakes. */
export const setDeps = (d: Deps | null) => { deps = d }
let nowFn: () => number = () => Date.now()
export const setClock = (f: (() => number) | null) => { nowFn = f ?? (() => Date.now()) }

export const MIN_EVERY_S = 60, DEFAULT_EVERY_S = 120, DEFAULT_GIVE_UP_H = 12, MAX_GIVE_UP_H = 72
const CLAIM_STALE_MS = 5 * 60_000, KEEP_FINISHED = 20, KEEP_FINISHED_MS = 24 * 3600_000

// ----- the file -----

function load(): Watch[] {
  const file = podWatchesFile()
  try {
    if (!existsSync(file)) return []
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw?.watches) ? raw.watches : []
  } catch { return [] }
}
function save(watches: Watch[]): void {
  const file = podWatchesFile()
  mkdirSync(dirname(file), { recursive: true })
  const now = nowFn()
  const keep = watches.filter((w) => w.state === 'waiting' || !w.finished_at || now - Date.parse(w.finished_at) < KEEP_FINISHED_MS)
  const finished = keep.filter((w) => w.state !== 'waiting').sort((a, b) => Date.parse(b.finished_at || '') - Date.parse(a.finished_at || '')).slice(KEEP_FINISHED)
  const out = keep.filter((w) => !finished.includes(w))
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ watches: out }, null, 1), { mode: 0o600 })
  renameSync(tmp, file)
}

// ----- registering -----

export interface WatchOpts { every_s?: number; give_up_h?: number; from_pod_id?: string; gpus?: string[] }
function limits(o: WatchOpts): { every_s: number; give_up_h: number } {
  const every_s = o.every_s ?? DEFAULT_EVERY_S, give_up_h = o.give_up_h ?? DEFAULT_GIVE_UP_H
  if (!Number.isFinite(every_s) || every_s < MIN_EVERY_S) throw bad(`Try again no more often than every ${MIN_EVERY_S} seconds (every_s is ${every_s})`)
  if (!Number.isFinite(give_up_h) || give_up_h <= 0 || give_up_h > MAX_GIVE_UP_H) throw bad(`give_up_h is more than 0 and at most ${MAX_GIVE_UP_H} hours`)
  return { every_s: Math.round(every_s), give_up_h }
}
const iso = (ms: number) => new Date(ms).toISOString()
const newId = () => `watch-${nowFn().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

function add(w: Omit<Watch, 'id' | 'state' | 'created_at' | 'next_at' | 'give_up_at' | 'attempts' | 'every_s'>, o: WatchOpts): Watch {
  const { every_s, give_up_h } = limits(o)
  const now = nowFn()
  const watches = load()
  const twin = watches.find((x) => x.state === 'waiting' && x.kind === w.kind && (w.kind === 'resume' ? x.pod_id === w.pod_id : x.name === w.name))
  if (twin) throw new CoreError(409, w.kind === 'resume' ? `Pod ${w.pod_id} is already waiting for a free GPU (${twin.id}): cancel that watch first to change it.` : `A pod named "${w.name}" is already waiting to be created (${twin.id}): cancel that watch first to change it.`)
  const watch: Watch = { ...w, id: newId(), state: 'waiting', every_s, created_at: iso(now), next_at: iso(now + every_s * 1000), give_up_at: iso(now + give_up_h * 3600_000), attempts: 0 }
  save([...watches, watch])
  start()
  return watch
}
export const watchResume = (podId: string, name: string, label: string, o: WatchOpts = {}): Watch => {
  if (!podId) throw bad('Which pod?')
  return add({ kind: 'resume', pod_id: podId, name: name || podId, label }, o)
}
export const watchCreate = (request: Record<string, unknown>, label: string, o: WatchOpts = {}): Watch => {
  const name = String(request?.name ?? '').trim()
  if (!name) throw bad('A pod needs a name')
  const from = typeof o.from_pod_id === 'string' && o.from_pod_id ? o.from_pod_id : ''
  // Two waits for different cards from the same pod would each make a pod when a card frees: one at a time, cancel the first to change it.
  const other = from ? load().find((x) => x.state === 'waiting' && x.kind === 'create' && x.from_pod_id === from) : undefined
  if (other) throw new CoreError(409, `Already waiting to make a pod like ${from} (${other.label}, ${other.id}): cancel that watch first to choose another GPU.`)
  const gpus = Array.isArray(o.gpus) ? [...new Set(o.gpus.map((g) => String(g).trim()).filter(Boolean))] : []
  return add({ kind: 'create', name, label, request, ...(from ? { from_pod_id: from } : {}), ...(gpus.length > 1 ? { gpus } : {}) }, o)
}

export const list = (): Watch[] => load()
/** The waits that belong to a pod's card (the window's rule, kept here so the MCP says the same): a resume watch for it, and the creates made like it by `from_pod_id`, or, for one saved before that was kept, by the name it carries (`<pod name>-<card>`). */
export const watchesFor = (podId: string, podName = '', ws: Watch[] = load()): Watch[] =>
  ws.filter((w) => (w.kind === 'resume' && w.pod_id === podId) || (w.kind === 'create' && (w.from_pod_id ? w.from_pod_id === podId : !!podName && String(w.name || '').startsWith(`${podName}-`))))
export const waiting = (): Watch[] => load().filter((w) => w.state === 'waiting')
export function cancel(id: string): Watch {
  const watches = load(), w = watches.find((x) => x.id === id || (x.state === 'waiting' && x.pod_id === id))
  if (!w) throw new CoreError(404, `No such watch: ${id}`)
  if (w.state === 'waiting') {
    w.state = 'cancelled'; w.finished_at = iso(nowFn()); w.claim = undefined
    // A create whose last answer is unknown may already have made the pod: say so instead of hiding it.
    if (w.kind === 'create' && w.creating) w.detail = 'Cancelled while a create was in flight: check the pod list for a pod with this name.'
    save(watches)
    note(w, 'cancelled', 'cancelled by the person')
  }
  return w
}

// ----- ticking -----

const minutes = (w: Watch) => Math.max(1, Math.round((nowFn() - Date.parse(w.created_at)) / 60_000))
function note(w: Watch, action: string, detail: string): void {
  history.record({ kind: 'change', area: 'pod', action: `watch ${w.kind} ${action}`, what: w.name, detail })
}
const finish = (w: Watch, state: Exclude<WatchState, 'waiting'>, detail?: string) => { w.state = state; w.finished_at = iso(nowFn()); w.claim = undefined; w.creating = undefined; if (detail) w.detail = detail }

const isHostFull = (e: unknown) => (e as { code?: string })?.code === 'host_full'
const isNoCard = (e: unknown) => (e as { code?: string })?.code === 'no_card'
const isLimit = (e: unknown) => (e as { status?: number })?.status === 429
/** Not an answer from RunPod at all: a dropped connection, a timeout. The watch goes on, and a create stays "unknown". */
const isTransient = (e: unknown) => !(e instanceof CoreError)

let ticking = false
/** Do whatever is due. Never throws. Returns how many watches it acted on. */
export async function tick(): Promise<number> {
  if (ticking || !deps) return 0
  ticking = true
  let acted = 0
  try {
    for (const seen of load().filter((w) => w.state === 'waiting')) {
      const now = nowFn()
      if (Date.parse(seen.next_at) > now) continue
      if (seen.claim && seen.claim.pid !== process.pid && now - Date.parse(seen.claim.at) < CLAIM_STALE_MS) continue
      // work on the file's current copy of the watch, not the one the list started with
      const watches = load(), w = watches.find((x) => x.id === seen.id)
      if (!w || w.state !== 'waiting') continue
      if (now >= Date.parse(w.give_up_at)) {
        finish(w, 'expired', `Gave up after ${Math.round((now - Date.parse(w.created_at)) / 3600_000 * 10) / 10} h without a free GPU.`)
        save(watches); note(w, 'gave up', w.detail || ''); acted++; continue
      }
      if (ratelimit.isLimited()) {   // RunPod is limiting requests: wait for the core's own retry time, do not add to it
        const at = ratelimit.status().retry_at
        w.next_at = at && Date.parse(at) > now ? at : iso(now + w.every_s * 1000)
        w.last_error = 'RunPod is limiting requests; waiting for the limit to lift.'
        save(watches); continue
      }
      w.claim = { pid: process.pid, at: iso(now) }
      acted++
      try {
        if (w.kind === 'resume') await attemptResume(w, watches)
        else await attemptCreate(w, watches)
      } catch (e) {
        // an unexpected failure of the watch itself: stop it with the reason, never loop on it
        finish(w, 'stopped', `The watch failed: ${(e as Error).message}`); w.last_error = w.detail
        save(watches); note(w, 'stopped', w.detail || '')
      }
    }
  } catch (e) { console.error(`pod watch tick failed: ${(e as Error).message}`) } finally { ticking = false }
  return acted
}

async function attemptResume(w: Watch, watches: Watch[]): Promise<void> {
  w.attempts++
  save(watches)
  try {
    await deps!.resume(w.pod_id!, `pod resumed after waiting ${minutes(w)} min`)
    finish(w, 'done', `Resumed after waiting ${minutes(w)} min (${w.attempts} tries).`); w.last_error = undefined
    save(watches); note(w, 'done', w.detail || '')
  } catch (e) {
    const msg = (e as Error).message
    if (isHostFull(e) || isLimit(e) || isTransient(e)) {
      w.last_error = msg; w.next_at = iso(nowFn() + w.every_s * 1000); w.claim = undefined
      save(watches)
    } else {
      finish(w, 'stopped', `Stopped: ${msg}`); w.last_error = msg
      save(watches); note(w, 'stopped', msg)
    }
  }
}

async function attemptCreate(w: Watch, watches: Watch[]): Promise<void> {
  // An earlier ask whose answer was lost: the pod may exist. Look by name before asking again (this is what makes a restart safe).
  if (w.creating) {
    const found = await deps!.findByName(w.name).catch(() => undefined)
    if (found === undefined) { w.next_at = iso(nowFn() + w.every_s * 1000); w.claim = undefined; save(watches); return }   // cannot tell: do not risk a second pod
    if (found) {
      finish(w, 'done', `Created after waiting ${minutes(w)} min (found by name after an unanswered try).`); w.pod_id = found
      save(watches); note(w, 'done', w.detail || ''); return
    }
    w.creating = undefined
  }
  w.attempts++
  w.creating = iso(nowFn())
  save(watches)   // the marker is on disk BEFORE RunPod is asked
  // With several cards chosen they are asked in the person's order and the first that has one free is used. Every card asks for the SAME pod name, so an answer that is lost is
  // found by name next time and is never followed by a second pod on another card: one pod, whichever card it ends up on.
  const cards: (string | undefined)[] = w.gpus && w.gpus.length > 1 ? w.gpus : [undefined]
  const refused: string[] = []
  for (const card of cards) {
    const req = card ? { ...w.request!, gpu: card } : w.request!
    try {
      const pod = await deps!.create(req, `pod created after waiting ${minutes(w)} min${card ? ` on ${card}` : ''}`)
      w.pod_id = pod.id
      finish(w, 'done', `Created after waiting ${minutes(w)} min (${w.attempts} tries${card ? `, on ${card}` : ''}).`); w.last_error = undefined
      save(watches); note(w, 'done', w.detail || ''); return
    } catch (e) {
      const msg = (e as Error).message
      if (isNoCard(e)) { refused.push(card ? `${card}: ${msg}` : msg); continue }   // a definite "nothing was made": the next card
      if (isLimit(e)) {   // nothing was made, and RunPod asks us to slow down: the rest wait for the next time
        w.creating = undefined; w.last_error = msg; w.next_at = iso(nowFn() + w.every_s * 1000); w.claim = undefined
        save(watches); return
      }
      if (isTransient(e)) {   // unknown: keep the marker, look by name next time, and do not ask another card meanwhile
        w.last_error = msg; w.next_at = iso(nowFn() + w.every_s * 1000); w.claim = undefined
        save(watches); return
      }
      finish(w, 'stopped', `Stopped: ${msg}`); w.last_error = msg
      save(watches); note(w, 'stopped', msg); return
    }
  }
  // every card said there is none free: nothing was made
  w.creating = undefined; w.last_error = refused.join(' | '); w.next_at = iso(nowFn() + w.every_s * 1000); w.claim = undefined
  save(watches)
}

// ----- the timer -----

let timer: ReturnType<typeof setInterval> | null = null
/** Look for due watches every 15 s while this process is up (idempotent). The app and an MCP server may both run it: a claim keeps them apart. */
export function start(everyMs = 15_000): void {
  if (timer) return
  timer = setInterval(() => { void tick() }, everyMs)
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
}
export function stop(): void { if (timer) { clearInterval(timer); timer = null } }
