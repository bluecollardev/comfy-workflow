/**
 * The filmstrip beside a DPX sequence's first-frame tile (Lucas, 2026-11-21: "in each row we're showing the first frame. if dpx sequences are rendered, show them beside the first
 * frame to fill the row"). Pure rules, no I/O: how many thumbnails fit the row, and which of the frames that HAVE a preview to show (evenly spaced across the sequence).
 */
export const STRIP_THUMB_PX = 112   // the width of one thumbnail in the strip
export const STRIP_GAP_PX = 6
export const STRIP_MAX = 12

/** How many thumbnails fit a strip of `width` px (at least 1, at most `max`); an unmeasured strip (0) gets a middling guess. */
export function fitCount(width, { thumb = STRIP_THUMB_PX, gap = STRIP_GAP_PX, max = STRIP_MAX } = {}) {
  if (!(width > 0)) return Math.min(6, max)
  return Math.max(1, Math.min(max, Math.floor((width + gap) / (thumb + gap))))
}

/**
 * The frames that have a preview, as [{ index, ... }] sorted by index; `skipFirst` leaves out index 0 (the tile beside the strip already shows it). Frames without a preview are
 * not here at all: no placeholders.
 */
export function previewed(frames, imgOf, { skipFirst = true } = {}) {
  const out = []
  for (let i = skipFirst ? 1 : 0; i < (frames || []).length; i++) { const src = imgOf(frames[i]); if (src) out.push({ index: i, frame: frames[i], src }) }
  return out
}

/** At most `fit` of `items` (sorted by index), evenly spaced from the first to the last of them; all of them when they fit. One thumbnail is the middle one. */
export function pickSamples(items, fit) {
  const n = items.length, k = Math.max(0, Math.floor(fit))
  if (!n || !k) return []
  if (n <= k) return items.slice()
  if (k === 1) return [items[Math.floor((n - 1) / 2)]]
  const seen = new Set(), out = []
  for (let j = 0; j < k; j++) { const at = Math.round((j * (n - 1)) / (k - 1)); if (!seen.has(at)) { seen.add(at); out.push(items[at]) } }
  return out
}
