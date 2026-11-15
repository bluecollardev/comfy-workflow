import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as hf from '../src/hf.js'
import * as settings from '../src/settings.js'

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

beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(mkdtempSync(join(tmpdir(), 'hf-')), '.env'); delete process.env.HF_TOKEN })   // never the real stored token
afterEach(() => { delete process.env.SETTINGS_ENV_FILE; delete process.env.HF_TOKEN })

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

  it('a gated repo: the tree masks the hash, so the file is listed (name, size) as locked and cannot be loaded; without a token the message says what to do', async () => {
    const MASKED = [{ type: 'file', path: 'flux-2-klein-9b-fp8.safetensors', size: 9433061528, lfs: { oid: '*'.repeat(64), size: 9433061528 } }, { type: 'file', path: 'editing.jpg', size: 5, lfs: { oid: '*'.repeat(64), size: 5 } }]
    const f = fakeFetch(200, MASKED)
    const r = await hf.files('black-forest-labs/FLUX.2-klein-9b-fp8', 'main', f)
    expect(r).toEqual([{ path: 'flux-2-klein-9b-fp8.safetensors', bytes: 9433061528, sha256: '', folder: 'diffusion_models', locked: true }])
    await expect(hf.resolve([{ repo: 'black-forest-labs/FLUX.2-klein-9b-fp8', path: 'flux-2-klein-9b-fp8.safetensors', folder: 'diffusion_models' }], f)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/is gated: accept its terms on huggingface\.co and set a Hugging Face token \(Default Configuration\)/) })
    await expect(hf.resolve([{ repo: 'black-forest-labs/FLUX.2-klein-9b-fp8', path: 'flux-2-klein-9b-fp8.safetensors', folder: 'diffusion_models' }], f)).rejects.not.toThrow(/no weight file/)
  })
  it('with a token: it is sent to huggingface.co as a bearer header, the real hashes load, and it is in no error message', async () => {
    settings.set({ hf_token: 'hf_SECRET_TOKEN_VALUE_1234' })
    const seen: { url: string; auth: string | null }[] = []
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, auth: new Headers(init.headers).get('authorization') }); return new Response(JSON.stringify([{ type: 'file', path: 'a.safetensors', size: 1, lfs: { oid: 'e'.repeat(64), size: 1 } }]), { status: 200 }) }) as unknown as typeof fetch
    const r = await hf.resolve([{ repo: 'o/gated', path: 'a.safetensors', folder: 'vae' }], f)
    expect(r[0]).toMatchObject({ sha256: 'e'.repeat(64) })
    expect(seen.every((s) => s.auth === 'Bearer hf_SECRET_TOKEN_VALUE_1234' && s.url.startsWith('https://huggingface.co/'))).toBe(true)
    for (const status of [401, 403]) {
      const err = await hf.files('o/gated', 'main', fakeFetch(status, {})).catch((e) => e)
      expect(err.message).toMatch(/refused this token/); expect(err.message).not.toContain('hf_SECRET')
    }
    // masked even with a token: the account has not accepted the terms
    const masked = fakeFetch(200, [{ type: 'file', path: 'a.safetensors', size: 1, lfs: { oid: '*'.repeat(64), size: 1 } }])
    const e2 = await hf.resolve([{ repo: 'o/gated', path: 'a.safetensors', folder: 'vae' }], masked).catch((e) => e)
    expect(e2.message).toMatch(/this Hugging Face token cannot read it: accept its terms at https:\/\/huggingface\.co\/o\/gated/); expect(e2.message).not.toContain('hf_SECRET')
  })
  it('no token: no Authorization header at all', async () => {
    let auth: string | null = 'unset'
    const f = (async (_u: string, init: RequestInit) => { auth = new Headers(init.headers).get('authorization'); return new Response('[]', { status: 200 }) }) as unknown as typeof fetch
    await hf.files('o/x', 'main', f); expect(auth).toBeNull()
  })
})
