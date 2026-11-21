import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as autogenerate from '../src/autogenerate.js'
import * as autopublish from '../src/autopublish.js'
import * as configio from '../src/configio.js'
import * as edl from '../src/edl.js'
import * as mounts from '../src/mounts.js'

// The scope rule (ADR-050 amendment, 2026-11-21): with scope `edl` only elements of the loaded EDL are generated or queued.
let dir = '', t = 0
const clock = () => t
const EDL_TEXT = [
  'TITLE: T', 'FCM: NON-DROP FRAME', '',
  '001  ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ V     C        00:00:00:00 00:00:02:00 01:00:00:00 01:00:02:00',
  '002  CGI-072_HEAD_FINAL_V02_1920X1080_23.976_PRORES422HQ V     C        00:00:00:00 00:00:02:00 01:00:02:00 01:00:04:00',
  '003  PHOTOREAL-013_TOP_FINAL_V02_1920X1080_24_PRORES422HQ V     C        00:00:00:00 00:00:02:00 01:00:04:00 01:00:06:00',
].join('\n')
async function loadEdl(): Promise<void> {
  const file = join(dir, 'x.edl'); writeFileSync(file, EDL_TEXT)
  const st = await edl.load({ source: { file } }); expect(st.loaded).toBe(true); expect(st.elements).toBe(3)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'scope-')); process.env.POD_MANAGER_CONFIG_DIR = dir; process.env.POD_MANAGER_BACKUPS_DIR = join(dir, 'backups')
  t = Date.parse('2026-11-21T10:00:00Z'); edl.reset(); autopublish.reset(); mounts.save(mounts.defaults())
})
afterEach(() => { edl.reset(); autopublish.reset(); delete process.env.POD_MANAGER_CONFIG_DIR; delete process.env.POD_MANAGER_BACKUPS_DIR; rmSync(dir, { recursive: true, force: true }) })

describe('the scope setting', () => {
  it('defaults to edl, accepts edl and all, refuses anything else', async () => {
    expect(mounts.defaults().auto_publish!.scope).toBe('edl')
    expect(mounts.normalize({ auto_publish: { scope: 'nonsense' } as never }).auto_publish!.scope).toBe('edl')   // an old or bad value is the safe one
    expect(mounts.normalize({} as never).auto_publish!.scope).toBe('edl')
    await expect(autopublish.setSettings({ scope: 'x' as never })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/scope/) })
    expect((await autopublish.setSettings({ scope: 'all' })).scope).toBe('all'); expect((await autopublish.setSettings({ scope: 'edl' })).scope).toBe('edl')
    expect(() => mounts.validateAutoPublish({ ...mounts.defaults().auto_publish!, scope: 'x' as never })).toThrow(/scope/)
  })
  it('is carried by export and import', async () => {
    await autopublish.setSettings({ scope: 'all' })
    const f = configio.exportConfig({ includeSecrets: false })
    expect(JSON.stringify(f)).toContain('"scope":"all"')
    mounts.save(mounts.defaults()); expect((await autopublish.settings()).scope).toBe('edl')
    configio.applyImport(f as never, { sections: ['pod_defaults'] }); expect((await autopublish.settings()).scope).toBe('all')
  })
})

describe('scopeReason (the rule Auto-publish applies to a review)', () => {
  const rv = (shot: string, ...names: string[]) => ({ shot, files: names.map((name) => ({ name })) })
  it('no EDL loaded: nothing is in scope, with the reason; scope all is as before', async () => {
    expect(await autopublish.scopeReason('edl', rv('archival-071', 'ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ.mov'))).toBe('no EDL loaded')
    expect(await autopublish.scopeReason('all', rv('archival-071', 'x.mov'))).toBe('')
  })
  it('an element of the EDL is in scope; assembly, map-066 and chasmfastia2 style names are not', async () => {
    await loadEdl()
    expect(await autopublish.scopeReason('edl', rv('archival-071', 'ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ.mov', 'DELIVERY.md'))).toBe('')
    expect(await autopublish.scopeReason('edl', rv('cgi-072', 'CGI-072_HEAD_FINAL_V02_1920X1080_23.976_PRORES422HQ.mp4'))).toBe('')
    expect(await autopublish.scopeReason('edl', rv('archival-071', 'archival-071_main_mono_v015_NOT_RELEASED.mov'))).toBe('')   // the first-pass name still carries shot and element
    expect(await autopublish.scopeReason('edl', rv('photoreal-013', 'PHOTOREAL-013_TOP_FINAL_V02_1920X1080_24_PRORES422HQ.mov'))).toBe('')
    expect(await autopublish.scopeReason('edl', rv('archival-080', 'ARCHIVAL-080_ASSEMBLY_01112706_NAME-PLACEHOLDER_v024_NOT_RELEASED.mov'))).toBe('not in the EDL')
    expect(await autopublish.scopeReason('edl', rv('map-066', 'MAP-066_ASSEMBLY_FINAL_V01_1920X1080_23.976_PRORES422HQ_mono_v016.mov'))).toBe('not in the EDL')
    expect(await autopublish.scopeReason('edl', rv('photoreal-013', 'PHOTOREAL-013_CHASMFASTIA2_FINAL_V01_1920X1080_24_HEVC.mov'))).toBe('not in the EDL')
    expect(await autopublish.scopeReason('all', rv('map-066', 'MAP-066_ASSEMBLY_x.mov'))).toBe('')
  })
})

describe('Auto-generate honours the scope', () => {
  // a volume listing is runs of { folder, files }; ten settled frames (written an hour ago) per sequence
  const cand = (stem: string) => ({ folder: `output/delivery/${stem}`, files: Array.from({ length: 10 }, (_, i) => ({ filename: `${stem}.${String(i).padStart(4, '0')}.dpx`, modified: '2026-11-21T09:00:00' })) })   // fixed: a changing time would restart the settle wait on every look
  const gen = () => ({ enabled: true, where: 'pod' as const, preset: 'review' as const, max_per_day: 20, settle_minutes: 1, fallback_local: false, colour_in: 'p3-d65-gamma26' as string | null, enabled_at: new Date(t - 7_200_000).toISOString() })
  async function run(scope: 'edl' | 'all', stems: string[], withEdl: boolean) {
    autogenerate.reset(); if (withEdl) await loadEdl(); else edl.reset()
    const started: string[] = []
    autogenerate.setDeps({ now: clock, outputRoot: () => dir, runningPod: async () => 'pod1', volumeListing: async () => stems.map(cand) as never,
      start: (async (req: { sequences: { name: string }[] }) => { started.push(req.sequences[0].name); return { job_id: `j-${started.length}` } }) as never, status: (() => undefined) as never, cancel: () => undefined })
    await autogenerate.pass(gen() as never, 'Lucas', undefined, scope); t += 120_000; await autogenerate.pass(gen() as never, 'Lucas', undefined, scope)
    return { started, skipped: autogenerate.status(gen() as never).skipped }
  }
  it('renders in-EDL sequences only and lists the rest with the reason', async () => {
    const r = await run('edl', ['ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ', 'ARCHIVAL-080_ASSEMBLY_01112706_v024', 'MAP-066_ASSEMBLY_FINAL_V01'], true)
    expect(r.started).toEqual(['ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ'])
    expect(r.skipped.map((x) => [x.stem, x.reason, x.code]).sort()).toEqual([['ARCHIVAL-080_ASSEMBLY_01112706_v024', 'not in the EDL', 'not-in-edl'], ['MAP-066_ASSEMBLY_FINAL_V01', 'not in the EDL', 'not-in-edl']])
  })
  it('no EDL loaded: nothing is rendered, the reason says so; scope all renders as before', async () => {
    const r1 = await run('edl', ['ARCHIVAL-071_MAIN_FINAL_V02_3840X2160_23.976_PRORES422HQ'], false)
    expect(r1.started).toEqual([]); expect(r1.skipped[0]).toMatchObject({ reason: 'no EDL loaded', code: 'no-edl' })
    const r2 = await run('all', ['ARCHIVAL-080_ASSEMBLY_01112706_v024'], false)
    expect(r2.started).toEqual(['ARCHIVAL-080_ASSEMBLY_01112706_v024']); expect(r2.skipped).toEqual([])
  })
})
