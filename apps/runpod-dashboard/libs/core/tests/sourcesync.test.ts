import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as storage from '../src/storage.js'
import * as publish from '../src/publish.js'
import * as ss from '../src/sourcesync.js'

// Download To This PC (docs/ADR-067): fakes only. No S3, no RunPod, no pods.
let dir = '', cs = '', proj = '', plates = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
type Obj = { key: string; bytes: number }
let vol: Obj[] = [], bucket: Obj[] = [], calls: string[][] = [], failOn: RegExp | null = null, gate: Promise<void> | null = null, free = 1e12

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ssync-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.POD_MANAGER_CONFIG_DIR = dir; process.env.MOUNTS_FILE = join(dir, 'mounts.json'); process.env.SOURCE_SYNC_JOBS_FILE = join(dir, 'ss.json')
  cs = join(dir, 'ComfyUI-Shared'); proj = join(dir, 'project'); plates = join(dir, 'plates')
  for (const d of [cs, proj, plates]) mkdirSync(d, { recursive: true })
  const cfg = mounts.defaults(); cfg.folders['comfy-shared'] = cs; cfg.folders.project = proj; cfg.folders.plates = plates; mounts.save(cfg)
  await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'ap-southeast-1', prefix: 'lt', ...KEY })
  vol = []; bucket = []; calls = []; failOn = null; gate = null; free = 1e12
  publish.setDeps({
    volumeKeys: (async (_v: string, prefix: string) => vol.filter((o) => o.key.startsWith(prefix))) as never,
    volumeAccess: (async () => ({ ok: true, id: 'RPKEYID1234567890', secret: 'rpsecretrpsecretrpsecret99', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: 'volbucket', region: 'eu-ro-1' })) as never,
  })
  storage.setAws((async (args: string[], _env: unknown, o?: { signal?: AbortSignal }) => {
    calls.push(args)
    if (args[1] === 'ls') { const m = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1]; const out = bucket.filter((x) => x.key.startsWith(m)).map((x) => `2026-01-01 10:00:00 ${String(x.bytes).padStart(10)} ${x.key}`).join('\n'); return { code: out ? 0 : 1, stdout: out, stderr: '' } }
    const src = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1], all = [...vol, ...bucket], o2 = all.find((x) => x.key === src)
    if (gate) await Promise.race([gate, new Promise((r) => o?.signal?.addEventListener('abort', r))])
    if (o?.signal?.aborted) return { code: 1, stdout: '', stderr: 'aborted' }
    if (failOn?.test(src)) return { code: 1, stdout: '', stderr: `download failed: s3://x/${src} AccessDenied WASABIKEY12345678` }
    writeFileSync(args[3], 'x'.repeat(o2?.bytes ?? 0)); return { code: 0, stdout: '', stderr: '' }
  }) as never)
  ss.setDeps({ free: async () => free })
})
afterEach(() => { ss.reset(); publish.setDeps(null); storage.setAws(null); for (const k of ['STORAGE_ADAPTERS_FILE', 'POD_MANAGER_CONFIG_DIR', 'MOUNTS_FILE', 'SOURCE_SYNC_JOBS_FILE']) delete process.env[k]; rmSync(dir, { recursive: true, force: true }) })

const planOf = async (req: ss.Req) => {
  const { plan_id } = await ss.plan(req)
  for (let i = 0; i < 200; i++) { const s = await ss.planStatus(plan_id); if (s.state !== 'listing') { expect(s.state, s.error).toBe('done'); return s.plan! } await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('plan did not finish')
}
const waitJob = async (id: string) => { for (let i = 0; i < 400; i++) { const j = (await ss.status(id)).jobs[0]; if (j.state !== 'downloading') return j; await new Promise((r) => setTimeout(r, 5)) } throw new Error('job did not finish') }
const V = (volume_id = 'vol1'): ss.Source => ({ type: 'volume', volume_id }), S = (storage_id = 'wasabi'): ss.Source => ({ type: 'storage', storage_id })
const o = (key: string, bytes: number): Obj => ({ key, bytes })

describe('source sync plan, storage source', () => {
  it('counts, folders, weights, skip_folders, same size, conflicts, free space; the default folder is ComfyUI-Shared/output', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/a/2.exr', 20), o('lt/b/x.mov', 30), o('lt/top.txt', 5), o('lt/w/m.safetensors', 99), o('lt/.previews/p.jpg', 7), o('lt/other/zzz.txt', 1)]
    mkdirSync(join(cs, 'output', 'a'), { recursive: true }); writeFileSync(join(cs, 'output', 'a', '1.exr'), 'x'.repeat(10)); writeFileSync(join(cs, 'output', 'a', '2.exr'), 'different size')
    const p = await planOf({ source: S(), skip_folders: ['.previews', 'other'] })
    expect(p.dest.dir).toBe(join(cs, 'output')); expect(p.source).toEqual({ type: 'storage', id: 'wasabi', name: 'Wasabi' })
    expect(p.excluded_weights).toBe(1)
    expect(p.files).toBe(4); expect(p.bytes).toBe(65)
    expect(p.already_there).toEqual({ files: 1, bytes: 10 })
    expect(p.conflicts).toEqual({ files: 1, names: ['a/2.exr'] })
    expect(p.to_copy).toEqual({ files: 2, bytes: 35 })
    expect(p.folders.find((f) => f.name === '.previews')).toMatchObject({ skipped: true }); expect(p.folders.find((f) => f.name === 'other')).toMatchObject({ skipped: true })
    expect(p.free_bytes).toBe(1e12); expect(p.can_start).toBe(true)
    expect(JSON.stringify(p)).not.toContain(KEY.secret_access_key)
    expect(readFileSync(join(cs, 'output', 'a', '2.exr'), 'utf8')).toBe('different size')   // untouched by a plan
  })
  it('a prefix lists only below it; no mapped folder and no dest_dir is refused with a reason; dest_dir wins', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/b/2.exr', 10)]
    const p = await planOf({ source: S(), prefix: 'a', dest_dir: join(dir, 'elsewhere') })
    expect(p.files).toBe(1); expect(p.dest.dir).toBe(join(dir, 'elsewhere'))
    const cfg = mounts.defaults(); mounts.save(cfg)
    await expect(ss.plan({ source: S() })).rejects.toThrow(/No local folder is mapped/)
    await expect(ss.plan({ source: S(), dest_dir: 'relative/dir' })).rejects.toThrow(/full folder path/)
    await expect(ss.plan({ source: S(), prefix: '../x' })).rejects.toThrow(/Not a folder/)
  })
  it('refuses keys that leave the destination, and counts them as unsafe', async () => {
    bucket = [o('lt/a/ok.txt', 3), o('lt/a/../../evil.txt', 4), o('lt//abs.txt', 4)]
    const p = await planOf({ source: S() })
    expect(p.unsafe.files).toBe(2); expect(p.to_copy.files).toBe(1)
  })
  it('free space: refuses when to_copy + 1 GB > free, at plan and at Start', async () => {
    bucket = [o('lt/a/1.exr', 500_000_000)]
    free = 2_000_000_000
    let p = await planOf({ source: S() }); expect(p.can_start).toBe(true)
    free = 1_000_000_000
    p = await planOf({ source: S() }); expect(p.can_start).toBe(false); expect(p.reason).toMatch(/Not enough free space/)
    await expect(ss.start({ plan_id: p.plan_id })).rejects.toThrow(/Not enough free space|nothing to copy/i)
  })
})

describe('source sync plan, volume source', () => {
  it('default takes comfy-shared, project, plates into their mapped folders; an unmapped one is skipped with the reason', async () => {
    vol = [o('comfy-shared/output/r1/a.exr', 10), o('project/shots/s.txt', 5), o('plates/p/1.dpx', 7), o('comfy-shared/models/m.safetensors', 99), o('other/x', 1)]
    const cfg = mounts.load(); cfg.folders.plates = ''; mounts.save(cfg)
    const p = await planOf({ source: V() })
    expect(p.folders.map((f) => f.name)).toEqual(['comfy-shared', 'plates', 'project'])
    expect(p.folders.find((f) => f.name === 'plates')).toMatchObject({ skipped: true, reason: 'not mapped on this PC', files: 1 })
    expect(p.files).toBe(2); expect(p.to_copy).toEqual({ files: 2, bytes: 15 }); expect(p.excluded_weights).toBe(1)
    expect(p.dest.dirs).toEqual([{ name: 'comfy-shared', dir: cs }, { name: 'project', dir: proj }])
    expect(p.can_start).toBe(true)
  })
  it('skip_folders by top name, and nothing mapped is a plain reason', async () => {
    vol = [o('comfy-shared/output/a.exr', 10), o('project/s.txt', 5)]
    let p = await planOf({ source: V(), skip_folders: ['project'] })
    expect(p.files).toBe(1); expect(p.folders.find((f) => f.name === 'project')?.skipped).toBe(true)
    mounts.save(mounts.defaults())
    p = await planOf({ source: V() }); expect(p.can_start).toBe(false); expect(p.reason).toMatch(/not mapped on this PC/)
  })
  it('a one-folder prefix maps below its folder; dest_dir overrides it; dest_dir needs a prefix', async () => {
    vol = [o('comfy-shared/output/r1/a.exr', 10), o('comfy-shared/input/i.png', 3)]
    let p = await planOf({ source: V(), prefix: 'comfy-shared/output/' })
    expect(p.files).toBe(1); expect(p.dest.dir).toBe(cs)
    const id = (await ss.start({ plan_id: p.plan_id })).job_id; expect((await waitJob(id)).state).toBe('done')
    expect(existsSync(join(cs, 'output', 'r1', 'a.exr'))).toBe(true)
    p = await planOf({ source: V(), prefix: 'comfy-shared/output/', dest_dir: join(dir, 'x') })
    expect(p.dest.dir).toBe(join(dir, 'x')); expect(p.to_copy.files).toBe(1)
    await expect(ss.plan({ source: V(), dest_dir: join(dir, 'x') })).rejects.toThrow(/needs a prefix/)
    p = await planOf({ source: V(), prefix: 'stray/' }); expect(p.can_start).toBe(false)
  })
})

describe('source sync job', () => {
  it('downloads via temp + rename, sets progress, uses the volume endpoint, skips same size, never overwrites', async () => {
    vol = [o('comfy-shared/output/a/1.exr', 10), o('comfy-shared/output/a/2.exr', 20), o('comfy-shared/output/a/3.exr', 4)]
    mkdirSync(join(cs, 'output', 'a'), { recursive: true }); writeFileSync(join(cs, 'output', 'a', '1.exr'), 'x'.repeat(10)); writeFileSync(join(cs, 'output', 'a', '3.exr'), 'mine')
    const p = await planOf({ source: V(), prefix: 'comfy-shared/' })
    expect(p.conflicts.files).toBe(0)   // 3.exr is 4 bytes = same size
    const { job_id } = await ss.start({ plan_id: p.plan_id, approved_by: 'Lucas' })
    const j = await waitJob(job_id)
    expect(j).toMatchObject({ state: 'done', kind: 'source-sync', files_done: 1, files_skipped: 2, files_failed: 0, bytes_done: 20 })
    expect(readdirSync(join(cs, 'output', 'a')).sort()).toEqual(['1.exr', '2.exr', '3.exr'])   // no temp left
    expect(statSync(join(cs, 'output', 'a', '2.exr')).size).toBe(20)
    const cp = calls.find((c) => c[1] === 'cp')!
    expect(cp[2]).toBe('s3://volbucket/comfy-shared/output/a/2.exr'); expect(cp).toContain('--endpoint-url'); expect(cp[3]).toMatch(/\.2\.exr\.part$/)
    expect(JSON.stringify(j)).not.toMatch(/rpsecret|RPKEYID|https?:/)
  })
  it('a different-size local file is a conflict: untouched, a warning, not a failure', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/a/2.exr', 20)]
    mkdirSync(join(cs, 'output', 'a'), { recursive: true }); writeFileSync(join(cs, 'output', 'a', '1.exr'), 'local content')
    const p = await planOf({ source: S() })
    expect(p.conflicts).toEqual({ files: 1, names: ['a/1.exr'] })
    const j = await waitJob((await ss.start({ plan_id: p.plan_id })).job_id)
    expect(j.state).toBe('done_with_warning'); expect(j.files_failed).toBe(0); expect(j.warnings.join()).toMatch(/left alone/)
    expect(readFileSync(join(cs, 'output', 'a', '1.exr'), 'utf8')).toBe('local content')
    expect(calls.filter((c) => c[1] === 'cp').map((c) => c[2])).toEqual(['s3://b-bucket/lt/a/2.exr'])
  })
  it('never follows a link: a symlinked folder on the way fails that file and writes nothing outside', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/b/2.exr', 10)]
    const outside = join(dir, 'outside'); mkdirSync(outside); mkdirSync(join(cs, 'output'), { recursive: true }); symlinkSync(outside, join(cs, 'output', 'a'))
    const p = await planOf({ source: S() })
    const j = await waitJob((await ss.start({ plan_id: p.plan_id })).job_id)
    expect(j.files_failed).toBe(1); expect(j.files_done).toBe(1); expect(readdirSync(outside)).toEqual([])
    expect(j.warnings.join()).toMatch(/not a plain folder/)
  })
  it('one failure is a warning and the rest go on; keys never show; Retry sends only the failed file', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/a/2.exr', 20), o('lt/a/3.exr', 30)]
    failOn = /2\.exr$/
    const p = await planOf({ source: S() })
    const j = await waitJob((await ss.start({ plan_id: p.plan_id })).job_id)
    expect(j.warnings, JSON.stringify(j.warnings)).toHaveLength(1); expect(j).toMatchObject({ state: 'done_with_warning', files_done: 2, files_failed: 1 })
    expect(JSON.stringify(j)).not.toContain(KEY.access_key_id); expect(j.warnings[0]).toMatch(/^2\.exr: /)
    expect(existsSync(join(cs, 'output', 'a', '2.exr'))).toBe(false)
    failOn = null; calls = []
    const r = await waitJob((await ss.retry(j.job_id)).job_id)
    expect(r).toMatchObject({ state: 'done', files_done: 1, files_total: 1 })
    expect(calls.filter((c) => c[1] === 'cp').map((c) => c[2])).toEqual(['s3://b-bucket/lt/a/2.exr'])
    await expect(ss.retry(r.job_id)).rejects.toThrow(/no failed files/)
    expect(JSON.parse(readFileSync(process.env.SOURCE_SYNC_JOBS_FILE!, 'utf8')).length).toBeGreaterThan(0)
  })
  it('5 failures in a row stop the job as failed', async () => {
    bucket = Array.from({ length: 12 }, (_, i) => o(`lt/f/${i}.exr`, 5)); failOn = /exr$/
    ss.setDeps({ workers: 1 })
    const j = await waitJob((await ss.start({ plan_id: (await planOf({ source: S() })).plan_id })).job_id)
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/5 files in a row/); expect(j.files_failed).toBe(12)
  })
  it('Cancel stops promptly and leaves no half file', async () => {
    bucket = [o('lt/a/1.exr', 10), o('lt/a/2.exr', 10), o('lt/a/3.exr', 10)]
    let release!: () => void; gate = new Promise<void>((r) => { release = r })
    const { job_id } = await ss.start({ plan_id: (await planOf({ source: S() })).plan_id })
    await new Promise((r) => setTimeout(r, 20))
    const t0 = Date.now(); const c = await ss.cancel(job_id)
    expect(c.state).toBe('cancelled'); expect(Date.now() - t0).toBeLessThan(1000); release()
    expect(existsSync(join(cs, 'output', 'a')) ? readdirSync(join(cs, 'output', 'a')) : []).toEqual([])
  })
  it('two plans at once stay apart, each with its own job', async () => {
    bucket = [o('lt/a/1.exr', 10)]; vol = [o('project/s.txt', 5)]
    const [a, b] = await Promise.all([ss.plan({ source: S() }), ss.plan({ source: V() })])
    expect(a.plan_id).not.toBe(b.plan_id)
    let pa, pb
    for (let i = 0; i < 100 && (!pa || !pb); i++) { await new Promise((r) => setTimeout(r, 5)); const x = await ss.planStatus(a.plan_id), y = await ss.planStatus(b.plan_id); pa = x.plan; pb = y.plan }
    expect(pa!.source.type).toBe('storage'); expect(pb!.source.type).toBe('volume')
    const [ja, jb] = await Promise.all([ss.start({ plan_id: a.plan_id }), ss.start({ plan_id: b.plan_id })])
    expect((await waitJob(ja.job_id)).state).toBe('done'); expect((await waitJob(jb.job_id)).state).toBe('done')
    expect(existsSync(join(cs, 'output', 'a', '1.exr'))).toBe(true); expect(existsSync(join(proj, 's.txt'))).toBe(true)
    expect((await ss.status()).jobs.length).toBe(2)
  })
  it('cancelPlan stops a plan that is still listing', async () => {
    publish.setDeps({ volumeKeys: ((_v: string, _p: string, opt?: { signal?: AbortSignal }) => new Promise((_r, rej) => opt?.signal?.addEventListener('abort', () => rej(new Error('x'))))) as never })
    const { plan_id } = await ss.plan({ source: V() })
    expect((await ss.cancelPlan(plan_id)).state).toBe('cancelled')
  })
})

describe('source sync, the BH exchange bucket as a source (ADR-067 amendment)', () => {
  const BH = { id: 'BHKEYIDBHKEYID1234', secret: 'bhsecretbhsecretbhsecret123456' }
  beforeEach(() => { process.env.SETTINGS_ENV_FILE = join(dir, 'none.env'); process.env.PANAMA_AWS_ACCESS_KEY_ID = BH.id; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = BH.secret; process.env.PANAMA_S3_BUCKET = 'bh-exchange' })
  afterEach(() => { for (const k of ['SETTINGS_ENV_FILE', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'PANAMA_S3_BUCKET']) delete process.env[k] })
  it('plans the whole bucket by default with a per-top-level-folder table, using the Panama access', async () => {
    bucket = [o('rounds/r1/a.exr', 10), o('rounds/r1/b.exr', 20), o('top.txt', 5), o('rounds/r2/m.ckpt', 9)]
    const p = await planOf({ source: S('panama-s3') })
    expect(p.source).toMatchObject({ type: 'storage', id: 'panama-s3' }); expect(p.prefix).toBe('')
    expect(p.files).toBe(3); expect(p.bytes).toBe(35); expect(p.excluded_weights).toBe(1)
    expect(p.folders.map((f) => f.name)).toEqual(['(this folder)', 'rounds']); expect(p.folders.find((f) => f.name === 'rounds')).toMatchObject({ files: 2, bytes: 30 })
    expect(p.dest.dir).toBe(join(cs, 'output'))
    const ls = calls.find((a) => a[1] === 'ls')!; expect(ls[2]).toBe('s3://bh-exchange/'); expect(ls).not.toContain('--profile'); expect(ls).toContain('--region')
    expect(JSON.stringify(p)).not.toContain(BH.secret)
  })
  it("'publish-s3' is accepted as the same bucket, and a prefix narrows the plan", async () => {
    bucket = [o('rounds/r1/a.exr', 10), o('other/x', 1)]
    const p = await planOf({ source: S('publish-s3'), prefix: 'rounds/' })
    expect(p.source.id).toBe('panama-s3'); expect(p.files).toBe(1)
  })
  it('downloads from the BH bucket (key without any storage directory) and a secret never reaches the job', async () => {
    bucket = [o('rounds/r1/a.exr', 10)]
    const p = await planOf({ source: S('panama-s3') })
    const j = await waitJob((await ss.start({ plan_id: p.plan_id })).job_id)
    expect(j).toMatchObject({ state: 'done', files_done: 1 }); expect(j.source.id).toBe('panama-s3')
    expect(readFileSync(join(cs, 'output', 'rounds', 'r1', 'a.exr'), 'utf8')).toHaveLength(10)
    expect(calls.find((a) => a[1] === 'cp')![2]).toBe('s3://bh-exchange/rounds/r1/a.exr'); expect(JSON.stringify(j)).not.toContain(BH.secret)
  })
  it('with only an AWS profile (no app keys) it lists with the profile', async () => {
    delete process.env.PANAMA_AWS_ACCESS_KEY_ID; delete process.env.PANAMA_AWS_SECRET_ACCESS_KEY
    bucket = [o('a.txt', 1)]; await planOf({ source: S('panama-s3') })
    expect(calls.find((a) => a[1] === 'ls')).toContain('--profile')
  })
  it('is refused with the plain message when the Panama switch is off', async () => {
    await storage.setEnabled('panama-s3', false)
    await expect(ss.plan({ source: S('panama-s3') })).rejects.toThrow(/Panama S3 adapter is off/)
    await expect(ss.plan({ source: S('publish-s3') })).rejects.toThrow(/Panama S3 adapter is off/)
  })
})
