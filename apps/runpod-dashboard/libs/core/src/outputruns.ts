/**
 * Saved outputs: the files a pod's runs wrote, kept in ~/.config/runpod-pod-manager/output-runs.json so they outlive the pod.
 * ComfyUI keeps its history in memory: a stop or a recreate empties it, and the Outputs button used to go dead with it. The files
 * themselves live on the shared network volume, so this record (prompt id, workflow, times, pod, volume, file names) is enough to list them again.
 * Only successful runs with at least one `output` file (temp files are ephemeral); one entry per prompt_id; the newest 500 runs; at most 500 files a run.
 * Everything here is best effort: recording never throws into its caller, and a corrupt file starts an empty record. No secrets are written.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { outputRunsFile } from './paths.js'

export const MAX_RUNS = 500
export const MAX_FILES = 500
export const STOP_READ_MS = 8000

export interface SavedFile { filename: string; subfolder: string; type: 'output' }
export interface SavedRun {
  prompt_id: string; workflow: string | null; started_at: string | null; duration_s: number | null
  pod_id: string; pod_name: string | null; volume_id: string | null; datacenter: string | null
  recorded_at: string; files: SavedFile[]
}
export interface PodCtx { pod_id: string; pod_name?: string | null; volume_id?: string | null; datacenter?: string | null }
/** What a recorder reads from a run (ComfyRun fits: status, outputs with type; runflows passes files). */
export interface RunLike { prompt_id: string; status?: string; workflow?: string | null; started_at?: string | null; duration_s?: number | null; outputs?: { filename: string; subfolder?: string; type?: string }[] }

export function load(): SavedRun[] {
  try {
    const f = outputRunsFile()
    if (!existsSync(f)) return []
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return Array.isArray(j?.runs) ? j.runs.filter((r: SavedRun) => r && typeof r.prompt_id === 'string' && Array.isArray(r.files)) : []
  } catch { return [] }
}

function save(runs: SavedRun[]): void {
  const f = outputRunsFile()
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify({ runs }, null, 2) + '\n')
  renameSync(tmp, f)   // atomic: a crash leaves the old file, never half of one
}

const when = (r: { started_at: string | null; recorded_at: string }) => r.started_at || r.recorded_at
const newestFirst = (a: SavedRun, b: SavedRun) => when(b).localeCompare(when(a))

/** Told about every run recorded (autosync.ts registers here, docs/ADR-046): best effort, a hook that throws never breaks the recording. */
export type RecordedHook = (ctx: PodCtx, files: SavedFile[]) => void
let recordedHook: RecordedHook | null = null
export const setRecordedHook = (fn: RecordedHook | null) => { recordedHook = fn }

/** Record what these runs wrote; returns how many entries were added or refreshed. Never throws. */
export function record(ctx: PodCtx, runs: RunLike[], now = new Date()): number {
  try {
    const fresh: SavedRun[] = []
    for (const r of runs || []) {
      if (!r || typeof r.prompt_id !== 'string' || !r.prompt_id) continue
      if (r.status !== undefined && r.status !== 'success') continue
      const seen = new Set<string>(), files: SavedFile[] = []
      for (const o of r.outputs || []) {
        if (!o || o.type !== 'output' || typeof o.filename !== 'string') continue
        const k = `${o.subfolder || ''}/${o.filename}`
        if (seen.has(k)) continue
        seen.add(k)
        if (files.length < MAX_FILES) files.push({ filename: o.filename, subfolder: o.subfolder || '', type: 'output' })
      }
      if (!files.length) continue
      fresh.push({ prompt_id: r.prompt_id, workflow: r.workflow || null, started_at: r.started_at || null, duration_s: r.duration_s ?? null, pod_id: ctx.pod_id, pod_name: ctx.pod_name || null, volume_id: ctx.volume_id || null, datacenter: ctx.datacenter || null, recorded_at: now.toISOString(), files })
    }
    if (!fresh.length) return 0
    const byId = new Map(load().map((r) => [r.prompt_id, r]))
    for (const r of fresh) { const old = byId.get(r.prompt_id); byId.set(r.prompt_id, old ? { ...r, workflow: r.workflow || old.workflow, volume_id: r.volume_id || old.volume_id, pod_name: r.pod_name || old.pod_name, datacenter: r.datacenter || old.datacenter, recorded_at: old.recorded_at } : r) }
    save([...byId.values()].sort(newestFirst).slice(0, MAX_RUNS))
    if (recordedHook) for (const r of fresh) { try { recordedHook(ctx, r.files) } catch { /* never in the way */ } }
    return fresh.length
  } catch { return 0 }
}

/** The saved runs, newest first. A pod_id and/or a volume_id narrows them: a run matches when it came from that pod or sits on that volume (the files live on the volume, so every pod on it shows them). */
export function saved(q: { pod_id?: string; volume_id?: string } = {}): SavedRun[] {
  const all = load().sort(newestFirst)
  if (!q.pod_id && !q.volume_id) return all
  return all.filter((r) => (!!q.pod_id && r.pod_id === q.pod_id) || (!!q.volume_id && r.volume_id === q.volume_id))
}

/** Reads a running pod's finished runs once; replaced in tests. */
export type StopReader = (podId: string, signal: AbortSignal) => Promise<{ ctx: PodCtx; runs: RunLike[] } | null>
let reader: StopReader | null = null
export const setStopReader = (fn: StopReader | null) => { reader = fn }

const makeReader = (client?: unknown): StopReader => async (podId, signal) => {
  const pods = await import('./pods.js'), runs = await import('./comfyruns.js')
  const pod = await pods.get(podId, client as never)
  if (pod.status !== 'running' || !pod.web_ui_url) return null
  const list = await runs.finishedRuns(pod.web_ui_url.replace(/\/$/, ''), fetch, signal)
  return { ctx: { pod_id: podId, pod_name: pod.name, volume_id: pod.volume_id, datacenter: pod.datacenter }, runs: list }
}

/** Before a stop: read the pod's history once (8 s at most) and record it. Never throws and never holds the stop: a failed or slow read is skipped. */
export async function beforeStop(podId: string, client?: unknown): Promise<void> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), STOP_READ_MS)
  try {
    const read = reader ?? makeReader(client)
    const got = await Promise.race([read(podId, ac.signal), new Promise<null>((res) => ac.signal.addEventListener('abort', () => res(null)))])
    if (got) record(got.ctx, got.runs)
  } catch { /* the stop goes on */ } finally { clearTimeout(timer) }
}
/** A pod's context (name, volume, datacenter) for a recorder that was not handed it; best effort. */
export async function ctxFor(podId: string, client?: unknown): Promise<PodCtx> {
  try { const pod = await (await import('./pods.js')).get(podId, client as never); return { pod_id: podId, pod_name: pod.name, volume_id: pod.volume_id, datacenter: pod.datacenter } } catch { return { pod_id: podId } }
}
