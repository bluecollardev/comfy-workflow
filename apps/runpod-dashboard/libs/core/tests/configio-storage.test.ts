import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as settings from '../src/settings.js'
import * as storage from '../src/storage.js'
import * as syncrules from '../src/syncrules.js'
import * as autosyncstore from '../src/autosyncstore.js'
import { scratch } from './helpers.js'

// Fakes only: a scratch config dir, no network, no real keys. The storages, the sync rules, the volumes' Auto sync entries and the volume order travel in the configuration file (docs/ADR-070).
const KID = 'WASABIKEYID1234', KSEC = 'wasabisecretvalue-0123456789', KID2 = 'MINEKEYID5678', KSEC2 = 'minesecretvalue-9876543210'
let dir: string
const files = () => ({ storage: join(dir, 'storage-adapters.json'), rules: join(dir, 'sync-rules.json'), auto: join(dir, 'autosync.json') })
beforeEach(() => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env')
  process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.SYNC_RULES_FILE = join(dir, 'sync-rules.json'); process.env.AUTOSYNC_FILE = join(dir, 'autosync.json')
  for (const k of settings.PUBLISH_SECRETS) delete process.env[k]
})
afterEach(() => { delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.SYNC_RULES_FILE; delete process.env.AUTOSYNC_FILE })

const seed = async () => {
  await storage.save({ id: 'wasabi', region: 'eu-central-1', bucket: 'wasabi-bucket', prefix: 'out', access_key_id: KID, secret_access_key: KSEC, enabled: true })
  await storage.save({ name: 'Mine', endpoint: 'https://s3.example.com', region: 'us-east-1', bucket: 'my-bucket', access_key_id: KID2, secret_access_key: KSEC2, enabled: true })
  await storage.save({ id: 'panama-s3', name: 'BH Exchange' }); await storage.save({ id: 'publish-s3', name: 'BH Out' })
  await storage.setDefault('mine'); await storage.reorder(['mine', 'panama-s3', 'wasabi'])
  syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }]); syncrules.set('vol-abc123', 'approved', [{ type: 'storage', id: 'mine' }, { type: 'storage', id: 'wasabi' }])
  autosyncstore.setVolume('vol-abc123', { enabled: true, pull: true, push: true, approved_by: 'Lucas' })
  mounts.setVolumeOrder(['wasabi', 'vol-abc123', 'local', 'mine', 'bh'])
}
const wipe = () => { for (const f of Object.values(files())) { try { rmSync(f) } catch { /* none */ } } }
const sectionOf = (plan: configio.ImportPlan, k: string) => plan.sections.find((s) => s.key === k)!

describe('storages, sync rules, auto sync and the volume order in the configuration file', () => {
  it('the export has the storages without keys when secrets are left out, with keys in secrets when included; the preview masks them', async () => {
    await seed()
    const no = configio.exportConfig({ includeSecrets: false }), text = JSON.stringify(no)
    expect(no.storages!.adapters.map((a) => a.id).sort()).toEqual(['mine', 'wasabi'])
    expect(no.storages).toMatchObject({ default: 'mine', order: ['mine', 'panama-s3', 'wasabi'], titles: { 'panama-s3': 'BH Exchange', 'publish-s3': 'BH Out' } })
    for (const v of [KID, KSEC, KID2, KSEC2]) expect(text).not.toContain(v)
    expect(no.secrets).toBeUndefined()
    const yes = configio.exportConfig({ includeSecrets: true })
    expect(yes.secrets!.storages).toEqual({ wasabi: { access_key_id: KID, secret_access_key: KSEC }, mine: { access_key_id: KID2, secret_access_key: KSEC2 } })
    expect(JSON.stringify(yes.storages)).not.toContain(KSEC)
    const plan = configio.planImport(JSON.parse(JSON.stringify(yes))), pt = JSON.stringify(plan)
    for (const v of [KID, KSEC, KID2, KSEC2]) expect(pt).not.toContain(v)
    expect(sectionOf(plan, 'secrets').items!.map((i) => i.name)).toEqual(expect.arrayContaining(['storage:wasabi', 'storage:mine']))
    for (const k of ['storages', 'sync_rules', 'auto_sync_volumes']) expect(sectionOf(plan, k).label.length).toBeGreaterThan(5)
  })

  it('import into an empty config recreates storages, default, order and titles, with keys; no secret in any plan text', async () => {
    await seed(); const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    wipe(); mounts.reset()
    const plan = configio.planImport(file)
    expect(plan.ok).toBe(true); expect(sectionOf(plan, 'storages').changed).toBe(true)
    for (const v of [KID, KSEC, KID2, KSEC2]) expect(JSON.stringify(plan)).not.toContain(v)
    const r = configio.applyImport(file, { sections: ['storages', 'sync_rules', 'auto_sync_volumes', 'volume', 'secrets'] })
    for (const v of [KID, KSEC, KID2, KSEC2]) expect(JSON.stringify(r.warnings)).not.toContain(v)
    const p = storage.portable()
    expect(p.default).toBe('mine'); expect(p.order).toEqual(['mine', 'panama-s3', 'wasabi']); expect(p.titles).toEqual({ 'panama-s3': 'BH Exchange', 'publish-s3': 'BH Out' })
    expect(p.adapters.find((a) => a.id === 'mine')).toMatchObject({ name: 'Mine', endpoint: 'https://s3.example.com', bucket: 'my-bucket', enabled: true })
    expect(storage.exportKeys().mine).toEqual({ access_key_id: KID2, secret_access_key: KSEC2 }); expect(storage.isEnabled('wasabi')).toBe(true)
    expect(mounts.getVolumeOrder()).toEqual(['wasabi', 'vol-abc123', 'local', 'mine', 'bh'])
  })

  it('an enabled storage without keys arrives off with a warning (secrets left out)', async () => {
    await seed(); const file = JSON.parse(JSON.stringify(configio.exportConfig({ includeSecrets: false }))), full = JSON.parse(JSON.stringify(configio.exportConfig()))
    wipe(); mounts.reset()
    const plan = configio.planImport(file); expect(plan.warnings.join(' ')).toMatch(/Storage "Mine" arrives off/)
    const r = configio.applyImport(file, { sections: ['storages'] })
    expect(r.warnings.join(' ')).toMatch(/Storage "Mine" arrives off/); expect(storage.portable().adapters.find((a) => a.id === 'mine')!.enabled).toBe(false)
    // then the keys alone (secrets section) land on the storages that are here
    delete full.storages
    configio.applyImport(full, { sections: ['secrets'] }); expect(storage.exportKeys().mine.secret_access_key).toBe(KSEC2)
  })

  it('a rule naming a storage that is neither in the file nor here is dropped with a warning that names it; a rule for an unknown volume is kept', async () => {
    const file = JSON.parse(JSON.stringify(configio.exportConfig({ includeSecrets: false })))
    file.sync_rules = { rules: { '*': { generated: [{ type: 'storage', id: 'ghost-store' }, { type: 'storage', id: 'wasabi' }] }, 'vol-notmine1': { published: [{ type: 'storage', id: 'wasabi' }] } } }
    const plan = configio.planImport(file); expect(plan.warnings.join(' ')).toMatch(/ghost-store/)
    const r = configio.applyImport(file, { sections: ['sync_rules'] }); expect(r.warnings.join(' ')).toMatch(/ghost-store/)
    const rules = syncrules.all().rules
    expect(rules['*'].generated).toEqual([{ type: 'storage', id: 'wasabi' }]); expect(rules['vol-notmine1'].published).toEqual([{ type: 'storage', id: 'wasabi' }])
    const bad = { ...file, sync_rules: { rules: { '*': { generated: [{ type: 'volume', id: 'x' }] } } } }
    expect(sectionOf(configio.planImport(bad), 'sync_rules').error).toMatch(/sync_rules\.rules\.\*\.generated/)
  })

  it('auto sync volume entries arrive off with the name kept', async () => {
    await seed(); const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    expect(file.auto_sync_volumes['vol-abc123']).toMatchObject({ enabled: true, approved_by: 'Lucas' })
    wipe()
    const plan = configio.planImport(file); expect(sectionOf(plan, 'auto_sync_volumes').note).toMatch(/OFF/)
    configio.applyImport(file, { sections: ['auto_sync_volumes'] })
    expect(autosyncstore.getVolume('vol-abc123')).toMatchObject({ enabled: false, pull: true, push: true, approved_by: 'Lucas' })
    expect(autosyncstore.getVolume('vol-abc123').approved_at).toBeUndefined()
  })

  it('the volume order round trips (volume ids, storage ids, local and bh), through the setter and the volume section; a partial put keeps it', async () => {
    const order = ['mine-2', 'bh', 'vol-abc123', 'local', 'wasabi']
    expect(mounts.setVolumeOrder([...order, 'bh'])).toEqual(order)   // unique
    expect(mounts.getVolumeOrder()).toEqual(order)
    mounts.put({ ...mounts.load(), volume_order: undefined } as never, { quiet: true }); expect(mounts.getVolumeOrder()).toEqual(order)
    expect(() => mounts.setVolumeOrder(['ok-id', 'bad id!'])).toThrow(/volume ids/); expect(() => mounts.setVolumeOrder('x' as never)).toThrow()
    expect(() => mounts.setVolumeOrder(Array.from({ length: 301 }, (_, i) => `row-${i}`))).toThrow(/at most 300/)
    const file = JSON.parse(JSON.stringify(configio.exportConfig({ includeSecrets: false }))); expect(file.config.volume_order).toEqual(order)
    mounts.setVolumeOrder([]); const plan = configio.planImport(file); expect(sectionOf(plan, 'volume').incoming).toMatchObject({ volume_order: order })
    configio.applyImport(file, { sections: ['volume'] }); expect(mounts.getVolumeOrder()).toEqual(order)
    const badFile = { ...file, config: { ...file.config, volume_order: ['ok-id', 'bad id!'] } }; const bp = configio.planImport(badFile); expect(bp.ok).toBe(false); expect(bp.errors.join(' ')).toMatch(/config\.volume_order/)
  })

  it('undo restores storage-adapters.json, sync-rules.json and autosync.json; the backup copies are 0600', async () => {
    await seed(); const before = Object.fromEntries(Object.entries(files()).map(([k, f]) => [k, readFileSync(f, 'utf8')]))
    const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    file.storages.adapters = file.storages.adapters.filter((a: { id: string }) => a.id !== 'mine'); file.storages.default = 'wasabi'
    file.sync_rules = { rules: { '*': { published: [{ type: 'storage', id: 'wasabi' }] } } }; file.auto_sync_volumes = { 'vol-other99': { enabled: true, pull: false, push: true, approved_by: 'X' } }
    configio.applyImport(file, { sections: ['storages', 'sync_rules', 'auto_sync_volumes'] })
    expect(readFileSync(files().rules, 'utf8')).not.toBe(before.rules)
    const bdir = join(dir, 'backups'), names = readdirSync(bdir)
    for (const prefix of ['storage-adapters-', 'sync-rules-', 'autosync-', 'mounts-']) { const n = names.find((x) => x.startsWith(prefix)); expect(n, prefix).toBeTruthy(); expect(statSync(join(bdir, n!)).mode & 0o777).toBe(0o600) }
    configio.undoImport()
    for (const [k, f] of Object.entries(files())) expect(readFileSync(f, 'utf8'), k).toBe(before[k])
    expect(readdirSync(bdir)).toEqual([])
  })

  it('an invalid section value is an error that names the field', async () => {
    await seed(); const f = JSON.parse(JSON.stringify(configio.exportConfig({ includeSecrets: false })))
    const s1 = configio.planImport({ ...f, storages: { adapters: [{ id: 'mine', name: 'Mine', endpoint: 'http://insecure.example.com', region: 'us-east-1', bucket: 'my-bucket', prefix: '', enabled: true }] } })
    expect(sectionOf(s1, 'storages').error).toMatch(/storages\.adapters\[mine\]: endpoint/)
    const s2 = configio.planImport({ ...f, storages: { adapters: [{ id: 'publish-s3', name: 'x', enabled: true }] } }); expect(sectionOf(s2, 'storages').error).toMatch(/storages\.adapters\[0\]\.id/)
    const s3 = configio.planImport({ ...f, auto_sync_volumes: { 'vol-abc123': { pull: 'yes' } } }); expect(sectionOf(s3, 'auto_sync_volumes').error).toMatch(/auto_sync_volumes\.vol-abc123\.pull/)
    expect(() => configio.applyImport({ ...f, auto_sync_volumes: { 'vol-abc123': { pull: 'yes' } } }, { sections: ['auto_sync_volumes'] })).toThrow(/auto_sync_volumes/)
    const s4 = configio.planImport({ ...f, secrets: { settings: {}, storages: { wasabi: { access_key_id: 'short', secret_access_key: KSEC } } } }); expect(JSON.stringify(s4)).not.toContain(KSEC); expect(sectionOf(s4, 'secrets').error).toMatch(/None of the keys/)
  })

  it('an old file without the new sections still imports, and treats them as not in the file', async () => {
    const f = JSON.parse(JSON.stringify(configio.exportConfig({ includeSecrets: false }))); delete f.storages; delete f.sync_rules; delete f.auto_sync_volumes; delete f.config.volume_order
    const plan = configio.planImport(f); expect(plan.ok).toBe(true); for (const k of ['storages', 'sync_rules', 'auto_sync_volumes']) expect(plan.sections.some((s) => s.key === k)).toBe(false)
    mounts.setVolumeOrder(['wasabi', 'local']); configio.applyImport(f, { sections: ['volume'] }); expect(mounts.getVolumeOrder()).toEqual(['wasabi', 'local'])
  })
})
