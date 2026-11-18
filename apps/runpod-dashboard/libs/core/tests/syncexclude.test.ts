import { beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as configio from '../src/configio.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as pods from '../src/pods.js'
import * as sync from '../src/sync.js'
import * as syncfolders from '../src/syncfolders.js'
import * as syncrun from '../src/syncrun.js'
import { fakeTree, scratch } from './helpers.js'

// docs/ADR-011, "Leaving folders out": a push can leave folders out (Binc excludes CANALV2, which is massive). Fakes only.
const GB = 1e9, TB = 1e12
let dir: string, shared: string, volumeGb: number, cmds: string[][], sizes: (cmd: string[]) => number
const pod = { id: 'p1', name: 'p', networkVolumeId: 'vol1', runtime: { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
const client = { apiKey: 'test', fetchFn: (async (url: string) => (String(url).includes('graphql') ? { ok: true, status: 200, json: async () => ({ data: { pod } }) } : { ok: true, status: 200, json: async () => ({ id: 'vol1', name: 'v', size: volumeGb, dataCenterId: 'EU-RO-1' }) })) as unknown as typeof fetch }
const exec: syncrun.Exec = async (cmd, onLine) => {
  if (cmd[0] === 'ssh') { onLine('Filesystem 1024-blocks Used Available Capacity Mounted on'); onLine(`/dev/x 1000000000 1 ${Math.round(900 * GB / 1024)} 1% /workspace`); return 0 }
  cmds.push(cmd)
  if (cmd.includes('-n')) { onLine('Number of files transferred: 3'); onLine(`Total transferred file size: ${sizes(cmd)} B`); return 0 }
  onLine('a.png'); return 0
}
const push = (o: Partial<syncrun.SyncRequest> = {}, ev: syncrun.SyncEvent[] = []) => syncrun.run({ pod_id: 'p1', direction: 'push', ...o }, (e) => ev.push(e), new AbortController().signal, client, exec)
const projectOnly = { only: ['project'] }
const remoteArg = (c: string[]) => c[c.length - 1]
/** The project step is 2.1 TB when CANALV2 is not left out, 10 GB when it is. */
const bigProject = (cmd: string[]) => (cmd[cmd.length - 1].includes('/workspace/project/') ? (cmd.includes('CANALV2/') || cmd.includes('/CANALV2/') ? 10 * GB : 2.1 * TB) : 1000)

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); process.env.HISTORY_FILE = join(dir, 'h.jsonl'); process.env.POD_CONFIGS_FILE = join(dir, 'pc.json'); process.env.POD_NAMES_FILE = join(dir, 'pn.json'); process.env.IDLE_FILE = join(dir, 'i.json'); process.env.POD_ROUNDS_FILE = join(dir, 'pr.json'); process.env.REPOSITORIES_FILE = join(dir, 'repos.json')
  process.env.SYNC_LOGS_DIR = join(dir, 'logs'); process.env.SYNC_RUNS_FILE = join(dir, 'runs.json')
  mkdirSync(join(shared, 'workflows'), { recursive: true }); writeFileSync(join(shared, 'workflows', 'g.json'), '{}')
  const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.folders['comfy-shared'] = shared; cfg.network_volume_id = 'vol1'; mounts.save(cfg)
  cmds = []; volumeGb = 1000; sizes = bigProject; syncfolders.setDeps(null); syncfolders.forgetMeasures()
})

describe('the patterns', () => {
  it('valid ones are trimmed and de-duplicated; spaces, quotes, ; and wildcards are fine (they are data)', () => {
    expect(mounts.validateExcludes(['  CANALV2/ ', '/CANALV2/', 'CANALV2/', 'a b', "it's;rm -rf /", '*.tmp', 'x/y'])).toEqual(['CANALV2/', '/CANALV2/', 'a b', "it's;rm -rf /", '*.tmp', 'x/y']); expect(mounts.validateExcludes(undefined)).toEqual([]); expect(mounts.validateExcludes([])).toEqual([])
  })
  it('refuses empty, NUL, line breaks, .. segments, a leading ~, over 200 characters, more than 100, non-text, a non-list (400 naming the field)', () => {
    for (const bad of [[''], ['   '], ['a\u0000b'], ['a\nb'], ['a\rb'], ['../x'], ['a/../b'], ['..'], ['~/x'], ['~'], ['x'.repeat(201)], [5], [null]]) expect(() => mounts.validateExcludes(bad as never), JSON.stringify(bad)).toThrow(/sync_exclude/)
    expect(() => mounts.validateExcludes(Array.from({ length: 101 }, (_, i) => `d${i}/`))).toThrow(/at most 100/); expect(() => mounts.validateExcludes('CANALV2/' as never)).toThrow(/list/); expect(() => mounts.validateExcludes(['..x'])).not.toThrow()   // a name that merely contains dots
    expect(mounts.validateExcludes(Array.from({ length: 100 }, (_, i) => `d${i}/`))).toHaveLength(100); expect(() => mounts.validateExcludes(['x'.repeat(200)])).not.toThrow()
    expect(() => mounts.validateExcludes(['..'], 'exclude')).toThrow(/^exclude:/); expect(() => syncrun.planFor({ pod_id: 'p1', direction: 'push', exclude: ['../x'] })).toThrow(/exclude:/); expect(() => syncrun.countFor({ pod_id: 'p1', direction: 'push', exclude: ['../x'] })).rejects.toThrow(/exclude: a pattern has no \.\. segment/)
  })
})

describe('rsync: arguments as an array, never --delete-excluded', () => {
  it('anchored, any depth and folders only reach the command as separate arguments, with the built-in ones; names with spaces and quotes stay one argument', async () => {
    const ev: syncrun.SyncEvent[] = []; await push({ ...projectOnly, exclude: ['CANALV2/', '/Top Only/', "it's;x", 'a b.tmp'] }, ev)
    const copy = cmds.filter((c) => !c.includes('-n') && c[c.length - 1].includes('/workspace/project/'))[0]
    const ex = (c: string[]) => c.flatMap((a, i) => (a === '--exclude' ? [c[i + 1]] : []))
    for (const p of ['CANALV2/', '/Top Only/', "it's;x", 'a b.tmp']) expect(ex(copy)).toContain(p)
    expect(ex(copy)).toEqual(expect.arrayContaining(['.DS_Store', '.git']))   // the built-in ones are still there
    for (const c of cmds) { expect(c).not.toContain('--delete-excluded'); expect(c.join(' ')).not.toMatch(/--delete/) }
    const root = cmds.find((c) => c.includes('-d') && c.includes('-lt'))!; expect(ex(root)).toContain('/Top Only/')
  })
  it('--delete-excluded never appears, whatever the options', () => {
    for (const o of [{ exclude: ['x/'], existing: 'replace' as const }, {}, { dryRun: true, stats: true, shallow: true }]) { const c = sync.rsyncCmd('/l/', 'root@h', 22, '/r/', { ...o, exclude: ['CANALV2/', '/Z/'] } as never); expect(c.join(' ')).not.toMatch(/--delete/) }
  })
})

describe('the AWS CLI globs', () => {
  it('s3Glob: folders anywhere, anchored folders, plain names, anchored names, patterns with a slash inside', () => {
    expect(sync.s3Glob('X/')).toEqual(['X/*', '*/X/*']); expect(sync.s3Glob('/X/')).toEqual(['X/*']); expect(sync.s3Glob('X')).toEqual(['X', '*/X', 'X/*', '*/X/*']); expect(sync.s3Glob('/X')).toEqual(['X', 'X/*'])
    expect(sync.s3Glob('a/b')).toEqual(['a/b', 'a/b/*']); expect(sync.s3Glob('a/b/')).toEqual(['a/b/*']); expect(sync.s3Glob('*.tmp')).toEqual(['*.tmp', '*/*.tmp', '*.tmp/*', '*/*.tmp/*'])
  })
  it('s3ExcludesFor and the push command carry them as --exclude arguments (the existing callers are unchanged)', () => {
    expect(sync.s3ExcludesFor(['/output/'])).toEqual(['--exclude', 'output/*']); expect(sync.s3ExcludesFor(['06_REVIEW/'])).toEqual(['--exclude', '06_REVIEW/*', '--exclude', '*/06_REVIEW/*'])
    const c = sync.s3Cmd('/l/', { id: 'vol1', datacenter: 'EU-RO-1' }, '/workspace/project/', { exclude: ['CANALV2/', 'my file'] }); const g = c.flatMap((a, i) => (a === '--exclude' ? [c[i + 1]] : []))
    expect(g).toEqual(expect.arrayContaining(['CANALV2/*', '*/CANALV2/*', 'my file', '*/my file'])); expect(c).not.toContain('--delete-excluded'); expect(c.join(' ')).not.toMatch(/--delete/)
  })
})

describe('the effective list: the pod\'s own (else the default) plus the run\'s', () => {
  it('a pod\'s own sync_exclude replaces the default; the request adds; a pull is untouched', () => {
    const cfg = mounts.load(); cfg.sync_exclude = ['A/']; mounts.save(cfg); podconfigs.set('p1', { ...cfg, sync_exclude: ['B/'] })
    expect(syncrun.effectiveExcludes({ pod_id: 'p1', exclude: ['C/'] })).toEqual(['B/', 'C/']); expect(syncrun.effectiveExcludes({ pod_id: 'other', exclude: ['C/', 'A/'] })).toEqual(['A/', 'C/']); expect(syncrun.effectiveExcludes({ pod_id: 'p1' })).toEqual(['B/'])
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', exclude: ['C/'] }, { key: 'project', local: '', remote: '' })).toEqual(expect.arrayContaining(['B/', 'C/'])); expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'pull', exclude: ['C/'] }, { key: 'output', local: '', remote: '' })).toEqual([])
    for (const key of ['project', 'plates', 'comfy-shared', 'workflows']) expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push' }, { key, local: '', remote: '' })).toContain('B/')   // every push step
    expect(syncrun.excludesFor({ pod_id: 'p1', direction: 'push', paths: ['output/a'] } as never, { key: 'comfy-shared', local: '', remote: '' })).not.toContain('B/')   // an explicit file list is not filtered
  })
})

describe('totals, count() and the preflight follow the excludes (the CANALV2 case)', () => {
  it('2.1 TB of CANALV2 on a 1,000 GB volume: refused without the exclude, sent with it; the totals and over_capacity shrink', async () => {
    await expect(push(projectOnly)).rejects.toThrow(/This push would send 2\.1 TB/); expect(cmds.every((c) => c.includes('-n'))).toBe(true)
    cmds = []; const ev: syncrun.SyncEvent[] = []; const r = await push({ ...projectOnly, exclude: ['CANALV2/'] }, ev)
    expect(r.failed).toBe(0); expect(ev.find((e) => e.kind === 'totals')).toMatchObject({ total_bytes: 10 * GB, over_capacity: false, capacity_bytes: 1000 * GB }); expect(cmds.some((c) => !c.includes('-n'))).toBe(true)
  })
  it('count(): both variants use the same excludes, over_capacity flips to false; a configured exclude does the same', async () => {
    let c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', ...projectOnly, skip_renders: true }, client, exec); expect(c.all).toMatchObject({ total_bytes: 2.1 * TB, over_capacity: true }); expect(c.without_renders).toMatchObject({ over_capacity: true })
    c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', ...projectOnly, skip_renders: true, exclude: ['/CANALV2/'] }, client, exec); expect(c.all).toMatchObject({ total_bytes: 10 * GB, over_capacity: false }); expect(c.without_renders).toMatchObject({ total_bytes: 10 * GB, over_capacity: false })
    const cfg = mounts.load(); cfg.sync_exclude = ['CANALV2/']; mounts.save(cfg); c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', ...projectOnly }, client, exec); expect(c.all.total_bytes).toBe(10 * GB)
  })
  it('a pattern that removes a whole step\'s content simply sends nothing for it', async () => {
    sizes = (cmd) => (cmd.includes('*') ? 0 : 5 * GB)
    const ev: syncrun.SyncEvent[] = []; const r = await push({ ...projectOnly, exclude: ['*'] }, ev); expect(r.failed).toBe(0); expect(ev.find((e) => e.kind === 'totals')).toMatchObject({ total_bytes: 0, over_capacity: false })
  })
  it('the History says how many patterns were left out and the first few', async () => {
    sizes = () => 5; await push({ ...projectOnly, exclude: ['CANALV2/', '/A/', 'B', 'C/', 'D/'] })
    const h = history.list({ kind: 'job' }).find((e) => e.kind === 'job' && e.job === 'sync')!; expect((h as { detail: string }).detail).toBe('left out 5 patterns: CANALV2/, /A/, B (+2 more)')
    await push(projectOnly); expect((history.list({ kind: 'job' })[0] as { detail?: string }).detail).toBeUndefined()
  })
})

describe('the configuration carries it', () => {
  it('default [], normalised, validated, previewed, reset', () => {
    expect(mounts.defaults().sync_exclude).toEqual([]); expect(mounts.normalize({ sync_exclude: [' A/ ', 'A/', 'B'] as never }).sync_exclude).toEqual(['A/', 'B']); expect(mounts.normalize({}).sync_exclude).toEqual([])
    expect(() => mounts.put({ ...mounts.load(), sync_exclude: ['../x'] })).toThrow(/sync_exclude/); expect(mounts.put({ ...mounts.load(), sync_exclude: ['CANALV2/'] }).config.sync_exclude).toEqual(['CANALV2/']); expect(mounts.preview({ sync_exclude: ['X/'] }).config.sync_exclude).toEqual(['X/']); expect(mounts.reset().sync_exclude).toEqual([])
  })
  it('export, import (plan, apply) and undo', () => {
    mounts.put({ ...mounts.load(), sync_exclude: ['CANALV2/', '/Scratch/'] }); const f = configio.exportConfig({ includeSecrets: false }); expect((f.config as Record<string, unknown>).sync_exclude).toEqual(['CANALV2/', '/Scratch/'])
    mounts.put({ ...mounts.load(), sync_exclude: [] }); const plan = configio.planImport(f); expect(plan.ok).toBe(true); expect(plan.sections.find((s) => s.key === 'pod_defaults')!.changed).toBe(true)
    configio.applyImport(f, { sections: ['pod_defaults'] }); expect(mounts.load().sync_exclude).toEqual(['CANALV2/', '/Scratch/']); configio.undoImport(); expect(mounts.load().sync_exclude).toEqual([])
    expect(configio.planImport({ ...f, config: { ...(f.config as object), sync_exclude: 'x' } } as never).errors.join('\n')).toMatch(/sync_exclude must be a list/)
  })
  it('a pod\'s own configuration carries it and Recreate keeps it', async () => {
    mounts.save({ ...mounts.load(), dry_run: true }); const own = mounts.normalize({ ...mounts.load(), sync_exclude: ['CANALV2/'] }); const a = await pods.create({ name: 'A', gpu: 'rtx4090', config: own } as never)
    expect(podconfigs.get(a.id)?.sync_exclude).toEqual(['CANALV2/']); const fresh = await pods.recreate(a.id); expect(podconfigs.get(fresh.id)?.sync_exclude).toEqual(['CANALV2/'])
  })
})

describe('folders() and measure()', () => {
  it('lists the top-level directories of each push step in run order, sorted, hiding dotfiles, symlinks, files and what a sync never carries; never recursive', async () => {
    const proj = mounts.load().folders.project!
    for (const d of ['zeta', 'Alpha', 'CANALV2', '.hidden', 'logs', '__pycache__', '.git']) mkdirSync(join(proj, d), { recursive: true }); writeFileSync(join(proj, 'file.txt'), 'x'); mkdirSync(join(proj, 'Alpha', 'deep'), { recursive: true }); symlinkSync(shared, join(proj, 'link'))
    const r = await syncfolders.folders({ pod_id: 'p1' }); expect(r.steps.map((s) => s.key)).toEqual(['workflows', 'comfy-shared', 'project'])   // plates is not mapped to an existing folder here
    const p = r.steps.find((s) => s.key === 'project')!; expect(p.folders.map((f) => f.name)).toEqual(expect.arrayContaining(['Alpha', 'CANALV2', 'zeta'])); for (const bad of ['.hidden', 'logs', '__pycache__', '.git', 'link', 'file.txt', 'deep']) expect(p.folders.map((f) => f.name)).not.toContain(bad)
    expect(p.folders.every((f) => f.bytes === null)).toBe(true); const names = p.folders.map((f) => f.name); expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b))); expect(p.local).toBe(proj + '/')
    await expect(syncfolders.folders({} as never)).rejects.toThrow(/Which pod/)
  })
  it('caps each step at 500', async () => {
    const proj = mounts.load().folders.project!; for (let i = 0; i < 520; i++) mkdirSync(join(proj, `d${String(i).padStart(4, '0')}`))
    const p = (await syncfolders.folders({ pod_id: 'p1' })).steps.find((s) => s.key === 'project')!; expect(p.folders).toHaveLength(500); expect(p.capped).toBe(true)
  })
  it('measure: a direct child directory only (no .., no slash, no symlink escape, no file), du -sk in bytes, cached 5 minutes, cancellable, never recursive in the listing', async () => {
    const proj = mounts.load().folders.project!; mkdirSync(join(proj, 'CANALV2')); writeFileSync(join(proj, 'f.txt'), 'x'); symlinkSync(shared, join(proj, 'esc')); mkdirSync(join(proj, 'CANALV2', 'sub'))
    let calls = 0, t = 1000; const seen: string[] = []; syncfolders.setDeps({ now: () => t, du: async (p) => { calls++; seen.push(p); return 2048 } })
    for (const bad of ['..', '../x', 'a/b', '/etc', '', '.', 'f.txt', 'esc', 'nope', 'CANALV2/sub', 'a\\b']) await expect(syncfolders.measure({ pod_id: 'p1', step: 'project', name: bad }), bad).rejects.toThrow(); expect(calls).toBe(0)
    await expect(syncfolders.measure({ pod_id: 'p1', step: 'nothing', name: 'CANALV2' })).rejects.toThrow(/No such step/)
    expect(await syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'CANALV2' })).toEqual({ bytes: 2048 * 1024 }); expect(seen[0]).toBe(join(proj, 'CANALV2'))
    expect(await syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'CANALV2' })).toMatchObject({ bytes: 2048 * 1024, cached: true }); expect(calls).toBe(1)
    t += 5 * 60_000 + 1; await syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'CANALV2' }); expect(calls).toBe(2)
    syncfolders.forgetMeasures(); syncfolders.setDeps({ du: (_p, signal) => new Promise((r) => signal.addEventListener('abort', () => r(null), { once: true })) })
    const pending = syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'CANALV2', id: 'm1' }).catch((e) => e as Error); await new Promise((r) => setTimeout(r, 20)); expect(syncfolders.measureCancel('m1')).toEqual({ cancelled: true }); expect(((await pending) as Error).message).toMatch(/cancelled|took too long/); expect(syncfolders.measureCancel('m1')).toEqual({ cancelled: false })
  })
  it('the real du, spawned with an argument array (no shell), measures a small folder', async () => {
    const proj = mounts.load().folders.project!; mkdirSync(join(proj, "odd 'name;x")); writeFileSync(join(proj, "odd 'name;x", 'a'), 'x'.repeat(5000))
    const r = await syncfolders.measure({ pod_id: 'p1', step: 'project', name: "odd 'name;x" }); expect(r.bytes).toBeGreaterThan(0)
  })
})


// ===== per-folder exclusion defaults (folder_excludes) =====
describe('folder_excludes: the merge, precisely', () => {
  const setDefault = (m: Record<string, string[]>) => { const cfg = mounts.load(); cfg.folder_excludes = m; mounts.save(cfg) }
  it('default only; the pod overrides a key; the pod adds a key; an empty list in the pod clears that key for the pod; other pods follow the default', () => {
    setDefault({ project: ['A/'], plates: ['P/'] }); const f = syncrun.folderExcludesFor
    expect([f('p1', 'project'), f('p1', 'plates'), f('p1', 'comfy-shared'), f('p1', 'workflows')]).toEqual([['A/'], ['P/'], [], []])   // default only (no pod configuration at all)
    podconfigs.set('p1', mounts.normalize({ ...mounts.load(), folder_excludes: { project: ['B/'], 'comfy-shared': ['C/'] } }))
    expect([f('p1', 'project'), f('p1', 'plates'), f('p1', 'comfy-shared')]).toEqual([['B/'], ['P/'], ['C/']])   // overrides project, falls back for plates, adds comfy-shared
    podconfigs.set('p1', mounts.normalize({ ...mounts.load(), folder_excludes: { project: [] } })); expect([f('p1', 'project'), f('p1', 'plates')]).toEqual([[], ['P/']])   // [] clears project for this pod only
    expect([f('other', 'project'), f('other', 'plates')]).toEqual([['A/'], ['P/']])
  })
  it('the step\'s list is the global list (the pod\'s else the default\'s) UNION its folder list UNION the request\'s; a pattern for project never reaches comfy-shared', () => {
    const cfg = mounts.load(); cfg.sync_exclude = ['G/']; cfg.folder_excludes = { project: ['CANALV2/'], 'comfy-shared': ['models-old/'] }; mounts.save(cfg)
    const req = { pod_id: 'p1', exclude: ['R/'] }
    expect(syncrun.effectiveExcludesFor(req, 'project')).toEqual(['G/', 'R/', 'CANALV2/']); expect(syncrun.effectiveExcludesFor(req, 'comfy-shared')).toEqual(['G/', 'R/', 'models-old/']); expect(syncrun.effectiveExcludesFor(req, 'plates')).toEqual(['G/', 'R/'])
    const step = (key: string) => ({ key, local: '', remote: '' }); expect(syncrun.excludesFor({ ...req, direction: 'push' }, step('project'))).toContain('CANALV2/'); expect(syncrun.excludesFor({ ...req, direction: 'push' }, step('project'))).not.toContain('models-old/'); expect(syncrun.excludesFor({ ...req, direction: 'push' }, step('comfy-shared'))).not.toContain('CANALV2/')
    expect(syncrun.allExcludes(req)).toEqual(['G/', 'R/', 'CANALV2/', 'models-old/'])
  })
})

describe('folder_excludes: validation', () => {
  it('a 400 names the folder key and the bad pattern; limits per key (100) and in all (300); unknown keys are dropped, workflows accepted, empty lists kept', () => {
    const bad = (m: Record<string, unknown>) => () => mounts.validate(mounts.normalize({ folder_excludes: m as never }))
    expect(bad({ project: ['../x'] })).toThrow('folder_excludes.project: a pattern has no .. segment ("../x")'); expect(bad({ plates: ['~/y'] })).toThrow(/folder_excludes\.plates: a pattern does not start with ~/); expect(bad({ 'comfy-shared': [5] })).toThrow(/folder_excludes\.comfy-shared: each pattern is text/)
    expect(bad({ project: Array.from({ length: 101 }, (_, i) => `d${i}/`) })).toThrow(/folder_excludes\.project: at most 100/); const l = (n: number) => Array.from({ length: n }, (_, i) => `d${i}/`)
    expect(bad({ project: l(100), plates: l(100), 'comfy-shared': l(100), workflows: l(1) })).toThrow(/at most 300 patterns in all/); expect(bad({ project: l(100), plates: l(100), 'comfy-shared': l(100) })).not.toThrow()
    expect(mounts.normalize({ folder_excludes: { project: [' A/ ', 'A/'], nonsense: ['x/'], workflows: ['W/'], plates: [] } as never }).folder_excludes).toEqual({ project: ['A/'], workflows: ['W/'], plates: [] }); expect(mounts.normalize({}).folder_excludes).toEqual({}); expect(mounts.normalize({ folder_excludes: ['x'] as never }).folder_excludes).toEqual({}); expect(mounts.defaults().folder_excludes).toEqual({})
    expect(() => mounts.put({ ...mounts.load(), folder_excludes: { project: ['../x'] } })).toThrow(/folder_excludes\.project/)
  })
})

describe('folder_excludes: applied per step (rsync, S3, totals, preflight)', () => {
  it('each step\'s rsync command carries only its own patterns; the S3 globs too', async () => {
    const cfg = mounts.load(); cfg.folder_excludes = { project: ['CANALV2/'], 'comfy-shared': ['models-old/'] }; mounts.save(cfg)
    await push({ only: ['project', 'comfy-shared'] }); const ex = (c: string[]) => c.flatMap((a, i) => (a === '--exclude' ? [c[i + 1]] : []))
    const proj = cmds.filter((c) => !c.includes('-n') && remoteArg(c).includes('/workspace/project/')), cs = cmds.filter((c) => !c.includes('-n') && remoteArg(c).includes('/workspace/comfy-shared/'))
    expect(proj.length).toBeGreaterThan(0); expect(cs.length).toBeGreaterThan(0)
    for (const c of proj) { expect(ex(c)).toContain('CANALV2/'); expect(ex(c)).not.toContain('models-old/') }; for (const c of cs) { expect(ex(c)).toContain('models-old/'); expect(ex(c)).not.toContain('CANALV2/') }
    const s3 = (key: string) => sync.s3Cmd('/l/', { id: 'v', datacenter: 'EU-RO-1' }, `/workspace/${key}/`, { exclude: syncrun.excludesFor({ pod_id: 'p1', direction: 'push' }, { key, local: '', remote: '' }) }).filter((a) => /CANALV2|models-old/.test(a))
    expect(s3('project')).toEqual(['CANALV2/*', '*/CANALV2/*']); expect(s3('comfy-shared')).toEqual(['models-old/*', '*/models-old/*'])
  })
  it('count() and the preflight use the right list per step: project\'s pattern shrinks project, comfy-shared\'s does not', async () => {
    let cfg = mounts.load(); cfg.folder_excludes = { project: ['CANALV2/'] }; mounts.save(cfg)
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'] }, client, exec)).all).toMatchObject({ total_bytes: 10 * GB, over_capacity: false })
    cfg = mounts.load(); cfg.folder_excludes = { 'comfy-shared': ['CANALV2/'] }; mounts.save(cfg)   // the same pattern under the wrong folder does not leak to project
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'] }, client, exec)).all).toMatchObject({ total_bytes: 2.1 * TB, over_capacity: true })
    await expect(push(projectOnly)).rejects.toThrow(/This push would send 2\.1 TB/)
    cfg = mounts.load(); cfg.folder_excludes = { project: ['CANALV2/'] }; mounts.save(cfg); const ev: syncrun.SyncEvent[] = []; await push(projectOnly, ev); expect(ev.find((e) => e.kind === 'totals')).toMatchObject({ total_bytes: 10 * GB, over_capacity: false })
  })
  it('the History counts the patterns of every step', async () => {
    const cfg = mounts.load(); cfg.sync_exclude = ['G/']; cfg.folder_excludes = { project: ['CANALV2/'], plates: ['P/'] }; mounts.save(cfg); sizes = () => 5; await push(projectOnly)
    expect((history.list({ kind: 'job' }).find((e) => e.kind === 'job' && e.job === 'sync') as { detail: string }).detail).toBe('left out 3 patterns: G/, CANALV2/, P/')
  })
})

describe('folder_excludes: the configuration carries it', () => {
  it('export, import (plan, apply), undo, reset', () => {
    mounts.put({ ...mounts.load(), folder_excludes: { project: ['CANALV2/'], plates: ['P/'] } }); const f = configio.exportConfig({ includeSecrets: false }); expect((f.config as Record<string, unknown>).folder_excludes).toEqual({ project: ['CANALV2/'], plates: ['P/'] })
    mounts.put({ ...mounts.load(), folder_excludes: {} }); expect(configio.planImport(f).sections.find((s) => s.key === 'pod_defaults')!.changed).toBe(true); configio.applyImport(f, { sections: ['pod_defaults'] }); expect(mounts.load().folder_excludes).toEqual({ project: ['CANALV2/'], plates: ['P/'] }); configio.undoImport(); expect(mounts.load().folder_excludes).toEqual({})
    expect(configio.planImport({ ...f, config: { ...(f.config as object), folder_excludes: { project: 'x' } } } as never).errors.join('\n')).toMatch(/folder_excludes must map a folder/); mounts.put({ ...mounts.load(), folder_excludes: { project: ['X/'] } }); expect(mounts.reset().folder_excludes).toEqual({}); expect(mounts.preview({ folder_excludes: { project: ['Y/'] } }).config.folder_excludes).toEqual({ project: ['Y/'] })
  })
  it('a pod\'s own configuration carries it and Recreate keeps it', async () => {
    mounts.save({ ...mounts.load(), dry_run: true }); const a = await pods.create({ name: 'A', gpu: 'rtx4090', config: mounts.normalize({ ...mounts.load(), folder_excludes: { project: ['CANALV2/'] } }) } as never)
    expect(podconfigs.get(a.id)?.folder_excludes).toEqual({ project: ['CANALV2/'] }); const fresh = await pods.recreate(a.id); expect(podconfigs.get(fresh.id)?.folder_excludes).toEqual({ project: ['CANALV2/'] })
  })
})

describe('sync.folders: the saved patterns and what this core supports', () => {
  it('per step: saved (global + per-folder, de-duplicated) with where each comes from; supports flags for the window', async () => {
    const cfg = mounts.load(); cfg.sync_exclude = ['G/']; cfg.folder_excludes = { project: ['CANALV2/', 'G/'], 'comfy-shared': ['m/'] }; mounts.save(cfg)
    let r = await syncfolders.folders({ pod_id: 'p1' }); const p = r.steps.find((s) => s.key === 'project')!, c = r.steps.find((s) => s.key === 'comfy-shared')!
    expect(p.saved).toEqual(['G/', 'CANALV2/']); expect(p.saved_sources).toEqual({ 'G/': 'default', 'CANALV2/': 'folder' }); expect(c.saved).toEqual(['G/', 'm/']); expect(r.supports).toEqual({ exclude: true, delete_excluded: true, folder_excludes: true, measure: true })
    podconfigs.set('p1', mounts.normalize({ ...mounts.load(), sync_exclude: ['PodG/'], folder_excludes: { project: ['PodP/'] } })); r = await syncfolders.folders({ pod_id: 'p1' })
    const p2 = r.steps.find((s) => s.key === 'project')!; expect(p2.saved).toEqual(['PodG/', 'PodP/']); expect(p2.saved_sources).toEqual({ 'PodG/': 'pod', 'PodP/': 'folder' }); expect(r.steps.find((s) => s.key === 'comfy-shared')!.saved).toEqual(['PodG/', 'm/'])
  })
})
