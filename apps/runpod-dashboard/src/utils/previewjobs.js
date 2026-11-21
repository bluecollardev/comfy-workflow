// The frame-previews jobs of the Queue's Generations (the pod job of libs/core/src/framepreviews.ts, this app's and other processes': `framepreviews.jobs()`): pure text and selectors.
// One job can make three kinds of file: frames (320 px JPEGs), thumbnails (the 160 px tier beside them) and posters (a video's first frame); the row shows them as counters.

export const isRunning = (j) => j?.state === 'running'
export const isFinished = (j) => ['done', 'failed', 'cancelled', 'interrupted'].includes(j?.state)
/** Frames, thumbnails and posters that are there, plus the ones that failed, of all there is to do (null when the job does not know a total yet). */
export function percentOf(j) {
  const total = (j?.frames_total || 0) + (j?.posters_total || 0)
  return total > 0 ? Math.min(100, Math.round((100 * ((j.frames_done || 0) + (j.posters_done || 0) + (j.failed || 0))) / total)) : null
}

/**
 * What the row is called (a key of queue.pjob.kind): `auto` for the automatic previews after new outputs, `posters` for a job that only made video posters,
 * `thumbnails` for a run that made no new frame (every JPEG was already there) but made thumbnails, else `frames`.
 */
export function rowKind(j) {
  if (j?.trigger === 'automatic') return 'auto'
  if ((j?.frames_total || 0) === 0 && (j?.posters_total || 0) > 0) return 'posters'
  if ((j?.frames_written || 0) === 0 && (j?.thumbs_made || 0) > 0 && (j?.frames_done || 0) > 0) return 'thumbnails'
  return 'frames'
}

/** The counters the row shows, only for the kinds that have something to do: [{ id: 'frames' | 'thumbs' | 'posters', done, total }]. */
export function counters(j) {
  const out = []
  if ((j?.frames_total || 0) > 0) {
    out.push({ id: 'frames', done: j.frames_done || 0, total: j.frames_total })
    out.push({ id: 'thumbs', done: j.thumbs_done || 0, total: j.frames_total })
  }
  if ((j?.posters_total || 0) > 0) out.push({ id: 'posters', done: j.posters_done || 0, total: j.posters_total })
  return out
}
/** `Frames 412 of 650 · Thumbnails 380 of 650 · Posters 3 of 12`; `t(id)` gives the kind's word. */
export const counterLine = (j, word) => counters(j).map((c) => `${word(c.id)} ${c.done} of ${c.total}`).join(' · ')

/** The pod the job is on: its name from the pods list, else its id. */
export const podName = (j, pods) => ((pods || []).find((p) => p.id === j?.pod_id)?.name) || j?.pod_id || ''

/** What the Queue lists: every running job first (newest start first), then the others, newest first; a dismissed one is hidden. */
export function orderRows(jobs, dismissed = []) {
  const gone = new Set(dismissed)
  const all = (Array.isArray(jobs) ? jobs : []).filter((j) => j && j.job_id && !gone.has(j.job_id))
  const running = all.filter(isRunning).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
  const rest = all.filter((j) => !isRunning(j)).sort((a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at)))
  return [...running, ...rest]
}
/** A stopped job a person can run again: the core says so (`relaunchable`). */
export const canRelaunch = (j) => !!j && j.state !== 'running' && j.relaunchable === true
/** Remove hides a job that is over from the Queue (the previews on the pod stay). */
export const canRemove = (j) => isFinished(j)
