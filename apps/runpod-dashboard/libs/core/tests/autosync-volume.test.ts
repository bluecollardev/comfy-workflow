import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as autosync from '../src/autosync.js'
import * as store from '../src/autosyncstore.js'
import { CoreError } from '../src/errors.js'
import * as mounts from '../src/mounts.js'
import { scratch } from './helpers.js'

// Auto sync per volume: a pod follows its own enabled entry, else its volume's. Fakes only.
let dir: string, t: number, volumes: Record<string, string>, volFail: Set<string>, listFail: boolean
const T0 = Date.parse('2026-11-18T10:00:00Z')
const pull: string[] = []

beforeEach(() => {
  dir = scratch(); const shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true })
  for (const [k, f] of [['AUTOSYNC_FILE', 'autosync.json'], ['AUTOSYNC_STATE_FILE', 'autosync-state.json'], ['AUTOSYNC_MANIFEST_FILE', 'autosync-manifest.json'], ['HISTORY_FILE', 'history.jsonl'], ['POD_NAMES_FILE', 'pod-names.json']]) process.env[k] = join(dir, f)
  const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = shared; mounts.save(cfg)
  t = T0; volumes = { p1: 'volA', p2: 'volA', p3: 'volB' }; volFail = new Set(); listFail = false; pull.length = 0
  autosync.reset()
  autosync.setDeps({
    now: () => t, podName: (id) => id, tail: async (v) => { pull.push(v); return 'k000' }, reconcile: async () => undefined, parallel: () => 4, localRoot: () => shared,
    listPods: async () => { if (listFail) throw new Error('down'); return Object.keys(volumes).map((id) => ({ id, name: id, status: 'RUNNING' })) },
    volumeOf: async (id) => { if (volFail.has(id)) throw new Error('no volume'); return volumes[id] ?? '' },
    feed: async (v, since) => { pull.push(v); return { volume_id: v, cursor: since, events: [] } },
  })
})
afterEach(() => { autosync.reset(); for (const k of ['AUTOSYNC_FILE', 'AUTOSYNC_STATE_FILE', 'AUTOSYNC_MANIFEST_FILE', 'HISTORY_FILE', 'POD_NAMES_FILE']) delete process.env[k] })
const known = () => store.setVolumeMap(new Map(Object.entries(volumes)))

describe('volume settings', () => {
  it('need a name to turn on, are stored under volume: and never appear as pods', () => {
    expect(() => store.setVolume('volA', { enabled: true })).toThrow(CoreError)
    expect(() => store.setVolume('', { enabled: false })).toThrow(CoreError)
    const r = store.setVolume('volA', { enabled: true, approved_by: 'Lucas' }, () => new Date(T0))
    expect(r).toMatchObject({ enabled: true, pull: true, push: false, approved_by: 'Lucas', approved_at: new Date(T0).toISOString() })
    expect(store.getVolume('volA')).toEqual(r)
    expect(store.volumeEntries()).toEqual({ volA: r })
    expect(store.entries()).toEqual({})
    expect(store.enabledPods()).toEqual([])
    store.forget('volume:volA')   // never mistaken for a pod
    expect(store.getVolume('volA').enabled).toBe(true)
    // a change keeps the yes; off needs nothing
    expect(store.setVolume('volA', { push: true }).approved_by).toBe('Lucas')
    expect(store.setVolume('volA', { enabled: false }).enabled).toBe(false)
  })
})

describe('effective settings', () => {
  it('a pod on an enabled volume is synced, one on another volume is not; own entry wins; own disabled does not block', () => {
    known(); store.setVolume('volA', { enabled: true, pull: true, push: false, approved_by: 'Lucas' })
    expect(store.enabledPods().map((p) => [p.pod_id, p.via]).sort()).toEqual([['p1', 'volume'], ['p2', 'volume']])
    expect(store.get('p1').enabled).toBe(true); expect(store.get('p3').enabled).toBe(false); expect(store.via('p3')).toBe('pod')
    store.set('p1', { enabled: true, push: true, approved_by: 'Ann' })
    expect(store.get('p1')).toMatchObject({ push: true, approved_by: 'Ann' }); expect(store.via('p1')).toBe('pod')
    expect(store.enabledPods().find((p) => p.pod_id === 'p1')!.via).toBe('pod')
    store.set('p2', { enabled: false })   // own disabled entry
    expect(store.get('p2')).toMatchObject({ enabled: true, approved_by: 'Lucas' }); expect(store.via('p2')).toBe('volume')
    store.setVolume('volA', { enabled: false })
    expect(store.get('p2').enabled).toBe(false); expect(store.enabledPods().map((p) => p.pod_id)).toEqual(['p1'])
  })
  it('forget of a pod does not touch volume entries', () => {
    store.setVolume('volA', { enabled: true, approved_by: 'Lucas' }); store.set('p1', { enabled: true, approved_by: 'Lucas' })
    store.forget('p1')
    expect(store.volumeEntries().volA.enabled).toBe(true); expect(store.entries()).toEqual({})
  })
})

describe('the controller', () => {
  it('pulls a pod on an enabled volume, not one on another; turning the volume off stops it', async () => {
    autosync.setVolumeSettings('volA', { enabled: true, approved_by: 'Lucas' })
    await autosync.settle()
    pull.length = 0; t += 120_000
    await autosync.tick(); await autosync.settle()
    expect(store.enabledPods().map((p) => p.pod_id).sort()).toEqual(['p1', 'p2'])
    expect(pull.length).toBeGreaterThan(0); expect(pull.every((v) => v === 'volA')).toBe(true)
    const st = autosync.status().items
    expect(st.map((i) => i.pod_id).sort()).toEqual(['p1', 'p2']); expect(st.every((i) => i.via === 'volume' && i.volume_id === 'volA')).toBe(true)
    expect(autosync.volumeStatus('volA').items.length).toBe(2); expect(autosync.volumeStatus('volB').items.length).toBe(0)
    autosync.setVolumeSettings('volA', { enabled: false })
    await autosync.settle(); pull.length = 0; t += 120_000
    await autosync.tick(); await autosync.settle()
    expect(pull).toEqual([]); expect(store.enabledPods()).toEqual([])
  })
  it('the resolver survives a failing volumeOf and a failing pod list', async () => {
    store.setVolume('volA', { enabled: true, approved_by: 'Lucas' })
    await autosync.refreshVolumes(true)
    expect(store.podVolumeOf('p1')).toBe('volA'); expect(store.podVolumeOf('p3')).toBe('volB')
    volFail.add('p1'); await autosync.refreshVolumes(true)
    expect(store.podVolumeOf('p1')).toBe('volA')   // kept
    listFail = true; await expect(autosync.refreshVolumes(true)).rejects.toThrow()
    expect(store.podVolumeOf('p2')).toBe('volA'); expect(store.get('p2').enabled).toBe(true)
  })
})
