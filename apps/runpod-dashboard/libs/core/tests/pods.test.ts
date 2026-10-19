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
  const fetchFn = (async (_url: string, init: { body: string }) => {
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
    expect(() => pods.resolveImage('configured', cfg)).toThrow(/local image name/)
    cfg.image = 'ghcr.io/example/comfy-app:v26'
    expect(pods.resolveImage('configured', cfg)).toBe(cfg.image)
    expect(pods.resolveImage('prebuilt', cfg)).toBe('ashleykza/comfyui:latest')
    expect(pods.resolveImage('docker.io/org/thing:1', cfg)).toBe('docker.io/org/thing:1')
    cfg.image = ''
    expect(() => pods.resolveImage('configured', cfg)).toThrow(/No image/)
  })
})

describe('the plan sent to RunPod', () => {
  it('applies the cheap defaults and the mount configuration', () => {
    const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; cfg.network_volume_id = 'vol1'; cfg.data_center_id = 'EU-RO-1'
    cfg.folders.project = fakeTree(dir)
    const { input, idleMinutes } = pods.plan({ name: 't' }, cfg)
    expect(input.imageName).toBe('ghcr.io/example/comfy-app:v26'); expect(input.gpuTypeId).toBe('auto')
    expect(input.cloudType).toBe('COMMUNITY'); expect(input.volumeInGb).toBe(0); expect(input.networkVolumeId).toBe('vol1'); expect(input.dataCenterId).toBe('EU-RO-1')
    expect(input.env.PROJECT_ROOT).toBe('/workspace/project'); expect(input.env.COMFY_LINKS).toContain('/home/someone/HARBOUR_r1/HARBOUR=/workspace/project')
    expect(input.ports).toBe('8188/http,22/tcp'); expect(idleMinutes).toBe(30)
    // a per-pod volume asked for beside the network volume is still 0; without the volume it is kept
    expect(pods.plan({ name: 't', volume_gb: 40 }, cfg).input.volumeInGb).toBe(0)
    cfg.network_volume_id = ''
    const p2 = pods.plan({ name: 't', volume_gb: 40, gpu: 'a4000', instance_type: 'on-demand', idle_stop_minutes: 0, env_vars: { X: '1' }, build_args: { X: 'arg', Y: 'y' } }, cfg)
    expect(p2.input.volumeInGb).toBe(40); expect(p2.input.gpuTypeId).toBe('NVIDIA RTX A4000'); expect(p2.input.cloudType).toBe('SECURE'); expect(p2.idleMinutes).toBe(0)
    expect(p2.input.env.X).toBe('1'); expect(p2.input.env.Y).toBe('y')   // explicit env wins over a build arg
    expect(() => pods.plan({ name: 't', gpu: 'h100' }, cfg)).toThrow(/unknown GPU/)
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
      if (q.includes('myPods')) return { myself: { pods: [{ id: 'pod123', name: 't', runtime: { uptimeInSeconds: 60, ports: [] }, machine: { gpuDisplayName: 'RTX 4090' } }, { id: 'p2', name: 'off', runtime: null }] } }
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
    expect(d.stats).toEqual({ total_pods: 2, running_pods: 1, stopped_pods: 1, total_vram: 48 })
    expect(d.pods[0]).toMatchObject({ status: 'running', web_ui_url: 'https://pod123-8188.proxy.runpod.net', idle_stop_minutes: 30 })
    expect(d.pods[1]).toMatchObject({ status: 'stopped', web_ui_url: null })
    expect(await pods.stop('pod123', client)).toEqual({ message: 'Pod pod123 stopped', pod_id: 'pod123' })
    await pods.remove('pod123', client)
    expect(idle.entry('pod123')).toBeUndefined()
    expect(await pods.runningIds(client)()).toEqual(new Set(['pod123']))
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
    expect(await pods.candidates('auto', { fetchFn })).toEqual(['NVIDIA RTX A5000', 'NVIDIA GeForce RTX 4090', 'NVIDIA RTX A4000', 'NVIDIA RTX 4000 Ada Generation', 'NVIDIA GeForce RTX 3090'])
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

  it('surfaces RunPod errors and a missing key', async () => {
    const { fetchFn } = fakeFetch(() => ({ errors: [{ message: 'There are no longer any instances available with the requested specifications.' }] }))
    await expect(rp.stopPod('x', { fetchFn })).rejects.toThrow(/no longer any instances/)
    delete process.env.RUNPOD_API_KEY
    await expect(rp.listPods({ fetchFn })).rejects.toThrow(/RUNPOD_API_KEY/)
  })
})
