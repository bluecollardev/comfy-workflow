/**
 * Timecode and frame-step math for the video viewer (pure). The file's frame rate is not exposed by the browser, so the viewer's fps selector (12, 24, 25, 30; default 24) is the display rate.
 * Timecode is mm:ss:ff (minutes may pass 59: no hours). A step is one frame (1/fps s), or 10 with Shift; positions are clamped to [0, duration] and snapped to a frame boundary (+ a quarter frame so the frame shown is the intended one).
 */
export const FPS_OPTIONS = [12, 24, 25, 30]
export const SPEEDS = [0.25, 0.5, 1, 2]
const pad = (n) => String(n).padStart(2, '0')
export function timecode(seconds, fps = 24) {
  const s = Math.max(0, Number(seconds) || 0), f = Math.round(fps)
  const total = Math.floor(s * f + 1e-6)
  const frames = total % f, secs = Math.floor(total / f)
  return `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}:${pad(frames)}`
}
/** The frame number (0-based) at `seconds`. */
export const frameAt = (seconds, fps = 24) => Math.floor(Math.max(0, Number(seconds) || 0) * fps + 1e-6)
/** currentTime after stepping `n` frames from `t` (n may be negative), within [0, duration]. */
export function stepTime(t, n, fps = 24, duration = Infinity) {
  const target = (frameAt(t, fps) + n) * (1 / fps) + 0.25 / fps
  const max = Number.isFinite(duration) ? Math.max(0, duration - 0.001) : Infinity
  return Math.min(max, Math.max(0, target))
}
/** The buffered ranges of a media element as fractions [start, end] of the duration, for the scrubber. */
export function bufferedFractions(ranges, duration) {
  if (!ranges || !duration) return []
  const out = []
  for (let i = 0; i < ranges.length; i++) out.push([Math.min(1, ranges.start(i) / duration), Math.min(1, ranges.end(i) / duration)])
  return out
}
/** Whether a MediaError (or its code) says the browser engine cannot play this file: 3 = decode error, 4 = source not supported. */
export const isCodecError = (err) => { const c = typeof err === 'number' ? err : err?.code; return c === 3 || c === 4 }
