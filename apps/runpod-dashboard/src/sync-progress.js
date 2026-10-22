/**
 * How a sync's progress is read, shared by the pods store, the card and the Sync modal. The main process sends one
 * event per rsync line (libs/core/src/syncrun.ts); `fold` keeps the running state, the rest turns it into a bar and a
 * label. The measure is files (Lucas, 2026-10-21): the ones rsync names as it starts them plus the ones it complains
 * about, over the folder's total from the listing pass, or openrsync's own count when the listing gave none. Bytes,
 * rate and remaining time ride along when the lines carry them.
 */
export const fresh = (steps = 0) => ({
  steps, step: 0, key: '', listing: false, complete: false, done: false,
  files: 0, errors: 0,                                   // the whole run
  stepFiles: 0, stepErrors: 0, stepTotalFiles: null, stepTotalBytes: null,
  runFilesBefore: 0, runTotalFiles: null,                // folders already done, and the run's total when every folder's is known
  runBytes: 0, runTotalBytes: null, rate: null, eta: null,
  filePercent: null, currentFile: '',
})

/** One event into the state; returns it. */
export function fold(s, ev) {
  switch (ev.kind) {
    case 'plan': s.steps = ev.steps.length; break
    case 'listing': s.key = ev.key; s.listing = true; break
    case 'totals': s.runTotalFiles = ev.total_files ?? null; s.runTotalBytes = ev.total_bytes ?? null; break
    case 'step': Object.assign(s, { listing: false, complete: false, step: s.step + 1, key: ev.key, stepFiles: 0, stepErrors: 0, stepTotalFiles: ev.total_files ?? null, stepTotalBytes: ev.total_bytes ?? null, filePercent: null, currentFile: '' }); break
    case 'line': if (ev.total_files && s.stepTotalFiles == null) s.stepTotalFiles = ev.total_files; break   // openrsync's "Transfer starting: N files"
    case 'file': s.files += 1; s.stepFiles += 1; s.currentFile = ev.path || ''; s.filePercent = 0; break
    case 'problem': case 'error': s.errors += 1; s.stepErrors += 1; break
    case 'progress':
      if (ev.run_bytes_done != null) s.runBytes = ev.run_bytes_done
      if (ev.rate_bps) s.rate = ev.rate_bps
      if (ev.eta_s != null) s.eta = ev.eta_s
      if (ev.file_percent != null) s.filePercent = ev.file_percent
      break
    case 'step-done': s.complete = true; s.runFilesBefore += s.stepTotalFiles ?? (s.stepFiles + s.stepErrors); s.filePercent = null; break
  }
  return s
}

export const stepDone = (s) => s.stepFiles + s.stepErrors
/** How far the current folder is, 0..1; null when its total is unknown and it is not finished. */
export function stepFraction(s) {
  if (s.complete) return 1
  return s.stepTotalFiles ? Math.min(1, stepDone(s) / s.stepTotalFiles) : null
}
/** The bar, 0..100: files over the whole run when every folder's total is known, else the folders counted equally;
 *  null while listing or when nothing is known about the folder under way (an indeterminate bar). Only ever climbs. */
export function barValue(s) {
  if (!s.steps || s.listing || !s.step) return null
  if (s.runTotalFiles) {
    const inStep = s.complete ? 0 : Math.min(stepDone(s), s.stepTotalFiles ?? stepDone(s))   // a finished folder is already in runFilesBefore
    return Math.min(100, Math.round(((s.runFilesBefore + inStep) / s.runTotalFiles) * 100))
  }
  const f = stepFraction(s)
  return f == null ? null : Math.round((((s.step - 1) + f) / s.steps) * 100)
}

export function formatBytes(n) {
  if (n == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, i = 0
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++ }
  return `${i ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
export function formatEta(s) {
  if (s == null) return ''
  if (s < 60) return `${Math.round(s)} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`
}
const n = (x) => Number(x).toLocaleString('en-US')
/** The pieces after the folder: "file 1,240 of 24,220", "1,238 ok", "2 errors", "12.4 GB of 81.0 GB", "2.3 MB/s", "~9 h left". */
export function detailParts(s, t) {
  const parts = [
    s.stepTotalFiles ? t('sync.fileOf', { n: n(stepDone(s)), total: n(s.stepTotalFiles) }) : t('sync.fileN', { n: n(stepDone(s)) }),
    t('sync.ok', { n: n(s.stepFiles) }),
    t('sync.errorsN', { n: n(s.stepErrors) }),
  ]
  if (s.runBytes) parts.push(s.runTotalBytes ? t('sync.bytesOf', { done: formatBytes(s.runBytes), total: formatBytes(s.runTotalBytes) }) : formatBytes(s.runBytes))
  if (s.rate) parts.push(t('sync.rate', { rate: formatBytes(s.rate) }))
  if (s.eta != null && s.runTotalBytes) parts.push(t('sync.eta', { eta: formatEta(s.eta) }))
  return parts
}
