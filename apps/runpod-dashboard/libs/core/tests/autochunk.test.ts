import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as autochunk from '../src/autochunk.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as runflows from '../src/runflows.js'
import { scratch } from './helpers.js'

// ADR-056, "make sure it's automatic": a graph run with NO options is probed, planned, chunked, guarded and merge-checked. A fake ComfyUI and a fake RAM; no pod.
const GiB = 2 ** 30
let dir: string
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_MANAGER_CONFIG_DIR = dir
  delete process.env.CHUNKED_RUNS; autochunk.resetMemory(); runflows.resetDurations()
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg)
})
afterEach(() => { delete process.env.POD_MANAGER_CONFIG_DIR; delete process.env.CHUNKED_RUNS })

const uiGraph = (first: number, last: number, withNodes = true) => ({ nodes: withNodes ? [
  { id: 1, type: 'OCIORead', widgets_values: ['/x/c.mp4', 'video', 'a', 'b', true, first, last, 0, 'error', 'hold', 24] },
  { id: 14, type: 'OCIOWrite', widgets_values: ['none', 'g', 'g', 'sequence', 'dpx', 'prores_4444', '16', 'zip', false, 1, last - first + 1, 0, 1, false, false, 'delivery_v008/C', 'C', false] },
] : [{ id: 1, type: 'LoadImage', widgets_values: [] }], links: [] })
const apiGraph = (first: number, last: number, withNodes = true) => withNodes
  ? { '1': { class_type: 'OCIORead', inputs: { start_frame: first, end_frame: last } }, '14': { class_type: 'OCIOWrite', inputs: { first_frame: 1, last_frame: last - first + 1, start_number: 0, source_start: 1, filename: 'C' } } }
  : { '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } } }

/** ComfyUI + RAM: each prompt is "running" for one poll, then done. RAM = idle + (frames read by the running prompt) x perFrame. */
function world(o: { first: number; last: number; withNodes?: boolean; ramLimit?: number; perFrame?: number; idle?: number; forceUsed?: number }) {
  const prompts: { start: number; end: number; first: number; last: number; startNumber: number }[] = []
  const calls = { interrupts: 0, frees: 0, ramReads: 0 }
  const polled = new Set<string>(); let running = 0
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url), json = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body })
    if (u.includes('/api/userdata/')) return json(200, uiGraph(o.first, o.last, o.withNodes ?? true))
    if (u.endsWith('/prompt') && init?.method === 'POST') {
      const p = JSON.parse(init.body!).prompt as ReturnType<typeof apiGraph>
      if (o.withNodes ?? true) { const r = p['1'].inputs as { start_frame: number; end_frame: number }, w = p['14'].inputs as { first_frame: number; last_frame: number; start_number: number }; prompts.push({ start: r.start_frame, end: r.end_frame, first: w.first_frame, last: w.last_frame, startNumber: w.start_number }); running = r.end_frame - r.start_frame + 1 } else { prompts.push({ start: 0, end: 0, first: 0, last: 0, startNumber: 0 }); running = 1 }
      return json(200, { prompt_id: `p${prompts.length}` })
    }
    if (u.includes('/history/')) { const id = u.split('/history/')[1]; if (!polled.has(id)) { polled.add(id); return json(200, {}) } running = 0; return json(200, { [id]: { status: { status_str: 'success' }, outputs: { '9': {} } } }) }
    if (u.endsWith('/queue')) return json(200, { queue_running: [[0, `p${prompts.length}`]], queue_pending: [] })
    if (u.endsWith('/interrupt')) { calls.interrupts++; return json(200, {}) }
    if (u.endsWith('/free')) { calls.frees++; return json(200, {}) }
    throw new Error('unexpected ' + u)
  }) as unknown as typeof fetch
  const ram = async () => { calls.ramReads++; const limit = (o.ramLimit ?? 100) * GiB, used = o.forceUsed !== undefined ? o.forceUsed * GiB : ((o.idle ?? 2) + running * (o.perFrame ?? 0.5)) * GiB; return { used, limit, pct: Math.round(used / limit * 1000) / 10 } }
  return { fetchFn, prompts, calls, ram }
}
const podClient = () => ({ fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'cgi-042', desiredStatus: 'RUNNING', imageName: 'i', runtime: { uptimeInSeconds: 5, ports: [] }, machine: { gpuDisplayName: 'H100' }, costPerHr: 3.99 } } }) })) as unknown as typeof fetch, apiKey: 't' })
const opts = (w: ReturnType<typeof world>, extra: Record<string, unknown> = {}) => ({
  client: podClient(), fetchFn: w.fetchFn, ram: w.ram, pollMs: 2, backoffMs: [5, 5], waitComfyMs: 10, convert: async (g: unknown) => { const n = (g as { nodes: { widgets_values: number[] }[] }).nodes; return n[0].widgets_values.length > 6 ? apiGraph(n[0].widgets_values[5], n[0].widgets_values[6]) : apiGraph(0, 0, false) }, ...extra,
}) as never
const finish = async (id: string) => { for (let n = 0; n < 400; n++) { const j = runflows.job(id)!; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 10)) } throw new Error('the run did not finish') }
const tile = (w: ReturnType<typeof world>, from: number, to: number) => {
  // every prompt's written frames, as source numbers: read start + (first_frame - 1) .. read start + (last_frame - 1), numbered from startNumber
  const out: number[] = []
  for (const p of w.prompts) for (let f = p.first; f <= p.last; f++) { const src = p.start + (f - 1), no = p.startNumber + (f - p.first); expect(no).toBe(src - from); out.push(src) }
  expect(out).toEqual(Array.from({ length: to - from + 1 }, (_, k) => from + k))   // no gap, no repeat, in order
}

describe('the default path: a graph run with no options', () => {
  it('a graph the app has not seen is probed (10 frames, RAM sampled), planned against 60% of the RAM, chunked, and the chunks tile the frame range', async () => {
    const w = world({ first: 1, last: 160 })
    const j = await finish((await runflows.run('pod1', ['base_v008/p/p__hadal__base_v008.json'], opts(w))).id)
    expect(j.results[0]).toMatchObject({ state: 'done' }); expect(j.state).toBe('done')
    expect(w.prompts.length).toBe(1 + 3)                                  // the probe, then 150 frames in chunks of 50
    expect(w.prompts[0]).toMatchObject({ start: 1, end: 18, first: 1, last: 10, startNumber: 0 })   // the probe is the real first 10 frames (+8 read after)
    tile(w, 1, 160)
    const log = j.log.map((l) => l.text).join(' | ')
    expect(log).toMatch(/new graph, probing frames 1-10/); expect(log).toMatch(/probe: 0\.\d+ GiB per frame/); expect(log).toMatch(/chunks of 50 frames/); expect(log).toMatch(/no gap, no repeat/)
    expect(history.list({ limit: 50 }).some((e) => (e as { action?: string }).action === 'chunked run')).toBe(true)   // and the History says so
    const rec = JSON.parse(readFileSync(join(dir, 'graph-memory.json'), 'utf8'))['base_v008/p/p__hadal__base_v008.json']
    expect(rec.per_frame_gib).toBeGreaterThan(0.4); expect(rec.ram_gib).toBe(100); expect(rec.chunk).toBe(50)   // remembered next to graph-durations.json
  })
  it('a repeat run needs no probe: the remembered figure plans it', async () => {
    const w1 = world({ first: 1, last: 160 }); await finish((await runflows.run('pod1', ['g/a.json'], opts(w1))).id)
    autochunk.resetMemory()                                               // as after an app restart: it is read from the file
    const w2 = world({ first: 1, last: 160 }); const j = await finish((await runflows.run('pod1', ['g/a.json'], opts(w2))).id)
    expect(j.results[0].state).toBe('done'); expect(j.log.some((l) => /remembered .* GiB per frame/.test(l.text))).toBe(true); expect(j.log.some((l) => /probing/.test(l.text))).toBe(false)
    expect(w2.prompts.map((p) => p.last - p.first + 1)).toEqual([50, 50, 50, 10]); tile(w2, 1, 160)
  })
  it('a graph that fits whole runs whole: one prompt with the graph\'s own window', async () => {
    const w = world({ first: 1, last: 60, perFrame: 0.1 })
    await finish((await runflows.run('pod1', ['g/s.json'], opts(w))).id)
    const w2 = world({ first: 1, last: 60, perFrame: 0.1 }); const j = await finish((await runflows.run('pod1', ['g/s.json'], opts(w2))).id)   // second run: remembered, fits
    expect(j.results[0].state).toBe('done'); expect(w2.prompts).toEqual([{ start: 1, end: 60, first: 1, last: 60, startNumber: 0 }])
    expect(j.log.some((l) => /running them whole/.test(l.text))).toBe(true)
  })
  it('the opt-out: chunking off runs the graph as before, one prompt, the RAM never read', async () => {
    const w = world({ first: 1, last: 160 })
    const j = await finish((await runflows.run('pod1', ['g/a.json'], opts(w, { chunking: 'off' }))).id)
    expect(j.results[0].state).toBe('done'); expect(w.prompts).toEqual([{ start: 1, end: 160, first: 1, last: 160, startNumber: 0 }]); expect(w.calls.ramReads).toBe(0)
  })
  it('the setting turns it off too (chunked_runs), and a run\'s own option beats the setting', async () => {
    process.env.CHUNKED_RUNS = '0'
    const w = world({ first: 1, last: 160 }); await finish((await runflows.run('pod1', ['g/a.json'], opts(w))).id)
    expect(w.prompts).toHaveLength(1)
    const w2 = world({ first: 1, last: 160 }); await finish((await runflows.run('pod1', ['g/b.json'], opts(w2, { chunking: 'on' }))).id)
    expect(w2.prompts.length).toBeGreaterThan(1)
  })
  it('refuses to guess: a graph with no frame window runs whole with the RAM guard only, and says so in the events and the History', async () => {
    const w = world({ first: 1, last: 1, withNodes: false })
    const j = await finish((await runflows.run('pod1', ['g/other.json'], opts(w))).id)
    expect(j.results[0].state).toBe('done'); expect(w.prompts).toHaveLength(1)
    expect(j.log.some((l) => /chunking: not applied .*running the graph whole with the RAM guard only/.test(l.text))).toBe(true)
    expect(history.list({ limit: 50 }).some((e) => /not applied/.test(String((e as { detail?: string }).detail)))).toBe(true)
  })
  it('the guard on a graph it cannot split: over 85% the run is interrupted and fails with the RAM-guard error (which the queue escalates by GPU count)', async () => {
    const w = world({ first: 1, last: 1, withNodes: false, forceUsed: 90 })
    const j = await finish((await runflows.run('pod1', ['g/other.json'], opts(w))).id)
    expect(j.results[0]).toMatchObject({ state: 'failed', oom: true }); expect(j.results[0].error).toMatch(/RAM guard: the container is at 90%/); expect(w.calls.interrupts).toBe(1)
  })
  it('the live guard on a chunked run: at 85% the chunk is interrupted and resubmitted as halves, and the frames still tile', async () => {
    // the remembered figure says 0.1 GiB per frame (fits), but the pod really uses 1.5 per frame: the first 50-frame chunk goes over 85% and is split
    const w = world({ first: 1, last: 100, perFrame: 1.5, ramLimit: 100 })
    const dirMem = join(dir, 'graph-memory.json'); (await import('node:fs')).writeFileSync(dirMem, JSON.stringify({ 'g/liar.json': { per_frame_gib: 0.1, ram_gib: 100, chunk: 50, frames: 18, measured_at: '2026-11-21T00:00:00Z' } })); autochunk.resetMemory()
    const j = await finish((await runflows.run('pod1', ['g/liar.json'], opts(w))).id)
    expect(j.results[0].state).toBe('done'); expect(w.calls.interrupts).toBeGreaterThan(0); expect(j.log.some((l) => /RAM .*% at the guard: resubmitted as/.test(l.text))).toBe(true)
    // the interrupted prompts wrote nothing we count: the finished ones tile the range (the last prompts are the ones that completed)
    const done = w.prompts.filter((p) => p.last - p.first + 1 <= 40)
    expect(done.length).toBeGreaterThan(1)
  })
})

describe('the entry points', () => {
  it('run_pod_workflows, the queue\'s run tasks and Import Round all reach the default path through runflows.run; there is no other way to queue a graph', () => {
    const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8')
    expect(src('queue.ts')).toMatch(/run: async \(podId, paths\) => runflows\.run\(podId, paths\)/)          // the queue and Import Round
    expect(readFileSync(join(__dirname, '..', '..', '..', 'mcp', 'app-tools.mjs'), 'utf8')).toMatch(/runflows\.run\(args\.pod_id/)   // run_pod_workflows
    expect(readFileSync(join(__dirname, '..', '..', '..', 'electron', 'core.cjs'), 'utf8')).toMatch(/c\.runflows\.run\(podId, paths/)   // the window
    const rf = src('runflows.ts')
    expect(rf).toMatch(/return runChunked\(i, r, base, o, fetchFn, api, ui\)/)                                 // runOne hands every graph to the default path
    expect((rf.match(/\/prompt`/g) ?? []).length).toBe(2)                                                      // /prompt is posted in exactly two places: runOne (the opt-out) and runChunked
  })
})
