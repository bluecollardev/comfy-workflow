// A dropped connection to RunPod is retried (reads), never for a write that may have gone through, and ends in a clear message (seen on Binc's PC: `TypeError: fetch failed` from a sync plan).
import { describe, it, expect } from 'vitest'
import * as rp from '../src/runpod.js'
import { CoreError } from '../src/errors.js'

const net = (code?: string) => Object.assign(new TypeError('fetch failed'), code ? { cause: { code } } : {})
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const client = (fn: () => Promise<Response>) => ({ apiKey: 'k', fetchFn: (async () => fn()) as unknown as typeof fetch })

describe('RunPod network retries', () => {
  it('a read that fails once with fetch failed is tried again and succeeds', async () => {
    let n = 0
    const r = await rp.graphql<{ x: number }>('query { x }', client(async () => { if (++n === 1) throw net('ECONNRESET'); return ok({ x: 1 }) }))
    expect(r).toEqual({ x: 1 }); expect(n).toBe(2)
  })
  it('three failures end as one clear error, not TypeError: fetch failed', async () => {
    let n = 0
    const e = await rp.graphql('query { x }', client(async () => { n++; throw net('ETIMEDOUT') })).catch((x) => x)
    expect(n).toBe(3); expect(e).toBeInstanceOf(CoreError); expect(e.status).toBe(503)
    expect(e.message).toMatch(/Could not reach RunPod's API/); expect(e.message).toMatch(/ETIMEDOUT/); expect(e.message).not.toMatch(/TypeError/)
  })
  it('a 502/503/504 on a read is retried, a 500 is not', async () => {
    let n = 0
    const r = await rp.graphql<{ y: number }>('query { y }', client(async () => (++n < 3 ? new Response('bad', { status: 503 }) : ok({ y: 2 }))))
    expect(r).toEqual({ y: 2 }); expect(n).toBe(3)
  })
  it('a mutation is NOT repeated after a reset (it may have gone through): one try, the raw error', async () => {
    let n = 0
    const e = await rp.graphql('mutation { podStop }', client(async () => { n++; throw net('ECONNRESET') })).catch((x) => x)
    expect(n).toBe(1); expect(e).toBeInstanceOf(TypeError)
  })
  it('a mutation IS repeated when the request provably never left (DNS), and keeps the raw error at the end', async () => {
    let n = 0
    const e = await rp.graphql('mutation { podStop }', client(async () => { n++; throw net('ENOTFOUND') })).catch((x) => x)
    expect(n).toBe(3); expect(rp.hostUnreachable(e)).toBe(true)
  })
  it('a CoreError (an answer from RunPod) is never retried', async () => {
    let n = 0
    const e = await rp.graphql('query { x }', client(async () => { n++; return new Response('', { status: 401 }) })).catch((x) => x)
    expect(n).toBe(1); expect(e.status).toBe(401)
  })
  it('isTransientNetwork recognises the cases and not ordinary errors', () => {
    expect(rp.isTransientNetwork(net())).toBe(true)
    expect(rp.isTransientNetwork(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } }))).toBe(true)
    expect(rp.isTransientNetwork(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(true)
    expect(rp.isTransientNetwork(new Error('boom'))).toBe(false)
    expect(rp.isTransientNetwork(new CoreError(502, 'x'))).toBe(false)
  })
})
