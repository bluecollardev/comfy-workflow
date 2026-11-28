import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as publish from '../src/publish.js'
import * as bs from '../src/bucketsync.js'

// Bucket to bucket through a pod (docs/ADR-067 amendment): fakes only. No S3, no ssh, no RunPod.
let dir = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
const OWN = { access_key_id: 'OWNKEYOWNKEY123456', secret_access_key: 'ownsecretownsecretownsecret12' }
const BH = { id: 'BHKEYIDBHKEYID1234', secret: 'bhsecretbhsecretbhsecret123456' }
const RP = { id: 'RPKEYID1234567890', secret: 'rpsecretrpsecretrpsecret99' }
const POD = { id: 'podabc123', name: 'pod-1', host: 'root@1.2.3.4', port: 22 }
type Obj = { key: string; bytes: number }
let vol: Obj[] = [], bucket: Obj[] = [], target: Obj[] = [], pods: unknown[] = [POD], jobs: { host: string; port: number; script: string }[] = [], awsCalls: string[][] = [], failOn: RegExp | null = null, gate: Promise<void> | null = null

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bsync-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.POD_MANAGER_CONFIG_DIR = dir; process.env.BUCKET_SYNC_JOBS_FILE = join(dir, 'bs.json'); process.env.SETTINGS_ENV_FILE = join(dir, 'none.env')
  process.env.PANAMA_AWS_ACCESS_KEY_ID = BH.id; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = BH.secret; process.env.PANAMA_S3_BUCKET = 'bh-exchange'
  await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'ap-southeast-1', prefix: 'lt', ...KEY })
  await storage.save({ name: 'Mine', bucket: 'mine-bucket', region: 'eu-central-1', endpoint: 'https://s3.mine.example.com', prefix: 'x', ...OWN })
  vol = []; bucket = []; target = []; pods = [POD]; jobs = []; awsCalls = []; failOn = null; gate = null
  publish.setDeps({
    volumeKeys: (async (_v: string, prefix: string) => vol.filter((o) => o.key.startsWith(prefix))) as never,
    volumeAccess: (async () => ({ ok: true, ...RP, endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: 'volbucket', region: 'eu-ro-1' })) as never,
    podsAny: (async () => pods) as never,
    ssh: (async (o: { host: string; port: number; script: string; signal?: AbortSignal; onLine: (l: string) => void }) => {
      jobs.push({ host: o.host, port: o.port, script: o.script })
      if (/^pkill/.test(o.script)) return { code: 0 }
      o.onLine('PUBLISH-PID 4242')
      if (gate) await Promise.race([gate, new Promise((r) => o.signal?.addEventListener('abort', r))])
      if (o.signal?.aborted) throw new Error('aborted')
      if (failOn?.test(o.script)) { o.onLine(`PUBLISH-FAIL curl exit 22 ${KEY.secret_access_key}`); return { code: 22 } }
      o.onLine('PUBLISH-OK'); return { code: 0 }
    }) as never,
  })
  storage.setAws((async (args: string[]) => {
    awsCalls.push(args)
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!, list = m[1] === 'bh-exchange' ? bucket : target   // the BH bucket is the source; the storages answer as the target
    const out = list.filter((x) => x.key.startsWith(m[2])).map((x) => `2026-01-01 10:00:00 ${String(x.bytes).padStart(10)} ${x.key}`).join('\n')
    return { code: out ? 0 : 1, stdout: out, stderr: '' }
  }) as never)
  bs.setDeps({ podPrice: async () => 0.5 })
})
afterEach(() => { bs.reset(); publish.setDeps(null); storage.setAws(null); for (const k of ['STORAGE_ADAPTERS_FILE', 'POD_MANAGER_CONFIG_DIR', 'BUCKET_SYNC_JOBS_FILE', 'SETTINGS_ENV_FILE', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'PANAMA_S3_BUCKET']) delete process.env[k]; rmSync(dir, { recursive: true, force: true }) })

const V: bs.Source = { type: 'volume', volume_id: 'vol1' }, B: bs.Source = { type: 'storage', storage_id: 'panama-s3' }
const P = 'comfy-shared/output/'
const k = (rel: string, bytes: number): Obj => ({ key: `${P}${rel}`, bytes })
const planOf = async (req: Partial<bs.Req> = {}) => {
  const { plan_id } = await bs.plan({ source: V, target: { storage_id: 'wasabi' }, ...req })
  for (let i = 0; i < 200; i++) { const s = await bs.planStatus(plan_id); if (s.state !== 'listing') { expect(s.state, s.error).toBe('done'); return s.plan! } await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('plan did not finish')
}
const waitJob = async (id: string) => { for (let i = 0; i < 400; i++) { const j = (await bs.status(id)).jobs[0]; if (j.state !== 'copying') return j; await new Promise((r) => setTimeout(r, 5)) } throw new Error('job did not finish') }
const copies = () => jobs.filter((j) => !/^pkill/.test(j.script))

describe('bucket sync plan', () => {
  it('volume source: counts, same-size skip, weights, too big, skip_folders, estimate, any pod', async () => {
    vol = [k('a/1.exr', 11_000_000), k('a/2.exr', 11_000_000), k('b/x.mov', 22_000_000), k('top.txt', 5), k('w/model.safetensors', 99), k('b/huge.mov', 6 * 1024 ** 3), k('.previews/p.jpg', 7), k('a/', 0)]
    target = [{ key: 'lt/a/1.exr', bytes: 11_000_000 }, { key: 'lt/a/2.exr', bytes: 3 }]
    const p = await planOf({ skip_folders: ['.previews'] })
    expect(p).toMatchObject({ source: { type: 'volume', id: 'vol1' }, target: { storage_id: 'wasabi', name: 'Wasabi', bucket: 'b-bucket', prefix: 'lt/', region: 'ap-southeast-1' }, prefix: P, excluded_weights: 1 })
    expect(p.files).toBe(5)
    expect(p.already_there).toEqual({ files: 1, bytes: 11_000_000 })
    expect(p.too_big).toEqual({ files: 1, names: ['b/huge.mov'] })
    expect(p.to_copy).toEqual({ files: 3, bytes: 11_000_000 + 22_000_000 + 5 })
    expect(p.folders.find((f) => f.name === '.previews')).toMatchObject({ files: 1, skipped: true })
    expect(p.pod).toEqual({ id: 'podabc123', name: 'pod-1', cost_per_hr: 0.5 }); expect(p.pods).toEqual([{ id: 'podabc123', name: 'pod-1' }])
    expect(p.can_start).toBe(true)
    expect(p.estimate.rate_mb_s).toBe(11); expect(p.estimate.usd).toBeCloseTo(p.estimate.hours * 0.5, 2)
    expect(JSON.stringify(p)).not.toContain(KEY.secret_access_key)
  })
  it('BH source lists the whole bucket with the Panama access and a folder table', async () => {
    bucket = [{ key: 'rounds/r1/a.exr', bytes: 10 }, { key: 'rounds/r1/b.exr', bytes: 20 }, { key: 'top.txt', bytes: 1 }, { key: 'rounds/r2/m.ckpt', bytes: 5 }]
    const p = await planOf({ source: B })
    expect(p.source).toMatchObject({ type: 'storage', id: 'panama-s3' }); expect(p.prefix).toBe('')
    expect(p.files).toBe(3); expect(p.excluded_weights).toBe(1)
    expect(p.folders.map((f) => f.name).sort()).toEqual(['(this folder)', 'rounds'])
    const ls = awsCalls.find((a) => a[2] === 's3://bh-exchange/')!; expect(ls).toBeTruthy(); expect(ls).not.toContain('--profile')
    expect(JSON.stringify(p)).not.toContain(BH.secret)
  })
  it("'publish-s3' is the same bucket as 'panama-s3'", async () => {
    bucket = [{ key: 'a.txt', bytes: 3 }]
    const p = await planOf({ source: { type: 'storage', storage_id: 'publish-s3' } }); expect(p.source.id).toBe('panama-s3'); expect(p.files).toBe(1)
  })
  it('a storage source (other than the target) is listed under its directory', async () => {
    bucket = []; target = []
    storage.setAws((async (args: string[]) => {
      awsCalls.push(args); const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!
      const out = m[1] === 'mine-bucket' ? '2026-01-01 10:00:00 12 x/a/1.exr\n2026-01-01 10:00:00 8 x/a/2.exr' : ''
      return { code: out ? 0 : 1, stdout: out, stderr: '' }
    }) as never)
    const p = await planOf({ source: { type: 'storage', storage_id: 'mine' } })
    expect(p).toMatchObject({ files: 2, bytes: 20 }); expect(p.to_copy.files).toBe(2)
  })
  it('no running pod: can_start is false with the plain reason, and a pod resumed later is found', async () => {
    vol = [k('a.exr', 10)]; pods = []
    const p = await planOf()
    expect(p).toMatchObject({ pod: null, can_start: false, reason: 'Needs a running pod to carry it' })
    const { plan_id } = await bs.plan({ source: V, target: { storage_id: 'wasabi' } })
    await new Promise((r) => setTimeout(r, 20)); pods = [POD]
    expect(await bs.start({ plan_id }).then(() => 'started', (e) => e.message)).toBe('started')
  })
  it('run_on picks that pod; a pod that is not running is a plain reason', async () => {
    vol = [k('a.exr', 10)]; pods = [POD, { id: 'podxyz999', name: 'pod-2', host: 'root@5.6.7.8', port: 2222 }]
    expect((await planOf({ run_on: { pod_id: 'podxyz999' } })).pod?.name).toBe('pod-2')
    const p = await planOf({ run_on: { pod_id: 'gonegone1' } }); expect(p.pod).toBeNull(); expect(p.reason).toMatch(/not running/)
  })
  it('refuses source == target, BH as a target, a missing storage and bad prefixes', async () => {
    await expect(bs.plan({ source: { type: 'storage', storage_id: 'wasabi' }, target: { storage_id: 'wasabi' } })).rejects.toThrow(/both From and To/)
    await expect(bs.plan({ source: V, target: { storage_id: 'panama-s3' } })).rejects.toThrow(/never a target/)
    await expect(bs.plan({ source: V, target: { storage_id: 'publish-s3' } })).rejects.toThrow(/never a target/)
    await expect(bs.plan({ source: V, target: { storage_id: 'nope-x' } })).rejects.toThrow(/no storage/)
    await expect(bs.plan({ source: V, target: { storage_id: 'wasabi' }, prefix: '../x' })).rejects.toThrow(/Not a folder/)
    await expect(bs.plan({ source: V, target: {} as never })).rejects.toThrow(/target.storage_id/)
  })
  it('a BH source is refused when the Panama switch is off', async () => {
    await storage.setEnabled('panama-s3', false)
    await expect(bs.plan({ source: B, target: { storage_id: 'wasabi' } })).rejects.toThrow(/Panama S3 adapter is off/)
  })
  it('BH with only an AWS profile lists with the profile but cannot start: needs the Panama keys', async () => {
    delete process.env.PANAMA_AWS_ACCESS_KEY_ID; delete process.env.PANAMA_AWS_SECRET_ACCESS_KEY
    bucket = [{ key: 'a.txt', bytes: 3 }]
    const p = await planOf({ source: B })
    expect(p).toMatchObject({ can_start: false, reason: 'Needs the Panama keys saved in the app' }); expect(awsCalls.some((a) => a.includes('--profile'))).toBe(true)
    await expect(bs.start({ plan_id: p.plan_id })).rejects.toThrow(/Panama keys/)
  })
  it('a failed listing fails the plan without a key in the error; Cancel stops one that is listing', async () => {
    vol = [k('a', 1)]; storage.setAws((async () => ({ code: 255, stdout: '', stderr: `denied for ${KEY.access_key_id}` })) as never)
    const { plan_id } = await bs.plan({ source: V, target: { storage_id: 'wasabi' } }); await new Promise((r) => setTimeout(r, 30))
    const s = await bs.planStatus(plan_id); expect(s.state).toBe('failed'); expect(s.error).not.toContain(KEY.access_key_id)
    publish.setDeps({ volumeKeys: (() => new Promise(() => undefined)) as never })
    const q = await bs.plan({ source: V, target: { storage_id: 'wasabi' } }); expect((await bs.cancelPlan(q.plan_id)).state).toBe('cancelled')
  })
})

describe('bucket sync job', () => {
  it('a volume file: the pod script has the GET host and path of the volume and the PUT host of the target; nothing secret in ssh args, result or History', async () => {
    vol = [k('a/1.exr', 10), k('a/2.exr', 20)]; target = [{ key: 'lt/a/1.exr', bytes: 10 }]
    const p = await planOf()
    const j = await waitJob((await bs.start({ plan_id: p.plan_id, approved_by: 'Lucas' })).job_id)
    expect(j).toMatchObject({ kind: 'bucket-sync', state: 'done', files_total: 2, files_done: 1, files_skipped: 1, files_failed: 0, bytes_total: 20, bytes_done: 20, pod: { id: 'podabc123', name: 'pod-1' }, target: { storage_id: 'wasabi', name: 'Wasabi' } })
    const [c] = copies(); expect(copies()).toHaveLength(1)
    expect(c.host).toBe('root@1.2.3.4'); expect(c.port).toBe(22)
    expect(c.script).toContain('https://s3api-eu-ro-1.runpod.io/volbucket/comfy-shared/output/a/2.exr'); expect(c.script).toContain('header = "authorization: AWS4-HMAC-SHA256 Credential=RPKEYID')
    expect(c.script).toContain('https://s3.ap-southeast-1.wasabisys.com/b-bucket/lt/a/2.exr?'); expect(c.script).toContain('X-Amz-Algorithm')
    expect(c.script).toContain('-H "Content-Length: 20"'); expect(c.script).toMatch(/set -o pipefail/); expect(c.script).toMatch(/-K <\(bucket_get_cfg\) \| curl/)
    expect(c.script).not.toContain(KEY.secret_access_key); expect(c.script).not.toContain(RP.secret)
    expect(`${c.host} ${c.port}`).not.toMatch(/https|Signature|Amz|secret/)
    expect(JSON.stringify(j)).not.toMatch(/X-Amz|secret|https:/)
  })
  it('a BH object is read through a presigned GET on the Panama bucket (path style) and put to the target', async () => {
    bucket = [{ key: 'rounds/r1/a.exr', bytes: 10 }]
    const p = await planOf({ source: B, target: { storage_id: 'mine' } })
    const j = await waitJob((await bs.start({ plan_id: p.plan_id })).job_id)
    expect(j.state).toBe('done'); expect(j.source).toMatchObject({ id: 'panama-s3' })
    const [c] = copies()
    expect(c.script).toMatch(/url = "https:\/\/s3\.[\w-]+\.amazonaws\.com\/bh-exchange\/rounds\/r1\/a\.exr\?X-Amz-Algorithm=/)
    expect(c.script).toContain('url = "https://s3.mine.example.com/mine-bucket/x/rounds/r1/a.exr?')
    expect(c.script).not.toContain(BH.secret); expect(c.script).not.toContain(OWN.secret_access_key)
  })
  it('one failed file is a warning and the rest continue; Retry sends only the failed one; no key in warnings or History', async () => {
    vol = [k('a.exr', 1), k('bad.exr', 2), k('c.exr', 3)]
    const p = await planOf(); failOn = /bad\.exr/
    const j = await waitJob((await bs.start({ plan_id: p.plan_id })).job_id)
    expect(j).toMatchObject({ state: 'done_with_warning', files_done: 2, files_failed: 1 }); expect(j.warnings[0]).toMatch(/^bad\.exr: /); expect(JSON.stringify(j)).not.toContain(KEY.secret_access_key)
    jobs = []; failOn = null
    const r = await waitJob((await bs.retry(j.job_id)).job_id)
    expect(copies()).toHaveLength(1); expect(copies()[0].script).toContain('bad.exr'); expect(r).toMatchObject({ state: 'done', files_total: 1, files_done: 1 })
    await expect(bs.retry(r.job_id)).rejects.toThrow(/no failed files/)
  })
  it('a file over 5 GB is a named warning, not a copy', async () => {
    vol = [k('big.mov', 6 * 1024 ** 3), k('s.mov', 4)]
    const j = await waitJob((await bs.start({ plan_id: (await planOf()).plan_id })).job_id)
    expect(j.state).toBe('done_with_warning'); expect(j.warnings.join()).toMatch(/big\.mov.*over 5 GB/); expect(copies()).toHaveLength(1)
  })
  it('Cancel stops the job promptly, kills the remote curl, and sends no more', async () => {
    vol = Array.from({ length: 30 }, (_, i) => k(`f${i}.exr`, 1)); let release!: () => void; gate = new Promise<void>((r) => { release = r })
    const { job_id } = await bs.start({ plan_id: (await planOf()).plan_id })
    await new Promise((r) => setTimeout(r, 20))
    const c = await bs.cancel(job_id)
    expect(c.state).toBe('cancelled'); expect(copies().length).toBeLessThanOrEqual(3); expect(c.finished_at).toBeTruthy(); release()
    expect(jobs.some((x) => /^pkill -TERM -P 4242/.test(x.script))).toBe(true)
  })
  it('five failures in a row stop the job as failed and Retry has the rest', async () => {
    vol = Array.from({ length: 12 }, (_, i) => k(`f${i}.exr`, 1)); failOn = /./
    bs.setDeps({ workers: 1 })
    const j = await waitJob((await bs.start({ plan_id: (await planOf()).plan_id })).job_id)
    expect(j.state).toBe('failed'); expect(j.files_failed).toBe(12); expect(j.error).toMatch(/in a row/)
  })
  it('the same plan run again does not resend what went; no pod at Start is refused plainly', async () => {
    vol = [k('a', 1), k('b', 2)]; const p = await planOf()
    await waitJob((await bs.start({ plan_id: p.plan_id })).job_id)
    await expect(bs.start({ plan_id: p.plan_id })).rejects.toThrow(/already in the storage/)
    vol = [k('c', 1)]; const q = await planOf(); pods = []
    await expect(bs.start({ plan_id: q.plan_id })).rejects.toThrow(/Needs a running pod/)
    await expect(bs.start({ plan_id: 'zzz' })).rejects.toThrow(/No such plan/)
  })
  it('streamScript puts both links only in stdin text, refuses odd links, and has no link on a curl command line', () => {
    const s = bs.streamScript({ url: 'https://h.example/b/k?X=1', headers: ['authorization: AWS4 Credential=A/b, Signature=cc'] }, 'https://p.example/b/k2?X=2', 5)
    for (const line of s.split('\n').filter((l) => /^curl /.test(l))) expect(line).not.toMatch(/https?:\/\//)
    expect(() => bs.streamScript({ url: 'https://h.example/b/k"x', headers: [] }, 'https://p.example/b/k', 1)).toThrow(/looks wrong/)
    expect(() => bs.streamScript({ url: 'https://h.example/b/k', headers: ['x: a"b'] }, 'https://p.example/b/k', 1)).toThrow(/looks wrong/)
  })
})
