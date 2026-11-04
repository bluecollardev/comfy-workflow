/**
 * History: what happened, kept on this PC in ~/.config/runpod-pod-manager/history.jsonl, one JSON line per event, newest last.
 *  - `pod` events: a pod was created, started (resumed), stopped, recreated, renamed or deleted, with its card, datacenter and hourly price.
 *  - `job` events: a round pull, a delete of a round, or a sync ended (done, failed, cancelled), with its round or folders, pod, files and bytes.
 * Spend is not stored twice: `spend()` is worked out from the pod events (a pod costs its hourly price for the time between a start and the next stop).
 * ComfyUI's own run history is not kept here: it lives on the pod and is read from it (`runs`).
 * Recording never throws: a history that cannot be written must not stop a pod from starting.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { historyFile } from './paths.js'

export type PodAction = 'created' | 'started' | 'stopped' | 'recreated' | 'renamed' | 'deleted'
export interface PodEvent { ts: string; kind: 'pod'; action: PodAction; pod_id: string; name: string; gpu?: string; datacenter?: string; cost_per_hr?: number | null; detail?: string }
export interface JobEvent { ts: string; kind: 'job'; job: 'pull' | 'remove' | 'sync'; state: 'done' | 'failed' | 'cancelled'; started_at?: string; what: string; pod_id?: string; pod_name?: string; files?: number; bytes?: number; error?: string }
export type HistoryEvent = PodEvent | JobEvent
type Without<T> = T extends unknown ? Omit<T, 'ts'> & { ts?: string } : never

const MAX_LINES = 5000   // the file is trimmed to the newest this many when it grows past 1.5 times it

export function record(e: Without<HistoryEvent>, now: () => Date = () => new Date()): void {
  try {
    const f = historyFile()
    mkdirSync(dirname(f), { recursive: true })
    appendFileSync(f, JSON.stringify({ ...e, ts: e.ts ?? now().toISOString() }) + '\n')
    trim(f)
  } catch { /* never in the way */ }
}
function trim(f: string) {
  try {
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    if (lines.length > MAX_LINES * 1.5) writeFileSync(f, lines.slice(-MAX_LINES).join('\n') + '\n')
  } catch { /* the next write tries again */ }
}

/** The events, newest first. `kind` narrows to pod or job events; `limit` defaults to 200. */
export function list(opts: { kind?: 'pod' | 'job'; limit?: number } = {}): HistoryEvent[] {
  const f = historyFile()
  if (!existsSync(f)) return []
  const out: HistoryEvent[] = []
  for (const line of readFileSync(f, 'utf8').split('\n')) { if (!line) continue; try { const e = JSON.parse(line) as HistoryEvent; if (!opts.kind || e.kind === opts.kind) out.push(e) } catch { /* a torn line */ } }
  return out.reverse().slice(0, Math.max(1, Math.min(opts.limit ?? 200, MAX_LINES)))
}

export interface Session { pod_id: string; name: string; gpu?: string; datacenter?: string; cost_per_hr: number; from: string; to: string | null; hours: number; cost: number }
export interface Spend { total: number; running_now: number; sessions: Session[]; by_day: { day: string; cost: number }[]; note: string }

/** What the pods cost, from their start and stop events: a session is a start (or a create) to the next stop, recreate or delete; a pod still running counts up to `now`.
 *  A price of 0 or none is a session with no cost (a stopped pod's price is only an estimate and is never counted). Estimates: RunPod bills by the second at the price listed then. */
export function spend(now: Date = new Date()): Spend {
  const events = list({ kind: 'pod', limit: MAX_LINES }).reverse() as PodEvent[]
  const open = new Map<string, { ev: PodEvent; from: Date }>()
  const sessions: Session[] = []
  const close = (id: string, to: Date | null) => {
    const o = open.get(id); if (!o) return
    open.delete(id)
    const end = to ?? now
    const hours = Math.max(0, (end.getTime() - o.from.getTime()) / 3_600_000)
    const rate = o.ev.cost_per_hr ?? 0
    sessions.push({ pod_id: id, name: o.ev.name, gpu: o.ev.gpu, datacenter: o.ev.datacenter, cost_per_hr: rate, from: o.from.toISOString(), to: to ? to.toISOString() : null, hours: Math.round(hours * 100) / 100, cost: Math.round(hours * rate * 100) / 100 })
  }
  for (const e of events) {
    const t = new Date(e.ts)
    if (e.action === 'created' || e.action === 'started') { close(e.pod_id, t); open.set(e.pod_id, { ev: e, from: t }) }
    else if (e.action === 'stopped' || e.action === 'deleted' || e.action === 'recreated') close(e.pod_id, t)
  }
  const running = [...open.keys()]
  for (const id of running) close(id, null)
  sessions.sort((a, b) => b.from.localeCompare(a.from))
  const byDay = new Map<string, number>()
  for (const s of sessions) byDay.set(s.from.slice(0, 10), (byDay.get(s.from.slice(0, 10)) ?? 0) + s.cost)
  return {
    total: Math.round(sessions.reduce((n, s) => n + s.cost, 0) * 100) / 100,
    running_now: sessions.filter((s) => s.to === null).length,
    sessions, by_day: [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 })),
    note: 'Worked out from this app\'s own pod events at the price listed when each pod started; pods started or stopped outside this app are not seen. RunPod\'s console has the bill.',
  }
}

// ----- export -----

export interface HistoryExport { name: string; mime: string; text: string }
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csv = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'

/** The history as a file. `format` json (one document: events and spend) or csv; `what` for csv: 'events' (pod and job events, one table) or 'spend' (one row per pod session).
 *  Newest first, up to the whole file. Read-only: nothing is changed. */
export function exportHistory(opts: { format?: 'json' | 'csv'; what?: 'events' | 'spend'; now?: Date } = {}): HistoryExport {
  const now = opts.now ?? new Date()
  const day = now.toISOString().slice(0, 10)
  const format = opts.format === 'csv' ? 'csv' : 'json'
  if (format === 'json') return { name: `pod-manager-history-${day}.json`, mime: 'application/json', text: JSON.stringify({ format: 'pod-manager-history', exported_at: now.toISOString(), events: list({ limit: MAX_LINES }), spend: spend(now) }, null, 2) + '\n' }
  if (opts.what === 'spend') {
    return { name: `pod-manager-spend-${day}.csv`, mime: 'text/csv', text: csv(['pod_id', 'name', 'gpu', 'datacenter', 'cost_per_hr', 'from', 'to', 'hours', 'cost'], spend(now).sessions.map((s) => [s.pod_id, s.name, s.gpu, s.datacenter, s.cost_per_hr, s.from, s.to ?? '', s.hours, s.cost])) }
  }
  const rows = list({ limit: MAX_LINES }).map((e) => e.kind === 'pod'
    ? [e.ts, 'pod', e.action, e.name, e.pod_id, e.gpu, e.datacenter, e.cost_per_hr, '', '', '', e.detail]
    : [e.ts, 'job', e.job, e.what, e.pod_id, '', '', '', e.state, e.files, e.bytes, e.error])
  return { name: `pod-manager-history-${day}.csv`, mime: 'text/csv', text: csv(['time', 'kind', 'action', 'name', 'pod_id', 'gpu', 'datacenter', 'cost_per_hr', 'state', 'files', 'bytes', 'detail'], rows) }
}
