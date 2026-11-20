/**
 * Pod logs, kept (Lucas, 2026-11-20: "don't delete the logs when done for the pods", "a way to export pod logs at the end of each run").
 * A pod's logs go with the pod when it is deleted, so they are written to a file in the app's config folder at the end of each run task and just before a pod is deleted,
 * and on demand (the `pod_logs` MCP tool). Nothing deletes a log by itself: only `purge`, which a person asks for (one pod's logs, or all) and confirms. The file holds the RunPod container and system log, and ComfyUI's own server log while the pod runs.
 */
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { CoreError, bad } from './errors.js'
import * as history from './history.js'
import * as comfyruns from './comfyruns.js'
import * as pods from './pods.js'
import * as podnames from './podnames.js'
import * as rp from './runpod.js'
import { configDir } from './paths.js'

export const logsDir = () => process.env.POD_LOGS_DIR || join(configDir(), 'pod-logs')
export interface SavedLog { name: string; path: string; bytes: number; modified: string }
export interface Deps { now(): Date; container(podId: string, signal: AbortSignal): Promise<{ ts: string; source: string; line: string }[]>; comfy(podId: string): Promise<string[]>; name(podId: string): string }
const defaults = (): Deps => ({
  now: () => new Date(),
  name: (id) => podnames.get(id) || id,
  container: async (podId, signal) => {
    const out: { ts: string; source: string; line: string }[] = []
    let quiet: NodeJS.Timeout | null = null
    const ac = new AbortController(), stop = () => ac.abort(), kick = () => { if (quiet) clearTimeout(quiet); quiet = setTimeout(stop, 6000) }
    const total = setTimeout(stop, 25_000); signal.addEventListener('abort', stop, { once: true }); kick()
    try { await pods.logs(podId, { tail: 3000 }, (e) => { out.push({ ts: e.ts, source: e.source, line: e.line }); kick() }, ac.signal) } catch { /* what arrived is kept */ } finally { clearTimeout(total); if (quiet) clearTimeout(quiet) }
    return out
  },
  comfy: async (podId) => { try { return (await comfyruns.logs(podId, { level: 'all', lines: 2000 })).entries.map((e) => `${e.ts ?? ''} [${e.level}] ${e.text}`.trim()) } catch (e) { return [`(ComfyUI's own log could not be read: ${(e as Error).message})`] } },
})
let deps: Deps = defaults()
export const setDeps = (d: Partial<Deps> | null) => { deps = d ? { ...deps, ...d } : defaults() }
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)

/** Write the pod's logs to a new file (never over an old one) and say where. */
export async function save(podId: string, o: { reason?: string } = {}): Promise<SavedLog & { lines: number }> {
  const id = String(podId ?? '').trim(); if (!id || !/^[A-Za-z0-9]+$/.test(id)) throw bad('Give the pod id (pod_id)')
  const now = deps.now(), day = now.toISOString().slice(0, 10), stamp = now.toISOString().slice(11, 19).replace(/:/g, '')
  const [container, comfy] = await Promise.all([deps.container(id, new AbortController().signal), deps.comfy(id)])
  const name = deps.name(id), head = [`pod ${id}${name !== id ? ` (${name})` : ''}`, `saved ${now.toISOString()}`, `why ${o.reason || 'asked for'}`, '']
  const body = [...head, `--- RunPod container and system log (${container.length} lines) ---`, ...container.map((e) => `${e.ts} ${e.source} ${e.line}`), '', `--- ComfyUI server log (${comfy.length} lines) ---`, ...comfy, ''].join('\n')
  const dir = join(logsDir(), day); await mkdir(dir, { recursive: true })
  let file = join(dir, `${safe(name)}_${id}_${stamp}.log`)
  for (let n = 1; ; n++) {   // never over an old file: a second save in the same second gets its own name
    try { await writeFile(file, body, { flag: 'wx' }); break } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; file = join(dir, `${safe(name)}_${id}_${stamp}-${n}.log`) }
  }
  const st = await stat(file).catch(() => null)
  return { name: basename(file), path: file, bytes: st?.size ?? body.length, modified: now.toISOString(), lines: container.length + comfy.length }
}
/** The saved logs, newest first. */
export async function list(o: { pod_id?: string } = {}): Promise<{ logs: SavedLog[]; dir: string }> {
  const out: SavedLog[] = []
  for (const day of await readdir(logsDir()).catch(() => [] as string[])) {
    for (const f of await readdir(join(logsDir(), day)).catch(() => [] as string[])) {
      if (!f.endsWith('.log') || (o.pod_id && !f.includes(`_${o.pod_id}_`))) continue
      const p = join(logsDir(), day, f), st = await stat(p).catch(() => null); if (st) out.push({ name: `${day}/${f}`, path: p, bytes: st.size, modified: st.mtime.toISOString() })
    }
  }
  return { logs: out.sort((a, b) => b.modified.localeCompare(a.modified)), dir: logsDir() }
}
/** One saved log's text (the last `tail` lines when given). */
export async function read(name: string, o: { tail?: number } = {}): Promise<{ name: string; text: string }> {
  const n = String(name ?? ''); if (!/^\d{4}-\d\d-\d\d\/[A-Za-z0-9._-]+\.log$/.test(n)) throw bad('Give a log name from the list (day/file.log)')
  const text = await readFile(join(logsDir(), n), 'utf8').catch(() => { throw new CoreError(404, `No such saved log: ${n}`) })
  const lines = text.split('\n'), t = Number(o.tail); return { name: n, text: t > 0 ? lines.slice(-t).join('\n') : text }
}
/** Delete saved logs, only when a person asked and confirmed: one pod's (pod_id), or all of them. Only files this module wrote, inside its own folder. */
export async function purge(o: { pod_id?: string; confirmed?: boolean } = {}): Promise<{ deleted: number; bytes: number }> {
  if (o.confirmed !== true) throw bad('Deleting saved pod logs needs the person to say yes first (confirmed: true)')
  if (o.pod_id !== undefined && !/^[A-Za-z0-9]+$/.test(String(o.pod_id))) throw bad('pod_id is not a pod id')
  const { logs } = await list(o.pod_id ? { pod_id: o.pod_id } : {})
  let bytes = 0
  for (const l of logs) { if (!l.path.startsWith(logsDir())) continue; await unlink(l.path); bytes += l.bytes }
  for (const day of await readdir(logsDir()).catch(() => [] as string[])) await rmdir(join(logsDir(), day)).catch(() => undefined)   // an empty day folder goes; a full one stays
  history.record({ kind: 'change', area: 'outputs', action: 'pod logs deleted', what: o.pod_id ? `pod ${o.pod_id}` : 'all pods', detail: `${logs.length} saved log(s), ${bytes} bytes, by the person's request` })
  return { deleted: logs.length, bytes }
}
