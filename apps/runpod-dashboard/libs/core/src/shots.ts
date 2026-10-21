/**
 * Locked shots: the gate the ComfyUI bridge applies before it queues a graph.
 *
 * The machine-readable record is the project tracker, `<project>/04_TRACKER/shots.csv`, whose
 * `locked` column is `yes` when the client approves a shot (shared/shapes/tracker-rows.json,
 * shared/governance/policy/structure_v003.md §4). A locked shot is read-only for everyone and is
 * never edited or run by us (policy/agent-permissions.md, shot-folder.json rule 3). A graph names a
 * shot wherever a shot name appears in it: a graph file name (`corrosion-051_graph_v015_api.json`),
 * a served frame (`corrosion-059_3D.LEFT.093999.dpx`), a solve path, a note. No tree mapped or no
 * tracker in it means nothing is locked, and the answer says where it looked.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from './mounts.js'

export const TRACKER = join('04_TRACKER', 'shots.csv')
/** A shot name inside any text (shared/shapes/names.json shot_folder), not glued to another word character. */
export const SHOT_IN_TEXT = /(?<![a-z0-9])([a-z]+-[0-9]{3}[a-z]?)(?![a-z0-9])/g

export interface LockedShots { file: string | null; found: boolean; shots: Set<string>; rows: number }

/** The shots the tracker marks `locked = yes`. */
export function lockedShots(projectRoot: string | null | undefined): LockedShots {
  if (!projectRoot) return { file: null, found: false, shots: new Set(), rows: 0 }
  const file = join(projectRoot, TRACKER)
  if (!existsSync(file)) return { file, found: false, shots: new Set(), rows: 0 }
  const rows = parseCsv(readFileSync(file, 'utf8'))
  const shots = new Set<string>()
  for (const r of rows) if ((r.locked || '').trim().toLowerCase() === 'yes' && (r.shot || '').trim()) shots.add(r.shot.trim())
  return { file, found: true, shots, rows: rows.length }
}

/** Every shot name a value names, in order of first appearance. Objects are scanned as their JSON. */
export function shotsNamed(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const out: string[] = []
  for (const m of text.matchAll(SHOT_IN_TEXT)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** The locked shots a graph names, with what was scanned and which tracker decided. */
export function lockedIn(graph: unknown, projectRoot: string | null | undefined): { named: string[]; locked: string[]; tracker: LockedShots } {
  const tracker = lockedShots(projectRoot)
  const named = shotsNamed(graph)
  return { named, locked: named.filter((s) => tracker.shots.has(s)), tracker }
}
