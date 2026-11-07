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
    const s = ui2api.podScript(UI); expect(s).toContain('python3 /opt/comfy-app/ui2api.py'); expect(s).not.toContain('"nodes"')
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

  it('converts, queues and waits; an ok run and a failing run are both in the History, the error with its node', async () => {
    const c = fakeComfy({ history: { p1: { status: { status_str: 'success' }, outputs: { '9': {} } }, p2: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'boom', node_id: '4', node_type: 'KSampler' }]] } } } })
    const j0 = await runflows.run('pod1', ['rounds/r/a.json', 'rounds/r/b.json'], opts(c))
    const j = await finish(j0.id)
    expect(j.results.map((r) => r.state)).toEqual(['done', 'failed']); expect(j).toMatchObject({ ok: 1, failed: 1, state: 'done' })
    expect(j.results[1].error).toBe('boom (node 4, KSampler)')
    expect(c.calls.queued).toHaveLength(2); expect((c.calls.queued[0] as { prompt: unknown }).prompt).toEqual(API)
    const ev = history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'run')
    expect(ev).toHaveLength(2)
    expect(ev.find((e) => e.kind === 'job' && e.what === 'rounds/r/b.json')).toMatchObject({ state: 'failed', error: 'boom (node 4, KSampler)', pod_id: 'pod1' })
    expect(ev.find((e) => e.kind === 'job' && e.what === 'rounds/r/a.json')).toMatchObject({ state: 'done' })
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
})
