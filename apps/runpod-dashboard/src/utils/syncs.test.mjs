import test from 'node:test'
import assert from 'node:assert/strict'
import { pct, filePercent, runPercent, fmtEta, shortCursor, secondsLeft, isAuto, detailText, levelParam, baseName, clock } from './syncs.js'

test('pct clamps and handles unknown totals', () => {
  assert.equal(pct(5, 10), 50); assert.equal(pct(5, 0), 0); assert.equal(pct(20, 10), 100); assert.equal(pct(undefined, 10), 0); assert.equal(pct(-1, 10), 0)
})
test('filePercent prefers the core percent, else bytes', () => {
  assert.equal(filePercent({ percent: 42.4, bytes_done: 1, bytes_total: 2 }), 42)
  assert.equal(filePercent({ bytes_done: 1, bytes_total: 4 }), 25)
  assert.equal(filePercent({}), 0)
})
test('runPercent uses bytes, else files', () => {
  assert.equal(runPercent({ bytes_done: 30, bytes_total: 60, files_done: 1, files_total: 10 }), 50)
  assert.equal(runPercent({ files_done: 1, files_total: 10 }), 10)
  assert.equal(runPercent(null), 0)
})
test('fmtEta', () => {
  assert.equal(fmtEta(45), '45 s'); assert.equal(fmtEta(185), '3 min 05 s'); assert.equal(fmtEta(3720), '1 h 02 min')
  assert.equal(fmtEta(null), ''); assert.equal(fmtEta(-3), ''); assert.equal(fmtEta(0), '0 s')
})
test('cursor, debounce, trigger, name, clock', () => {
  assert.equal(shortCursor('abcdef0123456789'), 'abcdef01…'); assert.equal(shortCursor('42'), '42'); assert.equal(shortCursor(null), '')
  assert.equal(secondsLeft(6500), 7); assert.equal(secondsLeft(0), 0); assert.equal(secondsLeft(undefined), 0)
  assert.equal(isAuto('auto-sync:feed'), true); assert.equal(isAuto('manual'), false); assert.equal(isAuto(undefined), false)
  assert.equal(baseName('output/r1/a.png'), 'a.png')
  assert.equal(clock('nope'), ''); assert.match(clock('2026-11-18T10:00:00Z'), /^\d\d:\d\d$/)
})
test('detailText and levelParam', () => {
  assert.equal(detailText('3 files'), '3 files'); assert.equal(detailText(null), '')
  assert.equal(detailText({ files: 3, total_bytes: 2048 }), 'files 3, total bytes 2.0 KB')
  assert.equal(levelParam('all'), ''); assert.equal(levelParam('warn'), 'warn'); assert.equal(levelParam('error'), 'error')
})
