import { sharedThumbs, thumbKey } from './thumbs'

/**
 * Which frames of a DPX sequence have a preview in the app's cache right now (the one the Generate tab counts as "cached"): one index read for all the keys, then a cache
 * read (never a fetch, never a decode, nothing queued) only for the frames that have a record. Returns Map(filename -> object URL) of the READY ones; an empty verdict or a
 * stale record is left out. Today the only frames that get a preview are first frames (SequenceThumb), so for most sequences this is 0 or 1.
 */
export async function availableFrames(scope, frames, thumbs = sharedThumbs()) {
  const out = new Map()
  let have
  try { have = await thumbs.keys() } catch { return out }
  if (!have.size) return out
  const hits = (frames || []).filter((f) => have.has(thumbKey(scope, f)))
  await Promise.all(hits.map(async (f) => {
    try { const r = await thumbs.peek(thumbKey(scope, f), { bytes: f.bytes ?? null, modified: f.modified ?? null }); if (r.status === 'ready' && r.url) out.set(f.filename, r.url) } catch { /* no preview for this one */ }
  }))
  return out
}
