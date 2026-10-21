import { beforeEach, describe, expect, it } from 'vitest'
import * as mounts from '../src/mounts.js'
import * as syncrun from '../src/syncrun.js'
import { fakeTree, scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch() })

describe('sync from the app', () => {
  it('reads rsync and aws lines as files, progress and problems', () => {
    expect(syncrun.classify('      1,234,567  45%   2.30MB/s    0:00:12')).toMatchObject({ kind: 'progress', percent: 45 })
    expect(syncrun.classify('input/frame_0001.png')).toMatchObject({ kind: 'file', path: 'input/frame_0001.png' })
    expect(syncrun.classify('rsync: [receiver] chown failed: Operation not permitted')).toMatchObject({ kind: 'problem' })
    expect(syncrun.classify('ssh: connect to host 1.2.3.4 port 22: Connection refused')).toMatchObject({ kind: 'problem' })
    expect(syncrun.classify('sending incremental file list')).toMatchObject({ kind: 'line' })
    expect(syncrun.classify('upload: ../plates/a.dpx to s3://vol1/plates/a.dpx')).toMatchObject({ kind: 'file', path: 'plates/a.dpx' })
    expect(syncrun.classify('Completed 2.5 GiB/~5.0 GiB (2.1 MiB/s) with 3 file(s) remaining')).toMatchObject({ kind: 'progress', percent: 50 })
  })

  it('plans a push from the mapped folders and gates the plates on a named yes', () => {
    const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.folders.plates = dir; mounts.save(cfg)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push' }).map((s) => s.key)).toEqual(['project', 'workflows'])   // the repo's workflows always ride along
    expect(() => syncrun.planFor({ pod_id: 'p1', direction: 'push', plates: true })).toThrow(/named yes/)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc' }).map((s) => s.key)).toEqual(['project', 'plates', 'workflows'])
  })

  it('simulates the run in no-spend mode: a step, files, progress, done; the transport says so', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; cfg.folders.project = fakeTree(dir); mounts.save(cfg)
    expect((await syncrun.transportFor('p1')).kind).toBe('ssh')
    const events: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'push' }, (e) => events.push(e), new AbortController().signal)
    expect(r).toEqual({ steps: 2, failed: 0, cancelled: false })   // project and the workflows
    const perStep = ['step', 'line', 'file', 'progress', 'file', 'progress', 'file', 'progress', 'step-done']
    expect(events.map((e) => e.kind)).toEqual(['plan', 'line', ...perStep, ...perStep, 'done'])
    expect(events.filter((e) => e.kind === 'progress').map((e) => e.percent)).toEqual([33, 67, 100, 33, 67, 100])
  })

  it('with nothing mapped only the repo workflows go; a pull with no project tree has nothing', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push' }).map((s) => s.key)).toEqual(['workflows'])
    await expect(syncrun.run({ pod_id: 'p1', direction: 'pull' }, () => {}, new AbortController().signal)).rejects.toThrow(/Nothing to copy/)
  })
})
