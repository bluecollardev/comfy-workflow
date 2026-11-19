/** Generations in the Queue (docs/ADR-051 section 9): render jobs and the preview batch, pure helpers (titles, the phase, the ETA, ordering). `npm run dpx:test`. */
import { ACTIVE, isActive } from './renders.js'
export const FINISHED = ['done', 'failed', 'cancelled']
export const KEEP_FINISHED = 20

/** The phase of a render job: rendering, syncing (pulling to this PC), publishing, or '' once it ended. */
export const phaseOf = (job) => (job?.state === 'pulling' ? 'syncing' : job?.state === 'publishing' ? 'publishing' : ACTIVE.includes(job?.state) ? 'rendering' : '')
/** The chips of a job's phases, in order, with the active one marked: the sync chip only when the job syncs (a pod render), the publish chip only when it publishes. */
export function phaseChips(job) {
  const chips = [{ id: 'rendering' }]
  // Sync is a step only when the job really copies to this PC (`pull`, said by the core); an older core never said, so it keeps the old rule (any pod render)
  const podRender = (job?.sequences || []).some((s) => s.where === 'pod'), syncs = job?.pull === undefined ? podRender : (job.pull === true && podRender) || (job.pulled_files || 0) > 0
  if (syncs || job?.state === 'pulling') chips.push({ id: 'syncing' })
  if (job?.publish || job?.state === 'publishing') chips.push({ id: 'publishing' })
  const now = phaseOf(job)
  return chips.map((c) => ({ ...c, active: c.id === now, done: !!job && !now ? job.state === 'done' : chips.findIndex((x) => x.id === now) > chips.findIndex((x) => x.id === c.id) }))
}
/** Seconds left from the rate and the frames still to do; null when unknown. */
export const etaSeconds = (job) => (job && job.state === 'rendering' && job.rate_fps > 0 && job.frames_total > job.frames_done ? Math.round((job.frames_total - job.frames_done) / job.rate_fps) : null)
/** 'about 4 min left' from seconds; '' when unknown. */
export function etaText(sec) {
  if (sec == null || sec < 0) return ''
  if (sec < 60) return `about ${Math.max(1, sec)} s left`
  if (sec < 3600) return `about ${Math.round(sec / 60)} min left`
  return `about ${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min left`
}
/** The title: 'Review: 3 sequences', or the clip name (else the sequence name) of a single one. */
export function jobTitle(job, t) {
  const seqs = job?.sequences || []
  const kind = job?.kind === 'review' ? t('queue.gen.review') : t('queue.gen.proxy')
  if (seqs.length === 1) return `${kind}: ${seqs[0].clip_name || seqs[0].name}`
  return `${kind}: ${t(seqs.length === 1 ? 'queue.gen.sequenceOne' : 'queue.gen.sequenceMany', { n: seqs.length })}`
}
/** Running jobs first (newest first), then the last 20 finished (newest first); dismissed ones are left out. */
export function orderJobs(jobs, dismissed = []) {
  const byNew = (a, b) => String(b.started_at || '').localeCompare(String(a.started_at || ''))
  const live = (jobs || []).filter((j) => !dismissed.includes(j.job_id))
  return [...live.filter(isActive).sort(byNew), ...live.filter((j) => !isActive(j)).sort(byNew).slice(0, KEEP_FINISHED)]
}
/** The files a finished job wrote, by clip name: from the sequences' `files` (names), else the sequences' out names. */
export function jobFiles(job) {
  const names = []
  for (const s of job?.sequences || []) { if (Array.isArray(s.files) && s.files.length) names.push(...s.files.map((f) => f.name || f)); else if (s.out) names.push(String(s.out).split('/').pop()) }
  return [...new Set(names)]
}
/** The Previews batch line: 'Previews: 12 of 40 · 1 failed'. */
export const batchLine = (b, t) => `${t('queue.gen.previews')}: ${t('queue.gen.ofTotal', { done: b.done, total: b.total })}${b.failed ? ` · ${t('queue.gen.failedN', { n: b.failed })}` : ''}`
/** A render job's overall percent (a copy of renders.jobPercent for the card, 100 when done). */
export const percentOf = (job) => (job?.state === 'done' ? 100 : job?.frames_total > 0 ? Math.max(0, Math.min(100, Math.round((100 * (job.frames_done || 0)) / job.frames_total))) : 0)
