// Directory walks that never hold the main process (the window): fs/promises, a bounded number of stats at once, and a yield
// to the event loop between batches, so timers, IPC and painting keep running while a folder of thousands of files is measured.
// The synchronous walks they replace ran for as long as the folder was big (seconds on a large staging or output tree).
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

export const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

export interface WalkedFile { rel: string; bytes: number | null }
export interface Walk { files: WalkedFile[]; dirs: number }

/**
 * Every file under `root` (relative path, with its size when `sizes` is true). A folder that cannot be read counts as empty.
 * `max` stops the walk after that many entries; `batch` is how many stats run at once; the loop is yielded to after every batch and every folder.
 */
export async function walkFiles(root: string, opts: { sizes?: boolean; batch?: number; max?: number } = {}): Promise<Walk> {
  const { sizes = true, batch = 64, max = Infinity } = opts
  const out: WalkedFile[] = []
  let dirs = 0
  const stack: string[] = ['']
  while (stack.length && out.length < max) {
    const rel = stack.pop() as string
    let entries
    try { entries = await readdir(rel ? join(root, rel) : root, { withFileTypes: true }) } catch { continue }
    dirs++
    const here: { rel: string; file: boolean }[] = []
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) stack.push(r)
      else here.push({ rel: r, file: e.isFile() })
    }
    for (let i = 0; i < here.length; i += batch) {
      const chunk = here.slice(i, i + batch)
      const sz = await Promise.all(chunk.map(async (c) => {
        if (!sizes || !c.file) return null
        try { return (await stat(join(root, c.rel))).size } catch { return null }
      }))
      chunk.forEach((c, k) => { if (out.length < max) out.push({ rel: c.rel, bytes: c.file ? sz[k] : null }) })
      await yieldLoop()
    }
    await yieldLoop()
  }
  return { files: out, dirs }
}
