import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as pods from '../src/pods.js'
import * as dry from '../src/dry.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_NAMES_FILE = join(dir, 'pod-names.json'); process.env.RUNPOD_DRY_RUN = '1' })

describe('pod names on our side (rename)', () => {
  it('names a pod here, shows it in list and get, goes back on empty, and refuses a long name or an unknown pod', async () => {
    const p = dry.create({ name: 'ComfyUI-Dev', gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })
    const r = await pods.rename(p.id, '  cgi-042 plates ')
    expect(r).toMatchObject({ pod_id: p.id, name: 'cgi-042 plates' })
    expect((await pods.list()).find((x) => x.id === p.id)?.name).toBe('cgi-042 plates')
    expect((await pods.get(p.id)).name).toBe('cgi-042 plates')
    expect(dry.list().find((x) => x.id === p.id)?.name).toBe('ComfyUI-Dev')   // the pod itself is untouched
    expect((await pods.rename(p.id, '')).name).toBe('ComfyUI-Dev')
    await expect(pods.rename(p.id, 'x'.repeat(81))).rejects.toThrow(/80/)
    await expect(pods.rename('nope', 'a')).rejects.toThrow(/not found/)
  })
  it('the name goes with Recreate and is gone with Delete', async () => {
    const p = dry.create({ name: 'ComfyUI-Dev', gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })
    await pods.rename(p.id, 'reel 3')
    const fresh = await pods.recreate(p.id)
    expect(fresh.name).toBe('reel 3'); expect((await pods.get(fresh.id)).name).toBe('reel 3')
    await pods.remove(fresh.id)
    const again = dry.create({ name: 'x', gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })
    expect((await pods.get(again.id)).name).toBe('x')
  })
})
