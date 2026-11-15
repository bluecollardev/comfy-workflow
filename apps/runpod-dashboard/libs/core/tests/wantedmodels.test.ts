import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as podpull from '../src/podpull.js'
import * as wanted from '../src/wanted.js'
import * as wm from '../src/wantedmodels.js'

// The stored wanted list, its comparison with a volume (S3, faked), Binc's list, and loading what is missing in jobs of 20 (docs/ADR-042 section 12).
const ENVS = ['MOUNTS_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'REPOSITORIES_FILE', 'RUNPOD_S3_ACCESS_KEY', 'RUNPOD_S3_SECRET_KEY', 'RUNPOD_API_KEY']
const LS = ['2026-11-15 12:00:00  6780000000 comfy-shared/models/diffusion_models/seedvr2_ema_3b_fp16.safetensors', '2026-11-15 12:00:00  124 comfy-shared/models/diffusion_models/stub.gguf',
  '2026-11-15 12:00:00  2600000000 comfy-shared/models/loras/ltx2/dyn.safetensors', '2026-11-15 12:00:00  9 comfy-shared/models/_canalv2_pull/MODELS_PULL_v003.csv'].join('\n')
const CSV = 'pipeline,install_to,file,hf_repo,hf_path,bytes,notes\nupscale,diffusion_models/,seedvr2_ema_3b_fp16.safetensors,Comfy-Org/SeedVR2,s.safetensors,6780000000,\nltx,loras/ltx2/,dyn.safetensors,Kijai/LTX2.3_comfy,dyn.safetensors,2600000000,\nltx,vae/,v.safetensors,Kijai/LTX2.3_comfy,v.safetensors,1500000000,\n'
const aws: podpull.AwsRunner = async (args) => ({ code: 0, stdout: args[1] === 'ls' ? LS : args[1] === 'cp' ? CSV : '', stderr: '' })
let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wm-'))
  process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'b'); process.env.GIT_ACCOUNTS_FILE = join(dir, 'g.json'); process.env.REPOSITORIES_FILE = join(dir, 'r.json')
  process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'; delete process.env.RUNPOD_API_KEY
  mounts.save(mounts.normalize({ network_volume_id: 'vol1', shared_volume_id: 'vol1', data_center_id: 'EU-RO-1' }))
})
afterEach(() => { for (const k of ENVS) delete process.env[k] })

describe('the stored list', () => {
  it('add merges by key and persists in the configuration; remove by key or all; a bad entry stops the add', () => {
    const e = { folder: 'vae', repo: 'a/b', path: 'x.safetensors', bytes: 5 }
    expect(wm.add([e])).toMatchObject({ added: 1, updated: 0 })
    expect(wm.add([{ ...e, bytes: 9 }, { ...e, path: 'y.safetensors' }])).toMatchObject({ added: 1, updated: 1 })
    expect(mounts.load().wanted_models.map((x) => x.name)).toEqual(['x.safetensors', 'y.safetensors'])
    expect(() => wm.add([e, { folder: 'nope', repo: 'a/b', path: 'z.safetensors' }])).toThrow(/Not a models folder/); expect(wm.list()).toHaveLength(2)
    expect(wm.remove([wanted.keyOf(wm.list()[0])]).removed).toBe(1)
    expect(wm.remove([], true).removed).toBe(1); expect(wm.list()).toEqual([])
    expect(() => wm.remove([])).toThrow(/Name the entries/)
  })
  it("Binc's list: read off the volume over S3 or pasted; rows without a usable destination are reported", async () => {
    const r = await wm.addPullList({}, { aws }); expect(r.added).toBe(3); expect(wm.list().map((x) => x.folder)).toEqual(['diffusion_models', 'loras/ltx2', 'vae'])
    wm.remove([], true)
    expect((await wm.addPullList({ csv: CSV + 'x,custom_nodes/,f.pth,a/b,f.pth,1,\n' })).skipped).toHaveLength(1)
    delete process.env.RUNPOD_S3_ACCESS_KEY
    await expect(wm.addPullList({}, { aws })).rejects.toThrow(/paste the CSV/)
  })
  it('saveInstalled records weight files over 1 MB, keeping the repo of one already listed', async () => {
    wm.add([{ folder: 'diffusion_models', repo: 'Comfy-Org/SeedVR2', path: 's/seedvr2_ema_3b_fp16.safetensors', bytes: 6780000000 }].map((x) => ({ ...x, path: 'seedvr2_ema_3b_fp16.safetensors' })))
    const r = await wm.saveInstalled('vol1', { aws })
    expect(r.models.map((x) => `${x.folder}/${x.name}|${x.repo}`).sort()).toEqual(['diffusion_models/seedvr2_ema_3b_fp16.safetensors|Comfy-Org/SeedVR2', 'loras/ltx2/dyn.safetensors|'])
    expect(r.skipped).toBe(2)   // the 124-byte stub and the csv
  })
})
describe('status', () => {
  it('says present (size within 2%), missing or unknown, the missing size, and warns when the volume cannot hold it', async () => {
    wm.add([{ folder: 'diffusion_models', repo: 'Comfy-Org/SeedVR2', path: 'seedvr2_ema_3b_fp16.safetensors', bytes: 6780000000 }, { folder: 'vae', repo: 'a/b', path: 'v.safetensors', bytes: 1500000000 }, { folder: 'loras/ltx2', repo: 'a/b', path: 'dyn.safetensors', bytes: 4000000000 }])
    const s = await wm.status('vol1', { aws })
    expect(s.rows.map((r) => r.state)).toEqual(['present', 'missing', 'missing'])   // dyn is there but far smaller than wanted
    expect(s).toMatchObject({ present: 1, missing: 2, unknown: 0, missing_bytes: 5500000000 })
    delete process.env.RUNPOD_S3_ACCESS_KEY
    expect((await wm.status('vol1', { aws })).rows.every((r) => r.state === 'unknown')).toBe(true)
  })
})
describe('loadMissing', () => {
  const fakeJobs = () => {
    const calls: { vol: string; n: number }[] = []; const states = new Map<string, string>(); let n = 0
    const fetchModels = (async (vol: string, items: unknown[]) => { calls.push({ vol, n: items.length }); const id = `j${++n}`; states.set(id, 'pulling'); setTimeout(() => states.set(id, 'done'), 15); return { id, state: 'creating' } }) as unknown as typeof podpull.fetchModels
    const jobOf = ((id: string) => (states.has(id) ? { id, state: states.get(id) } : null)) as unknown as typeof podpull.job
    return { calls, fetchModels, jobOf }
  }
  it('starts the first job of at most 20 files and follows with the rest one after another; skips present files and entries with no repo', async () => {
    const items = Array.from({ length: 45 }, (_, i) => ({ folder: 'vae', repo: 'a/b', path: `f${i}.safetensors`, bytes: 1_000_000_000 }))
    wm.add([...items, { folder: 'vae', name: 'norepo.safetensors', bytes: 5 }, { folder: 'diffusion_models', repo: 'Comfy-Org/SeedVR2', path: 'seedvr2_ema_3b_fp16.safetensors', bytes: 6780000000 }])
    const f = fakeJobs()
    const r = await wm.loadMissing('vol1', { poll_ms: 5 }, { aws, fetchModels: f.fetchModels, jobOf: f.jobOf })
    expect(r).toMatchObject({ jobs: 3, files: 45, bytes: 45_000_000_000 }); expect(r.job.id).toBe('j1')
    await expect(wm.loadMissing('vol1', {}, { aws, fetchModels: f.fetchModels, jobOf: f.jobOf })).rejects.toThrow(/already running/)
    for (let i = 0; i < 100 && wm.chainOf('vol1')?.state === 'running'; i++) await new Promise((r) => setTimeout(r, 20))
    expect(f.calls.map((c) => c.n)).toEqual([20, 20, 5]); expect(wm.chainOf('vol1')?.state).toBe('done')
  })
  it('stops the chain at the first failed job, and refuses an empty list or when nothing is missing', async () => {
    await expect(wm.loadMissing('vol1', {}, { aws })).rejects.toThrow(/list is empty/)
    wm.add(Array.from({ length: 25 }, (_, i) => ({ folder: 'vae', repo: 'a/b', path: `g${i}.safetensors`, bytes: 10 })))
    const calls: number[] = []; const states = new Map<string, string>()
    const fetchModels = (async (_v: string, items: unknown[]) => { calls.push(items.length); states.set('x', 'failed'); return { id: 'x', state: 'creating' } }) as unknown as typeof podpull.fetchModels
    const jobOf = ((id: string) => ({ id, state: states.get(id) ?? 'failed', error: 'gated' })) as unknown as typeof podpull.job
    await wm.loadMissing('vol1', { poll_ms: 5 }, { aws, fetchModels, jobOf })
    for (let i = 0; i < 50 && wm.chainOf('vol1')?.state === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
    expect(calls).toEqual([20]); expect(wm.chainOf('vol1')).toMatchObject({ state: 'stopped', error: 'gated' })
  })
  it('warns when the volume is smaller than what the models need, with the volume size from RunPod', async () => {
    mounts.save({ ...mounts.load(), wanted_models: wanted.normalizeList([{ folder: 'vae', repo: 'a/b', path: 'big.safetensors', bytes: 90_000_000_000 }]) })
    const client = { apiKey: 'k', fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ id: 'vol1', name: 'small', size: 50, dataCenterId: 'EU-RO-1' }) })) as unknown as typeof fetch }
    const f = fakeJobs()
    const r = await wm.loadMissing('vol1', { poll_ms: 5 }, { aws, client, fetchModels: f.fetchModels, jobOf: f.jobOf })
    expect(r).toMatchObject({ volume_gb: 50 }); expect(r.short_by_bytes).toBeGreaterThan(40_000_000_000); expect(r.warning).toMatch(/Grow it first/)
  })
})
describe('the export section', () => {
  it('wanted_models travels in the file and an import merges by key and shows what is new', () => {
    wm.add([{ folder: 'vae', repo: 'a/b', path: 'x.safetensors', bytes: 5 }])
    const f = configio.exportConfig({ includeSecrets: false }) as unknown as { config: Record<string, unknown> }
    expect(f.config.wanted_models).toHaveLength(1)
    const file = { format: configio.FORMAT, version: 1, config: { wanted_models: [{ folder: 'vae', repo: 'a/b', path: 'x.safetensors', bytes: 5 }, { folder: 'loras', repo: 'a/b', path: 'l.safetensors', bytes: 7 }] } }
    const sec = configio.planImport(file).sections.find((s) => s.key === 'wanted_models')!
    expect(sec).toMatchObject({ changed: true, error: null, default_checked: true }); expect((sec.incoming as { wanted_models: unknown[] }).wanted_models).toHaveLength(2)
    configio.applyImport(file, { sections: ['wanted_models'] })
    expect(wm.list().map((x) => x.name)).toEqual(['x.safetensors', 'l.safetensors'])
    // importing a file that lacks some entries keeps what is here
    configio.applyImport({ ...file, config: { wanted_models: [{ folder: 'unet', repo: 'a/b', path: 'u.gguf', bytes: 1 }] } }, { sections: ['wanted_models'] })
    expect(wm.list()).toHaveLength(3)
    configio.undoImport(); expect(wm.list()).toHaveLength(2)
  })
  it('refuses a bad entry with its reason, and a file with the same list shows no change', () => {
    const bad = configio.planImport({ format: configio.FORMAT, version: 1, config: { wanted_models: [{ folder: 'nope', repo: 'a/b', path: 'x.safetensors' }] } })
    expect(bad.ok).toBe(false); expect(bad.errors.join(' ')).toMatch(/wanted_models.*Not a models folder/)
    wm.add([{ folder: 'vae', repo: 'a/b', path: 'x.safetensors', bytes: 5 }])
    expect(configio.planImport({ format: configio.FORMAT, version: 1, config: { wanted_models: wm.list() } }).sections.find((s) => s.key === 'wanted_models')!.changed).toBe(false)
  })
})
