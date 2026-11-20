// Queue and History as a log file: one flat table (CSV) or a printable page (PDF). Pure functions; the window decides where the file goes.
export const COLS = [['section', 'Section'], ['when', 'When'], ['id', 'Id'], ['what', 'What'], ['state', 'State'], ['where', 'Where'], ['detail', 'Detail'], ['error', 'Error']]
const s = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
const row = (section, o) => ({ section, when: s(o.when), id: s(o.id), what: s(o.what), state: s(o.state), where: s(o.where), detail: s(o.detail), error: s(o.error) })

/** Every part of the Queue as rows: the import tasks and their events, volume jobs, syncs are left to their own log, publish jobs, render jobs, graph failures. */
export function queueRows({ tasks = [], vjobs = [], publish = [], renders = [], failures = [] } = {}) {
  const out = []
  for (const t of tasks) {
    out.push(row('task', { when: t.started_at || t.created_at, id: t.id, what: `${t.kind}${t.shot ? ` ${t.shot}` : ''} (${t.round || ''})`, state: t.state, where: t.pod_name || t.pod_id, detail: t.stage || t.result || '', error: t.error }))
    for (const e of t.events || []) out.push(row('task event', { when: e.at, id: t.id, what: `${t.kind}${t.shot ? ` ${t.shot}` : ''}`, detail: e.text }))
  }
  for (const j of vjobs) out.push(row('volume job', { when: j.started_at, id: j.id, what: `${j.kind} ${j.volume_id || ''}`, state: j.state, detail: j.summary || j.stage, error: j.error }))
  for (const j of publish) out.push(row('publish', { when: j.started_at || j.created_at, id: j.job_id || j.id, what: j.round || j.summary || '', state: j.state, where: j.pod || j.adapter, detail: `${j.files_done ?? ''}/${j.files_total ?? ''} files, ${((j.bytes_done || 0) / 1e9).toFixed(2)} GB`, error: j.error }))
  for (const j of renders) out.push(row('render', { when: j.started_at || j.created_at, id: j.id || j.job_id, what: j.kind || j.name || '', state: j.state, where: j.pod_id, detail: j.summary || j.stage, error: j.error }))
  for (const f of failures) out.push(row('failure', { when: f.at, id: f.id, what: `${f.round || ''} ${f.shot || ''} ${f.graph || ''}`.trim(), state: f.stage, where: f.pod_name || f.pod_id, detail: f.node_type ? `${f.node_type}: ${f.message}` : f.message }))
  return out
}

/** History events (pod, job and change) as the same rows. */
export function historyRows(events = []) {
  return events.map((e) => row(e.kind, { when: e.ts, what: e.kind === 'pod' ? `${e.action} ${e.name || ''}` : e.kind === 'job' ? `${e.job} ${e.what || ''}` : `${e.area} ${e.action} ${e.what || ''}`, state: e.state || e.action, where: e.pod_name || e.pod_id, detail: e.detail || (e.files != null ? `${e.files} files` : ''), error: e.error }))
}

const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
export const toCsv = (rows) => [COLS.map((c) => c[1]).join(','), ...rows.map((r) => COLS.map((c) => q(r[c[0]])).join(','))].join('\r\n') + '\r\n'

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
/** A printable page: no scripts, just a table, for the PDF printer. */
export function toHtml(title, rows, now = new Date()) {
  const head = COLS.map((c) => `<th>${esc(c[1])}</th>`).join('')
  const body = rows.map((r) => `<tr>${COLS.map((c) => `<td>${esc(r[c[0]])}</td>`).join('')}</tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:9px -apple-system,Helvetica,Arial,sans-serif;color:#111}h1{font-size:14px;margin:0 0 2px}p{margin:0 0 8px;color:#555}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:2px 4px;text-align:left;vertical-align:top;word-break:break-word}th{background:#eee}tr{page-break-inside:avoid}thead{display:table-header-group}</style></head><body><h1>${esc(title)}</h1><p>Exported ${esc(now.toISOString())} · ${rows.length} rows</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
}
export const stamp = (now = new Date()) => now.toISOString().slice(0, 10)
