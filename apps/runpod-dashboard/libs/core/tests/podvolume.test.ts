import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as podvolume from '../src/podvolume.js'
import * as syncrun from '../src/syncrun.js'
import { scratch } from './helpers.js'

// RunPod returns no networkVolumeId for a STOPPED pod: its own saved configuration first, then the volume last seen while it ran, then the Default Configuration's.
let dir: string
beforeEach(() => { dir = scratch(); podvolume.reset(); mounts.save(mounts.defaults()) })
describe('which volume a pod follows', () => {
  it('own saved configuration wins; then the remembered volume; then the Default Configuration; unknown is empty', async () => {
    expect(syncrun.volumeIdFor('pod-a')).toBe('')
    mounts.save({ ...mounts.defaults(), network_volume_id: 'vol-default' }); expect(syncrun.volumeIdFor('pod-a')).toBe('vol-default')
    podvolume.remember('pod-a', 'vol-seen'); expect(syncrun.volumeIdFor('pod-a')).toBe('vol-seen')   // seen while it ran: counts as attached
    podconfigs.set('pod-a', { ...mounts.defaults(), network_volume_id: 'vol-own' }); expect(syncrun.volumeIdFor('pod-a')).toBe('vol-own')
    expect(syncrun.volumeIdFor('pod-b')).toBe('vol-default')
  })
  it('the cache is persisted: after a restart (the memory forgotten) it is read from the file; nothing is written when it did not change', async () => {
    podvolume.remember('pod-c', 'vol-9'); await podvolume.settled(); expect(JSON.parse(readFileSync(join(dir, 'pod-volumes.json'), 'utf8'))).toEqual({ 'pod-c': 'vol-9' })
    podvolume.reset(); expect(podvolume.recall('pod-c')).toBe('vol-9'); expect(syncrun.volumeIdFor('pod-c')).toBe('vol-9')
  })
})
