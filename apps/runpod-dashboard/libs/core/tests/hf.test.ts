import { describe, expect, it } from 'vitest'
import * as hf from '../src/hf.js'

// Hugging Face as a source of model files (ADR-042): what a request may ask for is fixed here, not by the window.
const TREE = [
  { type: 'file', path: 'diffusion_models/seedvr2_3b_fp16.safetensors', size: 100, lfs: { oid: 'a'.repeat(64), size: 6784268336 } },
  { type: 'file', path: 'vae/seedvr2_ema_vae_fp16.safetensors', size: 100, lfs: { oid: 'b'.repeat(64), size: 501324814 } },
  { type: 'file', path: 'README.md', size: 10 },
  { type: 'file', path: 'tool.py', size: 10, lfs: { oid: 'c'.repeat(64), size: 10 } },
  { type: 'file', path: 'model.ckpt', size: 10, lfs: { oid: 'd'.repeat(64), size: 10 } },
  { type: 'directory', path: 'vae' },
]
const fakeFetch = (status = 200, body: unknown = TREE) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('hugging face', () => {
  it('searches: needs two characters, keeps well-formed repos, reads gated', async () => {
    await expect(hf.search('a')).rejects.toThrow(/at least two/)
    const f = fakeFetch(200, [{ id: 'Comfy-Org/SeedVR2', downloads: 5, likes: 2, lastModified: '2026-11-01T00:00:00Z', gated: false }, { id: 'bad name', downloads: 1 }, { id: 'o/gated', gated: 'auto' }])
    const r = await hf.search('seedvr2', f)
    expect(r.map((x) => x.id)).toEqual(['Comfy-Org/SeedVR2', 'o/gated'])
    expect(r[0]).toMatchObject({ downloads: 5, likes: 2, updated: '2026-11-01', gated: false }); expect(r[1].gated).toBe(true)
  })
  it('lists only weight files with their exact size and sha256, smallest first, each with a guessed folder', async () => {
    const r = await hf.files('Comfy-Org/SeedVR2', 'main', fakeFetch())
    expect(r.map((x) => x.path)).toEqual(['vae/seedvr2_ema_vae_fp16.safetensors', 'diffusion_models/seedvr2_3b_fp16.safetensors'])   // no README, no .py, no .ckpt, no directory
    expect(r[0]).toMatchObject({ bytes: 501324814, sha256: 'b'.repeat(64), folder: 'vae' }); expect(r[1].folder).toBe('diffusion_models')
  })
  it('guesses the models folder from the path', () => {
    expect(hf.guessFolder('x/my_lora_v2.safetensors')).toBe('loras'); expect(hf.guessFolder('ae.safetensors')).toBe('diffusion_models')
    expect(hf.guessFolder('RealESRGAN_x4.pth')).toBe('upscale_models'); expect(hf.guessFolder('t5xxl_fp16.safetensors')).toBe('text_encoders')
    expect(hf.guessFolder('controlnet/canny.safetensors')).toBe('controlnet'); expect(hf.guessFolder('vae/x.safetensors')).toBe('vae')
  })
  it('resolve: the URL, size and hash are Hugging Face\'s, the folder one of the fixed list', async () => {
    const r = await hf.resolve([{ repo: 'Comfy-Org/SeedVR2', path: 'vae/seedvr2_ema_vae_fp16.safetensors', folder: 'vae' }], fakeFetch())
    expect(r).toEqual([{ repo: 'Comfy-Org/SeedVR2', revision: 'main', path: 'vae/seedvr2_ema_vae_fp16.safetensors', name: 'seedvr2_ema_vae_fp16.safetensors', folder: 'vae', bytes: 501324814, sha256: 'b'.repeat(64), url: 'https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors' }])
  })
  it('resolve refuses: a bad repo, a path with .., a file that is not a weight file, an unknown folder, nothing, too many, an unsafe name', async () => {
    const ok = { repo: 'Comfy-Org/SeedVR2', path: 'vae/seedvr2_ema_vae_fp16.safetensors', folder: 'vae' }
    const f = fakeFetch()
    await expect(hf.resolve([{ ...ok, repo: 'no-slash' }], f)).rejects.toThrow(/Not a Hugging Face repo/)
    await expect(hf.resolve([{ ...ok, repo: 'a/b;rm' }], f)).rejects.toThrow(/Not a Hugging Face repo/)
    await expect(hf.resolve([{ ...ok, path: '../x.safetensors' }], f)).rejects.toThrow(/Not a file path/)
    await expect(hf.resolve([{ ...ok, path: '/etc/x.safetensors' }], f)).rejects.toThrow(/Not a file path/)
    await expect(hf.resolve([{ ...ok, path: 'tool.py' }], f)).rejects.toThrow(/no weight file/)
    await expect(hf.resolve([{ ...ok, path: 'model.ckpt' }], f)).rejects.toThrow(/no weight file/)
    await expect(hf.resolve([{ ...ok, folder: 'workflows' }], f)).rejects.toThrow(/Not a models folder/)
    await expect(hf.resolve([{ ...ok, revision: 'a b' }], f)).rejects.toThrow(/Not a revision/)
    await expect(hf.resolve([], f)).rejects.toThrow(/at least one/)
    await expect(hf.resolve(Array.from({ length: 21 }, () => ok), f)).rejects.toThrow(/At most 20/)
  })
  it('a gated or missing repo is refused with the reason', async () => {
    await expect(hf.files('o/gated', 'main', fakeFetch(401, {}))).rejects.toThrow(/gated or private/)
    await expect(hf.files('o/none', 'main', fakeFetch(404, {}))).rejects.toThrow(/no such repo/)
    await expect(hf.files('o/err', 'main', fakeFetch(500, {}))).rejects.toThrow(/HTTP 500/)
  })
})
