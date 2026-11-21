// Save feedback shared by every editor (docs: v1.7.0): what changed (the sections of the configuration whose value differs), the time, and a check that the change really landed after the core was asked again.
const LABELS = { auto_publish: 'Auto-publish', render: 'Render', outputs: 'Outputs window', delivery_prepare: 'Prepare For Delivery', env: 'Environment', image: 'Image', network_volume_id: 'Volume', mount_path: 'Volume', data_center_id: 'Volume', idle_stop_minutes: 'Idle stop', sync_shared: 'Sync', pull_shared: 'Sync', sync_exclude: 'Sync', sync_exclude_delete: 'Sync', folder_excludes: 'Sync', auto_sync: 'Auto sync', apply_by_default: 'Folders', pull_any_card: 'Pods' }
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const leaves = (v, p = '', out = {}) => { if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) leaves(v[k], `${p}.${k}`, out); else out[p] = JSON.stringify(v ?? null); return out }
const emptyish = (v) => v == null || v === '' || v === false || v === 0 || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(emptyish))
/** A key changed: a value the core already had differs, a value went away, or a new key brought something that is not empty. Defaults a form adds around an untouched section are not a change. */
const keyChanged = (a, b, k) => {
  if (same(a?.[k], b?.[k])) return false
  const x = leaves(a?.[k]), y = leaves(b?.[k])
  if (Object.keys(x).some((p) => !(p in y) || x[p] !== y[p])) return !(a?.[k] === undefined && emptyish(b?.[k])) && !(k in (a || {}) ? false : emptyish(b?.[k]))
  return !(k in (a || {})) && !emptyish(b?.[k])
}
const keysOf = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => k !== 'dry_run')
/** The section names whose value differs between two configurations, each once, in the order met ('Settings' for a key without a name). */
export function changedSections(before, after) {
  const out = []
  for (const k of keysOf(before, after)) { if (!keyChanged(before, after, k)) continue; const l = LABELS[k] || 'Settings'; if (!out.includes(l)) out.push(l) }
  return out
}
/** The keys of `sent` that really changed from `before`. */
export const changedKeys = (before, sent) => keysOf(before, sent).filter((k) => k in (sent || {}) && keyChanged(before, sent, k))
/** After reloading: the changed keys the core still reads as they were (or lacks): the change did not land. */
export const notLanded = (before, loaded, keys, sent = {}) => keys.filter((k) => same(before?.[k], loaded?.[k]) || (loaded?.[k] === undefined && !emptyish(sent?.[k])))
export const clockNow = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
