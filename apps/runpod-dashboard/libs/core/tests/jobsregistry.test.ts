import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as reg from '../src/jobsregistry.js'
import { scratch } from './helpers.js'

// Jobs of other processes are visible (ADR-050, 'MCP actions are shown in the Queue'). Fake pids and clock; no real process is touched.
let dir: string, t: number, pid: number, alive: Set<number>, cancelled: string[]
const as = (p: number) => reg.setDeps({ pid: () => p, now: () => t, alive: (x) => alive.has(x), heartbeatMs: 10 })
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const job = (id: string, state = 'rendering') => reg.track({ id, kind: 'render', trigger: 'manual', origin: 'mcp', client: 'claude-code', label: 'render review 1 sequence', approved_by: 'Lucas', view: () => ({ state, progress: { done: 5, total: 10, unit: 'frames' } }), cancel: () => { cancelled.push(id) } })
beforeEach(() => { dir = scratch(); t = Date.parse('2026-11-19T10:00:00Z'); pid = 100; alive = new Set([100, 200]); cancelled = []; as(100) })
afterEach(() => reg.reset())

describe('running jobs across processes', () => {
  it('a job of process 100 is listed in process 200 as external with its trigger origin, client, progress and label; the owner does not see it as external; finishing removes it', async () => {
    const stop = job('render-1'); await wait(); as(200); await reg.refresh()
    const [x] = reg.externals('render'); expect(x).toMatchObject({ id: 'render-1', external: true, origin: 'mcp', mcp_client: 'claude-code', trigger: 'manual', state: 'rendering', progress: { done: 5, total: 10 }, label: 'render review 1 sequence', approved_by: 'Lucas', pid: 100 }); expect(reg.externals('publish')).toEqual([])
    as(100); expect(reg.externals('render')).toEqual([]) // its own job is never external in its own process
    stop(); await wait(); as(200); t += 100; await reg.refresh(); expect(reg.externals('render')).toEqual([]); expect(JSON.parse(readFileSync(join(dir, 'jobs-running.json'), 'utf8')).jobs).toEqual({})
  })
  it('a stale heartbeat or a dead pid is shown ONCE as interrupted and cleaned from the file', async () => {
    job('render-2'); await wait(); reg.reset(); as(200); t += 20_000; await reg.refresh()
    const first = reg.externals('render'); expect(first).toEqual([expect.objectContaining({ id: 'render-2', interrupted: true, state: 'interrupted' })]); expect(reg.externals('render')).toEqual([])
    expect(JSON.parse(readFileSync(join(dir, 'jobs-running.json'), 'utf8')).jobs).toEqual({})
    as(100); job('render-3'); await wait(); reg.reset(); as(200); alive.delete(100); t += 100; await reg.refresh(); expect(reg.externals('render')[0]).toMatchObject({ id: 'render-3', interrupted: true })
  })
  it('cancel round trip: another process asks, the owner sees it at its next heartbeat and cancels', async () => {
    job('render-4'); await wait(); as(200); expect(await reg.requestCancel('render-4')).toBe(true); expect(await reg.requestCancel('nope')).toBe(false); as(100); await wait(80); expect(cancelled).toEqual(['render-4'])
  })
  it('a volume job and a sync job of another process appear in volume_jobs (external, origin, client) and in running_jobs, and a terminal job stops publishing itself', async () => {
    const podpull = await import('../src/podpull.js')
    reg.track({ id: 'fetch-x-1', kind: 'volume', trigger: 'manual', origin: 'mcp', client: 'claude-code', label: 'fetch models', view: () => ({ state: 'pulling', progress: { done: 10, total: 100, unit: 'bytes' } }), cancel: () => { cancelled.push('fetch-x-1') } })
    reg.track({ id: 'sync-p-1', kind: 'sync', trigger: 'manual', origin: 'mcp', client: 'claude-code', label: 'sync p', view: () => ({ state: 'syncing' }), cancel: () => undefined })
    await wait(); as(200); await reg.refresh()
    const vj = podpull.volumeJobs().jobs.find((j) => j.id === 'fetch-x-1') as unknown as Record<string, unknown>; expect(vj).toMatchObject({ external: true, origin: 'mcp', mcp_client: 'claude-code', bytes_done: 10, bytes_total: 100 }); expect(reg.externals('sync').map((j) => j.id)).toEqual(['sync-p-1'])
    as(100); let done = false; reg.track({ id: 'volume-done', kind: 'volume', trigger: 'manual', origin: 'window', label: 'x', view: () => ({ state: done ? 'done' : 'pulling', terminal: done }), cancel: () => undefined }); await wait(); done = true; await wait(80)
    as(200); t += 100; await reg.refresh(); expect(reg.externals('volume').map((j) => j.id)).not.toContain('volume-done')
  })
  it('no synchronous file calls in jobsregistry.ts', () => { const src = readFileSync(join(import.meta.dirname, '..', 'src', 'jobsregistry.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); expect(src.match(/\b(readFileSync|writeFileSync|statSync|readdirSync|existsSync|renameSync|mkdirSync)\b/g) ?? []).toEqual([]) })
})
