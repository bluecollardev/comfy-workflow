/**
 * Incomplete sequences (Lucas, 2026-11-21: "i don't like the incomplete frames"): a DPX sequence whose frame count, the UNION over the runs of its folder and clip (utils/chunkruns.js), is LESS than the V11 EDL's cut
 * for its element: a probe, a cut-off chunk set, a partial render. Only a sequence with a known EDL expectation can be incomplete (not in the EDL or ambiguous: it is shown as usual). They are hidden by default,
 * counted apart, and listed in their own group when Show Incomplete is on. Display only: nothing is deleted or moved.
 */
import { galleryTiles } from './outputs.js'
import { isTemp } from './videogroups.js'
import { seqKey } from './chunkruns.js'

/** The name an EDL lookup uses for a sequence tile: its name without the frame number. */
export const tileName = (t) => String(t.name || t.file?.filename || '').replace(/\.(\d+|#+)\.dpx$/i, '')

/** { total, expected } when the sequence tile is short of what the EDL expects, else null. `unions` is the Map of frameUnions (or null), `expected` the EDL's frame count for the tile or null. */
export function incompleteOf(tile, unions, expected) {
  if (!tile || tile.kind !== 'dpx' || !expected) return null
  const e = unions && tile.file ? unions.get(seqKey(tile.file)) : null
  const total = Math.max(tile.frames?.length || 0, e?.count || 0)
  return total > 0 && total < expected ? { total, expected } : null
}

/** What one run holds, for the list of runs: its incomplete sequences, its other visible content (complete or EDL-less sequences, and any file that is not a DPX frame; temp files only when `showTemp`), and the run's `hidden` verdict: it has incomplete sequences and nothing else visible. `expectedFor(name)` is the EDL count or null. */
export function runContent(run, unions, expectedFor, showTemp = false) {
  let incomplete = 0, other = 0
  const files = run?.files || []
  for (const t of galleryTiles(files.filter((f) => showTemp || !isTemp(f)))) {
    if (t.kind === 'dpx') { if (incompleteOf(t, unions, expectedFor(tileName(t)))) incomplete++; else other++ } else other++
  }
  return { incomplete, other, onlyIncomplete: incomplete > 0 && other === 0 }
}
