/**
 * The uploads an Upload On event makes (docs/ADR-064) as jobs: one job per event and call, listed in the Queue with progress, rate and Cancel, and in History when it
 * ends. The copying itself stays in storage.ts; this file only keeps the job's numbers and the abort. No keys and no links in any field.
 */
import * as history from './history.js'
import * as jobsregistry from './jobsregistry.js'

export type UploadState = 'uploading' | 'done' | 'done_with_warning' | 'failed' | 'cancelled'
export interface UploadJob { job_id: string; kind: 'storage-upload'; state: UploadState; event: string; targets: string[]; source: 'pod' | 'pc' | 'volume'; source_name?: string; started_at: string; finished_at?: string; files_total: number; files_done: number; files_skipped: number; files_failed: number; bytes_total: number; bytes_done: number; rate: number; current: string; warnings: string[]; error?: string }
interface Rec { view: UploadJob; ac: AbortController; stop?: () => void; ended: boolean; t0: number }
const live = new Map<string, Rec>()
let finished: UploadJob[] = [], seq = 0
const KEEP = 20, WARN_MAX = 20
const iso = () => new Date().toISOString()
const gb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`)

export interface Handle { readonly signal: AbortSignal; readonly id: string; current(name: string): void; file(state: 'sent' | 'skipped' | 'failed', bytes: number): void; warn(message: string): void; end(): UploadJob }

/** Start a job. `signal` (the render's, say) also cancels it. */
export function open(o: { event: string; targets: string[]; source: 'pod' | 'pc' | 'volume'; source_name?: string; files_total: number; bytes_total: number; signal?: AbortSignal }): Handle {
  const id = `upload-${Date.now().toString(36)}-${seq++}`, ac = new AbortController()
  if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', () => ac.abort(), { once: true }) }
  const view: UploadJob = { job_id: id, kind: 'storage-upload', state: 'uploading', event: o.event, targets: [...o.targets], source: o.source, ...(o.source_name ? { source_name: o.source_name } : {}), started_at: iso(), files_total: o.files_total, files_done: 0, files_skipped: 0, files_failed: 0, bytes_total: o.bytes_total, bytes_done: 0, rate: 0, current: '', warnings: [] }
  const rec: Rec = { view, ac, ended: false, t0: Date.now() }
  live.set(id, rec)
  history.record({ kind: 'change', area: 'configuration', action: 'storage upload started', what: `${o.event} to ${o.targets.join(', ')}`, detail: `${o.files_total} file(s)${o.bytes_total ? `, ${gb(o.bytes_total)}` : ''}${o.source === 'pod' ? `, from pod ${o.source_name ?? ''}`.trimEnd() : o.source === 'volume' ? ', from the volume' : ', from this PC'}` })
  rec.stop = jobsregistry.track({ id, kind: 'storage-upload', trigger: 'event', origin: 'window', label: `upload on ${o.event} to ${o.targets.join(', ')}`, started_at: view.started_at,
    view: () => ({ state: view.state, terminal: rec.ended, progress: { done: view.files_done + view.files_skipped, total: view.files_total, unit: 'files' }, transfer: { bytes_done: view.bytes_done, bytes_total: view.bytes_total, rate_bps: view.rate, ...(view.current ? { current: view.current } : {}), skipped: view.files_skipped, pods: o.source === 'pod' && o.source_name ? [o.source_name] : [] } }),
    cancel: () => { ac.abort() } })
  return {
    signal: ac.signal, id,
    current: (name) => { view.current = name.slice(0, 200) },
    file: (state, bytes) => {
      if (state === 'sent') { view.files_done++; view.bytes_done += bytes } else if (state === 'skipped') view.files_skipped++; else view.files_failed++
      view.rate = Math.round(view.bytes_done / Math.max(1, (Date.now() - rec.t0) / 1000))
    },
    warn: (m) => { if (view.warnings.length < WARN_MAX) view.warnings.push(m.slice(0, 300)) },
    end: () => {
      if (rec.ended) return view
      rec.ended = true; view.current = ''; view.finished_at = iso()
      view.state = ac.signal.aborted ? 'cancelled' : view.files_failed || view.warnings.length ? (view.files_done || view.files_skipped ? 'done_with_warning' : 'failed') : 'done'
      history.record({ kind: 'change', area: 'configuration', action: `storage upload ${view.state.replace(/_/g, ' ')}`, what: `${o.event} to ${o.targets.join(', ')}`, detail: `${view.files_done} sent, ${view.files_skipped} already there, ${view.files_failed} failed (${gb(view.bytes_done)})` })
      for (const w of view.warnings.slice(0, 5)) history.record({ kind: 'change', area: 'configuration', action: 'storage upload warning', what: `${o.event} to ${o.targets.join(', ')}`, detail: w })
      live.delete(id); finished = [{ ...view, warnings: [...view.warnings] }, ...finished].slice(0, KEEP)
      rec.stop?.()
      return view
    },
  }
}

/** The running uploads, then the newest finished ones; with an id, just that one. */
export function status(jobId?: string): { jobs: UploadJob[] } {
  const all = [...[...live.values()].map((r) => ({ ...r.view, warnings: [...r.view.warnings] })), ...finished]
  return { jobs: jobId ? all.filter((j) => j.job_id === jobId) : all }
}
/** Stop a running upload (the copy in progress is aborted). */
export function cancel(jobId: string): UploadJob {
  const r = live.get(jobId); if (!r) { const f = finished.find((j) => j.job_id === jobId); if (f) return f; throw new Error(`no upload ${jobId}`) }
  r.ac.abort(); return { ...r.view }
}
export function reset(): void { for (const r of live.values()) { r.ac.abort(); r.stop?.() } live.clear(); finished = [] }
