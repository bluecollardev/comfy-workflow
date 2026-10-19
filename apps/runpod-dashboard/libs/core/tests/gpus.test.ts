import { describe, expect, it } from 'vitest'
import { DEFAULT_GPU, GPUS, menu, runpodId, vram } from '../src/gpus.js'

describe('gpus', () => {
  it('is the small-card menu with RunPod ids', () => {
    expect(Object.keys(GPUS)).toEqual(['a4000', 'rtx4000ada', 'a5000', 'rtx3090', 'rtx4090']); expect(DEFAULT_GPU).toBe('auto')
    expect(runpodId('a4000')).toBe('NVIDIA RTX A4000'); expect(runpodId('NVIDIA GeForce RTX 4090')).toBe('NVIDIA GeForce RTX 4090')
    expect(vram('a4000')).toBe(16); expect(Object.values(GPUS).every((g) => g.vram <= 24)).toBe(true)
    expect(() => runpodId('h100')).toThrow()
    expect(menu()[0].value).toBe('auto'); expect(menu()[5]).toEqual({ value: 'rtx4090', text: 'RTX 4090 (24 GB)' })
  })
})
