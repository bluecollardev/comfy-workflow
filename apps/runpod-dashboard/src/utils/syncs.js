// Pure helpers for the Sync explorer and the Sync logs window (docs/ADR-046). No Vue here: node --test reads this file.
import { fmtBytes } from './autosync.js'

/** 0..100 whole number of done out of total; 0 when total is unknown. */
export function pct(done, total) {
  if (!(total > 0)) return 0
  return Math.max(0, Math.min(100, Math.round(((done || 0) / total) * 100)))
}
/** A file in flight: the core's own percent when it sends one, else worked out from its bytes. */
export const filePercent = (f) => (f?.percent != null && !Number.isNaN(Number(f.percent)) ? Math.max(0, Math.min(100, Math.round(Number(f.percent)))) : pct(f?.bytes_done, f?.bytes_total))
/** A run: from bytes when known, else from files. */
export const runPercent = (r) => (r?.bytes_total > 0 ? pct(r.bytes_done, r.bytes_total) : pct(r?.files_done, r?.files_total))
/** 45 s, 3 min 05 s, 1 h 02 min; '' when unknown. */
export function fmtEta(s) {
  if (s == null || Number.isNaN(Number(s)) || s < 0) return ''
  s = Math.round(s)
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`
}
/** 18:20 (local, 24 h) from an ISO time; '' when there is none. */
export function clock(iso) {
  const d = new Date(iso || '')
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
/** 18:20:05 */
export function clockSec(iso) {
  const d = new Date(iso || '')
  return Number.isNaN(d.getTime()) ? '' : `${clock(iso)}:${String(d.getSeconds()).padStart(2, '0')}`
}
/** A long cursor cut to its first 8 characters. */
export const shortCursor = (c) => (c == null || c === '' ? '' : String(c).length > 10 ? `${String(c).slice(0, 8)}…` : String(c))
/** 7 for 6500 ms left (rounded up); 0 when none. */
export const secondsLeft = (ms) => (ms > 0 ? Math.ceil(ms / 1000) : 0)
export const isAuto = (trigger) => String(trigger || '').startsWith('auto-sync')
/** The last segment of a path. */
export const baseName = (p) => String(p || '').split('/').pop()
/** A history entry's detail: text as is, an object as 'files 3, bytes 1.2 KB'. */
export function detailText(d) {
  if (d == null || d === '') return ''
  if (typeof d === 'string') return d
  if (typeof d === 'object') return Object.entries(d).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k.replace(/_/g, ' ')} ${/bytes$/.test(k) ? fmtBytes(v) : v}`).join(', ')
  return String(d)
}
/** The `level` the core is asked for: '' (all), 'warn' (warnings and errors) or 'error'. */
export const levelParam = (choice) => (choice === 'warn' || choice === 'error' ? choice : '')
