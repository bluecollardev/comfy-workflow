import { describe, expect, it } from 'vitest'
import * as wanted from '../src/wanted.js'

// The wanted-models list (docs/ADR-042 section 12): entries are Hugging Face coordinates, checked like a fetch is.
const E = { folder: 'diffusion_models', repo: 'Lightricks/LTX-2.3', path: 'ltx-2.3-22b-dev.safetensors', bytes: 46_100_000_000 }

describe('wanted.check', () => {
  it('takes the file name from the path and keeps size, revision and note', () => {
    expect(wanted.check({ ...E, path: 'sub/dir/x.safetensors', revision: 'v2', note: ' hi ', sha256: 'a'.repeat(64) })).toEqual({ folder: 'diffusion_models', name: 'x.safetensors', repo: E.repo, path: 'sub/dir/x.safetensors', bytes: E.bytes, revision: 'v2', sha256: 'a'.repeat(64), note: 'hi' })
  })
  it('accepts one sub-folder and a trailing slash, refuses other folders, paths and names', () => {
    expect(wanted.check({ ...E, folder: 'loras/ltx2/' }).folder).toBe('loras/ltx2')
    expect(() => wanted.check({ ...E, folder: 'custom_nodes' })).toThrow(/Not a models folder/)
    expect(() => wanted.check({ ...E, folder: 'loras/a/b' })).toThrow(/Not a models folder/)
    expect(() => wanted.check({ ...E, path: '../x.safetensors' })).toThrow(/Not a file path/)
    expect(() => wanted.check({ ...E, repo: 'nope' })).toThrow(/Not a Hugging Face repo/)
    expect(() => wanted.check({ ...E, sha256: 'xyz' })).toThrow(/sha256/)
    expect(() => wanted.check({ ...E, bytes: -1 })).toThrow(/Not a size/)
    expect(() => wanted.check({ folder: 'vae', name: 'a b$.safetensors', repo: '', path: '' })).toThrow(/Unsafe file name/)
    expect(() => wanted.check({ folder: 'vae', name: 'a.safetensors', repo: '', path: 'p.safetensors' })).toThrow(/needs its repo/)
  })
  it('allows a name with no repo (a file recorded from a volume)', () => {
    expect(wanted.check({ folder: 'vae', name: 'a.safetensors', bytes: 5 })).toEqual({ folder: 'vae', name: 'a.safetensors', repo: '', path: '', bytes: 5 })
  })
})
describe('lists', () => {
  it('normalizeList drops bad entries and repeats; checkList names the first bad one', () => {
    expect(wanted.normalizeList([E, E, { folder: 'x' }, 5])).toHaveLength(1)
    expect(wanted.normalizeList('nope')).toEqual([])
    expect(wanted.checkList([E])).toBeNull(); expect(wanted.checkList([E, { folder: 'x' }])).toMatch(/Not a models folder/); expect(wanted.checkList({})).toMatch(/must be a list/)
  })
  it('merge replaces by repo+path+folder and keeps the rest; the same file in another folder is another entry', () => {
    const a = wanted.check(E), b = wanted.check({ ...E, path: 'b.safetensors' }), a2 = wanted.check({ ...E, bytes: 7 }), a3 = wanted.check({ ...E, folder: 'unet' })
    const m = wanted.merge([a, b], [a2, a3])
    expect(m).toHaveLength(3); expect(m.find((x) => x.path === E.path && x.folder === 'diffusion_models')!.bytes).toBe(7)
  })
})
describe('wanted.fromCsv', () => {
  const CSV = ['pipeline,install_to,file,hf_repo,hf_path,bytes,notes',
    'ltx-2.3,loras/ltx2/,x.safetensors,Kijai/LTX2.3_comfy,loras/x.safetensors,2600000000,"has, a comma"',
    'stereo,custom_nodes ckpts (controlnet_aux),d.pth,depth-anything/Depth-Anything-V2-Large,d.pth,1341395338,',
    'h3,vae/,,,,0,no repo', ''].join('\r\n')
  it("reads Binc's pull list: rows become entries with pipeline and notes, the rest are skipped with why", () => {
    const r = wanted.fromCsv(CSV)
    expect(r.entries).toEqual([{ folder: 'loras/ltx2', name: 'x.safetensors', repo: 'Kijai/LTX2.3_comfy', path: 'loras/x.safetensors', bytes: 2_600_000_000, note: 'ltx-2.3: has, a comma' }])
    expect(r.skipped.map((s) => s.file)).toEqual(['d.pth', '(no name)']); expect(r.skipped[0].why).toMatch(/not a models folder/)
  })
  it('refuses a file that is not a pull list', () => { expect(() => wanted.fromCsv('a,b\n1,2')).toThrow(/Not a pull list/) })
})
