import { lstat, readdir, readlink, realpath, stat, statfs } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CoreError } from './errors.js'

export const MAC_PERMISSION_HINT = 'macOS may need to allow RunPod Manager to read this folder: System Settings > Privacy & Security > Files and Folders (or Full Disk Access)'
export interface DirEntry { name: string; path: string; /** a symbolic link to a folder (a broken link is not listed) */ link: boolean; /** where the link points, resolved */ target?: string }

export const DIR_CAP = 2000, LINK_CONCURRENCY = 16
export const TIMEOUT_MESSAGE = 'The folder did not answer within 15 seconds (a sleeping drive or an unavailable network mount). Try again, or pick another place.'
type Ent = { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }
/** The file system calls the picker makes (all async); tests replace them to simulate a hung mount. */
export interface FsDeps { realpath(p: string): Promise<string>; stat(p: string): Promise<{ isDirectory(): boolean }>; readdir(p: string): Promise<Ent[]>; readlink(p: string): Promise<string> }
const realFs: FsDeps = { realpath: (p) => realpath(p), stat: (p) => stat(p), readdir: (p) => readdir(p, { withFileTypes: true }), readlink: (p) => readlink(p) }
let fsDeps: FsDeps = realFs
export const setFs = (d: Partial<FsDeps> | null) => { fsDeps = d ? { ...realFs, ...d } : realFs }
const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

/**
 * Subfolders of a folder on this PC, for the folder picker. Empty path = the home folder. ASYNC (the core runs in Electron's main process: a sleeping drive, a big or network volume or a macOS
 * permission prompt must never freeze the window) with a hard timeout (15 s, `LISTDIRS_TIMEOUT_MS`): a listing that does not answer is a 504 `timeout` and the stuck call is abandoned, not awaited.
 * The path stays LOGICAL: `path` and `parent` are the path you came by (after `~` and resolve), so Up goes back through a link; `real` is the realpath when it differs. A link to a folder has `link: true`
 * and its `target` (checked 16 at a time, yielding to the event loop); a broken link is hidden. `filter` (case-insensitive substring of the name) applies BEFORE the cap: at most 2,000 folders are returned,
 * sorted, with `total` (after the filter) and `truncated` (how many were left out). An unreadable folder is a 403 `no_permission` with, on macOS, a `hint`.
 */
export async function listDirs(path = '', hidden = false, filter = ''): Promise<{ path: string; parent: string | null; real?: string; home: string; dirs: DirEntry[]; total: number; truncated?: number }> {
  const limit = Number(process.env.LISTDIRS_TIMEOUT_MS) || 15_000
  const work = listDirsInner(path, hidden, filter)
  work.catch(() => undefined)   // if the timeout wins, a later failure of the abandoned call is not an unhandled rejection
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([work, new Promise<never>((_r, rej) => { timer = setTimeout(() => rej(new CoreError(504, TIMEOUT_MESSAGE, 'timeout')), limit) })]) } finally { if (timer) clearTimeout(timer) }
}
async function listDirsInner(path: string, hidden: boolean, filter: string) {
  const logical = resolve(path ? path.replace(/^~(?=$|\/)/, homedir()) : homedir())
  let real = logical
  try { real = await fsDeps.realpath(logical) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM') throw denied(logical); throw new CoreError(400, `cannot resolve ${JSON.stringify(path)}`) }
  let isDir = false
  try { isDir = (await fsDeps.stat(logical)).isDirectory() } catch { /* not there */ }
  if (!isDir) throw new CoreError(404, `not a folder: ${logical}`)
  let entries: Ent[]
  try { entries = await fsDeps.readdir(logical) } catch { throw denied(logical) }
  const needle = filter.trim().toLowerCase()
  const plain: DirEntry[] = [], links: Ent[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if ((hidden || !e.name.startsWith('.')) && (!needle || e.name.toLowerCase().includes(needle))) { if (e.isDirectory()) plain.push({ name: e.name, path: join(logical, e.name), link: false }); else if (e.isSymbolicLink()) links.push(e) }
    if (i % 500 === 499) await yieldLoop()
  }
  const dirs: DirEntry[] = [...plain]
  for (let i = 0; i < links.length; i += LINK_CONCURRENCY) {   // bounded concurrency: never one stat per link in a row, never all at once
    const part = await Promise.all(links.slice(i, i + LINK_CONCURRENCY).map(async (e): Promise<DirEntry | null> => {
      const p = join(logical, e.name)
      try { if (!(await fsDeps.stat(p)).isDirectory()) return null } catch { return null }   // broken, or a link to a file: hidden
      let target: string | undefined; try { target = resolve(logical, await fsDeps.readlink(p)) } catch { /* unreadable link */ }
      return { name: e.name, path: p, link: true, ...(target ? { target } : {}) }
    }))
    for (const d of part) if (d) dirs.push(d)
    if (i % 500 === 499) await yieldLoop()
  }
  dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const total = dirs.length, parent = dirname(logical)
  return { path: logical, parent: parent !== logical ? parent : null, ...(real !== logical ? { real } : {}), home: homedir(), dirs: dirs.slice(0, DIR_CAP), total, ...(total > DIR_CAP ? { truncated: total - DIR_CAP } : {}) }
}
function denied(p: string): CoreError {
  return new CoreError(403, `no permission to read ${p}`, 'no_permission', process.platform === 'darwin' ? MAC_PERMISSION_HINT : undefined)
}

// ----- mounted volumes on this PC -----

export interface LocalVolume { name: string; path: string; /** macOS lists the boot volume as a symlink to / */ link: boolean; target?: string; size_bytes: number | null; free_bytes: number | null; readable: boolean; reason?: string }
export interface VolumeDeps {
  platform: string; user: string; timeoutMs: number
  readdir(dir: string): Promise<string[]>
  lstat(p: string): Promise<{ isSymbolicLink(): boolean }>
  readlink(p: string): Promise<string>
  statfs(p: string): Promise<{ bsize: number; blocks: number; bavail: number }>
}
const realVolumeDeps = (): VolumeDeps => ({ platform: process.platform, user: (() => { try { return userInfo().username } catch { return '' } })(), timeoutMs: 3000, readdir: (d) => readdir(d), lstat: (p) => lstat(p), readlink: (p) => readlink(p), statfs: (p) => statfs(p) as never })
const rootsFor = (d: VolumeDeps): string[] => (d.platform === 'darwin' ? ['/Volumes'] : d.platform === 'linux' ? [`/media/${d.user}`, `/run/media/${d.user}`, '/mnt'] : [])

/**
 * The volumes mounted on this PC (macOS /Volumes/*; Linux /media/<user>/*, /run/media/<user>/*, /mnt/*) with their size and free space. Each `statfs` is raced against a 3 s timeout: a hung network
 * mount is reported as unreadable ("did not answer") and never blocks the answer, nor is it awaited. Sorted by name; the boot-volume link (a symlink to /) last.
 */
export async function listVolumes(over: Partial<VolumeDeps> = {}): Promise<{ volumes: LocalVolume[] }> {
  const d = { ...realVolumeDeps(), ...over }
  const out: LocalVolume[] = []
  const probes: Promise<void>[] = []
  for (const root of rootsFor(d)) {
    let names: string[] = []; try { names = await d.readdir(root) } catch { continue }
    for (const name of names) {
      if (name.startsWith('.')) continue
      const path = join(root, name)
      probes.push((async () => {
        let link = false, target: string | undefined
        try { const l = await d.lstat(path); link = l.isSymbolicLink(); if (link) target = resolve(root, await d.readlink(path)) } catch { /* unreadable entry */ }
        const v: LocalVolume = { name, path, link, ...(target ? { target } : {}), size_bytes: null, free_bytes: null, readable: false }
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const st = await Promise.race([d.statfs(path), new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), d.timeoutMs) })])
          if (st === 'timeout') v.reason = 'did not answer'
          else { v.size_bytes = st.blocks * st.bsize; v.free_bytes = st.bavail * st.bsize; v.readable = true }
        } catch (e) { v.reason = (e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM' ? 'no permission' : (e as Error).message } finally { if (timer) clearTimeout(timer) }
        out.push(v)
      })())
    }
  }
  await Promise.all(probes)
  const boot = (v: LocalVolume) => v.link && v.target === '/'
  out.sort((a, b) => Number(boot(a)) - Number(boot(b)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return { volumes: out }
}
