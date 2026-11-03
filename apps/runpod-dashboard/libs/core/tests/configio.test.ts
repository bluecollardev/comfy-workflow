import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as configio from '../src/configio.js'
import * as git from '../src/git.js'
import * as mounts from '../src/mounts.js'
import * as settings from '../src/settings.js'

// Export and import of the Default Configuration (docs/ADR-023): keys and tokens travel in the file (Lucas, 2026-11-03), nothing secret is ever shown, validate then preview then apply, backup and undo.
const ENVS = ['MOUNTS_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'PANAMA_S3_BUCKET', 'PANAMA_S3_REGION', 'PANAMA_S3_PROFILE', 'RUNPOD_API_KEY', 'ANTHROPIC_API_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'PANAMA_CONSOLE_KEY']
const KEYS_ALL = {
  RUNPOD_API_KEY: 'rpa_THIS_IS_A_RUNPOD_SECRET_1234', RUNPOD_S3_ACCESS_KEY: 'user_S3ACCESS_VALUE_ABCD', RUNPOD_S3_SECRET_KEY: 'rps_S3SECRET_VALUE_EFGH',
  PANAMA_AWS_ACCESS_KEY_ID: 'AKIAEXAMPLESECRET99', PANAMA_AWS_SECRET_ACCESS_KEY: 'panama-secret-value-do-not-leak', PANAMA_CONSOLE_KEY: 'console-key-value-xyz-123', ANTHROPIC_API_KEY: 'sk-ant-THIS-IS-AN-ANTHROPIC-KEY-0000',
} as const
const GIT = { id: 'gh-1', provider: 'github', host: 'github.com', username: 'octocat', name: null, avatar_url: null, profile_url: null, scope: 'repo', token: 'ghp_GITHUB_TOKEN_SECRET_5555', refresh_token: 'ghr_REFRESH_TOKEN_SECRET_6666', expires_at: null, connected_at: 1_700_000_000 } as git.Account
const ENV_SECRETS = { HF_TOKEN: 'hf_ENV_TOKEN_SECRET_7777', AWS_SECRET_ACCESS_KEY: 'aws-env-secret-8888' }
const SECRET_VALUES = [...Object.values(KEYS_ALL), GIT.token, GIT.refresh_token!, ...Object.values(ENV_SECRETS)]
const giveKeys = () => { settings.setSecrets({ ...KEYS_ALL }); git.save([GIT]); mounts.save({ ...mounts.load(), env: { COMFY_PORT: '8188', S3_PULL: 'b/p=/workspace/x', ...ENV_SECRETS } }) }
const clearKeys = () => { settings.setSecrets(Object.fromEntries(Object.keys(KEYS_ALL).map((k) => [k, null]))); git.save([]) }

let dir = ''
const allSections = () => configio.SECTION_KEYS as string[]
const base = (over: Record<string, unknown> = {}, panama?: Record<string, string>) => ({ format: configio.FORMAT, version: 1, config: over, ...(panama ? { panama } : {}) })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cio-'))
  process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups'); process.env.GIT_ACCOUNTS_FILE = join(dir, 'git_accounts.json')
  for (const k of ENVS.slice(4)) delete process.env[k]
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
  it('(i) by default holds every key and token VALUE, the git tokens and the secret-looking environment variables, and says so', () => {
    giveKeys()
    const f = configio.exportConfig()
    expect(f.secrets_included).toBe(true)
    expect(f.secrets!.settings).toEqual(KEYS_ALL)
    expect(f.secrets!.git_accounts).toEqual([GIT])   // the token and refresh token with the rest of the account
    expect(f.config.env).toEqual({ COMFY_PORT: '8188', S3_PULL: 'b/p=/workspace/x', ...ENV_SECRETS })   // HF_TOKEN etc. ride in the ordinary env table now
    expect(f.env_omitted).toEqual([])
    expect(f.secrets_set).toEqual(expect.arrayContaining([...Object.keys(KEYS_ALL), 'git:github/octocat']))
    expect('dry_run' in f.config).toBe(false)   // still never
  })
  it('(ii) with includeSecrets false holds none of it: no values anywhere, the names listed, the secret-looking env variables left out and named', () => {
    giveKeys()
    const f = configio.exportConfig({ includeSecrets: false })
    expect(f.secrets_included).toBe(false)
    expect('secrets' in f).toBe(false)
    const text = JSON.stringify(f)
    for (const v of SECRET_VALUES) expect(text).not.toContain(v)
    expect(f.secrets_set).toEqual(expect.arrayContaining([...Object.keys(KEYS_ALL), 'git:github/octocat']))
    expect(f.config.env).toEqual({ COMFY_PORT: '8188', S3_PULL: 'b/p=/workspace/x' })
    expect(f.env_omitted.sort()).toEqual(['AWS_SECRET_ACCESS_KEY', 'HF_TOKEN'])
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
  it('imports secret-looking environment variables like any other, and never deletes one already in the table that the file does not mention', () => {
    mounts.save({ ...mounts.load(), env: { COMFY_PORT: '8188', MY_API_KEY: 'mine-stays', HF_TOKEN: 'old-hf' } })
    const f = base({ env: { COMFY_PORT: '9999', HF_TOKEN: 'from-the-file', S3_PULL: 'b/p=/workspace/x' } })
    configio.applyImport(f, { sections: ['env'] })
    expect(mounts.load().env).toEqual({ COMFY_PORT: '9999', S3_PULL: 'b/p=/workspace/x', HF_TOKEN: 'from-the-file', MY_API_KEY: 'mine-stays' })
  })
  it('shows a secret-looking environment value only by its last four characters in the plan', () => {
    const plan = configio.planImport(base({ env: { HF_TOKEN: 'hf_ENV_TOKEN_SECRET_7777', COMFY_PORT: '9999' } }))
    const text = JSON.stringify(plan)
    expect(text).not.toContain('hf_ENV_TOKEN_SECRET_7777'); expect(text).toContain('••••7777'); expect(text).toContain('9999')
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

describe('keys and tokens on import (ADR-023, reversed 2026-11-03)', () => {
  const storedSettings = () => settings.storedSecretValues()
  const fileWith = (sec: Record<string, unknown>) => ({ ...base({ idle_stop_minutes: 31 }), secrets_included: true, secrets: sec })
  const allText = (spies: ReturnType<typeof vi.spyOn>[]) => spies.flatMap((s) => s.mock.calls.flat()).map(String).join('\n')

  it('(iii) round trips: an export imported on a computer with none of the keys restores every key and token', () => {
    giveKeys()
    const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    clearKeys(); mounts.save({ ...mounts.load(), env: {} })
    expect(storedSettings()).toEqual({}); expect(git.load()).toEqual([])
    const plan = configio.planImport(file)
    expect(plan.sections.find((s) => s.key === 'secrets')).toMatchObject({ changed: true, default_checked: true })   // ticked by default
    const r = configio.applyImport(file, { sections: configio.SECTION_KEYS as string[] })
    expect(r.applied).toContain('secrets'); expect(r.skipped).toEqual([])
    expect(storedSettings()).toEqual(KEYS_ALL)
    expect(git.load()).toEqual([GIT])   // token, refresh token and the rest of the account
    expect(mounts.load().env).toEqual({ COMFY_PORT: '8188', S3_PULL: 'b/p=/workspace/x', ...ENV_SECRETS })
  })
  it('only writes the keys when the Keys and tokens section is ticked', () => {
    giveKeys()
    const file = JSON.parse(JSON.stringify(configio.exportConfig()))
    clearKeys()
    configio.applyImport(file, { sections: ['pod_defaults'] })
    expect(storedSettings()).toEqual({}); expect(git.load()).toEqual([])
  })
  it('merges git accounts by id: an account in the file replaces the one with that id and the others stay', () => {
    const other = { ...GIT, id: 'gl-1', provider: 'gitlab', host: 'gitlab.com', username: 'tanuki', token: 'glpat_OTHER_TOKEN_SECRET_9999', refresh_token: null }
    git.save([other, { ...GIT, token: 'ghp_OLD_TOKEN_SECRET_0000' }])
    configio.applyImport(fileWith({ settings: {}, git_accounts: [GIT] }), { sections: ['secrets'] })
    expect(git.load().find((a) => a.id === 'gh-1')!.token).toBe(GIT.token)
    expect(git.load().find((a) => a.id === 'gl-1')!.token).toBe(other.token)
  })
  it('(iv) shows each key by its last four characters only: no plan, error, warning or log line holds a full value', () => {
    const spies = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})]
    try {
      giveKeys()
      const file = JSON.parse(JSON.stringify(configio.exportConfig()))
      mounts.save({ ...mounts.load(), env: { COMFY_PORT: '1' } }); clearKeys()
      const plan = configio.planImport(file)
      const text = JSON.stringify(plan)
      for (const v of SECRET_VALUES) expect(text).not.toContain(v)
      const sec = plan.sections.find((s) => s.key === 'secrets')!
      expect(sec.items!.map((i) => i.name)).toEqual(expect.arrayContaining([...Object.keys(KEYS_ALL), 'git:github/octocat']))
      expect(sec.items!.find((i) => i.name === 'RUNPOD_API_KEY')!.hint).toBe('••••1234')
      expect(sec.items!.find((i) => i.name === 'git:github/octocat')!.hint).toBe('••••5555')
      // an error from applying (nothing selected) and the result of a good apply name no value either
      let thrown = ''
      try { configio.applyImport(file, { sections: [] }) } catch (e) { thrown = (e as Error).message }
      const r = configio.applyImport(file, { sections: configio.SECTION_KEYS as string[] })
      const shown = [thrown, JSON.stringify(r.settings), r.skipped.join(','), r.applied.join(','), allText(spies)].join('\n')
      for (const v of SECRET_VALUES) expect(shown).not.toContain(v)
      expect(configio.maskSecret('short')).toBe('••••'); expect(configio.maskSecret('abcdefgh1234')).toBe('••••1234')
    } finally { spies.forEach((s) => s.mockRestore()) }
  })
  it('(v) rejects a malformed key by name, never echoing it, and still imports the good ones', () => {
    const bad = 'has spaces and is a secret value'
    const f = fileWith({ settings: { ANTHROPIC_API_KEY: bad, RUNPOD_API_KEY: KEYS_ALL.RUNPOD_API_KEY, PANAMA_CONSOLE_KEY: 'short' }, git_accounts: [{ ...GIT, token: 'tiny' }] })
    const plan = configio.planImport(f)
    const text = JSON.stringify(plan)
    expect(text).not.toContain(bad); expect(text).not.toContain('tiny'); expect(text).not.toContain(KEYS_ALL.RUNPOD_API_KEY)
    const sec = plan.sections.find((s) => s.key === 'secrets')!
    const errs = Object.fromEntries(sec.items!.filter((i) => i.error).map((i) => [i.name, i.error!]))
    expect(Object.keys(errs).sort()).toEqual(['ANTHROPIC_API_KEY', 'PANAMA_CONSOLE_KEY', 'git:github/octocat'])
    expect(errs.ANTHROPIC_API_KEY).toMatch(/ANTHROPIC_API_KEY/); expect(sec.error).toBeNull()   // one good key is still importable
    expect(sec.note).toMatch(/Not imported, malformed/)
    const r = configio.applyImport(f, { sections: ['secrets'] })
    expect(r.skipped.sort()).toEqual(['ANTHROPIC_API_KEY', 'PANAMA_CONSOLE_KEY', 'git:github/octocat'])
    expect(storedSettings()).toEqual({ RUNPOD_API_KEY: KEYS_ALL.RUNPOD_API_KEY })
    // nothing in the file can be imported: the section is refused by name
    const none = fileWith({ settings: { ANTHROPIC_API_KEY: bad }, git_accounts: [] })
    const noneSec = configio.planImport(none).sections.find((s) => s.key === 'secrets')!
    expect(noneSec.error).toMatch(/ANTHROPIC_API_KEY/)
    let msg = ''; try { configio.applyImport(none, { sections: ['secrets'] }) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/ANTHROPIC_API_KEY/); expect(msg).not.toContain(bad)
  })
  it('refuses a secrets block of the wrong shape, and ignores a key name this app does not store', () => {
    expect(configio.planImport({ ...base(), secrets: 'nope' }).errors.join(' ')).toMatch(/"secrets" must be an object/)
    expect(configio.planImport({ ...base(), secrets: { settings: [] } }).errors.join(' ')).toMatch(/secrets.settings/)
    expect(configio.planImport({ ...base(), secrets: { git_accounts: 'x' } }).errors.join(' ')).toMatch(/git_accounts/)
    const r = configio.planImport(fileWith({ settings: { NOT_A_KEY_WE_STORE: 'whatever-value-1234', RUNPOD_API_KEY: KEYS_ALL.RUNPOD_API_KEY } }))
    expect(r.warnings.join(' ')).toMatch(/NOT_A_KEY_WE_STORE/); expect(JSON.stringify(r)).not.toContain('whatever-value-1234')
  })
  it('(vi) backs the CURRENT keys and tokens up before writing, and Undo puts them back (a key that was absent is removed again)', () => {
    settings.setSecrets({ RUNPOD_API_KEY: 'rpa_PREVIOUS_RUNPOD_KEY_0000', ANTHROPIC_API_KEY: null }); git.save([{ ...GIT, token: 'ghp_PREVIOUS_TOKEN_SECRET_0000' }])
    const file = fileWith({ settings: { RUNPOD_API_KEY: KEYS_ALL.RUNPOD_API_KEY, ANTHROPIC_API_KEY: KEYS_ALL.ANTHROPIC_API_KEY }, git_accounts: [GIT] })
    const r = configio.applyImport(file, { sections: ['secrets'] })
    const b = JSON.parse(readFileSync(r.backup, 'utf8'))
    expect(b.secrets.settings).toEqual({ RUNPOD_API_KEY: 'rpa_PREVIOUS_RUNPOD_KEY_0000' })   // what was there, not what came in
    expect(b.secrets.git_accounts[0].token).toBe('ghp_PREVIOUS_TOKEN_SECRET_0000')
    expect(storedSettings()).toEqual({ RUNPOD_API_KEY: KEYS_ALL.RUNPOD_API_KEY, ANTHROPIC_API_KEY: KEYS_ALL.ANTHROPIC_API_KEY })
    configio.undoImport()
    expect(storedSettings()).toEqual({ RUNPOD_API_KEY: 'rpa_PREVIOUS_RUNPOD_KEY_0000' })
    expect(git.load()[0].token).toBe('ghp_PREVIOUS_TOKEN_SECRET_0000')
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
  })
  it('undoes a backup made before the export carried keys without touching the current keys', () => {
    giveKeys()
    const r = configio.applyImport(base({ idle_stop_minutes: 12 }), { sections: ['pod_defaults'] })
    const b = JSON.parse(readFileSync(r.backup, 'utf8')); delete b.secrets; writeFileSync(r.backup, JSON.stringify(b))
    settings.setSecrets({ RUNPOD_API_KEY: 'rpa_KEPT_AFTER_UNDO_KEY_0000' })
    configio.undoImport()
    expect(storedSettings().RUNPOD_API_KEY).toBe('rpa_KEPT_AFTER_UNDO_KEY_0000')
  })
  it('(vii) keeps the backups where only the owner can read them: the folder 0700 (even if it existed wider) and each file 0600', () => {
    const dirB = join(dir, 'backups'); mkdirSync(dirB, { recursive: true, mode: 0o755 }); chmodSync(dirB, 0o755)
    giveKeys()
    const r = configio.applyImport(base({ idle_stop_minutes: 12 }), { sections: ['pod_defaults'] })
    expect(statSync(dirB).mode & 0o777).toBe(0o700)
    expect(statSync(r.backup).mode & 0o777).toBe(0o600)
    expect(readdirSync(dirB).every((n) => (statSync(join(dirB, n)).mode & 0o777) === 0o600)).toBe(true)
  })
})
