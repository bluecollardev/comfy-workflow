import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as sync from '../src/sync.js'
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
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', skip_tests: true }, project)).toEqual(['/80_TEST-BUCKET/'])   // top level of the project only
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', skip_tests: true }, workflows)).toEqual([])
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
    expect((await syncrun.transportFor('p1')).reason).toMatch(/no-spend mode.*8 streams/)
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
    expect(await syncrun.countFor({ pod_id: 'p1', direction: 'push', skip_renders: true })).toEqual({ all: { total_files: 7, total_bytes: 7 * 1.5 * GiB, scanned_files: 7 }, without_renders: { total_files: 6, total_bytes: 6 * 1.5 * GiB, scanned_files: 6 } })
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
    expect(await syncrun.countFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc' }, client, exec)).toEqual({ all: { total_files: 6, total_bytes: 900, scanned_files: 6 }, without_renders: { total_files: 6, total_bytes: 900, scanned_files: 6 } })
    // skipped = every file in scope less what would be sent: a second listing, as if everything were replaced
    const scoped: syncrun.Exec = async (cmd, onLine) => { for (const l of cmd.includes('--ignore-times') ? ['Number of files transferred: 10', 'Total transferred file size: 1000 B'] : ['Number of files transferred: 2', 'Total transferred file size: 300 B']) onLine(l); return 0 }
    const sk = await syncrun.countFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc', existing: 'size' }, client, scoped)
    expect(sk.all).toEqual({ total_files: 6, total_bytes: 900, scanned_files: 30 })
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'push', plates: true, approved_by: 'Binc', existing: 'replace' }, client, scoped)).all).toEqual({ total_files: 30, total_bytes: 3000, scanned_files: 30 })   // replace sends it all: nothing skipped
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

  // ----- which ComfyUI-Shared folders a push carries (docs/ADR-011) -----
  const sharedTree = () => {
    const root = join(dir, 'shared')
    for (const d of ['input', 'models', 'output', 'workflows', 'custom']) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, 'a.txt'), d) }
    mkdirSync(join(root, 'input', 'output'), { recursive: true }); writeFileSync(join(root, 'input', 'output', 'keep.txt'), 'a folder named output deeper down is not the top-level one')
    return root
  }
  const shared = (steps: ReturnType<typeof syncrun.planFor>) => steps.find((s) => s.key === 'comfy-shared')!

  it('excludes the unchosen subfolders of ComfyUI-Shared at the top level only, on a push; the rest of the folder always goes', () => {
    const step = { key: 'comfy-shared', local: '/x/', remote: '/workspace/comfy-shared/' }
    const push = (s?: string[]) => syncrun.excludesFor({ pod_id: 'p1', direction: 'push', shared: s }, step)
    expect(push(['input', 'models', 'workflows'])).toEqual(['/output/'])
    expect(push(['input', 'models', 'output', 'workflows'])).toEqual([])
    expect(push([])).toEqual(['/input/', '/models/', '/output/', '/workflows/'])
    expect(push(undefined)).toEqual([])   // the request says nothing: the run decides from the configuration (effectiveShared)
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'pull', shared: [] }, step)).toEqual([])
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', shared: [] }, { ...step, key: 'project' })).toEqual([])   // only ComfyUI-Shared has these subfolders
  })

  it('the default carries input, models and workflows and leaves output; a pod\'s own configuration and the request each override it', () => {
    expect(mounts.defaults().sync_shared).toEqual(['input', 'models', 'workflows'])
    expect(syncrun.effectiveShared({ pod_id: 'p1' })).toEqual(['input', 'models', 'workflows'])
    const own = mounts.defaults(); own.sync_shared = ['output']
    podconfigs.set('p1', own)
    expect(syncrun.effectiveShared({ pod_id: 'p1' })).toEqual(['output'])   // this pod's
    expect(syncrun.effectiveShared({ pod_id: 'p2' })).toEqual(['input', 'models', 'workflows'])   // another pod: the default
    expect(syncrun.effectiveShared({ pod_id: 'p1', shared: ['models'] })).toEqual(['models'])   // what the Sync window sends wins
  })

  it('without Workflows ticked the repo\'s workflows step goes too', () => {
    const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = sharedTree(); mounts.save(cfg)
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push' }).map((s) => s.key)).toEqual(['comfy-shared', 'workflows'])
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'push', shared: ['input', 'models'] }).map((s) => s.key)).toEqual(['comfy-shared'])
    expect(syncrun.planFor({ pod_id: 'p1', direction: 'pull' }).map((s) => s.key)).not.toContain('workflows')
  })

  it('splits the folder into streams without the unchosen subfolders, and an output folder deeper down still goes', () => {
    const root = sharedTree()
    expect(syncrun.streamsOf(root + '/', '/workspace/comfy-shared/', ['/output/']).map((u) => u.name)).toEqual(['.', 'custom', 'input', 'models', 'workflows'])
    expect(syncrun.streamsOf(root + '/', '/workspace/comfy-shared/', []).map((u) => u.name)).toEqual(['.', 'custom', 'input', 'models', 'output', 'workflows'])
  })

  it('the AWS CLI gets the same: the top level of the folder pushed, and an unanchored name anywhere below', () => {
    expect(sync.s3ExcludesFor(['/output/'])).toEqual(['--exclude', 'output/*'])
    expect(sync.s3ExcludesFor(['06_REVIEW/'])).toEqual(['--exclude', '06_REVIEW/*', '--exclude', '*/06_REVIEW/*'])
    const cmd = sync.s3Cmd('/x/', { id: 'vol1', datacenter: 'EU-RO-1', name: 'v' }, '/workspace/comfy-shared/', { exclude: ['/output/'] })
    expect(cmd.join(' ')).toContain('--exclude output/*')
  })

  it('simulated: output stays home unless ticked, and the counts follow the choice', async () => {
    const cfg = mounts.defaults(); cfg.dry_run = true; cfg.folders.project = fakeTree(dir); cfg.folders['comfy-shared'] = sharedTree(); mounts.save(cfg)   // the shared folder is the plan's second step: the simulated files with an output/ in them
    const filesOf = async (req: Partial<syncrun.SyncRequest>) => { const ev: syncrun.SyncEvent[] = []; await syncrun.run({ pod_id: 'p1', direction: 'push', ...req }, (e) => ev.push(e), new AbortController().signal); return ev.filter((e) => e.kind === 'file' && e.key === 'comfy-shared').map((e) => e.path!) }
    const standard = await filesOf({})   // the default: output stays home
    expect(standard.some((f) => f.startsWith('output/'))).toBe(false); expect(standard.length).toBeGreaterThan(0)
    expect((await filesOf({ shared: ['input', 'models', 'output', 'workflows'] })).filter((f) => f.startsWith('output/'))).toHaveLength(3)
    const withOutput = (await syncrun.countFor({ pod_id: 'p1', direction: 'push', shared: ['input', 'models', 'output', 'workflows'] })).all.total_files!
    const without = (await syncrun.countFor({ pod_id: 'p1', direction: 'push' })).all.total_files!
    expect(withOutput - without).toBe(3)   // the confirmation's count follows the choice
  })

  it('over SSH: the root stream keeps the top-level exclude, no stream is made for the unchosen folder, and the other streams do not carry an exclude that would hit a folder of the same name deeper down', async () => {
    const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = sharedTree(); mounts.save(cfg)
    const copies: string[][] = []
    const exec: syncrun.Exec = async (cmd, onLine) => { if (!cmd.includes('-n')) copies.push(cmd); for (const l of ['Transfer starting: 1 files', 'a.txt', 'Number of files transferred: 1', 'Total transferred file size: 5 B']) onLine(l); return 0 }
    await syncrun.run({ pod_id: 'p1', direction: 'push', only: ['comfy-shared'] }, () => {}, new AbortController().signal, client, exec)
    const dests = copies.map((c) => c[c.length - 1])
    expect(dests).toEqual(['root@5.6.7.8:/workspace/comfy-shared/', ...['custom', 'input', 'models', 'workflows'].map((n) => `root@5.6.7.8:/workspace/comfy-shared/${n}/`)].sort((a, b) => (a.endsWith('comfy-shared/') ? -1 : b.endsWith('comfy-shared/') ? 1 : a < b ? -1 : 1)).sort((a, b) => dests.indexOf(a) - dests.indexOf(b)) as string[])
    expect(copies[0]).toContain('/output/')                                       // the root stream: its directory entries, without output
    expect(copies.slice(1).every((c) => !c.includes('/output/'))).toBe(true)      // the others: nothing anchored (input/output/keep.txt goes)
    expect(dests.some((d) => d.endsWith('/output/'))).toBe(false)
  })
})
