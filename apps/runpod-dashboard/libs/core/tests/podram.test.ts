import { afterEach, describe, expect, it } from 'vitest'
import * as podram from '../src/podram.js'
import * as pods from '../src/pods.js'

const GIB = 2 ** 30
const raw = (over: object = {}) => ({ id: 'p1', name: 'x', desiredStatus: 'RUNNING', gpuCount: 2, machine: { gpuDisplayName: 'RTX PRO 4500' }, runtime: { uptimeInSeconds: 5 }, ...over }) as never
const tick = () => new Promise((r) => setTimeout(r, 5))

describe('the card fields from RunPod\'s pod', () => {
  it('carries the count and the total VRAM; vram stays per card', () => {
    expect(pods.toStatus(raw())).toMatchObject({ gpu: 'RTX PRO 4500', vram: 32, gpu_count: 2, vram_total: 64 })
    expect(pods.toStatus(raw({ gpuCount: 1 }))).toMatchObject({ vram: 32, gpu_count: 1, vram_total: 32 })
  })
  it('a missing or zero count is 1', () => {
    expect(pods.toStatus(raw({ gpuCount: undefined })).gpu_count).toBe(1)
    expect(pods.toStatus(raw({ gpuCount: 0 })).vram_total).toBe(32)
  })
  it('the dashboard total counts every card', () => {
    expect(pods.stats([pods.toStatus(raw()), pods.toStatus(raw({ gpuCount: 1 }))]).total_vram).toBe(96)
  })
  it('has no RAM until it is read', () => { expect(pods.toStatus(raw()).ram_gb).toBeUndefined() })
})

describe('the RAM source: the container cgroup, cached, never waited for', () => {
  afterEach(() => { podram.setReader(null); podram.clear() })
  it('turns a cgroup reading into GiB, source cgroup', () => {
    expect(podram.toFields({ used: 40 * GIB, limit: 116.4 * GIB, pct: 34.4 })).toEqual({ ram_gb: 116.4, ram_used_gb: 40, ram_pct: 34.4, ram_source: 'cgroup' })
    expect(podram.toFields({ used: 1, limit: 57.7 * GIB, pct: 0 })?.ram_gb).toBe(57.7)
  })
  it('no figure without a limit or a reading', () => { expect(podram.toFields(null)).toBeNull(); expect(podram.toFields({ used: 1, limit: 0, pct: 0 })).toBeNull() })
  it('the first peek is empty and starts one read; the next has the figure; reads are cached', async () => {
    let n = 0
    podram.setReader(async () => { n++; return { used: GIB, limit: 87.5 * GIB, pct: 1.1 } })
    expect(podram.peek('p1')).toBeNull(); expect(podram.peek('p1')).toBeNull()   // second call while in flight: still one read
    await tick()
    expect(podram.peek('p1')).toMatchObject({ ram_gb: 87.5, ram_source: 'cgroup' })
    expect(n).toBe(1)
  })
  it('an unreachable pod stays unknown and is not retried inside the failure window', async () => {
    let n = 0
    podram.setReader(async () => { n++; throw new Error('ssh') })
    podram.peek('p2'); await tick()
    expect(podram.peek('p2')).toBeNull(); expect(podram.peek('p2', Date.now() + podram.TTL_MS + 1)).toBeNull()
    expect(n).toBe(1)
    podram.peek('p2', Date.now() + podram.FAIL_TTL_MS + 1); await tick()
    expect(n).toBe(2)
  })
  it('forget drops the figure of a stopped pod', async () => {
    podram.setReader(async () => ({ used: 1, limit: GIB, pct: 0 }))
    podram.peek('p3'); await tick()
    podram.forget('p3'); podram.setReader(async () => null)
    expect(podram.peek('p3')).toBeNull()
  })
})
