import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as dry from '../src/dry.js'
import * as mounts from '../src/mounts.js'
import * as pods from '../src/pods.js'
import * as pool from '../src/pool.js'
import * as gpus from '../src/gpus.js'
import { scratch } from './helpers.js'

let dir: string
// No-spend mode throughout: the pool is a set of the core's pods, and the core simulates them without a key.
beforeEach(() => {
  dir = scratch()
  process.env.RUNPOD_DRY_RUN = '1'
  process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json')
  process.env.POOL_FILE = join(dir, 'pool.json')
  delete process.env.RUNPOD_API_KEY
})

describe('the agent pool', () => {
  it('is a set of pods with a label, kept in pool.json', async () => {
    expect(pool.agents()).toEqual([])
    const a = await pool.create({ agent_name: 'image-gen', gpu_type: 'rtx4090' })
    expect(a.agent_id).toBe(`image-gen-${a.pod_id.slice(0, 8)}`); expect(a.pod_id.startsWith('dry-')).toBe(true)
    expect(a.gpu_type).toBe('rtx4090'); expect(a.status).toBe('starting'); expect(a.health).toBeNull()
    expect(a.comfyui_url).toBe(`https://${a.pod_id}-8188.proxy.runpod.net`); expect(a.api_url).toBe(a.comfyui_url)
    expect(a.ssh_command).toBe(`ssh root@${a.pod_id}.proxy.runpod.io`)
    expect(existsSync(join(dir, 'pool.json'))).toBe(true)
    expect(pool.agents().map((x) => x.agent_id)).toEqual([a.agent_id])
    expect((await pods.list()).map((p) => p.name)).toEqual(['comfy-image-gen-0'])   // the pod is the core's, visible to the dashboard
    expect(pool.dryRun()).toBe(true)

    const s = await pool.status()
    expect(s).toMatchObject({ total_agents: 1, running_agents: 1, stopped_agents: 0, total_cost_per_hour: 0 })   // a starting pod is billed
    expect(s.agents[0].agent_id).toBe(a.agent_id)

    expect((await pool.stop(a.agent_id)).status).toBe('stopped')
    expect((await pods.get(a.pod_id)).status).toBe('stopped')
    expect(await pool.status()).toMatchObject({ running_agents: 0, stopped_agents: 1 })
    expect((await pool.resume(a.agent_id)).status).toBe('starting')

    const info = await pool.info(a.agent_id)
    expect(info).toMatchObject({ agent_id: a.agent_id, pod_id: a.pod_id, id: a.pod_id, status: 'starting', cost_per_hour: 0 })

    const h = await pool.healthCheck(a.agent_id)
    expect(h.healthy).toBe(false)   // a simulated pod is still booting
    expect(h.agent.health).toMatchObject({ status: 'unreachable', url: `${a.comfyui_url}/system_stats` })
    expect(pool.agent(a.agent_id).health).toEqual(h.agent.health)

    expect((await pool.remove(a.agent_id)).agent_id).toBe(a.agent_id)
    expect(pool.agents()).toEqual([]); expect(await pods.list()).toEqual([])
    expect(() => pool.agent(a.agent_id)).toThrow(/Agent not found/)
    await expect(pool.stop('nope')).rejects.toThrow(/Agent not found: nope/)
  })

  it('shows a pod that went away as missing instead of dropping it', async () => {
    const a = await pool.create({ agent_name: 'video-gen' })
    dry.remove(a.pod_id)   // deleted outside the pool, e.g. in the dashboard
    expect((await pool.refresh())[0].status).toBe('missing')
    expect(await pool.status()).toMatchObject({ total_agents: 1, running_agents: 0, stopped_agents: 1 })
  })

  it('boots our image when it is pushed, the stock one otherwise', async () => {
    const cfg = mounts.defaults()
    expect(pool.imageChoice(cfg)).toBe('configured')   // the default is the ghcr.io image (ADR-024)
    cfg.image = 'comfy-app:contract-v26'
    expect(pool.imageChoice(cfg)).toBe('prebuilt')   // a bare local name is not pullable
    cfg.image = 'ghcr.io/example/comfy-app:v26'
    expect(pool.imageChoice(cfg)).toBe('configured')
    await pool.create({ agent_name: 'upscale' })   // with the default configuration: must not need a pushed image
    expect((await pods.list()).length).toBe(1)
  })

  it('refuses what the core refuses: a card outside the table, a bad storage size, no name', async () => {
    expect(pool.GPU_TYPES).toEqual(['auto', ...Object.keys(gpus.GPUS)])   // the enum follows the core's card table
    await expect(pool.create({ agent_name: 'x', gpu_type: 'h100' })).rejects.toThrow(/unknown GPU/)
    await expect(pool.create({ agent_name: 'x', storage_gb: 10 })).rejects.toThrow(/storage_gb/)
    await expect(pool.create({ agent_name: ' ' })).rejects.toThrow(/needs a name/)
    expect(pool.agents()).toEqual([]); expect(await pods.list()).toEqual([])
  })

  it('submits and reads jobs, simulated in no-spend mode', async () => {
    const a = await pool.create({ agent_name: 'image-gen' })
    await expect(pool.submitJob(a.agent_id, 'not json')).rejects.toThrow(/valid JSON/)
    const job = await pool.submitJob(a.agent_id, '{"1": {"class_type": "KSampler"}}', 't2i')
    expect(job).toMatchObject({ agent_id: a.agent_id, simulated: true, api_url: `${a.api_url}/prompt` })
    expect(job.status_url).toBe(`${a.api_url}/history/${job.job_id}`)
    expect(await pool.jobStatus(a.agent_id, job.job_id)).toEqual({ status: 'COMPLETED', outputs: [], simulated: true })
  })

  it('reads ComfyUI history for real jobs', async () => {
    delete process.env.RUNPOD_DRY_RUN
    const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
    const a = await pool.create({ agent_name: 'image-gen' })
    cfg.dry_run = false; mounts.save(cfg)   // the pod is simulated, the fetch is ours: only the HTTP path is under test
    const calls: string[] = []
    const fetchFn = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method || 'GET'} ${url}`)
      if (init?.method === 'POST') return { status: 200, json: async () => ({ prompt_id: 'p1' }), text: async () => '' }
      return { status: 200, json: async () => (url.endsWith('/history/p1') ? { p1: { status: { status_str: 'success', completed: true }, outputs: { 9: { images: [{ filename: 'out.png' }] } } } } : {}), text: async () => '' }
    }) as unknown as typeof fetch
    const job = await pool.submitJob(a.agent_id, '{"1": {}}', 'name', fetchFn)
    expect(job.job_id).toBe('p1'); expect(job.simulated).toBeUndefined()
    expect(await pool.jobStatus(a.agent_id, 'p1', fetchFn)).toEqual({ status: 'COMPLETED', outputs: [{ node_id: '9', images: [{ filename: 'out.png' }] }] })
    expect(await pool.jobStatus(a.agent_id, 'p2', fetchFn)).toEqual({ status: 'PENDING', outputs: [] })
    expect(calls).toEqual([`POST ${a.api_url}/prompt`, `GET ${a.api_url}/history/p1`, `GET ${a.api_url}/history/p2`])
  })
})
