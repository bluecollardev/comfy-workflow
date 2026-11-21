/**
 * Chunked renders (ADR-056): a long graph is run as a probe and then chunks, each its own ComfyUI prompt, all writing the frames of ONE sequence into the same output folder
 * (the probe 0-9, chunks 10-20, 21-31 ... 65-69). Listed as separate runs they look like partial sequences ("DPX · 5 frames", a red "Frames 5 / 70"). Two pure helpers:
 *  - mergeChunkRuns: the runs with the same graph that write DPX into the same folders become ONE run (the union of their files, the chunks kept in `chunks`);
 *  - frameUnions: for every sequence (folder + clip), the union of its frame numbers across ALL the runs listed, so the EDL check counts frames, never the frames of one run.
 */
import { isDpx } from './outputs.js'

const FRAME = /^(.*?)([._-]?)(\d+)\.dpx$/i
const fileId = (f) => `${f.type || 'output'}/${f.subfolder || ''}/${f.filename}`

/** The key a sequence has in frameUnions: its output type and folder and the clip name without the frame number. null for a file that is not a numbered DPX frame. */
export function seqKey(f) {
  const m = f && FRAME.exec(String(f.filename || ''))
  return m ? `${f.type || 'output'}/${f.subfolder || ''}/${m[1]}` : null
}
/** The frame number of a DPX frame file name, or null. */
export const frameNo = (f) => { const m = f && FRAME.exec(String(f.filename || '')); return m ? Number(m[3]) : null }

/** Per sequence the union of frame numbers over `runs`: Map key -> { count, min, max, contiguous } (a frame listed in two runs counts once). */
export function frameUnions(runs) {
  const sets = new Map()
  for (const r of runs || []) for (const f of r.files || []) {
    if (f.type && f.type !== 'output') continue
    const k = seqKey(f), n = frameNo(f)
    if (k === null || n === null) continue
    let s = sets.get(k); if (!s) { s = new Set(); sets.set(k, s) }
    s.add(n)
  }
  const out = new Map()
  for (const [k, s] of sets) {
    let min = Infinity, max = -Infinity
    for (const n of s) { if (n < min) min = n; if (n > max) max = n }
    out.set(k, { count: s.size, min, max, contiguous: s.size === max - min + 1 })
  }
  return out
}

/** The merge key of a run, or '' when it must not merge: only a pod or saved run with a named graph and DPX output; two runs merge only when the graph (workflow path) and the set of DPX output folders are identical. */
export function chunkKey(r) {
  if (!r || r.source === 'volume' || !r.workflow) return ''
  const dirs = new Set()
  for (const f of r.files || []) if ((f.type || 'output') === 'output' && isDpx(f.filename)) dirs.add(f.subfolder || '')
  return dirs.size ? `${r.workflow}|${[...dirs].sort().join(',')}` : ''
}

/** `runs` (newest first) with the chunk runs of one graph and folder merged into one row at the place of the newest: files = the union, duration = the sum, started_at = the newest, chunk_count and chunks (newest first). Everything else is untouched, never merged across different graphs or folders. */
export function mergeChunkRuns(runs) {
  const groups = new Map()
  for (const r of runs || []) { const k = chunkKey(r); if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) } }
  const done = new Set(), out = []
  for (const r of runs || []) {
    const k = chunkKey(r), g = k ? groups.get(k) : null
    if (!g || g.length < 2) { out.push(r); continue }
    if (done.has(k)) continue
    done.add(k)
    const newest = g.reduce((a, b) => (String(b.started_at || '') > String(a.started_at || '') ? b : a))
    const seen = new Set(), files = []
    for (const m of [...g].reverse()) for (const f of m.files || []) { const id = fileId(f); if (!seen.has(id)) { seen.add(id); files.push(f) } }
    const durs = g.map((m) => m.duration_s).filter((d) => typeof d === 'number' && Number.isFinite(d))
    out.push({ ...newest, files, duration_s: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) * 10) / 10 : newest.duration_s, saved: g.every((m) => m.saved), chunks: g, chunk_count: g.length })
  }
  return out
}
