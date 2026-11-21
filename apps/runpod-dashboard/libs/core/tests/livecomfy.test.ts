import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scratch } from './helpers.js'
import * as livecomfy from '../src/livecomfy.js'
import * as jobsregistry from '../src/jobsregistry.js'
import * as runflows from '../src/runflows.js'
import type { Checkpoint } from '../src/autochunk.js'

/** A fake ComfyUI websocket: the test sends events through `emit`, closes it with `drop`. */
class FakeWs implements livecomfy.WsLike {
  onopen: ((e: unknown) => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onclose: ((e: { code?: number }) => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  open() { this.onopen?.({}) }
  emit(type: string, data: Record<string, unknown>) { this.onmessage?.({ data: JSON.stringify({ type, data }) }) }
  drop(code = 1006) { this.onclose?.({ code }) }
  close() { this.closed = true }
}
const GRAPH = { '3': { class_type: 'UNETLoader', _meta: { title: 'Load Diffusion Model' } }, '7': { class_type: 'SeedVR2VideoUpscaler', _meta: { title: 'SeedVR2 sampling' } } }
function rig(over: Partial<livecomfy.LiveOpts> = {}) {
  const sockets: FakeWs[] = [], seen: ReturnType<livecomfy.LiveHandle['current']>[] = [], timers: Array<{ fn: () => void; ms: number }> = []
  let t = 1_000_000
  const h = livecomfy.start({ baseUrl: 'https://abc-8188.proxy.runpod.net', clientId: 'pod-manager-runflows', onLive: (l) => seen.push(l), now: () => t, wsFactory: (u) => { const s = new FakeWs(u); sockets.push(s); return s }, setTimer: (fn, ms) => { const x = { fn, ms }; timers.push(x); return x }, clearTimer: (x) => { const i = timers.indexOf(x as never); if (i >= 0) timers.splice(i, 1) }, ...over })
  h.setGraph(GRAPH)
  return { h, sockets, seen, timers, tick: (ms: number) => { t += ms } }
}

describe('livecomfy: ComfyUI\'s own events become the live progress of a run', () => {
  it('connects to /ws with the client id (https becomes wss) and reads execution_start, executing, progress into node, step and percent', () => {
    const { h, sockets } = rig()
    expect(sockets[0].url).toBe('wss://abc-8188.proxy.runpod.net/ws?clientId=pod-manager-runflows')
    sockets[0].open(); expect(h.current()).toMatchObject({ state: 'waiting', reason: 'waiting for the next step' })
    sockets[0].emit('execution_start', { prompt_id: 'p1' }); expect(h.current()).toMatchObject({ state: 'live', prompt_id: 'p1' })
    sockets[0].emit('executing', { node: '7', prompt_id: 'p1' }); expect(h.current()).toMatchObject({ node: '7', node_class: 'SeedVR2VideoUpscaler', node_title: 'SeedVR2 sampling' })
    sockets[0].emit('progress', { value: 3, max: 12, node: '7', prompt_id: 'p1' }); expect(h.current()).toMatchObject({ step: 3, max: 12, percent: 25, node_title: 'SeedVR2 sampling' })
    sockets[0].emit('executing', { node: null, prompt_id: 'p1' }); const c = h.current(); expect(c.state).toBe('waiting'); expect(c.node).toBeUndefined(); expect(c.step).toBeUndefined()
  })
  it('reads progress_state (the newer event) and status (queue_remaining); binary frames and bad JSON are ignored', () => {
    const { h, sockets } = rig()
    sockets[0].open()
    sockets[0].emit('progress_state', { prompt_id: 'p2', nodes: { '3': { value: 1, max: 1, state: 'finished', node_id: '3' }, '7': { value: 6, max: 8, state: 'running', node_id: '7', display_node_id: '7' } } })
    expect(h.current()).toMatchObject({ node: '7', node_title: 'SeedVR2 sampling', step: 6, max: 8, percent: 75 })
    sockets[0].emit('status', { status: { exec_info: { queue_remaining: 2 } } }); expect(h.current().queue_remaining).toBe(2)
    const before = JSON.stringify(h.current())
    sockets[0].onmessage?.({ data: new ArrayBuffer(8) }); sockets[0].onmessage?.({ data: '{not json' })
    expect(JSON.stringify(h.current())).toBe(before)
  })
  it('handles at most 4 events a second per run: progress ticks beyond that are dropped, the terminal events never', () => {
    const { h, sockets, seen } = rig()
    sockets[0].open(); const base = seen.length
    for (let v = 1; v <= 10; v++) sockets[0].emit('progress', { value: v, max: 12, node: '7' })
    expect(seen.length - base).toBe(4); expect(h.current().step).toBe(4)
    sockets[0].emit('executing', { node: null, prompt_id: 'p1' }); expect(h.current().state).toBe('waiting')   // a terminal event passes the cap
  })
  it('a dropped socket reconnects with a growing wait and the live state reads `waiting` meanwhile', () => {
    const { h, sockets, timers } = rig()
    sockets[0].open(); sockets[0].drop(1006)
    expect(h.current()).toMatchObject({ state: 'waiting', reason: 'reconnecting' }); expect(timers).toHaveLength(1); expect(timers[0].ms).toBe(1000)
    timers.shift()!.fn(); expect(sockets).toHaveLength(2); sockets[1].open(); sockets[1].drop(); expect(timers[0].ms).toBe(1000)   // an open resets the failures
    timers.shift()!.fn(); sockets[2].drop(); expect(timers[0].ms).toBe(2000)
  })
  it('no socket at all (the proxy refuses it every time): `none` with the reason, retried slowly, the run is never touched', () => {
    const { h, sockets, timers } = rig()
    sockets[0].drop(403)
    for (let i = 0; i < 3; i++) { timers.shift()!.fn(); sockets[sockets.length - 1].drop(403) }
    expect(h.current().state).toBe('none'); expect(h.current().reason).toContain('no live progress'); expect(h.current().reason).toContain('403')
    expect(timers[0].ms).toBeGreaterThanOrEqual(4000)
  })
  it('a runtime without WebSocket (the factory throws) is `none` too, and close() stops everything', () => {
    const t: Array<{ fn: () => void; ms: number }> = []
    const h = livecomfy.start({ baseUrl: 'http://x', clientId: 'c', onLive: () => undefined, wsFactory: () => { throw new Error('no WebSocket in this runtime') }, setTimer: (fn, ms) => { const x = { fn, ms }; t.push(x); return x }, clearTimer: (x) => { const i = t.indexOf(x as never); if (i >= 0) t.splice(i, 1) }, failAfter: 1 })
    expect(h.current()).toMatchObject({ state: 'none' }); expect(h.current().reason).toContain('no WebSocket')
    h.close(); expect(t).toHaveLength(0)
  })
  it('close() drops the socket and no reconnect follows', () => {
    const { h, sockets, timers } = rig()
    sockets[0].open(); h.close(); expect(sockets[0].closed).toBe(true)
    sockets[0].drop(); expect(timers).toHaveLength(0); expect(sockets).toHaveLength(1)
  })
  it('a listener that throws never breaks the socket', () => {
    const { sockets } = rig({ onLive: () => { throw new Error('boom') } })
    sockets[0].open(); expect(() => sockets[0].emit('progress', { value: 1, max: 2, node: '7' })).not.toThrow()
  })
})

describe('the shared record carries only what is small', () => {
  it('cleanLive keeps numbers and short names, and cleanRun the run facts', () => {
    const l = jobsregistry.cleanLive({ state: 'live', ts: 5, node: '7', node_title: 'x'.repeat(200), step: 3, max: 12, percent: 25.04, prompt_id: 'p', reason: 'r'.repeat(300), ...({ secret: 'k' } as object) } as never)!
    expect(l.node_title!.length).toBe(80); expect(l.reason!.length).toBe(120); expect(l.percent).toBe(25); expect('secret' in l).toBe(false)
    expect(jobsregistry.cleanRun({ pod_id: 'p', pod_name: 'n', element: 'e', path: 'a/b.json', frames_done: 1, frames_total: 2, chunk: 1, chunks: 2 })).toMatchObject({ frames_total: 2 })
    expect(jobsregistry.cleanLive(undefined)).toBeUndefined()
  })
})

describe('the run row: element, frames done, chunk k of n, rate and ETA from the checkpoint', () => {
  it('elementOf turns a graph path into shot and element', () => {
    expect(runflows.elementOf('base_v008/cgi-072/cgi-072__backhalf-b__base_v008.json')).toBe('cgi-072 backhalf-b')
    expect(runflows.elementOf('a/plain.json')).toBe('plain')
  })
  it('progressOf counts the frames of the done chunks (capped), the chunk after them, an average rate and an ETA; a range limits the total', () => {
    const cp = { version: 1, phase: 'main', win: { first: 1, last: 209, startNumber: 0, sourceStart: 1 }, pad: 8, guardPct: 85, targetPct: 60, maxChunk: 50, size: 28,
      plan: [{ n: 1, first: 11, last: 38 }, { n: 2, first: 39, last: 66 }, { n: 3, first: 67, last: 94 }], states: { '11-38': { state: 'done' }, '39-66': { state: 'done' }, '67-94': { state: 'running', prompt_id: 'x' } } } as unknown as Checkpoint
    const pg: runflows.RunProgress = { element: 'e', frames_done: 0, frames_total: 0, chunk: 0, chunks: 0, started_at: '' }
    runflows.progressOf(pg, cp, 0, 1_680_000)   // 56 frames in 1,680 s: 30 s a frame
    expect(pg).toMatchObject({ frames_total: 209, frames_done: 56, chunks: 3, chunk: 3, rate_spf: 30 })
    expect(new Date(pg.eta!).getTime()).toBe(1_680_000 + (209 - 56) * 30_000)
    runflows.progressOf(pg, { ...cp, range: { first: 100, last: 149 } } as Checkpoint, 0, 1_680_000)
    expect(pg.frames_total).toBe(50); expect(pg.frames_done).toBe(50)
    runflows.progressOf(pg, { ...cp, states: {} } as Checkpoint, 0, 1000); expect(pg.frames_done).toBe(0); expect(pg.rate_spf).toBeUndefined(); expect(pg.chunk).toBe(1)
  })
  it('jobsList shows another process\'s chunked run from the shared registry with its run facts and live object, newest running first, and leaves a plain render job out', async () => {
    const dir = scratch(); process.env.POD_MANAGER_CONFIG_DIR = dir
    try {
      jobsregistry.reset(); jobsregistry.setDeps({ pid: () => 100, alive: () => true, now: () => Date.parse('2026-11-21T10:10:00Z') })
      const at = '2026-11-21T10:09:59.000Z'
      writeFileSync(join(dir, 'jobs-running.json'), JSON.stringify({ jobs: {
        a: { id: 'a', kind: 'render', pid: 200, host: 'h', trigger: 'manual', origin: 'mcp', mcp_client: 'claude-code', started_at: '2026-11-21T10:00:00Z', heartbeat_at: at, state: 'running', label: 'chunked run base_v008/x/photoreal-013__top__base_v008.json', progress: { done: 3, total: 8, unit: 'chunks' },
          live: { state: 'live', node: '7', node_title: 'SeedVR2 sampling', step: 3, max: 12, percent: 25, ts: 1 }, run: { pod_id: 'kqdx', pod_name: 'top pod', element: 'photoreal-013 top', path: 'base_v008/x/photoreal-013__top__base_v008.json', frames_done: 122, frames_total: 209, chunk: 4, chunks: 8, rate_spf: 29 } },
        b: { id: 'b', kind: 'render', pid: 200, host: 'h', trigger: 'manual', origin: 'window', started_at: '2026-11-21T10:05:00Z', heartbeat_at: at, state: 'rendering', label: 'review of s01' },
      } }))
      await jobsregistry.refresh()
      const rows = runflows.jobsList()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ job_id: 'a', external: true, state: 'running', pod_name: 'top pod', element: 'photoreal-013 top', frames_done: 122, frames_total: 209, chunk: 4, chunks: 8, rate_spf: 29, client: 'claude-code', live: { node_title: 'SeedVR2 sampling', percent: 25 } })
    } finally { delete process.env.POD_MANAGER_CONFIG_DIR; jobsregistry.reset() }
  })
})
