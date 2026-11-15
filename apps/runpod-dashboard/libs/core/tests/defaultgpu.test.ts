import { beforeEach, describe, expect, it } from 'vitest'
import * as configio from '../src/configio.js'
import * as gpus from '../src/gpus.js'
import * as mounts from '../src/mounts.js'
import * as pods from '../src/pods.js'
import * as queue from '../src/queue.js'
import { scratch } from './helpers.js'

// The default card (Lucas, 2026-11-15: "set pro 6000 as default card"): one system-wide setting, the RTX PRO 6000 unless changed; an explicit card always wins.
beforeEach(() => { scratch() })

const cfg = (over: Partial<mounts.MountsConfig> = {}) => mounts.validate(mounts.normalize({ ...mounts.load(), image: 'ghcr.io/example/comfy-app:v26', apply_by_default: false, ...over }))

describe('default_gpu', () => {
  it('is the RTX PRO 6000 until changed, and an empty value falls back to it', () => {
    expect(mounts.load().default_gpu).toBe('rtxpro6000')
    expect(mounts.normalize({ default_gpu: '' }).default_gpu).toBe('rtxpro6000')
  })
  it('takes auto or a card of the table and refuses anything else', () => {
    expect(mounts.put({ default_gpu: 'auto' }, { quiet: true }).config.default_gpu).toBe('auto')
    expect(mounts.put({ default_gpu: 'rtx4090' }, { quiet: true }).config.default_gpu).toBe('rtx4090')
    expect(() => mounts.put({ default_gpu: 'gtx-9000' }, { quiet: true })).toThrow(/default_gpu is auto or one of/)
  })
})

describe('a pod made with no card named', () => {
  it('gets the default card, on the CUDA 13 image when that card needs it', () => {
    const p = pods.plan({ name: 't', apply_mounts: false }, cfg())
    expect(p.input.gpuTypeId).toBe(gpus.GPUS.rtxpro6000.id)
    expect(p.input.imageName).toBe('ghcr.io/example/comfy-app:v26-cu13')
    expect(p.input.allowedCudaVersions).toEqual(gpus.CUDA13_HOSTS)
  })
  it('a pinned digest becomes its CUDA 13 digest for the default card', () => {
    const digest = Object.keys(gpus.CU13_PINS)[0]
    const p = pods.plan({ name: 't', apply_mounts: false }, cfg({ image: digest }))
    expect(p.input.imageName).toBe(gpus.CU13_PINS[digest])
  })
  it('an explicit card wins, and auto as the default means the cheapest in stock', () => {
    expect(pods.plan({ name: 't', gpu: 'rtx4090', apply_mounts: false }, cfg()).input.gpuTypeId).toBe(gpus.GPUS.rtx4090.id)
    expect(pods.plan({ name: 't', apply_mounts: false }, cfg({ default_gpu: 'auto' })).input.gpuTypeId).toBe(gpus.AUTO)
  })
  it('the card menu names the default', async () => {
    mounts.put({ default_gpu: 'rtxpro6000', dry_run: true }, { quiet: true })
    expect((await pods.gpuMenu()).default).toBe('rtxpro6000')
  })
})

describe('the queue pool', () => {
  it('uses the default card for a shot with no card chosen', () => {
    expect(queue.poolGpu()).toBe('rtxpro6000')
    mounts.put({ default_gpu: 'a100' }, { quiet: true })
    expect(queue.poolGpu()).toBe('a100')
  })
})

describe('export and import', () => {
  it('default_gpu travels in the Pod defaults section and a bad card is refused', () => {
    mounts.put({ default_gpu: 'rtx4090' }, { quiet: true })
    expect(configio.exportConfig().config.default_gpu).toBe('rtx4090')
    expect((configio.SECTIONS.pod_defaults.fields as string[])).toContain('default_gpu')
    mounts.put({ default_gpu: 'auto' }, { quiet: true })
    const file = { format: configio.FORMAT, version: 1, config: { default_gpu: 'rtxpro6000' } }
    expect(configio.planImport(file).ok).toBe(true)
    configio.applyImport(file, { sections: ['pod_defaults'] })
    expect(mounts.load().default_gpu).toBe('rtxpro6000')
    const bad = configio.planImport({ format: configio.FORMAT, version: 1, config: { default_gpu: 'gtx-9000' } })
    expect(bad.ok).toBe(false); expect(bad.errors.join(' ')).toMatch(/default_gpu/)
  })
})
