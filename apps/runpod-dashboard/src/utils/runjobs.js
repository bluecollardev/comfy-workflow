// The render runs of the Queue's Generations (graph runs through the app's endpoint, its window, its queue, or another process: `runflows.jobs()`): pure text and selectors.

export const isRunning = (j) => j?.state === 'running'
export const isFinished = (j) => ['done', 'failed', 'cancelled', 'interrupted'].includes(j?.state)

/** The pod the run is on: its name, else its id. */
export const podLabel = (j) => j?.pod_name || j?.pod_id || ''

/** `SeedVR2 sampling 3/12 · 41%` from ComfyUI's own events (the node's title, else its class, else the node id); '' when there is nothing live to say. */
export function liveText(live) {
  if (!live || live.state === 'none') return ''
  if (live.state === 'waiting' && !live.node) return ''
  const name = live.node_title || live.node_class || (live.node ? `node ${live.node}` : '')
  if (!name) return ''
  const steps = live.max > 0 && live.step !== undefined ? ` ${Math.round(live.step)}/${Math.round(live.max)}` : ''
  const pct = live.percent !== undefined && live.max > 0 ? ` · ${Math.round(live.percent)}%` : ''
  return `${name}${steps}${pct}`
}
/** `none` = the socket could not be opened: the row shows a muted note, the reason as its tooltip; `waiting` = open, nothing running yet. */
export const liveState = (live) => (!live ? 'none' : live.state === 'none' ? 'none' : live.node ? 'live' : 'waiting')

/** `122 of 209 frames`, '' before the first checkpoint. */
export const framesText = (j) => (j?.frames_total > 0 ? `${Math.round(j.frames_done || 0)} of ${Math.round(j.frames_total)} frames` : '')
export const chunkText = (j) => (j?.chunks > 0 ? `chunk ${j.chunk || 1} of ${j.chunks}` : '')
/** The row's progress line: `chunk 5 of 8 · SeedVR2 sampling 3/12 · 41%` while it runs (the chunk and what ComfyUI is doing in it), the frames when it is over. */
export function genLine(j) {
  const parts = []
  const c = chunkText(j); if (c) parts.push(c)
  if (isRunning(j)) { const l = liveText(j.live); if (l) parts.push(l) }
  else { const f = framesText(j); if (f) parts.push(f) }
  return parts.join(' · ')
}
export const percentOf = (j) => (j?.frames_total > 0 ? Math.min(100, Math.round((100 * (j.frames_done || 0)) / j.frames_total)) : null)
/** `29 s/frame`. */
export const rateText = (j) => (j?.rate_spf > 0 ? `${Math.round(j.rate_spf)} s/frame` : '')
/** `ETA 19:12` in the person's local time, only while running. */
export function etaText(j, locale = 'en-GB') {
  if (!isRunning(j) || !j?.eta) return ''
  const d = new Date(j.eta); if (Number.isNaN(d.getTime())) return ''
  return `ETA ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

/** What the Queue lists: every running run, then the newest finished ones (at most `keep`), running first and the newest start first. */
export function selectRows(jobs, keep = 8) {
  const all = (Array.isArray(jobs) ? jobs : []).filter((j) => j && j.job_id)
  const running = all.filter(isRunning)
  const done = all.filter((j) => !isRunning(j)).sort((a, b) => String(b.finished_at || b.started_at).localeCompare(String(a.finished_at || a.started_at))).slice(0, keep)
  return [...running.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))), ...done]
}
