import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'

// Convert To Rec.709 as a configuration setting (render.rec709, default off): defaults, an older file, validation, export, import, backup and undo, the pod's own configuration.
const ENVS = ['MOUNTS_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'POD_CONFIGS_FILE', 'REPOSITORIES_FILE', 'PANAMA_CONSOLE_URL']
let dir = ''
const rec = () => mounts.load().render.rec709
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rec709-'))
  process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups')
  process.env.GIT_ACCOUNTS_FILE = join(dir, 'git.json'); process.env.POD_CONFIGS_FILE = join(dir, 'pod-configs.json'); process.env.REPOSITORIES_FILE = join(dir, 'repos.json'); delete process.env.PANAMA_CONSOLE_URL
  mounts.save(mounts.normalize({ network_volume_id: 'vol1', data_center_id: 'EUR-IS-2', image: 'ghcr.io/x/y:1', idle_stop_minutes: 30, env: { COMFY_PORT: '8188' }, folders: { 'comfy-shared': '/home/me/shared' } } as never))
})
afterEach(() => { for (const k of ENVS) delete process.env[k] })

describe('render.rec709: normalize and validate', () => {
  it('is off by default, and so is a configuration file written before the setting existed', () => {
    expect(mounts.RENDER_DEFAULT.rec709).toBe(false)
    expect(mounts.normalizeRender(undefined).rec709).toBe(false)
    expect(mounts.normalizeRender({ rec709: true }).rec709).toBe(true)
    const old = JSON.parse(readFileSync(process.env.MOUNTS_FILE!, 'utf8')); delete old.render.rec709; writeFileSync(process.env.MOUNTS_FILE!, JSON.stringify(old))
    expect(rec()).toBe(false); expect(() => mounts.validate(mounts.normalize(old))).not.toThrow()
  })
  it('refuses a value that is not true or false', () => {
    expect(() => mounts.put({ ...mounts.load(), render: { ...mounts.load().render, rec709: 'yes' as never } }, { quiet: true })).toThrow(/render\.rec709 is true or false/)
    expect(rec()).toBe(false)
  })
  it('a save and a load keep it, and saving the rest of the render block does not reset it', () => {
    mounts.put({ ...mounts.load(), render: { ...mounts.load().render, rec709: true } }, { quiet: true }); expect(rec()).toBe(true)
    const m = mounts.load(); mounts.put({ ...m, render: { ...m.render, pull: true } }, { quiet: true }); expect(rec()).toBe(true)
  })
})

describe('render.rec709: export, import, undo and the pod\'s own configuration', () => {
  it('is in the export (the Render block), and a file with a non-boolean is refused by the plan', () => {
    mounts.put({ ...mounts.load(), render: { ...mounts.load().render, rec709: true } }, { quiet: true })
    const f = configio.exportConfig({ appVersion: '9.9.9', now: new Date('2026-11-21T05:00:00Z') })
    expect(((f.config as Record<string, unknown>).render as Record<string, unknown>).rec709).toBe(true)
    const bad = configio.planImport({ format: configio.FORMAT, version: 1, config: { render: { rec709: 'yes' } } })
    expect(bad.ok === false || bad.sections.some((s) => s.error)).toBe(true)
    expect(() => configio.applyImport({ format: configio.FORMAT, version: 1, config: { render: { rec709: 'yes' } } }, { sections: ['pod_defaults'] })).toThrow()
  })
  it('import writes it, a backup is made and Undo puts the previous value back', () => {
    expect(rec()).toBe(false)
    const file = { format: configio.FORMAT, version: 1, config: { render: { ...mounts.RENDER_DEFAULT, rec709: true } } }
    const r = configio.applyImport(file, { sections: ['pod_defaults'] }); expect(r.applied).toEqual(['pod_defaults'])
    expect(rec()).toBe(true); expect(configio.listBackups()).toHaveLength(1)
    configio.undoImport(); expect(rec()).toBe(false)
  })
  it('a pod\'s own configuration carries it (render is part of it), and falls back to off when the pod has none', () => {
    const own = podconfigs.normalize ? podconfigs.normalize({ render: { ...mounts.RENDER_DEFAULT, rec709: true } } as never) : null
    if (own) expect((own as { render?: { rec709?: boolean } }).render?.rec709).toBe(true)
    expect(mounts.normalizeRender({}).rec709).toBe(false)
  })
})
