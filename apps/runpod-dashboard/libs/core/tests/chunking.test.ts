import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as chunking from '../src/chunking.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import { scratch } from './helpers.js'

// Chunked runs (docs/CHUNKING.md): the plan, the range in the graph, the RAM guard, the job files. A fake ComfyUI answers; the pod's RAM is injected.
let dir: string
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json')
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg)
})

describe('the plan', () => {
  it('splits a range into chunks, the last one short', () => {
    expect(chunking.plan(1, 250, 100)).toEqual([{ n: 1, first: 1, last: 100, count: 100 }, { n: 2, first: 101, last: 200, count: 100 }, { n: 3, first: 201, last: 250, count: 50 }])
    expect(chunking.plan(5, 5, 100)).toEqual([{ n: 1, first: 5, last: 5, count: 1 }])
  })
  it('refuses a backwards range, a zero chunk and silly sizes', () => {
    expect(() => chunking.plan(10, 5, 10)).toThrow(/before first/)
    expect(() => chunking.plan(1, 10, 0)).toThrow(/at least 1/)
    expect(() => chunking.plan(1.5, 10, 2)).toThrow(/whole number/)
    expect(() => chunking.plan(0, 1_000_000, 1)).toThrow(/more than/)
  })
})

describe('the range in the graph', () => {
  const seq = () => ({ '1': { class_type: 'BH_ReadSequence', inputs: { first_index: 0, count: 0 } }, '2': { class_type: 'BincSeqToImage', inputs: { seq: ['1', 0], first_frame: 1, last_frame: 9 } }, '3': { class_type: 'KSampler', inputs: {} } })
  it('a graph with BincSeqToImage takes frame numbers there and leaves the reader alone', () => {
    const g = seq(), p = chunking.applyRange(g, 92810, 92909)
    expect(p).toEqual({ unit: 'frame', nodes: ['2'] })
    expect(g['2'].inputs).toMatchObject({ first_frame: 92810, last_frame: 92909 }); expect(g['1'].inputs).toEqual({ first_index: 0, count: 0 })
  })
  it('a graph with only BH_ReadSequence takes an index and a count', () => {
    const g: Record<string, unknown> = { '1': seq()['1'] }, p = chunking.applyRange(g, 100, 199)
    expect(p).toEqual({ unit: 'index', nodes: ['1'] }); expect((g['1'] as { inputs: unknown }).inputs).toEqual({ first_index: 100, count: 100 })
  })
  it('a graph with neither cannot be chunked, and says so', () => { expect(() => chunking.applyRange({ '1': { class_type: 'KSampler', inputs: {} } }, 1, 2)).toThrow(/no frame range to chunk/) })
})

describe('the container memory', () => {
  it('reads cgroup v2 and v1 and a percentage', () => {
    expect(chunking.parseRam(['RAM2 107374182400 214748364800'])).toMatchObject({ pct: 50, source: 'cgroup2' })
    expect(chunking.parseRam(['noise', 'RAM1 1073741824 4294967296'])).toMatchObject({ pct: 25, source: 'cgroup1' })
  })
  it('no limit (max, or v1\'s huge number) or no reading is unknown, not 0%', () => {
    expect(chunking.parseRam(['RAM2 100 max'])).toBeNull(); expect(chunking.parseRam(['RAM1 100 9223372036854771712'])).toBeNull(); expect(chunking.parseRam([])).toBeNull()
  })
  it('over the limit at and past it', () => {
    const r = (pct: number) => ({ used: pct, limit: 100, pct, source: 'cgroup2' as const })
    expect(chunking.overLimit(r(84.9), 85)).toBe(false); expect(chunking.overLimit(r(85), 85)).toBe(true); expect(chunking.overLimit(null, 85)).toBe(false)
  })
})

describe('running in chunks', () => {
  const podClient = () => ({ fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'cgi-042', desiredStatus: 'RUNNING', imageName: 'i', runtime: { uptimeInSeconds: 5, ports: [] }, machine: { gpuDisplayName: 'H100' }, costPerHr: 3.99 } } }) })) as unknown as typeof fetch, apiKey: 't' })
  const GRAPH = () => ({ '2': { class_type: 'BincSeqToImage', inputs: { first_frame: 1, last_frame: 9 } } })
  /** A ComfyUI that finishes every prompt at once (or never, with `hang`), remembering what was queued, interrupted and freed. */
  function fakeComfy(hang = false) {
    const calls = { queued: [] as { prompt: Record<string, { inputs: Record<string, number> }> }[], interrupts: 0, frees: 0 }
    const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
      const u = String(url), json = (body: unknown) => ({ status: 200, ok: true, json: async () => body })
      if (u.endsWith('/prompt')) { calls.queued.push(JSON.parse(init!.body!)); return json({ prompt_id: `p${calls.queued.length}` }) }
      if (u.includes('/history/')) { const id = u.split('/history/')[1]; return json(hang ? {} : { [id]: { status: { status_str: 'success' }, outputs: { '9': {} } } }) }
      if (u.endsWith('/interrupt')) { calls.interrupts++; return json({}) }
      if (u.endsWith('/free')) { calls.frees++; return json({}) }
      throw new Error('unexpected ' + u)
    }) as unknown as typeof fetch
    return { fetchFn, calls }
  }
  const ram = (...pcts: number[]): chunking.RamReader => { let n = 0; return async () => { const pct = pcts[Math.min(n++, pcts.length - 1)]; return { used: pct * 2 ** 30, limit: 100 * 2 ** 30, pct, source: 'cgroup2' } } }
  const finish = async (id: string) => { for (let n = 0; n < 300; n++) { const j = chunking.job(id)!; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 10)) } throw new Error('did not finish') }
  const base = (c: ReturnType<typeof fakeComfy>, extra: Partial<chunking.ChunkOpts> = {}): chunking.ChunkOpts => ({ client: podClient(), fetchFn: c.fetchFn, graph: GRAPH(), first: 1, last: 250, chunk: 100, pollMs: 5, guardEveryMs: 0, ...extra })

  it('refuses no graph, a bad path and a bad limit before anything runs', async () => {
    const c = fakeComfy()
    await expect(chunking.run('pod1', { ...base(c), graph: undefined })).rejects.toThrow(/graph/)
    await expect(chunking.run('pod1', { ...base(c), graph: undefined, path: '../x.json' })).rejects.toThrow(/Not a workflow path/)
    await expect(chunking.run('pod1', { ...base(c), ramGuardPct: 0 })).rejects.toThrow(/between 1 and 100/)
  })

  it('runs every chunk in order with its own range, frees memory between them, logs each', async () => {
    const c = fakeComfy()
    const j = await finish((await chunking.run('pod1', base(c, { ram: ram(30, 20, 30, 20, 30) }))).id)
    expect(j.state).toBe('done'); expect(j.ok).toBe(3); expect(j.unit).toBe('frame')
    expect(c.calls.queued.map((q) => [q.prompt['2'].inputs.first_frame, q.prompt['2'].inputs.last_frame])).toEqual([[1, 100], [101, 200], [201, 250]])
    expect(c.calls.frees).toBe(2)   // between chunks, not after the last
    expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.state === 'done')).toHaveLength(3)
  })

  it('the guard interrupts a chunk over the limit, frees memory, and stops with the frame to resume from', async () => {
    const c = fakeComfy(true)
    const j = await finish((await chunking.run('pod1', base(c, { ram: ram(40, 91) }))).id)
    expect(j.state).toBe('stopped'); expect(j.ok).toBe(0)
    expect(j.error).toMatch(/RAM guard: the container is at 91%.*chunk 1 of 3 \(frames 1-100\).*from frame 1 with a smaller chunk/)
    expect(c.calls.interrupts).toBe(1); expect(c.calls.frees).toBe(1)
    expect(j.chunks.map((x) => x.state)).toEqual(['failed', 'skipped', 'skipped']); expect(j.ram?.peak_pct).toBe(91)
    expect(c.calls.queued).toHaveLength(1)   // chunk 2 never started
  })

  it('memory that does not fall after the free stops the run before the next chunk, and says where to continue', async () => {
    const c = fakeComfy()
    const j = await finish((await chunking.run('pod1', base(c, { ram: ram(88) }))).id)   // the fake finishes at once, so the first reading is the one after the free
    expect(j.state).toBe('stopped'); expect(j.ok).toBe(1)
    expect(j.error).toMatch(/after chunk 1 .*still holds 88%.*continue from frame 101/)
    expect(c.calls.queued).toHaveLength(1)
  })

  it('a pod whose memory cannot be read runs, with the guard off and a note saying so', async () => {
    const c = fakeComfy()
    const j = await finish((await chunking.run('pod1', base(c, { ram: async () => null, last: 150 }))).id)
    expect(j.state).toBe('done'); expect(j.ram_note).toMatch(/guard is off/)
  })

  it('cancel interrupts the running chunk and skips the rest', async () => {
    const c = fakeComfy(true)
    const j0 = await chunking.run('pod1', base(c, { ram: ram(10) }))
    await new Promise((r) => setTimeout(r, 30)); chunking.cancel(j0.id)
    const j = await finish(j0.id)
    expect(j.state).toBe('cancelled'); expect(c.calls.interrupts).toBe(1); expect(j.chunks.map((x) => x.state)).toEqual(['skipped', 'skipped', 'skipped'])
  })

  it('a graph with nothing to chunk fails the job with that reason', async () => {
    const c = fakeComfy()
    const j = await finish((await chunking.run('pod1', base(c, { graph: { '1': { class_type: 'KSampler', inputs: {} } } }))).id)
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/no frame range to chunk/); expect(c.calls.queued).toHaveLength(0)
  })
})

describe('the job files', () => {
  const opts = (d: string) => ({ project: 'restore', shot: 'cgi-042', first: 1, last: 250, chunk: 100, dir: d, now: new Date('2026-11-16T21:05:00Z') })
  it('writes one brief per chunk, in order, each naming its own range and the call to run it', () => {
    const d = join(dir, 'in'), w = chunking.writeJobFiles(opts(d))
    expect(readdirSync(d).sort()).toEqual(['cgi-042_chunk-1of3_20261116-2105.md', 'cgi-042_chunk-2of3_20261116-2105.md', 'cgi-042_chunk-3of3_20261116-2105.md']); expect(w.files).toHaveLength(3)
    const t = readFileSync(w.files[1], 'utf8')
    expect(t).toMatch(/^job: cgi-042_chunk-2of3_/); expect(t).toMatch(/params: first=101 last=200 chunk=100/); expect(t).toMatch(/run_shot_chunked \{ pod_id, first: 101, last: 200, chunk: 100 \}/)
  })
  it('never overwrites a job file', () => { const d = join(dir, 'in'); chunking.writeJobFiles(opts(d)); expect(() => chunking.writeJobFiles(opts(d))).toThrow(/already exists/) })
  it('never writes into Binc\'s queue, and checks the names', () => {
    expect(() => chunking.writeJobFiles({ ...opts(join(dir, 'x')), project: 'canalv2' })).toThrow(/Binc's queue/)
    expect(() => chunking.writeJobFiles({ ...opts(join(dir, 'x')), project: '../x' })).toThrow(/folder name/)
    expect(() => chunking.writeJobFiles({ ...opts(join(dir, 'x')), shot: 'a b' })).toThrow(/shot must be/)
    expect(existsSync(join(dir, 'x'))).toBe(false)
  })
})
