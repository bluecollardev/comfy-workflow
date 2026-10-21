import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as dry from '../src/dry.js'
import * as idle from '../src/idle.js'
import * as mounts from '../src/mounts.js'
import * as pods from '../src/pods.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); delete process.env.RUNPOD_DRY_RUN; delete process.env.RUNPOD_API_KEY })

describe('no-spend mode', () => {
  it('is off by default, on by the configuration switch or the env', () => {
    expect(mounts.dryRun(mounts.defaults())).toBe(false)
    const cfg = mounts.defaults(); cfg.dry_run = true
    expect(mounts.dryRun(cfg)).toBe(true); expect(mounts.payload(cfg).dry_run).toBe(true)
    process.env.RUNPOD_DRY_RUN = '1'; expect(mounts.dryRun(mounts.defaults())).toBe(true)
    expect(mounts.put({ ...mounts.defaults(), dry_run: true }).config.dry_run).toBe(true)
  })

  it('simulates the whole pod lifecycle without RunPod or a key', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; cfg.image = 'ghcr.io/example/comfy-app:v26'; mounts.save(cfg)
    const created = await pods.create({ name: 'sim', gpu: 'a4000', idle_stop_minutes: 15 })
    expect(created.id.startsWith('dry-')).toBe(true); expect(created.status).toBe('starting'); expect(created.gpu).toBe('RTX A4000 x1'); expect(created.vram).toBe(16)
    let d = await pods.dashboard()
    expect(d.dry_run).toBe(true); expect(d.stats.total_pods).toBe(1)
    expect((await pods.get(created.id)).idle_stop_minutes).toBe(15)
    expect(await pods.stop(created.id)).toMatchObject({ pod_id: created.id })
    expect((await pods.list())[0].status).toBe('stopped')
    await pods.resume(created.id)
    expect(await pods.runningIds()()).toEqual(new Set([created.id]))
    const again = await pods.recreate(created.id)
    expect(again.id).not.toBe(created.id); expect(again.name).toBe('sim'); expect((await pods.list()).length).toBe(1)
    await pods.remove(again.id)
    expect((await pods.list()).length).toBe(0); expect(idle.entry(created.id)).toBeUndefined()
    await expect(pods.stop('nope')).rejects.toThrow(/not found/)
    // the image rule still applies: a bare local name is refused even when nothing would be pulled
    cfg.image = 'comfy-app:local'; mounts.save(cfg)
    await expect(pods.create({ name: 'x' })).rejects.toThrow(/local image name/)
  })

  it('a simulated pod becomes running after its boot time', () => {
    const now = Date.now()
    const p = { id: 'dry-1', name: 'x', gpu: 'rtx4090', gpu_count: 1, image: 'i', status: 'running' as const, started_at: new Date(now - 60_000).toISOString(), idle_stop_minutes: 0 }
    expect(dry.toStatus(p, now)).toMatchObject({ status: 'running', uptime_seconds: 60, web_ui_url: 'https://dry-1-8188.proxy.runpod.net' })
    expect(dry.toStatus({ ...p, started_at: new Date(now - 5_000).toISOString() }, now).status).toBe('starting')
  })

  it('a pod created with its own configuration keeps it for Recreate and loses it on delete', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; cfg.image = 'ghcr.io/example/comfy-app:v26'; cfg.idle_stop_minutes = 30; mounts.save(cfg)
    const own = { ...mounts.defaults(), image: 'ghcr.io/example/comfy-app:other', idle_stop_minutes: 5, network_volume_id: 'volB', data_center_id: 'CA-MTL-1', dry_run: false }
    const p = await pods.create({ name: 'own', config: own })
    expect(p.custom_config).toBe(true); expect(p.idle_stop_minutes).toBe(5)
    expect(pods.config(p.id)?.image).toBe('ghcr.io/example/comfy-app:other'); expect(pods.config(p.id)?.dry_run).toBe(true)   // no-spend stays app-wide
    expect((await pods.list()).find((x) => x.id === p.id)?.custom_config).toBe(true)
    const plain = await pods.create({ name: 'plain' })
    expect(plain.custom_config).toBe(false); expect(pods.config(plain.id)).toBeNull()
    const fresh = await pods.recreate(p.id)
    expect(fresh.custom_config).toBe(true); expect(pods.config(p.id)).toBeNull(); expect(pods.config(fresh.id)?.network_volume_id).toBe('volB')
    expect(pods.setConfig(plain.id, { ...own, image: 'ghcr.io/example/comfy-app:third' }).config?.image).toBe('ghcr.io/example/comfy-app:third')
    expect(pods.setConfig(plain.id, null).custom_config).toBe(false); expect(pods.config(plain.id)).toBeNull()
    expect(() => pods.setConfig(plain.id, { ...own, idle_stop_minutes: -1 })).toThrow(/idle_stop_minutes/)
    await pods.remove(fresh.id)
    expect(pods.config(fresh.id)).toBeNull()
    // the plan uses the pod's own configuration, not the default
    const { input } = pods.plan({ name: 'x' }, pods.effectiveConfig({ name: 'x', config: own }).cfg)
    expect(input.imageName).toBe('ghcr.io/example/comfy-app:other'); expect(input.networkVolumeId).toBe('volB')
  })
})
