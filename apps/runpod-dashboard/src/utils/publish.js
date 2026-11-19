/** Publishing (S3 and Slack), pure helpers: the destination preview, the key a file gets, the Slack message with its placeholders, the buttons' reasons. `npm run dpx:test`. */
export const PLACEHOLDERS = ['shot', 'version', 'files', 'size', 'links', 'dest', 'who', 'channel']
/** s3://bucket/prefix/ from the two fields (leading and trailing slashes do not matter; no bucket: ''). */
export function s3Dest(bucket, prefix = '') {
  const b = String(bucket || '').trim()
  if (!b) return ''
  const p = String(prefix || '').trim().replace(/^\/+|\/+$/g, '')
  return p ? `s3://${b}/${p}/` : `s3://${b}/`
}
/** The key of a local file (its path under the output folder) under the prefix. */
export function s3Key(prefix, rel) {
  const p = String(prefix || '').trim().replace(/^\/+|\/+$/g, ''), r = String(rel || '').replace(/^\/+/, '')
  return p ? `${p}/${r}` : r
}
/** A message template with {placeholders} filled; an unknown placeholder stays as typed. */
export const fillMessage = (tpl, vars = {}) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m))
/** The placeholders a template uses that the app does not know. */
export const unknownPlaceholders = (tpl) => [...new Set([...String(tpl || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => !PLACEHOLDERS.includes(k)))]
/** A Slack channel as the app wants it: '#name' (a bare name gets the #). */
export const channelName = (c) => { const s = String(c || '').trim(); return !s ? '' : /^[#@]/.test(s) ? s : `#${s}` }
/** Whether a target can be used, and the one-line reason when not. */
export function targetState(settings, id) {
  const t = settings?.[id]
  if (!t) return { ok: false, reason: 'Not configured' }
  return t.ready ? { ok: true, reason: '' } : { ok: false, reason: t.problem || 'Not configured' }
}
/** 'expires 22 Nov 2026 10:00' from an ISO time; '' when none. */
export function expiryText(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
export const PUBLISH_ACTIVE = ['queued', 'uploading', 'posting']
export const publishActive = (j) => !!j && PUBLISH_ACTIVE.includes(j.state)
/** The path of a deliverable's or proxy's file under the local output folder (what the Publish window pre-selects): `output/` and `comfy-shared/output/` are cut off. */
export const localPath = (file) => String(file || '').replace(/^\/+/, '').replace(/^(comfy-shared\/)?output\//, '')
