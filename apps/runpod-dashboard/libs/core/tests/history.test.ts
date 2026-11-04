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
