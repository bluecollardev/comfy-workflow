/**
 * Sync rules (docs/ADR-069): a rule is (volume, event) -> destinations. `*` is the pseudo volume whose rules apply to any volume that has no rule of its own
 * for that event. A destination is a storage ({ type: 'storage', id }) or this PC ({ type: 'local' }, docs/ADR-072); `volume` is in the type for later and refused by set().
 * Stored in sync-rules.json (mode 0600, no keys in it). First read with no file: the old per-storage `events` and `volumes` (ADR-064/068) become rules once;
 * after that those storage fields are kept but ignored by sending.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { bad } from './errors.js'
import * as history from './history.js'
import { configDir } from './paths.js'
import * as storage from './storage.js'

export const EVENTS = ['generated', 'approved', 'published'] as const
export type Event = (typeof EVENTS)[number]
export type Dest = { type: 'storage'; id: string } | { type: 'volume'; id: string } | { type: 'local' }
export type RuleSet = Record<Event, Dest[]>
export const ALL = '*'
const VOLUME_ID = /^[A-Za-z0-9_-]{3,64}$/
interface File { rules: Record<string, Partial<Record<Event, Dest[]>>> }

export const rulesFile = () => process.env.SYNC_RULES_FILE || join(configDir(), 'sync-rules.json')
const file = rulesFile
let wasMigrated = false
/** True when the last load built the file from the old storage fields (for tests). */
export const migrated = (): boolean => wasMigrated
function write(f: File): void {
  const p = file(); mkdirSync(dirname(p), { recursive: true })
  const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(f, null, 1), { mode: 0o600 }); renameSync(tmp, p)
}
const sane = (v: unknown): Dest[] => (Array.isArray(v) ? v.filter((d): d is Dest => !!d && typeof d === 'object' && ((d as Dest).type === 'storage' || (d as Dest).type === 'volume' ? typeof (d as { id?: unknown }).id === 'string' : (d as Dest).type === 'local')) : [])
function load(): File {
  let raw: string | null = null
  try { raw = readFileSync(file(), 'utf8') } catch { /* missing */ }
  if (raw === null) {
    const f: File = { rules: {} }
    for (const r of storage.legacyEventRecords()) {
      for (const ev of r.events) for (const v of (r.volumes.length ? r.volumes : [ALL])) {
        const rs = (f.rules[v] ??= {}), l = (rs[ev] ??= [])
        if (!l.some((d) => d.type === 'storage' && d.id === r.id)) l.push({ type: 'storage', id: r.id })
      }
    }
    write(f); wasMigrated = true
    return f
  }
  wasMigrated = false
  try { const j = JSON.parse(raw); const out: File = { rules: {} }; for (const [k, v] of Object.entries(j?.rules && typeof j.rules === 'object' ? j.rules : {})) { const o: Partial<Record<Event, Dest[]>> = {}; for (const ev of EVENTS) if (Array.isArray((v as Record<string, unknown>)?.[ev])) o[ev] = sane((v as Record<string, unknown>)[ev]); out.rules[k] = o } return out } catch { return { rules: {} } }
}
const full = (o: Partial<Record<Event, Dest[]>> | undefined): RuleSet => ({ generated: [...(o?.generated ?? [])], approved: [...(o?.approved ?? [])], published: [...(o?.published ?? [])] })
const checkVolume = (v: unknown): string => { if (v === ALL) return ALL; if (typeof v !== 'string' || !VOLUME_ID.test(v)) throw bad("volume_id is a network volume id, or '*' for all volumes"); return v }

export interface Got { volume_id: string; rules: RuleSet; inherited?: Record<Event, boolean> }
export function get(volumeId: string): Got {
  const v = checkVolume(volumeId), f = load(), own = f.rules[v]
  if (v === ALL) return { volume_id: v, rules: full(own) }
  const star = f.rules[ALL]
  const inherited = { generated: !own?.generated && !!star?.generated?.length, approved: !own?.approved && !!star?.approved?.length, published: !own?.published && !!star?.published?.length }
  return { volume_id: v, rules: full(own), inherited }
}
export function all(): { rules: Record<string, RuleSet> } {
  const f = load(), out: Record<string, RuleSet> = {}
  for (const [k, v] of Object.entries(f.rules)) out[k] = full(v)
  return { rules: out }
}
export function set(volumeId: string, event: string, destinations: unknown): Got {
  const v = checkVolume(volumeId)
  if (!(EVENTS as readonly string[]).includes(event)) throw bad(`event is one of: ${EVENTS.join(', ')}`)
  if (!Array.isArray(destinations)) throw bad('destinations is a list of { type: "storage", id }')
  const out: Dest[] = []
  for (const d of destinations as unknown[]) {
    const t = (d as { type?: unknown })?.type
    if (t === 'local') { if (!out.some((x) => x.type === 'local')) out.push({ type: 'local' }); continue }   // docs/ADR-072
    if (t === 'volume') throw bad('Not built yet: a volume as a destination')
    if (t !== 'storage') throw bad('a destination is { type: "storage", id }')
    const id = (d as { id?: unknown }).id
    if (typeof id !== 'string' || !id) throw bad('a storage destination needs an id')
    if (!storage.isRealStorage(id)) throw bad(id === storage.PUBLISH_ID || id === storage.PANAMA_ID ? `${id} is the BH exchange bucket: it is not a destination (docs/ADR-067)` : `no storage ${id}`)
    if (!out.some((x) => x.type === 'storage' && x.id === id)) out.push({ type: 'storage', id })
  }
  const f = load(); (f.rules[v] ??= {})[event as Event] = out; write(f)
  history.record({ kind: 'change', area: 'configuration', action: 'sync rule saved', what: `${v === ALL ? 'all volumes' : v}: ${event}`, detail: out.length ? `send to ${out.map((d) => (d.type === 'local' ? 'this PC' : d.id)).join(', ')}` : 'send nowhere' })
  return get(v)
}
/** The storage ids a (volume, event) sends to: the volume's own list for that event if it has one (even empty), else the `*` list. */
export function storageIdsFor(ev: Event, volumeId?: string | null): string[] {
  const f = load(), own = volumeId && VOLUME_ID.test(volumeId) ? f.rules[volumeId]?.[ev] : undefined
  return (own ?? f.rules[ALL]?.[ev] ?? []).filter((d) => d.type === 'storage').map((d) => (d as { id: string }).id)
}
/** Whether a (volume, event) also copies to this PC (docs/ADR-072): the same list rule as storageIdsFor. */
export function wantsLocal(ev: Event, volumeId?: string | null): boolean {
  const f = load(), own = volumeId && VOLUME_ID.test(volumeId) ? f.rules[volumeId]?.[ev] : undefined
  return (own ?? f.rules[ALL]?.[ev] ?? []).some((d) => d.type === 'local')
}
/** Whether this PC pulls from a storage on an event (docs/ADR-072): the storage's own entry only; the `*` rules are volumes'. */
export function storageWantsLocal(ev: Event, storageId: string): boolean {
  return (load().rules[storageId]?.[ev] ?? []).some((d) => d.type === 'local')
}
/** A deleted storage leaves every rule. */
export function removeStorage(id: string): void {
  const f = load(); let changed = false
  if (f.rules[id]) { delete f.rules[id]; changed = true }
  for (const o of Object.values(f.rules)) for (const ev of EVENTS) { const l = o[ev]; if (l?.some((d) => d.type === 'storage' && d.id === id)) { o[ev] = l.filter((d) => !(d.type === 'storage' && d.id === id)); changed = true } }
  if (changed) write(f)
}

// ----- travelling in a configuration file (docs/ADR-023, ADR-070): volume ids and storage ids only, no keys -----
/** The whole rules file as it travels. */
export const exportRules = (): { rules: Record<string, RuleSet> } => all()
/**
 * A sync_rules section from a file, checked: a bad shape is an error naming the field. A destination naming a storage that `known` does not accept (not in the file,
 * not here) is dropped with a warning that names it; a rule for a volume id this account may not have is kept (volume ids are checked by pattern only).
 */
export function checkExport(v: unknown, known: (storageId: string) => boolean): { value: { rules: Record<string, RuleSet> }; warnings: string[]; error: string | null } {
  const out: { rules: Record<string, RuleSet> } = { rules: {} }, warnings: string[] = []
  const fail = (m: string) => ({ value: out, warnings, error: m })
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('sync_rules is an object')
  const rules = (v as Record<string, unknown>).rules
  if (rules === undefined) return { value: out, warnings, error: null }
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return fail('sync_rules.rules maps a volume id (or *) to its rules')
  for (const [vol, rs] of Object.entries(rules as Record<string, unknown>)) {
    if (vol !== ALL && !VOLUME_ID.test(vol)) return fail(`sync_rules.rules: "${vol.slice(0, 40)}" is not a volume id or *`)
    if (!rs || typeof rs !== 'object' || Array.isArray(rs)) return fail(`sync_rules.rules.${vol} is an object with generated, approved and published`)
    const o: RuleSet = { generated: [], approved: [], published: [] }
    for (const [ev, list] of Object.entries(rs as Record<string, unknown>)) {
      if (!(EVENTS as readonly string[]).includes(ev)) return fail(`sync_rules.rules.${vol}.${ev.slice(0, 30)}: the events are ${EVENTS.join(', ')}`)
      if (!Array.isArray(list)) return fail(`sync_rules.rules.${vol}.${ev} is a list of { type: "storage", id }`)
      for (const d of list) {
        const t = (d as { type?: unknown })?.type, id = (d as { id?: unknown })?.id
        if (t === 'local') { if (!o[ev as Event].some((x) => x.type === 'local')) o[ev as Event].push({ type: 'local' }); continue }
        if (t !== 'storage' || typeof id !== 'string' || !id) return fail(`sync_rules.rules.${vol}.${ev} holds only { type: "storage", id }`)
        if (!known(id)) { warnings.push(`Rule ${vol === ALL ? 'all volumes' : vol} / ${ev}: storage "${id.slice(0, 40)}" is not in the file or on this machine: dropped.`); continue }
        if (!o[ev as Event].some((x) => x.type === 'storage' && (x as { id: string }).id === id)) o[ev as Event].push({ type: 'storage', id })
      }
    }
    out.rules[vol] = o
  }
  return { value: out, warnings, error: null }
}
/** Replace the rules file with a checked section's rules. */
export function replaceAll(rules: Record<string, RuleSet>): void {
  const f: File = { rules: {} }
  for (const [k, r] of Object.entries(rules)) f.rules[k] = { generated: [...r.generated], approved: [...r.approved], published: [...r.published] }
  write(f)
  history.record({ kind: 'change', area: 'configuration', action: 'sync rules imported', what: `${Object.keys(f.rules).length} volume(s)`, detail: '' })
}
