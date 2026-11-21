import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as autochunk from '../src/autochunk.js'
import * as chunkrecord from '../src/chunkrecord.js'
import * as graphchunks from '../src/graphchunks.js'
import * as jobsregistry from '../src/jobsregistry.js'
import * as mounts from '../src/mounts.js'
import * as reattach from '../src/reattach.js'
import * as runflows from '../src/runflows.js'
import * as runsplit from '../src/runsplit.js'
import { scratch } from './helpers.js'

// ADR-056, "Ranges and splitting one element across pods": a run limited to a frame range keeps the numbering absolute and the pad clamped by the whole window, so ranges rendered on
// different pods into one folder meet exactly where one run would have put its seams; run_split cuts the window, runs the ranges at once, retries a failed one alone and checks the union.
const GiB = 2 ** 30
let dir: string
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_MANAGER_CONFIG_DIR = dir
  delete process.env.CHUNKED_RUNS; autochunk.resetMemory(); chunkrecord.setDeps(null); jobsregistry.reset(); runsplit.reset()
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg)
})
afterEach(() => { delete process.env.POD_MANAGER_CONFIG_DIR; chunkrecord.setDeps(null); jobsregistry.reset(); runsplit.setDeps(null); runsplit.reset() })

const strip = (cs: graphchunks.GraphChunk[]) => cs.map(({ n: _n, ...c }) => c)

describe('planRange: absolute numbering, pad clamped by the whole window', () => {
  const win = { first: 88, last: 720, startNumber: 0 }   // f23: 633 frames
  it('a range at the front: no pad before the window, pad past the range end', () => {
    const cs = graphchunks.planRange(win, { first: 88, last: 237 }, 50, 8)
    expect(cs.map((c) => [c.first, c.last, c.readFirst, c.readLast, c.startNumber])).toEqual([[88, 137, 88, 145, 0], [138, 187, 130, 195, 50], [188, 237, 180, 245, 100]])
  })
  it('a range in the middle: it reads its neighbours` frames either side and numbers by the whole window', () => {
    const cs = graphchunks.planRange(win, { first: 238, last: 387 }, 50, 8)
    expect(cs[0]).toMatchObject({ first: 238, last: 287, readFirst: 230, readLast: 295, startNumber: 150 })   // 8 frames of the range before it, as inside one run
    expect(cs.at(-1)).toMatchObject({ first: 338, last: 387, readFirst: 330, readLast: 395, startNumber: 250 })
  })
  it('a range at the end stops at the window and its last file number is the element`s last', () => {
    const cs = graphchunks.planRange(win, { first: 538, last: 720 }, 50, 8)
    expect(cs.at(-1)).toMatchObject({ first: 688, last: 720, readLast: 720, startNumber: 600 })
    expect(cs.at(-1)!.startNumber + (cs.at(-1)!.last - cs.at(-1)!.first)).toBe(632)
  })
  it('three ranges from splitRanges: their chunks are exactly the chunks of one run, in the same places, with no overlap', () => {
    const one = graphchunks.planGraphChunks(win, 50, 8)
    const parts = graphchunks.splitRanges(win, 3, 50)
    const many = parts.flatMap((r) => graphchunks.planRange(win, r, 50, 8))
    expect(strip(many)).toEqual(strip(one))   // same windows, same reads, same start numbers: the seams match a single run
    graphchunks.checkCoverage(many, win.first, win.last)   // no gap, no repeat
    const nums = many.flatMap((c) => Array.from({ length: c.last - c.first + 1 }, (_, k) => c.startNumber + k))
    expect(nums).toEqual(Array.from({ length: 633 }, (_, k) => k))   // the files fill 0..632 exactly once
  })
  it('no range is the whole window, as planGraphChunks plans it', () => {
    expect(strip(graphchunks.planRange(win, undefined, 50, 8))).toEqual(strip(graphchunks.planGraphChunks(win, 50, 8)))
  })
  it('refuses a range that is not whole numbers, reversed, or outside the window', () => {
    expect(() => graphchunks.planRange(win, { first: 200, last: 100 })).toThrow(/after its last/)
    expect(() => graphchunks.planRange(win, { first: 1.5, last: 10 })).toThrow(/whole frame numbers/)
    expect(() => graphchunks.planRange(win, { first: 50, last: 100 })).toThrow(/outside the graph's frame window 88-720/)
    expect(() => graphchunks.planRange(win, { first: 700, last: 800 })).toThrow(/outside/)
    expect(() => graphchunks.checkRange(win, { first: Number.NaN, last: 100 })).toThrow(/whole frame numbers/)
  })
})

describe('splitRanges', () => {
  it('633 frames in 3 parts on 50-frame boundaries: 250, 200 and 183 frames, contiguous', () => {
    const r = graphchunks.splitRanges({ first: 88, last: 720 }, 3, 50)
    expect(r).toEqual([{ first: 88, last: 337 }, { first: 338, last: 537 }, { first: 538, last: 720 }])
  })
  it('never more ranges than units; a window under one unit is one range; one part is the whole window', () => {
    expect(graphchunks.splitRanges({ first: 1, last: 120 }, 9, 50)).toHaveLength(3)
    expect(graphchunks.splitRanges({ first: 1, last: 30 }, 4, 50)).toEqual([{ first: 1, last: 30 }])
    expect(graphchunks.splitRanges({ first: 5, last: 99 }, 1, 50)).toEqual([{ first: 5, last: 99 }])
  })
  it('refuses nonsense', () => {
    expect(() => graphchunks.splitRanges({ first: 1, last: 10 }, 0)).toThrow(/parts/)
    expect(() => graphchunks.splitRanges({ first: 1, last: 10 }, 2, 0)).toThrow(/unit/)
    expect(() => graphchunks.splitRanges({ first: 10, last: 1 }, 2)).toThrow(/no frames/)
  })
})

describe('runflows.checkRanges', () => {
  it('a range needs chunking, one of the chosen graphs and whole numbers first <= last', () => {
    const ok = { ranges: { 'a.json': { first: 1, last: 5 } } }
    expect(() => runflows.checkRanges(['a.json'], ok)).not.toThrow()
    expect(() => runflows.checkRanges(['a.json'], { ...ok, chunking: 'off' })).toThrow(/needs chunked runs/)
    expect(() => runflows.checkRanges(['b.json'], ok)).toThrow(/not one of the graphs/)
    expect(() => runflows.checkRanges(['a.json'], { ranges: { 'a.json': { first: 9, last: 5 } } })).toThrow(/after last/)
    expect(() => runflows.checkRanges(['a.json'], { ranges: { 'a.json': { first: 0, last: 5 } } })).toThrow(/from 1/)
    expect(() => runflows.checkRanges(['a.json'], {})).not.toThrow()
  })
})

// ----- autochunk.runGraph on a range -----
const WIN = { first: 1, last: 120 }
const ui = () => ({ nodes: [
  { id: 1, type: 'OCIORead', widgets_values: ['/x/c.mp4', 'video', 'a', 'b', true, WIN.first, WIN.last, 0, 'error', 'hold', 24] },
  { id: 14, type: 'OCIOWrite', widgets_values: ['none', 'g', 'g', 'sequence', 'dpx', 'prores_4444', '16', 'zip', false, 1, WIN.last - WIN.first + 1, 0, 1, false, false, 'delivery_v008/C', 'C', false] },
], links: [] })
const api = () => ({ '1': { class_type: 'OCIORead', inputs: { start_frame: WIN.first, end_frame: WIN.last } }, '14': { class_type: 'OCIOWrite', inputs: { first_frame: 1, last_frame: WIN.last - WIN.first + 1, start_number: 0, source_start: 1, filename: 'C' } } })
interface Sub { read: [number, number]; keep: [number, number]; startNumber: number }
function runCtx(over: Partial<autochunk.RunCtx> = {}) {
  const subs: Sub[] = [], said: string[] = [], cps: autochunk.Checkpoint[] = []
  const ctx: autochunk.RunCtx = {
    path: 'p.json', ui: ui(), api: api(), say: (t) => said.push(t), sleep: async () => undefined, pollMs: 1,
    submit: async (a) => { const r = (a['1'] as { inputs: { start_frame: number; end_frame: number } }).inputs, w = (a['14'] as { inputs: { first_frame: number; last_frame: number; start_number: number } }).inputs; subs.push({ read: [r.start_frame, r.end_frame], keep: [r.start_frame + (w.first_frame - 1), r.start_frame + (w.last_frame - 1)], startNumber: w.start_number }); return `p${subs.length}` },
    outcome: async () => 'done', ram: async () => ({ used: 2 * GiB, limit: 100 * GiB, pct: 2 }), interrupt: async () => undefined, free: async () => undefined,
    checkpoint: (cp) => { cps.push(cp) },
    ...over,
  }
  return { ctx, subs, said, cps }
}
describe('autochunk.runGraph on a range', () => {
  it('probes and plans inside the range, numbers absolutely and reads past the range edges as a whole run would', async () => {
    const t = runCtx({ range: { first: 41, last: 80 } })
    const sum = await autochunk.runGraph(t.ctx)
    // the probe is the first 10 frames of the range; the rest follows; every written frame is a source frame of the range, numbered source - 1 (the window starts at frame 1 = file 0)
    const written = t.subs.flatMap((s) => Array.from({ length: s.keep[1] - s.keep[0] + 1 }, (_, k) => ({ src: s.keep[0] + k, no: s.startNumber + k })))
    expect(written.map((w) => w.src)).toEqual(Array.from({ length: 40 }, (_, k) => 41 + k))
    for (const w of written) expect(w.no).toBe(w.src - 1)
    expect(t.subs[0]).toMatchObject({ read: [33, 58], keep: [41, 50], startNumber: 40 })   // probe: 8 frames of padding before the range (inside the window), numbered from file 40
    expect(t.subs.at(-1)!.read[1]).toBeGreaterThan(80)                                       // the last chunk reads past the range end
    expect(t.subs.at(-1)!.read[1]).toBeLessThanOrEqual(WIN.last)
    expect(sum.text).toMatch(/frames 41-80 \(range of 1-120\)/)
  })
  it('a range at the window start and one at its end meet the window edges', async () => {
    const a = runCtx({ range: { first: 1, last: 60 } }); await autochunk.runGraph(a.ctx)
    expect(a.subs[0].read[0]).toBe(1); expect(a.subs[0].startNumber).toBe(0)
    autochunk.resetMemory()
    const b = runCtx({ range: { first: 61, last: 120 } }); await autochunk.runGraph(b.ctx)
    expect(Math.max(...b.subs.map((s) => s.read[1]))).toBe(120)
    expect(b.subs.at(-1)!.keep[1]).toBe(120)
  })
  it('the range is in every checkpoint, so a re-attach continues inside it', async () => {
    const t = runCtx({ range: { first: 41, last: 80 } }); await autochunk.runGraph(t.ctx)
    expect(t.cps.length).toBeGreaterThan(0)
    for (const cp of t.cps) expect(cp.range).toEqual({ first: 41, last: 80 })
    expect(t.cps.at(-1)!.win).toMatchObject({ first: 1, last: 120 })   // the window stays the whole graph's
    const plain = runCtx(); await autochunk.runGraph(plain.ctx); autochunk.resetMemory()
    expect(plain.cps.at(-1)!.range).toBeUndefined()
  })
  it('an adopted run continues inside the range of its checkpoint', async () => {
    const first = runCtx({ range: { first: 41, last: 100 }, outcome: async () => 'done' })
    await autochunk.runGraph(first.ctx); autochunk.resetMemory()
    const cp = first.cps.at(-1)!
    const mid = JSON.parse(JSON.stringify(cp)) as autochunk.Checkpoint
    const keys = Object.keys(mid.states); const last = keys.at(-1)!
    mid.states[last] = { state: 'running', prompt_id: 'gone' }   // the last chunk was running when the process died
    const t = runCtx({ resume: mid, outcome: async (id) => (id === 'gone' ? { error: 'prompt gone' } : 'done') })   // no range given: it comes from the checkpoint
    const sum = await autochunk.runGraph(t.ctx)
    expect(t.subs).toHaveLength(1)   // only the lost chunk is submitted again
    expect(sum.text).toMatch(/frames 41-100/)
  })
  it('refuses a range outside the window, reversed, or on a graph it cannot chunk', async () => {
    await expect(autochunk.runGraph(runCtx({ range: { first: 100, last: 200 } }).ctx)).rejects.toMatchObject({ status: 422 })
    await expect(autochunk.runGraph(runCtx({ range: { first: 50, last: 40 } }).ctx)).rejects.toMatchObject({ status: 400 })
    const noWin = runCtx({ range: { first: 1, last: 10 }, ui: { nodes: [{ id: 1, type: 'LoadImage', widgets_values: [] }], links: [] }, api: { '1': { class_type: 'LoadImage', inputs: {} } } })
    await expect(autochunk.runGraph(noWin.ctx)).rejects.toThrow(/needs a graph with one OCIORead window/)
    expect(noWin.subs).toHaveLength(0)   // never ran the whole graph instead
  })
  it('a range under 20 frames runs whole without a probe', async () => {
    const t = runCtx({ range: { first: 41, last: 55 } }); await autochunk.runGraph(t.ctx)
    expect(t.subs).toHaveLength(1)
    expect(t.subs[0]).toMatchObject({ keep: [41, 55], startNumber: 40 })
  })
})

describe('the record carries the ranges', () => {
  it('begin writes them, and an adopted run is started again with the ranges of its whole run', async () => {
    const PATH = 'base_v008/x/a.json', PATH2 = 'base_v008/x/b.json'
    const w = await chunkrecord.begin({ job_id: 'run-1', index: 0, pod_id: 'pod1', pod_name: 'n', base_url: 'http://x', path: PATH, job_paths: [PATH, PATH2], ranges: { [PATH]: { first: 41, last: 80 }, [PATH2]: { first: 1, last: 20 } } })
    const cp: autochunk.Checkpoint = { version: 1, phase: 'main', win: { first: 1, last: 120, startNumber: 0, sourceStart: 1 }, pad: 8, guardPct: 85, targetPct: 60, maxChunk: 50, size: 30, range: { first: 41, last: 80 }, plan: graphchunks.planRange({ first: 1, last: 120, startNumber: 0 }, { first: 41, last: 80 }, 30, 8), states: { '41-70': { state: 'done', prompt_id: 'p1' } } }
    await w.update(cp)
    const rec = (await chunkrecord.read(w.id))!
    expect(rec.ranges).toEqual({ [PATH]: { first: 41, last: 80 }, [PATH2]: { first: 1, last: 20 } })
    expect(rec.checkpoint!.range).toEqual({ first: 41, last: 80 })
    // a record without ranges has no field at all (older files read the same)
    const w2 = await chunkrecord.begin({ job_id: 'run-2', index: 0, pod_id: 'pod1', pod_name: 'n', base_url: 'http://x', path: PATH, job_paths: [PATH] })
    expect((await chunkrecord.read(w2.id))!.ranges).toBeUndefined()
    // the owner is gone: write the file as if another process had left it, then adopt
    const left = { ...rec, id: 'left__0', owner: { pid: 99999999, host: hostname() }, heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString() }
    mkdirSync(chunkrecord.dir(), { recursive: true }); writeFileSync(join(chunkrecord.dir(), 'left__0.json'), JSON.stringify(left))
    const got: { paths: string[]; o: runflows.RunOpts }[] = []
    const reports = await reattach.adoptAll({
      list: async () => { const l = await chunkrecord.list(); return { ...l, records: l.records.filter((r) => r.id === 'left__0') } },
      pod: async () => ({ status: 'running', name: 'n', web_ui_url: 'http://x' }), resume: async () => undefined,
      run: async (_p, paths, o) => { got.push({ paths, o }); return { id: 'new-run' } }, job: () => ({ state: 'done' }), link: () => true,
      sleep: async () => undefined, podWaitMs: 1, podPollMs: 1, watchMs: 1,
    })
    expect(reports[0]).toMatchObject({ outcome: 'adopted' })
    expect(got[0].paths).toEqual([PATH, PATH2])
    expect(got[0].o.ranges).toEqual({ [PATH]: { first: 41, last: 80 }, [PATH2]: { first: 1, last: 20 } })
    expect(got[0].o.resume![PATH].cp.range).toEqual({ first: 41, last: 80 })
  })
})

// ----- runsplit -----
const PATHX = 'base_v008/photoreal-013/photoreal-013__f23__base_v008.json'
const WINX: graphchunks.GraphWindow = { readId: '1', writeId: '14', source: '/x/f23.mp4', first: 88, last: 720, count: 633, startNumber: 0, sourceStart: 1, filename: 'C', folder: 'delivery_v008/C' }
const frames = (r: { first: number; last: number }, skip: number[] = []) => Array.from({ length: r.last - r.first + 1 }, (_, k) => WINX.startNumber + (r.first + k - WINX.first)).filter((n) => !skip.includes(n)).map((n) => ({ filename: `C.${String(n).padStart(4, '0')}.dpx`, subfolder: 'delivery_v008/C', type: 'output' as const, kind: 'other' as const }))
interface Fake { runs: { pod: string; range: { first: number; last: number } }[]; created: { name: string; gpu: string; gpu_count: number }[]; cancelled: string[]; polls: Map<string, number> }
function fakePods(o: { failOnce?: string[]; failAlways?: string[]; skip?: number[]; running?: number; sleepMs?: number } = {}) {
  const f: Fake = { runs: [], created: [], cancelled: [], polls: new Map() }
  const jobs = new Map<string, { pod: string; range: { first: number; last: number }; fail: boolean }>()
  const seen = new Map<string, number>()
  runsplit.setDeps({
    graphWindow: async () => WINX,
    run: async (pod, paths, ro) => {
      const range = ro.ranges![paths[0]]; f.runs.push({ pod, range })
      const n = (seen.get(pod) ?? 0) + 1; seen.set(pod, n)
      const id = `job-${f.runs.length}`
      jobs.set(id, { pod, range, fail: (o.failAlways ?? []).includes(pod) || ((o.failOnce ?? []).includes(pod) && n === 1) })
      return { id }
    },
    job: (id) => {
      const j = jobs.get(id); if (!j) return null
      const p = (f.polls.get(id) ?? 0) + 1; f.polls.set(id, p)
      const base = { id, pod_id: j.pod, pod_name: j.pod, started_at: '', ok: 0, failed: 0, log: [] }
      if (p <= (o.running ?? 2)) return { ...base, state: 'running', results: [{ path: PATHX, state: 'running' }] } as never
      if (j.fail) return { ...base, state: 'failed', ok: 0, failed: 1, results: [{ path: PATHX, state: 'failed', error: 'ComfyUI answered HTTP 502' }] } as never
      return { ...base, state: 'done', ok: 1, results: [{ path: PATHX, state: 'done', files: [...frames(j.range, o.skip), { filename: 'C.json', subfolder: 'delivery_v008/C', type: 'output', kind: 'other' }] }] } as never
    },
    cancelJob: (id) => { f.cancelled.push(id) },
    createPod: async (c) => { f.created.push(c); return { id: `new${f.created.length}`, name: c.name } },
    sleep: (ms) => new Promise((r) => setTimeout(r, o.sleepMs ?? 0)), pollMs: 1,
  })
  return f
}
const finished = async (id: string) => { for (let n = 0; n < 500; n++) { const j = runsplit.status(id)[0]; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 2)) } throw new Error('the split did not finish') }

describe('runsplit', () => {
  it('three pods, three ranges started at once; the union is the whole element', async () => {
    const f = fakePods()
    const j = await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })
    expect(j.ranges.map((r) => [r.first, r.last])).toEqual([[88, 337], [338, 537], [538, 720]])
    const done = await finished(j.id)
    expect(f.runs.map((r) => r.pod).sort()).toEqual(['a', 'b', 'c'])
    expect(done.state).toBe('done'); expect(done.union).toEqual({ ok: true, frames: 633, expected: 633 })
    expect(done.ranges.every((r) => r.state === 'done' && r.attempts === 1 && typeof r.seconds === 'number')).toBe(true)
    expect(done.ranges.map((r) => r.files)).toEqual([250, 200, 183])
    expect(done.log.join('\n')).toMatch(/union: 633 of 633 frames, no gap, no repeat/)
  })
  it('all the ranges are submitted before any of them is polled to the end', async () => {
    const f = fakePods({ running: 3 })
    const j = await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })
    await finished(j.id)
    expect(f.runs).toHaveLength(3)
  })
  it('a failed range is run once more, alone, on the same pod', async () => {
    const f = fakePods({ failOnce: ['b'] })
    const done = await finished((await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })).id)
    expect(done.state).toBe('done')
    expect(f.runs.filter((r) => r.pod === 'b')).toHaveLength(2); expect(f.runs.filter((r) => r.pod === 'a')).toHaveLength(1); expect(f.runs.filter((r) => r.pod === 'c')).toHaveLength(1)
    expect(done.ranges.map((r) => r.attempts)).toEqual([1, 2, 1])
    expect(f.runs.filter((r) => r.pod === 'b').every((r) => r.range.first === 338 && r.range.last === 537)).toBe(true)   // the same range, nothing else
  })
  it('a second failure fails the job and names the range and the pod', async () => {
    fakePods({ failAlways: ['c'] })
    const done = await finished((await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })).id)
    expect(done.state).toBe('failed'); expect(done.error).toMatch(/538-720 on c/); expect(done.union).toBeUndefined()
    expect(done.ranges.map((r) => r.state)).toEqual(['done', 'done', 'failed'])
  })
  it('the exclude list keeps a pod out even when it is named', async () => {
    const f = fakePods()
    const j = await runsplit.start({ path: PATHX, pod_ids: ['a', 'other-session', 'c'], exclude_pod_ids: ['other-session'] })
    const done = await finished(j.id)
    expect(done.state).toBe('done'); expect(f.runs.map((r) => r.pod)).not.toContain('other-session'); expect(f.runs).toHaveLength(2)
    expect(done.ranges.map((r) => [r.first, r.last])).toEqual([[88, 437], [438, 720]])
  })
  it('creates pods only for ranges that have none, as 2 x RTX PRO 4500 by default, never past max_pods', async () => {
    const f = fakePods()
    const done = await finished((await runsplit.start({ path: PATHX, pod_ids: ['a'], parts: 3, create: 2 })).id)
    expect(f.created).toHaveLength(2); expect(f.created[0]).toMatchObject({ gpu: 'rtxpro4500', gpu_count: 2 })
    expect(done.ranges.map((r) => r.created)).toEqual([false, true, true]); expect(done.state).toBe('done')
    const g = fakePods()
    const two = await finished((await runsplit.start({ path: PATHX, pod_ids: ['a'], parts: 3, create: 2, max_pods: 2 })).id)
    expect(g.created).toHaveLength(1); expect(two.ranges).toHaveLength(2)   // the cap: 2 pods in all, so 2 ranges
  })
  it('a frame missing from the union fails the job with the number', async () => {
    fakePods({ skip: [300] })
    const done = await finished((await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })).id)
    expect(done.state).toBe('failed'); expect(done.union).toMatchObject({ ok: false, frames: 632 }); expect(done.error).toMatch(/missing 300/)
  })
  it('plan starts nothing and says which range each pod would get', async () => {
    const f = fakePods()
    const p = await runsplit.plan({ path: PATHX, pod_ids: ['a', 'b'], create: 1 })
    expect(f.runs).toHaveLength(0); expect(f.created).toHaveLength(0)
    expect(p.window).toEqual({ first: 88, last: 720, startNumber: 0, frames: 633 }); expect(p.create).toBe(1)
    expect(p.ranges.map((r) => [r.pod_id, r.first, r.last])).toEqual([['a', 88, 337], ['b', 338, 537], ['new', 538, 720]])
  })
  it('cancel stops every range run and leaves the job cancelled', async () => {
    const f = fakePods({ running: 100000, sleepMs: 2 })
    const j = await runsplit.start({ path: PATHX, pod_ids: ['a', 'b', 'c'] })
    await new Promise((r) => setTimeout(r, 10))
    runsplit.cancel(j.id)
    const done = await finished(j.id)
    expect(done.state).toBe('cancelled'); expect(f.cancelled.length).toBe(3)
  })
  it('refuses to start without a usable pod, with bad parts, or for an unknown job', async () => {
    fakePods()
    await expect(runsplit.start({ path: PATHX })).rejects.toMatchObject({ status: 400 })
    await expect(runsplit.start({ path: PATHX, pod_ids: ['a'], exclude_pod_ids: ['a'] })).rejects.toMatchObject({ status: 400 })
    await expect(runsplit.start({ path: PATHX, pod_ids: ['a'], parts: 0 })).rejects.toMatchObject({ status: 400 })
    expect(() => runsplit.status('nope')).toThrow(/No split job/)
  })
  it('the job is in the running jobs while it runs, with its progress in ranges', async () => {
    fakePods({ running: 100000, sleepMs: 2 })
    jobsregistry.setDeps({ pid: () => 1 })   // a job written by "another process" is what externals() lists
    const j = await runsplit.start({ path: PATHX, pod_ids: ['a', 'b'] })
    await new Promise((r) => setTimeout(r, 30))
    jobsregistry.setDeps(null); await jobsregistry.refresh()
    const mine = jobsregistry.externals('render').find((x) => x.id === j.id)
    expect(mine).toMatchObject({ kind: 'render', progress: { done: 0, total: 2, unit: 'ranges' } }); expect(mine!.label).toMatch(/split run/)
    runsplit.cancel(j.id); await finished(j.id)
  })
})
