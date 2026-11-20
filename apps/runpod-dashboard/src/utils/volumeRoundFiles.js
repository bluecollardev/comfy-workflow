import { historyAPI } from '../api/history'

// The files of one round (or one shot of it) on a network volume, for the read-only explorer in Import Round. Read-only, over RunPod's S3 API
// from this PC (no pod, nothing spent), through the Outputs window's own listing (history.listOutputs, source volume-s3): by prefix, never the whole tree.
//   - the round's folder is listed one level (the core lists the top folders one level at a time): its shot folders and any files beside them;
//   - each shot folder is then listed under its own prefix (the core caps one listing at 3000 files and says `capped`), at most SHOT_CAP shots, CONCURRENCY at a time.
// With a shot given, only that shot's prefix is listed: one call.
export const SHOT_CAP = 60
export const CONCURRENCY = 4

/** Flat tree entries (a folder, then its children; folders carry files and bytes) from `{ path, bytes }` files. */
export function entriesFromFiles(files) {
  const dirs = new Map(), out = []
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  for (const f of sorted) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'), c = dirs.get(d) || { files: 0, bytes: 0 }; c.files++; c.bytes += f.bytes || 0; dirs.set(d, c) } }
  const seen = new Set()
  for (const f of sorted) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) { const d = parts.slice(0, i).join('/'); if (!seen.has(d)) { seen.add(d); out.push({ path: d, dir: true, ...dirs.get(d) }) } }
    out.push({ path: f.path, dir: false, bytes: f.bytes || 0 })
  }
  return out
}

const reasonOf = (a) => { const s = (a?.sources || []).find((x) => x.id === 'volume-s3'); return s && !s.ok ? s.reason || 'The volume cannot be listed over the S3 API.' : '' }

/** `{ entries, files, bytes, capped }` for the round on the volume. `isCancelled()` stops the walk between calls. Throws with the reason when the volume cannot be listed. */
export async function listVolumeRound({ volumeId, round, shot = '', isCancelled = () => false }) {
  const ctx = { volume_id: volumeId }, got = []
  let capped = false
  const list = async (prefix) => {
    const a = await historyAPI.listOutputs(ctx, { source: 'volume-s3', prefix })
    const why = reasonOf(a); if (why) throw new Error(why)
    if (a.capped) capped = true
    return a
  }
  const take = (a) => { for (const r of a.runs || []) for (const f of r.files || []) got.push({ path: `${r.folder ? `${r.folder}/` : ''}${f.filename}`.slice(round.length + 1), bytes: f.bytes || 0 }) }
  if (shot) { take(await list(`${round}/${shot}`)); return finish(got, capped, isCancelled) }
  const top = await list(round); take(top)
  const folders = (top.folders || []).slice(0, SHOT_CAP)
  if ((top.folders || []).length > SHOT_CAP) capped = true
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, folders.length) }, async () => {
    while (next < folders.length && !isCancelled()) { const f = folders[next++]; take(await list(`${round}/${f}`)) }
  }))
  return finish(got, capped, isCancelled)
}
const finish = (got, capped, isCancelled) => {
  if (isCancelled()) return { entries: [], files: 0, bytes: 0, capped }
  return { entries: entriesFromFiles(got), files: got.length, bytes: got.reduce((a, f) => a + f.bytes, 0), capped }
}
