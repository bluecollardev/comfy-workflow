import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as settings from '../src/settings.js'

// Export and import of the Default Configuration (docs/ADR-023): no secrets, validate then preview then apply, backup and undo.
const ENVS = ['MOUNTS_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'PANAMA_S3_BUCKET', 'PANAMA_S3_REGION', 'PANAMA_S3_PROFILE', 'RUNPOD_API_KEY', 'ANTHROPIC_API_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'PANAMA_CONSOLE_KEY']
const SECRET_VALUES = ['rpa_THIS_IS_A_RUNPOD_SECRET_1234', 'AKIAEXAMPLESECRET99', 'panama-secret-value-do-not-leak', 'sk-ant-THIS-IS-AN-ANTHROPIC-KEY-0000', 'console-key-value-xyz-123']

let dir = ''
const allSections = () => configio.SECTION_KEYS as string[]
const base = (over: Record<string, unknown> = {}, panama?: Record<string, string>) => ({ format: configio.FORMAT, version: 1, config: over, ...(panama ? { panama } : {}) })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cio-'))
  process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups')
  for (const k of ENVS.slice(3)) delete process.env[k]
  mounts.save(mounts.normalize({ network_volume_id: 'vol1', data_center_id: 'EUR-IS-2', image: 'ghcr.io/x/y:1', idle_stop_minutes: 30, env: { COMFY_PORT: '8188' }, folders: { 'comfy-shared': '/home/me/ComfyUI-Shared' } }))
})
afterEach(() => { for (const k of ENVS) delete process.env[k] })

describe('exportConfig', () => {
  it('carries the format, the version and the configuration, and no dry_run', () => {
    mounts.save({ ...mounts.load(), dry_run: true })
    const f = configio.exportConfig({ appVersion: '9.9.9', now: new Date('2026-11-03T05:00:00Z') })
    expect(f).toMatchObject({ format: 'runpod-pod-manager-config', version: 1, exported_at: '2026-11-03T05:00:00.000Z', app_version: '9.9.9' })
    expect((f.config as Record<string, unknown>).network_volume_id).toBe('vol1')
    expect('dry_run' in f.config).toBe(false)
    expect(f.panama).toEqual({ bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' })
    expect(f.not_exported.join(' ')).toMatch(/dry_run/)
  })
  it('never contains a secret: not the keys, not an environment variable that looks like one; it lists only the NAMES of the secrets that are set', () => {
    settings.set({ runpod_api_key: SECRET_VALUES[0], panama_aws_access_key: SECRET_VALUES[1], panama_aws_secret_key: SECRET_VALUES[2], anthropic_api_key: SECRET_VALUES[3], panama_console_key: SECRET_VALUES[4] })
    mounts.save({ ...mounts.load(), env: { COMFY_PORT: '8188', HF_TOKEN: 'hf_secret_token_value', AWS_SECRET_ACCESS_KEY: 'aws-env-secret', S3_PULL: 'b/p=/workspace/x' } })
    const f = configio.exportConfig()
    const text = JSON.stringify(f)
    for (const v of [...SECRET_VALUES, 'hf_secret_token_value', 'aws-env-secret']) expect(text).not.toContain(v)
    expect(f.config.env).toEqual({ COMFY_PORT: '8188', S3_PULL: 'b/p=/workspace/x' })   // S3_PULL is a setting, not a secret
    expect(f.env_omitted.sort()).toEqual(['AWS_SECRET_ACCESS_KEY', 'HF_TOKEN'])
    expect(f.secrets_set).toEqual(expect.arrayContaining(['RUNPOD_API_KEY', 'ANTHROPIC_API_KEY', 'PANAMA_CONSOLE_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY']))
  })
  it('suggests a dated file name', () => { expect(configio.suggestedName(new Date(2026, 10, 3))).toBe('pod-manager-config-2026-11-03.json') })
})

describe('planImport: refuses what it cannot trust, flags what it must', () => {
  it('refuses a file that is not ours, is newer than this app, is not an object, or has no config', () => {
    expect(configio.planImport({ format: 'something-else', version: 1, config: {} })).toMatchObject({ ok: false })
    expect(configio.planImport({ ...base(), version: 2 }).errors.join(' ')).toMatch(/version 2.*up to version 1/)
    expect(configio.planImport({ ...base(), version: 0 }).ok).toBe(false)
    expect(configio.planImport('hello').errors[0]).toMatch(/not a JSON object/)
    expect(configio.planImport([1, 2]).ok).toBe(false)
    expect(configio.planImport({ format: configio.FORMAT, version: 1 }).errors[0]).toMatch(/no "config"/)
    expect(configio.planImport({ ...base(), config: [] }).ok).toBe(false)
  })
  it('refuses a file far too large to be a configuration without looking inside', () => {
    const r = configio.planImport(base({ image: 'x'.repeat(3 * 1024 * 1024) }))
    expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/too large/)
  })
  it('reports type errors per field and does not import them', () => {
    const r = configio.planImport(base({ idle_stop_minutes: 'soon', sync_shared: 'input', folders: { a: 1 }, apply_by_default: 'yes' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/idle_stop_minutes must be a number/); expect(r.errors.join('\n')).toMatch(/sync_shared/); expect(r.errors.join('\n')).toMatch(/folders/); expect(r.errors.join('\n')).toMatch(/apply_by_default/)
  })
  it('warns about unknown keys and ignores them; dry_run in a file is ignored, never imported', () => {
    mounts.save({ ...mounts.load(), dry_run: true })
    const f = { ...base({ idle_stop_minutes: 45, dry_run: false, surprise: 1 }), extra_top: true }
    const r = configio.planImport(f)
    expect(r.ok).toBe(true)
    expect(r.warnings.join('\n')).toMatch(/extra_top/); expect(r.warnings.join('\n')).toMatch(/config\.surprise/); expect(r.warnings.join('\n')).toMatch(/dry_run/)
    configio.applyImport(f, { sections: ['pod_defaults'] })
    expect(mounts.load().dry_run).toBe(true)   // the no-spend switch survived an import that said false
    expect(mounts.load().idle_stop_minutes).toBe(45)
  })
  it('lists one section per group the file carries, with current and incoming; Folders is flagged as paths from another machine and not checked by default', () => {
    const r = configio.planImport(base({ idle_stop_minutes: 45, image: 'ghcr.io/x/y:2', folders: { project: '/Users/other/CANALV2' } }, { bucket: 'other-bucket', region: 'us-west-2', profile: 'panama' }))
    const by = Object.fromEntries(r.sections.map((s) => [s.key, s]))
    expect(Object.keys(by).sort()).toEqual(['folders', 'image', 'panama', 'pod_defaults'])
    expect(by.folders).toMatchObject({ machine_specific: true, changed: true, default_checked: false })
    expect(by.folders.note).toMatch(/another machine/)
    expect(by.image).toMatchObject({ account_specific: true, changed: true, default_checked: true })
    expect((by.image.current as Record<string, unknown>).image).toBe('ghcr.io/x/y:1'); expect((by.image.incoming as Record<string, unknown>).image).toBe('ghcr.io/x/y:2')
    expect(by.pod_defaults.default_checked).toBe(true)
    expect(by.panama).toMatchObject({ changed: true, default_checked: true })
    expect(configio.planImport(base({ idle_stop_minutes: 30 })).sections[0]).toMatchObject({ key: 'pod_defaults', changed: false, default_checked: false })   // nothing to change, nothing ticked
  })
  it('flags a folder that points into Binc\'s read-only mirror', () => {
    const r = configio.planImport(base({ folders: { 'comfy-shared': join(process.cwd(), '..', '..', '..', '..', 'projects', 'desktop', 'ComfyUI-Shared') } }))
    const f = r.sections.find((s) => s.key === 'folders')!
    expect(f.note).toMatch(/read-only mirror/)
  })
  it('gives a section its own error when its values would not save, and still previews the others', () => {
    const r = configio.planImport(base({ mcp_http: { 'pod-manager': { enabled: true, port: 9000 }, 'comfy-bridge': { enabled: true, port: 9000 } }, idle_stop_minutes: 45 }))
    expect(r.ok).toBe(true)
    expect(r.sections.find((s) => s.key === 'mcp')!.error).toMatch(/share port 9000/)
    expect(r.sections.find((s) => s.key === 'pod_defaults')!.error).toBeNull()
    expect(() => configio.applyImport(base({ mcp_http: { 'pod-manager': { enabled: true, port: 9000 }, 'comfy-bridge': { enabled: true, port: 9000 } } }), { sections: ['mcp'] })).toThrow(/share port/)
  })
  it('drops environment variables that look like secrets and keeps the ones already in the configuration', () => {
    mounts.save({ ...mounts.load(), env: { COMFY_PORT: '8188', MY_API_KEY: 'mine-stays' } })
    const f = base({ env: { COMFY_PORT: '9999', HF_TOKEN: 'from-a-file', S3_PULL: 'b/p=/workspace/x' } })
    const r = configio.planImport(f)
    expect(r.source.env_omitted).toEqual(['HF_TOKEN']); expect(r.warnings.join('\n')).toMatch(/look like secrets/)
    configio.applyImport(f, { sections: ['env'] })
    expect(mounts.load().env).toEqual({ COMFY_PORT: '9999', S3_PULL: 'b/p=/workspace/x', MY_API_KEY: 'mine-stays' })
  })
})

describe('applyImport, backups and undo', () => {
  it('round trips: an export imported into a changed configuration restores it', () => {
    const before = mounts.load()
    const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    mounts.save({ ...mounts.load(), idle_stop_minutes: 5, image: 'other', network_volume_id: 'zzz' })
    configio.applyImport(file, { sections: allSections() })
    expect(mounts.load()).toEqual(before)
  })
  it('writes only the checked sections', () => {
    const f = base({ image: 'ghcr.io/x/y:2', idle_stop_minutes: 99, network_volume_id: 'vol2' })
    const r = configio.applyImport(f, { sections: ['image'] })
    expect(r.applied).toEqual(['image'])
    expect(mounts.load()).toMatchObject({ image: 'ghcr.io/x/y:2', idle_stop_minutes: 30, network_volume_id: 'vol1' })
  })
  it('refuses with nothing selected, an unknown section, or a section the file does not carry', () => {
    expect(() => configio.applyImport(base({ image: 'a' }), { sections: [] })).toThrow(/No section selected/)
    expect(() => configio.applyImport(base({ image: 'a' }), { sections: ['nonsense'] })).toThrow(/No such section/)
    expect(() => configio.applyImport(base({ image: 'a' }), { sections: ['mcp'] })).toThrow(/none of the selected/)
  })
  it('backs the current configuration up before writing, and undo puts it back (the Panama settings too)', () => {
    settings.set({ panama_bucket: 'old-bucket' })
    const r = configio.applyImport(base({ image: 'new:1', idle_stop_minutes: 10 }, { bucket: 'new-bucket', region: 'eu-west-1', profile: 'work' }), { sections: ['image', 'pod_defaults', 'panama'] })
    expect(existsSync(r.backup)).toBe(true)
    expect(JSON.parse(readFileSync(r.backup, 'utf8')).mounts.image).toBe('ghcr.io/x/y:1')
    expect(mounts.load().image).toBe('new:1'); expect(settings.get()).toMatchObject({ panama_bucket: 'new-bucket', panama_region: 'eu-west-1', panama_profile: 'work' })
    expect(configio.listBackups()).toHaveLength(1)
    const u = configio.undoImport()
    expect(u.restored).toMatch(/^mounts-/)
    expect(mounts.load()).toMatchObject({ image: 'ghcr.io/x/y:1', idle_stop_minutes: 30 })
    expect(settings.get()).toMatchObject({ panama_bucket: 'old-bucket', panama_region: 'us-west-2', panama_profile: 'panama' })
    expect(configio.listBackups()).toHaveLength(0)
    expect(() => configio.undoImport()).toThrow(/Nothing to undo/)
  })
  it('keeps the newest ten backups', () => {
    for (let i = 0; i < 13; i++) configio.applyImport(base({ idle_stop_minutes: i + 1 }), { sections: ['pod_defaults'], now: new Date(Date.UTC(2026, 10, 3, 5, 0, i)) })
    const names = readdirSync(join(dir, 'backups')).sort()
    expect(names).toHaveLength(10)
    expect(configio.listBackups()[0].name).toBe(names[names.length - 1])   // newest first
  })
})

describe('an imported file is data', () => {
  it('stores hostile strings as plain strings and reads nothing from them', () => {
    const huge = 'A'.repeat(100_000)
    const f = JSON.parse(`{"format":"${configio.FORMAT}","version":1,"config":{"image":"../../../etc/passwd","registry_auth_id":"$(rm -rf ~)","env":{"EVIL":"${huge}","__proto__":"polluted","PATH_TRAVERSAL":"../../../../etc/shadow"},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}}`)
    const plan = configio.planImport(f)
    expect(plan.ok).toBe(true)
    configio.applyImport(f, { sections: ['image', 'env'] })
    const cfg = mounts.load()
    expect(cfg.image).toBe('../../../etc/passwd'); expect(cfg.registry_auth_id).toBe('$(rm -rf ~)')
    expect(cfg.env.EVIL).toBe(huge); expect(cfg.env.PATH_TRAVERSAL).toBe('../../../../etc/shadow')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()   // no prototype pollution
    expect(readFileSync(process.env.MOUNTS_FILE!, 'utf8')).toContain('"image": "../../../etc/passwd"')   // stored text, nothing followed
    writeFileSync(join(dir, 'untouched.txt'), 'x'); expect(readFileSync(join(dir, 'untouched.txt'), 'utf8')).toBe('x')
  })
})
