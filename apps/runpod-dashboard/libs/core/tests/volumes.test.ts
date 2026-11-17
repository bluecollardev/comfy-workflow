import { beforeEach, describe, expect, it } from 'vitest'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as volumes from '../src/volumes.js'
import { resetVolumeApi } from '../src/runpod.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); resetVolumeApi() })

const fetchFn = (volumesOnAccount: unknown[], pods: unknown[]) => (async (url: string, init?: RequestInit) => {
  if (url.includes('/v1/networkvolumes') && (!init?.method || init.method === 'GET')) return new Response(JSON.stringify(volumesOnAccount))
  if (url.includes('/v1/networkvolumes') && init?.method === 'DELETE') return new Response('', { status: 200 })
  if (url.includes('/graphql')) return new Response(JSON.stringify({ data: { myself: { pods } } }))
  return new Response('', { status: 404 })
}) as unknown as typeof fetch

describe('network volumes', () => {
  it('lists each volume with its cost, S3 support, the default mark and the pods on it', async () => {
    const cfg = mounts.defaults(); cfg.network_volume_id = 'v1'; cfg.data_center_id = 'EU-RO-1'; mounts.save(cfg)
    const own = mounts.defaults(); own.network_volume_id = 'v2'; podconfigs.set('p3', own)   // p3's own configuration names v2 but RunPod has it on v1
    const f = fetchFn(
      [{ id: 'v1', name: 'work', size: 120, dataCenterId: 'EU-RO-1' }, { id: 'v2', name: 'scratch', size: 50, dataCenterId: 'CA-MTL-1' }],
      [{ id: 'p1', name: 'A', desiredStatus: 'RUNNING', networkVolumeId: 'v1', runtime: { uptimeInSeconds: 10 } }, { id: 'p2', name: 'B', desiredStatus: 'EXITED', networkVolumeId: null }, { id: 'p3', name: 'C', desiredStatus: 'EXITED', networkVolumeId: 'v1', runtime: null }],
    )
    const list = await volumes.list({ fetchFn: f, apiKey: 'k' })
    expect(list.map((v) => v.id)).toEqual(['v1', 'v2'])   // the default first
    expect(list[0]).toMatchObject({ is_default: true, s3: true, cost_per_month: 8.4, pods: [{ id: 'p1', name: 'A', status: 'running', via: 'runpod' }, { id: 'p3', name: 'C', status: 'stopped', via: 'runpod' }] })
    expect(list[1]).toMatchObject({ is_default: false, s3: false, cost_per_month: 3.5, pods: [{ id: 'p3', via: 'config' }] })
  })

  it('refuses to delete a volume with a pod attached, and clears the default when that volume goes', async () => {
    const cfg = mounts.defaults(); cfg.network_volume_id = 'v2'; cfg.data_center_id = 'CA-MTL-1'; mounts.save(cfg)
    const f = fetchFn([{ id: 'v1', name: 'work', size: 120, dataCenterId: 'EU-RO-1' }, { id: 'v2', name: 'scratch', size: 50, dataCenterId: 'CA-MTL-1' }],
      [{ id: 'p1', name: 'A', desiredStatus: 'RUNNING', networkVolumeId: 'v1', runtime: { uptimeInSeconds: 10 } }])
    await expect(volumes.remove('v1', { fetchFn: f, apiKey: 'k' })).rejects.toThrow(/attached to A/)
    expect(await volumes.remove('v2', { fetchFn: f, apiKey: 'k' })).toEqual({ removed: 'v2', was_default: true })
    expect(mounts.load().network_volume_id).toBe(''); expect(mounts.load().data_center_id).toBe('')
  })

  it('use as default sets the volume and its datacenter together; a volume only grows', async () => {
    mounts.save(mounts.defaults())
    const f = fetchFn([{ id: 'v1', name: 'work', size: 120, dataCenterId: 'EU-RO-1' }], [])
    const v = await volumes.useAsDefault('v1', { fetchFn: f, apiKey: 'k' })
    expect(v.is_default).toBe(true); expect(mounts.load()).toMatchObject({ network_volume_id: 'v1', data_center_id: 'EU-RO-1' })
    await expect(volumes.resize('v1', 100, { fetchFn: f, apiKey: 'k' })).rejects.toThrow(/only grows/)
  })

  it('simulates volumes in no-spend mode', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
    const v = await volumes.create({ name: 'sim', size_gb: 60, datacenter: 'EU-RO-1' })
    expect(v).toMatchObject({ name: 'sim', size_gb: 60, s3: true, cost_per_month: 4.2, pods: [] })
    expect((await volumes.resize(v.id, 80)).size_gb).toBe(80)
    expect(await volumes.remove(v.id)).toEqual({ removed: v.id, was_default: false })
    expect(await volumes.list()).toEqual([])
    await expect(volumes.create({ name: '', size_gb: 60, datacenter: 'EU-RO-1' })).rejects.toThrow(/needs a name/)
  })

  it('the Shared volume is marked, cannot be deleted from here, and frees up when another (or none) is chosen', async () => {
    mounts.save(mounts.defaults())
    const f = fetchFn([{ id: 'v1', name: 'work', size: 120, dataCenterId: 'EU-RO-1' }, { id: 'v2', name: 'models', size: 60, dataCenterId: 'EU-RO-1' }], [])
    const o = { fetchFn: f, apiKey: 'k' }
    expect((await volumes.list(o)).map((v) => v.is_shared)).toEqual([false, false])
    const v = await volumes.setShared('v2', o)
    expect(v).toMatchObject({ id: 'v2', is_shared: true }); expect(mounts.load().shared_volume_id).toBe('v2')
    expect((await volumes.list(o)).find((x) => x.id === 'v2')!.is_shared).toBe(true)
    await expect(volumes.remove('v2', o)).rejects.toThrow(/is the Shared volume/)
    await expect(volumes.setShared('nope', o)).rejects.toThrow(/No network volume nope/)
    expect(await volumes.setShared('', o)).toEqual({ shared: null }); expect(mounts.load().shared_volume_id).toBe('')
    expect(await volumes.remove('v2', o)).toMatchObject({ removed: 'v2' })
  })
})

describe('network volumes: v1 host unreachable, v2 takes over', () => {
  const dnsDown = () => new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
  const v2Volumes = [{ id: 'a1', name: 'work', size: 120, dataCenter: 'EU-RO-1', type: 'STANDARD' }, { id: 'b2', name: 'scratch', size: 50, dataCenter: 'CA-MTL-1', type: 'STANDARD' }]
  const calls: string[] = []
  const f = ((url: string, init?: RequestInit) => {
    calls.push(`${init?.method || 'GET'} ${url}`)
    if (url.startsWith('https://rest.runpod.io')) throw dnsDown()
    if (url.includes('/graphql')) return Promise.resolve(new Response(JSON.stringify({ data: { myself: { pods: [] } } })))
    if (url.includes('/v2/network-volumes') && (!init?.method || init.method === 'GET')) {
      if (url.includes('cursor=c2')) return Promise.resolve(new Response(JSON.stringify({ networkVolumes: [v2Volumes[1]], pagination: { nextCursor: null, hasNextPage: false } })))
      return Promise.resolve(new Response(JSON.stringify({ networkVolumes: [v2Volumes[0]], pagination: { nextCursor: 'c2', hasNextPage: true } })))
    }
    if (url.endsWith('/v2/network-volumes') && init?.method === 'POST') return Promise.resolve(new Response(JSON.stringify({ id: 'n3', ...JSON.parse(String(init.body)), type: 'STANDARD' }), { status: 201 }))
    if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
    return Promise.resolve(new Response('', { status: 404 }))
  }) as unknown as typeof fetch
  beforeEach(() => { calls.length = 0 })

  it('lists every page from v2 and maps dataCenter to dataCenterId, then stays on v2', async () => {
    mounts.save(mounts.defaults())
    const list = await volumes.list({ fetchFn: f, apiKey: 'k' })
    expect(list.map((v) => [v.id, v.datacenter]).sort()).toEqual([['a1', 'EU-RO-1'], ['b2', 'CA-MTL-1']])   // both pages, whatever the list's order
    expect(calls.filter((c) => c.includes('rest.runpod.io'))).toHaveLength(1)
    calls.length = 0
    await volumes.list({ fetchFn: f, apiKey: 'k' })
    expect(calls.some((c) => c.includes('rest.runpod.io'))).toBe(false)   // v1 is not tried again for a few minutes
  })

  it('creates on v2 with dataCenter, and deletes there', async () => {
    mounts.save(mounts.defaults())
    const v = await volumes.create({ name: 'new', size_gb: 60, datacenter: 'EU-RO-1' }, { fetchFn: f, apiKey: 'k' })
    expect(v).toMatchObject({ id: 'n3', name: 'new', size_gb: 60 })
    const post = calls.find((c) => c.startsWith('POST https://api.runpod.io/v2/network-volumes'))
    expect(post).toBeTruthy()
  })

  it('does not fall back on an answer from RunPod (a 401 stays a 401)', async () => {
    mounts.save(mounts.defaults())
    const refused = (async (url: string) => url.includes('rest.runpod.io') ? new Response('{"error":"bad key"}', { status: 401 }) : new Response('{}', { status: 200 })) as unknown as typeof fetch
    await expect(volumes.list({ fetchFn: refused, apiKey: 'k' })).rejects.toThrow(/401/)
  })
})
