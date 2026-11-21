import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as configio from '../src/configio.js'
import * as dpxfix from '../src/dpxfix.js'
import * as mcp from '../src/mcp.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'

// Prepare For Delivery settings as a configuration block (docs/ADR-055 section 12): defaults, validation, an older file, every writer keeps it, export, import, backup, undo, and what dpx_fix does with it.
const ENVS = ['MOUNTS_FILE', 'SETTINGS_ENV_FILE', 'POD_MANAGER_BACKUPS_DIR', 'GIT_ACCOUNTS_FILE', 'POD_CONFIGS_FILE', 'REPOSITORIES_FILE', 'PANAMA_CONSOLE_URL']
const MINE = { out_dir: 'handover_a', colour_code: 'linear', gamma: 2.2, fps_source: 'fixed', fps: 25, timecode_source: 'zero', frame_position: 'keep', skip_existing: true } as const
let dir = ''
const dp = () => mounts.load().delivery_prepare
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dpc-'))
  process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups')
  process.env.GIT_ACCOUNTS_FILE = join(dir, 'git.json'); process.env.POD_CONFIGS_FILE = join(dir, 'pod-configs.json'); process.env.REPOSITORIES_FILE = join(dir, 'repos.json'); delete process.env.PANAMA_CONSOLE_URL
  mounts.save(mounts.normalize({ network_volume_id: 'vol1', data_center_id: 'EUR-IS-2', image: 'ghcr.io/x/y:1', idle_stop_minutes: 30, env: { COMFY_PORT: '8188' }, folders: { 'comfy-shared': '/home/me/shared' } } as never))
})
afterEach(() => { for (const k of ENVS) delete process.env[k]; dpxfix.setDeps(null) })

describe('delivery_prepare: normalize and validate', () => {
  it('an absent block is the defaults, and so is a configuration file written before the block existed', () => {
    expect(mounts.normalizeDeliveryPrepare(undefined)).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
    expect(mounts.DELIVERY_PREPARE_DEFAULT).toEqual({ out_dir: '_delivery_v11', colour_code: 'user-defined', gamma: 2.6, fps_source: 'clip-name', fps: 23.976, timecode_source: 'edl', frame_position: 'set', skip_existing: false })
    const old = JSON.parse(readFileSync(process.env.MOUNTS_FILE!, 'utf8')); delete old.delivery_prepare; writeFileSync(process.env.MOUNTS_FILE!, JSON.stringify(old))
    expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
    expect(() => mounts.validate(mounts.normalize(old))).not.toThrow()
  })
  it('a partial block keeps what it says and fills the rest; junk numbers fall back to the defaults', () => {
    expect(mounts.normalizeDeliveryPrepare({ gamma: 2.4, skip_existing: true })).toEqual({ ...mounts.DELIVERY_PREPARE_DEFAULT, gamma: 2.4, skip_existing: true })
    expect(mounts.normalizeDeliveryPrepare({ gamma: 'x', fps: null }).gamma).toBe(2.6)
    expect(mounts.normalizeDeliveryPrepare([1, 2])).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
  })
  it('refuses what cannot be a setting', () => {
    const put = (o: Record<string, unknown>) => () => mounts.put({ ...mounts.load(), delivery_prepare: { ...mounts.DELIVERY_PREPARE_DEFAULT, ...o } as never }, { quiet: true })
    for (const o of [{ out_dir: '../x' }, { out_dir: 'a/b' }, { out_dir: '' + '.'.repeat(2) }, { out_dir: 'x'.repeat(61) }, { colour_code: 'log' }, { gamma: 0 }, { gamma: 11 }, { fps_source: 'guess' }, { fps: 0 }, { fps: 500 }, { timecode_source: 'now' }, { frame_position: 'maybe' }]) expect(put(o), JSON.stringify(o)).toThrow(/delivery_prepare/)
    expect(put(MINE)).not.toThrow()
  })
})

describe('delivery_prepare: every writer keeps it', () => {
  beforeEach(() => { mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true }) })
  it('put with the loaded configuration, save and a normal setting change keep it; a put that leaves the block out resets it to the defaults (as for every block: use the setters)', () => {
    expect(dp()).toEqual(MINE)
    mounts.put({ ...mounts.load(), idle_stop_minutes: 12 }, { quiet: true }); expect(dp()).toEqual(MINE)
    mounts.save({ ...mounts.load(), default_gpu: 'auto' }); expect(dp()).toEqual(MINE)
    const noBlock = { ...mounts.load() } as Partial<mounts.MountsConfig>; delete noBlock.delivery_prepare
    mounts.put(noBlock, { quiet: true }); expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)   // the known trap, written down
  })
  it('the MCP serve switch (a setter that saves the whole configuration) keeps it', () => { mcp.setServe('pod-manager', true, 8765); expect(dp()).toEqual(MINE) })
  it('preview is not a write: it shows the block and saves nothing', () => {
    const p = mounts.preview({ ...mounts.load(), delivery_prepare: { ...MINE, gamma: 2.4 } as never }); expect(p.config.delivery_prepare!.gamma).toBe(2.4); expect(dp()!.gamma).toBe(2.2)
  })
  it('a pod\'s own configuration never carries it (it is a Default Configuration setting, like auto_publish)', () => {
    podconfigs.set('pod1', mounts.load()); expect(podconfigs.get('pod1')).not.toHaveProperty('delivery_prepare'); expect(dp()).toEqual(MINE)
  })
})

describe('delivery_prepare: configuration export, import, backup and undo', () => {
  it('is in the export (in the Pod defaults section), without any approval', () => {
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    const f = configio.exportConfig({ appVersion: '9.9.9', now: new Date('2026-11-21T05:00:00Z') })
    expect((f.config as Record<string, unknown>).delivery_prepare).toEqual(MINE)
    expect((f.config as Record<string, unknown>).delivery_prepare).not.toHaveProperty('approved_by')   // a person's yes is never in the block
    expect(configio.SECTIONS.pod_defaults.fields).toContain('delivery_prepare')
  })
  it('import: the plan lists it as a change, apply writes it (and leaves the other blocks as they are), a backup is made and Undo puts the previous values back', () => {
    const before = mounts.load(); expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
    const file = { format: configio.FORMAT, version: 1, config: { delivery_prepare: { ...MINE } } }
    const plan = configio.planImport(file); expect(plan.ok).toBe(true)
    const sec = plan.sections.find((s) => s.key === 'pod_defaults')!; expect(sec.changed).toBe(true); expect(JSON.stringify(sec.incoming)).toContain('handover_a')
    const r = configio.applyImport(file, { sections: ['pod_defaults'] }); expect(r.applied).toEqual(['pod_defaults'])
    expect(dp()).toEqual(MINE); expect(mounts.load().idle_stop_minutes).toBe(before.idle_stop_minutes); expect(mounts.load().edl).toEqual(before.edl); expect(mounts.load().auto_publish).toEqual(before.auto_publish)
    expect(configio.listBackups()).toHaveLength(1)
    configio.undoImport(); expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT); expect(configio.listBackups()).toHaveLength(0)
  })
  it('importing another section (the EDL source, the outputs window) leaves the block alone', () => {
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    configio.applyImport({ format: configio.FORMAT, version: 1, config: { edl: { source: { file: '/tmp/x.edl' } } } }, { sections: ['pod_defaults'] })
    expect(dp()).toEqual(MINE); expect(mounts.load().edl).toEqual({ source: { file: '/tmp/x.edl' } })
  })
  it('a round trip: export, change, import the export, the block is back', () => {
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    const f = configio.exportConfig({ appVersion: '1', now: new Date('2026-11-21T05:00:00Z') })
    mounts.put({ ...mounts.load(), delivery_prepare: { ...mounts.DELIVERY_PREPARE_DEFAULT } }, { quiet: true }); expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
    configio.applyImport(f, { sections: ['pod_defaults'] }); expect(dp()).toEqual(MINE)
  })
  it('a file with a wrong value, or with an approval in it, is refused by the plan and never written', () => {
    const bad = (v: unknown) => configio.planImport({ format: configio.FORMAT, version: 1, config: { delivery_prepare: v } })
    expect(bad({ gamma: 'x' }).ok).toBe(false)
    expect(bad({ approved_by: 'Lucas' }).errors.join(' ')).toMatch(/approved_by|yes/)
    const p = bad({ gamma: 99 }); expect(p.ok === false || p.sections.some((s) => s.error)).toBe(true)
    expect(() => configio.applyImport({ format: configio.FORMAT, version: 1, config: { delivery_prepare: { gamma: 99 } } }, { sections: ['pod_defaults'] })).toThrow()
    expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
  })
  it('a backup made before the block existed restores to the defaults without an error', () => {
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    configio.applyImport({ format: configio.FORMAT, version: 1, config: { idle_stop_minutes: 17 } }, { sections: ['pod_defaults'] })
    const [b] = configio.listBackups(); const o = JSON.parse(readFileSync(b.file, 'utf8')); delete o.mounts.delivery_prepare; writeFileSync(b.file, JSON.stringify(o))
    configio.undoImport(); expect(dp()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
  })
})

describe('delivery_prepare: what dpx_fix does with it', () => {
  const dpx = (i: number) => { const b = Buffer.alloc(2048 + 64); b.write('SDPX', 0); b.writeUInt32BE(2048, 4); b.writeUInt32BE(4, 772); b.writeUInt32BE(4, 776); b[801] = 2; b[802] = 2; b[803] = 16; b.write(`old.${i}.dpx`, 36); b.writeUInt32BE(77, 1712); b.writeUInt32BE(77, 1716); b.writeFloatBE(30, 1724); return b }
  const run = (src: string, out: string, args: (string | number)[]) => execFileSync('python3', ['-', src, out, 'CLIP', '01:00:00:00', '24', ...args.map(String)], { input: dpxfix.PYTHON, encoding: 'utf8' })
  it('settings() is the stored block, effective() puts a clip\'s own arguments on top and refuses a bad one', () => {
    expect(dpxfix.settings()).toEqual(mounts.DELIVERY_PREPARE_DEFAULT)
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    expect(dpxfix.settings()).toEqual(MINE)
    expect(dpxfix.effective({ gamma: 2.4, out_dir: 'other' })).toEqual({ ...MINE, gamma: 2.4, out_dir: 'other' })
    expect(() => dpxfix.effective({ out_dir: '../x' })).toThrow(/out_dir/); expect(() => dpxfix.effective({ gamma: 0 })).toThrow(/gamma/)
  })
  it('the script gets the stored values (folder, colour code, gamma, frame position, skip) and a call\'s own arguments win', async () => {
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    const seen: string[] = []
    dpxfix.setDeps({ target: async () => ({ host: 'root@1.2.3.4', port: 22 }), outputDir: () => '/w/output', ssh: async ({ script, onLine }) => { seen.push(script); onLine?.('FRAMES A 1/1'); onLine?.('CHECK A 1/1 headers right'); return { code: 0 } } })
    const r = await dpxfix.run({ pod_id: 'p', approved_by: 'L', items: [{ src_dir: 'x/a/dpx', clip: 'A', start_timecode: '01:00:00:00' }, { src_dir: 'x/b/dpx', clip: 'B', start_timecode: '01:00:00:00', fps: 24, gamma: 2.4, colour_code: 'user-defined', out_dir: 'elsewhere', frame_position: 'set', skip_existing: false }] })
    expect(seen[0]).toContain("'/w/output/x/a/dpx' '/w/output/handover_a/A' 'A' '01:00:00:00' '25' '2' '2.2' '0' '1'")   // fps 25 from the block, linear = 2, gamma 2.2, frame position keep = 0, skip = 1
    expect(seen[1]).toContain("'/w/output/x/b/dpx' '/w/output/elsewhere/B' 'B' '01:00:00:00' '24' '0' '2.4' '1' '0'")   // every argument given wins
    expect(r.results.map((x) => x.out_dir)).toEqual(['handover_a/A', 'elsewhere/B']); expect(r.out_root).toBe('/w/output/handover_a'); expect(r.settings).toEqual(MINE)
  })
  it('the timecode may be left out of an item when the settings say zero, and not when they say EDL', async () => {
    dpxfix.setDeps({ target: async () => ({ host: 'h', port: 22 }), outputDir: () => '/w/output', ssh: async ({ onLine }) => { onLine?.('CHECK A 1/1 headers right'); return { code: 0 } } })
    await expect(dpxfix.run({ pod_id: 'p', approved_by: 'L', items: [{ src_dir: 'x/a', clip: 'A' }] })).rejects.toMatchObject({ status: 400 })
    mounts.put({ ...mounts.load(), delivery_prepare: { ...MINE } }, { quiet: true })
    await expect(dpxfix.run({ pod_id: 'p', approved_by: 'L', items: [{ src_dir: 'x/a', clip: 'A' }] })).resolves.toMatchObject({ results: [{ ok: true }] })
  })
  it('the python writes what the block says: linear code, the gamma, the film header left alone, an existing copy kept', () => {
    const d = mkdtempSync(join(tmpdir(), 'dpc-py-')), src = join(d, 'src'), out = join(d, 'out'); mkdirSync(src)
    for (let i = 0; i < 2; i++) writeFileSync(join(src, `x.000${i}.dpx`), dpx(i))
    const log = run(src, out, [2, 2.2, 0, 0]); expect(log).toMatch(/CHECK CLIP 2\/2 headers right/)
    const h = readFileSync(join(out, 'CLIP.0000.dpx'))
    expect([h[801], h[802]]).toEqual([2, 2]); expect(h.readFloatBE(1948)).toBeCloseTo(2.2, 5); expect(h.subarray(1920, 1924).toString('hex')).toBe('01000000')
    expect([h.readUInt32BE(1712), h.readUInt32BE(1716), h.readFloatBE(1724)]).toEqual([77, 77, 30])   // frame position: keep
    const before = readFileSync(join(out, 'CLIP.0001.dpx')); writeFileSync(join(out, 'CLIP.0001.dpx'), Buffer.concat([before.subarray(0, 100), Buffer.from('K'), before.subarray(101)]))   // a marker byte the script would overwrite
    run(src, out, [2, 2.2, 0, 1]); expect(readFileSync(join(out, 'CLIP.0001.dpx'))[100]).toBe('K'.charCodeAt(0))   // skip: the copy with the right size is not written again
    run(src, out, [2, 2.2, 0, 0]); expect(readFileSync(join(out, 'CLIP.0001.dpx'))[100]).not.toBe('K'.charCodeAt(0))   // no skip: written again
    expect(readdirSync(out).sort()).toEqual(['CLIP.0000.dpx', 'CLIP.0001.dpx'])
  })
})
