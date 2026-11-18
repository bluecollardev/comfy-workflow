// Pure helpers for the Auto sync banner and the card button (docs/ADR-046). No Vue here: node --test reads this file.

/** 1.2 GB, 38 MB, 512 B: binary units, one decimal above bytes. */
export function fmtBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, Number(n)), i = 0
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++ }
  return `${i ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}
/** 38 MB/s, or '' when there is no rate yet. */
export function fmtRate(bps) { return bps > 0 ? `${fmtBytes(bps)}/s` : '' }
/** 0..100, whole number, from bytes when known, else from files; 0 when nothing is known. */
export function percent(item) {
  const a = item?.bytes_total > 0 ? [item.bytes_done, item.bytes_total] : item?.files_total > 0 ? [item.files_done, item.files_total] : null
  if (!a) return 0
  return Math.max(0, Math.min(100, Math.round(((a[0] || 0) / a[1]) * 100)))
}
/** Is this item to be shown now? done items go ~8 s after finished_at (the clock is a parameter); idle never shows. */
export function visible(item, now = Date.now(), doneMs = 8000) {
  if (!item) return false
  if (item.state === 'idle') return false
  if (item.state === 'done') { const f = Date.parse(item.finished_at || ''); return Number.isNaN(f) ? true : now - f < doneMs }
  return ['waiting', 'syncing', 'needs_approval', 'error'].includes(item.state)
}
/** An item that wants the 2 s poll. */
export const isActive = (item) => !!item && ['waiting', 'syncing', 'needs_approval'].includes(item.state)
