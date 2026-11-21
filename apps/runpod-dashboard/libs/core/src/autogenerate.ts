/**
 * Auto-generate (docs/ADR-050, "Auto-publish can generate the outputs too"): the step before Auto-publish. A NEW, FINISHED DPX sequence (its frames
 * appeared after the option was switched on, and have not changed for settle_minutes) is rendered into a review or the Tunnel proxy with the same
 * renders.start the Generate window uses. It never approves and never publishes; `where: 'pod'` only uses a pod that is already running (it never
 * creates, resumes or recreates one) and renders one at a time. Everything here is async.
 */
import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { CoreError } from './errors.js'
import * as edl from './edl.js'
import * as history from './history.js'
import * as tunnelj from './tunnel.js'
import type * as mounts from './mounts.js'
import { configDir } from './paths.js'
import * as publish from './publish.js'

export const RETRIES = 2, MAX_CANDIDATES = 200, MAX_ENTRIES = 50_000
/** A render refused because nobody has stated the colour of the frames (policy/colour.md): shown, not retried. */
const NOT_DISPLAY = [1, 2, 3, 11, 12, 13]   // printing density, linear, log...: not display-referred (renders.NOT_DISPLAY)
const INCOMPLETE = /^Incomplete|are missing \(\d+ gaps?\)/
export const BACKOFF_MIN = [5, 20]   // a real failure is retried after 5 minutes, then after 20, then it is listed
const NEEDS_COLOUR = /State the colour of these frames|Colour not set/
export const NOT_IN_EDL_REASON = 'not in the EDL', NOT_IN_EDL_CODE = 'not-in-edl', NO_EDL_REASON = 'no EDL loaded', NO_EDL_CODE = 'no-edl'
export const COLOUR_SKIP = 'colour not stated: set it in Auto-publish > Generate'
export const ALL_DONE = 'Everything in this scope is already rendered'
const DPX_FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i, SHOT = /^[A-Za-z]+-\d+/
const SKIP_DIRS = new Set(['deliver', '.proxies', 'models'])

export interface Candidate { key: string; dir: string; stem: string; shot: string; count: number; first: number; last: number; pad: number; oldest: number; newest: number; weights: boolean; /** how many runs of missing frame numbers lie between first and last */ gaps: number }
export interface Deps {
  now(): number
  outputRoot(): string | null
  /** the id of a pod that is already running, or null (never creates, resumes or recreates one) */
  runningPod(): Promise<string | null>
  /** the volume's output files grouped by folder (Auto-publish's volume source), or null when it cannot be listed */
  volumeListing(): Promise<{ folder: string; files: { filename: string; modified?: string }[] }[] | null>
  /** the DPX header's transfer code of the first frame (SMPTE 268M), or null when it cannot be read cheaply */
  transferOf(c: { dir: string; stem: string; first: number; pad: number }, source: 'local' | 'volume'): Promise<number | null>
  start(req: Record<string, unknown>): Promise<{ job_id: string }>
  status(jobId: string): { state: string; error?: string; sequences?: { state: string; reason?: string }[] } | undefined
  cancel(jobId: string): void
}
let R: typeof import('./renders.js') | null = null
const defaults = (): Deps => ({
  now: () => Date.now(),
  outputRoot: () => publish.localOutputRoot(),
  runningPod: async () => { try { const p = await import('./pods.js'); const d = await p.dashboard(); return (d.pods as { id: string; status: string }[]).find((x) => x.status === 'running')?.id ?? null } catch { return null } },
  volumeListing: async () => { try { const [o, m] = await Promise.all([import('./outputsources.js'), import('./mounts.js')]); const c = m.load(), id = (c.shared_volume_id || c.network_volume_id || '').trim(); if (!id) return null; return (await o.listAll(id, {})).runs.map((r) => ({ folder: r.folder ?? '', files: r.files.map((f) => ({ filename: f.filename, ...(f.modified ? { modified: f.modified } : {}) })) })) } catch { return null } },
  transferOf: async (c, source) => {
    try {
      const name = `${c.stem}.${String(c.first).padStart(c.pad, '0')}.dpx`; let head: Uint8Array | null = null
      if (source === 'local') { const root = publish.localOutputRoot(); if (!root) return null; const fh = await open(join(root, c.dir, name), 'r'); try { const b = Buffer.alloc(2048); const { bytesRead } = await fh.read(b, 0, 2048, 0); head = b.subarray(0, bytesRead) } finally { await fh.close() } }
      else {
        const [p, m] = await Promise.all([import('./podpull.js'), import('./mounts.js')]), cf = m.load(), id = (cf.shared_volume_id || cf.network_volume_id || '').trim(); if (!id) return null
        const a = await p.s3ReadAccess(id); if (!a.ok) return null
        const tmp = join(tmpdir(), `dpxhead-${process.pid}-${Date.now().toString(36)}`)
        try { const r = await p.defaultAws(['s3api', 'get-object', '--bucket', a.bucket, '--key', `${publish.VOLUME_OUTPUT}${c.dir ? `${c.dir}/` : ''}${name}`, '--range', 'bytes=0-2047', tmp, '--endpoint-url', a.endpoint, '--region', a.region], { AWS_ACCESS_KEY_ID: a.id, AWS_SECRET_ACCESS_KEY: a.secret }, { stallMs: 20_000 }); if (r.code !== 0) return null; head = new Uint8Array(await readFile(tmp)) } finally { await rm(tmp, { force: true }).catch(() => undefined) }
      }
      R ??= await import('./renders.js'); return head ? R.parseDpxInfo(head)?.transfer ?? null : null
    } catch { return null }
  },
  start: async (req) => { R ??= await import('./renders.js'); return R.start(req as never) },
  status: (id) => R?.status(id).jobs[0],
  cancel: (id) => { R?.cancel(id) },
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }

const stateFile = () => join(configDir(), 'autogenerate-state.json')
interface GState { day?: string; count?: number; /** the renders started today: key, when and the job (the Queue's Auto-publish section lists them) */ started?: { key: string; at: string; job_id: string }[]; /** sequence keys left over from a Generate-for-what-is-there run (the daily allowance carries them on) */ pending?: string[]; existing_started?: number; /** settle tracking, kept across passes and restarts: `<source>:<dir>/<stem>` -> what was last seen and since when */ seen?: Record<string, { sig: string; since: number; looks: number }>; /** sequences whose frames have gaps: not started again until the frame count or newest time changes (and settles) */ incomplete?: Record<string, { sig: string; reason: string }> }
async function readState(): Promise<GState> { try { return JSON.parse(await readFile(stateFile(), 'utf8')) } catch { return {} } }
async function writeState(v: unknown): Promise<void> { await mkdir(dirname(stateFile()), { recursive: true }); const tmp = `${stateFile()}.${process.pid}.tmp`; await writeFile(tmp, JSON.stringify(v), { mode: 0o600 }); await rename(tmp, stateFile()) }
const localDay = (ms: number): string => { const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

interface Seen { sig: string; changedAt: number; looks: number }
let hydrated = false
const seen = new Map<string, Seen>(), incompleteList = new Map<string, { sig: string; reason: string }>(), retryAt = new Map<string, number>(), active = new Map<string, { job_id: string; started: number; sig?: string }>(), attempts = new Map<string, number>(), done = new Set<string>(), failedList = new Map<string, string>(), skippedList = new Map<string, { reason: string; code: string }>()
let generatedToday = 0, lastDay = '', pendingExisting = 0, existingStarted = 0
let startedList: { key: string; at: string; job_id: string }[] = []   // the renders started today (kept in the state file, reset with the day)
const noteStarted = (key: string, job_id: string, at: number): void => { startedList = [...startedList.filter((x) => x.key !== key), { key, at: new Date(at).toISOString(), job_id }].slice(-500) }
const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

/** The finished-looking sequences under this PC's output/ (never deliver/, .proxies, hidden folders, symlinks, a models folder or projects/desktop). Two stats per sequence (first and last frame), not one per frame. */
/** The number of runs of missing numbers in a sorted list of frame numbers. */
const gapsOf = (ns: number[]): number => { let n = 0; for (let i = 1; i < ns.length; i++) if (ns[i] !== ns[i - 1] + 1) n++; return n }
async function scanLocal(root: string): Promise<Candidate[]> {
  const out: Candidate[] = []; let seenEntries = 0
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > 8 || seenEntries > MAX_ENTRIES) return
    if (/(^|\/)projects\/desktop(\/|$)/.test(rel)) return
    let ents: import('node:fs').Dirent[]; try { ents = await readdir(join(root, rel), { withFileTypes: true }) } catch { return }
    seenEntries += ents.length; if (seenEntries % 500 < ents.length) await yieldLoop()
    const groups = new Map<string, { names: { n: number; name: string; pad: number }[]; stem: string }>(); let weights = false
    for (const d of ents) {
      if (d.isSymbolicLink()) continue
      if (d.isDirectory()) { if (!d.name.startsWith('.') && !(depth === 0 && SKIP_DIRS.has(d.name))) await walk(rel ? `${rel}/${d.name}` : d.name, depth + 1); continue }
      if (/\.(safetensors|ckpt|pt|pth|bin|gguf|onnx|pkl)$/i.test(d.name)) { weights = true; continue }
      const m = DPX_FRAME.exec(d.name); if (!m) continue
      const g = groups.get(m[1]) ?? groups.set(m[1], { names: [], stem: m[1] }).get(m[1])!; g.names.push({ n: Number(m[3]), name: d.name, pad: m[3].length })
    }
    for (const g of groups.values()) {
      g.names.sort((a, b) => a.n - b.n); const first = g.names[0], last = g.names[g.names.length - 1]
      const [a, b] = await Promise.all([lstat(join(root, rel, first.name)).catch(() => null), lstat(join(root, rel, last.name)).catch(() => null)]); if (!a || !b) continue
      out.push({ key: `${rel}/${g.stem}`, dir: rel, stem: g.stem, shot: '', gaps: gapsOf(g.names.map((x) => x.n)), count: g.names.length, first: first.n, last: last.n, pad: first.pad, oldest: Math.min(a.mtimeMs, b.mtimeMs), newest: Math.max(a.mtimeMs, b.mtimeMs), weights })
    }
  }
  await walk('', 0)
  return out
}
async function scanVolume(): Promise<Candidate[] | null> {
  const runs = await deps.volumeListing(); if (!runs) return null
  // ONE candidate per folder + stem: a listing may split a folder's frames across several runs, and the same file may be listed twice; counting them per run made the count flip on every look
  const groups = new Map<string, { dir: string; stem: string; frames: Map<number, { at: number; pad: number }> }>()
  for (const r of runs) {
    for (const f of r.files) {
      const m = DPX_FRAME.exec(f.filename); if (!m) continue
      const key = `${r.folder}/${m[1]}`, g = groups.get(key) ?? groups.set(key, { dir: r.folder, stem: m[1], frames: new Map() }).get(key)!
      g.frames.set(Number(m[3]), { at: f.modified ? Date.parse(`${f.modified}${/Z|[+-]\d\d:?\d\d$/.test(f.modified) ? '' : 'Z'}`) : 0, pad: m[3].length })
    }
    await yieldLoop()
  }
  const out: Candidate[] = []
  for (const [key, g] of groups) {
    const ns = [...g.frames.keys()].sort((a, b) => a - b), ats = [...g.frames.values()].map((x) => x.at)
    out.push({ key, dir: g.dir, stem: g.stem, shot: '', gaps: gapsOf(ns), count: ns.length, first: ns[0], last: ns[ns.length - 1], pad: g.frames.get(ns[0])!.pad, oldest: Math.min(...ats), newest: Math.max(...ats), weights: false })
  }
  return out
}

export interface GenerateStatus { enabled: boolean; where: 'local' | 'pod'; preset: 'review' | 'tunnel'; enabled_at: string | null; generating: number; waiting_to_settle: { stem: string; shot: string; since: string; source: 'local' | 'volume'; /** the frame count now, how many looks saw it unchanged, and whether it changed on the last look */ frames: number; seen: number; changing?: boolean; /** why it is not started although the frames settled (incomplete) */ reason?: string }[]; /** sequences left alone for a stated reason (not failures): code 'colour-not-stated' */ skipped: { stem: string; reason: string; code: string }[]; generated_today: number; max_per_day: number | null; failed: { stem: string; reason: string }[]; /** what is rendering now: the sequence, when it started and the job (additive) */ running?: { stem: string; key: string; job_id: string; started_at: string }[]; /** the renders started today, newest last, with where each stands now (additive) */ generated?: { stem: string; key: string; at: string; job_id: string; state: 'rendering' | 'done' | 'failed' | 'retrying' | 'started' }[]; waiting_for_pod?: boolean; /** Generate for what is already there: the sequences still waiting for the daily allowance, and how many it has started */ pending_existing?: number; existing_started?: number }
let waitingToSettle: GenerateStatus['waiting_to_settle'] = [], seenDirty = false, waitingForPod = false
export const status = (g: mounts.AutoGenerateConfig): GenerateStatus => ({ enabled: g.enabled, where: g.where, preset: g.preset, enabled_at: g.enabled_at ?? null, generating: active.size, waiting_to_settle: waitingToSettle, skipped: [...skippedList].map(([k, v]) => ({ stem: k.split('/').pop() ?? k, reason: v.reason, code: v.code })), generated_today: generatedToday, running: [...active].map(([key, a]) => ({ stem: key.split('/').pop() ?? key, key, job_id: a.job_id, started_at: new Date(a.started).toISOString() })), generated: startedList.map((x) => ({ stem: x.key.split('/').pop() ?? x.key, key: x.key, at: x.at, job_id: x.job_id, state: active.has(x.key) ? 'rendering' as const : failedList.has(x.key) ? 'failed' as const : done.has(x.key) ? 'done' as const : retryAt.has(x.key) ? 'retrying' as const : 'started' as const })), max_per_day: g.max_per_day, failed: [...failedList].map(([k, reason]) => ({ stem: k.split('/').pop() ?? k, reason })), ...(waitingForPod ? { waiting_for_pod: true } : {}), pending_existing: pendingExisting, existing_started: existingStarted })

/** One pass: look at the places, track which sequences have settled, and start a render for each new finished one (within the day's cap, on this PC or on a pod that is already running). `approver` is the standing approver (the render's `approved_by`). */
export async function pass(g: mounts.AutoGenerateConfig, approver: string, signal?: AbortSignal, scope: 'edl' | 'all' = 'all'): Promise<{ started: number }> {
  const now = deps.now(), day = localDay(now)
  const st = await readState(); generatedToday = st.day === day ? st.count ?? 0 : 0; lastDay = day
  if (st.day === day) { if (!startedList.length && st.started?.length) startedList = st.started.slice(-500) } else startedList = []
  if (!hydrated) { hydrated = true; for (const [k, v] of Object.entries(st.seen ?? {})) if (!seen.has(k)) seen.set(k, { sig: v.sig, changedAt: v.since, looks: v.looks }); for (const [k, v] of Object.entries(st.incomplete ?? {})) if (!incompleteList.has(k)) incompleteList.set(k, v) }   // what was seen before a restart is not forgotten
  // what is running: finished jobs leave the list, failed ones are tried again at most twice
  for (const [key, a] of [...active]) {
    const s = deps.status(a.job_id); if (!s || ['queued', 'rendering', 'pulling'].includes(s.state)) continue
    active.delete(key)
    if (s.state === 'done' && s.sequences?.length && s.sequences.every((q) => q.state === 'skipped' && /^colour not stated/.test(q.reason ?? ''))) skippedList.set(key, { reason: COLOUR_SKIP, code: 'colour-not-stated' })   // the colour setting (ask) skipped it: a warning, not a failure
    else if (s.state === 'done') done.add(key)
    else if (INCOMPLETE.test(s.error ?? '')) { const gaps = /\((\d+) gaps?\)/.exec(s.error ?? '')?.[1] ?? '?'; incompleteList.set(key, { sig: a.sig ?? '', reason: `incomplete: ${gaps} gaps, waiting for more frames` }); await writeState({ ...(await readState()), incomplete: Object.fromEntries(incompleteList) }) }   // not a failure: waits for more frames
    else if (NEEDS_COLOUR.test(s.error ?? '')) skippedList.set(key, { reason: COLOUR_SKIP, code: 'colour-not-stated' })   // a person has to state it: never retried in a loop
    else { const n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n); if (n > RETRIES) failedList.set(key, s.error || `the render ${s.state}`); else retryAt.set(key, now + (BACKOFF_MIN[n - 1] ?? 20) * 60_000) }
  }
  for (const [k, v] of [...skippedList]) if (v.code === NOT_IN_EDL_CODE || v.code === NO_EDL_CODE) skippedList.delete(k)   // the scope is judged again on every pass: a loaded EDL or a changed setting clears these
  if (scope === 'edl') await edl.ensure()
  waitingToSettle = []; waitingForPod = false; pendingExisting = (st.pending ?? []).length; existingStarted = st.existing_started ?? 0
  if (!g.enabled || !g.enabled_at || !approver) return { started: 0 }
  const enabledAt = Date.parse(g.enabled_at), root = deps.outputRoot()
  const cands = g.where === 'pod' ? await scanVolume() : root ? await scanLocal(root) : []
  if (!cands) return { started: 0 }
  let started = 0, count = generatedToday; const startedStems = new Set<string>()
  for (const c of cands.slice(0, MAX_CANDIDATES * 50)) {
    if (signal?.aborted) break
    if (c.weights || !c.oldest || (c.oldest <= enabledAt && !(st.pending ?? []).includes(c.key)) || done.has(c.key) || failedList.has(c.key) || skippedList.has(c.key) || active.has(c.key)) continue   // before the option was switched on: never backfilled
    const shotName = SHOT.test(c.stem) ? c.stem : SHOT.test(c.dir.split('/').pop() ?? '') ? c.dir.split('/').pop()! : ''
    if (!shotName) continue
    if (scope === 'edl') {   // only elements of the loaded EDL are rendered; with none loaded nothing is (ADR-050 amendment, scope)
      if (!edl.isLoaded()) { skippedList.set(c.key, { reason: NO_EDL_REASON, code: NO_EDL_CODE }); continue }
      if (edl.lookup({ clip: c.stem }).match === 'not-in-edl') { skippedList.set(c.key, { reason: NOT_IN_EDL_REASON, code: NOT_IN_EDL_CODE }); continue }
    }
    const source: 'local' | 'volume' = g.where === 'pod' ? 'volume' : 'local', sk = `${source}:${c.key}`, sig = `${c.count}:${c.newest}`, rec = seen.get(sk), row = (since: number, frames: number, looks: number, changing: boolean) => ({ stem: c.stem, shot: shotName, since: new Date(since).toISOString(), source, frames, seen: looks, ...(changing ? { changing: true } : {}) })
    if (!rec || rec.sig !== sig) { seen.set(sk, { sig, changedAt: now, looks: 1 }); seenDirty = true; waitingToSettle.push(row(now, c.count, 1, !!rec)); continue }   // first look, or the frames changed: the wait starts again
    rec.looks++; seenDirty = true
    if (now - rec.changedAt < g.settle_minutes * 60_000) { waitingToSettle.push(row(rec.changedAt, c.count, rec.looks, false)); continue }
    const inc = incompleteList.get(c.key)
    if (inc && inc.sig !== sig) { incompleteList.delete(c.key); await writeState({ ...(await readState()), incomplete: Object.fromEntries(incompleteList) }) }   // the frames changed (and have now settled): look again
    else if (inc || c.gaps > 0) { waitingToSettle.push({ ...row(rec.changedAt, c.count, rec.looks, false), reason: inc?.reason ?? `incomplete: ${c.gaps} gaps, waiting for more frames` }); continue }
    if (now < (retryAt.get(c.key) ?? 0)) continue   // backing off after a failure (5 minutes, then 20)
    if (startedStems.has(c.stem) || [...active.keys()].some((k) => k.split('/').pop() === c.stem)) continue   // one job per stem, never two in the same pass
    if (g.max_per_day !== null && count >= g.max_per_day) break
    if (!g.colour_in) { const t = await deps.transferOf(c, source); if (t !== null && NOT_DISPLAY.includes(t)) { skippedList.set(c.key, { reason: COLOUR_SKIP, code: 'colour-not-stated' }); continue } }   // log or linear frames and nobody has stated the colour: skipped, no job
    let podId: string | null = null
    if (g.where === 'pod') {
      if (active.size) continue   // one pod render at a time
      podId = await deps.runningPod()
      if (!podId && !g.fallback_local) { waitingForPod = true; continue }
    }
    const useLocal = g.where === 'local' || !podId
    try {
      const r = await deps.start({ sequences: [{ dir: c.dir, name: c.stem, first: c.first, last: c.last, frames: c.count, pad: c.pad }], kind: g.preset === 'tunnel' ? 'proxy' : 'review', ...(g.preset === 'tunnel' ? { preset: 'tunnel' } : {}), where: useLocal ? 'local' : 'pod', ...(podId && !useLocal ? { pod_id: podId, pull: false } : {}), approved_by: approver, skip_existing: true, ...(g.colour_in ? { colour_in: g.colour_in } : {}), trigger: 'auto-publish' })
      active.set(c.key, { job_id: r.job_id, started: now, sig }); noteStarted(c.key, r.job_id, now); startedStems.add(c.stem); started++; count++
      st.pending = (st.pending ?? []).filter((k) => k !== c.key); await writeState({ ...st, day, count, started: startedList, ...(st.pending.length ? {} : { pending: [] }) })
    } catch (e) {
      if (String((e as Error).message).includes(ALL_DONE)) { done.add(c.key); continue }   // already has its review: nothing to do
      if (NEEDS_COLOUR.test((e as Error).message)) { skippedList.set(c.key, { reason: COLOUR_SKIP, code: 'colour-not-stated' }); continue }
      const n = (attempts.get(c.key) ?? 0) + 1; attempts.set(c.key, n); if (n > RETRIES) failedList.set(c.key, (e as CoreError).message.slice(0, 300)); else retryAt.set(c.key, now + (BACKOFF_MIN[n - 1] ?? 20) * 60_000)
    }
    await yieldLoop()
  }
  generatedToday = count
  if (seenDirty) { seenDirty = false; const live = new Set(cands.map((c) => `${g.where === 'pod' ? 'volume' : 'local'}:${c.key}`)); const st2 = await readState(); await writeState({ ...st2, seen: Object.fromEntries([...seen].filter(([k]) => live.has(k) || !k.startsWith(g.where === 'pod' ? 'volume:' : 'local:')).map(([k, v]) => [k, { sig: v.sig, since: v.changedAt, looks: v.looks }])) }) }
  return { started }
}
/** Import Round > Generate Outputs: the NEW, COMPLETE DPX sequences of one shot on the volume (frames written since `sinceMs`). Model weights, sequences with gaps and sequences with no readable modified time are left out, each with its reason (never a partial sequence). Starts nothing. */
export async function newVolumeSequences(shot: string, sinceMs: number): Promise<{ sequences: { dir: string; name: string; first: number; last: number; frames: number; pad: number }[]; skipped: { stem: string; reason: string }[] }> {
  const cands = (await scanVolume()) ?? [], sequences: { dir: string; name: string; first: number; last: number; frames: number; pad: number }[] = [], skipped: { stem: string; reason: string }[] = []
  for (const c of cands) {
    const name = SHOT.test(c.stem) ? c.stem : SHOT.test(c.dir.split('/').pop() ?? '') ? c.dir.split('/').pop()! : ''
    if (!name || (name !== shot && !c.dir.split('/').includes(shot) && !c.stem.startsWith(shot))) continue
    if (c.weights) { skipped.push({ stem: c.stem, reason: 'model weights are never rendered' }); continue }
    if (!c.oldest || c.oldest < sinceMs) { skipped.push({ stem: c.stem, reason: c.oldest ? 'not new: its frames were there before this run' : 'cannot tell when its frames were written' }); continue }
    if (c.gaps > 0) { skipped.push({ stem: c.stem, reason: `incomplete: ${c.gaps} gap${c.gaps === 1 ? '' : 's'} in the frames` }); continue }
    sequences.push({ dir: c.dir, name: c.stem, first: c.first, last: c.last, frames: c.count, pad: c.pad })
  }
  return { sequences, skipped }
}
/** Stop what was started: the renders still running are cancelled (Off does this). */
export async function clearPending(): Promise<void> { const st = await readState(); if (st.pending?.length) await writeState({ ...st, pending: [] }); pendingExisting = 0 }
export function cancelAll(): number { let n = 0; for (const [, a] of active) { try { deps.cancel(a.job_id); n++ } catch { /* gone */ } } active.clear(); return n }
export function reset(): void { startedList = []; incompleteList.clear(); retryAt.clear(); hydrated = false; seenDirty = false; seen.clear(); active.clear(); attempts.clear(); done.clear(); failedList.clear(); skippedList.clear(); waitingToSettle = []; waitingForPod = false; generatedToday = 0; lastDay = ''; setDeps(null) }
void lastDay

// ----- Generate for what is already there: a one-time, confirmed action (ADR-050) -----
export interface ExistingResult {
  dry_run: boolean; sequences: { stem: string; shot: string; clip: string; frames: number; bytes: number | null; source: 'volume' | 'local'; flags: tunnelj.Flag[] }[]; skipped: { stem: string; reason: string }[]
  totals: { sequences: number; frames: number; bytes: number }; where: 'local' | 'pod'; preset: 'review' | 'tunnel'; max_per_day: number | null; today_started: number; can_start_today: number | null; remaining_after_today: number
  pod: { id: string; name: string; running: boolean } | null; estimate_hours: number | null; notes: string[]; started?: number; deferred?: number
}
/** The existing sequences, judged the way a pass judges new ones, but with `enabled_at` ignored. Preview starts nothing; a run starts them as ordinary renders (one at a time on a pod) within max_per_day, the rest carried over as `pending_existing`. */
export async function existing(g: mounts.AutoGenerateConfig, o: { run: boolean; approver: string; limit?: number; standing?: string }): Promise<ExistingResult> {
  const now = deps.now(), day = localDay(now), st = await readState(), today = st.day === day ? st.count ?? 0 : 0, tunnel = g.preset === 'tunnel'
  if (o.limit !== undefined && !(Number.isInteger(o.limit) && o.limit >= 1)) throw new CoreError(400, 'limit is a whole number of sequences, at least 1')
  if (o.run && g.where === 'pod' && !o.approver) { history.record({ kind: 'change', area: 'configuration', action: 'generate existing refused', what: 'rendering on a pod', detail: 'no approver named' }); throw new CoreError(400, "Rendering on a pod spends money: put the approver's name") }
  await edl.ensure()
  const root = deps.outputRoot(), cands = (g.where === 'pod' ? await scanVolume() : root ? await scanLocal(root) : []) ?? []
  const source: 'volume' | 'local' = g.where === 'pod' ? 'volume' : 'local', skipped: ExistingResult['skipped'] = [], ok: (ExistingResult['sequences'][number] & { c: Candidate })[] = []
  for (const c of [...cands].sort((a, b) => a.key.localeCompare(b.key))) {
    const shotName = SHOT.test(c.stem) ? c.stem : SHOT.test(c.dir.split('/').pop() ?? '') ? c.dir.split('/').pop()! : ''
    if (c.weights) { skipped.push({ stem: c.stem, reason: 'model weights are never rendered' }); continue }
    if (!shotName) { skipped.push({ stem: c.stem, reason: 'no shot or clip name' }); continue }
    if (done.has(c.key) || active.has(c.key)) { skipped.push({ stem: c.stem, reason: 'already has a render' }); continue }
    if (!c.newest || now - c.newest < g.settle_minutes * 60_000) { skipped.push({ stem: c.stem, reason: 'not settled yet' }); continue }
    if (tunnel && !g.colour_in) { skipped.push({ stem: c.stem, reason: COLOUR_SKIP }); continue }
    const a = tunnelj.assess({ name: c.stem, frames: c.count, strict: tunnel, needColour: tunnel, ...(g.colour_in ? { colour_in: g.colour_in as tunnelj.ColourIn } : {}) })
    if (a.blocked) { skipped.push({ stem: c.stem, reason: `blocked by an EDL flag: ${tunnelj.blockReasons(a)}` }); continue }
    ok.push({ c, stem: c.stem, shot: shotName, clip: c.stem, frames: c.count, bytes: null, source, flags: a.flags })
    if (ok.length % 200 === 0) await yieldLoop()
  }
  let podId: string | null = null; const notes: string[] = ['The USD 100 governance cap for agents and cloud GPU is a separate limit from max_per_day.']
  if (g.where === 'pod') { podId = await deps.runningPod(); if (!podId) notes.push(g.fallback_local ? 'No pod is running: it never starts one; fallback_local would render on this PC.' : 'No pod is running: it never starts one.') }
  const room = g.max_per_day === null ? null : Math.max(0, g.max_per_day - today), cap = o.limit === undefined ? ok.length : Math.min(o.limit, ok.length)
  const res: ExistingResult = { dry_run: !o.run, sequences: ok.map(({ c: _c, ...x }) => x), skipped, totals: { sequences: ok.length, frames: ok.reduce((x, y) => x + y.frames, 0), bytes: 0 }, where: g.where, preset: g.preset, max_per_day: g.max_per_day, today_started: today, can_start_today: room === null ? cap : Math.min(room, cap), remaining_after_today: 0,
    pod: podId ? { id: podId, name: podId, running: true } : null, estimate_hours: null, notes }
  res.remaining_after_today = Math.max(0, cap - (res.can_start_today ?? cap))
  if (!o.run) return res
  if (g.where === 'pod' && !podId && !g.fallback_local) throw new CoreError(409, 'No pod is running: it never starts one')
  const useLocal = g.where === 'local' || !podId, approver = o.approver || o.standing || 'Auto-generate'
  let started = 0; const chosen = ok.slice(0, cap), queue = chosen.slice(0, res.can_start_today ?? chosen.length), deferred = chosen.slice(queue.length)
  for (const x of queue) {
    try {
      const r = await deps.start({ sequences: [{ dir: x.c.dir, name: x.c.stem, first: x.c.first, last: x.c.last, frames: x.c.count, pad: x.c.pad }], kind: tunnel ? 'proxy' : 'review', ...(tunnel ? { preset: 'tunnel' } : {}), where: useLocal ? 'local' : 'pod', ...(podId && !useLocal ? { pod_id: podId, pull: false } : {}), approved_by: approver, skip_existing: true, ...(g.colour_in ? { colour_in: g.colour_in } : {}), trigger: 'auto-publish' })
      active.set(x.c.key, { job_id: r.job_id, started: now }); noteStarted(x.c.key, r.job_id, now); started++
    } catch (e) { if (String((e as Error).message).includes(ALL_DONE)) { done.add(x.c.key); continue }; skipped.push({ stem: x.stem, reason: (e as Error).message.slice(0, 200) }) }
    await yieldLoop()
  }
  await writeState({ ...st, day, count: today + started, started: startedList, pending: [...new Set([...(st.pending ?? []), ...deferred.map((d) => d.c.key)])], existing_started: (st.existing_started ?? 0) + started })
  pendingExisting = new Set([...(st.pending ?? []), ...deferred.map((d) => d.c.key)]).size; existingStarted = (st.existing_started ?? 0) + started
  history.record({ kind: 'change', area: 'configuration', action: 'generate for what is already there', what: `${started} started, ${deferred.length} deferred`, detail: `${g.where}, ${g.preset}`, approved_by: approver })
  return { ...res, dry_run: false, started, deferred: deferred.length }
}
