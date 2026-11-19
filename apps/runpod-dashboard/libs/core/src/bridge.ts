/**
 * Remote Instances (docs/ADR-054): the pure part of the status bridge. A snapshot of this instance is built from a WHITELIST of fields (nothing is
 * copied wholesale and redacted after), free text goes through the redactor, and a follower judges a snapshot's age (live / late / offline).
 * No I/O here: the publisher writes the JSON to the exchange bucket, the follower reads it; both call these functions.
 */
export const SCHEMA = 'rpm-bridge-1'
export const INTERVAL_S = 30
export const EVENTS_KEEP = 200
export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

export interface PodIn { id?: string; name?: string; gpu?: string; status?: string; cost_per_hr?: number; round?: string | null; idle_stop_min?: number | null; [k: string]: unknown }
export interface TaskIn { id?: string; kind?: string; shot?: string; round?: string; state?: string; progress?: string; [k: string]: unknown }
export interface PendingIn { shot?: string; version?: string; state?: string; due_at?: string; files?: number; bytes?: number; [k: string]: unknown }
export interface EventIn { time?: string; kind?: string; text?: string; [k: string]: unknown }
export interface Input {
  name: string
  appVersion: string
  now: number
  pods?: PodIn[]
  tasks?: TaskIn[]
  autopublish?: { enabled?: boolean; dry_run?: boolean; pending?: PendingIn[]; uploaded_today?: number }
  spend?: { today_usd?: number; cap_usd?: number | null }
  events?: EventIn[]
  /** this PC's home folder, replaced in free text */
  home?: string
}
export interface Snapshot {
  schema: typeof SCHEMA
  sent_at: string
  interval_s: number
  from: { name: string; app_version: string }
  pods: { id: string; name: string; gpu: string; status: string; cost_per_hr: number | null; round: string | null; idle_stop_min: number | null }[]
  queue: { counts: Record<string, number>; tasks: { id: string; kind: string; shot: string; round: string; state: string; progress: string }[] }
  autopublish: { enabled: boolean; dry_run: boolean; uploaded_today: number; pending: { shot: string; version: string; state: string; due_at: string; files: number; bytes: number }[] }
  spend: { today_usd: number | null; cap_usd: number | null }
  events: { time: string; kind: string; text: string }[]
}

/** Free text leaving this PC: URLs (presigned links carry credentials), AWS key ids, long token-like strings and the home folder go. */
export function redactText(text: unknown, home?: string): string {
  let t = String(text ?? '')
  if (home && home.length > 1) t = t.split(home).join('~')
  t = t.replace(/https?:\/\/\S+/gi, '<url>')
  t = t.replace(/\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g, '<key>')
  t = t.replace(/\b[A-Za-z0-9+/_=-]{32,}\b/g, '<token>')
  t = t.replace(/\/Users\/[^/\s]+/g, '/Users/<user>').replace(/\/home\/[^/\s]+/g, '/home/<user>')
  return t.slice(0, 500)
}
const str = (v: unknown, home?: string, max = 120): string => redactText(v, home).slice(0, max)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function validName(name: string): boolean { return NAME_RE.test(name) }

/** The snapshot of this instance. Only the fields below exist in the output, whatever the inputs carry. */
export function buildSnapshot(i: Input): Snapshot {
  if (!validName(i.name)) throw new Error(`The instance name is lowercase letters, digits, - and _ (up to 40): "${i.name}"`)
  const h = i.home
  const tasks = (i.tasks ?? []).map((t) => ({ id: str(t.id, h, 80), kind: str(t.kind, h, 40), shot: str(t.shot, h, 80), round: str(t.round, h, 80), state: str(t.state, h, 40), progress: str(t.progress, h, 160) }))
  const counts: Record<string, number> = {}
  for (const t of tasks) counts[t.state || 'unknown'] = (counts[t.state || 'unknown'] ?? 0) + 1
  const ap = i.autopublish ?? {}
  return {
    schema: SCHEMA,
    sent_at: new Date(i.now).toISOString(),
    interval_s: INTERVAL_S,
    from: { name: i.name, app_version: str(i.appVersion, h, 40) },
    pods: (i.pods ?? []).map((p) => ({ id: str(p.id, h, 40), name: str(p.name, h, 80), gpu: str(p.gpu, h, 80), status: str(p.status, h, 40), cost_per_hr: num(p.cost_per_hr), round: p.round ? str(p.round, h, 80) : null, idle_stop_min: num(p.idle_stop_min) })),
    queue: { counts, tasks: tasks.slice(0, 100) },
    autopublish: {
      enabled: !!ap.enabled, dry_run: ap.dry_run !== false, uploaded_today: num(ap.uploaded_today) ?? 0,
      pending: (ap.pending ?? []).slice(0, 50).map((p) => ({ shot: str(p.shot, h, 80), version: str(p.version, h, 20), state: str(p.state, h, 40), due_at: str(p.due_at, h, 40), files: num(p.files) ?? 0, bytes: num(p.bytes) ?? 0 })),
    },
    spend: { today_usd: num(i.spend?.today_usd), cap_usd: num(i.spend?.cap_usd) },
    events: (i.events ?? []).slice(-EVENTS_KEEP).map((e) => ({ time: str(e.time, h, 40), kind: str(e.kind, h, 40), text: str(e.text, h, 300) })),
  }
}

export type Freshness = 'live' | 'late' | 'offline'
/** Under 2 intervals old is live, under 10 is late, else offline (a card says "last heard N min ago"; it is a state, not an error). */
export function freshness(sentAt: string | undefined, now: number, intervalS = INTERVAL_S): { state: Freshness; age_s: number | null } {
  const t = sentAt ? Date.parse(sentAt) : NaN
  if (!Number.isFinite(t)) return { state: 'offline', age_s: null }
  const age = Math.max(0, Math.round((now - t) / 1000))
  return { state: age < 2 * intervalS ? 'live' : age < 10 * intervalS ? 'late' : 'offline', age_s: age }
}

/** Parse a file read from the bucket; anything that is not our schema is refused, never half-shown. */
export function parseSnapshot(text: string): Snapshot | null {
  try { const j = JSON.parse(text); return j && j.schema === SCHEMA && j.from && typeof j.from.name === 'string' && typeof j.sent_at === 'string' ? (j as Snapshot) : null } catch { return null }
}
export const keyFor = (prefix: string, name: string, file: 'status.json' | 'events.jsonl'): string => `${prefix.replace(/\/+$/, '')}/${name}/${file}`
