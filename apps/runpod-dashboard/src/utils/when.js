// When a job was attempted: 'Started 19 Nov 14:26:15' (just the clock for today), 'Finished 14:26:37 · took 22 s', a relative 'x min ago' for a tooltip. A missing or invalid time is '' (never 'Invalid Date').
const valid = (iso) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d }
const pad = (n) => String(n).padStart(2, '0')
const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
/** '14:26:15' for today, '19 Nov 14:26:15' for an older day, '' when unknown. */
export function whenText(iso, now = new Date()) {
  const d = valid(iso)
  if (!d) return ''
  return sameDay(d, now) ? clock(d) : `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(d)}`
}
/** '22 s', '3 min 5 s', '1 h 2 min'; '' for a negative or unknown span. */
export function durationText(startIso, endIso) {
  const a = valid(startIso), b = valid(endIso)
  if (!a || !b) return ''
  const s = Math.round((b.getTime() - a.getTime()) / 1000)
  if (s < 0) return ''
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
  return `${Math.floor(s / 3600)} h${Math.floor((s % 3600) / 60) ? ` ${Math.floor((s % 3600) / 60)} min` : ''}`
}
/** 'just now', '3 min ago', '2 h ago', '4 days ago'; '' when unknown. */
export function agoShort(iso, now = Date.now()) {
  const d = valid(iso)
  if (!d) return ''
  const m = Math.max(0, Math.round((now - d.getTime()) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
/** The two lines of a card: { started: 'Started 19 Nov 14:26:15', finished: 'Finished 14:26:37 · took 22 s', ago }. Empty strings for what the core did not give. */
export function attempt(job, now = new Date()) {
  const s = job?.started_at, f = job?.finished_at
  const st = whenText(s, now), fi = whenText(f, now), took = durationText(s, f)
  return { started: st ? `Started ${st}` : '', finished: fi ? `Finished ${fi}${took ? ` · took ${took}` : ''}` : '', ago: agoShort(s, now.getTime ? now.getTime() : now) }
}
