import { beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as syncruns from '../src/syncruns.js'
import type { SyncEvent } from '../src/syncrun.js'
import { scratch } from './helpers.js'

// ADR-046 "Sync explorer and logs": the registry of every sync run, its log, retention and restart. Fake events; the files are in a scratch folder.
let dir: string, logs: string, index: string, t: number
const mk = () => new syncruns.Registry({ now: () => t, dir: () => logs, file: () => index })
beforeEach(() => { dir = scratch(); logs = join(dir, 'sync-logs'); index = join(dir, 'sync-runs.json'); t = Date.parse('2026-11-18T10:00:00Z') })
const E = (e: Partial<SyncEvent> & { kind: SyncEvent['kind'] }) => e as SyncEvent
const req = (o: Record<string, unknown> = {}) => ({ pod_id: 'p1', direction: 'pull' as const, ...o })

describe('the lifecycle', () => {
  it('queued -> running -> done; failed; cancelled; each ends in recent(), newest first', async () => {
    const r = mk(), a = r.begin(req())
    expect(r.active().items[0]).toMatchObject({ run_id: a.run_id, pod_id: 'p1', direction: 'pull', trigger: 'manual', state: 'queued' })
    a.event(E({ kind: 'plan', steps: [{ key: 'output', local: '/l/', remote: '/r/' }] })); expect(r.active().items[0].state).toBe('running'); expect(r.active().items[0].steps).toEqual([expect.objectContaining({ key: 'output', state: 'waiting' })])
    a.event(E({ kind: 'step', key: 'output', local: '/l/', remote: '/r/', total_files: 2, total_bytes: 200, streams: 2 }))
    a.event(E({ kind: 'file', key: 'output', path: 'a.dpx' })); a.event(E({ kind: 'progress', key: 'output', bytes_done: 100, run_bytes_done: 100, rate_bps: 50, eta_s: 2 }))
    a.event(E({ kind: 'file', key: 'output', path: 'b.dpx' })); a.event(E({ kind: 'step-done', key: 'output', code: 0 }))
    expect(r.active().items[0]).toMatchObject({ streams: 2, bytes_done: 100, rate_bps: 50, eta_s: 2 }); expect(r.active().items[0].steps[0]).toMatchObject({ state: 'done', files_total: 2 })
    t += 5000; a.end({ steps: 1, failed: 0, warned: 0, cancelled: false })
    const b = r.begin(req({ trigger: 'auto-sync:push', direction: 'push' })); t += 1000; b.end(null, 'ssh: refused')
    const c = r.begin(req({ pod_id: 'p2' })); t += 1000; c.end({ cancelled: true })
    expect(r.active().items).toEqual([])
    expect(r.recent().map((x) => `${x.state} ${x.trigger} ${x.pod_id}`)).toEqual(['cancelled manual p2', 'failed auto-sync:push p1', 'done manual p1'])
    expect(r.recent('p1')).toHaveLength(2); expect(r.recent(undefined, 1)).toHaveLength(1)
    expect(r.recent()[2]).toMatchObject({ files: 2, bytes: 100, summary: expect.stringMatching(/^2 files/), error: '', started_at: '2026-11-18T10:00:00.000Z' })
    expect(r.recent()[1]).toMatchObject({ error: 'ssh: refused', summary: expect.stringMatching(/^Failed: ssh/) })
    await r.settled()
  })
  it('manual and automatic runs are listed together, each with its trigger', () => {
    const r = mk(); r.begin(req()); r.begin(req({ pod_id: 'p2', trigger: 'auto-sync:output', paths: ['output/a'], path_sizes: { 'output/a': 7 } }))
    const items = r.active().items; expect(items.map((i) => i.trigger).sort()).toEqual(['auto-sync:output', 'manual']); expect(items.find((i) => i.pod_id === 'p2')).toMatchObject({ files_total: 1, bytes_total: 7 })
  })
  it('never throws into the sync: bad events and a double end are ignored', () => {
    const r = mk(), h = r.begin(req()); expect(() => { h.event(null as never); h.end(null); h.end(null) }).not.toThrow(); expect(r.recent()).toHaveLength(1)
  })
})

describe('current_files and recent_files', () => {
  it('N streams give N files in flight (at most 8); the finished ones go to recent_files (the last 20)', () => {
    const r = mk(), h = r.begin(req({ path_sizes: { 'x/f0': 100 } }))
    h.event(E({ kind: 'plan', steps: [{ key: 'output', local: '', remote: '' }] })); h.event(E({ kind: 'step', key: 'output', streams: 4 }))
    for (let s = 0; s < 4; s++) h.event(E({ kind: 'file', key: 'output', stream: `p${s}`, path: `x/f${s}` }))
    expect(r.active().items[0].current_files.map((f) => f.path)).toEqual(['x/f0', 'x/f1', 'x/f2', 'x/f3']); expect(r.active().items[0].current_files[0].bytes_total).toBe(100)
    h.event(E({ kind: 'progress', key: 'output', file_percent: 40 })); expect(r.active().items[0].current_files[3].percent).toBe(40)
    h.event(E({ kind: 'file', key: 'output', stream: 'p0', path: 'x/g0' }))
    expect(r.active().items[0].recent_files).toEqual(['x/f0']); expect(r.active().items[0].files_done).toBe(1)
    const h2 = r.begin(req({ pod_id: 'p9' })); for (let s = 0; s < 12; s++) h2.event(E({ kind: 'file', key: 'output', stream: `s${s}`, path: `y/${s}` }))
    expect(r.active().items.find((i) => i.pod_id === 'p9')!.current_files).toHaveLength(8)
    const h3 = r.begin(req({ pod_id: 'p8' })); for (let i = 0; i < 25; i++) h3.event(E({ kind: 'file', key: 'output', path: `z/${i}` }))
    const it = r.active().items.find((x) => x.pod_id === 'p8')!; expect(it.recent_files).toHaveLength(20); expect(it.recent_files.at(-1)).toBe('z/23'); expect(it.current_files.map((f) => f.path)).toEqual(['z/24'])
    h3.end({ cancelled: false }); expect(r.recent('p8')[0].files).toBe(25)   // the last file counts when the run ends
  })
})

describe('the log', () => {
  it('is readable while the run runs; the rsync output, the plan and problems are lines with levels', async () => {
    const r = mk(), h = r.begin(req())
    h.event(E({ kind: 'plan', steps: [{ key: 'output', local: '', remote: '' }] })); h.event(E({ kind: 'line', text: '$ rsync -rlt --files-from /tmp/x host:/w/ ./' })); h.event(E({ kind: 'file', path: 'a.dpx' })); h.event(E({ kind: 'problem', text: 'rsync: chown failed' }))
    const page = await r.log(h.run_id)
    expect(page.lines.map((l) => `${l.level}:${l.text}`)).toEqual(expect.arrayContaining(['info:Plan: 1 folder (output)', 'info:$ rsync -rlt --files-from /tmp/x host:/w/ ./', 'info:a.dpx', 'warn:rsync: chown failed'])); expect(page.truncated).toBe(false)
    expect((await r.log(h.run_id, { level: 'warn' })).lines).toHaveLength(1)   // the warning
    h.event(E({ kind: 'error', text: 'boom' })); expect((await r.log(h.run_id, { level: 'warn' })).lines.map((l) => l.level)).toEqual(['warn', 'error']); expect((await r.log(h.run_id, { level: 'error' })).lines.map((l) => l.level)).toEqual(['error']); expect((await r.log(h.run_id)).lines.length).toBeGreaterThan(3)   // warn = warnings and errors, error = errors only, none = all
    expect(r.recent(null as never)).toEqual([]); expect((await r.log(h.run_id, { offset: 1, limit: 2 })).lines).toHaveLength(2)
    h.end(null, 'boom'); expect((await r.log(h.run_id, { level: 'error' })).lines.map((l) => l.text)).toEqual(['boom', 'Run failed: Failed: boom'])
    await expect(r.log('sr-nope')).rejects.toThrow(/No such sync run/); await expect(r.log('../../etc/passwd')).rejects.toThrow(/No such sync run/)
    await r.settled()
  })
  it('is capped at 5,000 lines: the first 500 and the last 4,500, with an "n lines omitted" line, in memory and on disk', async () => {
    const r = mk(), h = r.begin(req())
    for (let i = 0; i < 6000; i++) h.event(E({ kind: 'line', text: `line ${i}` }))
    const live = await r.log(h.run_id, { limit: 2000 }); expect(live.truncated).toBe(true); expect(live.total).toBe(5001)
    h.end({ failed: 0 }); await r.settled()
    const page = await r.log(h.run_id, { limit: 2000 }); expect(page.total).toBe(5001)   // 500 + the marker + 4,500: the final summary line is among the last
    const all = (await r.log(h.run_id, { offset: 0, limit: 2000 })).lines
    expect(all[0].text).toMatch(/queued/); expect(all[499].text).toBe('line 498'); expect(all[500].text).toMatch(/^\d+ lines omitted$/)
    const onDisk = readFileSync(join(logs, `${h.run_id}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    expect(onDisk).toHaveLength(5001); expect(onDisk.some((l: { text: string }) => /lines omitted$/.test(l.text))).toBe(true); expect(onDisk.at(-1).text).toMatch(/^Run done/); 
  })
})

describe('persistence across a restart', () => {
  it('a new registry reads the index and the log of a finished run from disk', async () => {
    const a = mk(), h = a.begin(req({ trigger: 'auto-sync:feed' })); h.event(E({ kind: 'file', path: 'a.dpx' })); h.end({ failed: 0 }); await a.settled()
    const b = mk(); await b.load()
    expect(b.recent()).toHaveLength(1); expect(b.recent()[0]).toMatchObject({ run_id: h.run_id, trigger: 'auto-sync:feed', state: 'done' })
    expect((await b.log(h.run_id)).lines.some((l) => l.text === 'a.dpx')).toBe(true)
  })
  it('a corrupt index starts empty', async () => { mkdirSync(dir, { recursive: true }); writeFileSync(index, '{nope'); const b = mk(); await b.load(); expect(b.recent()).toEqual([]) })
})

describe('retention: only inside sync-logs', () => {
  const put = (name: string, bytes: number, ageDays: number) => { mkdirSync(logs, { recursive: true }); const f = join(logs, name); writeFileSync(f, 'x'.repeat(bytes)); const s = (t - ageDays * 86_400_000) / 1000; utimesSync(f, s, s); return f }
  it('removes logs older than 14 days and leaves the rest, other files and other folders alone', async () => {
    const old = put('sr-old.jsonl', 10, 20), fresh = put('sr-new.jsonl', 10, 1), other = put('notes.txt', 10, 99), nested = (() => { mkdirSync(join(logs, 'sub')); const f = join(logs, 'sub', 'sr-x.jsonl'); writeFileSync(f, 'x'); utimesSync(f, 1, 1); return f })()
    const outside = join(dir, 'sr-outside.jsonl'); writeFileSync(outside, 'x'); utimesSync(outside, 1, 1)
    expect((await mk().prune()).removed).toBe(1)
    expect(existsSync(old)).toBe(false); expect([fresh, other, nested, outside].every(existsSync)).toBe(true)
  })
  it('then removes the oldest until the folder is under the size cap', async () => {
    const a = put('sr-a.jsonl', 600, 5), b = put('sr-b.jsonl', 600, 3), c = put('sr-c.jsonl', 600, 1)
    expect((await mk().prune({ maxBytes: 1000 })).removed).toBe(2); expect(existsSync(a)).toBe(false); expect(existsSync(b)).toBe(false); expect(existsSync(c)).toBe(true)
  })
  it('a missing folder is nothing to do', async () => { expect(await mk().prune()).toEqual({ removed: 0 }) })
})

describe('answered from memory', () => {
  it('active() and recent() are synchronous', () => { const r = mk(); r.begin(req()); const x = r.active(); expect(Array.isArray(x.items)).toBe(true); expect(Array.isArray(r.recent())).toBe(true) })
})
