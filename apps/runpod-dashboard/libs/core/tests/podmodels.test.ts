import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as podmodels from '../src/podmodels.js'

beforeEach(() => { process.env.POD_MODELS_FILE = join(mkdtempSync(join(tmpdir(), 'pm-')), 'pod-models.json') })

const graph = () => ({
  '1': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '2': { class_type: 'UNETLoader', inputs: { unet_name: 'a.safetensors' } },
})

describe('per-pod model choice (ADR-042)', () => {
  it('keeps a choice per pod, clears it with an empty name, and drops it with the pod', () => {
    podmodels.set('p1', { vae: 'seedvr2_vae.safetensors', diffusion_model: 'seedvr2_3b_fp16.safetensors' })
    expect(podmodels.get('p1')).toEqual({ vae: 'seedvr2_vae.safetensors', diffusion_model: 'seedvr2_3b_fp16.safetensors' })
    expect(podmodels.get('p2')).toEqual({})
    expect(podmodels.set('p1', { vae: '' })).toEqual({ diffusion_model: 'seedvr2_3b_fp16.safetensors' })
    podmodels.forget('p1'); expect(podmodels.get('p1')).toEqual({})
  })
  it('refuses an unknown slot and a path-like name', () => {
    expect(() => podmodels.set('p1', { clip: 'x' } as never)).toThrow(/Unknown model slot/)
    expect(() => podmodels.set('p1', { vae: '../x.safetensors' })).toThrow(/Not a model file name/)
  })
  it('puts the choice into a graph with one loader of that class, and says what it did', () => {
    const g = graph()
    const r = podmodels.apply(g, { vae: 'seedvr2_vae.safetensors' })
    expect(g['1'].inputs.vae_name).toBe('seedvr2_vae.safetensors')
    expect(g['2'].inputs.unet_name).toBe('a.safetensors')   // not chosen: untouched
    expect(r.applied).toEqual([{ slot: 'vae', node: '1', from: 'ae.safetensors', to: 'seedvr2_vae.safetensors' }])
  })
  it('leaves a graph alone when it has two loaders of the class (it cannot tell which is meant) or none', () => {
    const g: Record<string, unknown> = { ...graph(), '3': { class_type: 'VAELoader', inputs: { vae_name: 'other.safetensors' } } }
    const r = podmodels.apply(g, { vae: 'x.safetensors' })
    expect(r.applied).toEqual([]); expect(r.skipped[0]).toMatch(/2 VAELoader nodes/)
    expect(podmodels.apply({ '1': { class_type: 'KSampler', inputs: {} } }, { vae: 'x' })).toEqual({ applied: [], skipped: [] })
  })
  it('reads the files ComfyUI offers from /object_info', async () => {
    const f = (async (u: string) => new Response(JSON.stringify(u.includes('VAELoader') ? { VAELoader: { input: { required: { vae_name: [['a.safetensors', 'b.safetensors']] } } } } : {}), { status: 200 })) as unknown as typeof fetch
    expect(await podmodels.choices('http://pod', f)).toEqual({ vae: ['a.safetensors', 'b.safetensors'], diffusion_model: [] })
  })
})
