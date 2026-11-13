import { panamaAPI } from '../api/panama'

/** The shots of a delivery round (its top-level folders in the bucket), read once per round and kept: a big round's listing takes seconds. */
const cache = new Map()
export function roundShots(round) {
  if (!round) return Promise.resolve([])
  if (!cache.has(round)) {
    cache.set(round, panamaAPI.files(round).then((r) => [...new Set((r.entries || []).filter((e) => e.dir && !e.path.includes('/')).map((e) => e.path))].sort()).catch(() => { cache.delete(round); return [] }))
  }
  return cache.get(round)
}
