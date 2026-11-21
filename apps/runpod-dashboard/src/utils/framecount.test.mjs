import test from 'node:test'
import assert from 'node:assert/strict'
import { frameCheck } from './framecount.js'
test('a tile with the EDL count is ok, otherwise it reports the difference', () => {
  const m = { match: 'exact', element: { frames_in_cut: 97 } }
  assert.deepEqual(frameCheck(m, 97), { ok: true, frames: 97, expected: 97, diff: 0 })
  assert.deepEqual(frameCheck(m, 96), { ok: false, frames: 96, expected: 97, diff: -1 })
  assert.deepEqual(frameCheck({ match: 'shot-element', element: { frames_in_cut: 43 } }, 45), { ok: false, frames: 45, expected: 43, diff: 2 })
})
test('nothing is said when the element is not in the EDL, is ambiguous or has no count', () => {
  assert.equal(frameCheck({ match: 'not-in-edl' }, 97), null)
  assert.equal(frameCheck({ match: 'ambiguous', candidates: [] }, 97), null)
  assert.equal(frameCheck({ match: 'exact', element: {} }, 97), null)
  assert.equal(frameCheck(null, 97), null)
  assert.equal(frameCheck({ match: 'exact', element: { frames_in_cut: 97 } }, 0), null)
})
