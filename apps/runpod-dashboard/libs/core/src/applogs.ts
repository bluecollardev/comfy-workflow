/**
 * The application's own log (electron/app-log.cjs writes it): `app-logs/<day>.log` in the config folder, one line each (`time LEVEL text`): the main process's console, the page's
 * warnings and errors, crashes. This module lists, reads and purges them. Nothing deletes a log by itself: `purge` runs only when a person asked and confirmed.
 */
import { readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import { configDir } from './paths.js'

export const dir = () => process.env.APP_LOGS_DIR || join(configDir(), 'app-logs')
export interface AppLogFile { name: string; path: string; bytes: number; modified: string }
const NAME = /^\d{4}-\d\d-\d\d\.log$/
export async function list(): Promise<{ logs: AppLogFile[]; dir: string }> {
  const out: AppLogFile[] = []
  for (const f of await readdir(dir()).catch(() => [] as string[])) { if (!NAME.test(f)) continue; const p = join(dir(), f), st = await stat(p).catch(() => null); if (st) out.push({ name: f, path: p, bytes: st.size, modified: st.mtime.toISOString() }) }
  return { logs: out.sort((a, b) => b.name.localeCompare(a.name)), dir: dir() }
}
/** One day's log: the last `tail` lines (default 300), only those at or above `level` (all | warn | error), only those that contain `match`. */
export async function read(name: string, o: { tail?: number; level?: string; match?: string } = {}): Promise<{ name: string; lines: string[]; total: number }> {
  const n = String(name ?? ''); if (!NAME.test(n)) throw bad('Give a log name from the list (YYYY-MM-DD.log)')
  const level = o.level ?? 'all'; if (!['all', 'warn', 'error'].includes(level)) throw bad('level is all, warn or error')
  const text = await readFile(join(dir(), n), 'utf8').catch(() => { throw new CoreError(404, `No such app log: ${n}`) })
  let lines = text.split('\n').filter((l) => l.trim()); const total = lines.length
  if (level !== 'all') lines = lines.filter((l) => / (ERROR|WARN) /.test(l.slice(0, 40)) && (level === 'warn' || / ERROR /.test(l.slice(0, 40))) || /^\s/.test(l))   // a continuation line follows its own
  if (o.match) { const m = String(o.match).toLowerCase(); lines = lines.filter((l) => l.toLowerCase().includes(m)) }
  const t = Math.min(5000, Math.max(1, Math.floor(Number(o.tail)) || 300)); return { name: n, lines: lines.slice(-t), total }
}
/** Delete saved app logs, only when a person asked and confirmed: one day's, or all of them. */
export async function purge(o: { name?: string; confirmed?: boolean } = {}): Promise<{ deleted: number; bytes: number }> {
  if (o.confirmed !== true) throw bad('Deleting app logs needs the person to say yes first (confirmed: true)')
  if (o.name !== undefined && !NAME.test(String(o.name))) throw bad('name is a day from the list (YYYY-MM-DD.log)')
  const { logs } = await list(); let deleted = 0, bytes = 0
  for (const l of logs) { if (o.name && l.name !== o.name) continue; await unlink(l.path); deleted++; bytes += l.bytes }
  history.record({ kind: 'change', area: 'outputs', action: 'app logs deleted', what: o.name ?? 'all days', detail: `${deleted} file(s), ${bytes} bytes, by the person's request` })
  return { deleted, bytes }
}
