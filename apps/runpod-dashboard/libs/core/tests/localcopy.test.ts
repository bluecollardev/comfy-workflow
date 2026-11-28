import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as publish from '../src/publish.js'
import * as sourcesync from '../src/sourcesync.js'
import * as storage from '../src/storage.js'
import * as syncrules from '../src/syncrules.js'
import * as localcopy from '../src/localcopy.js'

// This PC as a destination of an event (docs/ADR-072). Fakes only.
let dir = '', listed: string[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lcopy-')); process.env.POD_MANAGER_CONFIG_DIR = dir; process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SYNC_RULES_FILE = join(dir, 'sync-rules.json'); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage.json')
  const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = join(dir, 'ComfyUI-Shared'); mounts.save(cfg); listed = []
  publish.setDeps({ volumeKeys: (async (_v: string, prefix: string) => { listed.push(prefix); return [] }) as never, volumeAccess: (async () => ({ ok: true, id: 'RPKEYID1234567890', secret: 'rpsecretrpsecretrpsecret99', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: 'v', region: 'eu-ro-1' })) as never })
})
afterEach(() => { sourcesync.reset(); publish.setDeps(null); storage.setAws(null); for (const k of ['POD_MANAGER_CONFIG_DIR', 'MOUNTS_FILE', 'SYNC_RULES_FILE', 'STORAGE_ADAPTERS_FILE']) delete process.env[k]; rmSync(dir, { recursive: true, force: true }) })

describe('copy to this PC on an event', () => {
  it('a rule is accepted, kept once, and read back; a volume as a destination is still refused', () => {
    expect(syncrules.set('vol1', 'generated', [{ type: 'local' }, { type: 'local' }]).rules.generated).toEqual([{ type: 'local' }])
    expect(syncrules.wantsLocal('generated', 'vol1')).toBe(true); expect(syncrules.wantsLocal('approved', 'vol1')).toBe(false)
    expect(syncrules.storageIdsFor('generated', 'vol1')).toEqual([])
    expect(() => syncrules.set('vol1', 'generated', [{ type: 'volume', id: 'vol2' }])).toThrow(/Not built yet/)
    expect(syncrules.checkExport(syncrules.exportRules(), () => false).value.rules.vol1.generated).toEqual([{ type: 'local' }])
  })
  it('with no rule nothing is listed; with a rule the event folder of that volume is listed; a path outside comfy-shared is ignored', async () => {
    await localcopy.onEvent('generated', 'vol1', ['comfy-shared/output/deliver/s/v001'])
    expect(listed).toEqual([])
    syncrules.set('vol1', 'generated', [{ type: 'local' }])
    await localcopy.onEvent('generated', 'vol1', ['project/x', 'comfy-shared/../etc', 'comfy-shared/output/deliver/s/v001', 'comfy-shared/output/deliver/s/v001/'])
    expect(listed.length).toBe(1); expect(listed[0]).toContain('comfy-shared/output/deliver/s/v001')
  })
  it('a storage pull is the storage\'s own entry (never the All Volumes rule), lists the folder of what was put there, and goes with the storage', async () => {
    syncrules.set('*', 'approved', [{ type: 'local' }])
    expect(syncrules.storageWantsLocal('approved', 'wasabi')).toBe(false)
    syncrules.set('wasabi', 'approved', [{ type: 'local' }])
    expect(syncrules.storageWantsLocal('approved', 'wasabi')).toBe(true); expect(syncrules.storageWantsLocal('generated', 'wasabi')).toBe(false)
    const seen: string[][] = []
    storage.setAws((async (a: string[]) => { seen.push(a); return { code: 0, stdout: '', stderr: '' } }) as never)
    storage.save({ id: 'wasabi', enabled: true, region: 'eu-central-1', bucket: 'bkt', access_key_id: 'AKIDEXAMPLE12345', secret_access_key: 'secretsecretsecretsecret99' } as never)
    await localcopy.fromStorage('approved', 'wasabi', ['deliver/s/v001/a.mov', 'deliver/s/v001/b.mov', '../x/y', 'loose.mov'])
    const ls = seen.filter((a) => a.includes('ls'))
    expect(ls.length).toBe(1); expect(ls[0].join(' ')).toContain('deliver/s/v001')
    syncrules.removeStorage('wasabi')
    expect(syncrules.storageWantsLocal('approved', 'wasabi')).toBe(false)
  })
})
