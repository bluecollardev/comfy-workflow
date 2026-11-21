import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gpuLine, ramLine, RAM_WARN_PCT } from './podcard.js'

test('gpuLine: one card keeps the per-card size, two cards show the count and the total', () => {
  assert.deepEqual(gpuLine({ gpu: 'RTX PRO 4500', vram: 32, gpu_count: 1, vram_total: 32 }), { name: 'RTX PRO 4500', vram: '32 GB' })
  assert.deepEqual(gpuLine({ gpu: 'RTX PRO 4500', vram: 32, gpu_count: 2, vram_total: 64 }), { name: 'RTX PRO 4500 x2', vram: '64 GB VRAM' })
  assert.deepEqual(gpuLine({ gpu: 'RTX PRO 4500', vram: 32, gpu_count: 2 }), { name: 'RTX PRO 4500 x2', vram: '64 GB VRAM' })   // total worked out when absent
  assert.deepEqual(gpuLine({ gpu: 'RTX 4090', vram: 24 }), { name: 'RTX 4090', vram: '24 GB' })   // an older answer with no count
})

test('ramLine: nothing when unknown, the limit when known, used and percent when read, a warning at the guard', () => {
  assert.equal(ramLine({}), null); assert.equal(ramLine({ ram_gb: 0 }), null); assert.equal(ramLine(null), null)
  assert.deepEqual(ramLine({ ram_gb: 116.4 }), { limit: 116, used: null, pct: null, warn: false })
  assert.deepEqual(ramLine({ ram_gb: 116.4, ram_used_gb: 40.2, ram_pct: 34.5 }), { limit: 116, used: 40, pct: 34.5, warn: false })
  assert.equal(RAM_WARN_PCT, 85)
  assert.equal(ramLine({ ram_gb: 57.7, ram_used_gb: 49, ram_pct: 84.9 }).warn, false)
  assert.equal(ramLine({ ram_gb: 57.7, ram_used_gb: 49.05, ram_pct: 85 }).warn, true)
  assert.equal(ramLine({ ram_gb: 87.5, ram_used_gb: 80, ram_pct: 91.4 }).warn, true)
})
