// The DPX viewer's playback clock (src/utils/playback.js): advance at fps, loop, hold on a missing frame, pause. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPlayback } from './playback.js'

const run = (p, from, to, step = 1) => { const seen = []; for (let t = from; t <= to; t += step) { const s = p.tick(t); if (s.changed) seen.push([t, s.index]) } return seen }

test('advances one frame every 1000/fps ms', () => {
  const p = createPlayback({ count: 10, fps: 25 })   // 40 ms
  p.play(0)
  assert.deepEqual(run(p, 0, 130), [[40, 1], [80, 2], [120, 3]])
  p.setFps(12.5)   // 80 ms from now on
  assert.deepEqual(run(p, 131, 300).map((x) => x[1]), [4, 5])
})
test('does not advance when paused, and pause holds the frame', () => {
  const p = createPlayback({ count: 5, fps: 24 })
  assert.equal(p.play(0), true); run(p, 0, 50); assert.equal(p.index, 1)
  p.pause(); assert.equal(p.playing, false)
  assert.equal(p.tick(500).changed, false); assert.equal(p.index, 1)
})
test('loops from the last frame to the first; without loop it ends there', () => {
  const p = createPlayback({ count: 3, fps: 1000 })
  p.play(0); assert.deepEqual(run(p, 0, 6).map((x) => x[1]), [1, 2, 0, 1, 2, 0])
  const q = createPlayback({ count: 3, fps: 1000, loop: false })
  q.play(0)
  let ended = false; for (let t = 0; t < 10; t++) { const s = q.tick(t); ended = ended || s.ended }
  assert.equal(ended, true); assert.equal(q.index, 2); assert.equal(q.playing, false)
  q.play(100); assert.equal(q.index, 0)   // Play at the end starts again
})
test('holds on the shown frame while the next is not cached, then continues from the arrival, never skipping', () => {
  const have = new Set([0, 1, 3])
  const p = createPlayback({ count: 4, fps: 100, isCached: (i) => have.has(i) })   // 10 ms
  p.play(0)
  assert.equal(p.tick(10).index, 1)
  let s = p.tick(20); assert.equal(s.buffering, true); assert.equal(s.waitingFor, 2); assert.equal(s.index, 1)
  s = p.tick(500); assert.equal(s.buffering, true); assert.equal(s.changed, false); assert.equal(s.index, 1)   // still held, far past the due time
  have.add(2)
  s = p.tick(510); assert.equal(s.index, 2); assert.equal(s.changed, true); assert.equal(s.buffering, false)
  assert.equal(p.tick(515).changed, false)   // the clock restarted at the arrival: no catching up
  assert.equal(p.tick(520).index, 3)
})
test('a late tick moves one frame, not several', () => {
  const p = createPlayback({ count: 10, fps: 25 })
  p.play(0)
  assert.equal(p.tick(1000).index, 1); assert.equal(p.tick(1001).changed, false)
})
test('seek clamps and clears a wait; one frame cannot play', () => {
  const p = createPlayback({ count: 3, fps: 100, isCached: () => false })
  p.play(0); p.tick(10); assert.equal(p.waitingFor, 1)
  p.seek(9); assert.equal(p.index, 2); assert.equal(p.waitingFor, null)
  assert.equal(createPlayback({ count: 1 }).play(0), false)
})

import { timecode, frameAt, stepTime, bufferedFractions, isCodecError } from './timecode.js'
test('timecode mm:ss:ff at the chosen fps', () => {
  assert.equal(timecode(0, 24), '00:00:00'); assert.equal(timecode(1, 24), '00:01:00'); assert.equal(timecode(1.5, 24), '00:01:12')
  assert.equal(timecode(61.04, 25), '01:01:01'); assert.equal(timecode(2, 30), '00:02:00'); assert.equal(timecode(0.999, 24), '00:00:23')
  assert.equal(timecode(-3, 24), '00:00:00'); assert.equal(timecode(NaN, 24), '00:00:00')
})
test('frame step: one frame or ten, clamped, landing inside the frame', () => {
  assert.equal(frameAt(stepTime(1, 1, 24)), 25); assert.equal(frameAt(stepTime(1, -1, 24)), 23, 'frame 23 of 24')
  assert.equal(frameAt(stepTime(1, 10, 24), 24), 34); assert.ok(stepTime(0, -1, 24) < 1 / 24)
  assert.ok(stepTime(0, -10, 24) >= 0)
  assert.ok(stepTime(9.99, 10, 24, 10) < 10); assert.equal(timecode(stepTime(2, 1, 25), 25), '00:02:01')
  const a = stepTime(0, 1, 24); assert.ok(a > 1 / 24 && a < 2 / 24)
})
test('buffered fractions and codec errors', () => {
  const r = { length: 2, start: (i) => [0, 5][i], end: (i) => [2, 12][i] }
  assert.deepEqual(bufferedFractions(r, 10), [[0, 0.2], [0.5, 1]]); assert.deepEqual(bufferedFractions(null, 10), []); assert.deepEqual(bufferedFractions(r, 0), [])
  assert.equal(isCodecError({ code: 4 }), true); assert.equal(isCodecError(3), true); assert.equal(isCodecError({ code: 2 }), false); assert.equal(isCodecError(null), false)
})
