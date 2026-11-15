import { beforeEach, describe, expect, it } from 'vitest'
import * as rl from '../src/ratelimit.js'
import * as rp from '../src/runpod.js'
import * as volumes from '../src/volumes.js'
import * as pods from '../src/pods.js'
import * as mounts from '../src/mounts.js'
import { scratch } from './helpers.js'

let t = 1_000_000
beforeEach(() => { scratch(); delete process.env.RUNPOD_DRY_RUN; delete process.env.MOUNTS_FILE; rl.reset(); t = 1_000_000; rl.setClock(() => t) })

/** A fetch that answers from a queue of [status, body] and counts its calls. */
function fakeFetch(answers: [number, unknown, Record<string, string>?][]) {
  const calls: string[] = []
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${url}`)
    const [status, body, headers] = answers.length > 1 ? answers.shift()! : answers[0]
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(headers || {}) } })
  }) as unknown as typeof fetch
  return { f, calls }
}
const podsBody = (names: string[]) => ({ data: { myself: { pods: names.map((n, i) => ({ id: `p${i}`, name: n })) } } })
const client = (f: typeof fetch): rp.RunPodClient => ({ apiKey: 'k', fetchFn: f, cache: true })

describe('the cache', () => {
  it('shares one answer for the ttl and one request among concurrent callers', async () => {
    let n = 0
    const fn = async () => { n++; await Promise.resolve(); return { n } }
    const [a, b, c] = await Promise.all([rl.cached('k', 10_000, fn), rl.cached('k', 10_000, fn), rl.cached('k', 10_000, fn)])
    expect(n).toBe(1); expect(a).toBe(b); expect(b).toBe(c)
    t += 5_000; expect(await rl.cached('k', 10_000, fn)).toBe(a); expect(n).toBe(1)
    t += 6_000; expect((await rl.cached('k', 10_000, fn)).n).toBe(2)
  })
  it('a write drops what it changed', async () => {
    let n = 0
    const fn = async () => ++n
    await rl.cached('x|pods', 60_000, fn); rl.invalidate('|pod'); await rl.cached('x|pods', 60_000, fn)
    expect(n).toBe(2)
  })
})

describe('the 429 and its backoff', () => {
  it('reads the window from the message and waits a minute, five minutes, then more', () => {
    expect(rl.windowOf('rate limit exceeded for the minute window')).toBe('minute')
    expect(rl.windowOf('rate limit exceeded for the hour window')).toBe('hour')
    expect(rl.windowOf('slow down')).toBe('unknown')
    const a = rl.noteLimited('rate limit exceeded for the minute window')
    expect(a.window).toBe('minute'); expect(Date.parse(a.retryAt) - t).toBe(60_000)
    rl.reset(); rl.setClock(() => t)
    const h = rl.noteLimited('rate limit exceeded for the hour window')
    expect(Date.parse(h.retryAt) - t).toBe(5 * 60_000)
    t += 5 * 60_000 + 1; rl.guard()                                   // the wait is over: one probe is allowed
    const h2 = rl.noteLimited('rate limit exceeded for the hour window')  // and RunPod still refuses: longer
    expect(Date.parse(h2.retryAt) - t).toBe(10 * 60_000)
  })
  it('Retry-After wins when it is longer', () => {
    const e = rl.noteLimited('rate limit exceeded for the minute window', 300)
    expect(Date.parse(e.retryAt) - t).toBe(300_000)
  })
  it('guard throws while backing off and not after', () => {
    rl.noteLimited('rate limit exceeded for the minute window')
    expect(() => rl.guard()).toThrow(/limiting requests/)
    t += 61_000; expect(() => rl.guard()).not.toThrow()
  })
  it('RunPod answers 429: the last good list is served stale, and nothing hammers it while it backs off', async () => {
    const { f, calls } = fakeFetch([[200, podsBody(['a', 'b'])], [429, 'rate limit exceeded for the hour window']])
    const c = client(f)
    expect((await rp.listPods(c)).map((p) => p.name)).toEqual(['a', 'b'])
    t += 9_000                                                          // past the ttl: asks again, is refused, serves the old list
    expect((await rp.listPods(c)).map((p) => p.name)).toEqual(['a', 'b'])
    const s = rl.status()
    expect(s.limited).toBe(true); expect(s.window).toBe('hour'); expect(s.stale_age_s).toBe(9); expect(s.retry_at).toBeTruthy()
    const before = calls.length
    for (let i = 0; i < 20; i++) await rp.listPods(c)                   // backing off: no request goes out
    expect(calls.length).toBe(before)
  })
  it('with nothing cached the refusal is thrown, as a RateLimited with the window', async () => {
    const { f } = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    await expect(rp.listPods(client(f))).rejects.toMatchObject({ status: 429, window: 'hour' })
  })
  it('a GraphQL error that says rate limit counts the same, and a REST 429 too', async () => {
    const g = fakeFetch([[200, { errors: [{ message: 'API rate limit exceeded for the minute window' }] }]])
    await expect(rp.listPods(client(g.f))).rejects.toMatchObject({ status: 429, window: 'minute' })
    rl.reset(); rl.setClock(() => t)
    const r = fakeFetch([[429, { error: 'rate limit exceeded for the hour window' }, { 'retry-after': '120' }]])
    await expect(rp.listNetworkVolumes(client(r.f))).rejects.toMatchObject({ status: 429, window: 'hour' })
  })
  it('a write still tries while RunPod limits, and says so when refused', async () => {
    rl.noteLimited('rate limit exceeded for the hour window')
    const { f, calls } = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    await expect(rp.stopPod('p1', client(f))).rejects.toMatchObject({ status: 429 })
    expect(calls.length).toBe(1)
  })
  it('the first answer after the wait ends the limit', async () => {
    rl.noteLimited('rate limit exceeded for the minute window')
    t += 61_000
    const { f } = fakeFetch([[200, podsBody(['a'])]])
    await rp.listPods(client(f))
    expect(rl.status().limited).toBe(false)
  })
})

describe('a volume is never "no volume" because RunPod would not list it', () => {
  const setIds = () => { const c = mounts.load(); mounts.put({ ...c, shared_volume_id: 'vol1', network_volume_id: 'vol1', data_center_id: 'EU-RO-1' }, { quiet: true }) }
  it('volumes.list falls back to the last volumes seen, marked stale, with the shared one still shared', async () => {
    setIds()
    const ok = fakeFetch([[200, [{ id: 'vol1', name: 'brynley-rounds', size: 250, dataCenterId: 'EU-RO-1' }]]])
    // the first listing: REST volumes then GraphQL pods
    const first = (async (url: string) => (String(url).includes('/graphql') ? new Response(JSON.stringify(podsBody([])), { status: 200 }) : new Response(JSON.stringify([{ id: 'vol1', name: 'brynley-rounds', size: 250, dataCenterId: 'EU-RO-1' }]), { status: 200 }))) as unknown as typeof fetch
    const list = await volumes.list(client(first))
    expect(list.map((v) => v.name)).toEqual(['brynley-rounds']); expect(list[0].stale).toBeUndefined()
    rl.reset(); rl.setClock(() => t)                                     // a restart: no memory, only the disk
    const limited = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    const again = await volumes.list(client(limited.f))
    expect(again).toHaveLength(1)
    expect(again[0]).toMatchObject({ id: 'vol1', name: 'brynley-rounds', datacenter: 'EU-RO-1', is_shared: true, is_default: true, stale: true })
    void ok
  })
  it('with nothing ever seen the stored ids still make a volume (name = id), never an empty list', async () => {
    setIds()
    const limited = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    const list = await volumes.list(client(limited.f))
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'vol1', name: 'vol1', is_shared: true, stale: true })
  })
  it('volumeInfo answers from the last record, marked stale', async () => {
    setIds()
    rl.rememberVolumes([{ id: 'vol1', name: 'brynley-rounds', size: 250, dataCenterId: 'EU-RO-1' }])
    const limited = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    const v = await pods.volumeInfo('vol1', client(limited.f))
    expect(v).toMatchObject({ id: 'vol1', name: 'brynley-rounds', size_gb: 250, datacenter: 'EU-RO-1', s3: true, stale: true })
  })
  it('volumeInfo with no record gives the id alone, with the configured datacenter', async () => {
    setIds()
    const limited = fakeFetch([[429, 'rate limit exceeded for the hour window']])
    const v = await pods.volumeInfo('vol1', client(limited.f))
    expect(v).toMatchObject({ id: 'vol1', name: 'vol1', datacenter: 'EU-RO-1', stale: true })
  })
  it('a real error that is not a rate limit is still an error', async () => {
    setIds()
    const bad = fakeFetch([[500, 'boom']])
    await expect(volumes.list(client(bad.f))).rejects.toThrow()
  })
})
