import { beforeEach, describe, expect, it } from 'vitest'
import * as idle from '../src/idle.js'
import { scratch } from './helpers.js'

beforeEach(() => { scratch() })
const minutesAgo = (now: Date, n: number) => new Date(now.getTime() - n * 60_000).toISOString()

describe('idle', () => {
  it('decides from the probe', () => {
    const now = new Date()
    const e = { minutes: 30, last_activity: minutesAgo(now, 45), last_prompt: 'a' }
    expect(idle.decide(e, { busy: true, last_prompt: 'a', reachable: true }, now)[1]).toBe(false)          // rendering: never stop
    const [e2, stop] = idle.decide(e, { busy: false, last_prompt: 'b', reachable: true }, now)             // a new prompt finished: activity
    expect(stop).toBe(false); expect(e2.last_prompt).toBe('b'); expect(e2.last_activity).toBe(now.toISOString())
    expect(idle.decide(e, { busy: false, last_prompt: 'a', reachable: true }, now)[1]).toBe(true)          // quiet 45 > 30 min
    expect(idle.decide(e, { busy: false, last_prompt: null, reachable: false }, now)[1]).toBe(true)        // unreachable still bills
    expect(idle.decide({ minutes: 30, last_activity: minutesAgo(now, 10), last_prompt: null }, { busy: false, last_prompt: null, reachable: true }, now)[1]).toBe(false)
    // a young pod that answers nothing is still pulling its image, not idle: its clock restarts
    const young = idle.decide(e, { busy: false, last_prompt: null, reachable: false }, now, 120)
    expect(young[1]).toBe(false); expect(young[0].last_activity).toBe(now.toISOString())
    expect(idle.decide(e, { busy: false, last_prompt: null, reachable: false }, now, 20 * 60)[1]).toBe(true)   // old enough and silent: stop
    expect(idle.decide(e, { busy: false, last_prompt: 'a', reachable: true }, now, 120)[1]).toBe(true)        // young but answering and quiet 45 min: the rule holds
  })

  it('registers, forgets and sweeps', async () => {
    const now = new Date()
    idle.register('p1', 30, new Date(now.getTime() - 2 * 3600_000)); idle.register('p2', 30, new Date(now.getTime() - 2 * 3600_000)); idle.register('p3', 0)
    expect(Object.keys(idle.load()).sort()).toEqual(['p1', 'p2'])
    const stopped: string[] = []
    const out = await idle.sweep(() => new Map([['p1', 3600], ['p2', 3600]]), (id) => { stopped.push(id) }, async (id) => ({ busy: id === 'p2', last_prompt: null, reachable: true }), now)
    expect(out).toEqual(['p1']); expect(stopped).toEqual(['p1']); expect(Object.keys(idle.load())).toEqual(['p2'])   // p2 is rendering, kept
    idle.register('p3', 30, new Date(now.getTime() - 2 * 3600_000))
    const out2 = await idle.sweep(() => new Map([['p3', 60]]), (id) => { stopped.push(id) }, async () => ({ busy: false, last_prompt: null, reachable: false }), now)
    expect(out2).toEqual([])   // p3 is a minute old and silent: still starting, not stopped
    idle.forget('p2'); expect(idle.entry('p2')).toBeUndefined()
    expect(idle.proxyUrl('abc')).toBe('https://abc-8188.proxy.runpod.net')
  })
})
