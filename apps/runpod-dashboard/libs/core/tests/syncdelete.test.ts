import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as configio from '../src/configio.js'
import * as history from '../src/history.js'
import * as mounts from '../src/mounts.js'
import * as podconfigs from '../src/podconfigs.js'
import * as pods from '../src/pods.js'
import * as syncdelete from '../src/syncdelete.js'
import * as syncrun from '../src/syncrun.js'
import { CoreError } from '../src/errors.js'
import { fakeTree, scratch } from './helpers.js'

// docs/ADR-011, "Removing what was left out": a push with exclusions can also remove what the patterns match on the volume: a TARGETED, GUARDED removal, never rsync --delete-excluded. Fakes only: no rm, ssh, aws or RunPod.
const GB = 1e9, CAN = Math.round(505 * GB / 1024) * 1024   // what `du -sk` makes of 505 GB
type Kind = 'd' | 'f' | 'l'
let dir: string, volumeGb: number, running: boolean, remote: Map<string, { t: Kind; bytes: number }>, execs: string[][], envs: (NodeJS.ProcessEnv | undefined)[], failRm: Set<string>, escapes: Set<string>, freeGb: number, totalBytes: number
const pod = () => ({ id: 'p1', name: 'p', networkVolumeId: 'vol1', runtime: running ? { uptimeInSeconds: 100, ports: [{ ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } : { uptimeInSeconds: 0, ports: [] } })
const client = { apiKey: 'test', fetchFn: (async (url: string) => (String(url).includes('graphql') ? { ok: true, status: 200, json: async () => ({ data: { pod: pod() } }) } : { ok: true, status: 200, json: async () => ({ id: 'vol1', name: 'v', size: volumeGb, dataCenterId: 'EU-RO-1' }) })) as unknown as typeof fetch }
/** The fake volume: path -> type and size. The whole project tree of the incident, plus things the pods made that a delete-excluded would have destroyed. */
const seed = () => {
  remote = new Map()
  const put = (p: string, t: Kind, bytes = 0) => remote.set(p, { t, bytes })
  put('/workspace/project', 'd'); put('/workspace/project/CANALV2', 'd'); put('/workspace/project/CANALV2/10_CORROSION', 'd'); put('/workspace/project/CANALV2/10_CORROSION/a.dpx', 'f', 500 * GB); put('/workspace/project/CANALV2/06_REVIEW', 'd'); put('/workspace/project/CANALV2/06_REVIEW/r.exr', 'f', 5 * GB)
  put('/workspace/project/10_CORROSION', 'd'); put('/workspace/project/10_CORROSION/corrosion-001', 'd'); put('/workspace/project/10_CORROSION/corrosion-001/06_REVIEW', 'd'); put('/workspace/project/10_CORROSION/corrosion-001/06_REVIEW/render.exr', 'f', 7 * GB)
  put('/workspace/project/from-a-pod.txt', 'f', 1000); put('/workspace/project/NotCANALV2', 'd'); put('/workspace/project/NotCANALV2/keep.dpx', 'f', 3 * GB); put('/workspace/project/link', 'l')
  put('/workspace/comfy-shared', 'd'); put('/workspace/comfy-shared/output', 'd'); put('/workspace/comfy-shared/output/pod-render_0001.exr', 'f', 2 * GB); put('/workspace/comfy-shared/.journal', 'd'); put('/workspace/comfy-shared/.journal/e.json', 'f', 10); put('/workspace/comfy-shared/workflows', 'd'); put('/workspace/comfy-shared/workflows/g.json', 'f', 5)
}
const snapshot = () => JSON.stringify([...remote.entries()].sort())
const under = (p: string) => [...remote.keys()].filter((k) => k === p || k.startsWith(p + '/'))
const remoteArg = (c: string[]) => c[c.length - 1]
const exec: syncrun.Exec = async (cmd, onLine, _signal, env) => {
  execs.push(cmd); envs.push(env)
  const last = remoteArg(cmd)
  if (cmd[0] === 'ssh') {
    if (last.startsWith('df ')) { onLine('Filesystem 1024-blocks Used Available Capacity Mounted on'); onLine(`/dev/x 1000000000 1 ${Math.round(freeGb * GB / 1024)} 1% /workspace`); return 0 }
    if (last.startsWith('find ') && last.includes('-printf')) { const root = /find '([^']+)'/.exec(last)![1]; for (const k of [...remote.keys()].sort()) if (k.startsWith(root + '/') && k.slice(root.length + 1).split('/').length <= 5) onLine(`${remote.get(k)!.t} ${k.slice(root.length + 1)}`); return 0 }
    if (last.startsWith('du -sk')) { const p = /du -sk -- '([^']+)'/.exec(last)![1]; onLine(String(Math.round(under(p).reduce((a, k) => a + remote.get(k)!.bytes, 0) / 1024))); onLine(String(under(p).filter((k) => remote.get(k)!.t === 'f').length)); return 0 }
    if (last.includes('rm -rf --one-file-system')) {
      const p = /p='([^']+)'/.exec(last)![1]
      if (failRm.has(p)) { onLine('rm: cannot remove: Input/output error'); return 1 }
      if (remote.get(p)?.t === 'l' || escapes.has(p)) { onLine(`REFUSED: ${p} is outside /workspace/project`); return 3 }
      for (const k of under(p)) remote.delete(k); return 0
    }
  }
  if (cmd[0] === 'aws' && cmd[2] === 'rm') { const key = cmd[3].replace('s3://vol1/', ''); if (failRm.has('/workspace/' + key.replace(/\/$/, ''))) return 1; for (const k of under('/workspace/' + key)) remote.delete(k); return 0 }
  if (cmd.includes('-n')) { onLine('Number of files transferred: 3'); onLine(`Total transferred file size: ${totalBytes} B`); return 0 }
  return 0   // a copy
}
const copies = () => execs.filter((c) => c[0] === 'rsync' && !c.includes('-n'))
const removals = () => execs.filter((c) => remoteArg(c).includes('rm -rf --one-file-system') || (c[0] === 'aws' && c[2] === 'rm'))
const push = (o: Partial<syncrun.SyncRequest> = {}, ev: syncrun.SyncEvent[] = []) => syncrun.run({ pod_id: 'p1', direction: 'push', only: ['project'], ...o }, (e) => ev.push(e), new AbortController().signal, client, exec)

beforeEach(() => {
  dir = scratch(); process.env.HISTORY_FILE = join(dir, 'h.jsonl'); process.env.POD_CONFIGS_FILE = join(dir, 'pc.json'); process.env.POD_NAMES_FILE = join(dir, 'pn.json'); process.env.IDLE_FILE = join(dir, 'i.json'); process.env.POD_ROUNDS_FILE = join(dir, 'pr.json'); process.env.REPOSITORIES_FILE = join(dir, 'r.json')
  process.env.SYNC_LOGS_DIR = join(dir, 'logs'); process.env.SYNC_RUNS_FILE = join(dir, 'runs.json'); process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
  const cfg = mounts.defaults(); cfg.folders.project = fakeTree(dir); cfg.network_volume_id = 'vol1'; cfg.data_center_id = 'EU-RO-1'; mounts.save(cfg)
  volumeGb = 1500; running = true; execs = []; envs = []; failRm = new Set(); escapes = new Set(); freeGb = 900; totalBytes = 10 * GB; seed(); syncdelete.setS3(null)
})
afterEach(() => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY; syncdelete.setS3(null) })

describe('the matcher is the exclude\'s', () => {
  const m = syncdelete.matchExclude
  it('anchored, folders only, any depth, wildcards, a slash inside', () => {
    expect([m('CANALV2/', 'CANALV2', true), m('CANALV2/', 'a/b/CANALV2', true), m('CANALV2/', 'CANALV2', false), m('CANALV2/', 'NotCANALV2', true), m('CANALV2/', 'CANALV2x', true)]).toEqual([true, true, false, false, false])
    expect([m('/CANALV2/', 'CANALV2', true), m('/CANALV2/', 'a/CANALV2', true), m('/CANALV2', 'CANALV2', false), m('/CANALV2', 'CANALV2', true)]).toEqual([true, false, true, true])
    expect([m('CANALV2', 'x/CANALV2', true), m('CANALV2', 'x/CANALV2', false), m('CANALV2', 'CANALV2.old', true)]).toEqual([true, true, false])
    expect([m('*.tmp', 'a/b/x.tmp', false), m('*.tmp', 'x.tmpx', false), m('tmp?', 'tmp1', true), m('a/b', 'a/b', true), m('a/b', 'x/a/b', true), m('a/*', 'a/zz', true), m('a/*', 'a/zz/yy', true)]).toEqual([true, false, true, true, false, true, false])
    expect(m('/', 'x', true)).toBe(false)
  })
  it('topMatches keeps only the outermost match, once, sorted', async () => {
    const t = await syncdelete.topMatches([{ rel: 'a', dir: true }, { rel: 'a/CANALV2', dir: true }, { rel: 'a/CANALV2/x', dir: true }, { rel: 'CANALV2', dir: true }, { rel: 'CANALV2/deep/CANALV2', dir: true }, { rel: 'b/CANALV2.txt', dir: false }, { rel: 'z/f.tmp', dir: false }], ['CANALV2/', '*.tmp'])
    expect(t.map((x) => x.rel)).toEqual(['a/CANALV2', 'CANALV2', 'z/f.tmp'])
  })
})

describe('the guards', () => {
  it('refusal(): not the root, not a path outside, never .journal, a shot\'s renders only when a pattern names them', () => {
    for (const bad of ['', '/etc', '..', 'a/../b', 'a//b', './a', 'a\\b', 'a\nb', '.journal', 'x/.journal/e']) expect(syncdelete.refusal(bad, 'X/'), JSON.stringify(bad)).not.toBeNull()
    expect(syncdelete.refusal('CANALV2', 'CANALV2/')).toBeNull(); expect(syncdelete.refusal('a/06_REVIEW', 'X*/')).toMatch(/is only removed when a pattern names it/); expect(syncdelete.refusal('a/06_REVIEW', '06_REVIEW/')).toBeNull(); expect(syncdelete.refusal('a/06_REVIEW', '/a/06_REVIEW/')).toBeNull()
  })
  it('checkMatches: a pattern matching more than 20 folders directly in the root is too broad; more than 50,000 matches are refused; guards drop the unsafe ones', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ rel: `d${i}`, dir: true, pattern: '*/' }))
    expect(() => syncdelete.checkMatches('project', '/workspace/project/', many(21))).toThrow('That pattern is too broad: 21 folders directly in project match */'); expect(syncdelete.checkMatches('project', '/workspace/project/', many(20))).toHaveLength(20)
    expect(() => syncdelete.checkMatches('project', '/w/', Array.from({ length: 50_001 }, (_, i) => ({ rel: `a/b${i}`, dir: true, pattern: 'b*' })))).toThrow(/Too many matches/)
    expect(syncdelete.checkMatches('project', '/workspace/project/', [{ rel: '.journal', dir: true, pattern: '.journal/' }, { rel: 'ok', dir: true, pattern: 'ok/' }]).map((x) => x.path)).toEqual(['ok'])
    expect(syncdelete.checkMatches('project', '/workspace/project/', [{ rel: 'ok', dir: true, pattern: 'ok/' }])[0].abs).toBe('/workspace/project/ok')
  })
})

describe('over SSH: only what the pattern matches goes, and nothing else is touched', () => {
  it('removes /workspace/project/CANALV2 (and the nested CANALV2 inside it only through it), BEFORE any copy; the pods\' renders and outputs, other folders, NotCANALV2, the journal and the symlink are untouched; the exact command', async () => {
    const before = snapshot(), ev: syncrun.SyncEvent[] = []; const r = await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: 'Binc' }, ev)
    expect(r.failed).toBe(0); expect(removals()).toHaveLength(1)
    const rm = remoteArg(removals()[0]); expect(rm).toContain("p='/workspace/project/CANALV2'"); expect(rm).toContain('rm -rf --one-file-system -- "$x"'); expect(rm).toContain("r=$(readlink -f -- '/workspace/project')"); expect(rm).not.toMatch(/--delete/); expect(/p='([^']+)'/.exec(rm)![1]).not.toMatch(/[*?]/); expect(removals()[0].slice(0, 1)).toEqual(['ssh'])
    expect(under('/workspace/project/CANALV2')).toEqual([])
    const gone = new Set(JSON.parse(before).map((e: [string]) => e[0]).filter((k: string) => k.startsWith('/workspace/project/CANALV2'))); const after = JSON.parse(snapshot()).map((e: [string]) => e[0]); expect(JSON.parse(before).map((e: [string]) => e[0]).filter((k: string) => !gone.has(k))).toEqual(after)   // everything else is exactly as it was
    for (const keep of ['/workspace/project/10_CORROSION/corrosion-001/06_REVIEW/render.exr', '/workspace/project/from-a-pod.txt', '/workspace/project/NotCANALV2/keep.dpx', '/workspace/comfy-shared/output/pod-render_0001.exr', '/workspace/comfy-shared/.journal/e.json', '/workspace/project/link']) expect(remote.has(keep), keep).toBe(true)
    const firstCopy = execs.findIndex((c) => c[0] === 'rsync' && !c.includes('-n')), lastRm = execs.findLastIndex((c) => remoteArg(c).includes('rm -rf')); expect(firstCopy).toBeGreaterThan(lastRm)
    expect(ev.filter((e) => e.kind === 'delete').map((e) => `${e.state}:${e.key}:${e.path}`)).toEqual(['removing:project:CANALV2', 'removed:project:CANALV2'])
    expect(ev.find((e) => e.kind === 'delete')).toMatchObject({ bytes: CAN })
    for (const c of execs) { expect(c.join(' ')).not.toContain('--delete-excluded'); if (c[0] === 'rsync') expect(c.join(' ')).not.toMatch(/--delete/) }
  })
  it('a pattern that matches nothing on the volume is a quiet no-op: no approval needed, nothing removed', async () => {
    const before = snapshot(), ev: syncrun.SyncEvent[] = []; await push({ exclude: ['Nothing/'], delete_excluded: true }, ev)
    expect(removals()).toHaveLength(0); expect(ev.some((e) => e.kind === 'delete')).toBe(false); expect(snapshot()).toBe(before); expect(copies().length).toBeGreaterThan(0)
  })
  it('a render folder inside a folder that is removed whole goes with it; on its own it is never taken by a broad pattern', async () => {
    await push({ exclude: ['06_REVIEW/'], delete_excluded: true, approved_by: 'Binc' })   // names them explicitly: both 06_REVIEW folders match
    expect(remote.has('/workspace/project/CANALV2/06_REVIEW')).toBe(false); expect(remote.has('/workspace/project/10_CORROSION/corrosion-001/06_REVIEW')).toBe(false)
    seed(); execs = []; await push({ exclude: ['*CORROSION/'], delete_excluded: true, approved_by: 'Binc' }); expect(remote.has('/workspace/project/10_CORROSION')).toBe(false)   // removed whole, renders inside it too
    seed(); execs = []; await push({ exclude: ['corrosion-0*/'], delete_excluded: true, approved_by: 'Binc' }); expect(remote.has('/workspace/project/10_CORROSION/corrosion-001/06_REVIEW/render.exr')).toBe(false)   // the shot folder is the match, whole
    seed(); execs = []; await push({ exclude: ['*REVIEW*/'], delete_excluded: true, approved_by: 'Binc' }); expect(remote.has('/workspace/project/10_CORROSION/corrosion-001/06_REVIEW/render.exr')).toBe(true)   // a glob does not name the renders folder: protected
  })
  it('a broad pattern is refused with its count and nothing is removed or copied', async () => {
    for (let i = 0; i < 21; i++) remote.set(`/workspace/project/d${i}`, { t: 'd', bytes: 1 })
    const before = snapshot(); const e = await push({ exclude: ['d*/'], delete_excluded: true, approved_by: 'Binc' }).catch((x) => x as CoreError)
    expect(e.message).toMatch(/That pattern is too broad: 21 folders/); expect(snapshot()).toBe(before); expect(removals()).toHaveLength(0); expect(copies()).toHaveLength(0)
  })
})

describe('consent', () => {
  it('needs the name of who says yes when something would be removed (400); the removal does not start and nothing is copied', async () => {
    const before = snapshot(); const e = await push({ exclude: ['CANALV2/'], delete_excluded: true }).catch((x) => x as CoreError)
    expect(e).toBeInstanceOf(CoreError); expect(e.status).toBe(400); expect(e.message).toBe('Deleting from the volume needs the name of who says yes'); expect(snapshot()).toBe(before); expect(removals()).toHaveLength(0); expect(copies()).toHaveLength(0)
    expect((await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: '   ' }).catch((x) => x as CoreError)).message).toMatch(/name of who says yes/)
  })
  it('without delete_excluded (the default) a push with exclusions never removes anything', async () => { const before = snapshot(); await push({ exclude: ['CANALV2/'] }); expect(snapshot()).toBe(before); expect(removals()).toHaveLength(0) })
  it('not for a pull or a files list: refused (400); a configured default is ignored there', async () => {
    await expect(syncrun.run({ pod_id: 'p1', direction: 'pull', delete_excluded: true }, () => {}, new AbortController().signal, client, exec)).rejects.toThrow(/only for a push of folders/)
    await expect(push({ paths: ['output/a'], delete_excluded: true })).rejects.toThrow(/only for a push of folders/)
    const cfg = mounts.load(); cfg.sync_exclude = ['CANALV2/']; cfg.sync_exclude_delete = true; mounts.save(cfg); expect(syncrun.wantsDelete({ pod_id: 'p1', direction: 'pull' })).toBe(false); expect(syncrun.wantsDelete({ pod_id: 'p1', direction: 'push', paths: ['output/a'] })).toBe(false); expect(syncrun.wantsDelete({ pod_id: 'p1', direction: 'push' })).toBe(true)
  })
})

describe('the preview and the room it makes', () => {
  it('count() names what would be removed with sizes and the bytes it frees', async () => {
    const c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], exclude: ['CANALV2/'], delete_excluded: true }, client, exec)
    expect(c.would_delete).toEqual([expect.objectContaining({ step: 'project', path: 'CANALV2', abs: '/workspace/project/CANALV2', bytes: CAN, files: 2, pattern: 'CANALV2/' })]); expect(c.would_delete_bytes).toBe(CAN)
    expect('would_delete' in (await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], exclude: ['CANALV2/'] }, client, exec))).toBe(false)
  })
  it('the free space AFTER the removal decides over_capacity: refused without the removal, allowed with it', async () => {
    freeGb = 100; totalBytes = 300 * GB
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], exclude: ['CANALV2/'] }, client, exec)).all).toMatchObject({ over_capacity: true })
    expect((await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], exclude: ['CANALV2/'], delete_excluded: true }, client, exec)).all).toMatchObject({ over_capacity: false, free_bytes: 100 * GB })
    await expect(push({ exclude: ['CANALV2/'] })).rejects.toThrow(/This push would send/); expect(removals()).toHaveLength(0)
    const ev: syncrun.SyncEvent[] = []; const r = await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: 'Binc' }, ev); expect(r.failed).toBe(0); expect(ev.find((e) => e.kind === 'totals')).toMatchObject({ over_capacity: false, would_delete_bytes: CAN })
  })
})

describe('a failed removal stops the run before any copy', () => {
  it('reports what was removed before it; a symlink or an escape is refused by the guard on the pod', async () => {
    remote.set('/workspace/project/Zeta', { t: 'd', bytes: 1 }); failRm.add('/workspace/project/Zeta')
    const e = await push({ exclude: ['CANALV2/', 'Zeta/'], delete_excluded: true, approved_by: 'Binc' }).catch((x) => x as CoreError)
    expect(e.message).toBe('Removal failed at Zeta (project): rm: cannot remove: Input/output error. Removed before it: project/CANALV2. Nothing was copied.'); expect(copies()).toHaveLength(0); expect(remote.has('/workspace/project/Zeta')).toBe(true); expect(under('/workspace/project/CANALV2')).toEqual([])
    seed(); execs = []; escapes.add('/workspace/project/CANALV2'); const e2 = await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: 'Binc' }).catch((x) => x as CoreError)
    expect(e2.message).toMatch(/Removal failed at CANALV2 \(project\): REFUSED: \/workspace\/project\/CANALV2 is outside/); expect(remote.has('/workspace/project/CANALV2')).toBe(true); expect(copies()).toHaveLength(0)
    expect(syncdelete.removeCmdSsh({ kind: 'ssh', host: 'root@h', port: 22 }, '/workspace/project/', "/workspace/project/it's").at(-1)).toContain(`p='/workspace/project/it'\\''s'`)   // a quote in a name stays data
  })
  it('the History says how many folders and how much was removed, the first few, and who approved it (also when the run failed after)', async () => {
    await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: 'Binc' })
    const h = history.list({ kind: 'job' }).find((x) => x.kind === 'job' && x.job === 'sync')!; expect((h as { detail: string }).detail).toBe('left out 1 pattern: CANALV2/; removed 1 folder from the volume (505 GB): project/CANALV2; approved by Binc'); expect((h as { approved_by: string }).approved_by).toBe('Binc'); expect(h).toMatchObject({ state: 'done' })
  })
})

describe('over S3 (the pod stopped)', () => {
  it('lists by prefix, matches the same way, measures from the listing and removes with aws s3 rm --recursive (an argument array, the keys in the environment)', async () => {
    running = false
    const level = (prefix: string) => { const base = '/workspace/' + prefix; const out: { key: string; bytes: number }[] = []; for (const [k, v] of [...remote.entries()].sort()) { if (!k.startsWith(base) || k === base.replace(/\/$/, '')) continue; const rest = k.slice(base.length); if (rest.includes('/') ) continue; out.push({ key: `${prefix}${rest}${v.t === 'd' ? '/' : ''}`, bytes: v.bytes }) } return Promise.resolve(out) }
    syncdelete.setS3({ list: (p) => level(p), listAll: async (p) => [...remote.entries()].filter(([k]) => k.startsWith('/workspace/' + p)).map(([k, v]) => ({ key: k.slice('/workspace/'.length), bytes: v.bytes })) })
    const c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], exclude: ['CANALV2/'], delete_excluded: true }, client, exec)
    expect(c.would_delete).toEqual([expect.objectContaining({ step: 'project', path: 'CANALV2', bytes: 505 * GB })])
    const before = snapshot(); await expect(push({ exclude: ['CANALV2/'], delete_excluded: true })).rejects.toThrow(/name of who says yes/); expect(snapshot()).toBe(before)
    execs = []; envs = []; await push({ exclude: ['CANALV2/'], delete_excluded: true, approved_by: 'Binc' })
    const i = execs.findIndex((x) => x[0] === 'aws' && x[2] === 'rm'); expect(execs[i]).toEqual(['aws', 's3', 'rm', 's3://vol1/project/CANALV2', '--recursive', '--endpoint-url', 'https://s3api-eu-ro-1.runpod.io/', '--region', 'EU-RO-1']); expect(envs[i]).toMatchObject({ AWS_ACCESS_KEY_ID: 'user_x', AWS_SECRET_ACCESS_KEY: 'rps_y' }); expect(JSON.stringify(execs[i])).not.toMatch(/user_x|rps_y/)
    expect(remote.has('/workspace/project/NotCANALV2/keep.dpx') && remote.has('/workspace/comfy-shared/output/pod-render_0001.exr')).toBe(true); expect(under('/workspace/project/CANALV2')).toEqual([])
    expect(syncdelete.removeCmdS3({ kind: 's3', volume: { id: 'v', datacenter: 'EU-RO-1' } }, 'project/x.txt', false)).not.toContain('--recursive')
  })
})

describe('the setting', () => {
  it('sync_exclude_delete: default false, normalised, carried by export, import, undo, reset and Recreate; the request wins over it', async () => {
    expect(mounts.defaults().sync_exclude_delete).toBe(false); expect(mounts.normalize({ sync_exclude_delete: 'yes' as never }).sync_exclude_delete).toBe(false); expect(mounts.normalize({ sync_exclude_delete: true }).sync_exclude_delete).toBe(true)
    mounts.put({ ...mounts.load(), sync_exclude: ['CANALV2/'], sync_exclude_delete: true }); const f = configio.exportConfig({ includeSecrets: false }); expect((f.config as Record<string, unknown>).sync_exclude_delete).toBe(true)
    mounts.put({ ...mounts.load(), sync_exclude_delete: false }); expect(configio.planImport(f).sections.find((s) => s.key === 'pod_defaults')!.changed).toBe(true); configio.applyImport(f, { sections: ['pod_defaults'] }); expect(mounts.load().sync_exclude_delete).toBe(true); configio.undoImport(); expect(mounts.load().sync_exclude_delete).toBe(false)
    expect(configio.planImport({ ...f, config: { ...(f.config as object), sync_exclude_delete: 'x' } } as never).errors.join('\n')).toMatch(/sync_exclude_delete must be true or false/); expect(mounts.reset().sync_exclude_delete).toBe(false)
    mounts.save({ ...mounts.load(), dry_run: true }); const a = await pods.create({ name: 'A', gpu: 'rtx4090', config: mounts.normalize({ ...mounts.load(), sync_exclude: ['X/'], sync_exclude_delete: true }) } as never); const fresh = await pods.recreate(a.id); expect(podconfigs.get(fresh.id)).toMatchObject({ sync_exclude: ['X/'], sync_exclude_delete: true })
    mounts.save({ ...mounts.load(), dry_run: false, sync_exclude: ['CANALV2/'], sync_exclude_delete: true, folders: { ...mounts.load().folders, project: fakeTree(join(dir, 'again')) } }); const before = snapshot(); await push({ delete_excluded: false }); expect(snapshot()).toBe(before)   // the request says no: the configured yes does not apply
    await expect(push()).rejects.toThrow(/name of who says yes/)   // the configured default applies when the request is silent, and it still needs the named yes
  })
})


describe('per-folder defaults feed the removal, and count() always answers', () => {
  it('each step removes only what ITS list matches: a pattern saved for project does not touch comfy-shared; would_delete lists the right step', async () => {
    const cfg = mounts.load(); mkdirSync(join(dir, 'shared'), { recursive: true }); cfg.folders['comfy-shared'] = join(dir, 'shared'); cfg.folder_excludes = { project: ['output/', 'CANALV2/'], 'comfy-shared': ['pod-render_0001.exr'] }; mounts.save(cfg)
    const c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project', 'comfy-shared'], delete_excluded: true }, client, exec)
    expect(c.would_delete!.map((m) => `${m.step}:${m.path}`).sort()).toEqual(['comfy-shared:output/pod-render_0001.exr', 'project:CANALV2'])   // project's "output/" matched nothing in project and never reached comfy-shared/output
    expect(remote.has('/workspace/comfy-shared/output')).toBe(true); await push({ only: ['project', 'comfy-shared'], delete_excluded: true, approved_by: 'Binc' })
    expect(remote.has('/workspace/comfy-shared/output/pod-render_0001.exr')).toBe(false); expect(remote.has('/workspace/comfy-shared/output')).toBe(true); expect(under('/workspace/project/CANALV2')).toEqual([]); expect(remote.has('/workspace/project/NotCANALV2/keep.dpx')).toBe(true)
  })
  it('the same pattern under the wrong folder removes nothing', async () => {
    const cfg = mounts.load(); cfg.folder_excludes = { plates: ['CANALV2/'] }; mounts.save(cfg); const before = snapshot()
    await push({ only: ['project'], delete_excluded: true }); expect(snapshot()).toBe(before)
  })
  it('count() with delete_excluded ALWAYS returns would_delete (an empty array) and would_delete_bytes (0), even with no patterns or no match', async () => {
    for (const ex of [undefined, ['Nothing/']]) { const c = await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'], delete_excluded: true, ...(ex ? { exclude: ex } : {}) }, client, exec); expect(c.would_delete).toEqual([]); expect(c.would_delete_bytes).toBe(0) }
    expect('would_delete' in (await syncrun.countFor({ pod_id: 'p1', direction: 'push', only: ['project'] }, client, exec))).toBe(false)   // not asked: not there
    const dry = mounts.load(); dry.dry_run = true; mounts.save(dry); const d = await syncrun.countFor({ pod_id: 'p1', direction: 'push', delete_excluded: true }); expect(d.would_delete).toEqual([]); expect(d.would_delete_bytes).toBe(0)
  })
})
