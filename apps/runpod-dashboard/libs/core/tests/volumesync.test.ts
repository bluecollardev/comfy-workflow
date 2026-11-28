import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as storage from '../src/storage.js'
import * as publish from '../src/publish.js'
import * as vs from '../src/volumesync.js'

// Sync To Storage (docs/ADR-066): fakes only. No S3, no ssh, no RunPod.
let dir = ''
const KEY = { access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }
const POD = { id: 'podabc123', name: 'pod-1', host: 'root@1.2.3.4', port: 22 }
const P = 'comfy-shared/output/'
const k = (rel: string, bytes: number) => ({ key: `${P}${rel}`, bytes })
let keys: { key: string; bytes: number }[] = [], pods: unknown[] = [POD], scripts: string[] = [], failOn: RegExp | null = null, gate: Promise<void> | null = null, there = ''

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vsync-')); process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json'); process.env.POD_MANAGER_CONFIG_DIR = dir; process.env.VOLUME_SYNC_JOBS_FILE = join(dir, 'vs.json')
  await storage.save({ id: 'wasabi', bucket: 'b-bucket', region: 'ap-southeast-1', prefix: 'lt', ...KEY })
  keys = []; pods = [POD]; scripts = []; failOn = null; gate = null; there = ''
  publish.setDeps({
    volumeKeys: (async () => keys) as never, podsOnVolume: (async () => pods) as never,
    ssh: (async (o: { script: string; signal?: AbortSignal; onLine: (l: string) => void }) => {
      scripts.push(o.script)
      if (gate) await Promise.race([gate, new Promise((r) => o.signal?.addEventListener('abort', r))])
      if (o.signal?.aborted) throw new Error('aborted')
      if (failOn?.test(o.script)) { o.onLine('PUBLISH-FAIL curl exit 22'); return { code: 22 } }
      o.onLine(`PUBLISH-SHA ${'a'.repeat(64)}`); o.onLine('PUBLISH-OK'); return { code: 0 }
    }) as never,
  })
  storage.setAws((async () => ({ code: there ? 0 : 1, stdout: there, stderr: '' })) as never)
  vs.setDeps({ podPrice: async () => 0.5 })
})
afterEach(() => { vs.reset(); publish.setDeps(null); storage.setAws(null); delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.VOLUME_SYNC_JOBS_FILE; rmSync(dir, { recursive: true, force: true }) })

const planOf = async (req: Partial<vs.Req> = {}) => {
  const { plan_id } = await vs.plan({ volume_id: 'vol1', storage_id: 'wasabi', ...req })
  for (let i = 0; i < 200; i++) { const s = await vs.planStatus(plan_id); if (s.state !== 'listing') { expect(s.state, s.error).toBe('done'); return s.plan! } await new Promise((r) => setTimeout(r, 5)) }
  throw new Error('plan did not finish')
}
const waitJob = async (id: string) => { for (let i = 0; i < 400; i++) { const j = (await vs.status(id)).jobs[0]; if (j.state !== 'uploading') return j; await new Promise((r) => setTimeout(r, 5)) } throw new Error('job did not finish') }

describe('volume sync plan', () => {
  it('counts files, already there, weights, too big, folders and the estimate', async () => {
    keys = [k('a/1.exr', 11_000_000), k('a/2.exr', 11_000_000), k('b/x.mov', 22_000_000), k('top.txt', 5), k('w/model.safetensors', 99), k('b/huge.mov', 6 * 1024 ** 3), k('.previews/p.jpg', 7), k('a/', 0)]
    there = `2026-01-01 10:00:00   11000000 lt/a/1.exr\n2026-01-01 10:00:00   3 lt/a/2.exr\n`   // 1.exr same size, 2.exr other size
    const p = await planOf({ skip_folders: ['.previews'] })
    expect(p).toMatchObject({ volume_id: 'vol1', storage_id: 'wasabi', prefix: P, excluded_weights: 1, storage: { name: 'Wasabi', bucket: 'b-bucket', prefix: 'lt/', region: 'ap-southeast-1' } })
    expect(p.files).toBe(5)   // all but the weight, the folder marker and the skipped folder
    expect(p.already_there).toEqual({ files: 1, bytes: 11_000_000 })
    expect(p.too_big).toEqual({ files: 1, names: ['b/huge.mov'] })
    expect(p.to_copy).toEqual({ files: 3, bytes: 11_000_000 + 22_000_000 + 5 })
    expect(p.folders.find((f) => f.name === '.previews')).toMatchObject({ files: 1, skipped: true })
    expect(p.folders.map((f) => f.name)).toEqual(['(this folder)', '.previews', 'a', 'b'].sort((x, y) => x.localeCompare(y)))
    expect(p.pod).toEqual({ id: 'podabc123', name: 'pod-1', cost_per_hr: 0.5 })
    expect(p.can_start).toBe(true)
    expect(p.estimate.rate_mb_s).toBe(11); expect(p.estimate.hours).toBeCloseTo(33_000_005 / 11e6 / 3600, 2); expect(p.estimate.usd).toBeCloseTo(p.estimate.hours * 0.5, 2)
    expect(JSON.stringify(p)).not.toContain(KEY.secret_access_key)
  })
  it('no running pod: can_start is false with a plain reason, and a pod resumed later is found', async () => {
    keys = [k('a.exr', 10)]; pods = []
    const p = await planOf()
    expect(p).toMatchObject({ pod: null, can_start: false }); expect(p.reason).toMatch(/No pod is running/)
    const { plan_id } = await vs.plan({ volume_id: 'vol1', storage_id: 'wasabi' })
    await new Promise((r) => setTimeout(r, 20)); pods = [POD]
    expect(await vs.start({ plan_id }).then(() => 'started', (e) => e.message)).toBe('started')
  })
  it('refuses the publish destination, a missing storage and bad prefixes', async () => {
    await expect(vs.plan({ volume_id: 'v', storage_id: 'publish-s3' })).rejects.toThrow(/cannot be the target/)
    await expect(vs.plan({ volume_id: 'v', storage_id: 'nope-x' })).rejects.toThrow(/no storage/)
    await expect(vs.plan({ volume_id: 'v', storage_id: 'wasabi', prefix: '../x' })).rejects.toThrow(/Not a folder/)
  })
  it('a failed storage listing fails the plan without a key in the error', async () => {
    keys = [k('a', 1)]; storage.setAws((async () => ({ code: 255, stdout: '', stderr: `denied for ${KEY.access_key_id}` })) as never)
    const { plan_id } = await vs.plan({ volume_id: 'vol1', storage_id: 'wasabi' })
    await new Promise((r) => setTimeout(r, 30))
    const s = await vs.planStatus(plan_id); expect(s.state).toBe('failed'); expect(s.error).not.toContain(KEY.access_key_id)
  })
  it('Cancel stops a plan that is still listing', async () => {
    publish.setDeps({ volumeKeys: (() => new Promise(() => undefined)) as never })
    const { plan_id } = await vs.plan({ volume_id: 'vol1', storage_id: 'wasabi' })
    expect((await vs.cancelPlan(plan_id)).state).toBe('cancelled')
  })
})

describe('volume sync job', () => {
  it('uploads through signed links (the pod path in the script, no secret), skips same-size files, ends done', async () => {
    keys = [k('a/1.exr', 10), k('a/2.exr', 20)]; there = '2026-01-01 10:00:00   10 lt/a/1.exr\n'
    const p = await planOf()
    const { job_id } = await vs.start({ plan_id: p.plan_id, approved_by: 'Lucas' })
    const j = await waitJob(job_id)
    expect(j).toMatchObject({ kind: 'volume-sync', state: 'done', files_total: 2, files_done: 1, files_skipped: 1, files_failed: 0, bytes_total: 20, bytes_done: 20, storage_name: 'Wasabi' })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain('/workspace/comfy-shared/output/a/2.exr'); expect(scripts[0]).toContain('s3.ap-southeast-1.wasabisys.com/b-bucket/lt/a/2.exr')
    expect(scripts[0]).not.toContain(KEY.secret_access_key); expect(JSON.stringify(j)).not.toMatch(/X-Amz|wasabisecret/)
  })
  it('one failed file is a warning and the rest continue; Retry sends only the failed one', async () => {
    keys = [k('a.exr', 1), k('bad.exr', 2), k('c.exr', 3)]
    const p = await planOf(); failOn = /bad\.exr/
    const j = await waitJob((await vs.start({ plan_id: p.plan_id })).job_id)
    expect(j).toMatchObject({ state: 'done_with_warning', files_done: 2, files_failed: 1 }); expect(j.warnings[0]).toMatch(/^bad\.exr: /)
    scripts = []; failOn = null
    const r = await waitJob((await vs.retry(j.job_id)).job_id)
    expect(scripts).toHaveLength(1); expect(scripts[0]).toContain('bad.exr')
    expect(r).toMatchObject({ state: 'done', files_total: 1, files_done: 1 })
    await expect(vs.retry(r.job_id)).rejects.toThrow(/no failed files/)
  })
  it('a file over 5 GB is a named warning, not an upload', async () => {
    keys = [k('big.mov', 6 * 1024 ** 3), k('s.mov', 4)]
    const j = await waitJob((await vs.start({ plan_id: (await planOf()).plan_id })).job_id)
    expect(j.state).toBe('done_with_warning'); expect(j.warnings.join()).toMatch(/big\.mov.*over 5 GB/); expect(scripts).toHaveLength(1)
  })
  it('Cancel stops the job promptly and nothing more is sent', async () => {
    keys = Array.from({ length: 30 }, (_, i) => k(`f${i}.exr`, 1)); let release!: () => void; gate = new Promise<void>((r) => { release = r })
    const { job_id } = await vs.start({ plan_id: (await planOf()).plan_id })
    await new Promise((r) => setTimeout(r, 20))
    const c = await vs.cancel(job_id)
    expect(c.state).toBe('cancelled'); expect(scripts.length).toBeLessThanOrEqual(3); expect(c.finished_at).toBeTruthy(); release()
  })
  it('the same plan run again does not resend what went', async () => {
    keys = [k('a', 1), k('b', 2)]; const p = await planOf()
    await waitJob((await vs.start({ plan_id: p.plan_id })).job_id)
    await expect(vs.start({ plan_id: p.plan_id })).rejects.toThrow(/already in the storage/)
  })
  it('five failures in a row stop the job as failed and Retry has the rest', async () => {
    keys = Array.from({ length: 12 }, (_, i) => k(`f${i}.exr`, 1)); failOn = /./
    vs.setDeps({ workers: 1 })
    const j = await waitJob((await vs.start({ plan_id: (await planOf()).plan_id })).job_id)
    expect(j.state).toBe('failed'); expect(j.files_failed).toBe(12); expect(j.error).toMatch(/in a row/)
  })
  it('no pod at Start is refused plainly', async () => {
    keys = [k('a', 1)]; const p = await planOf(); pods = []
    await expect(vs.start({ plan_id: p.plan_id })).rejects.toThrow(/No pod is running/)
    await expect(vs.start({ plan_id: 'zzz' })).rejects.toThrow(/No such plan/)
  })
})
