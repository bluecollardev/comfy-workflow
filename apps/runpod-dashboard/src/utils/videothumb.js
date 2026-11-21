/**
 * videothumb: the first frame of a video, captured in the page with no pod and no job (Lucas, 2026-11-21: a video tile should show its first frame).
 * A hidden, off-DOM <video muted preload="metadata"> on the address the viewer uses, `loadeddata`, frame 0 drawn into a canvas about 320 px wide, a small JPEG data URL.
 * At most TWO captures run at once across the whole window, each video element is torn down (src removed, load()) as soon as the frame is taken, the result (or the failure)
 * is kept in memory by address so a second open costs nothing, and a capture that does not finish in 60 s (`reason: 'timeout'`, the tile offers one retry), or whose codec the page cannot decode (HEVC, ProRes: `reason: 'error'`), ends as '' with
 * no automatic retry. `stats` is exposed for the specs (window.__videoThumb).
 */
export const MAX_AT_ONCE = 2, TIMEOUT_MS = 60000, WIDTH = 320
/** The capture time limit: 60 s (Lucas's link gave 1 to 14 s to the first byte and about 25 KB/s; an 8 MB mp4 with its index at the end needs a minute). The specs lower it through window.__videoThumbLimits.timeoutMs. */
export const limits = { timeoutMs: TIMEOUT_MS }
if (typeof window !== 'undefined') window.__videoThumbLimits = limits
export const stats = { active: 0, max: 0, started: 0, hits: 0, failed: 0 }
if (typeof window !== 'undefined') window.__videoThumb = stats
const done = new Map()   // address -> data URL, or '' when it cannot be made
const waiting = []       // { src, resolve } not started yet
const inflight = new Map()   // address -> Promise (one capture per address even when asked twice)

function grab(src) {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    let settled = false, timer = null
    const finish = (url, w = 0, h = 0, reason = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      v.onloadeddata = v.onseeked = v.onerror = null
      try { v.pause(); v.removeAttribute('src'); v.load() } catch { /* the element is dropped anyway */ }
      resolve({ url, w, h, reason })
    }
    const draw = () => {
      try {
        const w = v.videoWidth || WIDTH, h = v.videoHeight || Math.round(WIDTH * 9 / 16), c = document.createElement('canvas')
        c.width = Math.min(WIDTH, w); c.height = Math.max(1, Math.round(c.width * h / w))
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height)
        finish(c.toDataURL('image/jpeg', 0.7), v.videoWidth || 0, v.videoHeight || 0)
      } catch { finish('', 0, 0, 'error') }   // a tainted canvas (no CORS answer) or no frame: no thumbnail, never an error
    }
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.crossOrigin = 'anonymous'
    v.onerror = () => finish('', 0, 0, 'error')
    v.onloadeddata = () => { if (v.currentTime > 0 || v.readyState < 2) draw(); else { v.onseeked = draw; try { v.currentTime = 0.001 } catch { draw() } } }
    timer = setTimeout(() => finish('', 0, 0, 'timeout'), globalThis.__VT_TIMEOUT_MS__ || limits.timeoutMs)   // __VT_TIMEOUT_MS__: the specs only
    v.src = src
  })
}

function pump() {
  while (stats.active < MAX_AT_ONCE && waiting.length) {
    const { src, resolve } = waiting.shift()
    stats.active++; stats.max = Math.max(stats.max, stats.active); stats.started++
    grab(src).then((r) => { done.set(src, r); if (!r.url) stats.failed++; resolve(r) }).finally(() => { stats.active--; inflight.delete(src); pump() })
  }
}

/** The first frame of the video at `src`: { url: a JPEG data URL or '' when it cannot be made, w, h: the video's own size, reason: '' | 'timeout' | 'error' }. Cached by address; never rejects. */
export function firstFrame(src) {
  if (!src) return Promise.resolve({ url: '', w: 0, h: 0 })
  if (done.has(src)) { stats.hits++; return Promise.resolve(done.get(src)) }
  if (inflight.has(src)) return inflight.get(src)
  const p = new Promise((resolve) => { waiting.push({ src, resolve }); pump() })
  inflight.set(src, p)
  return p
}

/** Try again after a time-out (the retry glyph on the tile): the failed answer is forgotten and the capture is queued once more. */
export function retryFirstFrame(src) { done.delete(src); return firstFrame(src) }

/** Forget what was captured (the specs, and a regenerated file). */
export function clearFirstFrames() { done.clear() }
