import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as autosync from '../src/autosync.js'
import * as configio from '../src/configio.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as pods from '../src/pods.js'
import * as podconfigs from '../src/podconfigs.js'
import { scratch } from './helpers.js'

// ADR-046: Auto sync in the configuration, applied to each pod created under it. Simulated (no-spend) pods: nothing reaches RunPod.
const put = (p: Partial<mounts.MountsConfig>) => mounts.put({ ...mounts.load(), ...p })
const ON = { enabled: true, pull: true, push: false, approved_by: 'Lucas' }
beforeEach(() => {
  const d = scratch()
  for (const [k, f] of [['AUTOSYNC_FILE', 'autosync.json'], ['AUTOSYNC_STATE_FILE', 'autosync-state.json'], ['AUTOSYNC_MANIFEST_FILE', 'autosync-manifest.json'], ['HISTORY_FILE', 'history.jsonl'], ['POD_NAMES_FILE', 'pod-names.json'], ['POD_CONFIGS_FILE', 'pod-configs.json'], ['IDLE_FILE', 'idle.json'], ['POD_ROUNDS_FILE', 'pod-rounds.json']]) process.env[k] = join(d, f)
  process.env.REPOSITORIES_FILE = join(d, 'repositories.json')
  const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
})
afterEach(() => { autosync.reset(); for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE', 'POD_NAMES_FILE', 'POD_CONFIGS_FILE', 'REPOSITORIES_FILE', 'POD_ROUNDS_FILE']) delete process.env[k] })

describe('the configuration shape', () => {
  it('defaults: off, Pull on, Push off', () => { expect(mounts.defaults().auto_sync).toEqual({ enabled: false, pull: true, push: false, approved_by: '' }); expect(mounts.normalize({}).auto_sync).toEqual(mounts.AUTO_SYNC_DEFAULT) })
  it('normalizes: a partial or junk value gets the defaults, the name is trimmed', () => {
    expect(mounts.normalize({ auto_sync: { enabled: true, approved_by: ' Lucas ' } as never }).auto_sync).toEqual({ enabled: true, pull: true, push: false, approved_by: 'Lucas' })
    expect(mounts.normalize({ auto_sync: 'yes' as never }).auto_sync).toEqual(mounts.AUTO_SYNC_DEFAULT)
  })
  it('enabling needs the name of who says yes, exactly like autosync.set; off needs nothing', () => {
    expect(() => mounts.validate(mounts.normalize({ auto_sync: { ...ON, approved_by: '' } }))).toThrow('Auto sync needs the name of who says yes')
    expect(() => put({ auto_sync: { ...ON, approved_by: '  ' } })).toThrow(/name of who says yes/)
    expect(put({ auto_sync: ON }).config.auto_sync).toEqual(ON); expect(mounts.load().auto_sync).toEqual(ON)
    expect(put({ auto_sync: { enabled: false, pull: true, push: false, approved_by: '' } }).config.auto_sync?.enabled).toBe(false)
    expect(mounts.preview({ auto_sync: ON }).config.auto_sync).toEqual(ON); expect(() => mounts.preview({ auto_sync: { ...ON, approved_by: '' } })).toThrow()
  })
  it('reset puts the default back', () => { put({ auto_sync: ON }); expect(mounts.reset().auto_sync).toEqual(mounts.AUTO_SYNC_DEFAULT) })
})

describe('export and import', () => {
  it('the export carries it, the import plan shows it as a pod-defaults change, apply sets it, undo restores it; a bad value is reported', () => {
    put({ auto_sync: ON })
    const f = configio.exportConfig({ includeSecrets: false })
    expect((f.config as Record<string, unknown>).auto_sync).toEqual(ON)
    put({ auto_sync: { ...ON, enabled: false } })
    const plan = configio.planImport(f); expect(plan.ok).toBe(true)
    const sec = plan.sections.find((s) => s.key === 'pod_defaults')!; expect(sec.changed).toBe(true); expect(JSON.stringify(sec.incoming)).toContain('auto_sync')
    configio.applyImport(f, { sections: ['pod_defaults'] }); expect(mounts.load().auto_sync).toEqual(ON)
    configio.undoImport(); expect(mounts.load().auto_sync?.enabled).toBe(false)
    expect(configio.planImport({ ...f, config: { ...(f.config as object), auto_sync: 'yes' } } as never).errors.join('\n')).toMatch(/auto_sync is/)
  })
})

describe('applied when a pod is created', () => {
  const make = (name: string, req: Partial<pods.CreatePodRequest> = {}) => pods.create({ name, gpu: 'rtx4090', ...req } as pods.CreatePodRequest)
  it('the Default Configuration: a new pod gets Auto sync with the configured name, and the History says where from', async () => {
    put({ auto_sync: { ...ON, push: true } })
    const p = await make('A'); expect(autosync.get(p.id)).toMatchObject({ enabled: true, pull: true, push: true, approved_by: 'Lucas' })
    expect(history.list({ kind: 'change' }).some((e) => e.kind === 'change' && e.action === 'auto sync on from configuration' && e.approved_by === 'Lucas')).toBe(true)
  })
  it('off by default: nothing is turned on', async () => { const p = await make('A'); expect(autosync.get(p.id).enabled).toBe(false) })
  it('a pod\'s own configuration overrides the default (on in the default, off in its own, and the reverse)', async () => {
    put({ auto_sync: ON })
    const own = mounts.normalize({ ...mounts.load(), auto_sync: { ...ON, enabled: false } })
    const off = await make('B', { config: own }); expect(autosync.get(off.id).enabled).toBe(false)
    put({ auto_sync: { ...ON, enabled: false } })
    const on = await make('C', { config: mounts.normalize({ ...mounts.load(), auto_sync: { ...ON, pull: false, push: true } }) }); expect(autosync.get(on.id)).toMatchObject({ enabled: true, pull: false, push: true })
    expect(podconfigs.get(on.id)?.auto_sync).toMatchObject({ enabled: true })
  })
  it('enabled with no name is skipped, with a History warning, and the pod is made all the same', async () => {
    mounts.save({ ...mounts.load(), auto_sync: { enabled: true, pull: true, push: false, approved_by: '' } })   // saved by hand: put would refuse it
    const p = await make('D'); expect(p.id).toBeTruthy(); expect(autosync.get(p.id).enabled).toBe(false)
    expect(history.list({ kind: 'change' }).some((e) => e.kind === 'change' && e.action === 'auto sync skipped')).toBe(true)
  })
  it('Recreate carries the pod\'s Auto sync settings to the new pod', async () => {
    put({ auto_sync: ON }); const a = await make('E'); autosync.set(a.id, { enabled: true, pull: true, push: true, approved_by: 'Binc' })
    const fresh = await pods.recreate(a.id)
    expect(fresh.id).not.toBe(a.id); expect(autosync.get(fresh.id)).toMatchObject({ enabled: true, push: true, approved_by: 'Binc' }); expect(autosync.get(a.id).enabled).toBe(false)
  })
})
