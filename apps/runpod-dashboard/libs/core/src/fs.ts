import { readdirSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { lstat, readdir, readlink, statfs } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { CoreError } from './errors.js'

export const MAC_PERMISSION_HINT = 'macOS may need to allow RunPod Manager to read this folder: System Settings > Privacy & Security > Files and Folders (or Full Disk Access)'
export interface DirEntry { name: string; path: string; /** a symbolic link to a folder (a broken link is not listed) */ link: boolean; /** where the link points, resolved */ target?: string }

/**
 * Subfolders of a folder on this PC, for the folder picker. Empty path = the home folder.
 * The path stays LOGICAL: `path` and `parent` come from the path as given (after `~` and resolve), never from its realpath, so Up goes back to where you came from through a link;
 * `real` is the realpath when it differs. A symlink to a folder is listed with `link: true` and its `target`; a broken link is hidden. An unreadable folder is a 403 with
 * `code: 'no_permission'` and (on macOS) a `hint` about Files and Folders / Full Disk Access.
 */
export function listDirs(path = '', hidden = false) {
  const logical = resolve(path ? path.replace(/^~(?=$|\/)/, homedir()) : homedir())
  let real = logical
  try { real = realpathSync(logical) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM') throw denied(logical); throw new CoreError(400, `cannot resolve ${JSON.stringify(path)}`) }
  let isDir = false
  try { isDir = statSync(logical).isDirectory() } catch { /* not there */ }
  if (!isDir) throw new CoreError(404, `not a folder: ${logical}`)
  let entries
  try { entries = readdirSync(logical, { withFileTypes: true }) } catch { throw denied(logical) }
  const dirs: DirEntry[] = []
  for (const e of entries) {
    if (!hidden && e.name.startsWith('.')) continue
    const p = join(logical, e.name)
    if (e.isDirectory()) { dirs.push({ name: e.name, path: p, link: false }); continue }
    if (e.isSymbolicLink()) {
      try { if (statSync(p).isDirectory()) { let target: string | undefined; try { target = resolve(logical, readlinkSync(p)) } catch { /* unreadable link */ } dirs.push({ name: e.name, path: p, link: true, ...(target ? { target } : {}) }) } } catch { /* a broken link stays hidden */ }
    }
  }
  dirs.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const parent = dirname(logical)
  return { path: logical, parent: parent !== logical ? parent : null, ...(real !== logical ? { real } : {}), home: homedir(), dirs }
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
