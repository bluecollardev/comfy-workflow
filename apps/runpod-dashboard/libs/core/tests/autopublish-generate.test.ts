import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as autogenerate from '../src/autogenerate.js'
import * as autopublish from '../src/autopublish.js'
import * as configio from '../src/configio.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as publish from '../src/publish.js'
import * as settingsEnv from '../src/settings.js'
import { mergeConfig } from '../../../mcp/app-tools.mjs'
import { scratch } from './helpers.js'

// ADR-050 "Auto-publish can generate the outputs too": only NEW, FINISHED sequences, the Generate window's own start, never an approval or a publish. Fakes only.
vi.setConfig({ testTimeout: 30_000 })
const MIN = 60_000
let dir: string, out: string, t: number, reqs: Record<string, unknown>[], jobState: Map<string, { state: string; error?: string }>, cancelled: string[], pod: string | null, startError: string | null, volRuns: { folder: string; files: { filename: string; modified?: string }[] }[], seq = 0
const clock = () => t
/** A sequence on this PC whose frames were written at `at` (ms). */
const frames = (dirRel: string, stem: string, n: number, at: number, ext = 'dpx') => {
  for (let i = 1; i <= n; i++) { const p = join(out, dirRel, `${stem}.${String(i).padStart(4, '0')}.${ext}`); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x'); utimesSync(p, new Date(at), new Date(at)) }
}
const gen = (g: Partial<mounts.AutoGenerateConfig> = {}) => autopublish.setSettings({ generate: { enabled: true, ...g } })
const pass = async () => { const r = await autopublish.generatePass(); return r.started }
const status = async () => (await autopublish.statusNow()).generate

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env')
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  t = Date.parse('2026-11-19T10:00:00Z'); reqs = []; jobState = new Map(); cancelled = []; pod = null; startError = null; volRuns = []; seq = 0
  publish.reset(); autopublish.reset(); mounts.save(mounts.defaults())
  publish.setDeps({ outputRoot: () => out, now: clock }); autopublish.setDeps({ now: clock, outputRoot: () => out })
  autogenerate.setDeps({ now: clock, outputRoot: () => out, runningPod: async () => pod, volumeListing: async () => volRuns,
    start: async (req) => { if (startError) throw new Error(startError); reqs.push(req); const id = `render-${seq++}`; jobState.set(id, { state: 'rendering' }); return { job_id: id } },
    status: (id) => jobState.get(id), cancel: (id) => { cancelled.push(id) } })
  await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true })
})
afterEach(() => { autopublish.reset(); publish.reset(); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('settings', () => {
  it('off by default; the settings are validated; a pod needs the approver\'s name; the baseline is recorded when it is switched on', async () => {
    expect((await autopublish.settings()).generate).toEqual({ enabled: false, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false, colour_in: null }); expect(await pass()).toBe(0)
    for (const [g, re] of [[{ where: 'cloud' }, /where/], [{ preset: 'x' }, /preset/], [{ settle_minutes: 0 }, /settle_minutes/], [{ settle_minutes: 121 }, /settle_minutes/], [{ max_per_day: -3 }, /max_per_day/], [{ max_per_day: 2.5 }, /max_per_day/]] as [Record<string, unknown>, RegExp][]) await expect(autopublish.setSettings({ generate: g as never })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(re) })
    await expect(autopublish.setSettings({ generate: { where: 'pod' } })).rejects.toMatchObject({ status: 400, message: "Rendering on a pod spends money: put the approver's name" })
    const s = await autopublish.setSettings({ approved_by: 'Lucas', generate: { enabled: true, where: 'pod', preset: 'tunnel', max_per_day: 0, settle_minutes: 2, fallback_local: true } }); expect(s.generate).toMatchObject({ enabled: true, where: 'pod', preset: 'tunnel', max_per_day: null, settle_minutes: 2, fallback_local: true, enabled_at: new Date(t).toISOString() })
    const off = await autopublish.setSettings({ generate: { enabled: false } }); expect(off.generate.enabled).toBe(false); expect(off.generate.enabled_at).toBeUndefined()
  })
  it('a configuration save to a pod needs auto_publish.approved_by in the same save (400 without it, recorded in the History, never stored)', async () => {
    const base = mounts.load(), save = (ap: Record<string, unknown>) => mounts.put({ ...base, auto_publish: { ...base.auto_publish, ...ap } as never })
    expect(() => save({ generate: { ...base.auto_publish!.generate, where: 'pod' } })).toThrow("Rendering on a pod spends money: put the approver's name"); expect(() => save({ approved_by: '  ', generate: { ...base.auto_publish!.generate, where: 'pod' } })).toThrow(/approver's name/)
    expect(save({ approved_by: 'Lucas', generate: { ...base.auto_publish!.generate, where: 'pod' } }).config.auto_publish!.generate.where).toBe('pod'); expect(Object.keys(mounts.load().auto_publish!)).not.toContain('approved_by')
    const { history } = await import('../src/history.js').then((h) => ({ history: h })); expect(history.list({ limit: 10 }).some((e) => e.kind === 'change' && e.action === 'auto-generate set to render on a pod' && e.approved_by === 'Lucas')).toBe(true)
    expect(() => save({ generate: { ...mounts.load().auto_publish!.generate, settle_minutes: 7 } })).not.toThrow()   // already pod: a later save needs no new name
  })
  it('Default Configuration only: stripped from a pod\'s own configuration; an import keeps it; the MCP may set it but not where: pod', async () => {
    await gen({ settle_minutes: 9 }); podconfigs.set('pZ', mounts.normalize({ auto_publish: { generate: { enabled: true, where: 'pod' } } as never })); expect(JSON.stringify(podconfigs.get('pZ'))).not.toMatch(/generate/)
    const f = configio.exportConfig({ includeSecrets: false }); mounts.save(mounts.defaults()); configio.applyImport(f as never, { sections: ['pod_defaults'] }); expect(mounts.load().auto_publish!.generate).toMatchObject({ enabled: false, where: 'local', settle_minutes: 9 });   // an import never switches on spend: generate comes in OFF, a pod becomes this PC
     expect(mounts.load().auto_publish!.generate.enabled_at).toBeUndefined()   // the baseline is this PC's own
    expect(mergeConfig(mounts.load(), { auto_publish: { generate: { settle_minutes: 12, max_per_day: 3 } } }).auto_publish.generate).toMatchObject({ settle_minutes: 12, max_per_day: 3 })
    expect(() => mergeConfig(mounts.load(), { auto_publish: { generate: { where: 'pod' } } })).toThrow(/Rendering on a pod spends money: put the approver's name/); expect(mergeConfig(mounts.load(), { auto_publish: { generate: { where: 'local' } } })).toBeDefined()
  })
})

describe('what it renders', () => {
  it('only NEW sequences: frames older than the switch-on are never rendered; new ones wait to settle (a change restarts the wait), then start with the Generate window\'s own request', async () => {
    frames('proxy_v004/old', 'ARCHIVAL-050_MAIN', 5, t - 60 * MIN); await gen({ settle_minutes: 5 }); expect(await pass()).toBe(0)
    t += MIN; frames('proxy_v004/new', 'ARCHIVAL-085_MAIN', 4, t); expect(await pass()).toBe(0)
    let st = await status(); expect(st.waiting_to_settle.map((w) => [w.stem, w.shot])).toEqual([['ARCHIVAL-085_MAIN', 'ARCHIVAL-085_MAIN']]); expect(st.generating).toBe(0)
    t += 4 * MIN; frames('proxy_v004/new', 'ARCHIVAL-085_MAIN', 5, t); expect(await pass()).toBe(0)   // another frame arrived: the wait starts again
    t += 4 * MIN; expect(await pass()).toBe(0); t += 2 * MIN; expect(await pass()).toBe(1)
    expect(reqs).toEqual([{ sequences: [{ dir: 'proxy_v004/new', name: 'ARCHIVAL-085_MAIN', first: 1, last: 5, frames: 5, pad: 4 }], kind: 'review', where: 'local', approved_by: 'Lucas', skip_existing: true, trigger: 'auto-publish' }])
    expect(await pass()).toBe(0); expect(reqs).toHaveLength(1); st = await status(); expect(st).toMatchObject({ generating: 1, generated_today: 1, enabled: true, where: 'local', preset: 'review', max_per_day: 20 }); expect(st.waiting_to_settle).toEqual([])
    expect((await autopublish.statusNow()).watching.summary).toMatch(/Auto-generate is on \(local\): 0 waiting to settle, 1 rendering, 1 started today\./)
  })
  it('the Tunnel preset renders a proxy with the preset; never deliver/, .proxies, a models folder, a weights folder, projects/desktop or a name without a shot', async () => {
    await gen({ preset: 'tunnel', settle_minutes: 1 }); t += MIN
    frames('proxy/ok', 'DEPTH-105_main', 2, t); frames('deliver/x/v001', 'ARCHIVAL-001_a', 2, t); frames('.proxies/x', 'ARCHIVAL-002_a', 2, t); frames('models/x', 'ARCHIVAL-003_a', 2, t); frames('projects/desktop/CANALV2', 'ARCHIVAL-004_a', 2, t); frames('misc', 'holiday_snap', 2, t)
    frames('wt', 'ARCHIVAL-005_a', 2, t); writeFileSync(join(out, 'wt', 'big.safetensors'), 'w'); utimesSync(join(out, 'wt', 'big.safetensors'), new Date(t), new Date(t))
    await pass(); t += 2 * MIN; expect(await pass()).toBe(1); expect(reqs[0]).toMatchObject({ kind: 'proxy', preset: 'tunnel', sequences: [{ dir: 'proxy/ok', name: 'DEPTH-105_main' }] })
  })
  it('skip existing: a sequence that already has its review is not an error and not counted', async () => {
    await gen({ settle_minutes: 1 }); t += MIN; frames('a', 'ARCHIVAL-085_MAIN', 3, t); await pass(); t += 2 * MIN; startError = 'Everything in this scope is already rendered: untick Skip existing to render again'; expect(await pass()).toBe(0)
    const st = await status(); expect(st).toMatchObject({ generated_today: 0, failed: [], generating: 0 }); startError = null; expect(await pass()).toBe(0)   // remembered as done
  })
  it('never approves and never publishes: the request has no publish field, and no approval record appears', async () => {
    await gen({ settle_minutes: 1 }); t += MIN; frames('a', 'ARCHIVAL-085_MAIN', 3, t); await pass(); t += 2 * MIN; await pass(); expect(reqs[0]).not.toHaveProperty('publish'); expect(await autopublish.approvals()).toEqual([]); expect(publish.status().jobs).toEqual([])
  })
})

describe('where, the cap, retries, off', () => {
  it('local costs nothing; a pod renders only on a RUNNING pod, one at a time; with none it waits, or falls back to this PC when asked', async () => {
    await autopublish.setSettings({ approved_by: 'Lucas', generate: { enabled: true, where: 'pod', settle_minutes: 1 } })
    const at = t + MIN; t = at; volRuns = [{ folder: 'proxy/a', files: [1, 2, 3].map((i) => ({ filename: `ARCHIVAL-085_MAIN.000${i}.dpx`, modified: new Date(at).toISOString().slice(0, 19) })) }, { folder: 'proxy/b', files: [1, 2].map((i) => ({ filename: `ARCHIVAL-086_MAIN.000${i}.dpx`, modified: new Date(at).toISOString().slice(0, 19) })) }]
    await pass(); t += 2 * MIN; expect(await pass()).toBe(0); expect((await status()).waiting_for_pod).toBe(true); expect(reqs).toEqual([])
    pod = 'pod-run'; expect(await pass()).toBe(1); expect(reqs[0]).toMatchObject({ where: 'pod', pod_id: 'pod-run', pull: false, kind: 'review', sequences: [{ dir: 'proxy/a', name: 'ARCHIVAL-085_MAIN' }] }); expect(await pass()).toBe(0)   // one pod render at a time   // Auto-publish reads the volume: an automatic render is not copied to this PC
    jobState.set('render-0', { state: 'done' }); expect(await pass()).toBe(1); expect(reqs[1]).toMatchObject({ pod_id: 'pod-run', sequences: [{ name: 'ARCHIVAL-086_MAIN' }] })
    autogenerate.reset(); autogenerate.setDeps({ now: clock, outputRoot: () => out, runningPod: async () => null, volumeListing: async () => volRuns, start: async (r) => { reqs.push(r); return { job_id: 'x1' } }, status: () => undefined, cancel: () => undefined })
    await autopublish.setSettings({ generate: { fallback_local: true } }); reqs.length = 0; await pass(); t += 2 * MIN; await pass(); expect(reqs[0]).toMatchObject({ where: 'local' }); expect(reqs[0]).not.toHaveProperty('pod_id')
  })
  it('max_per_day counts started renders of the local day; the next day goes on', async () => {
    await gen({ settle_minutes: 1, max_per_day: 2 }); t += MIN; for (const n of ['085', '086', '087']) frames(`s${n}`, `ARCHIVAL-${n}_MAIN`, 2, t)
    await pass(); t += 2 * MIN; expect(await pass()).toBe(2); for (const id of ['render-0', 'render-1']) jobState.set(id, { state: 'done' }); expect(await pass()).toBe(0); expect((await status()).generated_today).toBe(2)
    t = Date.parse('2026-11-20T09:00:00'); expect(await pass()).toBe(1); expect((await status()).generated_today).toBe(1); expect(reqs.map((r) => (r.sequences as { name: string }[])[0].name).sort()).toEqual(['ARCHIVAL-085_MAIN', 'ARCHIVAL-086_MAIN', 'ARCHIVAL-087_MAIN'])
  })
  it('a failed render is tried at most twice more, then listed with its reason; a start that throws is the same', async () => {
    await gen({ settle_minutes: 1 }); t += MIN; frames('a', 'ARCHIVAL-085_MAIN', 2, t); await pass(); t += 2 * MIN; await pass()
    for (let i = 0; i < 3; i++) { jobState.set(`render-${i}`, { state: 'failed', error: 'ffmpeg failed (exit 1)' }); await pass(); t += 21 * MIN; await pass() }   // each retry waits (5 minutes, then 20)
    expect(reqs).toHaveLength(3); const st = await status(); expect(st.failed).toEqual([{ stem: 'ARCHIVAL-085_MAIN', reason: 'ffmpeg failed (exit 1)' }]); expect(await pass()).toBe(0); expect(reqs).toHaveLength(3)
    frames('b', 'ARCHIVAL-090_MAIN', 2, t); await pass(); t += 2 * MIN; startError = 'No pod'; for (let i = 0; i < 4; i++) { await pass(); t += 21 * MIN }; await pass(); expect((await status()).failed.map((f) => f.stem).sort()).toEqual(['ARCHIVAL-085_MAIN', 'ARCHIVAL-090_MAIN'])
  })
  it('Off cancels the renders it started; turning generating off stops it', async () => {
    await gen({ settle_minutes: 1 }); t += MIN; frames('a', 'ARCHIVAL-085_MAIN', 2, t); await pass(); t += 2 * MIN; await pass(); expect((await status()).generating).toBe(1)
    await autopublish.offCount(); expect(cancelled).toEqual(['render-0']); expect((await status()).generating).toBe(0); expect(await pass()).toBe(0)
  })
})

describe('async and quiet', () => {
  it('autogenerate.ts has no synchronous file or process calls; a 5,000-frame tree is scanned without holding the event loop', async () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'src', 'autogenerate.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); expect(src.match(/\b(spawnSync|execSync|readFileSync|writeFileSync|statSync|readdirSync|existsSync|lstatSync)\b/g) ?? []).toEqual([])
    await gen({ settle_minutes: 1 }); t += MIN; for (let k = 0; k < 5; k++) frames(`big/s${k}`, `ARCHIVAL-30${k}_MAIN`, 1000, t)
    let worst = 0, last = performance.now(); const tm = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1); await pass(); clearInterval(tm); expect(worst).toBeLessThan(600); expect((await status()).waiting_to_settle).toHaveLength(5)
  })
})

describe('Generate for what is already there (ADR-050): a one-time, confirmed action; and holds', () => {
  const old = () => t - 60 * MIN
  it('PREVIEW lists settled, named sequences and skips the rest with reasons; nothing starts; frames older than the switch-on are allowed (enabled_at is ignored)', async () => {
    frames('proxy_v004/a', 'ARCHIVAL-050_MAIN', 3, old()); frames('proxy_v004/b', 'ARCHIVAL-051_MAIN', 2, t - MIN); frames('proxy_v004/c', 'unnamed', 2, old())
    const p = await autopublish.generateExisting({})   // no confirm: a preview
    expect(reqs).toHaveLength(0); expect(p).toMatchObject({ dry_run: true, where: 'local', preset: 'review', max_per_day: 20, today_started: 0, can_start_today: 1, remaining_after_today: 0, pod: null, totals: { sequences: 1, frames: 3 } })
    expect(p.sequences).toEqual([expect.objectContaining({ stem: 'ARCHIVAL-050_MAIN', shot: 'ARCHIVAL-050_MAIN', clip: 'ARCHIVAL-050_MAIN', frames: 3, source: 'local', flags: expect.any(Array) })]); expect(p.skipped.map((x) => [x.stem, x.reason])).toEqual([['ARCHIVAL-051_MAIN', 'not settled yet'], ['unnamed', 'no shot or clip name']])
    expect(p.notes.join(' ')).toMatch(/USD 100/)
  })
  it('RUN starts them as ordinary renders within max_per_day and carries the rest as pending_existing; limit; a pod needs the approver, a running pod and never starts one', async () => {
    for (const n of [50, 51, 52]) frames(`proxy_v004/s${n}`, `ARCHIVAL-0${n}_MAIN`, 2, old())
    await autopublish.setSettings({ generate: { max_per_day: 2 } })
    const r = await autopublish.generateExisting({ confirm: true, approved_by: 'Lucas' }); expect(r).toMatchObject({ dry_run: false, started: 2, deferred: 1 }); expect(reqs).toHaveLength(2); expect(reqs[0]).toMatchObject({ kind: 'review', where: 'local', skip_existing: true, trigger: 'auto-publish', approved_by: 'Lucas' })
    expect((await status()).pending_existing).toBe(1); expect((await status()).existing_started).toBe(2)
    await autopublish.off(); expect((await status()).pending_existing).toBe(0)   // Off clears what was carried over
    await autopublish.setSettings({ approved_by: 'Lucas', understood: true, generate: { where: 'pod', fallback_local: false } })
    await expect(autopublish.generateExisting({ confirm: true })).rejects.toMatchObject({ status: 400, message: "Rendering on a pod spends money: put the approver's name" })
    await expect(autopublish.generateExisting({ confirm: true, approved_by: 'Lucas' })).rejects.toMatchObject({ status: 409, message: 'No pod is running: it never starts one' })
  })
  it('holds: a held version is never auto-published and is listed; release removes the hold; the hold is recorded', async () => {
    expect((await autopublish.holds()).holds).toEqual([]); expect(await autopublish.hold({ shot: 'archival-050', version: 'v001' })).toMatchObject({ held: true }); expect((await autopublish.holds()).holds).toEqual([{ shot: 'archival-050', version: 'v001' }])
    expect((await autopublish.eligibility('archival-050', 'v001')).reason).toBe('held by a person'); expect(await autopublish.release({ shot: 'archival-050', version: 'v001' })).toEqual({ released: true }); expect((await autopublish.holds()).holds).toEqual([])
    expect((await autopublish.release({ shot: 'archival-050', version: 'v001' })).released).toBe(false)
  })
})

describe('a stated colour for auto-generate (policy/colour.md)', () => {
  it('a render refused because the colour is not stated is SKIPPED with a visible reason and a code, once (never retried in a loop); with generate.colour_in set the stated colour is passed; saving it needs the name and is recorded; the waiting list names its source', async () => {
    frames('proxy_v004/a', 'ARCHIVAL-060_MAIN', 3, t + 1000); await gen({ settle_minutes: 1 })
    await pass(); t += 2 * MIN; await pass(); expect((await status()).waiting_to_settle).toEqual([]) // settled at the second look: it starts
    expect(reqs).toHaveLength(1); expect(reqs[0]).not.toHaveProperty('colour_in'); jobState.set('render-0', { state: 'failed', error: 'transfer: linear (code 2): the frames say linear in their DPX header. State the colour of these frames (Generate window: Colour).' })
    await pass(); await pass(); expect(reqs).toHaveLength(1); const st = await status(); expect(st.skipped).toEqual([{ stem: 'ARCHIVAL-060_MAIN', reason: 'colour not stated: set it in Auto-publish > Generate', code: 'colour-not-stated' }]); expect(st.failed).toEqual([])
    await expect(autopublish.setSettings({ generate: { colour_in: 'linear-p3-d65' } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Stating the colour of frames is a person's act/) })
    await expect(autopublish.setSettings({ approved_by: 'Lucas', generate: { colour_in: 'nope' } })).rejects.toMatchObject({ status: 400 })
    expect((await autopublish.setSettings({ approved_by: 'Lucas', generate: { colour_in: 'linear-p3-d65' } })).generate.colour_in).toBe('linear-p3-d65')
    const { default: history } = { default: await import('../src/history.js') }; expect(history.list({ limit: 20 }).some((e) => e.action === 'auto-generate colour stated' && /linear-p3-d65.*Lucas/.test(String(e.detail)))).toBe(true)
    frames('proxy_v004/b', 'ARCHIVAL-061_MAIN', 3, t + 1000); await pass(); t += 2 * MIN; await pass(); expect(reqs[reqs.length - 1]).toMatchObject({ colour_in: 'linear-p3-d65' })
    frames('proxy_v004/c', 'ARCHIVAL-062_MAIN', 3, t + 1000); await pass(); expect((await status()).waiting_to_settle).toEqual([expect.objectContaining({ stem: 'ARCHIVAL-062_MAIN', source: 'local' })])
  })
})

describe('settling: one row per sequence, the wait persists and only restarts when the frames change', () => {
  const vol = (folder: string, stem: string, ns: number[], at: string) => ({ folder, files: ns.map((n) => ({ filename: `${stem}.${String(n).padStart(4, '0')}.dpx`, modified: at })) })
  it('a folder split over two listed runs (and a file listed twice) is ONE candidate with the right count; the same count and newest time keep `since`; a restart does not forget it; a change resets it; it settles after settle_minutes', async () => {
    await autopublish.setSettings({ approved_by: 'Lucas', generate: { enabled: true, where: 'pod', fallback_local: true, settle_minutes: 5, colour_in: 'linear-p3-d65' } }); pod = null
    const at = new Date(t - 30 * MIN).toISOString(); volRuns = [vol('proxy_v004/x', 'DEPTH-182_main_mono_v015', [1, 2, 3], at), vol('proxy_v004/x', 'DEPTH-182_main_mono_v015', [3, 4, 5, 6], at)]
    // the first look sets the baseline for enabled_at; make the listing newer than it
    t += MIN; volRuns = volRuns.map((r) => ({ ...r, files: r.files.map((f) => ({ ...f, modified: new Date(t).toISOString() })) })); await pass()
    let w = (await status()).waiting_to_settle; expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ stem: 'DEPTH-182_main_mono_v015', source: 'volume', frames: 6, seen: 1 }); const since = w[0].since
    t += 2 * MIN; await pass(); t += MIN; await pass(); w = (await status()).waiting_to_settle; expect(w).toHaveLength(1); expect(w[0]).toMatchObject({ since, frames: 6, seen: 3 }); expect(w[0].changing).toBeUndefined()   // the same since, however many looks
    autogenerate.reset(); autogenerate.setDeps({ now: clock, outputRoot: () => out, runningPod: async () => pod, volumeListing: async () => volRuns, start: async (req) => { reqs.push(req); const id = `render-${seq++}`; jobState.set(id, { state: 'rendering' }); return { job_id: id } }, status: (id) => jobState.get(id), cancel: (id) => { cancelled.push(id) } }); await pass(); w = (await status()).waiting_to_settle; expect(w[0].since).toBe(since); expect(w[0].seen).toBeGreaterThanOrEqual(3)   // a restart: read back from the state
    volRuns = [vol('proxy_v004/x', 'DEPTH-182_main_mono_v015', [1, 2, 3, 4, 5, 6, 7], new Date(t).toISOString())]; await pass(); w = (await status()).waiting_to_settle; expect(w[0]).toMatchObject({ frames: 7, seen: 1, changing: true }); expect(w[0].since).not.toBe(since)   // changed: the wait starts again
    t += 2 * MIN; await pass(); expect(reqs).toHaveLength(0); t += 4 * MIN; await pass(); expect(reqs).toHaveLength(1); expect((await status()).waiting_to_settle).toEqual([]); expect(reqs[0]).toMatchObject({ where: 'local', colour_in: 'linear-p3-d65' })   // settled: rendered (fallback_local), with the stated colour
  })
})

describe('gaps, retries, one job per stem and the colour check (fake clock)', () => {
  const setup = async (g: Record<string, unknown> = {}) => { await autopublish.setSettings({ approved_by: 'Lucas', generate: { enabled: true, settle_minutes: 1, ...g } }) }
  it('a sequence with gaps is never started: it waits with a reason in waiting_to_settle (not failed), and starts once the gap is filled and it has settled again', async () => {
    await setup(); const f = (ns: number[], at: number) => { for (const n of ns) { const p = join(out, 'proxy_v004/g', `GAP-001_MAIN.${String(n).padStart(4, '0')}.dpx`); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, 'x'); utimesSync(p, new Date(at), new Date(at)) } }
    t += MIN; f([1, 2, 5, 6], t); await pass(); t += 3 * MIN; await pass(); await pass(); expect(reqs).toHaveLength(0)
    const w = (await status()).waiting_to_settle; expect(w).toEqual([expect.objectContaining({ stem: 'GAP-001_MAIN', frames: 4, reason: 'incomplete: 1 gaps, waiting for more frames' })]); expect((await status()).failed).toEqual([])
    t += MIN; f([3, 4], t); await pass(); t += 2 * MIN; await pass(); expect(reqs).toHaveLength(1)   // gap filled, changed, settled again: now
  })
  it('a render that comes back "Incomplete: ... (6 gaps)" is recorded, not retried, until the frames change and settle; a real failure is retried after 5 minutes then 20, never in the same pass; two jobs for the same stem are never started together', async () => {
    await setup(); t += MIN; frames('proxy_v004/a', 'ARCHIVAL-070_MAIN', 3, t); await pass(); t += 2 * MIN; await pass(); expect(reqs).toHaveLength(1)
    jobState.set('render-0', { state: 'failed', error: 'Incomplete: frames 85-118, 153-220 are missing (6 gaps)' }); await pass(); await pass(); t += 30 * MIN; await pass(); expect(reqs).toHaveLength(1)
    expect((await status()).waiting_to_settle).toEqual([expect.objectContaining({ reason: 'incomplete: 6 gaps, waiting for more frames' })]); expect((await status()).failed).toEqual([])
    frames('proxy_v004/a', 'ARCHIVAL-070_MAIN', 4, t); await pass(); t += 2 * MIN; await pass(); expect(reqs).toHaveLength(2)   // changed and settled
    jobState.set('render-1', { state: 'failed', error: 'ffmpeg failed (exit 1)' }); await pass(); await pass(); expect(reqs).toHaveLength(2)   // backing off: not in the same minute
    t += 6 * MIN; await pass(); expect(reqs).toHaveLength(3); jobState.set('render-2', { state: 'failed', error: 'ffmpeg failed (exit 1)' }); t += 6 * MIN; await pass(); expect(reqs).toHaveLength(3); t += 20 * MIN; await pass(); expect(reqs).toHaveLength(4)   // 5 minutes, then 20
    // the same stem in two folders: one job at a time
    frames('proxy_v004/b', 'ARCHIVAL-071_MAIN', 3, t); frames('proxy_v004/c', 'ARCHIVAL-071_MAIN', 3, t); await pass(); t += 2 * MIN; const before = reqs.length; await pass(); expect(reqs.length - before).toBe(1)
  })
  it('log or linear frames with generate.colour_in null are SKIPPED before any job starts (code colour-not-stated); with it set they start', async () => {
    autogenerate.setDeps({ transferOf: async () => 2 }); await setup(); t += MIN; frames('proxy_v004/l', 'ARCHIVAL-072_MAIN', 3, t); await pass(); t += 2 * MIN; await pass()
    expect(reqs).toHaveLength(0); expect((await status()).skipped).toEqual([{ stem: 'ARCHIVAL-072_MAIN', reason: 'colour not stated: set it in Auto-publish > Generate', code: 'colour-not-stated' }])
    autogenerate.reset(); autogenerate.setDeps({ now: clock, outputRoot: () => out, runningPod: async () => pod, volumeListing: async () => volRuns, transferOf: async () => 2, start: async (req) => { reqs.push(req); const id = `render-${seq++}`; jobState.set(id, { state: 'rendering' }); return { job_id: id } }, status: (id) => jobState.get(id), cancel: (id) => { cancelled.push(id) } })
    await autopublish.setSettings({ approved_by: 'Lucas', generate: { colour_in: 'linear-p3-d65' } }); await pass(); t += 2 * MIN; await pass(); expect(reqs).toHaveLength(1); expect(reqs[0]).toMatchObject({ colour_in: 'linear-p3-d65' })
  })
})
