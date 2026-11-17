/**
 * The playback clock of the DPX viewer (docs/ADR-037, amendment 2026-11-17), pure: no DOM, no timers; the caller feeds it the time (requestAnimationFrame's) and says which frames are cached.
 * Playing advances ONE frame each 1000/fps ms. Frames are never skipped: if the next frame is not cached the playhead HOLDS on the shown one (`waitingFor` = that frame, `buffering`), the clock restarts when it arrives,
 * and a late frame never makes the playback run fast to catch up. At the end it wraps to frame 0 (Loop) or stops (`ended`). `seek` (any manual step) leaves playing to the caller, who pauses first.
 */
export function createPlayback({ count = 0, fps = 24, loop = true, isCached = () => true } = {}) {
  let index = 0, playing = false, waitingFor = null, t0 = 0
  const state = (changed = false, ended = false) => ({ index, playing, changed, ended, waitingFor, buffering: waitingFor !== null })
  return {
    get index() { return index },
    get playing() { return playing },
    get waitingFor() { return waitingFor },
    get fps() { return fps },
    state: () => state(),
    setCount(n) { count = n; if (index >= n) index = Math.max(0, n - 1) },
    setFps(v) { fps = v },
    setLoop(v) { loop = !!v },
    /** Start at `now`; from the last frame without Loop it starts again from the first. Returns false for fewer than two frames. */
    play(now) {
      if (count < 2) return false
      if (!loop && index >= count - 1) index = 0
      playing = true; waitingFor = null; t0 = now
      return true
    },
    pause() { playing = false; waitingFor = null },
    seek(i) { index = Math.min(Math.max(0, i), Math.max(0, count - 1)); waitingFor = null; t0 = 0 },
    /** Advance to `now`: at most one frame per call. */
    tick(now) {
      if (!playing) return state()
      if (waitingFor !== null) {
        if (!isCached(waitingFor)) return state()
        index = waitingFor; waitingFor = null; t0 = now
        return state(true)
      }
      const iv = 1000 / fps
      if (now - t0 < iv) return state()
      let next = index + 1
      if (next >= count) {
        if (!loop) { playing = false; return state(false, true) }
        next = 0
      }
      if (!isCached(next)) { waitingFor = next; return state() }
      index = next; t0 = now - t0 < 2 * iv ? t0 + iv : now
      return state(true)
    },
  }
}
