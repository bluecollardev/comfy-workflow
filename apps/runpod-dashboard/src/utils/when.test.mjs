import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whenText, durationText, agoShort, attempt } from './when.js'

const NOW = new Date(2026, 10, 19, 15, 0, 0)   // local time
const at = (d, h, m, s) => new Date(2026, 10, d, h, m, s).toISOString()
test('whenText: the clock for today, the date and clock for an older day, nothing for a missing or invalid time', () => {
  assert.equal(whenText(at(19, 14, 26, 15), NOW), '14:26:15'); assert.equal(whenText(at(18, 9, 5, 7), NOW), '18 Nov 09:05:07')
  for (const x of [undefined, null, '', 'nope', 'Invalid Date']) assert.equal(whenText(x, NOW), '')
})
test('durationText: seconds, minutes, hours; unknown or negative is empty', () => {
  assert.equal(durationText(at(19, 14, 26, 15), at(19, 14, 26, 37)), '22 s'); assert.equal(durationText(at(19, 14, 0, 0), at(19, 14, 3, 5)), '3 min 5 s'); assert.equal(durationText(at(19, 14, 0, 0), at(19, 15, 2, 0)), '1 h 2 min')
  assert.equal(durationText(at(19, 14, 0, 0), undefined), ''); assert.equal(durationText(at(19, 14, 5, 0), at(19, 14, 0, 0)), '')
})
test('agoShort and attempt: the card lines, with what is missing left out', () => {
  assert.equal(agoShort(at(19, 14, 57, 0), NOW.getTime()), '3 min ago'); assert.equal(agoShort('x', NOW.getTime()), '')
  assert.deepEqual(attempt({ started_at: at(19, 14, 26, 15), finished_at: at(19, 14, 26, 37) }, NOW), { started: 'Started 14:26:15', finished: 'Finished 14:26:37 · took 22 s', ago: '34 min ago' })
  assert.deepEqual(attempt({ started_at: at(17, 8, 0, 0) }, NOW).started, 'Started 17 Nov 08:00:00'); assert.deepEqual(attempt({}, NOW), { started: '', finished: '', ago: '' }); assert.equal(attempt(undefined, NOW).started, '')
})
