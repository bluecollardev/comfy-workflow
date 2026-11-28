/**
 * The Outputs window's Local source: what is on THIS PC under ComfyUI-Shared/output/, one folder at a time, read-only.
 * `browse` lists a level (folders, files with bytes and modified); `resolveFile` is the guard behind `localfile://o/<path>` (main process): a plain file
 * inside that folder, never `..`, never a symlink out of it. Nothing here writes, renames or deletes.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { bad } from './errors.js'
import * as publish from './publish.js'

export interface LocalListing { prefix: string; folders: string[]; files: { name: string; bytes: number; modified: string }[]; truncated: boolean }
const CAP = 2000
const root = (): string => { const r = publish.localOutputRoot(); if (!r) throw bad('The ComfyUI-Shared folder is not mapped on this PC (Default Configuration): there is no local output/ folder'); return r }
const clean = (prefix: unknown): string => {
  const p = String(prefix ?? '')
  if (p.length > 300 || /[\\\u0000-\u001f]/.test(p) || p.startsWith('/') || p.split('/').includes('..') || p.includes('//')) throw bad(`Not a folder of the local output: ${p.slice(0, 80)}`)
  return p === '' ? '' : p.replace(/\/+$/, '') + '/'
}
/** One level of the local output folder. Dot folders (.previews, .proxies) are the app's own caches: left out. */
export async function browse(prefix: string = ''): Promise<LocalListing> {
  const dir = clean(prefix), base = await realpath(root()).catch(() => { throw bad('The local output folder does not exist yet') })
  const abs = await realpath(join(base, dir)).catch(() => { throw bad(`Not a folder of the local output: ${dir}`) })
  if (abs !== base && !abs.startsWith(base + sep)) throw bad('That folder is outside the local output')
  const folders: string[] = [], files: LocalListing['files'] = []
  let truncated = false
  for (const d of (await readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (d.name.startsWith('.')) continue
    if (folders.length + files.length >= CAP) { truncated = true; break }
    if (d.isDirectory()) folders.push(d.name)
    else if (d.isFile()) { const st = await stat(join(abs, d.name)).catch(() => null); if (st) files.push({ name: d.name, bytes: st.size, modified: st.mtime.toISOString().slice(0, 19) }) }
  }
  return { prefix: dir, folders, files, truncated }
}
/** `urlPath` is the part of `localfile://o/...` after the host. A plain file inside the local output folder, or a status and a message. */
export async function resolveFile(urlPath: string): Promise<{ ok: true; path: string; size: number } | { ok: false; status: number; message: string }> {
  const no = (status: number, message: string) => ({ ok: false as const, status, message })
  let rel: string
  try { rel = decodeURIComponent(String(urlPath).replace(/^\/+/, '')) } catch { return no(400, 'Bad address.') }
  if (!rel || rel.length > 1024 || /[\\\u0000-\u001f]/.test(rel) || rel.split('/').some((s) => !s || s === '.' || s === '..' || s.startsWith('.'))) return no(403, 'Only plain files of the local output folder are served here.')
  const r = publish.localOutputRoot(); if (!r) return no(404, 'The local output folder is not mapped.')
  try {
    const base = await realpath(r), abs = await realpath(join(base, rel))
    if (!abs.startsWith(base + sep)) return no(403, 'That file is outside the local output folder.')
    const st = await stat(abs); if (!st.isFile()) return no(404, 'Not a file.')
    return { ok: true, path: abs, size: st.size }
  } catch { return no(404, 'No such file.') }
}
