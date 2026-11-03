import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as dry from '../src/dry.js'
import * as gpus from '../src/gpus.js'
import * as idle from '../src/idle.js'
import * as mounts from '../src/mounts.js'
import * as panama from '../src/panama.js'
import * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// The pod download (docs/ADR-022): plan, pull, remove, cancel, the per-volume record, the temporary-pod tag. No real pod, no RunPod, no ssh: a fake RunPod answers the
// GraphQL and REST calls, the log reader and the ssh runner are injected.
const KEY_ID = 'AKIATESTKEYID123', KEY_SECRET = 'sekret-value-do-not-leak'
const ROUND = 'brynley-comfy-2026-10-20'
const [G1, G2] = [gpus.GPUS.l4.id, gpus.GPUS.rtx3090.id]
const SIZE = { files: 1283, bytes: 300_000_000_000 }   // big enough that the idle ceiling (167 min) differs from the configured 30

interface RawPodFake { id: string; name: string; networkVolumeId?: string; costPerHr?: number; machine?: { gpuDisplayName: string }; runtime?: { uptimeInSeconds: number; ports: { ip: string; isIpPublic: boolean; privatePort: number; publicPort: number; type: string }[] } }
const upPod = (id: string, name: string, vol = 'vol1', cost = 0.59): RawPodFake => ({ id, name, networkVolumeId: vol, costPerHr: cost, machine: { gpuDisplayName: 'L4' }, runtime: { uptimeInSeconds: 120, ports: [{ ip: '1.2.3.4', isIpPublic: true, privatePort: 22, publicPort: 2222, type: 'tcp' }] } })

/** A RunPod that answers what the pull code asks, and remembers it. */
function fakeRunPod(initial: RawPodFake[] = [], hooks: { onCreate?: (query: string) => void; terminateFails?: boolean } = {}) {
  const pods = [...initial]
  const calls = { created: [] as string[], terminated: [] as string[], stopped: [] as string[], total: 0 }
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    calls.total++
    const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body })
    if (String(url).includes('/v1/networkvolumes/')) return ok({ id: 'vol1', name: 'comfy-workspace', size: 100, dataCenterId: 'EUR-IS-2' })
    const q = JSON.parse(init?.body || '{}').query as string
    if (q.includes('myPods')) return ok({ data: { myself: { pods } } })
    if (q.includes('query pod {')) { const id = /podId: "([^"]+)"/.exec(q)![1]; return ok({ data: { pod: pods.find((p) => p.id === id) ?? null } }) }
    if (q.includes('gpuTypes')) return ok({ data: { gpuTypes: [{ id: G1, secureCloud: true, communityCloud: false, lowestPrice: { uninterruptablePrice: 0.59, stockStatus: 'Low' } }, { id: G2, secureCloud: true, communityCloud: false, lowestPrice: { uninterruptablePrice: 0.22, stockStatus: 'High' } }] } })
    if (q.includes('dataCenters { id gpuAvailability')) return ok({ data: { dataCenters: [{ id: 'EUR-IS-2', gpuAvailability: [{ available: true, gpuTypeId: G1 }, { available: true, gpuTypeId: G2 }] }] } })
    if (q.includes('podFindAndDeployOnDemand')) {
      hooks.onCreate?.(q); calls.created.push(q)
      const name = /name: "([^"]+)"/.exec(q)![1]
      pods.push(upPod('newpod1', name))
      return ok({ data: { podFindAndDeployOnDemand: { id: 'newpod1' } } })
    }
    if (q.includes('podTerminate')) {
      if (hooks.terminateFails) return ok({ errors: [{ message: 'terminate refused' }] })
      const id = /podId: "([^"]+)"/.exec(q)![1]; calls.terminated.push(id); const i = pods.findIndex((p) => p.id === id); if (i >= 0) pods.splice(i, 1)
      return ok({ data: { podTerminate: null } })
    }
    if (q.includes('podStop')) { calls.stopped.push(/podId: "([^"]+)"/.exec(q)![1]); return ok({ data: {} }) }
    throw new Error('the fake RunPod was asked something unexpected: ' + q.slice(0, 80))
  }) as unknown as typeof fetch
  return { client: { fetchFn, apiKey: 'test' }, pods, calls }
}

const done = async (id: string, ms = 4000) => {
  const t0 = Date.now()
  for (;;) { const j = podpull.job(id)!; if (['done', 'failed', 'cancelled'].includes(j.state) && !podpull.job(id)!.lines.includes('__busy__')) { await new Promise((r) => setTimeout(r, 15)); return podpull.job(id)! } if (Date.now() - t0 > ms) throw new Error('job did not finish: ' + JSON.stringify(j)); await new Promise((r) => setTimeout(r, 5)) }
}
const base = (extra: Partial<podpull.Opts> = {}): podpull.Opts => ({ sizeOf: () => SIZE, pollMs: 5, listRounds: () => [ROUND, 'brynley-inbox-2026-10-28-v001'], ...extra })
const logsOf = (...lines: string[]) => { let n = 0; return async () => (n++ === 0 ? [] : lines.map((line, k) => ({ ts: String(k), line }))) }
const GOOD = [`s3 pull: bh/rounds/${ROUND} -> /workspace/comfy-shared/temp/rounds/${ROUND}`, 'a/b.json: Copied (new)', 'c/d.json: Copied (new)', '2.861 MiB / 2.861 MiB, 100%, 1 MiB/s', `s3 pull done (manifest verified): /workspace/comfy-shared/temp/rounds/${ROUND}`]

let envBackup: Record<string, string | undefined> = {}
const KEYS = ['RUNPOD_API_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'SETTINGS_ENV_FILE', 'PULL_PODS_FILE', 'POD_ROUNDS_FILE', 'PANAMA_S3_REGION']
function configure(over: Partial<mounts.MountsConfig> = {}) {
  const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; cfg.network_volume_id = 'vol1'; cfg.data_center_id = 'EUR-IS-2'; cfg.idle_stop_minutes = 30
  Object.assign(cfg, over); mounts.save(cfg); return cfg
}
beforeEach(() => {
  envBackup = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  const dir = scratch()
  process.env.SETTINGS_ENV_FILE = join(mkdtempSync(join(tmpdir(), 'pp-')), '.env')   // never the developer's own settings
  process.env.RUNPOD_API_KEY = 'test'; process.env.PANAMA_AWS_ACCESS_KEY_ID = KEY_ID; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = KEY_SECRET
  process.env.PULL_PODS_FILE = join(dir, 'pull-pods.json'); process.env.POD_ROUNDS_FILE = join(dir, 'pod-rounds.json'); delete process.env.PANAMA_S3_REGION
  process.env.DRY_PODS_FILE = join(dir, 'dry-pods.json')
  configure()
})
afterEach(() => { for (const k of KEYS) { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k] } delete process.env.DRY_PODS_FILE })

describe('the small rules', () => {
  it('the idle ceiling is the larger of 30 minutes and the size at 30 MB/s; the pod is named for the round and the day', () => {
    expect(podpull.ceilingMinutes(0)).toBe(30)
    expect(podpull.ceilingMinutes(39e9)).toBe(30)             // about 22 minutes at 30 MB/s: the floor wins
    expect(podpull.ceilingMinutes(300e9)).toBe(167)           // 300 GB at 30 MB/s is 166.7 minutes
    expect(podpull.podName(ROUND, new Date(2026, 10, 3))).toBe(`ComfyUI-Pull-${ROUND}-1103`)
    expect(podpull.s3PullFor(ROUND)).toBe(`bh-panama-exchange-610140802195/rounds/${ROUND}=/workspace/comfy-shared/temp/rounds/${ROUND}`)
  })
  it('accepts and refuses the same round names as the local pane does (panama.ts)', async () => {
    process.env.PANAMA_ROUNDS_DIR = mkdtempSync(join(tmpdir(), 'rounds-'))
    for (const bad of ['../x', 'a/b', '', '.hidden', '-x', 'x'.repeat(130), 'a b']) {
      await expect(podpull.plan(bad, base())).rejects.toThrow(/Not a round name/)
      expect(() => panama.remove(bad)).toThrow(/Not a round name/)
    }
    for (const good of [ROUND, 'r1.v2_x', 'brynley-inbox-2026-10-28-v001']) {
      expect(() => panama.remove(good)).not.toThrow()
      await podpull.plan(good, base({ client: fakeRunPod().client })).then(() => {}, (e) => expect(String(e.message)).not.toMatch(/Not a round name/))
    }
    delete process.env.PANAMA_ROUNDS_DIR
  })
  it('the ssh arguments say where and how, never what: the script (and a key in it) goes on stdin', () => {
    const args = podpull.sshArgs('root@1.2.3.4', 2222)
    expect(args).toEqual(['-p', '2222', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', 'root@1.2.3.4', 'bash -s'])
    expect(JSON.stringify(args)).not.toContain(KEY_SECRET)
    expect(podpull.pullScript(ROUND, { id: KEY_ID, secret: KEY_SECRET })).toContain(KEY_SECRET)
  })
  it('the scripts: the pull script exports S3_PULL and the key and runs s3pull.sh; the remove script is confined to one folder under the constant root', () => {
    const pull = podpull.pullScript(ROUND, { id: KEY_ID, secret: KEY_SECRET })
    expect(pull).toContain(`export S3_PULL='bh-panama-exchange-610140802195/rounds/${ROUND}=/workspace/comfy-shared/temp/rounds/${ROUND}'`)
    expect(pull).toContain(`export AWS_SECRET_ACCESS_KEY='${KEY_SECRET}'`); expect(pull).toContain('exec /opt/comfy-app/s3pull.sh')
    const rm = podpull.removeScript(ROUND)
    expect(rm).toContain(`d='/workspace/comfy-shared/temp/rounds/${ROUND}'`)
    expect(rm).toContain('case "$d" in /workspace/comfy-shared/temp/rounds/?*)')
    expect(rm).not.toContain(KEY_SECRET)
    expect(() => podpull.removeScript('../../etc')).toThrow(/Not a round name/)
    expect(() => podpull.pullScript("x'; rm -rf /; echo '", { id: 'a', secret: 'b' })).toThrow(/Not a round name/)
  })
})

describe('availability', () => {
  it('says plainly why not, in a sentence, and reports yes with the volume when everything is set', () => {
    configure({ network_volume_id: '' })
    expect(podpull.capability()).toMatchObject({ available: false, volume: null }); expect(podpull.capability().reason).toMatch(/network volume.*\.$/)
    configure(); delete process.env.RUNPOD_API_KEY
    expect(podpull.capability().reason).toMatch(/RunPod API key.*\.$/)
    process.env.RUNPOD_API_KEY = 'test'; delete process.env.PANAMA_AWS_ACCESS_KEY_ID
    expect(podpull.capability().reason).toMatch(/Panama bucket keys.*\.$/)
    process.env.PANAMA_AWS_ACCESS_KEY_ID = KEY_ID
    expect(podpull.capability()).toMatchObject({ available: true, reason: '', volume: { id: 'vol1' } })
  })
  it('is what panama.status() reports under `pod`', () => {
    expect(panama.status().pod).toEqual(podpull.capability())
  })
})

describe('plan: which route', () => {
  it('temporary when no pod of yours runs on the volume: the cheapest card in stock there, its price, the size, the ceiling', async () => {
    const p = await podpull.plan(ROUND, base({ client: fakeRunPod().client }))
    expect(p).toMatchObject({ round: ROUND, route: 'temporary', pod: null, gpu: 'rtx3090', price_per_hour: 0.22, bytes: SIZE.bytes, idle_stop_minutes: 30, ceiling_minutes: 167, files: SIZE.files })
    expect(p.volume).toEqual({ id: 'vol1', name: 'comfy-workspace', datacenter: 'EUR-IS-2' })
  })
  it('active when a pod of yours runs on that volume and has a public SSH port; our own pull pods, other volumes and pods without SSH do not count', async () => {
    const noSsh = { ...upPod('nossh', 'NoSsh'), runtime: { uptimeInSeconds: 50, ports: [] } }
    const rp = fakeRunPod([upPod('other', 'OtherVolume', 'vol9'), upPod('puller', `${podpull.POD_PREFIX}x-1103`), noSsh])
    expect((await podpull.plan(ROUND, base({ client: rp.client }))).route).toBe('temporary')
    rp.pods.push(upPod('mine', 'ComfyUI-Dev', 'vol1', 0.34))
    const p = await podpull.plan(ROUND, base({ client: rp.client }))
    expect(p).toMatchObject({ route: 'active', pod: { id: 'mine', name: 'ComfyUI-Dev', price_per_hour: 0.34 }, price_per_hour: 0.34, bytes: SIZE.bytes })
  })
  it('refuses with the capability reason when a pod cannot be used', async () => {
    configure({ network_volume_id: '' })
    await expect(podpull.plan(ROUND, base())).rejects.toThrow(/network volume/)
  })
})

describe('a temporary pod pull', () => {
  it('creates a named pod on the volume with S3_PULL and the keys in ITS environment, holds the idle timer at the ceiling, reads the verdict, deletes the pod and forgets the tag', async () => {
    let tagBeforeCreate: podpull.TempPod[] = []
    let idleDuring: number | undefined
    const rp = fakeRunPod([], { onCreate: () => { tagBeforeCreate = podpull.temporaryPods() } })
    const lines = logsOf(...GOOD)
    const job0 = await podpull.pull(ROUND, base({ client: rp.client, logs: async (id) => { idleDuring ??= idle.entry(id)?.minutes; return lines() } }))
    expect(job0).toMatchObject({ kind: 'pull', route: 'temporary', state: 'creating', pod_name: podpull.podName(ROUND) })   // a pod job has its route and pod name from the start
    const job = await done(job0.id)
    expect(job).toMatchObject({ state: 'done', kind: 'pull', route: 'temporary', pod_id: 'newpod1', pod_name: podpull.podName(ROUND), files: 2 })
    expect(job.verify).toMatchObject({ ok: true })
    // the tag was on disk, without a pod id, before the pod was created; it is gone after
    expect(tagBeforeCreate).toEqual([expect.objectContaining({ round: ROUND, kind: 'pull', name: podpull.podName(ROUND), pod_id: null, approved_by: 'Lucas', volume: 'vol1' })])
    expect(podpull.temporaryPods()).toEqual([])
    // the pod: network volume, name, the one round, the app's idle ceiling while it ran
    const q = rp.calls.created[0]
    expect(q).toContain(`name: "${podpull.podName(ROUND)}"`); expect(q).toContain('networkVolumeId: "vol1"')
    expect(q).toContain(`{ key: "S3_PULL", value: "${podpull.s3PullFor(ROUND)}" }`)
    expect(q).toContain(KEY_ID); expect(q).toContain(KEY_SECRET)   // the pod's own environment carries the key (mounts.podOverrides adds it)
    expect(idleDuring).toBe(167)
    expect(rp.calls.terminated).toEqual(['newpod1']); expect(idle.entry('newpod1')).toBeUndefined()
    // the key is nowhere a caller can see
    expect(JSON.stringify(job)).not.toContain(KEY_SECRET); expect(JSON.stringify(job)).not.toContain(KEY_ID)
    // what the volume now holds is remembered, with when it was learned
    const r = await podpull.rounds(base({ client: rp.client }))
    expect(r.volume).toEqual({ id: 'vol1', name: 'comfy-workspace', datacenter: 'EUR-IS-2' }); expect(r.as_of).toMatch(/^\d{4}-/)
    expect(r.rounds.find((x) => x.name === ROUND)).toEqual({ name: ROUND, staged: true, state: 'complete', present: 1283, expected: 1283, missing: 0, bytes: SIZE.bytes })
    expect(r.rounds.find((x) => x.name === 'brynley-inbox-2026-10-28-v001')).toMatchObject({ staged: false, state: 'none', present: 0 })
  })

  it('maps each way s3pull.sh can end to a state, a verdict and what is remembered; the pod is deleted every time', async () => {
    const cases: [string, string[], Partial<podpull.PodJob>, (r: { state: string; present: number; expected: number | null; missing: number | null } | undefined) => void][] = [
      ['manifest check failed', [GOOD[0], 'a: Copied (new)', `s3 pull FAILED the manifest check: /workspace/comfy-shared/temp/rounds/${ROUND}`, 'SHA256   shot/b.txt', '2 listed, 1 bad, 0 on disk but not listed', 'FAIL'], { state: 'failed' },
        (r) => expect(r).toMatchObject({ state: 'partial', present: 1, expected: 2, missing: 1 })],
      ['no manifest to check', [GOOD[0], 'a: Copied (new)', `s3 pull done, NOT verified (no MANIFEST.json): /workspace/comfy-shared/temp/rounds/${ROUND}`], { state: 'failed' }, (r) => expect(r).toMatchObject({ state: 'unverified' })],
      ['the copy itself failed', [GOOD[0], `s3 pull FAILED: bh/rounds/${ROUND} (rclone exit 1); run it again, a rerun carries on`], { state: 'failed' }, (r) => expect(r).toBeUndefined()],
    ]
    for (const [label, lines, want, check] of cases) {
      const rp = fakeRunPod()
      const job = await done((await podpull.pull(ROUND, base({ client: rp.client, logs: logsOf(...lines) }))).id)
      expect(job.state, label).toBe(want.state)
      expect(job.error, label).toBeTruthy()
      expect(rp.calls.terminated, label).toEqual(['newpod1'])
      expect(podpull.temporaryPods(), label).toEqual([])
      const rec = (await podpull.rounds(base({ client: rp.client }))).rounds.find((x) => x.name === ROUND)
      check(rec && rec.state !== 'none' ? rec : undefined)
      process.env.POD_ROUNDS_FILE = join(mkdtempSync(join(tmpdir(), 'pr-')), 'r.json')   // each case starts with nothing known
    }
    // and the check failure carries the list
    const rp = fakeRunPod()
    const job = await done((await podpull.pull(ROUND, base({ client: rp.client, logs: logsOf(...cases[0][1]) }))).id)
    expect(job.verify).toMatchObject({ ok: false, listed: 2, bad: ['SHA256   shot/b.txt'] }); expect(job.error).toContain('SHA256   shot/b.txt')
  })

  it('cancel: the job turns cancelled at once, the pod is deleted, the tag goes, and cancelled is not overwritten', async () => {
    const rp = fakeRunPod()
    const job0 = await podpull.pull(ROUND, base({ client: rp.client, logs: async () => [{ ts: '1', line: GOOD[0] }, { ts: '2', line: 'a: Copied (new)' }] }))
    while (!rp.calls.created.length) await new Promise((r) => setTimeout(r, 5))
    await new Promise((r) => setTimeout(r, 40))
    expect(podpull.cancel(job0.id).state).toBe('cancelled')
    const job = await done(job0.id)
    expect(job.state).toBe('cancelled')
    await new Promise((r) => setTimeout(r, 30))
    expect(rp.calls.terminated).toEqual(['newpod1']); expect(podpull.temporaryPods()).toEqual([])
    expect(podpull.cancel(job0.id).state).toBe('cancelled')   // cancelling a finished job changes nothing
    expect(() => podpull.cancel('nope')).toThrow(/No pod job/)
  })

  it('one job per round: a second pull returns the running one; a delete of that round is refused while it runs', async () => {
    const rp = fakeRunPod()
    const a = await podpull.pull(ROUND, base({ client: rp.client, logs: async () => [] }))
    const b = await podpull.pull(ROUND, base({ client: rp.client, logs: async () => [] }))
    expect(b.id).toBe(a.id)
    await expect(podpull.remove(ROUND, base({ client: rp.client }))).rejects.toThrow(/busy/)
    podpull.cancel(a.id); await done(a.id); await new Promise((r) => setTimeout(r, 30))
    const c = await podpull.pull(ROUND, base({ client: fakeRunPod().client, logs: logsOf(...GOOD) }))   // free again
    expect(c.id).not.toBe(a.id); await done(c.id)
  })

  it('a pod that cannot be deleted says so on the job and is left to its idle timer', async () => {
    const rp = fakeRunPod([], { terminateFails: true })
    const job = await done((await podpull.pull(ROUND, base({ client: rp.client, logs: logsOf(...GOOD) }))).id)
    expect(job.state).toBe('done')
    expect(job.error).toContain(podpull.podName(ROUND)); expect(job.lines.join('\n')).toContain('Could not delete pod newpod1')
    expect(idle.entry('newpod1')?.minutes).toBe(167)   // the ceiling stays as the backstop
  })
})

describe('pulling on a pod you already run', () => {
  const run = async (script: (call: podpull.SshJob, n: number) => Promise<{ code: number | null }>, prevIdle = 0) => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')])
    if (prevIdle) idle.register('mine', prevIdle)
    const calls: podpull.SshJob[] = []; let idleDuring: number | undefined
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); if (calls.length === 1) idleDuring = idle.entry('mine')?.minutes; return script(j, calls.length) }
    const job0 = await podpull.pull(ROUND, base({ client: rp.client, ssh }))
    return { rp, calls, job0, job: await done(job0.id), idleDuring: () => idleDuring }
  }

  it('runs s3pull.sh over ssh with the keys on stdin only, holds the idle timer at the ceiling and puts the old value back, and never touches the pod itself', async () => {
    const r = await run(async (j) => { for (const l of GOOD) j.onLine(l); return { code: 0 } }, 45)
    expect(r.job0).toMatchObject({ route: 'active', pod_id: 'mine', pod_name: 'ComfyUI-Dev' })
    expect(r.job).toMatchObject({ state: 'done', route: 'active', pod_name: 'ComfyUI-Dev', files: 2 })
    expect(r.calls[0]).toMatchObject({ host: 'root@1.2.3.4', port: 2222 })
    expect(r.calls[0].script).toContain(`export S3_PULL='${podpull.s3PullFor(ROUND)}'`); expect(r.calls[0].script).toContain(KEY_SECRET)
    expect(JSON.stringify({ host: r.calls[0].host, port: r.calls[0].port })).not.toContain(KEY_SECRET)   // the arguments the real runner builds are host and port only
    expect(r.idleDuring()).toBe(167); expect(idle.entry('mine')?.minutes).toBe(45)
    expect(r.rp.calls.terminated).toEqual([]); expect(r.rp.calls.stopped).toEqual([]); expect(r.rp.calls.created).toEqual([])
    expect(JSON.stringify(r.job)).not.toContain(KEY_SECRET)
  })
  it('a pod with no idle timer before has none after', async () => {
    await run(async (j) => { for (const l of GOOD) j.onLine(l); return { code: 0 } })
    expect(idle.entry('mine')).toBeUndefined()
  })
  it('scrubs the key from anything the pod prints', async () => {
    const r = await run(async (j) => { j.onLine(`debug ${KEY_SECRET} ${KEY_ID}`); for (const l of GOOD) j.onLine(l); return { code: 0 } })
    expect(r.job.lines.join('\n')).not.toContain(KEY_SECRET); expect(r.job.lines.join('\n')).not.toContain(KEY_ID); expect(r.job.lines.join('\n')).toContain('***')
  })
  it('exit 255 is "could not reach the pod over SSH", 127 is "older image without s3pull.sh"; the old idle value comes back either way', async () => {
    const a = await run(async () => ({ code: 255 }), 45)
    expect(a.job.state).toBe('failed'); expect(a.job.error).toMatch(/over SSH.*SSH public key/); expect(idle.entry('mine')?.minutes).toBe(45)
    const b = await run(async () => ({ code: 127 }))
    expect(b.job.error).toMatch(/older image without .*s3pull\.sh/)
  })
  it('cancel cuts the ssh session and sends a second command that stops rclone, without any key', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')])
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = (j) => new Promise((res) => { calls.push(j); if (calls.length === 1) j.signal.addEventListener('abort', () => res({ code: null })); else res({ code: 0 }) })
    const job0 = await podpull.pull(ROUND, base({ client: rp.client, ssh }))
    while (!calls.length) await new Promise((r) => setTimeout(r, 5))
    podpull.cancel(job0.id)
    const job = await done(job0.id); await new Promise((r) => setTimeout(r, 20))
    expect(job.state).toBe('cancelled'); expect(calls[0].signal.aborted).toBe(true)
    expect(calls[1].script).toContain('pkill'); expect(calls[1].script).not.toContain(KEY_SECRET)
    expect(rp.calls.terminated).toEqual([])
  })
})

describe('delete from the volume', () => {
  it('on your pod: runs the confined remove script over ssh, answers `remove`, forgets the round', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')])
    podpull.recordState('vol1', ROUND, { state: 'complete', present: 5, expected: 5, missing: 0, bytes: 10 })
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine(`removed /workspace/comfy-shared/temp/rounds/${ROUND}`); return { code: 0 } }
    const job0 = await podpull.remove(ROUND, base({ client: rp.client, ssh }))
    expect(job0).toMatchObject({ kind: 'remove', route: 'active', pod_name: 'ComfyUI-Dev' })
    const job = await done(job0.id)
    expect(job).toMatchObject({ kind: 'remove', state: 'done' })
    expect(calls[0].script).toContain(`d='/workspace/comfy-shared/temp/rounds/${ROUND}'`); expect(calls[0].script).not.toContain(KEY_SECRET)
    expect((await podpull.rounds(base({ client: rp.client }))).rounds.find((x) => x.name === ROUND)).toMatchObject({ state: 'none', present: 0 })
  })
  it('with no pod running: a short-lived pod with no S3_PULL and no key, ssh into it, then it is deleted', async () => {
    const rp = fakeRunPod()
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine('nothing to remove at x'); return { code: 0 } }
    const job0 = await podpull.remove(ROUND, base({ client: rp.client, ssh }))
    expect(job0).toMatchObject({ kind: 'remove', route: 'temporary', pod_name: podpull.podName(ROUND) })
    const job = await done(job0.id)
    expect(job.state).toBe('done'); expect(calls).toHaveLength(1)
    expect(rp.calls.created[0]).not.toContain('S3_PULL'); expect(rp.calls.created[0]).not.toContain(KEY_SECRET)
    expect(rp.calls.terminated).toEqual(['newpod1']); expect(podpull.temporaryPods()).toEqual([])
  })
  it('refuses a name that is not one folder, before anything runs', async () => {
    const rp = fakeRunPod()
    for (const bad of ['../x', 'a/b', '', '..']) await expect(podpull.remove(bad, base({ client: rp.client }))).rejects.toThrow(/Not a round name/)
    expect(rp.calls.total).toBe(0)
  })
})

describe('what the volume holds', () => {
  it('lists the bucket rounds with what the last job learned, and a null volume when none is configured', async () => {
    const none = await podpull.rounds(base({ client: fakeRunPod().client }))
    expect(none.as_of).toBeNull(); expect(none.rounds.map((r) => r.state)).toEqual(['none', 'none'])
    configure({ network_volume_id: '' })
    expect((await podpull.rounds(base())).volume).toBeNull()
  })
})

describe('no-spend mode simulates the whole job', () => {
  beforeEach(() => { configure({ dry_run: true }); dry.clear() })
  it('pulls and deletes on a timer with no RunPod call, a simulated pod in the list while it lasts, and a record kept apart from the real volume', async () => {
    const rp = fakeRunPod()
    expect((await podpull.plan(ROUND, base({ client: rp.client }))).route).toBe('temporary')
    const job0 = await podpull.pull(ROUND, base({ client: rp.client }))
    const job = await done(job0.id, 6000)
    expect(job).toMatchObject({ state: 'done', route: 'temporary', kind: 'pull' }); expect(job.verify?.ok).toBe(true)
    expect(rp.calls.total).toBe(0)
    expect(dry.list()).toEqual([])   // created and deleted again
    const rm = await done((await podpull.remove(ROUND, base({ client: rp.client }))).id, 6000)
    expect(rm).toMatchObject({ kind: 'remove', state: 'done' }); expect(rp.calls.total).toBe(0)
  })
})
