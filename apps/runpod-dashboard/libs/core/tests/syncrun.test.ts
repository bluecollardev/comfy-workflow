import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as syncrun from '../src/syncrun.js'
import { fakeTree, scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch() })

const GiB = 1024 ** 3
const pod = { id: 'p1', name: 'p', networkVolumeId: null, runtime: { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
const client = { apiKey: 'test', fetchFn: (async () => ({ status: 200, json: async () => ({ data: { pod } }) })) as unknown as typeof fetch }

describe('sync from the app', () => {
  it('reads rsync and aws lines as files, progress and problems', () => {
    expect(syncrun.classify('      1,234,567  45%   2.30MB/s    0:00:12')).toMatchObject({ kind: 'progress', bytes: 1234567, percent: 45, cumulative: false, final: false })
    expect(syncrun.classify('  1,234,567  45%   2.30MB/s    0:00:12 (xfr#3, to-chk=10/20)')).toMatchObject({ kind: 'progress', bytes: 1234567, cumulative: true })   // rsync 3's progress2: the folder so far
    expect(syncrun.classify('       30000000 100%   13.94MB/s   00:00:02 (xfer#6, to-check=9/10)')).toMatchObject({ kind: 'progress', bytes: 30000000, percent: 100, final: true })   // openrsync closing a file
    expect(syncrun.classify('input/frame_0001.png')).toMatchObject({ kind: 'file', path: 'input/frame_0001.png' })
    expect(syncrun.classify('a/')).toMatchObject({ kind: 'line' })   // a directory, not a file that landed
    expect(syncrun.classify('Transfer starting: 24220 files')).toMatchObject({ kind: 'line', total_files: 24220 })
    expect(syncrun.classify('Number of files transferred: 7')).toMatchObject({ kind: 'line' })
    expect(syncrun.classify('rsync: [receiver] chown failed: Operation not permitted')).toMatchObject({ kind: 'problem' })
    expect(syncrun.classify('ssh: connect to host 1.2.3.4 port 22: Connection refused')).toMatchObject({ kind: 'problem' })
    expect(syncrun.classify('sending incremental file list')).toMatchObject({ kind: 'line' })
    expect(syncrun.classify('upload: ../plates/a.dpx to s3://vol1/plates/a.dpx')).toMatchObject({ kind: 'file', path: 'plates/a.dpx' })
    expect(syncrun.classify('Completed 2.5 GiB/~5.0 GiB (2.1 MiB/s) with 3 file(s) remaining')).toMatchObject({ kind: 'progress', percent: 50, bytes: 2.5 * GiB, cumulative: true })
  })

  it('reads the listing pass: openrsync and rsync 3 label the counts the same', () => {
    expect(syncrun.parseStats(['Transfer starting: 11 files', 'Number of files: 11', 'Number of files transferred: 7', 'Total file size: 31850110 B', 'Total transferred file size: 31850110 B'])).toEqual({ total_files: 7, total_bytes: 31850110 })
    expect(syncrun.parseStats(['Number of files: 11 (reg: 7, dir: 4)', 'Number of regular files transferred: 7', 'Total transferred file size: 31,850,110 bytes'])).toEqual({ total_files: 7, total_bytes: 31850110 })
    expect(syncrun.parseStats(['rsync error: unexplained error (code 255)'])).toEqual({})
  })

  it('tallies a folder: files as they start, bytes summed over openrsync\'s per-file lines, progress at most four a second, the pace of the run', () => {
    let clock = 1000
    const run = new syncrun.RunMeter(() => clock); run.total = 40_000_000
    const events: syncrun.SyncEvent[] = []
    const m = syncrun.stepMeter('project', run, (e) => events.push(e), () => clock)
    const lines = ['Transfer starting: 10 files', 'top.bin', '          50000 100%  207.47MB/s   00:00:00 (xfer#1, to-check=1/10)',
      'a/', 'b/c/big.exr', '       10485760  35%   10.05MB/s   00:00:01', '       22773760  76%   11.66MB/s   00:00:00', '       30000000 100%   13.94MB/s   00:00:02 (xfer#6, to-check=9/10)',
      'rsync: [generator] failed to set times on "/workspace/project/a": Operation not permitted (1)', 'sent 31854548 bytes  received 170 bytes  15477730 bytes/sec']
    for (const l of lines) { m.line(l); clock += 200 }
    m.finish()
    expect(events.map((e) => e.kind)).toEqual(['line', 'file', 'progress', 'line', 'file', 'progress', 'progress', 'problem', 'line', 'progress'])   // 76% came 200 ms after 35%: dropped; the close of the file 400 ms later went; finish flushes
    expect(events[0].total_files).toBe(10)
    const progress = events.filter((e) => e.kind === 'progress')
    expect(progress.map((e) => e.bytes_done)).toEqual([50000, 10485760 + 50000, 30050000, 30050000])
    expect(progress.map((e) => e.file_percent)).toEqual([100, 35, 100, 100])
    expect(progress[0]).not.toHaveProperty('rate_bps')   // the first byte starts the clock
    expect(progress[2].rate_bps).toBe(30050000); expect(progress[2].eta_s).toBe(Math.round((40_000_000 - 30050000) / 30050000))   // one second in
    expect(run.before).toBe(30050000)   // the next folder's bytes count on from here
    // two streams of one folder add up; rsync 3's progress2 line is the stream's running total, no per-file sum
    const tally = new syncrun.StepTally('workflows', run, (e) => events.push(e), () => clock)
    const a = tally.stream('graphs'), b = tally.stream('models')
    a.line('graphs/x.json'); a.line('     1000 100%   1.00MB/s   00:00:00 (xfer#1, to-check=0/1)'); clock += 300
    b.line('  1,234,567  45%   2.30MB/s    0:00:12 (xfr#3, to-chk=10/20)')
    expect(events.at(-3)).toMatchObject({ kind: 'file', key: 'workflows', stream: 'graphs', path: 'graphs/x.json' })
    expect(events.at(-2)).toMatchObject({ kind: 'progress', key: 'workflows', bytes_done: 1000, file_percent: 100 })
    expect(events.at(-1)).toMatchObject({ kind: 'progress', key: 'workflows', bytes_done: 1234567 + 1000, run_bytes_done: 30050000 + 1234567 + 1000 })
  })

  it('plans a push from the mapped folders and gates the plates on a named yes; the renders are excluded on request', () => {
    const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.folders.plates = dir; mounts.save(cfg)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push' }).map((s) => s.key)).toEqual(['project', 'workflows'])   // the repo's workflows always ride along
    expect(() => syncrun.planFor({ pod_id: 'p1', direction: 'push', plates: true })).toThrow(/named yes/)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc' }).map((s) => s.key)).toEqual(['project', 'plates', 'workflows'])
    const [project, workflows] = syncrun.planFor({ pod_id: 'p1', direction: 'push' })
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', skip_renders: true }, project)).toEqual(['05_TEMPS/', '06_REVIEW/', '07_DELIVER/'])
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', skip_renders: true }, workflows)).toEqual([])
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'pull', skip_renders: true }, project)).toEqual([])   // Pull is what brings renders back
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push' }, project)).toEqual([])
  })

  it('splits a folder into streams: its root first, then each top-level directory the excludes keep', () => {
    const tree = fakeTree(dir)
    mkdirSync(join(tree, '.git')); mkdirSync(join(tree, '06_REVIEW')); writeFileSync(join(tree, 'notes.md'), 'x')
    const streams = syncrun.streamsOf(tree + '/', '/workspace/project/', ['06_REVIEW/'])
    expect(streams.map((s) => s.name)).toEqual(['.', '00_POLICY', '04_TRACKER', '10_CORROSION'])   // .git by EXCLUDE, 06_REVIEW by the request
    expect(streams[0]).toMatchObject({ local: tree + '/', remote: '/workspace/project/', shallow: true })
    expect(streams[3]).toMatchObject({ local: join(tree, '10_CORROSION') + '/', remote: '/workspace/project/10_CORROSION/', shallow: false })
    expect(syncrun.streamsOf('/nowhere/at/all/', '/workspace/x/')).toMatchObject([{ name: '.', shallow: false }])
    expect(syncrun.worstCode([0, 23, 0])).toBe(23); expect(syncrun.worstCode([23, 255, 24])).toBe(255); expect(syncrun.worstCode([0, 0])).toBe(0)
  })

  it('simulates the run in no-spend mode: every folder listed, then each in streams with its files, bytes and progress; the transport says so', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; cfg.folders.project = fakeTree(dir); mounts.save(cfg)
    expect((await syncrun.transportFor('p1')).reason).toMatch(/no-spend mode.*4 streams/)
    const events: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'push' }, (e) => events.push(e), new AbortController().signal)
    expect(r).toEqual({ steps: 2, failed: 0, warned: 0, cancelled: false })   // project and the workflows
    const kinds = events.map((e) => e.kind)
    expect(kinds.slice(0, 5)).toEqual(['plan', 'line', 'listing', 'listing', 'totals'])   // the listing passes come first
    expect(events[4]).toMatchObject({ total_files: 7, total_bytes: 7 * 1.5 * GiB })
    expect(events.filter((e) => e.kind === 'step')).toMatchObject([{ key: 'project', total_files: 3, total_bytes: 3 * 1.5 * GiB }, { key: 'workflows', total_files: 4, total_bytes: 4 * 1.5 * GiB }])
    expect(events.filter((e) => e.kind === 'line' && e.total_files).reduce((a, e) => a + e.total_files!, 0)).toBe(7)   // openrsync's own count, per stream
    const files = events.filter((e) => e.kind === 'file')
    expect(files).toHaveLength(7)
    expect(new Set(files.map((e) => e.stream))).toEqual(new Set(['models', '10_CORROSION', 'input', 'output']))   // one stream per top-level directory
    expect(kinds.indexOf('step-done')).toBeLessThan(kinds.lastIndexOf('step'))   // the second folder starts after the first ends
    const progress = events.filter((e) => e.kind === 'progress')
    expect(progress.at(-1)).toMatchObject({ key: 'workflows', bytes_done: 4 * 1.5 * GiB, run_bytes_done: 7 * 1.5 * GiB })
    expect(progress.every((e, i) => i === 0 || e.run_bytes_done! >= progress[i - 1].run_bytes_done!)).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: '2 folders in step' })
    // without the renders: the project's review frame stays home; the confirmation gets both figures
    const skipped: syncrun.SyncEvent[] = []
    await syncrun.run({ pod_id: 'p1', direction: 'push', skip_renders: true }, (e) => skipped.push(e), new AbortController().signal)
    expect(skipped.filter((e) => e.kind === 'file')).toHaveLength(6)
    expect(skipped.find((e) => e.kind === 'step')).toMatchObject({ key: 'project', total_files: 2 })
    expect(await syncrun.countFor({ pod_id: 'p1', direction: 'push', skip_renders: true })).toEqual({ all: { total_files: 7, total_bytes: 7 * 1.5 * GiB }, without_renders: { total_files: 6, total_bytes: 6 * 1.5 * GiB } })
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'pull' })).without_renders).toBeUndefined()   // a pull brings the renders back: one figure
  })

  it('over SSH: a listing per folder, the root stream first, then up to sync_parallel streams; rsync 23 and 24 are warnings, any other code a failure; the next folder starts either way', async () => {
    const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.folders.plates = dir; cfg.sync_parallel = 2; mounts.save(cfg)
    const copies: string[][] = []; const listings: string[][] = []
    let inFlight = 0, most = 0
    const exec: syncrun.Exec = async (cmd, onLine) => {
      const remote = cmd[cmd.length - 1]
      if (cmd.includes('-n')) { listings.push(cmd); for (const l of ['Transfer starting: 3 files', 'a.png', 'b.png', 'Number of files transferred: 2', 'Total transferred file size: 300 B']) onLine(l); return 0 }
      copies.push(cmd); inFlight++; most = Math.max(most, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      for (const l of ['Transfer starting: 3 files', 'a.png', '       100 100%   13.94MB/s   00:00:02 (xfer#1, to-check=0/3)', 'rsync: [generator] failed to set times on "/workspace/project/a.png": Operation not permitted (1)']) onLine(l)
      inFlight--
      return remote.includes('/workspace/project/') && cmd.includes('-d') ? 23 : remote.includes('/workspace/plates/') ? 255 : 0
    }
    const events: syncrun.SyncEvent[] = []
    const r = await syncrun.run({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc', skip_renders: true }, (e) => events.push(e), new AbortController().signal, client, exec)
    expect(r).toEqual({ steps: 3, failed: 1, warned: 1, cancelled: false })
    expect(listings).toHaveLength(3); expect(listings[0]).toContain('--stats'); expect(listings[0][listings[0].length - 1]).toBe('root@5.6.7.8:/workspace/project/')
    expect(listings[0]).toContain('06_REVIEW/'); expect(listings[2]).not.toContain('06_REVIEW/')   // the renders left out of the project's count, and its copy
    const project = copies.filter((c) => c[c.length - 1].startsWith('root@5.6.7.8:/workspace/project/'))
    expect(project.map((c) => c[c.length - 1])).toEqual(['root@5.6.7.8:/workspace/project/', 'root@5.6.7.8:/workspace/project/00_POLICY/', 'root@5.6.7.8:/workspace/project/04_TRACKER/', 'root@5.6.7.8:/workspace/project/10_CORROSION/'])
    expect(project[0]).toContain('-d'); expect(project[0]).toContain('-lt'); expect(project[0]).not.toContain('-rlt')   // the root: its own files, the directory entries, no recursion
    expect(project[1]).toContain('-rlt'); expect(project[1]).not.toContain('-n'); expect(project[1]).toContain('06_REVIEW/')
    expect(most).toBe(2)   // sync_parallel
    expect(events.find((e) => e.kind === 'totals')).toMatchObject({ total_files: 6, total_bytes: 900 })
    expect(events.filter((e) => e.kind === 'step').map((e) => [e.key, e.total_files])).toEqual([['project', 2], ['plates', 2], ['workflows', 2]])
    const order = events.filter((e) => e.kind === 'step' || e.kind === 'step-done').map((e) => `${e.kind}:${e.key}${e.code !== undefined ? ':' + e.code : ''}`)
    expect(order).toEqual(['step:project', 'step-done:project:23', 'step:plates', 'step-done:plates:255', 'step:workflows', 'step-done:workflows:0'])
    expect(events.find((e) => e.kind === 'line' && /^rsync exit 23/.test(e.text || ''))?.key).toBe('project')
    expect(events.filter((e) => e.kind === 'file' && e.key === 'project').map((e) => e.stream).sort()).toEqual(['00_POLICY', '04_TRACKER', '10_CORROSION', undefined].sort())
    expect(events.at(-1)).toMatchObject({ kind: 'done', text: '1 of 3 folders failed' })
    expect(await syncrun.countFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc' }, client, exec)).toEqual({ all: { total_files: 6, total_bytes: 900 }, without_renders: { total_files: 6, total_bytes: 900 } })
  })

  it('a real process: its lines, then its exit code once it closes (23 included); a listing that runs out knows nothing', async () => {
    const lines: string[] = []
    const code = await syncrun.runCommand(['sh', '-c', 'printf "a.png\\nb.png\\n"; exit 23'], (l) => lines.push(l), new AbortController().signal)
    expect(code).toBe(23); expect(lines).toEqual(['a.png', 'b.png'])
    const t0 = Date.now()
    expect(await syncrun.listStep(['sh', '-c', 'sleep 5'], new AbortController().signal, process.env, syncrun.runCommand, 150)).toEqual({})
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(await syncrun.listStep(['sh', '-c', 'echo "Number of files transferred: 4"; echo "Total transferred file size: 99 B"; exit 23'], new AbortController().signal, process.env)).toEqual({ total_files: 4, total_bytes: 99 })   // a warning still counted
  })

  it('with nothing mapped only the repo workflows go; a pull with no project tree has nothing', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; mounts.save(cfg)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push' }).map((s) => s.key)).toEqual(['workflows'])
    await expect(syncrun.run({ pod_id: 'p1', direction: 'pull' }, () => {}, new AbortController().signal)).rejects.toThrow(/Nothing to copy/)
  })
})
