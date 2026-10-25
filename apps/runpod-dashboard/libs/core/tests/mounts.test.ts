import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as m from '../src/mounts.js'
import { listDirs } from '../src/fs.js'
import { REPO_ROOT, mountsFile } from '../src/paths.js'
import { fakeTree, scratch } from './helpers.js'

const PLATES = '/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates'
let dir: string
beforeEach(() => { dir = scratch() })

describe('defaults', () => {
  it('are the three folders, unmapped, with the generic pod env', () => {
    const cfg = m.defaults()
    expect(Object.keys(cfg.folders)).toEqual(['project', 'plates', 'comfy-shared'])
    expect(Object.values(cfg.folders).some(Boolean)).toBe(false)
    expect(cfg.network_volume_id).toBe(''); expect(cfg.mount_path).toBe('/workspace')
    expect(cfg.image).toBe('comfy-app:contract-v26'); expect(cfg.idle_stop_minutes).toBe(30); expect(cfg.sync_parallel).toBe(8)
    expect(m.allLinks(cfg)).toEqual([]); expect(m.localEnv(cfg)).toEqual({})
    expect(m.podEnv(cfg)).toEqual({ PROJECT_ROOT: '/workspace/project', PLATES_ROOT: '/workspace/plates', COMFY_SHARED: '/workspace/comfy-shared' })
    expect(m.podOverrides(cfg).env.COMFY_LINKS).toBeUndefined()
  })
})

describe('what the tree declares', () => {
  it('comes from the job files, the source lists and the structure page', () => {
    const tree = fakeTree(dir)
    const cfg = m.defaults(); cfg.folders.project = tree
    const dec = m.declared(cfg)
    expect(dec.project).toEqual({ path: '/home/someone/HARBOUR_r1/HARBOUR', source: "the tree's job files", count: 2 })
    expect(dec.plates).toEqual({ path: '/srv/plates/PC_x', source: "the shots' source lists", count: 2 })
    expect(dec['comfy-shared']?.path).toBe('/home/someone/ComfyUI-Shared')
    const links = Object.fromEntries(m.allLinks(cfg).map((l) => [l.path, l.target]))
    expect(links).toEqual({ '/home/someone/HARBOUR_r1/HARBOUR': '/workspace/project', '/srv/plates/PC_x': '/workspace/plates', '/home/someone/ComfyUI-Shared': '/workspace/comfy-shared' })
    expect(m.allLinks(cfg).every((l) => l.folder)).toBe(true)
    // no job file: the structure master's Root line
    rmSync(join(tree, '04_TRACKER', 'queue', 'done'), { recursive: true })
    expect(m.declared(cfg).project).toEqual({ path: '/home/old/HARBOUR', source: "the tree's structure page", count: 1 })
    // a folder that is not a project tree declares nothing, and nothing is linked
    cfg.folders.project = dir
    expect(m.declared(cfg).project).toBeNull(); expect(m.allLinks(cfg)).toEqual([])
  })

  it('reads the CANALV2 mirror the way the Python did', () => {
    const mirror = join(REPO_ROOT, 'projects', 'desktop', 'CANALV2')
    if (!existsSync(join(mirror, '04_TRACKER'))) return   // the mirror is not on this machine
    const cfg = m.defaults(); cfg.folders.project = mirror
    const dec = m.declared(cfg)
    expect(dec.project?.path).toBe('/home/binc/CANALV2_r3/CANALV2')
    expect(dec.plates?.path).toBe(PLATES)
    expect(dec['comfy-shared']?.path).toBe('/home/binc/ComfyUI-Shared')
    const rows = Object.fromEntries(m.folderRows(cfg).map((r) => [r.key, r]))
    expect(rows.project.mirror).toBe(true); expect(rows.plates.mirror).toBe(false)
  })

  it('skips folders it cannot read instead of failing', () => {
    mkdirSync(join(dir, 'tree', 'type', 'shot', '02_SOURCE'), { recursive: true })
    writeFileSync(join(dir, 'tree', 'type', 'shot', '02_SOURCE', 'SOURCES.csv'), 'role,location\nplate,/p/PC/shot/eye\n')
    mkdirSync(join(dir, 'tree', 'locked'), { mode: 0o000 })
    try {
      expect(m.declaredPlates(join(dir, 'tree'))?.path).toBe('/p/PC')
    } finally { rmSync(join(dir, 'tree', 'locked'), { recursive: true, force: true }) }
  })

  it('parses quoted CSV cells', () => {
    expect(m.parseCsv('a,b\n"x, y",2\n')).toEqual([{ a: 'x, y', b: '2' }])
  })
})

describe('what a runtime receives', () => {
  it('local env, rows and pod overrides', () => {
    const tree = fakeTree(dir)
    const cfg = m.defaults()
    cfg.folders = { project: tree, plates: dir, 'comfy-shared': join(dir, 'shared') }
    expect(m.localEnv(cfg)).toEqual({ PROJECT_ROOT: tree, PLATES_ROOT: dir, COMFY_SHARED: join(dir, 'shared') })
    const rows = Object.fromEntries(m.folderRows(cfg).map((r) => [r.key, r]))
    expect(rows.project.exists && rows.plates.exists && !rows['comfy-shared'].exists).toBe(true)
    let ov = m.podOverrides(cfg)
    expect(ov.network_volume_id).toBeUndefined()
    expect(ov.env.COMFY_LINKS!.split(';')).toContain('/home/someone/HARBOUR_r1/HARBOUR=/workspace/project')
    expect(ov.env.COMFY_LINKS!.split(';')).toContain('/srv/plates/PC_x=/workspace/plates')
    expect(ov.env.PROJECT_ROOT).toBe('/workspace/project'); expect(ov.env.PLATES_ROOT).toBe('/workspace/plates')
    cfg.links.push({ path: '/home/someone/Desktop/old', target: '/workspace/legacy', required: false, mode: 'ro', what: '', folder: '' })
    cfg.env.EXTRA = '1'; cfg.network_volume_id = 'vol123'; cfg.data_center_id = 'EU-RO-1'
    ov = m.podOverrides(cfg)
    expect(ov.env.COMFY_LINKS!.endsWith(';/home/someone/Desktop/old=/workspace/legacy')).toBe(true); expect(ov.env.EXTRA).toBe('1')
    expect(ov.network_volume_id).toBe('vol123'); expect(ov.volume_mount_path).toBe('/workspace'); expect(ov.data_center_id).toBe('EU-RO-1')
  })
})

describe('the store', () => {
  it('round trips, reports, and resets', () => {
    const tree = fakeTree(dir)
    let p = m.payload(m.load())
    expect(p.stored).toBe(false); expect(p.folders.map((f) => f.key)).toEqual(['project', 'plates', 'comfy-shared'])
    expect(p.folders[0].declared).toBeNull(); expect(p.links).toEqual([])
    const cfg = { ...p.config, folders: { ...p.config.folders, project: tree }, network_volume_id: 'vol123' }
    p = m.put(cfg)
    expect(p.stored).toBe(true); expect(p.preview.network_volume_id).toBe('vol123')
    expect(p.folders[0].declared?.path).toBe('/home/someone/HARBOUR_r1/HARBOUR'); expect(p.folders[0].exists).toBe(true)
    expect(p.links.map((l) => l.path)).toEqual(['/home/someone/HARBOUR_r1/HARBOUR', '/srv/plates/PC_x', '/home/someone/ComfyUI-Shared'])
    expect(JSON.parse(readFileSync(mountsFile(), 'utf8')).folders.project).toBe(tree)
    expect(m.payload(m.load()).local_env).toEqual({ PROJECT_ROOT: tree })
    expect(m.envLines(m.load()).sh).toBe(`export PROJECT_ROOT=${JSON.stringify(tree)}\n`)
    const d = m.reset()
    expect(m.stored()).toBe(false); expect(Object.values(d.folders).some(Boolean)).toBe(false)
  })

  it('migrates a store from before the folder mapping', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(mountsFile(), JSON.stringify({ network_volume_id: 'v1', mount_path: '/workspace', data_center_id: '', apply_by_default: true, env: { COMFY_SHARED: '/workspace/ComfyUI-Shared' },
      links: [{ path: '/home/binc/CANALV2_r3/CANALV2', target: '/workspace/CANALV2' }, { path: '/root/CANALV2', target: '/workspace/CANALV2' }, { path: '/home/binc/Desktop/old', target: '/workspace/legacy', required: false }] }))
    const p = m.payload(m.load())
    expect(p.config.network_volume_id).toBe('v1'); expect(Object.values(p.config.folders).some(Boolean)).toBe(false)
    expect(p.links.map((l) => l.path)).toEqual(['/home/binc/Desktop/old'])
  })

  it('custom folders', () => {
    const tree = fakeTree(dir)
    const cfg = m.load(); cfg.folders.project = tree
    cfg.custom = [{ name: 'legacy', local: dir, container: '', link: '/home/someone/Desktop/old', mode: 'ro' }, { name: 'scratch', local: '', container: '/data/scratch', link: '', mode: 'rw' }]
    const p = m.put(cfg)
    const rows = Object.fromEntries(p.folders.map((f) => [f.key, f]))
    expect(p.folders.map((f) => f.key)).toEqual(['project', 'plates', 'comfy-shared', 'legacy', 'scratch'])
    expect(rows.project.required).toBe(false); expect(rows.legacy.required).toBe(false); expect(rows.legacy.custom).toBe(true)   // dev: nothing required by default
    expect(rows.legacy.container).toBe('/workspace/legacy'); expect(rows.legacy.exists).toBe(true); expect(rows.legacy.declared?.path).toBe('/home/someone/Desktop/old')
    expect(rows.scratch.container).toBe('/data/scratch'); expect(rows.scratch.declared).toBeNull(); expect(rows.scratch.exists).toBe(false)
    expect(p.preview.env.COMFY_LINKS!.split(';')).toContain('/home/someone/Desktop/old=/workspace/legacy')
    expect(p.preview.env.COMFY_LINKS).not.toContain('scratch')
    expect(p.local_env).toEqual({ PROJECT_ROOT: tree })   // custom folders set no variable
    for (const badOne of [{ name: '', local: '' }, { name: 'project' }, { name: 'a/b' }, { name: 'x', container: 'rel' }, { name: 'x', local: 'rel' }]) {
      expect(() => m.put({ ...cfg, custom: [badOne as m.CustomFolder] })).toThrow()
    }
  })

  it('rejects bad input', () => {
    const cfg = m.load()
    expect(() => m.put({ ...cfg, folders: { ...cfg.folders, plates: 'relative/plates' } })).toThrow(/absolute/)
    expect(() => m.put({ ...cfg, links: [{ path: '/a;b', target: '/workspace/x' } as m.Link] })).toThrow(/cannot appear/)
    expect(() => m.put({ ...cfg, idle_stop_minutes: -1 })).toThrow(/idle_stop_minutes/)
    expect(() => m.put({ ...cfg, sync_parallel: 0 })).toThrow(/sync_parallel/); expect(() => m.put({ ...cfg, sync_parallel: 2.5 })).toThrow(/sync_parallel/); expect(() => m.put({ ...cfg, sync_parallel: 17 })).toThrow(/sync_parallel/)
    expect(() => m.put({ ...cfg, sync_parallel: 12 })).not.toThrow(); expect(m.load().sync_parallel).toBe(12)
  })
})

describe('required folders by mode', () => {
  it('prod requires all, dev uses the toggles unless COMFY_REQUIRE says', () => {
    const cfg = m.defaults()
    expect(m.mode()).toBe('dev'); expect(m.requireSource()).toBe('config'); expect(m.requiredKeys(cfg).size).toBe(0)
    cfg.required.project = true
    expect([...m.requiredKeys(cfg)]).toEqual(['project']); expect(m.missingRequired(cfg)).toEqual(['project'])
    process.env.COMFY_REQUIRE = 'plates, comfy-shared'
    expect(m.requireSource()).toBe('env'); expect([...m.requiredKeys(cfg)].sort()).toEqual(['comfy-shared', 'plates'])
    process.env.COMFY_REQUIRE = 'none'; expect(m.requiredKeys(cfg).size).toBe(0)
    process.env.COMFY_REQUIRE = 'all'; expect(m.requiredKeys(cfg).size).toBe(3)
    process.env.COMFY_MODE = 'prod'; delete process.env.COMFY_REQUIRE
    expect(m.requireSource()).toBe('prod'); expect(m.requiredKeys(cfg).size).toBe(3)
    expect(m.missingRequired(cfg).sort()).toEqual(['comfy-shared', 'plates', 'project'])
  })
})

describe('the folder browser', () => {
  it('lists subfolders, hidden on request, home by default', () => {
    mkdirSync(join(dir, 'b')); mkdirSync(join(dir, 'a')); mkdirSync(join(dir, '.hidden')); writeFileSync(join(dir, 'file.txt'), 'x')
    const r = listDirs(dir)
    expect(r.dirs.map((d) => d.name)).toEqual(['a', 'b']); expect(r.parent).toBeTruthy(); expect(r.home).toBeTruthy()
    expect(listDirs(dir, true).dirs.map((d) => d.name)).toEqual(['.hidden', 'a', 'b'])
    expect(listDirs().path).toBeTruthy()
    expect(() => listDirs(join(dir, 'file.txt'))).toThrow(/not a folder/)
  })
})

describe('mcp_http: the MCP servers the app serves over HTTP', () => {
  it('is off by default, on 8765 and 8766', () => {
    expect(m.defaults().mcp_http).toEqual({ 'pod-manager': { enabled: false, port: 8765 }, 'comfy-bridge': { enabled: false, port: 8766 } })
    expect(m.load().mcp_http['pod-manager'].enabled).toBe(false)
  })

  it('persists the switch and the port, and an old file without it loads with the defaults', () => {
    const cfg = m.load()
    m.put({ ...cfg, mcp_http: { ...cfg.mcp_http, 'comfy-bridge': { enabled: true, port: 9100 } } })
    expect(m.load().mcp_http).toEqual({ 'pod-manager': { enabled: false, port: 8765 }, 'comfy-bridge': { enabled: true, port: 9100 } })
    expect(JSON.parse(readFileSync(mountsFile(), 'utf8')).mcp_http['comfy-bridge']).toEqual({ enabled: true, port: 9100 })
    writeFileSync(mountsFile(), JSON.stringify({ idle_stop_minutes: 5 }))
    expect(m.load().mcp_http).toEqual(m.defaults().mcp_http)
  })

  it('rejects a port that is not a whole number from 1024 to 65535, or one shared by both', () => {
    const cfg = m.load()
    const with_ = (id: 'pod-manager' | 'comfy-bridge', port: number) => ({ ...cfg, mcp_http: { ...cfg.mcp_http, [id]: { enabled: true, port } } })
    for (const port of [80, 70000, 8765.5, Number.NaN]) expect(() => m.put(with_('pod-manager', port))).toThrow(/port/)
    expect(() => m.put(with_('comfy-bridge', 8765))).toThrow(/share/)
    expect(() => m.put(with_('pod-manager', 9000))).not.toThrow()
  })

  it('sync_shared: the ComfyUI-Shared folders a push carries; default input, models, workflows; unknown names and an old file without it are handled', () => {
    expect(m.defaults().sync_shared).toEqual(['input', 'models', 'workflows'])
    expect(m.normalize({}).sync_shared).toEqual(['input', 'models', 'workflows'])             // a config saved before the field existed
    expect(m.normalize({ sync_shared: ['workflows', 'output', 'nonsense', 'input'] }).sync_shared).toEqual(['input', 'output', 'workflows'])   // known names, in the panel's order
    expect(m.normalize({ sync_shared: [] }).sync_shared).toEqual([])                          // none is a choice: only what else is in the folder goes
    const cfg = m.defaults(); cfg.sync_shared = ['output']
    m.put(cfg)
    expect(m.load().sync_shared).toEqual(['output'])
  })
})
