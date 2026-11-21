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

// ----- failed previews (docs/ADR-051): the reasons kept with the batch, shown in the Queue and noted in the History -----
export const FAILURES_CAP = 200   // failures kept with a batch
export const NOTE_FIRST = 20      // failures a batch writes to the History one by one; beyond that, one summary line
export const PAGE_SIZES = [5, 10, 25]
/** A reason as free text for the screen and the History: URLs, AWS key ids and long tokens struck out, one line, 300 characters. */
export const redactReason = (s) => String(s ?? '').replace(/https?:\/\/\S+/gi, '<url>').replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '<key>').replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '<token>').replace(/\s+/g, ' ').trim().slice(0, 300)
/** The plain-words reason of a failed preview: the translated one when the result has a `code` (and there is a translation), else the redacted raw reason. */
export function reasonText(f, t) {
  if (f?.code) { const k = `outputs.dpx.reason.${f.code}`, s = t(k); if (s && s !== k) return s }
  return redactReason(f?.reason) || redactReason(f?.code) || '?'
}
/** The failure record kept for a failed result: { key, name, pod_name, reason, code, at }. */
export const failureRecord = (item, r, podName, at = new Date().toISOString()) => ({ key: item.key, name: item.name || String(item.key).split('/').pop(), pod_name: podName || '', reason: redactReason(r?.reason), code: r?.code || '', at })
/** The History line (for history.note) of a failed preview; `index` is its 0-based place among the batch's failures, and only the first NOTE_FIRST get one. */
export const historyNote = (f, index) => (index < NOTE_FIRST ? { kind: 'change', area: 'outputs', action: 'preview failed', what: f.name, detail: [f.pod_name, f.reason || f.code].filter(Boolean).join(': ') } : null)
/** The one summary line for a batch with more failures than NOTE_FIRST, else null. */
export const summaryNote = (b) => (b && b.failed > NOTE_FIRST ? { kind: 'change', area: 'outputs', action: 'previews failed', what: b.label || 'Previews', detail: `${b.failed} of ${b.done} previews failed; the first ${NOTE_FIRST} are listed above` } : null)
/** Paging: the rows of a page, the page count, the clamped page and the "1–10 of N" text. */
export function paged(list, page, size) {
  const n = list.length, count = Math.max(1, Math.ceil(n / size)), p = Math.max(0, Math.min(page, count - 1))
  return { rows: list.slice(p * size, (p + 1) * size), count, page: p, info: n ? `${p * size + 1}–${Math.min(n, (p + 1) * size)} of ${n}` : '0' }
}

// ----- retry of a finished preview batch (Lucas, 2026-11-21: "in queue allow retry of Previews: 45 of 45 · 36 failed") -----
/** The items to ask for again: exactly the ones that failed, in the order the batch worked through them (`all` order), without duplicates; a key the batch no longer holds is left out. */
export function retrySelection(all, failedKeys) {
  const want = new Set(failedKeys || []), seen = new Set(), out = []
  for (const it of all || []) { if (want.has(it.key) && !seen.has(it.key)) { seen.add(it.key); out.push(it) } }
  return out
}
/** Why Retry Failed is off, as an i18n key under queue.gen ('' when it can be used): a batch is running, nothing failed, no pod is known, or its pod is not running. `pod` is the pod row from the pods store (or undefined). */
export function retryBlock({ running, failedCount, podId, pod }) {
  if (running) return 'retryBlockedRunning'
  if (!failedCount) return 'retryBlockedNone'
  if (!podId) return 'retryBlockedNoPod'
  if (!pod) return 'retryBlockedNoPod'
  if (pod.status !== 'running') return 'retryBlockedStopped'
  return ''
}
/** The failures grouped by their plain-words reason, biggest group first: [{ text, n, names: first `max` names }]. `reasonOf(f)` gives the text (reasonText with the translator). */
export function groupFailures(failures, reasonOf, max = 3) {
  const by = new Map()
  for (const f of failures || []) { const text = reasonOf(f); const g = by.get(text) || { text, n: 0, names: [] }; g.n++; if (g.names.length < max) g.names.push(f.name); by.set(text, g) }
  return [...by.values()].sort((a, b) => b.n - a.n)
}
/** The text `Copy Failures` puts on the clipboard: the batch line, then one line per failure (name, pod, reason); redacted already. */
export function failuresText(batch, reasonOf, line) {
  const rows = (batch?.failures || []).map((f) => [f.name, f.pod_name, reasonOf(f)].filter(Boolean).join(' | '))
  const more = batch && batch.failed > rows.length ? [`(+${batch.failed - rows.length} more, in the History)`] : []
  return [line, ...rows, ...more].join('\n')
}
