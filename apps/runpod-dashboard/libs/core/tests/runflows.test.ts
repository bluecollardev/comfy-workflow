import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as runflows from '../src/runflows.js'
import * as ui2api from '../src/ui2api.js'
import { scratch } from './helpers.js'

// Run workflows (docs/ADR-037): list a pod's graphs, run chosen ones, log every outcome. A fake ComfyUI answers; the conversion is injected (the real one is a browser).
let dir: string
beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json')
  const cfg = mounts.defaults(); cfg.dry_run = false; mounts.save(cfg)
})

const UI = { nodes: [{ id: 1 }], links: [] }
const API = { '1': { class_type: 'LoadImage', inputs: { image: 'a.png' } } }

/** A ComfyUI with a few graphs, a /prompt that can reject, and a /history that answers per prompt. */
function fakeComfy(h: { reject?: unknown; history?: Record<string, unknown>; notUi?: boolean } = {}) {
  const calls = { queued: [] as unknown[], interrupts: 0 }
  const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url), json = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body })
    if (u.includes('/api/userdata/')) return json(200, h.notUi ? { 1: {} } : UI)
    if (u.endsWith('/prompt') && init?.method === 'POST') { calls.queued.push(JSON.parse(init.body!)); return h.reject ? json(400, h.reject) : json(200, { prompt_id: `p${calls.queued.length}`, number: calls.queued.length }) }
    if (u.includes('/history/')) { const id = u.split('/history/')[1]; return json(200, h.history?.[id] ? { [id]: h.history[id] } : {}) }
    if (u.endsWith('/interrupt')) { calls.interrupts++; return json(200, {}) }
    throw new Error('the fake ComfyUI was asked something unexpected: ' + u)
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}
const finish = async (id: string) => { for (let n = 0; n < 200; n++) { const j = runflows.job(id)!; if (j.state !== 'running') return j; await new Promise((r) => setTimeout(r, 10)) } throw new Error('the run did not finish') }

describe('listing', () => {
  it('keeps graphs, drops inputs manifests and API twins, groups by folder', () => {
    const w = runflows.toFiles([
      { path: 'rounds/r1/cgi-042/b.json' }, { path: 'rounds/r1/cgi-042/a.json' }, { path: 'rounds/r1/cgi-042/a-inputs-manifest.json' },
      { path: 'rounds/r1/cgi-042/a_api.json' }, { path: 'rounds/r1/cgi-042/a-api.json' }, { path: 'top.json' }, { path: 'notes.txt' },
    ])
    expect(w.map((x) => x.path)).toEqual(['top.json', 'rounds/r1/cgi-042/a.json', 'rounds/r1/cgi-042/b.json'])
    expect(w[0]).toMatchObject({ group: '', name: 'top.json' }); expect(w[1]).toMatchObject({ group: 'rounds/r1/cgi-042', name: 'a.json' })
  })
  it('a ComfyUI with no workflows folder answers 404 and that is an empty list, not an error', async () => {
    const client = { fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'fresh', desiredStatus: 'RUNNING', imageName: 'i', runtime: { uptimeInSeconds: 5, ports: [] }, machine: { gpuDisplayName: 'RTX 4090' } } } }) })) as unknown as typeof fetch, apiKey: 't' }
    const l = await runflows.list('pod1', client, (async () => ({ status: 404, ok: false, json: async () => ({}) })) as unknown as typeof fetch)
    expect(l).toMatchObject({ count: 0, workflows: [] })
  })
  it('a dry run lists simulated graphs', async () => {
    const cfg = mounts.load(); cfg.dry_run = true; mounts.save(cfg)
    const l = await runflows.list('x'); expect(l.count).toBeGreaterThan(0)
  })
})

describe('what ComfyUI says, in words', () => {
  it('a rejected prompt names the first bad node and how many more', () => {
    const d = runflows.describeRejection({ error: { message: 'Prompt outputs failed validation' }, node_errors: { '7': { class_type: 'LoadImage', errors: [{ message: 'Value not in list', details: 'image: x.png' }] }, '9': { class_type: 'X', errors: [] } } })
    expect(d.node).toBe('7'); expect(d.text).toMatch(/node 7 \(LoadImage\): Value not in list image: x\.png \(and 1 more node\)/)
  })
  it('a finished history entry is ok, or the execution_error', () => {
    expect(runflows.outcomeOf(undefined)).toBeNull()
    expect(runflows.outcomeOf({ status: { status_str: 'success' }, outputs: { '9': {} } })).toMatchObject({ done: true, outputs: 1 })
    expect(runflows.outcomeOf({ status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '4', node_type: 'KSampler' }]] } })).toMatchObject({ done: true, node: '4', error: 'CUDA out of memory (node 4, KSampler)' })
  })
})

describe('converting', () => {
  it('the pod script carries the graph as base64 in a temp file, and its answer parses back', () => {
    const s = ui2api.podScript(UI); expect(s).toContain('python3 /opt/comfy-app/ui2api.py'); expect(s).not.toContain('"nodes"'); expect(s).toContain('PLAYWRIGHT_BROWSERS_PATH')   // an ssh session has no image ENV: the browser is in /opt/playwright
    const line = 'UI2API-RESULT\t' + Buffer.from(JSON.stringify(API)).toString('base64')
    expect(ui2api.parsePodOutput(['noise', line])).toEqual(API)
    expect(() => ui2api.parsePodOutput(['UI2API-ERROR\tthe page returned no API graph'])).toThrow(/could not convert the graph: the page returned no API graph/)
    expect(() => ui2api.parsePodOutput(['nothing'])).toThrow(/printed no converted graph/)
  })
})

describe('running', () => {
  const podClient = () => ({ fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'cgi-042', desiredStatus: 'RUNNING', imageName: 'i', runtime: { uptimeInSeconds: 5, ports: [] }, machine: { gpuDisplayName: 'H100' }, costPerHr: 3.99 } } }) })) as unknown as typeof fetch, apiKey: 't' })
  const opts = (c: ReturnType<typeof fakeComfy>, extra: Partial<runflows.RunOpts> = {}): runflows.RunOpts => ({ client: podClient(), fetchFn: c.fetchFn, convert: async () => API, pollMs: 5, ...extra })

  it('refuses nothing chosen, and paths that are not workflows', async () => {
    await expect(runflows.run('pod1', [], {})).rejects.toThrow(/at least one/)
    await expect(runflows.run('pod1', ['../x.json'], {})).rejects.toThrow(/Not a workflow path/)
    await expect(runflows.run('pod1', ['a.txt'], {})).rejects.toThrow(/Not a workflow path/)
  })

  it('a validation rejection (400): stage validate, not retried, the model named; an execution error: stage execute with the node type; a 503 on queue is retryable', async () => {
    const failures = await import('../src/failures.js')
    const c = fakeComfy({ reject: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '3': { class_type: 'CheckpointLoaderSimple', errors: [{ message: "Value not in list: ckpt_name: 'flux1-dev.safetensors' not in []" }] } } } })
    const j = await finish((await runflows.run('pod1', ['rounds/r/a.json'], opts(c))).id); const res = j.results[0]
    expect(res).toMatchObject({ state: 'failed', node: '3', retryable: false, node_type: 'CheckpointLoaderSimple', missing_models: [{ name: 'flux1-dev.safetensors', where_on_volume: 'comfy-shared/models/checkpoints/flux1-dev.safetensors' }] }); expect(res.recovery).toMatch(/Missing model.*Not retried/)
    await failures.settled(); const l = (await failures.list({ job_id: j.id })).failures[0]; expect(l).toMatchObject({ stage: 'validate', node_id: '3', graph: 'rounds/r/a.json', pod_id: 'pod1', retryable: false }); expect(l.log_tail.length).toBeGreaterThan(0)
    const c2 = fakeComfy({ history: { p1: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '4', node_type: 'KSampler' }]] }, outputs: {} } } })
    const j2 = await finish((await runflows.run('pod1', ['rounds/r/b.json'], opts(c2))).id); await failures.settled(); expect((await failures.list({ job_id: j2.id })).failures[0]).toMatchObject({ stage: 'execute', node_id: '4', node_type: 'KSampler', retryable: false })
  })
  /** A ComfyUI whose /prompt answers from a script (status, body) per call, history from a map, and /queue from a function. */
  const scripted = (answers: { status: number; body?: unknown }[], hist: Record<string, unknown> = {}, queue: () => unknown[] = () => []) => {
    const calls = { prompts: 0, polls: 0 }
    const fetchFn = (async (url: string, init?: { method?: string }) => {
      const u = String(url), json = (status: number, body: unknown) => ({ status, ok: status === 200, json: async () => body })
      if (u.includes('/api/userdata/')) return json(200, UI)
      if (u.endsWith('/prompt') && init?.method === 'POST') { const a = answers[Math.min(calls.prompts++, answers.length - 1)]; return a.status === 200 ? json(200, { prompt_id: `p${calls.prompts}` }) : json(a.status, a.body ?? {}) }
      if (u.includes('/history/')) { calls.polls++; const id = u.split('/history/')[1]; return json(200, hist[id] ? { [id]: hist[id] } : {}) }
      if (u.endsWith('/queue')) return json(200, { queue_running: queue(), queue_pending: [] })
      throw new Error('unexpected ' + u)
    }) as unknown as typeof fetch
    return { fetchFn, calls }
  }
  const OK = { status_str: 'success' }
  it('a starting ComfyUI (the proxy answers 502 for /system_stats) is waited for before the first graph, not failed with it', async () => {
    const c = scripted([{ status: 200 }], { p1: { status: OK, outputs: { '9': {} } } }); let asked = 0
    const fetchFn = (async (url: string, init?: unknown) => { if (String(url).endsWith('/system_stats')) { asked++; return { status: asked < 3 ? 502 : 200, ok: asked >= 3, json: async () => ({}) } } return (c.fetchFn as unknown as (u: string, i?: unknown) => Promise<unknown>)(url, init) }) as unknown as typeof fetch
    const j = await finish((await runflows.run('pod1', ['a/g.json'], opts(c as never, { fetchFn, backoffMs: [10, 10], pollComfyMs: 5 }))).id)
    expect(asked).toBe(3); expect(j.results[0].state).toBe('done'); expect(j.log.some((l) => /still starting/.test(l.text))).toBe(true)
  })
  it('a conversion that times out while ComfyUI is starting is tried again before the graph is failed; another error is not', async () => {
    let n = 0; const c = scripted([{ status: 200 }], { p1: { status: OK, outputs: { '9': {} } } })
    const convert = async () => { n++; if (n < 3) throw new Error('The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded.'); return { '1': { class_type: 'X', inputs: {} } } }
    const j = await finish((await runflows.run('pod1', ['a/g.json'], opts(c as never, { fetchFn: c.fetchFn, convert: convert as never, convertWaitMs: 5, backoffMs: [10, 10] }))).id)
    expect(n).toBe(3); expect(j.results[0].state).toBe('done')
    let m = 0; const bad = async () => { m++; throw new Error('Unknown node type Foo') }
    const c2 = scripted([{ status: 200 }]); const j2 = await finish((await runflows.run('pod1', ['a/g.json'], opts(c2 as never, { fetchFn: c2.fetchFn, convert: bad as never, convertWaitMs: 5, backoffMs: [10, 10] }))).id)
    expect(m).toBe(1); expect(j2.results[0].state).toBe('failed')
  })
  it('fail fast: a validation error fails at once, no polling, and is never retried', async () => {
    const c = scripted([{ status: 400, body: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '7': { class_type: 'KSampler', errors: [{ message: 'Required input is missing' }] } } } }])
    const j = await finish((await runflows.run('pod1', ['a/g.json'], opts(c as never, { fetchFn: c.fetchFn, backoffMs: [10, 10] }))).id); expect(j.results[0]).toMatchObject({ state: 'failed', retryable: false }); expect(c.calls.prompts).toBe(1); expect(c.calls.polls).toBe(0)
  })
  it('a transient cause (503) is retried after a backoff, AFTER the other graphs, at most twice; the first graph does not block the next', async () => {
    const c = scripted([{ status: 503 }, { status: 200 }, { status: 503 }, { status: 200 }], { p2: { status: OK, outputs: { '9': {} } }, p4: { status: OK, outputs: { '9': {} } } })
    const j = await finish((await runflows.run('pod1', ['a/one.json', 'a/two.json'], opts(c as never, { fetchFn: c.fetchFn, backoffMs: [30, 30] }))).id)
    expect(j.results.map((r) => r.state)).toEqual(['done', 'done']); expect(c.calls.prompts).toBe(4); expect(j).toMatchObject({ ok: 2, failed: 0, state: 'done' }); expect(j.log.some((l) => /Will be tried again.*attempt 2 of 3/.test(l.text))).toBe(true)
    const c2 = scripted([{ status: 503 }]); const j2 = await finish((await runflows.run('pod1', ['a/one.json'], opts(c2 as never, { fetchFn: c2.fetchFn, backoffMs: [10, 10] }))).id); expect(c2.calls.prompts).toBe(3); expect(j2.results[0]).toMatchObject({ state: 'failed', retryable: true })   // 1 try + 2 retries, then failed
  })
  it('three graphs in a row failing for the same cause pause the dispatch ONCE: the rest are skipped and one History line says so', async () => {
    const bad = { status: 400, body: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '7': { class_type: 'CheckpointLoaderSimple', errors: [{ message: "Value not in list: ckpt_name: 'x.safetensors' not in []" }] } } } }
    const c = scripted([bad]); const j = await finish((await runflows.run('pod1', ['a/1.json', 'a/2.json', 'a/3.json', 'a/4.json', 'a/5.json'], opts(c as never, { fetchFn: c.fetchFn }))).id)
    expect(j.results.map((r) => r.state)).toEqual(['failed', 'failed', 'failed', 'skipped', 'skipped']); expect(c.calls.prompts).toBe(3); expect(history.list({ limit: 50 }).filter((e) => e.kind === 'job' && e.what === 'dispatch paused')).toHaveLength(1); expect(j.log.filter((l) => /Dispatch paused/.test(l.text))).toHaveLength(1)
  })
  it('a hard time limit (3x the last successful run, else 2 h) and a stall limit (no run and no queue entry for 10 minutes) fail the graph', async () => {
    runflows.resetDurations()
    const fast = scripted([{ status: 200 }], { p1: { status: OK, outputs: { '9': {} } } }); await finish((await runflows.run('pod1', ['a/slow.json'], opts(fast as never, { fetchFn: fast.fetchFn }))).id)   // remembers a short duration
    const hang = scripted([{ status: 200 }], {}, () => [[0, 'p1']]); const j = await finish((await runflows.run('pod1', ['a/slow.json'], opts(hang as never, { fetchFn: hang.fetchFn }))).id)
    expect(j.results[0].error).toMatch(/Still running after/); expect(j.results[0].retryable).toBe(false)
    const lost = scripted([{ status: 200 }], {}, () => []); const j2 = await finish((await runflows.run('pod1', ['a/lost.json'], opts(lost as never, { fetchFn: lost.fetchFn, stallMs: 40, graphTimeoutS: 60 }))).id)
    expect(j2.results[0].error).toMatch(/Stalled: prompt p1 is neither running nor queued/); expect(j2.results[0].stage).toBe('execute')
  })
  it('converts, queues and waits; an ok run and a failing run are both in the History, the error with its node', async () => {
    const c = fakeComfy({ history: { p1: { status: { status_str: 'success' }, outputs: { '9': {} } }, p2: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'boom', node_id: '4', node_type: 'KSampler' }]] } } } })
    const j0 = await runflows.run('pod1', ['rounds/r/a.json', 'rounds/r/b.json'], opts(c))
    const j = await finish(j0.id)
    expect(j.results.map((r) => r.state)).toEqual(['done', 'failed']); expect(j).toMatchObject({ ok: 1, failed: 1, state: 'done' })
    expect(j.results[1].error).toBe('boom (node 4, KSampler)')
    expect(c.calls.queued).toHaveLength(2); expect((c.calls.queued[0] as { prompt: unknown }).prompt).toEqual(API)
    expect((c.calls.queued[0] as { extra_data: { pod_manager: { workflow: string } } }).extra_data.pod_manager.workflow).toMatch(/\.json$/)   // each prompt is tagged with the workflow it came from: ComfyUI keeps it in its history
    const ev = history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'run')
    expect(ev).toHaveLength(2)
    expect(ev.find((e) => e.kind === 'job' && e.what === 'rounds/r/b.json')).toMatchObject({ state: 'failed', error: 'boom (node 4, KSampler)', pod_id: 'pod1' })
    expect(ev.find((e) => e.kind === 'job' && e.what === 'rounds/r/a.json')).toMatchObject({ state: 'done' })
  })

  it('latest finds a pod\'s current run again: the one still running, else the newest; nothing for a pod with no run', async () => {
    expect(runflows.latest('no-such-pod')).toBeNull()
    const quick = fakeComfy({ history: { p1: { status: { status_str: 'success' }, outputs: { '9': {} } } } })
    const first = await finish((await runflows.run('podL', ['a.json'], opts(quick))).id)
    expect(runflows.latest('podL')?.id).toBe(first.id)   // a finished run is still found: the window shows its results again
    await new Promise((r) => setTimeout(r, 5))   // the ids carry the start time to the millisecond
    const slow = fakeComfy()   // history never answers: this one keeps running
    const second = await runflows.run('podL', ['b.json', 'c.json'], opts(slow))
    expect(runflows.latest('podL')).toMatchObject({ id: second.id, state: 'running' })
    expect(runflows.latest('podL')?.results.map((r) => r.path)).toEqual(['b.json', 'c.json'])   // its graphs are what the window re-ticks
    expect(runflows.latest('another-pod')).toBeNull()
    runflows.cancel(second.id); await finish(second.id)
    expect(runflows.latest('podL')?.id).toBe(second.id)   // newest wins once nothing is running
  })

  it('a rejected prompt (400) is a failed graph with the bad node named, and the run goes on to the next', async () => {
    const c = fakeComfy({ reject: { error: { message: 'Prompt outputs failed validation' }, node_errors: { '3': { class_type: 'LoadVideo', errors: [{ message: 'Value not in list' }] } } } })
    const j = await finish((await runflows.run('pod1', ['a.json', 'b.json'], opts(c))).id)
    expect(j.results.every((r) => r.state === 'failed')).toBe(true); expect(j.results[0].error).toMatch(/node 3 \(LoadVideo\): Value not in list/); expect(j.state).toBe('failed')
    expect(history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'run' && e.state === 'failed')).toHaveLength(2)
  })

  it('a conversion that fails, or a file that is not a UI graph, is logged and the next graph still runs', async () => {
    const c = fakeComfy({ history: { p1: { status: { status_str: 'success' }, outputs: {} } } })
    let n = 0
    const j = await finish((await runflows.run('pod1', ['a.json', 'b.json'], opts(c, { convert: async () => { if (n++ === 0) throw new Error('page never loaded'); return API } }))).id)
    expect(j.results[0]).toMatchObject({ state: 'failed', error: 'page never loaded' }); expect(j.results[1].state).toBe('done')
    const c2 = fakeComfy({ notUi: true })
    const j2 = await finish((await runflows.run('pod1', ['a.json'], opts(c2))).id)
    expect(j2.results[0].error).toMatch(/not a UI graph/)
  })

  it('a pod that is not running is refused, and cancelling skips what has not run and interrupts the one that has', async () => {
    const off = { fetchFn: (async () => ({ status: 200, ok: true, json: async () => ({ data: { pod: { id: 'pod1', name: 'x', desiredStatus: 'EXITED' } } }) })) as unknown as typeof fetch, apiKey: 't' }
    await expect(runflows.run('pod1', ['a.json'], { client: off })).rejects.toThrow(/not running/)
    const c = fakeComfy()   // history never answers: the graph runs "forever"
    const j0 = await runflows.run('pod1', ['a.json', 'b.json'], opts(c))
    await new Promise((r) => setTimeout(r, 60)); runflows.cancel(j0.id)
    const j = await finish(j0.id)
    expect(j.state).toBe('cancelled'); expect(j.results.map((r) => r.state)).toEqual(['skipped', 'skipped']); expect(c.calls.interrupts).toBe(1)
  })
  it('filesOf: the files a run produced, saved ones before previews, loader echoes (type input) left out, a kind from the extension', () => {
    const files = runflows.filesOf({
      '9': { images: [{ filename: 'prev_00001_.png', subfolder: '', type: 'temp' }] },
      '12': { images: [{ filename: 'out_00001_.png', subfolder: 'r1', type: 'output' }], animated: [false], gifs: [{ filename: 'clip.mp4', subfolder: '', type: 'output' }] },
      '30': { audio: [{ filename: 'a.wav', subfolder: '', type: 'output' }], files: [{ filename: 'seq.exr', subfolder: '', type: 'output' }] },
      '4': { images: [{ filename: 'source.mov', subfolder: '', type: 'input' }] },
    })
    expect(files.map((f) => `${f.type}:${f.filename}:${f.kind}`)).toEqual(['output:out_00001_.png:image', 'output:clip.mp4:video', 'output:a.wav:audio', 'output:seq.exr:other', 'temp:prev_00001_.png:image'])
    expect(files[0]).toMatchObject({ subfolder: 'r1', node: '12' })
    expect(runflows.filesOf(undefined)).toEqual([])
  })

})
