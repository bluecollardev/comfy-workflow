import test from 'node:test'
import assert from 'node:assert/strict'
import { DELIVERY_DEFAULTS, deliveryFill, deliveryIsDefault, deliveryBody, deliveryFps, deliveryTc } from './deliveryprepare.js'

test('an absent or partial block is filled with the defaults, and only an untouched one counts as default', () => {
  assert.deepEqual(deliveryFill(undefined), DELIVERY_DEFAULTS); assert.deepEqual(deliveryFill(null), DELIVERY_DEFAULTS); assert.deepEqual(deliveryFill([1]), DELIVERY_DEFAULTS)
  assert.equal(deliveryFill({ gamma: 2.4 }).gamma, 2.4); assert.equal(deliveryFill({ gamma: 2.4 }).out_dir, '_delivery_v11')
  assert.equal(deliveryIsDefault(undefined), true); assert.equal(deliveryIsDefault({ ...DELIVERY_DEFAULTS }), true); assert.equal(deliveryIsDefault({ gamma: 2.4 }), false); assert.equal(deliveryIsDefault({ skip_existing: true }), false)
})
test('a save sends numbers as numbers and a trimmed folder', () => {
  assert.deepEqual(deliveryBody({ out_dir: ' x ', gamma: '2.2', fps: '25', skip_existing: 1 }), { out_dir: 'x', colour_code: 'user-defined', gamma: 2.2, fps_source: 'clip-name', fps: 25, timecode_source: 'edl', frame_position: 'set', skip_existing: true })
})
test('the frame rate and timecode follow the settings', () => {
  assert.equal(deliveryFps(undefined, 'A_FINAL_V01_1920X1080_24_HEVC'), 24); assert.equal(deliveryFps(undefined, 'A_FINAL_V01_1920X1080_23.976_PRORES422HQ'), 23.976)
  assert.equal(deliveryFps({ fps_source: 'fixed', fps: 25 }, 'A_24_B'), 25); assert.equal(deliveryFps({ fps: 30 }, 'A_B'), 30)
  assert.equal(deliveryTc(undefined, '01:00:00:22'), '01:00:00:22'); assert.equal(deliveryTc(undefined, ''), '00:00:00:00'); assert.equal(deliveryTc({ timecode_source: 'zero' }, '01:00:00:22'), '00:00:00:00')
})
