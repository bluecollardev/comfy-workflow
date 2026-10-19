import { readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { CoreError } from './errors.js'

/** Subfolders of a folder on this PC, for the folder picker. Empty path = the home folder. */
export function listDirs(path = '', hidden = false) {
  let p = path ? path.replace(/^~(?=$|\/)/, homedir()) : homedir()
  try { p = realpathSync(resolve(p)) } catch { throw new CoreError(400, `cannot resolve ${JSON.stringify(path)}`) }
  let isDir = false
  try { isDir = statSync(p).isDirectory() } catch { /* not there */ }
  if (!isDir) throw new CoreError(404, `not a folder: ${p}`)
  let entries
  try { entries = readdirSync(p, { withFileTypes: true }) } catch { throw new CoreError(403, `no permission to read ${p}`) }
  const dirs = entries
    .filter((e) => (hidden || !e.name.startsWith('.')))
    .filter((e) => { try { return e.isDirectory() || (e.isSymbolicLink() && statSync(resolve(p, e.name)).isDirectory()) } catch { return false } })
    .map((e) => ({ name: e.name, path: resolve(p, e.name) }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const parent = dirname(p)
  return { path: p, parent: parent !== p ? parent : null, home: homedir(), dirs }
}
