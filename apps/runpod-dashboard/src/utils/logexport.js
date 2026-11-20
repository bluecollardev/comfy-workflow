// Queue and History as a log file: one flat table (CSV) or a printable page (PDF). Pure functions; the window decides where the file goes.
// Columns follow the table people paste into reports: Time, Kind, What, Pod, State, Files / size, Error, Via. Errors are whole, never cut.
export const COLS = [['when', 'Time'], ['kind', 'Kind'], ['what', 'What'], ['pod', 'Pod'], ['state', 'State'], ['size', 'Files / size'], ['error', 'Error'], ['via', 'Via']]
const s = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const row = (kind, o) => ({ kind, when: s(o.when), what: s(o.what), pod: s(o.pod), state: s(o.state), size: s(o.size), error: s(o.error), via: s(o.via) })
const gb = (b) => `${((b || 0) / 1e9).toFixed(2)} GB`
const join = (...a) => a.filter((x) => x != null && String(x).trim() !== '').join('\n')

/** Every part of the Queue as rows: the import tasks and their events, volume jobs, publish jobs (with each shot and each failed file), render jobs (with each failed sequence), graph failures. */
export function queueRows({ tasks = [], vjobs = [], publish = [], renders = [], failures = [] } = {}) {
  const out = []
  for (const t of tasks) {
    const what = `${t.kind}${t.shot ? ` ${t.shot}` : ''} (${t.round || ''})`
    out.push(row('task', { when: t.started_at || t.created_at, what: join(what, t.stage || t.result), pod: t.pod_name || t.pod_id, state: t.state, error: t.error }))
    for (const e of t.events || []) out.push(row('task event', { when: e.at, what: join(what, e.text), pod: t.pod_name || t.pod_id }))
  }
  for (const j of vjobs) out.push(row('volume job', { when: j.started_at, what: join(`${j.kind} ${j.volume_id || ''}`.trim(), j.summary || j.stage), state: j.state, error: j.error }))
  for (const j of publish) {
    const kids = Array.isArray(j.children) ? j.children : [], failed = Array.isArray(j.failed) ? j.failed : []
    const errs = join(j.error, ...failed.map((f) => `${f.path}: ${f.error}`), ...kids.filter((c) => c.error).map((c) => `${c.shot}: ${c.error}`))
    out.push(row('publish', { when: j.started_at || j.created_at, what: join(`publish ${j.files_total ?? ''} files to ${(j.targets || []).join(' + ')}`, j.summary, j.dest), pod: j.adapter === 'pod' ? j.pod : '', state: j.state, size: `${j.files_done ?? 0} of ${j.files_total ?? 0} files · ${gb(j.bytes_done)}`, error: errs, via: j.adapter === 'pod' ? `${j.pod_files ?? 0} via pod ${j.pod || ''}${j.pc_files ? `, ${j.pc_files} via this PC` : ''}`.trim() : j.adapter === 'pc' ? `${j.pc_files ?? 0} via this PC` : '' }))
    for (const c of kids) out.push(row('publish shot', { when: j.started_at, what: join(c.shot, c.clip), state: c.state, size: `${c.files_done ?? 0} of ${c.files ?? 0} files · ${gb(c.bytes_done)}`, error: c.error }))
  }
  for (const j of renders) {
    const bad = (j.sequences || []).filter((x) => x.error)
    out.push(row('render', { when: j.started_at || j.created_at, what: join(`${j.kind || ''} ${(j.sequences || []).length} sequences`.trim(), j.summary), pod: j.pod_name || j.pod_id, state: j.state, size: `${j.frames_done ?? 0} of ${j.frames_total ?? 0} frames`, error: join(j.error, ...bad.map((x) => `${x.clip_name || x.name}: ${x.error}`)) }))
  }
  for (const f of failures) out.push(row('failure', { when: f.at, what: join(`${f.round || ''} ${f.shot || ''} ${f.graph || ''}`.trim(), f.node_type ? `${f.node_type}` : ''), pod: f.pod_name || f.pod_id, state: f.stage, error: f.message }))
  return out
}

/** History events (pod, job and change) as the same rows. */
export function historyRows(events = []) {
  return events.map((e) => row(e.kind, { when: e.ts, what: join(e.kind === 'pod' ? `${e.action} ${e.name || ''}` : e.kind === 'job' ? `${e.job} ${e.what || ''}` : `${e.area} ${e.action} ${e.what || ''}`, e.detail), pod: e.pod_name || e.pod_id, state: e.state || e.action, size: e.files != null ? `${e.files} files${e.bytes ? ` · ${gb(e.bytes)}` : ''}` : '', error: e.error }))
}

const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsv = (rows) => [COLS.map((c) => c[1]).join(','), ...rows.map((r) => COLS.map((c) => q(r[c[0]])).join(','))].join('\r\n') + '\r\n'

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
/** A printable page: no scripts, just a table, for the PDF printer. */
export function toHtml(title, rows, now = new Date()) {
  const head = COLS.map((c) => `<th>${esc(c[1])}</th>`).join('')
  const body = rows.map((r) => `<tr>${COLS.map((c) => `<td>${esc(r[c[0]])}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:9px -apple-system,Helvetica,Arial,sans-serif;color:#111}h1{font-size:14px;margin:0 0 2px}p{margin:0 0 8px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top;word-break:break-word;white-space:pre-wrap}th{background:#eee}tr{page-break-inside:avoid}thead{display:table-header-group}</style></head><body><h1>${esc(title)}</h1><p>Exported ${esc(now.toISOString())} · ${rows.length} rows</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}
export const stamp = (now = new Date()) => now.toISOString().slice(0, 10)
