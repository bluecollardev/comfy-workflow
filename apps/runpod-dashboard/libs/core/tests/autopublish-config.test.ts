import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as autopublish from '../src/autopublish.js'
import * as configio from '../src/configio.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import { mergeConfig } from '../../../mcp/app-tools.mjs'
import { scratch } from './helpers.js'

// ADR-050: Auto-publish is a setting of the Default Configuration (app-wide), but its standing approval and "on" never travel.
let dir: string
const ON = { enabled: true, approved_by: 'Lucas', understood: true }
const ap = () => mounts.load().auto_publish!
const file = (over: Record<string, unknown> = {}) => ({ format: configio.FORMAT, version: 1, config: { network_volume_id: 'volx', ...over } })

beforeEach(async () => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups'); process.env.GIT_ACCOUNTS_FILE = join(dir, 'git.json'); process.env.REPOSITORIES_FILE = join(dir, 'repos.json')
  process.env.CLAUDE_USER_SETTINGS = join(dir, 'claude-settings.json'); process.env.AGENT_GUARD_SCRIPT = join(dir, 'hooks', 'guard-bash.sh')
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  publish.reset(); autopublish.reset(); mounts.save(mounts.defaults())
  await publish.setSettings({ s3: { credentials: 'app', bucket: 'my-internal-bucket', region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' } })
})
afterEach(() => { publish.reset(); autopublish.reset(); for (const k of ['POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'REPOSITORIES_FILE', 'CLAUDE_USER_SETTINGS', 'AGENT_GUARD_SCRIPT']) delete process.env[k]; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('the configuration block', () => {
  it('defaults: off, dry run, 10 minutes, no cap, S3 only, no standing approval', () => {
    expect(mounts.defaults().auto_publish).toEqual({ generate: { enabled: false, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false, colour_in: null }, sources: { local: true, volume: true }, volume_scan_minutes: 5, round: 'tunnel-v11_{date}_r01', include_dpx: false, fix_dpx: true, require_approval: false, enabled: false, dry_run: true, dry_run_first: true, window_minutes: 0, daily_cap: null, targets: { s3: true, slack: false, tunnel: false } }); expect(ap().standing).toBeUndefined()
    expect(mounts.normalize({}).auto_publish!.daily_cap).toBeNull(); expect(mounts.payload(mounts.defaults()).config.auto_publish!.enabled).toBe(false)
  })
  it('validation (400s name the field)', () => {
    const put = (a: Record<string, unknown>) => () => mounts.put({ ...mounts.load(), auto_publish: a as never })
    expect(put({ window_minutes: 121 })).toThrow(/auto_publish\.window_minutes/); expect(put({ window_minutes: -1 })).toThrow(/window_minutes/); expect(put({ daily_cap: 101 })).toThrow(/auto_publish\.daily_cap/); expect(put({ daily_cap: 2.5 })).toThrow(/daily_cap/)
    expect(put({ targets: { tunnel: true } })).toThrow(/Tunnel is not available yet/); expect(put({ targets: { s3: false, slack: true } })).toThrow(/turn S3 on/)
    expect(put({ enabled: true, standing: { approved_by: 'L', at: 'x' }, targets: { s3: false, slack: false } })).toThrow(/at least one of s3 or slack/); expect(put({ enabled: true })).toThrow(/standing approval/)
    expect(mounts.put({ ...mounts.load(), auto_publish: { window_minutes: 0, daily_cap: 50, targets: { s3: true, slack: true } } as never }).config.auto_publish).toMatchObject({ window_minutes: 0, daily_cap: 50, targets: { s3: true, slack: true, tunnel: false } })
    expect(mounts.normalize({ auto_publish: { daily_cap: 0 } as never }).auto_publish!.daily_cap).toBeNull(); expect(mounts.put({ ...mounts.load(), auto_publish: { daily_cap: null } as never }).config.auto_publish!.daily_cap).toBeNull()
  })
  it('the old shape (a boolean `slack`, never released) maps to targets.slack and is dropped on save', () => {
    expect(mounts.normalize({ auto_publish: { slack: true } as never }).auto_publish!.targets).toEqual({ s3: true, slack: true, tunnel: false })
    writeFileSync(join(dir, 'mounts.json'), JSON.stringify({ ...mounts.load(), auto_publish: { enabled: false, slack: true } })); mounts.save(mounts.load()); expect(JSON.parse(readFileSync(join(dir, 'mounts.json'), 'utf8')).auto_publish).not.toHaveProperty('slack')
    expect(ap().targets.slack).toBe(true)
  })
  it('reset returns it to disabled with no standing approval', async () => {
    await autopublish.setSettings(ON); expect(ap()).toMatchObject({ enabled: true, standing: { approved_by: 'Lucas' } }); expect(mounts.reset().auto_publish).toEqual(mounts.defaults().auto_publish)
    expect(mounts.load().auto_publish!.enabled).toBe(false)
  })
  it('sources and volume_scan_minutes: validated (both off is a 400), kept by import, and never in a pod\'s own configuration', () => {
    const put = (a: Record<string, unknown>) => () => mounts.put({ ...mounts.load(), auto_publish: a as never })
    expect(put({ sources: { local: false, volume: false } })).toThrow('Choose at least one place to watch'); expect(put({ volume_scan_minutes: 0 })).toThrow(/volume_scan_minutes/); expect(put({ volume_scan_minutes: 121 })).toThrow(/volume_scan_minutes/); expect(put({ volume_scan_minutes: 1.5 })).toThrow()
    expect(mounts.put({ ...mounts.load(), auto_publish: { sources: { local: false, volume: true }, volume_scan_minutes: 30 } as never }).config.auto_publish).toMatchObject({ sources: { local: false, volume: true }, volume_scan_minutes: 30 })
    const f = configio.exportConfig({ includeSecrets: false }); mounts.save(mounts.defaults()); configio.applyImport(f as never, { sections: ['pod_defaults'] }); expect(ap()).toMatchObject({ sources: { local: false, volume: true }, volume_scan_minutes: 30 })
    podconfigs.set('pX', mounts.normalize({ auto_publish: { sources: { local: false, volume: false }, volume_scan_minutes: 9 } as never })); expect(JSON.stringify(podconfigs.get('pX'))).not.toMatch(/volume_scan_minutes|sources/)
  })
  it('a pod\'s own configuration ignores and never stores it', () => {
    const cfg = mounts.normalize({ auto_publish: { enabled: true, standing: { approved_by: 'L', at: 'x' }, targets: { s3: true } } as never }); podconfigs.set('pod1', cfg)
    expect(podconfigs.get('pod1')).not.toHaveProperty('auto_publish'); expect(readFileSync(join(dir, 'pod-configs.json'), 'utf8')).not.toContain('auto_publish'); expect(podconfigs.load().pod1).not.toHaveProperty('auto_publish')
  })
})

describe('autopublish.settings() through the configuration', () => {
  it('round trip: setSettings writes the Default Configuration, the other settings stay, and the History entry names fields only', async () => {
    mounts.save({ ...mounts.load(), idle_stop_minutes: 33 }); const before = JSON.stringify(history.list({ limit: 5 }))
    await autopublish.setSettings({ ...ON, window_minutes: 7, daily_cap: 4, targets: { slack: true } }); expect(ap().dry_run_first).toBe(true)
    expect(ap()).toMatchObject({ enabled: true, dry_run: true, window_minutes: 7, daily_cap: 4, standing: { approved_by: 'Lucas' }, targets: { s3: true, slack: true, tunnel: false } }); expect(mounts.load().idle_stop_minutes).toBe(33)
    expect(await autopublish.settings()).toMatchObject({ enabled: true, window_minutes: 7, daily_cap: 4 }); expect(JSON.stringify(history.list({ limit: 5 }))).not.toBe(before)
    const h = history.list({ limit: 10 }).find((e) => e.kind === 'change' && e.action === 'auto-publish settings changed')!; expect(h.detail).toMatch(/window_minutes.*daily_cap \(4\).*targets \(s3, slack\)/); expect(JSON.stringify(h)).not.toMatch(/hooks\.slack|AKIA|wJalr/)
    await autopublish.off(); expect(ap()).toMatchObject({ enabled: false }); expect(ap().standing).toBeUndefined(); expect(ap().window_minutes).toBe(7)
  })
  it('a change made in the configuration applies at the next tick, with no restart (the cache follows the file)', async () => {
    await autopublish.setSettings(ON); expect((await autopublish.settings()).window_minutes).toBe(0)
    const f = join(dir, 'mounts.json'), cfg = JSON.parse(readFileSync(f, 'utf8')); cfg.auto_publish.window_minutes = 45; cfg.auto_publish.targets.slack = true; writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n'); utimesSync(f, new Date(), new Date(Date.now() + 5000))
    expect(await autopublish.settings()).toMatchObject({ window_minutes: 45, targets: { s3: true, slack: true } }); cfg.auto_publish.enabled = false; writeFileSync(f, JSON.stringify(cfg)); utimesSync(f, new Date(), new Date(Date.now() + 9000)); expect((await autopublish.settings()).enabled).toBe(false)
  })
})

describe('export, import, undo', () => {
  it('export keeps the settings as they are and marks the standing approval as informational', async () => {
    await autopublish.setSettings({ ...ON, daily_cap: 6 }); const f = configio.exportConfig({ includeSecrets: false })
    expect((f.config as Record<string, unknown>).auto_publish).toMatchObject({ enabled: true, dry_run: true, daily_cap: 6, standing: { approved_by: 'Lucas' }, standing_informational: true })
  })
  it('import forces it OFF, in dry run, with no standing approval and no Tunnel; the window, the cap and the targets are imported; the plan says so', async () => {
    const incoming = { enabled: true, dry_run: false, dry_run_first: false, window_minutes: 30, daily_cap: 7, targets: { s3: true, slack: true, tunnel: true }, standing: { approved_by: 'Someone', at: '2026-11-01T00:00:00Z' }, standing_informational: true }
    const plan = configio.planImport(file({ auto_publish: incoming })); const sec = plan.sections.find((s) => s.key === 'pod_defaults')!
    expect(sec.note).toMatch(/Auto-publish will be imported turned OFF/); expect((sec.incoming as { auto_publish: mounts.AutoPublishConfig }).auto_publish).toMatchObject({ enabled: false, dry_run: true, window_minutes: 30, daily_cap: 7, targets: { s3: true, slack: true, tunnel: false } }); expect((sec.incoming as { auto_publish: mounts.AutoPublishConfig }).auto_publish.standing).toBeUndefined()
    configio.applyImport(file({ auto_publish: incoming }), { sections: ['pod_defaults'] })
    expect(ap()).toMatchObject({ enabled: false, dry_run: true, dry_run_first: false, window_minutes: 30, daily_cap: 7, targets: { s3: true, slack: true, tunnel: false } }); expect(ap().standing).toBeUndefined()
    expect(configio.planImport(file({ auto_publish: { ...incoming, enabled: false } })).sections.find((s) => s.key === 'pod_defaults')?.note ?? '').not.toMatch(/turned OFF/)
    expect(configio.planImport(file({ auto_publish: { daily_cap: 'lots' } })).errors.join()).toMatch(/auto_publish is/)
  })
  it('undo restores the earlier state exactly, including enabled and the standing approval (this PC restoring its own state)', async () => {
    await autopublish.setSettings(ON); await autopublish.setSettings({ dry_run: false, understood: true, daily_cap: 3 }); const before = ap()
    configio.applyImport(file({ auto_publish: { enabled: true, targets: { s3: true } }, idle_stop_minutes: 12 }), { sections: ['pod_defaults'] }); expect(ap().enabled).toBe(false)
    configio.undoImport(); expect(ap()).toEqual(before); expect(ap()).toMatchObject({ enabled: true, dry_run: false, standing: { approved_by: 'Lucas' }, daily_cap: 3 })
  })
})

describe('MCP: a configuration put never turns Auto-publish on or changes where it sends', () => {
  const cur = () => mounts.load()
  it('refuses enabled, going live, the standing approval and the targets (403), allows the other fields', async () => {
    await autopublish.setSettings(ON)
    for (const patch of [{ enabled: false, targets: { slack: true } }, { targets: { s3: false } }, { slack: true }] as Record<string, unknown>[]) expect(() => mergeConfig(cur(), { auto_publish: patch }), JSON.stringify(patch)).toThrow(/Where Auto-publish sends is chosen in the window, by a person/)
    await autopublish.off(); mounts.save({ ...cur(), auto_publish: { ...ap(), dry_run: true } })
    expect(() => mergeConfig(cur(), { auto_publish: { enabled: true } })).toThrow(/Auto-publish is turned on in the window, by a person/); expect(() => mergeConfig(cur(), { auto_publish: { dry_run: false } })).toThrow(/turned on in the window/)
    expect(() => mergeConfig(cur(), { auto_publish: { standing: { approved_by: 'X', at: 'y' } } })).toThrow(/turned on in the window/); expect(() => mergeConfig(cur(), { auto_publish: { dry_run_first: false } })).toThrow(/turned on in the window/); expect(() => mergeConfig(cur(), { auto_publish: { dry_run_first: true } })).not.toThrow()
    expect(mergeConfig(cur(), { auto_publish: { window_minutes: 25, daily_cap: 9, enabled: false, dry_run: true } }).auto_publish).toMatchObject({ window_minutes: 25, daily_cap: 9, enabled: false })
    expect(() => mergeConfig(cur(), { auto_publish: { targets: { s3: true, slack: false, tunnel: false } } })).not.toThrow()   // the same values: nothing changes
  })
})

describe('fix_dpx (ADR-057 decision 7)', () => {
  it('is on by default, a boolean in the configuration, and an old file without it loads with it on', () => {
    expect(mounts.defaults().auto_publish!.fix_dpx).toBe(true); expect(mounts.normalize({}).auto_publish!.fix_dpx).toBe(true)
    expect(mounts.normalize({ auto_publish: { include_dpx: true } as never }).auto_publish).toMatchObject({ include_dpx: true, fix_dpx: true })
    expect(mounts.normalize({ auto_publish: { fix_dpx: false } as never }).auto_publish!.fix_dpx).toBe(false)
    expect(mounts.put({ ...mounts.load(), auto_publish: { fix_dpx: false } as never }).config.auto_publish!.fix_dpx).toBe(false)
  })
  it('export carries it, import applies it, and a bad value is refused by the file check', async () => {
    await autopublish.setSettings({ fix_dpx: false }); const f = configio.exportConfig({ includeSecrets: false })
    expect((f.config as Record<string, unknown>).auto_publish).toMatchObject({ fix_dpx: false })
    await autopublish.setSettings({ fix_dpx: true }); expect(ap().fix_dpx).toBe(true)
    configio.applyImport(f as never, { sections: ['pod_defaults'] }); expect(ap().fix_dpx).toBe(false)
    expect(configio.planImport(file({ auto_publish: { fix_dpx: 'no' } })).errors.join()).toMatch(/auto_publish is/)
    expect(configio.planImport(file({ auto_publish: { fix_dpx: true } })).errors.join()).not.toMatch(/auto_publish is/)
  })
  it('the settings call keeps it when other settings change', async () => {
    await autopublish.setSettings({ fix_dpx: false }); await autopublish.setSettings({ window_minutes: 5 }); expect((await autopublish.settings()).fix_dpx).toBe(false)
    expect(ap().fix_dpx).toBe(false)
  })
})
