import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtBytes, fmtRate, percent, visible, isActive } from './autosync.js'

test('fmtBytes: binary units, one decimal above bytes, empty when unknown', () => {
  assert.equal(fmtBytes(0), '0 B')
  assert.equal(fmtBytes(512), '512 B')
  assert.equal(fmtBytes(1024), '1.0 KB')
  assert.equal(fmtBytes(38 * 1024 * 1024), '38.0 MB')
  assert.equal(fmtBytes(1.2 * 1024 ** 3), '1.2 GB')
  assert.equal(fmtBytes(null), '')
  assert.equal(fmtBytes(undefined), '')
  assert.equal(fmtBytes(-5), '0 B')
})
test('fmtRate: per second, empty with no rate', () => {
  assert.equal(fmtRate(38 * 1024 * 1024), '38.0 MB/s')
  assert.equal(fmtRate(0), '')
  assert.equal(fmtRate(null), '')
})
test('percent: from bytes, else from files, clamped, 0 when unknown', () => {
  assert.equal(percent({ bytes_done: 1, bytes_total: 4, files_done: 9, files_total: 10 }), 25)
  assert.equal(percent({ files_done: 12, files_total: 25 }), 48)
  assert.equal(percent({ bytes_done: 9, bytes_total: 4 }), 100)
  assert.equal(percent({}), 0)
  assert.equal(percent(null), 0)
})
test('visible: done leaves after the delay, error stays, idle never shows', () => {
  const now = Date.parse('2026-11-18T10:00:10Z')
  assert.equal(visible({ state: 'done', finished_at: '2026-11-18T10:00:05Z' }, now, 8000), true)
  assert.equal(visible({ state: 'done', finished_at: '2026-11-18T10:00:00Z' }, now, 8000), false)
  assert.equal(visible({ state: 'error', finished_at: '2020-01-01T00:00:00Z' }, now), true)
  assert.equal(visible({ state: 'idle' }, now), false)
  assert.equal(visible({ state: 'syncing' }, now), true)
  assert.equal(visible(null, now), false)
})
test('isActive: waiting, syncing and needs_approval keep the fast poll', () => {
  assert.equal(isActive({ state: 'syncing' }), true)
  assert.equal(isActive({ state: 'done' }), false)
  assert.equal(isActive({ state: 'error' }), false)
})
