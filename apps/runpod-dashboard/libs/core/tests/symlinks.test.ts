import { beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as fsmod from '../src/fs.js'
import * as mounts from '../src/mounts.js'
import * as sync from '../src/sync.js'
import * as syncfolders from '../src/syncfolders.js'
import * as syncrun from '../src/syncrun.js'
import { CoreError } from '../src/errors.js'
import { fakeTree, scratch } from './helpers.js'

// docs/ADR-011, "Symlinks and mounted volumes" (2026-11-19): links are never followed in a push walk; a symlinked ROOT is followed (it IS the folder the person chose). Real temp folders; fake statfs and exec.
let dir: string
beforeEach(() => { dir = realpathSync(scratch()); process.env.HISTORY_FILE = join(dir, 'h.jsonl'); process.env.SYNC_LOGS_DIR = join(dir, 'logs'); process.env.SYNC_RUNS_FILE = join(dir, 'runs.json') })
const asPlatform = <T>(p: string, f: () => T): T => { const d = Object.getOwnPropertyDescriptor(process, 'platform')!; Object.defineProperty(process, 'platform', { value: p }); try { return f() } finally { Object.defineProperty(process, 'platform', d) } }

describe('the folder picker keeps the logical path', () => {
  it('through a link: path and parent are the ones you came by, real is the realpath; Up returns to where you came from', () => {
    mkdirSync(join(dir, 'real', 'a', 'b'), { recursive: true }); mkdirSync(join(dir, 'home')); symlinkSync(join(dir, 'real', 'a'), join(dir, 'home', 'lnk'))
    const r = fsmod.listDirs(join(dir, 'home', 'lnk')); expect(r.path).toBe(join(dir, 'home', 'lnk')); expect(r.parent).toBe(join(dir, 'home')); expect((r as { real?: string }).real).toBe(join(dir, 'real', 'a')); expect(r.dirs.map((d) => d.name)).toEqual(['b'])
    const up = fsmod.listDirs(r.parent!); expect(up.path).toBe(join(dir, 'home')); expect((up as { real?: string }).real).toBeUndefined()   // not through the target's parent
  })
  it('a link to a folder has link: true and its target; a broken link and a link to a file are hidden; a plain folder is link: false', () => {
    mkdirSync(join(dir, 'x', 'plain'), { recursive: true }); mkdirSync(join(dir, 'tgt')); writeFileSync(join(dir, 'f.txt'), 'x'); symlinkSync(join(dir, 'tgt'), join(dir, 'x', 'good')); symlinkSync(join(dir, 'gone'), join(dir, 'x', 'broken')); symlinkSync(join(dir, 'f.txt'), join(dir, 'x', 'tofile')); symlinkSync('../tgt', join(dir, 'x', 'rel'))
    const d = fsmod.listDirs(join(dir, 'x')).dirs; expect(d).toEqual([{ name: 'good', path: join(dir, 'x', 'good'), link: true, target: join(dir, 'tgt') }, { name: 'plain', path: join(dir, 'x', 'plain'), link: false }, { name: 'rel', path: join(dir, 'x', 'rel'), link: true, target: join(dir, 'tgt') }])
    expect(() => fsmod.listDirs(join(dir, 'nope'))).toThrow(CoreError); expect(() => fsmod.listDirs(join(dir, 'f.txt'))).toThrow(/not a folder/)
  })
  it('an unreadable folder is a 403 with code no_permission, and on macOS a hint about Files and Folders / Full Disk Access', () => {
    if (process.getuid?.() === 0) return   // root can read anything
    mkdirSync(join(dir, 'locked')); chmodSync(join(dir, 'locked'), 0)
    try {
      const e = asPlatform('darwin', () => { try { fsmod.listDirs(join(dir, 'locked')) } catch (x) { return x as CoreError & { hint?: string } } })!
      expect(e.status).toBe(403); expect(e.code).toBe('no_permission'); expect(e.hint).toBe('macOS may need to allow RunPod Manager to read this folder: System Settings > Privacy & Security > Files and Folders (or Full Disk Access)')
      const l = asPlatform('linux', () => { try { fsmod.listDirs(join(dir, 'locked')) } catch (x) { return x as CoreError & { hint?: string } } })!; expect(l.code).toBe('no_permission'); expect(l.hint).toBeUndefined()
    } finally { chmodSync(join(dir, 'locked'), 0o755) }
  })
})

describe('mounted volumes', () => {
  const deps = (o: Record<string, unknown> = {}) => ({ platform: 'darwin', user: 'lucas', timeoutMs: 30, readdir: async (d: string) => (d === '/Volumes' ? ['Macintosh HD', 'Data', 'NetMount', 'Locked', '.hidden'] : []), lstat: async (p: string) => ({ isSymbolicLink: () => p.endsWith('Macintosh HD') }), readlink: async () => '/',
    statfs: async (p: string) => { if (p.endsWith('NetMount')) return new Promise<never>(() => undefined); if (p.endsWith('Locked')) throw Object.assign(new Error('x'), { code: 'EACCES' }); return { bsize: 4096, blocks: p.endsWith('Data') ? 1000 : 500, bavail: 100 } }, ...o })
  it('macOS: size and free from statfs, the hung mount listed unreadable ("did not answer") without blocking, no permission marked, sorted with the boot-volume link last', async () => {
    const t0 = Date.now(); const { volumes } = await fsmod.listVolumes(deps()); expect(Date.now() - t0).toBeLessThan(500)
    expect(volumes.map((v) => v.name)).toEqual(['Data', 'Locked', 'NetMount', 'Macintosh HD'])
    expect(volumes[0]).toEqual({ name: 'Data', path: '/Volumes/Data', link: false, size_bytes: 1000 * 4096, free_bytes: 100 * 4096, readable: true }); expect(volumes[1]).toMatchObject({ readable: false, reason: 'no permission', size_bytes: null }); expect(volumes[2]).toMatchObject({ readable: false, reason: 'did not answer', free_bytes: null })
    expect(volumes[3]).toMatchObject({ link: true, target: '/', readable: true })
  })
  it('Linux: /media/<user>, /run/media/<user>, /mnt; other systems: none; a missing root is skipped', async () => {
    const seen: string[] = []; const v = await fsmod.listVolumes(deps({ platform: 'linux', readdir: async (d: string) => { seen.push(d); if (d === '/mnt') throw new Error('ENOENT'); return d === '/media/lucas' ? ['usb'] : d === '/run/media/lucas' ? ['sd'] : [] }, lstat: async () => ({ isSymbolicLink: () => false }) }))
    expect(seen).toEqual(['/media/lucas', '/run/media/lucas', '/mnt']); expect(v.volumes.map((x) => x.path)).toEqual(['/run/media/lucas/sd', '/media/lucas/usb'])   // by name; expect((await fsmod.listVolumes(deps({ platform: 'win32' }))).volumes).toEqual([])
  })
})

describe('the sync folder list follows a linked root and marks linked folders', () => {
  const project = () => mounts.load().folders.project!
  beforeEach(() => { const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); mounts.save(cfg); syncfolders.setDeps(null); syncfolders.forgetMeasures() })
  it('a symlinked step root is followed (its folders are listed, the step is marked as a link); linked subfolders have link, target and the note; a broken link is hidden', async () => {
    const real = project(); const via = join(dir, 'via-link'); symlinkSync(real, via); const cfg = mounts.load(); cfg.folders.project = via; mounts.save(cfg)
    mkdirSync(join(dir, 'bigdata')); symlinkSync(join(dir, 'bigdata'), join(real, 'BKU1')); symlinkSync(join(dir, 'missing'), join(real, 'broken'))
    const p = (await syncfolders.folders({ pod_id: 'p1' })).steps.find((s) => s.key === 'project')!
    expect(p.local).toBe(via + '/'); expect(p).toMatchObject({ link: true, target: real }); expect(p.folders.find((f) => f.name === 'BKU1')).toEqual({ name: 'BKU1', bytes: null, link: true, target: join(dir, 'bigdata'), note: 'A link: copied as a link, its contents are not sent' }); expect(p.folders.map((f) => f.name)).not.toContain('broken'); expect(p.folders.find((f) => f.name === '10_CORROSION')).toEqual({ name: '10_CORROSION', bytes: null })
  })
  it('measure() on a link measures nothing: bytes 0, link, target, note (du is never run)', async () => {
    mkdirSync(join(dir, 'bigdata')); symlinkSync(join(dir, 'bigdata'), join(project(), 'BKU1')); let called = 0; syncfolders.setDeps({ du: async () => { called++; return 1 } })
    expect(await syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'BKU1' })).toEqual({ bytes: 0, link: true, target: join(dir, 'bigdata'), note: 'A link: copied as a link, its contents are not sent' }); expect(called).toBe(0)
    symlinkSync(join(dir, 'gone'), join(project(), 'dead')); await expect(syncfolders.measure({ pod_id: 'p1', step: 'project', name: 'dead' })).rejects.toThrow()
  })
})

describe('walkers follow links to folders, safely', () => {
  it('isDirFollow: folder, link to a folder yes; file, broken link no', () => {
    mkdirSync(join(dir, 'd')); mkdirSync(join(dir, 't')); writeFileSync(join(dir, 'f'), 'x'); symlinkSync(join(dir, 't'), join(dir, 'l')); symlinkSync(join(dir, 'zz'), join(dir, 'b'))
    const ents = Object.fromEntries(require('node:fs').readdirSync(dir, { withFileTypes: true }).map((e: import('node:fs').Dirent) => [e.name, mounts.isDirFollow(dir, e)])); expect([ents.d, ents.t, ents.l, ents.f, ents.b]).toEqual([true, true, true, false, false])
  })
  it('listShots sees a shot area that is a link; the plates declaration is found through a linked type folder; a link loop ends', () => {
    const tree = join(dir, 'tree'); mkdirSync(join(tree, '04_TRACKER', 'queue', 'done'), { recursive: true }); writeFileSync(join(tree, '04_TRACKER', 'queue', 'done', 'j.md'), 'job: x\nroot: /srv/P/\n'); symlinkSync(join(tree, '04_TRACKER', 'queue'), join(tree, '04_TRACKER', 'queue', 'done', 'loop'))
    expect(mounts.declaredRoot(tree)).toMatchObject({ path: '/srv/P' })   // walked the queue once, the loop did not recurse for ever
    const real = join(dir, 'areas', '10_CORROSION'); mkdirSync(join(real, 'corrosion-001', '02_SOURCE'), { recursive: true }); writeFileSync(join(real, 'corrosion-001', '02_SOURCE', 'SOURCES.csv'), 'role,eye,part,location,pattern\nplate,LEFT,1,/srv/plates/PC_x/c/c.LEFT,*.dpx\n'); symlinkSync(real, join(tree, '10_CORROSION'))
    expect(sync.listShots(tree)).toEqual(['10_CORROSION/corrosion-001']); expect(mounts.declaredPlates(tree)).toMatchObject({ path: '/srv/plates/PC_x' })
  })
})

describe('a push meets links: warned about, never followed, the same on both transports', () => {
  const step = (key: string, local: string): sync.Step => ({ key, local: local + '/', remote: `/workspace/${key}/` })
  it('a linked root and top-level links to folders: one warning each (not files, not broken links), with the target; the S3 route says it skips them', async () => {
    const real = join(dir, 'tree'); mkdirSync(join(real, 'sub'), { recursive: true }); mkdirSync(join(dir, 'big')); writeFileSync(join(dir, 'f.txt'), 'x'); symlinkSync(join(dir, 'big'), join(real, 'BKU1')); symlinkSync(join(dir, 'f.txt'), join(real, 'file-link')); symlinkSync(join(dir, 'zz'), join(real, 'dead')); symlinkSync(real, join(dir, 'rootlink'))
    const w = await syncrun.symlinkWarnings([step('project', join(dir, 'rootlink'))], false)
    expect(w.map((e) => e.text)).toEqual([`project: ${join(dir, 'rootlink')} is a link to ${real}: its contents are sent, because it is the folder you chose`, `BKU1 is a link to ${join(dir, 'big')}: it is copied as a link, not its contents`]); expect(w[1]).toMatchObject({ kind: 'warning', code: 'symlink', key: 'project', path: 'BKU1', target: join(dir, 'big') })
    expect((await syncrun.symlinkWarnings([step('project', real)], true))[0].text).toBe(`BKU1 is a link to ${join(dir, 'big')}: it is copied as a link, not its contents (skipped on the S3 route)`)
  })
  it('at most 50 warnings, then "and N more links"', async () => {
    const real = join(dir, 'many'); mkdirSync(join(dir, 't')); mkdirSync(real); for (let i = 0; i < 55; i++) symlinkSync(join(dir, 't'), join(real, `l${String(i).padStart(2, '0')}`))
    const w = await syncrun.symlinkWarnings([step('project', real)], false); expect(w).toHaveLength(51); expect(w.at(-1)).toMatchObject({ code: 'symlink', text: 'and 5 more links' })
  })
  it('the run emits them once each; rsync sources keep the trailing slash so a linked root is followed; the count passes use the same command', async () => {
    const real = fakeTree(dir); mkdirSync(join(dir, 'big')); symlinkSync(join(dir, 'big'), join(real, 'BKU1')); symlinkSync(real, join(dir, 'proj-link')); const cfg = mounts.defaults(); cfg.folders.project = join(dir, 'proj-link'); mounts.save(cfg)
    const pod = { id: 'p1', name: 'p', networkVolumeId: null, runtime: { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
    const client = { apiKey: 'test', fetchFn: (async () => ({ ok: true, status: 200, json: async () => ({ data: { pod } }) })) as unknown as typeof fetch }; const cmds: string[][] = []
    const exec: syncrun.Exec = async (cmd, onLine) => { if (cmd[0] === 'ssh') return 0; cmds.push(cmd); if (cmd.includes('-n')) { onLine('Number of files transferred: 1'); onLine('Total transferred file size: 5 B') } return 0 }
    const ev: syncrun.SyncEvent[] = []; await syncrun.run({ pod_id: 'p1', direction: 'push', only: ['project'] }, (e) => ev.push(e), new AbortController().signal, client, exec)
    expect(ev.filter((e) => e.code === 'symlink').map((e) => e.path)).toEqual(['', 'BKU1'])
    const sources = cmds.filter((c) => c[0] === 'rsync').map((c) => c[c.length - 2]); expect(sources.length).toBeGreaterThan(0); for (const s of sources) expect(s).toMatch(/\/$/)
    expect(cmds.filter((c) => c[0] === 'rsync').every((c) => c.some((a) => /^-r?lt$|^-rlt$/.test(a)) || c.includes('-lt'))).toBe(true)   // -rlt: links are copied as links (-l), never followed (no -L)
    for (const c of cmds) { expect(c).not.toContain('-L'); expect(c).not.toContain('--copy-links'); expect(c).not.toContain('-a') }
    cmds.length = 0; await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'] }, client, exec); for (const c of cmds.filter((x) => x[0] === 'rsync')) { expect(c[c.length - 2]).toMatch(/\/$/); expect(c).not.toContain('-L') }
  })
  it('over S3 a push adds --no-follow-symlinks (links skipped), a pull does not', () => {
    const v = { id: 'v', datacenter: 'EU-RO-1' }; expect(sync.s3Cmd('/l/', v, '/workspace/project/')).toContain('--no-follow-symlinks'); expect(sync.s3PullCmd(v, '/workspace/project/', '/l/')).not.toContain('--no-follow-symlinks'); expect(sync.s3FileCmd('push', v, '/workspace/project/', '/l/', 'a')).not.toContain('--no-follow-symlinks')
  })
})
