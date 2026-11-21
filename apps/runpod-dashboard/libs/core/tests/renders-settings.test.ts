import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as pods from '../src/pods.js'
import * as renders from '../src/renders.js'
import { scratch } from './helpers.js'

// ADR-048 "Settings": the render settings in the configuration (Default and a pod's own), applied by plan and start for every field the request omits.
const D = { colour: { mode: 'known' }, where: 'auto', kind: 'review', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', preset: 'none', pull: false, skip_existing: true, rec709: false, publish: { s3: true, slack: false } }
const SEQ = { dir: 'a/b', name: 'ARCHIVAL-085_x_23.976_y', first: 0, last: 9, frames: 10, pad: 4 }
const put = (p: Partial<mounts.MountsConfig>) => mounts.put({ ...mounts.load(), ...p })
beforeEach(() => {
  const d = scratch()
  for (const [k, f] of [['HISTORY_FILE', 'h.jsonl'], ['POD_CONFIGS_FILE', 'pc.json'], ['POD_NAMES_FILE', 'pn.json'], ['IDLE_FILE', 'i.json'], ['POD_ROUNDS_FILE', 'pr.json'], ['RENDERS_FILE', 'r.json'], ['AUTOSYNC_FILE', 'as.json'], ['AUTOSYNC_STATE_FILE', 'ass.json']]) process.env[k] = join(d, f)
  process.env.REPOSITORIES_FILE = join(d, 'repositories.json')
  const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg); renders.reset()
  renders.setDeps({ target: async () => ({ host: 'root@x', port: 22 }), ssh: async () => ({ code: 0 }), volumeId: () => '', localRoot: () => join(d, 'shared'), findFfmpeg: async () => '/fake/ffmpeg', spawn: async () => ({ code: 0 }), findFfprobe: async () => '/fake/ffprobe', deliverDirs: async () => [], deliverFiles: async () => [], readText: async () => null, listing: async () => [] })
})
afterEach(() => { renders.reset() })

describe('the shape', () => {
  it('defaults: auto, review, source, source, prores, auto, NO pull, skip existing, publish to S3 pre-ticked', () => { expect(mounts.defaults().render).toEqual(D); expect(mounts.normalize({}).render).toEqual(D); expect(mounts.RENDER_DEFAULT).toEqual(D) })
  it('normalizes a partial value over the defaults; numeric strings become widths; junk survives to be refused by validate', () => {
    expect(mounts.normalize({ render: { kind: 'review', proxy_width: '1280' as never } as never }).render).toEqual({ ...D, kind: 'review', proxy_width: 1280 })
    expect(mounts.normalize({ render: 'x' as never }).render).toEqual(D)
  })
  it('validation names the field (400) for each bad value', () => {
    const bad = (r: Record<string, unknown>) => () => mounts.validate(mounts.normalize({ render: { ...D, ...r } as never }))
    expect(bad({ where: 'cloud' })).toThrow(/render\.where is auto, pod or local/); expect(bad({ kind: 'master' })).toThrow(/render\.kind is proxy or review/)
    expect(bad({ proxy_width: 800 })).toThrow(/render\.proxy_width is source, 960, 1280 or 1920/); expect(bad({ review_width: 'big' })).toThrow(/render\.review_width/)
    expect(bad({ codecs: [] })).toThrow(/render\.codecs is a non-empty list/); expect(bad({ codecs: ['divx'] })).toThrow(/render\.codecs/)
    expect(bad({ fps: 0 })).toThrow(/render\.fps is auto or a number from 1 to 240/); expect(bad({ fps: 'fast' })).toThrow(/render\.fps/); expect(bad({ fps: 500 })).toThrow(/render\.fps/)
    expect(bad({ pull: 'yes' })).toThrow(/render\.pull is true or false/)
    expect(bad({ where: 'local', kind: 'review', proxy_width: 960, review_width: 1920, codecs: ['h264', 'prores422hq'], fps: 25, pull: false })).not.toThrow()
    expect(() => mounts.put({ render: { ...D, where: 'x' } as never })).toThrow(/render\.where/)
  })
  it('no approver and no allow_partial are ever stored: unknown keys are dropped, and the export check refuses them', () => {
    const r = put({ render: { ...D, approved_by: 'Lucas', allow_partial: true } as never }).config.render as Record<string, unknown>
    expect('approved_by' in r).toBe(false); expect('allow_partial' in r).toBe(false); expect(Object.keys(r).sort()).toEqual(['codecs', 'colour', 'fps', 'kind', 'preset', 'proxy_width', 'publish', 'pull', 'rec709', 'review_width', 'skip_existing',  'where'])
    expect(configio.planImport({ ...configio.exportConfig({ includeSecrets: false }), config: { ...(configio.exportConfig({ includeSecrets: false }).config as object), render: { ...D, approved_by: 'x' } } } as never).errors.join('\n')).toMatch(/no approver, no allow_partial/)
  })
  it('reset puts the defaults back; preview shows the value', () => { put({ render: { ...D, kind: 'review' } }); expect(mounts.reset().render).toEqual(D); expect(mounts.preview({ render: { ...D, pull: false } as never }).config.render?.pull).toBe(false); expect(() => mounts.preview({ render: { ...D, codecs: [] } as never })).toThrow() })
})

describe('export, import, undo', () => {
  it('the export carries it; the import plan shows it under Pod defaults; apply sets it; undo restores it', () => {
    put({ render: { ...D, kind: 'review', review_width: 1920, codecs: ['h264', 'prores422hq'] } as never })
    const f = configio.exportConfig({ includeSecrets: false }); expect((f.config as Record<string, unknown>).render).toMatchObject({ kind: 'review', review_width: 1920, codecs: ['h264', 'prores422hq'] })
    put({ render: D as never }); const plan = configio.planImport(f); expect(plan.ok).toBe(true)
    const sec = plan.sections.find((x) => x.key === 'pod_defaults')!; expect(sec.changed).toBe(true); expect(JSON.stringify(sec.incoming)).toContain('render')
    configio.applyImport(f, { sections: ['pod_defaults'] }); expect(mounts.load().render).toMatchObject({ kind: 'review', review_width: 1920 })
    configio.undoImport(); expect(mounts.load().render).toEqual(D)
    expect(configio.planImport({ ...f, config: { ...(f.config as object), render: 'x' } } as never).errors.join('\n')).toMatch(/render is/)
  })
})

describe('a pod\'s own configuration, Recreate, and what plan and start use', () => {
  it('the pod\'s own render settings override the Default Configuration; a pod without them follows the default; local-only uses the default', async () => {
    put({ render: { ...D, kind: 'review', codecs: ['prores422hq'] } as never })
    const own = mounts.normalize({ ...mounts.load(), render: { ...D, kind: 'proxy', proxy_width: 1280, pull: false } })   // the pod's own kind differs from the default's
    const p = await pods.create({ name: 'A', gpu: 'rtx4090', config: own } as never); expect(podconfigs.get(p.id)?.render).toMatchObject({ proxy_width: 1280, pull: false, kind: 'proxy' })
    expect(renders.effectiveSettings(p.id)).toMatchObject({ kind: 'proxy', proxy_width: 1280, pull: false }); expect(renders.effectiveSettings('other-pod')).toMatchObject({ kind: 'review', codecs: ['prores422hq'] }); expect(renders.effectiveSettings()).toMatchObject({ kind: 'review' })
  })
  it('Recreate carries it', async () => {
    const own = mounts.normalize({ ...mounts.load(), render: { ...D, where: 'local', review_width: 960 } as never })
    const a = await pods.create({ name: 'B', gpu: 'rtx4090', config: own } as never); const fresh = await pods.recreate(a.id)
    expect(fresh.id).not.toBe(a.id); expect(podconfigs.get(fresh.id)?.render).toMatchObject({ where: 'local', review_width: 960 })
  })
  it('plan fills every omitted field from the effective settings and returns them; explicit fields win', async () => {
    put({ render: { ...D, where: 'pod', kind: 'review', review_width: 1280, codecs: ['h264', 'prores422hq'] } as never })
    let p = await renders.plan({ pod_id: 'p1', sequences: [SEQ] })
    expect(p).toMatchObject({ kind: 'review', width: 1280, codecs: ['h264', 'prores422hq'], where: 'pod', settings_source: 'default', settings: { kind: 'review', review_width: 1280 } })
    p = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy', width: 960, where: 'local', codecs: ['h264'] }); expect(p).toMatchObject({ kind: 'proxy', width: 960, where: 'local', codecs: ['h264'] })
    expect((await renders.plan({ sequences: [SEQ], where: 'local' })).settings_source).toBe('default')   // no pod: the Default Configuration's
    podconfigs.set('p1', mounts.normalize({ ...mounts.load(), render: { ...D, where: 'local', proxy_width: 960 } as never }))
    expect(await renders.plan({ pod_id: 'p1', sequences: [SEQ] })).toMatchObject({ settings_source: 'pod', settings: { where: 'local', proxy_width: 960 } })   // the pod's own
    podconfigs.forget('p1')
    p = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy' }); expect(p.width).toBe('source')   // the proxy default, not the review's
  })
  it('start fills the same way: kind, width, codecs, pull and fps from the settings; explicit wins; a review still needs the named yes', async () => {
    put({ render: { ...D, where: 'pod', kind: 'review', review_width: 1280, codecs: ['prores422hq'], fps: 25, pull: false } as never })
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ] })).rejects.toThrow('A review video needs the name of who says yes')   // the setting does not carry an approver
    const a = await renders.start({ pod_id: 'p1', sequences: [SEQ], approved_by: 'Lucas' }); await renders.settled(); const j = renders.status(a.job_id).jobs[0]
    expect(j).toMatchObject({ kind: 'review', width: 1280, codecs: ['prores422hq'], approved_by: 'Lucas' })
    const b = await renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy', width: 960 }); await renders.settled(); expect(renders.status(b.job_id).jobs[0]).toMatchObject({ kind: 'proxy', width: 960 })
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy', fps: 0 })).rejects.toThrow(/fps is a number/)
  })
})

describe('the preferences of the Generate and Outputs windows (pull, publish, skip_existing, hide_empty_folders)', () => {
  it('defaults: pull OFF, publish s3 ON (slack OFF), skip existing ON, hide empty folders ON; a stored pull: true is kept; absent means off', () => {
    expect(mounts.defaults().render).toMatchObject({ pull: false, skip_existing: true, publish: { s3: true, slack: false } }); expect(mounts.defaults().outputs).toEqual({ hide_empty_folders: true })
    expect(mounts.normalize({ render: { pull: true } as never }).render!.pull).toBe(true); expect(mounts.normalize({ render: { kind: 'review' } as never }).render!.pull).toBe(false); expect(mounts.normalize({ outputs: {} as never }).outputs).toEqual({ hide_empty_folders: true })
    put({ render: { ...D, pull: true } }); expect(mounts.load().render!.pull).toBe(true)
  })
  it('validation: booleans only; Slack needs S3; publishing no longer needs Sync (a render that stayed on the pod is published from the volume)', () => {
    const v = (r: Record<string, unknown>) => () => mounts.validate(mounts.normalize({ render: { ...D, ...r } as never }))
    expect(v({ skip_existing: 'yes' })).toThrow(/render\.skip_existing/); expect(mounts.normalize({ render: { ...D, publish: { s3: 'x' } } as never }).render!.publish).toEqual({ s3: false, slack: false })   // junk is not a tick
    expect(v({ pull: true, publish: { s3: false, slack: true } })).toThrow(/Slack announces an upload: turn S3 on/)
    expect(v({ publish: { s3: true, slack: false } })).not.toThrow(); expect(v({ pull: true, publish: { s3: true, slack: true } })).not.toThrow(); expect(v({ where: 'local', publish: { s3: true, slack: false } })).not.toThrow()
    expect(() => mounts.validate(mounts.normalize({ outputs: { hide_empty_folders: 'no' } as never }))).toThrow(/outputs\.hide_empty_folders/); expect(mounts.put({ ...mounts.load(), outputs: { hide_empty_folders: false } }).config.outputs).toEqual({ hide_empty_folders: false })
  })
  it('a pod\'s own render block overrides (same merge rules); outputs is stripped from a pod configuration', () => {
    const cfg = mounts.normalize({ render: { ...D, pull: true, skip_existing: false, publish: { s3: true, slack: false } } as never, outputs: { hide_empty_folders: false } }); podconfigs.set('p1', cfg)
    expect(renders.effectiveSettings('p1')).toMatchObject({ pull: true, skip_existing: false, publish: { s3: true, slack: false } }); expect(podconfigs.get('p1')).not.toHaveProperty('outputs'); expect(renders.effectiveSettings()).toMatchObject({ skip_existing: true })
  })
  it('plan().settings carries them; start/plan fall back to skip_existing only when the request omits it; an explicit value wins; a start never publishes by configuration alone', async () => {
    put({ render: { ...D, where: 'local', skip_existing: false, pull: true, publish: { s3: true, slack: true } } })
    const p = await renders.plan({ sequences: [SEQ], width: 960, where: 'local' }); expect(p.settings).toMatchObject({ pull: true, skip_existing: false, publish: { s3: true, slack: true } }); expect(p.skip_existing).toBe(false)
    expect((await renders.plan({ sequences: [SEQ], width: 960, where: 'local', skip_existing: true })).skip_existing).toBe(true)
    put({ render: { ...D, skip_existing: true } }); expect((await renders.plan({ sequences: [SEQ], width: 960, where: 'local' })).skip_existing).toBe(true); expect((await renders.plan({ sequences: [SEQ], width: 960, where: 'local', skip_existing: false })).skip_existing).toBe(false)
  })
  it('export, import (kept: preferences, not privileges), undo and reset carry them', () => {
    put({ render: { ...D, pull: true, skip_existing: false, publish: { s3: true, slack: false } }, outputs: { hide_empty_folders: false } })
    const f = configio.exportConfig({ includeSecrets: false }); expect((f.config as Record<string, unknown>).render).toMatchObject({ pull: true, skip_existing: false, publish: { s3: true, slack: false } }); expect((f.config as Record<string, unknown>).outputs).toEqual({ hide_empty_folders: false })
    mounts.reset(); mounts.save(mounts.defaults()); expect(configio.planImport(f as never).errors).toEqual([]); configio.applyImport(f as never, { sections: ['pod_defaults'] })
    expect(mounts.load().render).toMatchObject({ pull: true, skip_existing: false, publish: { s3: true, slack: false } }); expect(mounts.load().outputs).toEqual({ hide_empty_folders: false })
    configio.undoImport(); expect(mounts.load().render).toMatchObject({ pull: false, skip_existing: true, publish: { s3: true, slack: false } }); expect(mounts.load().outputs).toEqual({ hide_empty_folders: true })
    put({ outputs: { hide_empty_folders: false } }); expect(mounts.reset().outputs).toEqual({ hide_empty_folders: true })
  })
})
