import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as pods from '../src/pods.js'
import * as dry from '../src/dry.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json'); process.env.POD_SHOTS_FILE = join(dir, 'pod-shots.json'); process.env.POD_ROUNDS_FILE = join(dir, 'pod-rounds.json'); process.env.ROUND_NAMES_FILE = join(dir, 'round-names.json'); process.env.POD_NAMES_FILE = join(dir, 'pod-names.json'); process.env.RUNPOD_DRY_RUN = '1' })
const mk = (name: string) => dry.create({ name, gpu: 'rtx4090', gpu_count: 1, image: 'simulated', idle_stop_minutes: 0 })

describe('pods in rounds (ADR-039)', () => {
  it('drops a pod into a round, shows it in list and get, takes it out on empty, and refuses an unknown pod', async () => {
    const p = mk('a')
    expect((await pods.list()).find((x) => x.id === p.id)?.round).toBeUndefined()
    expect(await pods.setRound(p.id, ' brynley-comfy-2026-11-06 ')).toEqual({ pod_id: p.id, round: 'brynley-comfy-2026-11-06' })
    expect((await pods.list()).find((x) => x.id === p.id)).toMatchObject({ round: 'brynley-comfy-2026-11-06', round_label: 'brynley-comfy-2026-11-06' })
    expect((await pods.get(p.id)).round).toBe('brynley-comfy-2026-11-06')
    expect(dry.list().find((x) => x.id === p.id)).not.toHaveProperty('round')   // the pod itself is untouched
    expect((await pods.setRound(p.id, '')).round).toBeNull()
    expect((await pods.get(p.id)).round).toBeUndefined()
    await expect(pods.setRound('nope', 'r')).rejects.toThrow(/not found/)
    await expect(pods.setRound(p.id, 'a/b')).rejects.toThrow(/slash/)
  })
  it('a round holds a series of pods, is renamable, and its key is kept', async () => {
    const a = mk('a'), b = mk('b'), c = mk('c')
    await pods.setRound(a.id, 'r1'); await pods.setRound(b.id, 'r1'); await pods.setRound(c.id, 'r2')
    expect(pods.rounds()).toEqual([{ round: 'r1', label: 'r1', pod_ids: [a.id, b.id] }, { round: 'r2', label: 'r2', pod_ids: [c.id] }])
    expect(await pods.renameRound('r1', ' Reel 1 ')).toEqual({ round: 'r1', label: 'Reel 1' })
    expect((await pods.get(a.id))).toMatchObject({ round: 'r1', round_label: 'Reel 1' })
    expect((await pods.renameRound('r1', '')).label).toBe('r1')
    await expect(pods.renameRound('r1', 'x'.repeat(81))).rejects.toThrow(/80/)
  })
  it('the round goes with Recreate and is gone with Delete', async () => {
    const p = mk('a')
    await pods.setRound(p.id, 'r1')
    const fresh = await pods.recreate(p.id)
    expect(fresh.round).toBe('r1'); expect((await pods.get(fresh.id)).round).toBe('r1')
    expect(pods.rounds().flatMap((r) => r.pod_ids)).toEqual([fresh.id])
    await pods.remove(fresh.id)
    expect(pods.rounds()).toEqual([])
  })
  it('a pod created with a round is in it from the start; a bad round is refused before anything is made', async () => {
    const { create } = pods
    const p = await create({ name: 'in-round', gpu: 'rtx4090', round: ' r9 ' } as any)
    expect(p.round).toBe('r9')
    expect((await pods.get(p.id)).round).toBe('r9')
    const none = await create({ name: 'loose', gpu: 'rtx4090' } as any)
    expect(none.round).toBeUndefined()
    const before = dry.list().length
    await expect(create({ name: 'bad', gpu: 'rtx4090', round: 'a/b' } as any)).rejects.toThrow(/slash/)
    expect(dry.list().length).toBe(before)
  })
  it('deleting a round takes its pods out of it and clears its name; the pods stay', async () => {
    const p = await pods.create({ name: 'to-release', gpu: 'rtx4090', round: 'gone' } as any)
    await pods.renameRound('gone', 'Gone reel')
    expect(await pods.deleteRound('gone')).toEqual({ round: 'gone', pods_released: 1 })
    expect((await pods.get(p.id)).round).toBeUndefined()
    expect(pods.rounds().find((r) => r.round === 'gone')).toBeUndefined()
    await expect(pods.deleteRound(' ')).rejects.toThrow(/Which round/)
  })
  it('a pod in a round can say which shot it works on; free text; cleared when it leaves the round; refused with no round', async () => {
    const p = await pods.create({ name: 'shotty', gpu: 'rtx4090' } as any)
    await expect(pods.setShot(p.id, 'cgi-042')).rejects.toThrow(/in a round first/)
    await pods.setRound(p.id, 'r5')
    expect(await pods.setShot(p.id, ' cgi-042 ')).toEqual({ pod_id: p.id, round: 'r5', shot: 'cgi-042' })
    expect((await pods.get(p.id)).shot).toBe('cgi-042')
    await expect(pods.setShot(p.id, 'a/b')).rejects.toThrow(/slash/)
    expect((await pods.setShot(p.id, '')).shot).toBe('All Shots')   // cleared: back to the default
    await pods.setShot(p.id, 'free text shot')
    await pods.setRound(p.id, 'r6')   // another round: no shot yet
    expect((await pods.get(p.id)).shot).toBe('All Shots')   // another round: the default, all of its shots
  })
})
