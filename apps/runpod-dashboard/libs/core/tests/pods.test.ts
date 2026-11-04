import { beforeEach, describe, expect, it } from 'vitest'
import * as mounts from '../src/mounts.js'
import * as idle from '../src/idle.js'
import * as pods from '../src/pods.js'
import * as rp from '../src/runpod.js'
import { fakeTree, scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.RUNPOD_API_KEY = 'test' })

/** A fetch that records the GraphQL queries and answers from a script. */
function fakeFetch(answers: (query: string) => unknown) {
  const queries: string[] = []
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    if (!init?.body) return { status: String(url).includes('ready-') ? 200 : 502, ok: false, json: async () => ({}) }   // a proxy probe: pods named ready-* answer
    const q = JSON.parse(init.body).query as string
    queries.push(q)
    const data = answers(q)
    return { status: 200, json: async () => (data && typeof data === 'object' && 'errors' in (data as object) ? data : { data }) }
  }) as unknown as typeof fetch
  return { fetchFn, queries }
}

describe('the image a pod boots', () => {
  it('must be pullable', () => {
    const cfg = mounts.defaults()
    expect(pods.resolveImage('configured', cfg)).toBe('ghcr.io/bluecollardev/comfy-app:contract-v26')   // the default is already pullable
    cfg.image = 'comfy-app:contract-v26'   // a bare local name (what the default used to be) is refused
    expect(() => pods.resolveImage('configured', cfg)).toThrow(/local image name/)
    cfg.image = 'ghcr.io/example/comfy-app:v26'
    expect(pods.resolveImage('configured', cfg)).toBe(cfg.image)
    expect(pods.resolveImage('prebuilt', cfg)).toBe('ashleykza/comfyui:latest')
    expect(pods.resolveImage('docker.io/org/thing:1', cfg)).toBe('docker.io/org/thing:1')
    cfg.image = ''
    expect(() => pods.resolveImage('configured', cfg)).toThrow(/No image/)
  })
})

describe('the datacenter menu', () => {
  it('lists every card each listed datacenter runs, free or in use, with S3 support and the price where RunPod gave one; the datacenter with most free cards first', async () => {
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).query as string
      if (q.includes('gpuAvailability')) return new Response(JSON.stringify({ data: { dataCenters: [
        { id: 'CA-MTL-1', listed: true, gpuAvailability: [{ gpuTypeId: 'NVIDIA A40', gpuTypeDisplayName: 'A40', available: true, stockStatus: 'High' }, { gpuTypeId: 'NVIDIA H100 PCIe', gpuTypeDisplayName: 'H100 PCIe', available: false, stockStatus: null }] },
        { id: 'EU-RO-1', listed: true, gpuAvailability: [{ gpuTypeId: 'NVIDIA GeForce RTX 4090', gpuTypeDisplayName: 'RTX 4090', available: true, stockStatus: 'High' }, { gpuTypeId: 'NVIDIA RTX 4000 Ada Generation', gpuTypeDisplayName: 'RTX 4000 Ada', available: true, stockStatus: 'Low' }, { gpuTypeId: 'AMD Instinct MI300X OAM', gpuTypeDisplayName: 'MI300X', available: false, stockStatus: null }] },
        { id: 'XX-OLD-1', listed: false, gpuAvailability: [] },
      ] } }))
      if (q.includes('dataCenters { id listed }')) return new Response(JSON.stringify({ data: { dataCenters: [{ id: 'CA-MTL-1', listed: true }, { id: 'EU-RO-1', listed: true }, { id: 'XX-OLD-1', listed: false }] } }))
      return new Response(JSON.stringify({ data: {
        dc_CA_MTL_1: [{ id: 'NVIDIA A40', lowestPrice: { uninterruptablePrice: 0.35, stockStatus: 'High' } }],
        dc_EU_RO_1: [{ id: 'NVIDIA GeForce RTX 4090', lowestPrice: { uninterruptablePrice: 0.89, stockStatus: 'High' } }, { id: 'NVIDIA RTX 4000 Ada Generation', lowestPrice: { uninterruptablePrice: 0.28, stockStatus: 'Low' } }],
      } }))
    }) as unknown as typeof fetch
    const m = await pods.datacenters({ fetchFn, apiKey: 'k' })
    expect(m.live).toBe(true); expect(m.datacenters.map((d) => d.value)).toEqual(['EU-RO-1', 'CA-MTL-1'])   // 2 free cards before 1; the unlisted one is gone
    expect(m.datacenters[0].s3).toBe(true); expect(m.datacenters[0].text).toBe('EU-RO-1 · 2 cards in stock: RTX 4000 Ada 20 GB $0.28/h Low, RTX 4090 24 GB $0.89/h High · S3')
    expect(m.datacenters[0].cards.map((c) => [c.name, c.available, c.runs])).toEqual([['RTX 4000 Ada', true, true], ['RTX 4090', true, true], ['MI300X', false, false]])   // the busy AMD card is still there
    expect(m.datacenters[0].cards[2]).toMatchObject({ stock: 'Out of stock', why: 'amd', price: null })
    expect(m.datacenters[1].cards).toMatchObject([{ key: 'a40', available: true, price: 0.35 }, { key: 'h100pcie', name: 'H100 PCIe', vram: 80, available: false, stock: 'Out of stock', price: null }])   // an H100 in use is listed, not hidden
  })

  it('lists cards outside our table as not runnable on the image, a datacenter with nothing free with the count offered, and keeps every card when the price queries fail', async () => {
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const q = JSON.parse(String(init.body)).query as string
      if (q.includes('gpuAvailability')) return new Response(JSON.stringify({ data: { dataCenters: [
        { id: 'AP-JP-1', listed: true, gpuAvailability: [{ gpuTypeId: 'NVIDIA H200', gpuTypeDisplayName: 'H200 SXM', available: true, stockStatus: 'Low' }, { gpuTypeId: 'NVIDIA H100 80GB HBM3', gpuTypeDisplayName: 'H100 SXM', available: true, stockStatus: 'Low' }] },
        { id: 'EUR-IS-2', listed: true, gpuAvailability: [{ gpuTypeId: 'NVIDIA RTX PRO 6000 Blackwell Server Edition', gpuTypeDisplayName: 'RTX PRO 6000', available: true, stockStatus: 'Low' }] },
        { id: 'US-TX-3', listed: true, gpuAvailability: [{ gpuTypeId: 'NVIDIA A40', gpuTypeDisplayName: 'A40', available: false, stockStatus: null }, { gpuTypeId: 'NVIDIA H100 80GB HBM3', gpuTypeDisplayName: 'H100 SXM', available: false, stockStatus: null }] },
      ] } }))
      throw new Error('RunPod 500')   // the price queries all fail
    }) as unknown as typeof fetch
    const m = await pods.datacenters({ fetchFn, apiKey: 'k' })
    expect(m.datacenters.map((d) => d.value)).toEqual(['AP-JP-1', 'EUR-IS-2', 'US-TX-3'])   // 2 free, then 1, then none
    expect(m.datacenters[0].cards.map((c) => [c.key, c.vram, c.price])).toEqual([['h200', 141, null], ['h100', 80, null]])   // listed with their sizes though no price came
    expect(m.datacenters[1].cards[0]).toMatchObject({ name: 'RTX PRO 6000', vram: 96, runs: false, why: 'cuda13' })
    expect(m.datacenters[1].text).toBe('EUR-IS-2 · 1 card in stock: RTX PRO 6000 96 GB Low (needs CUDA 13)')
    expect(m.datacenters[2].text).toBe('US-TX-3 · no cards in stock (2 offered)')   // the H100 and the A40 are still in its cards
    expect(m.datacenters[2].cards).toHaveLength(2)
  })
})

describe('the registry credential', () => {
  it('goes to RunPod with the mounts and without them: a private image needs it either way', () => {
    const cfg = mounts.validate(mounts.normalize({ ...mounts.load(), registry_auth_id: 'auth123', apply_by_default: true }))
    expect(pods.plan({ name: 't', apply_mounts: true }, cfg).input.containerRegistryAuthId).toBe('auth123')
    expect(pods.plan({ name: 't', apply_mounts: false }, cfg).input.containerRegistryAuthId).toBe('auth123')
    expect(pods.plan({ name: 't', apply_mounts: false }, mounts.validate(mounts.normalize({ ...cfg, registry_auth_id: '' }))).input.containerRegistryAuthId).toBeUndefined()
  })
})

describe('the volume and its cost', () => {
  it('prices a volume per month and reads the configured one from RunPod', async () => {
    expect(pods.volumeCostPerMonth(120)).toBe(8.4); expect(pods.volumeCostPerMonth(1500)).toBe(95)
    const fetchFn = (async (url: string) => url.endsWith('/v1/networkvolumes/vol1')
      ? new Response(JSON.stringify({ id: 'vol1', name: 'comfy-workspace', size: 120, dataCenterId: 'EU-RO-1' }))
      : new Response('', { status: 404 })) as unknown as typeof fetch
    expect(await pods.volumeInfo('vol1', { fetchFn, apiKey: 'k' })).toEqual({ id: 'vol1', name: 'comfy-workspace', size_gb: 120, datacenter: 'EU-RO-1', cost_per_month: 8.4, s3: true })
    expect(await pods.volumeInfo('nope', { fetchFn, apiKey: 'k' })).toBeNull()
    expect(await pods.volumeInfo('', { fetchFn, apiKey: 'k' })).toBeNull()   // nothing configured
  })
})

describe('the plan sent to RunPod', () => {
  it('applies the cheap defaults and the mount configuration', () => {
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; cfg.network_volume_id = 'vol1'; cfg.data_center_id = 'EU-RO-1'
    cfg.folders.project = fakeTree(dir)
    const { input, idleMinutes } = pods.plan({ name: 't' }, cfg)
    expect(input.imageName).toBe('ghcr.io/example/comfy-app:v26'); expect(input.gpuTypeId).toBe('auto')
    expect(input.cloudType).toBe('SECURE'); expect(input.volumeInGb).toBe(0); expect(input.networkVolumeId).toBe('vol1'); expect(input.dataCenterId).toBe('EU-RO-1')   // a network volume means the secure cloud
    expect(input.env.PROJECT_ROOT).toBe('/workspace/project'); expect(input.env.COMFY_LINKS).toContain('/home/someone/HARBOUR_r1/HARBOUR=/workspace/project')
    expect(input.ports).toBe('8188/http,22/tcp'); expect(idleMinutes).toBe(30)
    expect(pods.plan({ name: 't', data_center_id: 'US-NC-1' }, cfg).input.dataCenterId).toBe('EU-RO-1')   // the volume's datacenter wins over the form
    expect(input.containerRegistryAuthId).toBeUndefined()   // a public image needs no credential
    cfg.registry_auth_id = 'cred1'
    expect(pods.plan({ name: 't' }, cfg).input.containerRegistryAuthId).toBe('cred1'); expect(rp.deployMutation(pods.plan({ name: 't' }, cfg).input)).toContain('containerRegistryAuthId: "cred1"')
    cfg.registry_auth_id = ''
    expect(pods.plan({ name: 't', image: 'prebuilt' }, cfg).input.ports).toBe('3001/http,8888/http,22/tcp')   // the stock image serves its UI on 3001
    expect(pods.webPortOf('3001/http,8888/http,22/tcp')).toBe(3001); expect(pods.webPortOf('22/tcp')).toBe(8188)
    // a per-pod volume asked for beside the network volume is still 0; without the volume it is kept
    expect(pods.plan({ name: 't', volume_gb: 40 }, cfg).input.volumeInGb).toBe(0)
    cfg.network_volume_id = ''
    const p2 = pods.plan({ name: 't', volume_gb: 40, gpu: 'a4000', instance_type: 'on-demand', idle_stop_minutes: 0, env_vars: { X: '1' }, build_args: { X: 'arg', Y: 'y' } }, cfg)
    expect(pods.plan({ name: 't', data_center_id: 'US-NC-1' }, cfg).input.dataCenterId).toBe('US-NC-1')   // no volume: the form's choice
    expect(p2.input.volumeInGb).toBe(40); expect(p2.input.gpuTypeId).toBe('NVIDIA RTX A4000'); expect(p2.input.cloudType).toBe('SECURE'); expect(p2.idleMinutes).toBe(0)
    expect(p2.input.env.X).toBe('1'); expect(p2.input.env.Y).toBe('y')   // explicit env wins over a build arg
    expect(() => pods.plan({ name: 't', gpu: 'b200' }, cfg)).toThrow(/unknown GPU/)
    expect(() => pods.plan({ name: 't', image: 'comfy-app:local' }, cfg)).toThrow(/local image name/)
  })

  it('refuses a missing required folder in prod unless mounts are off', () => {
    process.env.COMFY_MODE = 'prod'
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'
    expect(() => pods.plan({ name: 't' }, cfg)).toThrow(/Not mapped on this PC: project, plates, comfy-shared/)
    expect(pods.plan({ name: 't', apply_mounts: false }, cfg).input.env.PROJECT_ROOT).toBeUndefined()
  })
})

describe('against RunPod', () => {
  it('builds the SDK mutation and maps the answers', async () => {
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; mounts.save(cfg)
    const { fetchFn, queries } = fakeFetch((q) => {
      if (q.includes('podFindAndDeployOnDemand')) return { podFindAndDeployOnDemand: { id: 'pod123' } }
      if (q.includes('myPods')) return { myself: { pods: [{ id: 'pod123', name: 't', imageName: 'ashleykza/comfyui:latest', ports: '3001/http,22/tcp', runtime: { uptimeInSeconds: 60, ports: [] }, machine: { gpuDisplayName: 'RTX 4090' } }, { id: 'old-ports', name: 'old', imageName: 'ashleykza/comfyui:latest', ports: '8188/http,22/tcp', runtime: { uptimeInSeconds: 60, ports: [] } }, { id: 'p2', name: 'off', runtime: null }, { id: 'ready-1', name: 'up', ports: '8188/http', runtime: { uptimeInSeconds: 600, ports: [] }, desiredStatus: 'RUNNING' }] } }
      if (q.includes('podStop')) return { podStop: { id: 'pod123', desiredStatus: 'EXITED' } }
      if (q.includes('podTerminate')) return { podTerminate: null }
      return {}
    })
    const client = { fetchFn }
    const created = await pods.create({ name: 't', gpu: 'rtx4090', env_vars: { QUOTE: 'say "hi"' } }, client)
    expect(created.gpu).toBe('rtx4090 x1')
    expect(created.id).toBe('pod123'); expect(created.web_ui_url).toBe('https://pod123-8188.proxy.runpod.net'); expect(created.idle_stop_minutes).toBe(30)
    expect(idle.entry('pod123')?.minutes).toBe(30)
    const m = queries[0]
    expect(m).toContain('imageName: "ghcr.io/example/comfy-app:v26"'); expect(m).toContain('gpuTypeId: "NVIDIA GeForce RTX 4090"'); expect(m).toContain('cloudType: COMMUNITY')
    expect(m).toContain('volumeInGb: 0'); expect(m).toContain('dataCenterId: null'); expect(m).toContain('ports: "8188/http,22/tcp"'); expect(m).toContain('{ key: "QUOTE", value: "say \\"hi\\"" }')
    const d = await pods.dashboard(client)
    expect(d.stats).toEqual({ total_pods: 4, running_pods: 3, stopped_pods: 1, total_vram: 96 })
    expect(d.pods.find((p) => p.id === 'old-ports')).toMatchObject({ port_mismatch: true })
    expect(d.pods[0].port_mismatch).toBe(false)
    expect(d.pods[0]).toMatchObject({ status: 'running', web_ui_url: 'https://pod123-3001.proxy.runpod.net', idle_stop_minutes: 30, comfy_ready: false })   // the stock image's port, not up yet
    expect(d.pods[2]).toMatchObject({ status: 'stopped', web_ui_url: null, comfy_ready: null })
    expect(d.pods[3]).toMatchObject({ status: 'running', web_ui_url: 'https://ready-1-8188.proxy.runpod.net', comfy_ready: true })
    expect(await pods.stop('pod123', client)).toEqual({ message: 'Pod pod123 stopped', pod_id: 'pod123' })
    await pods.remove('pod123', client)
    expect(idle.entry('pod123')).toBeUndefined()
    expect(await pods.runningIds(client)()).toEqual(new Map([['pod123', 60], ['old-ports', 60], ['ready-1', 600]]))
  })

  it('auto picks the cheapest card in stock and moves on when RunPod has none', async () => {
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; mounts.save(cfg)
    const tried: string[] = []
    const { fetchFn } = fakeFetch((q) => {
      if (q.includes('gpuTypes')) return { gpuTypes: [
        { id: 'NVIDIA GeForce RTX 4090', secureCloud: true, communityCloud: true, lowestPrice: { uninterruptablePrice: 0.34, stockStatus: 'Low' } },
        { id: 'NVIDIA RTX A5000', secureCloud: true, communityCloud: true, lowestPrice: { uninterruptablePrice: 0.16, stockStatus: 'Low' } },
        { id: 'NVIDIA RTX A4000', secureCloud: true, communityCloud: true, lowestPrice: { uninterruptablePrice: null, stockStatus: null } },
      ] }
      if (q.includes('podFindAndDeployOnDemand')) {
        const id = /gpuTypeId: "([^"]+)"/.exec(q)![1]; tried.push(id)
        if (id === 'NVIDIA RTX A5000') return { errors: [{ message: 'There are no longer any instances available with the requested specifications. Please refresh and try again.' }] }
        return { podFindAndDeployOnDemand: { id: 'pod-auto' } }
      }
      return {}
    })
    expect(await pods.candidates('auto', { fetchFn })).toEqual(['NVIDIA RTX A5000', 'NVIDIA GeForce RTX 4090', 'NVIDIA RTX 2000 Ada Generation', 'NVIDIA RTX A4000', 'NVIDIA RTX 4000 Ada Generation', 'NVIDIA GeForce RTX 3090', 'NVIDIA L4', 'NVIDIA RTX A6000', 'NVIDIA A40', 'NVIDIA L40'])
    const created = await pods.create({ name: 't', gpu: 'auto' }, { fetchFn })
    expect(tried).toEqual(['NVIDIA RTX A5000', 'NVIDIA GeForce RTX 4090'])   // cheapest first, then the next when none
    expect(created.gpu).toBe('rtx4090 x1'); expect(created.vram).toBe(24)
    // a real error is not retried
    const { fetchFn: f2 } = fakeFetch((q) => q.includes('gpuTypes') ? { gpuTypes: [] } : { errors: [{ message: 'Your account balance is too low to rent a pod.' }] })
    await expect(pods.create({ name: 't', gpu: 'auto' }, { fetchFn: f2 })).rejects.toThrow(/balance is too low/)
    // all out of stock on both clouds: one clear message
    const { fetchFn: f3 } = fakeFetch((q) => q.includes('gpuTypes') ? { gpuTypes: [] } : { errors: [{ message: 'There are no longer any instances available with the requested specifications.' }] })
    await expect(pods.create({ name: 't', gpu: 'auto' }, { fetchFn: f3 })).rejects.toThrow(/No card available right now: tried .* on COMMUNITY and SECURE/)
  })

  it('recreate makes the same pod on another host and drops the old one', async () => {
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; mounts.save(cfg)
    idle.register('old1', 15)
    const { fetchFn, queries } = fakeFetch((q) => {
      if (q.includes('podFindAndDeployOnDemand')) return { podFindAndDeployOnDemand: { id: 'new1' } }
      if (q.includes('podTerminate')) return { podTerminate: null }
      return {}
    })
    const restFetch = (async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
      if (String(url).includes('/v2/pods/old1')) return { ok: true, status: 200, json: async () => ({ id: 'old1', name: 'Live-Proof', desiredStatus: 'EXITED', lastStatusChange: 'Exited by user', cost: 0.28, cloud: 'SECURE', dataCenterId: 'EUR-IS-1', gpu: { id: 'NVIDIA RTX 4000 Ada Generation', count: 1 }, image: 'ashleykza/comfyui:latest', disk: 20, volume: 0, actions: ['start', 'terminate'] }) }
      return (fetchFn as unknown as (u: string, i: unknown) => Promise<unknown>)(url, init)
    }) as unknown as typeof fetch
    const fresh = await pods.recreate('old1', { fetchFn: restFetch })
    expect(fresh.id).toBe('new1'); expect(fresh.name).toBe('Live-Proof'); expect(fresh.idle_stop_minutes).toBe(15)
    const deploy = queries.find((q) => q.includes('podFindAndDeployOnDemand'))!
    expect(deploy).toContain('name: "Live-Proof"'); expect(deploy).toContain('imageName: "ashleykza/comfyui:latest"'); expect(deploy).toContain('gpuTypeId: "NVIDIA RTX 4000 Ada Generation"'); expect(deploy).toContain('cloudType: SECURE'); expect(deploy).toContain('containerDiskInGb: 20')
    expect(queries.some((q) => q.includes('podTerminate') && q.includes('old1'))).toBe(true)
    expect(idle.entry('old1')).toBeUndefined(); expect(idle.entry('new1')?.minutes).toBe(15)
  })

  it('the GPU menu says what is in stock and at what price', async () => {
    const { fetchFn } = fakeFetch((q) => q.includes('gpuTypes') ? { gpuTypes: [
      { id: 'NVIDIA RTX A5000', secureCloud: true, communityCloud: true, lowestPrice: { uninterruptablePrice: 0.16, stockStatus: 'Low' } },
      { id: 'NVIDIA RTX A4000', secureCloud: true, communityCloud: true, lowestPrice: { uninterruptablePrice: null, stockStatus: null } },
    ] } : {})
    const m = await pods.gpuMenu({ fetchFn })
    expect(m.live).toBe(true); expect(m.gpus[0].value).toBe('auto')
    const a5000 = m.gpus.find((g) => g.value === 'a5000')!, a4000 = m.gpus.find((g) => g.value === 'a4000')!
    expect(a5000).toMatchObject({ in_stock: true, price: 0.16, stock: 'Low', text: 'RTX A5000 (24 GB) · $0.16/h · Low stock' })
    expect(a4000).toMatchObject({ in_stock: false, text: 'RTX A4000 (16 GB) · none in stock' })
    delete process.env.RUNPOD_API_KEY
    expect((await pods.gpuMenu()).live).toBe(false)
  })

  it('surfaces RunPod errors and a missing key', async () => {
    const { fetchFn } = fakeFetch(() => ({ errors: [{ message: 'There are no longer any instances available with the requested specifications.' }] }))
    await expect(rp.stopPod('x', { fetchFn })).rejects.toThrow(/no longer any instances/)
    delete process.env.RUNPOD_API_KEY
    await expect(rp.listPods({ fetchFn })).rejects.toThrow(/RUNPOD_API_KEY/)
  })
})
