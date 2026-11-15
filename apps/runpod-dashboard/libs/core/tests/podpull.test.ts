import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as dry from '../src/dry.js'
import * as gpus from '../src/gpus.js'
import * as history from '../src/history.js'
import * as idle from '../src/idle.js'
import * as mounts from '../src/mounts.js'
import * as panama from '../src/panama.js'
import * as pods from '../src/pods.js'
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
function fakeRunPod(initial: RawPodFake[] = [], hooks: { volumeDc?: string; volumes?: Record<string, { name: string; dc: string }>; onCreate?: (query: string) => void; terminateFails?: boolean; gpuTypes?: { id: string; displayName?: string; memoryInGb?: number; price: number | null; stock: string | null }[] } = {}) {
  const pods = [...initial]
  const calls = { created: [] as string[], terminated: [] as string[], stopped: [] as string[], total: 0 }
  const fetchFn = (async (url: string, init?: { body?: string }) => {
    calls.total++
    const ok = (body: unknown) => ({ status: 200, ok: true, json: async () => body })
    if (String(url).includes('/v1/networkvolumes/')) { const vid = decodeURIComponent(String(url).split('/networkvolumes/')[1] || 'vol1'); const sp = hooks.volumes?.[vid]; return ok({ id: vid, name: sp?.name ?? 'comfy-workspace', size: 100, dataCenterId: sp?.dc ?? hooks.volumeDc ?? 'EUR-IS-2' }) }
    const q = JSON.parse(init?.body || '{}').query as string
    if (q.includes('myPods')) return ok({ data: { myself: { pods } } })
    if (q.includes('query pod {')) { const id = /podId: "([^"]+)"/.exec(q)![1]; return ok({ data: { pod: pods.find((p) => p.id === id) ?? null } }) }
    if (q.includes('gpuTypes') && hooks.gpuTypes) return ok({ data: { gpuTypes: hooks.gpuTypes.map((g) => ({ id: g.id, displayName: g.displayName ?? g.id, memoryInGb: g.memoryInGb ?? 24, secureCloud: true, communityCloud: false, lowestPrice: { uninterruptablePrice: g.price, stockStatus: g.stock } })) } })
    if (q.includes('gpuTypes')) return ok({ data: { gpuTypes: [{ id: G1, secureCloud: true, communityCloud: false, lowestPrice: { uninterruptablePrice: 0.59, stockStatus: 'Low' } }, { id: G2, secureCloud: true, communityCloud: false, lowestPrice: { uninterruptablePrice: 0.22, stockStatus: 'High' } }] } })
    if (q.includes('dataCenters { id gpuAvailability')) return ok({ data: { dataCenters: [{ id: 'EUR-IS-2', gpuAvailability: [{ available: true, gpuTypeId: G1 }, { available: true, gpuTypeId: G2 }] }] } })
    if (q.includes('podFindAndDeployOnDemand')) {
      hooks.onCreate?.(q); calls.created.push(q)
      const name = /name: "([^"]+)"/.exec(q)![1]
      const nid = `newpod${calls.created.length}`
      pods.push(upPod(nid, name))
      return ok({ data: { podFindAndDeployOnDemand: { id: nid } } })
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
const base = (extra: Partial<podpull.Opts> = {}): podpull.Opts => ({ sizeOf: () => SIZE, pollMs: 5, placeWaitMs: 40, ssh: async () => ({ code: 255 }), listRounds: () => [ROUND, 'brynley-inbox-2026-10-28-v001'], ...extra })
const logsOf = (...lines: string[]) => { let n = 0; return async () => (n++ === 0 ? [] : lines.map((line, k) => ({ ts: String(k), line }))) }
const GOOD = [`s3 pull: bh/rounds/${ROUND} -> /workspace/comfy-shared/temp/rounds/${ROUND}`, 'a/b.json: Copied (new)', 'c/d.json: Copied (new)', '2.861 MiB / 2.861 MiB, 100%, 1 MiB/s', `s3 pull done (manifest verified): /workspace/comfy-shared/temp/rounds/${ROUND}`]

let envBackup: Record<string, string | undefined> = {}
const KEYS = ['RUNPOD_API_KEY', 'PANAMA_AWS_ACCESS_KEY_ID', 'PANAMA_AWS_SECRET_ACCESS_KEY', 'SETTINGS_ENV_FILE', 'PULL_PODS_FILE', 'VOLUME_ROUNDS_FILE', 'POD_ROUNDS_FILE', 'PANAMA_S3_REGION']
function configure(over: Partial<mounts.MountsConfig> = {}) {
  const cfg = mounts.defaults(); cfg.image = 'ghcr.io/example/comfy-app:v26'; cfg.network_volume_id = 'vol1'; cfg.data_center_id = 'EUR-IS-2'; cfg.idle_stop_minutes = 30
  Object.assign(cfg, over); mounts.save(cfg); return cfg
}
beforeEach(() => {
  envBackup = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  const dir = scratch()
  process.env.SETTINGS_ENV_FILE = join(mkdtempSync(join(tmpdir(), 'pp-')), '.env')   // never the developer's own settings
  process.env.RUNPOD_API_KEY = 'test'; process.env.PANAMA_AWS_ACCESS_KEY_ID = KEY_ID; process.env.PANAMA_AWS_SECRET_ACCESS_KEY = KEY_SECRET
  process.env.PULL_PODS_FILE = join(dir, 'pull-pods.json'); process.env.VOLUME_ROUNDS_FILE = join(dir, 'volume-rounds.json'); process.env.POD_ROUNDS_FILE = join(dir, 'pod-rounds.json'); delete process.env.PANAMA_S3_REGION
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

describe('plan: a pull needs no GPU, so any free card will do (ADR-022)', () => {
  const OUTSIDE = 'NVIDIA H100 NVL'
  it('uses the cheapest card that is free in the volume\'s datacenter, from the table or not', async () => {
    const rp = fakeRunPod([], { gpuTypes: [{ id: G1, price: 0.44, stock: 'Low' }, { id: OUTSIDE, displayName: 'H100 NVL', memoryInGb: 94, price: 2.49, stock: 'Low' }, { id: 'NVIDIA A100 80GB PCIe', price: 1.64, stock: 'None' }] })
    const p = await podpull.plan(ROUND, base({ client: rp.client }))
    expect(p).toMatchObject({ route: 'temporary', gpu: 'l4', price_per_hour: 0.44 })
    expect(p.gpu_type_id).toBe(G1)   // created by exactly this card, so the price confirmed is the price paid
  })
  it('takes a card outside the table when it is the only one free, and says so: its name, its price, and the RunPod id the pod is created with', async () => {
    const rp = fakeRunPod([], { gpuTypes: [{ id: G1, price: 0.44, stock: null }, { id: OUTSIDE, displayName: 'H100 NVL', memoryInGb: 94, price: 2.49, stock: 'Low' }] })
    const p = await podpull.plan(ROUND, base({ client: rp.client }))
    expect(p).toMatchObject({ route: 'temporary', gpu: 'H100 NVL', price_per_hour: 2.49, gpu_type_id: OUTSIDE })
  })
  it('creates the pod with that card and nothing else changes: the volume, the name, S3_PULL, the idle ceiling', async () => {
    const rp = fakeRunPod([], { gpuTypes: [{ id: OUTSIDE, displayName: 'H100 NVL', price: 2.49, stock: 'Low' }] })
    const lines = logsOf(...GOOD)
    const j0 = await podpull.pull(ROUND, base({ client: rp.client, logs: async () => lines() }))
    const j = await done(j0.id)
    expect(j).toMatchObject({ state: 'done', route: 'temporary' })
    const q = rp.calls.created[0]
    expect(q).toContain(`gpuTypeId: "${OUTSIDE}"`); expect(q).toContain('networkVolumeId: "vol1"'); expect(q).toContain(`{ key: "S3_PULL", value: "${podpull.s3PullFor(ROUND)}" }`)
    expect(rp.calls.terminated).toEqual(['newpod1'])   // and the pod is deleted when the job ends, as for any card
  })
  it('the root setting pull_any_card off keeps to the table\'s cards: an unlisted card that is free is ignored', async () => {
    const rp = fakeRunPod([], { gpuTypes: [{ id: OUTSIDE, displayName: 'H100 NVL', price: 2.49, stock: 'Low' }] })
    configure({ pull_any_card: false })
    const p = await podpull.plan(ROUND, base({ client: rp.client }))
    expect(p.gpu_type_id).not.toBe(OUTSIDE)
    expect(p.gpu).not.toBe('H100 NVL')
  })
  it('only a real RunPod GPU type id is accepted, never free text, and never AMD or an empty one', async () => {
    for (const bad of ['', 'rm -rf', 'NVIDIA ', 'nvidia l4', 'AMD Instinct MI300X', 'NVIDIA "; drop']) {
      await expect(pods.create({ name: 'x', gpu_type_id: bad } as never, fakeRunPod().client)).rejects.toThrow(/Not a RunPod GPU type id|A pod needs a name/)
    }
  })
  it('falls back to what the app would pick when RunPod gives no answer about free cards', async () => {
    const rp = fakeRunPod([], { gpuTypes: [] })
    const p = await podpull.plan(ROUND, base({ client: rp.client }))
    expect(p.route).toBe('temporary'); expect(p.gpu_type_id).toBeUndefined()
  })
})

describe('plan: which route', () => {
  it('temporary when no pod of yours runs on the volume: the cheapest card in stock there, its price, the size, the ceiling', async () => {
    const p = await podpull.plan(ROUND, base({ client: fakeRunPod().client }))
    expect(p).toMatchObject({ round: ROUND, route: 'temporary', pod: null, gpu: 'rtx3090', price_per_hour: 0.22, bytes: SIZE.bytes, idle_stop_minutes: 15, ceiling_minutes: 167, files: SIZE.files })
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
      process.env.VOLUME_ROUNDS_FILE = join(mkdtempSync(join(tmpdir(), 'pr-')), 'r.json')   // each case starts with nothing known
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
    expect(idle.entry('newpod1')?.minutes).toBe(15)   // the agent's idle stop is the backstop
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

describe('placing the round after a pull (ADR-033)', () => {
  const REPORT = { linked: 4, already_there: 0, conflicts: [], mode: 'hardlink', missing: [] }
  /** An ssh that is the pull on call 1, then answers the inventory and the apply script of the placing. */
  const sshFor = (pull: string[], seen: string[]): podpull.SshRunner => async (j) => {
    seen.push(j.script)
    if (j.script.includes('s3pull.sh')) { for (const l of pull) j.onLine(l); return { code: 0 } }
    if (j.script.includes('PLACE-FILE')) { j.onLine('PLACE-INV-DONE'); return { code: 0 } }
    j.onLine('PLACE-REPORT ' + JSON.stringify(REPORT)); return { code: 0 }
  }
  it('runs on the same pod once the manifest check passed: the job carries the report, History has the summary, the pull is still done', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')]); const seen: string[] = []
    const job = await done((await podpull.pull(ROUND, base({ client: rp.client, ssh: sshFor(GOOD, seen) }))).id)
    expect(job.state).toBe('done')
    expect(job.place).toMatchObject({ ok: true, linked: 4, mode: 'hardlink', dry_run: false })
    expect(seen.length).toBe(3); expect(seen[1]).toContain(`PLACE_ROUND='${ROUND}'`); expect(seen[2]).toContain("PLACE_PAYLOAD_FILE")
    expect(seen[1]).not.toContain(KEY_SECRET); expect(seen[2]).not.toContain(KEY_SECRET)   // placing holds no secret
    expect(job.lines.join('\n')).toContain('placed 4 file(s)')
  })
  it('never after a failed or unverified check', async () => {
    for (const verdict of [['s3 pull FAILED the manifest check: 1 listed, 1 bad, 0 on disk but not listed', 'SHA256 a/b.json'], ['s3 pull done, NOT verified (no MANIFEST.json)']]) {
      const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')]); const seen: string[] = []
      const job = await done((await podpull.pull(ROUND, base({ client: rp.client, ssh: sshFor(verdict, seen) }))).id)
      expect(job.state).toBe('failed'); expect(job.place).toBeUndefined(); expect(seen.length).toBe(1)
    }
  })
  it('a placing that fails is on the job, not the pull', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')])
    const ssh: podpull.SshRunner = async (j) => { if (j.script.includes('s3pull.sh')) { for (const l of GOOD) j.onLine(l); return { code: 0 } } return { code: 255 } }
    const job = await done((await podpull.pull(ROUND, base({ client: rp.client, ssh }))).id)
    expect(job.state).toBe('done'); expect(job.place?.ok).toBe(false); expect(job.place?.error).toBeTruthy()
  })
  it('placeRound by hand: a dry run by default, on the running pod, and a real run is recorded; a stopped pod is refused', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')]); const seen: string[] = []
    const ssh = sshFor([], seen)
    const dryRep = await podpull.placeRound(ROUND, {}, base({ client: rp.client, ssh }))
    expect(dryRep.dry_run).toBe(true); 
    expect(Buffer.from(/<<'PLACE_B64'\n([^\n]+)\nPLACE_B64/.exec(seen[1])![1], 'base64').toString()).toContain('"dry":true')
    const real = await podpull.placeRound(ROUND, { pod_id: 'mine', dry_run: false }, base({ client: rp.client, ssh }))
    expect(real.dry_run).toBe(false)
    await expect(podpull.placeRound(ROUND, { pod_id: 'nope' }, base({ client: rp.client, ssh }))).rejects.toThrow(/not found/)
  })
  it('volume records move out of pod-rounds.json into volume-rounds.json once, leaving the pod -> round map', async () => {
    const { writeFileSync, readFileSync } = await import('node:fs')
    const old = process.env.POD_ROUNDS_FILE!
    writeFileSync(old, JSON.stringify({ podA: 'r1', vol9: { as_of: '2026-11-13T00:00:00Z', rounds: { r1: { state: 'complete', present: 1, expected: 1, missing: 0, bytes: 5 } } } }))
    expect(podpull.knownState('vol9')?.rounds.r1.state).toBe('complete')   // found in the new file
    expect(JSON.parse(readFileSync(old, 'utf8'))).toEqual({ podA: 'r1' })   // and gone from the pod map
    expect(JSON.parse(readFileSync(process.env.VOLUME_ROUNDS_FILE!, 'utf8')).vol9.rounds.r1.bytes).toBe(5)
  })

})

describe('browse and erase one volume', () => {
  it('browse: a short-lived pod lists the volume to depth 3 with sizes (read-only script), then is deleted', async () => {
    const rp = fakeRunPod()
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); for (const l of ['BROWSE 1000 /workspace', 'BROWSE 600 /workspace/comfy-shared', 'BROWSE 400 /workspace/comfy-shared/temp', 'BROWSE-DONE']) j.onLine(l); return { code: 0 } }
    const job0 = await podpull.browseVolume('vol1', base({ client: rp.client, ssh }))
    expect(job0).toMatchObject({ kind: 'browse', volume_id: 'vol1', route: 'temporary' })
    const job = await done(job0.id)
    expect(job.state).toBe('done')
    expect(job.listing).toEqual([{ path: '/workspace', bytes: 1000 }, { path: '/workspace/comfy-shared', bytes: 600 }, { path: '/workspace/comfy-shared/temp', bytes: 400 }])
    expect(calls[0].script).toContain('du -b --max-depth=3'); expect(calls[0].script).not.toMatch(/rm |-delete/)   // never writes
    expect(rp.calls.terminated).toEqual(['newpod1'])
  })
  it('erase: needs a name, the volume name typed back and known folders; then clears only those, keeps the folders, forgets the pulled rounds', async () => {
    const rp = fakeRunPod()
    podpull.recordState('vol1', ROUND, { state: 'complete', present: 5, expected: 5, missing: 0, bytes: 10 })
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine('ERASED rounds 12345'); j.onLine('ERASED output 0'); j.onLine('ERASE-DONE'); return { code: 0 } }
    const o = base({ client: rp.client, ssh })
    await expect(podpull.eraseVolume('vol1', ['rounds'], { confirm_name: 'comfy-workspace' }, o)).rejects.toThrow(/approved_by/)
    await expect(podpull.eraseVolume('vol1', ['rounds'], { approved_by: 'Lucas', confirm_name: 'nope' }, o)).rejects.toThrow(/Type the volume's name/)
    await expect(podpull.eraseVolume('vol1', ['../etc'], { approved_by: 'Lucas', confirm_name: 'comfy-workspace' }, o)).rejects.toThrow(/Not something Erase clears/)
    await expect(podpull.eraseVolume('vol1', [], { approved_by: 'Lucas', confirm_name: 'comfy-workspace' }, o)).rejects.toThrow(/Choose what/)
    expect(rp.calls.created).toEqual([])   // every refusal came before a pod
    const job0 = await podpull.eraseVolume('vol1', ['rounds', 'output'], { approved_by: 'Lucas', confirm_name: 'comfy-workspace' }, o)
    const job = await done(job0.id)
    expect(job).toMatchObject({ kind: 'erase', state: 'done', freed: { rounds: 12345, output: 0 } })
    expect(calls[0].script).toContain("d='/workspace/comfy-shared/temp/rounds'"); expect(calls[0].script).toContain("d='/workspace/comfy-shared/output'")
    expect(calls[0].script).not.toContain('/models'); expect(calls[0].script).toContain('-mindepth 1 -delete')   // contents only, never the folder
    const seed = podpull.eraseScript(['seedflows'])
    expect(seed).toContain("-maxdepth 1 -type f -name '*.json' -delete"); expect(seed).not.toContain('-mindepth 1')   // only the loose .json files, never the rounds folder inside workflows
    expect(podpull.knownState('vol1')).toBeNull()   // what was known about its rounds is gone
  })
  it('a second job on the volume is refused while one runs; the scripts refuse a path outside the shared tree', async () => {
    const rp = fakeRunPod()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const ssh: podpull.SshRunner = async (j) => { await gate; j.onLine('BROWSE-DONE'); return { code: 0 } }
    const o = base({ client: rp.client, ssh })
    const first = await podpull.browseVolume('vol1', o)
    await expect(podpull.eraseVolume('vol1', ['output'], { approved_by: 'L', confirm_name: 'comfy-workspace' }, o)).rejects.toThrow(/running on this volume|busy/)
    release(); await done(first.id)
    for (const k of Object.keys(podpull.ERASABLE)) expect(podpull.ERASABLE[k].path.startsWith('/workspace/comfy-shared/')).toBe(true)
    await expect(podpull.browseVolume('../x', o)).rejects.toThrow(/Not a network volume id/)
  })
  it('a pull the app lost track of: its pod, still copying, is taken over instead of making a second pod for the same round', async () => {
    const name = podpull.podName(ROUND)
    const rp = fakeRunPod([{ ...upPod('old1', name), desiredStatus: 'RUNNING' }])
    writeFileSync(process.env.PULL_PODS_FILE!, JSON.stringify([{ round: ROUND, kind: 'pull', name, pod_id: 'old1', volume: 'vol1', created_at: '2026-11-14T20:25:00Z', approved_by: 'Lucas' }]))
    const lines = logsOf(...GOOD)
    const j0 = await podpull.pull(ROUND, base({ client: rp.client, logs: async () => lines(), ssh: async () => ({ code: 0 }) }))
    const j = await done(j0.id)
    expect(rp.calls.created).toEqual([])   // no second pod
    expect(j.pod_id).toBe('old1')
    expect(j.lines.join('\n')).toMatch(/taking over the pod/)
    expect(rp.calls.terminated).toEqual(['old1'])   // and it is deleted at the end, like any pull pod
  })

  it('a pull of some shots: over ssh (no S3_PULL at start), the round without the other shots\' folders, the check for what was copied; the plan is the smaller size', async () => {
    const rp = fakeRunPod([upPod('mine', 'ComfyUI-Dev')])
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); if (j.script.includes('rclone copy')) { j.onLine('s3 pull done (manifest verified): x'); } return { code: 0 } }
    const sizes: string[][] = []
    const o = base({ client: rp.client, ssh, shotDirs: ['s1', 's2', 's3'], sizeOf: () => { sizes.push(['called']); return { files: 3, bytes: 3e9 } } })
    await expect(podpull.pull(ROUND, { ...o, shots: ['nope'] })).rejects.toThrow(/not a shot/)
    const job0 = await podpull.pull(ROUND, { ...o, shots: ['s2'] })
    expect(job0.skip_shots).toEqual(['s1', 's3']); expect(job0.pulled_shots).toEqual(['s2'])
    const job = await done(job0.id)
    expect(job.state).toBe('done')
    const pullCall = calls.find((c) => c.script.includes('rclone copy'))!
    expect(pullCall.script).toContain("--exclude '/s1/**'"); expect(pullCall.script).toContain("--exclude '/s3/**'"); expect(pullCall.script).not.toContain("--exclude '/s2/**'")
    expect(pullCall.script).toContain('verify_round.py'); expect(pullCall.script).toContain('s3 pull done (manifest verified)')
    expect(pullCall.script).not.toContain('exec /opt/comfy-app/s3pull.sh')   // not the whole-round script
    expect(podpull.knownState('vol1')?.rounds[ROUND]).toMatchObject({ state: 'complete', shots: ['s2'] })
    // asking for every shot is the plain whole-round pull
    const all = await podpull.pull(ROUND, { ...o, shots: ['s1', 's2', 's3'] })
    expect(all.skip_shots).toBeUndefined(); await done(all.id)
  })
  it('shotDirsOf: the folders with their own MANIFEST.json are the shots (templates/ is shared files); a round without per-shot manifests has every folder', () => {
    const e = (path: string, dir = false) => ({ path, dir, bytes: 1 })
    expect(panama.shotDirsOf([e('a', true), e('a/MANIFEST.json'), e('b', true), e('b/MANIFEST.json'), e('templates', true), e('templates/x.py'), e('MANIFEST.json')])).toEqual(['a', 'b'])
    expect(panama.shotDirsOf([e('x', true), e('y', true), e('y/f')])).toEqual(['x', 'y'])
  })

  describe('through RunPod\'s S3 API (no pod)', () => {
    const LS = ['2026-11-14 10:00:00       1000 comfy-shared/temp/rounds/r1/a/x.png', '2026-11-14 10:00:00        500 comfy-shared/temp/rounds/r1/b.txt', '2026-11-14 10:00:00         50 comfy-shared/workflows/seed.json', '2026-11-14 10:00:00         70 comfy-shared/workflows/rounds/r1/g.json', '2026-11-14 10:00:00         10 top.txt'].join('\n')
    const withKeys = () => { process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y' }
    afterEach(() => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY })
    const fakeAws = () => { const calls: { args: string[]; env: Record<string, string> }[] = []; const aws: podpull.AwsRunner = async (args, env) => { calls.push({ args, env }); return { code: 0, stdout: args[1] === 'ls' ? LS : '', stderr: '' } }; return { calls, aws } }
    it('browse: in an S3 datacenter with keys, no pod is made; the listing is the S3 listing to depth 3', async () => {
      withKeys(); const rp = fakeRunPod([], { volumeDc: 'EU-RO-1' }); const { calls, aws } = fakeAws()
      const plan = await podpull.volumePlan('vol1', base({ client: rp.client }))
      expect(plan).toMatchObject({ route: 's3', price_per_hour: 0 })
      const job0 = await podpull.browseVolume('vol1', base({ client: rp.client, aws }))
      expect(job0).toMatchObject({ kind: 'browse', route: 's3', pod_name: null })
      const job = await done(job0.id)
      expect(job.state).toBe('done')
      expect(job.listing).toContainEqual({ path: '/workspace', bytes: 1630 }); expect(job.listing).toContainEqual({ path: '/workspace/comfy-shared/temp/rounds', bytes: 1500 }); expect(job.listing).toContainEqual({ path: '/workspace/comfy-shared/workflows/rounds', bytes: 70 })
      expect(calls[0].args).toEqual(expect.arrayContaining(['s3', 'ls', 's3://vol1/', '--recursive', '--endpoint-url', 'https://s3api-eu-ro-1.runpod.io/', '--region', 'EU-RO-1']))
      expect(calls[0].env).toMatchObject({ AWS_ACCESS_KEY_ID: 'user_x', AWS_SECRET_ACCESS_KEY: 'rps_y' })
      expect(rp.calls.created).toEqual([])   // no pod
    })
    it('erase: rm per chosen folder; the seed graphs only the loose .json files; what was freed is counted from the listing', async () => {
      withKeys(); const rp = fakeRunPod([], { volumeDc: 'EU-RO-1' }); const { calls, aws } = fakeAws()
      podpull.recordState('vol1', ROUND, { state: 'complete', present: 1, expected: 1, missing: 0, bytes: 1 })
      const job0 = await podpull.eraseVolume('vol1', ['rounds', 'seedflows'], { approved_by: 'Lucas', confirm_name: 'comfy-workspace' }, base({ client: rp.client, aws }))
      const job = await done(job0.id)
      expect(job).toMatchObject({ state: 'done', route: 's3', freed: { rounds: 1500, seedflows: 50 } })
      const rms = calls.filter((c) => c.args[1] === 'rm').map((c) => c.args.join(' '))
      expect(rms[0]).toContain('s3 rm s3://vol1/comfy-shared/temp/rounds/ --recursive')
      expect(rms[1]).toContain("s3://vol1/comfy-shared/workflows/ --recursive --exclude * --include *.json --exclude */*")
      expect(podpull.knownState('vol1')).toBeNull(); expect(rp.calls.created).toEqual([])
    })
    it('a failure of the S3 API is the job\'s error; no keys or a datacenter without S3 falls back to a pod and says why', async () => {
      withKeys(); const rp = fakeRunPod([], { volumeDc: 'EU-RO-1' })
      const bad: podpull.AwsRunner = async () => ({ code: 1, stdout: '', stderr: 'An error occurred (AccessDenied)' })
      const j = await done((await podpull.browseVolume('vol1', base({ client: rp.client, aws: bad }))).id)
      expect(j.state).toBe('failed'); expect(j.error).toMatch(/S3 API: .*AccessDenied/)
      delete process.env.RUNPOD_S3_ACCESS_KEY
      expect(await podpull.volumePlan('vol1', base({ client: fakeRunPod([], { volumeDc: 'EU-RO-1' }).client }))).toMatchObject({ route: 'temporary', s3_note: 'keys' })
      withKeys()
      expect(await podpull.volumePlan('vol1', base({ client: fakeRunPod().client }))).toMatchObject({ route: 'temporary', s3_note: 'datacenter' })   // EUR-IS-2: no S3 API
    })
  })

  describe('clone a volume', () => {
    const keys = () => { process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y' }
    afterEach(() => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY })
    const dcs = { vol1: { name: 'comfy-workspace', dc: 'EUR-IS-2' }, volS3: { name: 'rounds-ro', dc: 'EU-RO-1' }, volS3b: { name: 'rounds-ne', dc: 'US-NE-1' } }
    it('cloneMode: push when the target has the S3 API, pull when only the source has it, an explanation otherwise', () => {
      expect(podpull.cloneMode({ datacenter: 'EUR-IS-2' }, { datacenter: 'EU-RO-1' }, true)).toEqual({ mode: 'push' })   // a regular volume into an S3 one
      expect(podpull.cloneMode({ datacenter: 'EU-RO-1' }, { datacenter: 'EUR-IS-2' }, true)).toEqual({ mode: 'pull' })   // an S3 volume into a regular one
      expect(podpull.cloneMode({ datacenter: 'EU-RO-1' }, { datacenter: 'US-NE-1' }, true)).toEqual({ mode: 'push' })
      expect(podpull.cloneMode({ datacenter: 'EU-RO-1' }, { datacenter: 'US-NE-1' }, false)).toEqual({ mode: 'rsync' })   // no S3 keys: RunPod to RunPod
      expect(podpull.cloneMode({ datacenter: 'EUR-IS-2' }, { datacenter: 'CA-MTL-1' }, true)).toEqual({ mode: 'rsync' })   // neither has S3: still possible
    })
    it('the script: rclone to or from RunPod\'s S3 API, input/ left out unless asked, the keys only inside it', () => {
      const c = { mode: 'push' as const, from: { id: 'a', datacenter: 'EUR-IS-2', name: 'src' }, to: { id: 'b', datacenter: 'EU-RO-1', name: 'dst' }, include_input: false }
      const push = podpull.cloneScript(c, { id: 'AK', secret: 'SK' })
      expect(push).toContain("rclone copy '/workspace' 'S3SIDE:b'"); expect(push).toContain("--exclude '/comfy-shared/input/**'"); expect(push).toContain('--copy-links'); expect(push).toContain("ENDPOINT='https://s3api-eu-ro-1.runpod.io/'"); expect(push).toContain('CLONE-DONE')
      const pull = podpull.cloneScript({ ...c, mode: 'pull', include_input: true, from: { id: 'b', datacenter: 'EU-RO-1', name: 'dst' }, to: { id: 'a', datacenter: 'EUR-IS-2', name: 'src' } }, { id: 'AK', secret: 'SK' })
      expect(pull).toContain("rclone copy 'S3SIDE:b' '/workspace'"); expect(pull).not.toContain('comfy-shared/input'); expect(pull).not.toContain('--copy-links')
    })
    it('RunPod to RunPod (no S3 keys, or no S3 on either side): a pod on each volume; the target pod rsyncs from the source pod with a one-off key; the key is removed; both pods are deleted', async () => {
      const calls: { host: string; port: number; script: string }[] = []
      const ssh: podpull.SshRunner = async (j) => { calls.push({ host: j.host, port: j.port, script: j.script }); if (j.script.includes('rsync -aH')) j.onLine('CLONE-DONE'); return { code: 0 } }
      const rp = fakeRunPod([], { volumes: { vol1: { name: 'comfy-workspace', dc: 'EUR-IS-2' }, volReg: { name: 'other', dc: 'CA-MTL-1' } } })
      const keygen = async () => ({ priv: '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETSECRETSECRETSECRET\n-----END OPENSSH PRIVATE KEY-----', pub: 'ssh-ed25519 AAAA pod-manager-clone-1', comment: 'pod-manager-clone-1' })
      const j0 = await podpull.cloneVolume('vol1', { approved_by: 'Lucas', to_volume_id: 'volReg', include_input: false }, base({ client: rp.client, ssh, keygen }))   // no S3 keys set at all
      expect(j0.clone).toMatchObject({ mode: 'rsync', from: { id: 'vol1' }, to: { id: 'volReg' } })
      const job = await done(j0.id)
      expect(job.state).toBe('done')
      expect(rp.calls.created).toHaveLength(2)   // one pod per volume
      expect(JSON.stringify(rp.calls.created[0])).toContain('vol1'); expect(JSON.stringify(rp.calls.created[1])).toContain('volReg')
      expect(calls).toHaveLength(3); expect(calls[0].script).toContain('authorized_keys'); expect(calls[1].script).toContain('rsync -aH'); expect(calls[2].script).toContain('grep -v')   // key in, copy, key out
      const rsync = calls[1].script
      expect(rsync).toContain('cat > /tmp/clone_key'); expect(rsync).toContain("--exclude '/comfy-shared/input/'"); expect(rsync).toMatch(/root@[\d.]+:\/workspace\//); expect(rsync).toContain('-aH')
      expect(job.lines.join('\n')).not.toContain('SECRETSECRET')   // the key never reaches the log
      expect(rp.calls.terminated.sort()).toEqual(['newpod1', 'newpod2'])   // both pods are deleted
      expect(podpull.temporaryPods()).toEqual([])
    })
    it('regular -> S3: a pod on the SOURCE pushes; S3 -> regular: a pod on the TARGET pulls; refused before any spend without keys or the right fields', async () => {
      const calls: podpull.SshJob[] = []
      const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine('CLONE-DONE'); return { code: 0 } }
      const rp = fakeRunPod([], { volumes: dcs })
      const o = base({ client: rp.client, ssh })
      await expect(podpull.cloneVolume('vol1', { to_volume_id: 'volS3' }, o)).rejects.toThrow(/approved_by/)
      await expect(podpull.cloneVolume('vol1', { approved_by: 'L' }, o)).rejects.toThrow(/Say where to/)
      await expect(podpull.cloneVolume('vol1', { approved_by: 'L', to_volume_id: 'vol1' }, o)).rejects.toThrow(/onto itself/)
      expect(rp.calls.created).toEqual([])
      keys()
      const j0 = await podpull.cloneVolume('vol1', { approved_by: 'L', to_volume_id: 'volS3' }, o)   // EUR-IS-2 -> EU-RO-1
      expect(j0.clone).toMatchObject({ mode: 'push', from: { id: 'vol1' }, to: { id: 'volS3' } })
      expect((await done(j0.id)).state).toBe('done')
      expect(calls[0].script).toContain("rclone copy '/workspace' 'S3SIDE:volS3'"); expect(calls[0].script).not.toContain('exec /opt/comfy-app/s3pull.sh')
      expect(JSON.stringify(rp.calls.created)).toContain('vol1')   // the pod was made on the source volume
      const j1 = await podpull.cloneVolume('volS3', { approved_by: 'L', to_volume_id: 'vol1' }, o)   // EU-RO-1 -> EUR-IS-2
      expect(j1.clone?.mode).toBe('pull')
      expect((await done(j1.id)).state).toBe('done')
      expect(calls[1].script).toContain("rclone copy 'S3SIDE:volS3' '/workspace'")
    })
  })

  it('browse a folder inside the volume: the path is checked, the script lists that folder; the S3 route lists the prefix', async () => {
    expect(podpull.browsePathOf()).toBe('/workspace'); expect(podpull.browsePathOf('/workspace/comfy-shared/temp/')).toBe('/workspace/comfy-shared/temp')
    for (const bad of ['/etc', '/workspace/../etc', "/workspace/a'b", '/workspace/a;rm -rf x', 'workspace/x']) expect(() => podpull.browsePathOf(bad)).toThrow(/Not a path/)
    expect(podpull.browseScript('/workspace/comfy-shared')).toContain("du -b --max-depth=3 '/workspace/comfy-shared'")
    process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
    try {
      const rp = fakeRunPod([], { volumeDc: 'EU-RO-1' })
      const aws: podpull.AwsRunner = async () => ({ code: 0, stdout: ['2026 x 100 comfy-shared/temp/rounds/r1/a/b/c/x.png', '2026 x 5 comfy-shared/temp/rounds/r1/y.txt', '2026 x 9 comfy-shared/output/o.png', '2026 x 1 top.txt'].join('\n'), stderr: '' })
      const j = await done((await podpull.browseVolume('vol1', base({ client: rp.client, aws, path: '/workspace/comfy-shared/temp/rounds' }))).id)
      expect(j.browse_path).toBe('/workspace/comfy-shared/temp/rounds')
      expect(j.listing).toEqual([{ path: '/workspace/comfy-shared/temp/rounds', bytes: 105 }, { path: '/workspace/comfy-shared/temp/rounds/r1', bytes: 105 }, { path: '/workspace/comfy-shared/temp/rounds/r1/a', bytes: 100 }, { path: '/workspace/comfy-shared/temp/rounds/r1/a/b', bytes: 100 }])   // three levels below the folder asked for
    } finally { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY }
  })

})

describe('models from Hugging Face onto a volume (ADR-042)', () => {
  const TREE = [{ type: 'file', path: 'vae/seedvr2_ema_vae_fp16.safetensors', size: 1, lfs: { oid: 'b'.repeat(64), size: 501324814 } }, { type: 'file', path: 'diffusion_models/seedvr2_3b_fp16.safetensors', size: 1, lfs: { oid: 'a'.repeat(64), size: 6784268336 } }]
  const hfFetch = (async () => new Response(JSON.stringify(TREE))) as unknown as typeof fetch
  const items = [{ repo: 'Comfy-Org/SeedVR2', path: 'vae/seedvr2_ema_vae_fp16.safetensors', folder: 'vae' }, { repo: 'Comfy-Org/SeedVR2', path: 'diffusion_models/seedvr2_3b_fp16.safetensors', folder: 'diffusion_models' }]
  it('needs no approval; a short pod runs the download script, the pod reports each file, and it is deleted', async () => {
    const rp = fakeRunPod()
    const calls: podpull.SshJob[] = []
    const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine('FETCHED seedvr2_ema_vae_fp16.safetensors 501324814'); j.onLine('FETCHED seedvr2_3b_fp16.safetensors skipped'); j.onLine('FETCH-DONE'); return { code: 0 } }
    const job0 = await podpull.fetchModels('vol1', items, {}, { ...base({ client: rp.client, ssh }), fetchFn: hfFetch })
    expect(job0).toMatchObject({ kind: 'fetch', volume_id: 'vol1', route: 'temporary' })
    const job = await done(job0.id)
    expect(job).toMatchObject({ state: 'done', fetched: ['seedvr2_ema_vae_fp16.safetensors', 'seedvr2_3b_fp16.safetensors'] })
    const sc = calls[0].script
    expect(sc).toContain('d=/workspace/comfy-shared/models/vae'); expect(sc).toContain('d=/workspace/comfy-shared/models/diffusion_models')
    expect(sc).toContain("'https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors'")
    expect(sc).toContain('curl -fL --proto-redir =https --retry 5'); expect(sc).toContain('-C -'); expect(sc).toContain('b'.repeat(64) + '  $f.part'); expect(sc).toContain('sha256sum -c -')
    expect(sc).toContain('stat -c %s'); expect(sc).toContain('echo "FETCH-DONE"')
    expect(rp.calls.terminated).toEqual(['newpod1'])
  })
  it('with a Hugging Face token the script reads it from a RAM file, sends it only with -L (never --location-trusted), and no job line, record or event ever holds it', async () => {
    const TOKEN = 'hf_PODPULL_SECRET_TOKEN_5555'
    process.env.HF_TOKEN = TOKEN
    try {
      const rp = fakeRunPod()
      const calls: podpull.SshJob[] = []
      const ssh: podpull.SshRunner = async (j) => { calls.push(j); j.onLine(`debug: the pod echoed ${TOKEN} by mistake`); j.onLine('FETCHED seedvr2_ema_vae_fp16.safetensors 501324814'); j.onLine('FETCH-DONE'); return { code: 0 } }
      const j = await done((await podpull.fetchModels('vol1', items.slice(0, 1), {}, { ...base({ client: rp.client, ssh }), fetchFn: hfFetch })).id)
      expect(j.state).toBe('done')
      const sc = calls[0].script.split('\n')
      expect(sc.filter((l) => l.includes(TOKEN))).toHaveLength(1)   // once: the line that writes the curl config file
      expect(sc.find((l) => l.includes(TOKEN))).toMatch(/^printf 'header = "Authorization: Bearer %s"\\n' '.*' > "\$H"$/)
      expect(sc.join('\n')).toMatch(/mktemp \/dev\/shm\/hf\./); expect(sc.join('\n')).toContain(`trap 'rm -f "$H"' EXIT`); expect(sc.join('\n')).toContain('umask 077')
      const curl = sc.find((l) => l.includes('curl -fL'))!
      expect(curl).toContain('-K "$H"'); expect(curl).toContain('--proto-redir =https'); expect(calls[0].script).not.toContain('--location-trusted'); expect(curl).not.toContain(TOKEN)
      expect(JSON.stringify(j)).not.toContain(TOKEN); expect(j.lines.join('\n')).toContain('***')
      expect(JSON.stringify(history.list({ limit: 500 }))).not.toContain(TOKEN)
    } finally { delete process.env.HF_TOKEN }
  })
  it('without a token the script has no Authorization at all', () => {
    delete process.env.HF_TOKEN
    const sc = podpull.fetchScript([{ repo: 'o/r', revision: 'main', path: 'a.safetensors', name: 'a.safetensors', folder: 'vae', bytes: 1, sha256: 'a'.repeat(64), url: 'https://huggingface.co/o/r/resolve/main/a.safetensors' }])
    expect(sc).not.toMatch(/Authorization|-K |mktemp/); expect(sc).toContain('curl -fL --proto-redir =https')
  })
  it('a failed download is a failed job (the pod says which file), and the refusals come before any pod', async () => {
    const rp = fakeRunPod()
    const ssh: podpull.SshRunner = async (j) => { j.onLine('FETCH-FAILED seedvr2_3b_fp16.safetensors (the checksum does not match)'); return { code: 1 } }
    const o = { ...base({ client: rp.client, ssh }), fetchFn: hfFetch }
    await expect(podpull.fetchModels('vol1', [{ repo: 'x', path: 'a.safetensors', folder: 'vae' }], {}, o)).rejects.toThrow(/Not a Hugging Face repo/)
    await expect(podpull.fetchModels('vol1', [{ ...items[0], folder: 'rounds' }], {}, o)).rejects.toThrow(/Not a models folder/)
    await expect(podpull.fetchModels('../x', items, {}, o)).rejects.toThrow(/Not a network volume id/)
    expect(rp.calls.created).toEqual([])
    const j = await done((await podpull.fetchModels('vol1', items, {}, o)).id)
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/Download failed: seedvr2_3b_fp16.safetensors \(the checksum does not match\)/)
  })
  it('is refused while another job runs on the volume', async () => {
    const rp = fakeRunPod()
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const ssh: podpull.SshRunner = async (j) => { await gate; j.onLine('BROWSE-DONE'); return { code: 0 } }
    const o = { ...base({ client: rp.client, ssh }), fetchFn: hfFetch }
    const first = await podpull.browseVolume('vol1', o)
    await expect(podpull.fetchModels('vol1', items, {}, o)).rejects.toThrow(/running on this volume|busy/)
    release(); await done(first.id)
  })
  it('modelsOnVolume lists the models folder over S3 as folder, name and bytes; null with no S3 keys', async () => {
    process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
    try {
      const calls: string[][] = []
      const aws: podpull.AwsRunner = async (args) => { calls.push(args); return { code: 0, stdout: '2026-11-15 12:00:00  501324814 comfy-shared/models/vae/seedvr2_ema_vae_fp16.safetensors\n2026-11-15 12:00:00  124 comfy-shared/models/diffusion_models/z.gguf\n2026-11-15 12:00:00  9 comfy-shared/temp/other.txt\n', stderr: '' } }
      const rp = fakeRunPod([], { volumes: { vol1: { name: 'comfy-workspace', dc: 'EU-RO-1' } } })
      expect(await podpull.modelsOnVolume('vol1', { client: rp.client, aws })).toEqual([{ folder: 'diffusion_models', name: 'z.gguf', bytes: 124 }, { folder: 'vae', name: 'seedvr2_ema_vae_fp16.safetensors', bytes: 501324814 }])
      expect(calls[0]).toContain('s3://vol1/comfy-shared/models/'); expect(calls[0]).toContain('https://s3api-eu-ro-1.runpod.io/')
    } finally { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY }
    expect(await podpull.modelsOnVolume('vol1', { client: fakeRunPod().client })).toBeNull()
  })
})

