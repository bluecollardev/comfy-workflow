import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as pods from '../src/pods.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_NAMES_FILE = join(dir, 'names.json'); process.env.RUNPOD_DRY_RUN = '1' })

describe('history', () => {
  it('lists events newest first, narrows by kind, and ignores a torn line', () => {
    history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'A' }, () => new Date('2026-11-04T10:00:00Z'))
    history.record({ kind: 'job', job: 'pull', state: 'done', what: 'round-1', files: 3 }, () => new Date('2026-11-04T11:00:00Z'))
    expect(history.list().map((e) => e.kind)).toEqual(['job', 'pod'])
    expect(history.list({ kind: 'pod' })).toHaveLength(1)
    expect(history.list({ limit: 1 })).toHaveLength(1)
  })
  it('works out spend from start and stop events; a running pod counts to now; a zero price costs nothing', () => {
    const at = (h: number) => () => new Date(Date.UTC(2026, 10, 4, h))
    history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'A', cost_per_hr: 4 }, at(10))
    history.record({ kind: 'pod', action: 'stopped', pod_id: 'a', name: 'A' }, at(11))
    history.record({ kind: 'pod', action: 'started', pod_id: 'a', name: 'A', cost_per_hr: 4 }, at(12))
    history.record({ kind: 'pod', action: 'created', pod_id: 'b', name: 'B', cost_per_hr: 0 }, at(12))
    const s = history.spend(new Date(Date.UTC(2026, 10, 4, 14)))
    expect(s.total).toBe(12)             // 1 h + 2 h (still running) at $4
    expect(s.running_now).toBe(2)
    expect(s.sessions.find((x) => x.pod_id === 'b')?.cost).toBe(0)
    expect(s.by_day).toEqual([{ day: '2026-11-04', cost: 12 }])
  })
  it('pod actions record themselves (dry mode)', async () => {
    const { create } = await import('../src/dry.js')
    const p = create({ name: 'Dev', gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })
    await pods.stop(p.id); await pods.resume(p.id); await pods.rename(p.id, 'plates'); await pods.remove(p.id)
    await new Promise((r) => setTimeout(r, 50))
    expect(history.list({ kind: 'pod' }).map((e) => (e as history.PodEvent).action).sort()).toEqual(['deleted', 'renamed', 'started', 'stopped'])
  })
})

describe('history export', () => {
  it('exports json (events and spend) and csv (events, or spend sessions), quoting what needs it', () => {
    history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'cgi, "042"', cost_per_hr: 4 }, () => new Date('2026-11-04T10:00:00Z'))
    history.record({ kind: 'job', job: 'pull', state: 'failed', what: 'r1', files: 2, bytes: 9, error: 'no\nspace' }, () => new Date('2026-11-04T11:00:00Z'))
    const now = new Date('2026-11-04T12:00:00Z')
    const j = history.exportHistory({ now })
    expect(j.name).toBe('pod-manager-history-2026-11-04.json')
    expect(JSON.parse(j.text)).toMatchObject({ format: 'pod-manager-history', events: [{ kind: 'job' }, { kind: 'pod' }], spend: { total: 8 } })
    const c = history.exportHistory({ format: 'csv', now })
    expect(c.text.split('\n')[0]).toBe('time,kind,action,name,pod_id,gpu,datacenter,cost_per_hr,state,files,bytes,detail,source,tool,approved_by')
    expect(c.text).toContain('"cgi, ""042"""'); expect(c.text).toContain('"no\nspace"')
    expect(history.exportHistory({ format: 'csv', what: 'spend', now }).text).toContain('pod_id,name,gpu')
  })
})

describe('history observe', () => {
  it('records pods started, stopped or deleted outside the app, once, and baselines unseen stopped pods', () => {
    const t = (m: number) => () => new Date(Date.UTC(2026, 10, 4, 10, m))
    const live = (status: 'running' | 'stopped') => [{ id: 'a', name: 'A', status, gpu: 'A40', datacenter: 'EU-SE-1', cost_per_hr: 0.59 }, { id: 'z', name: 'Z', status: 'stopped' as const }]
    expect(history.observe(live('running'), t(0))).toBe(1)          // a: created (z is only a baseline)
    expect(history.observe(live('running'), t(1))).toBe(0)          // nothing changed
    expect(history.observe(live('stopped'), t(30))).toBe(1)         // a: stopped
    expect(history.observe(live('running'), t(60))).toBe(1)         // a: started
    expect(history.observe([], t(90))).toBe(1)                      // a: deleted
    expect(history.list({ kind: 'pod' }).map((e) => (e as history.PodEvent).action)).toEqual(['deleted', 'started', 'stopped', 'created'])
    expect(history.spend(new Date(Date.UTC(2026, 10, 4, 12))).total).toBeCloseTo(0.59 * 0.5 + 0.59 * 0.5, 1)   // created→stopped 30 min, started→deleted 30 min
  })
  it('an event the action recorded and observe saw is one event', () => {
    history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'A', cost_per_hr: 1 }, () => new Date())
    history.observe([{ id: 'a', name: 'A', status: 'starting' }])
    expect(history.list({ kind: 'pod' })).toHaveLength(1)
  })
})

describe('history onChange', () => {
  it('tells listeners after each recorded event, until they unsubscribe, and a failing listener does not break a record', () => {
    let n = 0
    const off = history.onChange(() => { n++ })
    const bad = history.onChange(() => { throw new Error('x') })
    history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'A' }, () => new Date('2026-11-04T10:00:00Z'))
    history.record({ kind: 'job', job: 'sync', state: 'done', what: 'x' })
    expect(n).toBe(2)
    off(); bad()
    history.record({ kind: 'job', job: 'sync', state: 'done', what: 'y' })
    expect(n).toBe(2); expect(history.list()).toHaveLength(3)
  })
})

describe('history origin and changes', () => {
  it('events recorded under runAs say they came from MCP, with the tool and the approver; change events list', async () => {
    await history.runAs({ source: 'mcp', tool: 'create_pod', approved_by: 'Lucas' }, async () => { await Promise.resolve(); history.record({ kind: 'pod', action: 'created', pod_id: 'a', name: 'A' }) })
    history.record({ kind: 'change', area: 'volume', action: 'created', what: 'vol', detail: '100 GB in EU-RO-1' })
    const ev = history.list()
    expect(ev.find((e) => e.kind === 'pod')).toMatchObject({ source: 'mcp', tool: 'create_pod', approved_by: 'Lucas' })
    expect(ev.find((e) => e.kind === 'change')?.source).toBeUndefined()   // the app's own: no source written, read as the app
    expect(history.list({ kind: 'change' })).toHaveLength(1)
    expect(history.exportHistory({ format: 'csv' }).text.split('\n')[0]).toContain('source,tool,approved_by')
  })
  it('a volume, a pod recreate and a configuration save are recorded (dry mode)', async () => {
    const vols = await import('../src/volumes.js'); const mounts = await import('../src/mounts.js'); const dry = await import('../src/dry.js'); const pods = await import('../src/pods.js')
    process.env.VOLUMES_DRY_FILE = join(dir, 'dryvols.json')
    mounts.put({ ...mounts.load() })
    const p = dry.create({ name: 'R', gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })
    await pods.recreate(p.id)
    const ch = history.list({ kind: 'change' }).map((e) => (e as history.ChangeEvent).what)
    expect(ch).toContain('Default Configuration')
    expect(history.list({ kind: 'pod' }).some((e) => (e as history.PodEvent).action === 'recreated')).toBe(true)
  })
})
