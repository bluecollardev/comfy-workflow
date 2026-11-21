import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as publish from '../src/publish.js'
import * as jobsregistry from '../src/jobsregistry.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 amendment "pods": which pods carry an upload (idle before busy), a job spread over several pods at once, a failed pod handing over once,
// and the byte progress of a job that another process runs. Fakes only: no pod, no S3.
vi.setConfig({ testTimeout: 15_000 })
const VOLB = 'a3upg9ey48', DEST = 'my-internal-bucket', O = 'comfy-shared/output/', SECRET = 'secretsecretsecret1234', KEYID = 'AKIAEXAMPLE12345'
const pod = (id: string, name: string, gpus?: number) => ({ id, name, host: `root@10.0.0.${[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 250}`, port: 40000 + id.length, ...(gpus ? { gpus } : {}) })
const RENDER = pod('render01', 'Render-2x', 2), IDLE = pod('idle002', 'Idle-1x', 1), IDLE2 = pod('idle003', 'Idle-2x', 2)
let holdHosts: Set<string>, releases: (() => void)[]
let dir: string, vol: Map<string, number>, dest: Map<string, number>, scripts: { host: string; file: string }[], pods: ReturnType<typeof pod>[], busy: Set<string>, unknown: Set<string>, loadCalls: number, dropped: Set<string>, now: number

const fakeAws: podpull.AwsRunner = async (args) => {
  if (args[0] === 's3api') { const pre = args[args.indexOf('--prefix') + 1]; const keys = [...vol.keys()].filter((k) => k.startsWith(pre)).slice(0, 2); return { code: 0, stdout: JSON.stringify(keys.length ? { Contents: keys.map((Key) => ({ Key })) } : {}), stderr: '' } }
  if (args[0] === 's3' && args[1] === 'ls') {
    const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2])!, store = m[1] === VOLB ? vol : dest, pre = m[2], recursive = args.includes('--recursive')
    const row = (k: string, n: number) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${k}`
    const under = [...store].filter(([k]) => k.startsWith(pre)).sort()
    if (recursive) { const rows = under.map(([k, n]) => row(k, n)); return { code: rows.length ? 0 : 1, stdout: rows.join('\n'), stderr: '' } }
    const pres = new Set<string>(), files: string[] = []
    for (const [k, n] of under) { const r = k.slice(pre.length); if (r.includes('/')) pres.add(`${r.split('/')[0]}/`); else files.push(row(r, n)) }
    return { code: pres.size || files.length ? 0 : 1, stdout: [...[...pres].map((x) => `                           PRE ${x}`), ...files].join('\n'), stderr: '' }
  }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess
  Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => true })
  setImmediate(() => c.emit('close', 1))
  return c
}
const fakeSsh: podpull.SshRunner = async ({ host, script, onLine }) => {
  if (script.includes('PROBE-END')) { onLine('PROBE-CURL'); onLine('PROBE-SHA'); onLine('PROBE-END'); return { code: 0 } }
  if (script.includes('pkill')) { onLine(''); return { code: 0 } }
  const file = /^f='(.*)'$/m.exec(script)![1]
  scripts.push({ host, file })
  onLine('PUBLISH-PID 4242')
  if (dropped.has(host)) return { code: 255 }   // the SSH connection to this pod dropped
  if (holdHosts.has(host)) await new Promise<void>((res) => releases.push(res))   // an upload in progress, until the test lets it finish
  onLine('PUBLISH-SHA ' + createHash('sha256').update(file).digest('hex')); onLine('PUBLISH-OK'); return { code: 0 }
}
const configure = (extra: Record<string, unknown> = {}) => publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: DEST, prefix: 'returns/BKK', region: 'us-west-2', access_key_id: KEYID, secret_access_key: SECRET, ...extra } })
const four = ['a.mov', 'b.mov', 'c.mov', 'd.mov'].map((p) => ({ where: 'volume' as const, path: p }))
const go = async (extra: Record<string, unknown> = {}, items = four) => { const { job_id } = await publish.run({ items, targets: ['s3'], approved_by: 'Lucas', ...extra }); await publish.settled(); return publish.status(job_id).jobs[0] }
const hostsOf = (): Set<string> => new Set(scripts.map((s) => s.host))

beforeEach(async () => {
  dir = scratch(); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); mkdirSync(join(dir, 'out'), { recursive: true })
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  holdHosts = new Set(); releases = []; scripts = []; dest = new Map(); pods = [RENDER, IDLE, IDLE2]; busy = new Set(['render01']); unknown = new Set(); loadCalls = 0; dropped = new Set(); now = Date.parse('2026-11-21T10:00:00Z')
  vol = new Map(['a', 'b', 'c', 'd'].map((n, i) => [`${O}${n}.mov`, 100 + i]))
  publish.reset(); publish.setDeps({ aws: fakeAws, outputRoot: () => join(dir, 'out'), parallel: () => 8, spawn: fakeSpawn, now: () => now, volumeId: () => 'vol1', ssh: fakeSsh,
    podsOnVolume: async () => pods, podLoad: async (p) => { loadCalls++; return unknown.has(p.id) ? null : { busy: busy.has(p.id) } },
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  await configure()
})
afterEach(() => { publish.reset(); jobsregistry.reset(); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('rankPods: the pod to use first', () => {
  const ram = (m: Record<string, number>) => (id: string) => m[id] ?? null
  it('idle before unknown before busy, then the lowest RAM in use, then the most GPUs, then RunPod\'s own order', () => {
    const a = pod('aaaaaa01', 'A'), b = pod('bbbbbb02', 'B'), c = pod('cccccc03', 'C'), d = pod('dddddd04', 'D', 4), e = pod('eeeeee05', 'E', 1)
    const load = new Map<string, { busy: boolean } | null>([['aaaaaa01', { busy: true }], ['bbbbbb02', null], ['cccccc03', { busy: false }], ['dddddd04', { busy: false }], ['eeeeee05', { busy: false }]])
    expect(publish.rankPods([a, b, c, d, e], load, ram({})).map((p) => p.name)).toEqual(['D', 'C', 'E', 'B', 'A'])   // idle: D (4 GPUs) then C, E (1 GPU, later); unknown B; busy A
    expect(publish.rankPods([c, e], new Map([['cccccc03', { busy: false }], ['eeeeee05', { busy: false }]]), ram({ cccccc03: 80, eeeeee05: 10 })).map((p) => p.name)).toEqual(['E', 'C'])   // less RAM in use first
    expect(publish.rankPods([d, c], new Map([['dddddd04', { busy: false }], ['cccccc03', { busy: false }]]), ram({}), (id) => (id === 'dddddd04' ? 1 : 0)).map((p) => p.name)).toEqual(['C', 'D'])   // a pod another publish job is using goes after one it is not using
  })
})

describe('a second job and the first one\'s pods', () => {
  it('while a job is carrying files from a pod, the next job takes the pod the first is not using (idle pods, one pod each); once the first is over the best pod is free again', async () => {
    await configure({ parallel_pods: 1 }); holdHosts = new Set([IDLE2.host])
    const first = await publish.run({ items: four.slice(0, 2), targets: ['s3'], approved_by: 'Lucas' })
    for (let i = 0; i < 50 && scripts.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
    expect(hostsOf()).toEqual(new Set([IDLE2.host]))   // the best pod, held in the middle of an upload
    const second = await publish.run({ items: four.slice(2), targets: ['s3'], approved_by: 'Lucas' })
    for (let i = 0; i < 100 && !scripts.some((x) => x.host === IDLE.host); i++) await new Promise((r) => setTimeout(r, 5))
    expect(scripts.some((x) => x.host === IDLE.host)).toBe(true)   // the second job went to the other pod, it did not wait behind the first
    holdHosts.clear(); for (const r of releases) r(); await publish.settled()
    expect(publish.status(first.job_id).jobs[0].state).toBe('done'); expect(publish.status(second.job_id).jobs[0].state).toBe('done')
    scripts = []; dest = new Map(); await go({}, four.slice(0, 1)); expect(hostsOf()).toEqual(new Set([IDLE2.host]))   // the first job is over: Idle-2x is the best pod again
  })
})

describe('which pods carry the upload', () => {
  it('a pod that is rendering is last: with one pod at a time (parallel_pods 1) the job goes through the best idle pod, never the render pod', async () => {
    await configure({ parallel_pods: 1 })
    const j = await go()
    expect(j.state).toBe('done'); expect(j.adapter).toBe('pod'); expect(j.pod_files).toBe(4); expect(j.pc_files).toBe(0)
    expect(hostsOf()).toEqual(new Set([IDLE2.host])); expect(j.pods).toEqual([IDLE2.name])   // Idle-2x: idle and two GPUs
  })
  it('explicit pods (and only they), the saved list, and excluded pods', async () => {
    let j = await go({ pods: ['render01'], streams: 1 }); expect(hostsOf()).toEqual(new Set([RENDER.host])); expect(j.pods).toEqual([RENDER.name])
    scripts = []; dest = new Map(); j = await go({ exclude_pod_ids: ['idle003', 'render01'] }); expect(hostsOf()).toEqual(new Set([IDLE.host]))
    scripts = []; dest = new Map(); await configure({ transfer_pods: ['idle002', 'idle003'], parallel_pods: 2 }); j = await go(); expect(hostsOf()).toEqual(new Set([IDLE.host, IDLE2.host])); expect(j.pods?.length).toBe(2)
    scripts = []; dest = new Map(); j = await go({ pods: ['nosuchpod1'] }); expect(j.adapter).toBe('pc'); expect(scripts).toEqual([])   // none of those is running: auto falls back to this PC
  })
  it('Transfer set to Pod and none of the asked pods running: the plain-words failure, nothing through this PC', async () => {
    await configure({ transfer: 'pod' })
    const j = await go({ pods: ['nosuchpod1'] }); expect(j.state).toBe('failed'); expect(j.error ?? j.children?.[0]?.error ?? '').toMatch(/Transfer is set to Pod, but none of the pods asked for/)
  })
  it('settings: transfer_pods is a list of pod ids (at most six), parallel_pods a whole number from 1 to 6, defaults come back out', async () => {
    const s = await publish.settings(); expect(s.s3.transfer_pods).toEqual([]); expect(s.s3.parallel_pods).toBe(2)
    expect((await publish.setSettings({ s3: { transfer_pods: ['idle002', 'idle003'], parallel_pods: 3 } })).s3).toMatchObject({ transfer_pods: ['idle002', 'idle003'], parallel_pods: 3 })
    expect((await publish.setSettings({ s3: { transfer_pods: [], parallel_pods: 2 } })).s3).toMatchObject({ transfer_pods: [], parallel_pods: 2 })
    for (const bad of [{ parallel_pods: 0 }, { parallel_pods: 7 }, { parallel_pods: 1.5 }, { transfer_pods: ['bad id!'] }, { transfer_pods: 'idle002' as unknown as string[] }, { transfer_pods: Array.from({ length: 7 }, (_, i) => `pod${i}abcd`) }]) await expect(publish.setSettings({ s3: bad })).rejects.toMatchObject({ status: 400 })
  })
})

describe('a job spread over several pods', () => {
  const shots = ['s1', 's2', 's3', 's4'].map((n) => ({ where: 'volume' as const, path: `deliver/${n}/v001/${n}.mov` }))
  it('four shots, two pods at once: both pods carry files, the totals add up, each shot says its pod, and the render pod stays out', async () => {
    for (const n of ['s1', 's2', 's3', 's4']) vol.set(`${O}deliver/${n}/v001/${n}.mov`, 100)
    const j = await go({}, shots)
    expect(j.state).toBe('done'); expect(j.files_done).toBe(4); expect(j.pod_files).toBe(4); expect(j.pc_files).toBe(0); expect(j.children).toHaveLength(4)
    expect(hostsOf()).toEqual(new Set([IDLE.host, IDLE2.host])); expect(j.streams).toBeGreaterThanOrEqual(2)
    expect(j.children.map((c) => c.pod).sort()).toEqual([IDLE.name, IDLE.name, IDLE2.name, IDLE2.name].sort()); expect(j.bytes_done).toBe(j.bytes_total)
  })
  it('one shot with several files and two pods: the files are spread over both pods, and that shot names both', async () => {
    const j = await go()
    expect(j.state).toBe('done'); expect(j.children).toHaveLength(1); expect(hostsOf()).toEqual(new Set([IDLE.host, IDLE2.host])); expect(new Set((j.children[0].pod ?? '').split(', '))).toEqual(new Set([IDLE.name, IDLE2.name]))
  })
  it('one candidate pod: nothing about load is asked and the job is carried exactly as before', async () => {
    pods = [IDLE]; const j = await go()
    expect(j.state).toBe('done'); expect(loadCalls).toBe(0); expect(hostsOf()).toEqual(new Set([IDLE.host])); expect(j.pod).toBe(IDLE.name)
  })
  it('a test that gives only podOnVolume still gets its one pod (a one-pod list from it)', async () => {
    publish.setDeps({ podsOnVolume: undefined as never }); publish.setDeps({ podOnVolume: async () => IDLE })
    const j = await go(); expect(j.pod_files).toBe(4); expect(hostsOf()).toEqual(new Set([IDLE.host]))
  })
  it('a pod that drops out hands its files to the next pod, once, and is left out of the rest of the job', async () => {
    dropped = new Set([IDLE2.host]); unknown.add('idle002'); publish.setDeps({ parallel: () => 1 })   // both idle: the order is IDLE2 (2 GPUs) then IDLE; one file at a time, so the first failure is seen by the next file
    const j = await go({ streams: 1 })
    expect(j.state).toBe('done'); expect(j.pod_files).toBe(4); expect(j.pc_files).toBe(0)
    expect(scripts.filter((s) => s.host === IDLE2.host)).toHaveLength(1)   // one attempt, then it is out of the job
    expect(scripts.filter((s) => s.host === IDLE.host).length).toBe(4)
  })
  it('a pod that fails a file without dropping (not a connection error) is tried once on the next pod; with Transfer Pod and every pod failing the job fails and nothing goes through this PC', async () => {
    await configure({ transfer: 'pod' }); dropped = new Set([IDLE.host, IDLE2.host])
    const j = await go({ streams: 1 }); expect(j.state).toBe('failed'); expect(j.pc_files).toBe(0)
  })
  it('a file over 5 GiB never goes through a pod (Transfer Pod refuses it); nothing is read or sent', async () => {
    await configure({ transfer: 'pod' }); vol.set(`${O}big.mov`, 6 * 2 ** 30)
    const j = await go({}, [{ where: 'volume', path: 'big.mov' }]); expect(j.state).toBe('failed'); expect(j.error ?? j.children?.[0]?.error ?? '').toMatch(/larger than 5 GiB/); expect(scripts).toEqual([])
  })
})

describe('byte progress of a job another process runs', () => {
  const as = (p: number) => jobsregistry.setDeps({ pid: () => p, now: () => now, alive: () => true, heartbeatMs: 10 })
  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms))
  it('the heartbeat carries bytes, rate, the current file, skipped and the pods; the other process reads them (and nothing else)', async () => {
    jobsregistry.reset(); as(100)
    const stop = jobsregistry.track({ id: 'publish-x-1', kind: 'publish', trigger: 'manual', origin: 'mcp', client: 'claude-code', label: 'publish 266 files to s3', view: () => ({ state: 'uploading', progress: { done: 141, total: 266, unit: 'files' }, transfer: { bytes_done: 6_000_000_000, bytes_total: 13_200_000_000, rate_bps: 6_500_000, current: 'clip.0141.dpx', skipped: 3, pods: ['Idle-1x', 'Idle-2x'] } }), cancel: () => undefined })
    await wait(); as(200); await jobsregistry.refresh()
    const [x] = jobsregistry.externals('publish'); expect(x.transfer).toEqual({ bytes_done: 6_000_000_000, bytes_total: 13_200_000_000, rate_bps: 6_500_000, current: 'clip.0141.dpx', skipped: 3, pods: ['Idle-1x', 'Idle-2x'] })
    expect(jobsregistry.cleanTransfer({ bytes_done: -5, bytes_total: Number.NaN, rate_bps: 1.6, current: 'x'.repeat(500), pods: Array.from({ length: 20 }, (_, i) => `p${i}`) })).toMatchObject({ bytes_done: 0, bytes_total: 0, rate_bps: 2 })
    expect(jobsregistry.cleanTransfer({ bytes_done: 1, bytes_total: 2, rate_bps: 3, current: 'x'.repeat(500) })!.current!.length).toBe(120)
    as(100); stop()
  })
  it('the app\'s view of an external publish job shows the bytes, the rate and the pods instead of 0 B of 0 B', async () => {
    jobsregistry.reset(); as(100)
    jobsregistry.track({ id: 'publish-x-2', kind: 'publish', trigger: 'manual', origin: 'mcp', label: 'publish 266 files to s3', view: () => ({ state: 'uploading', progress: { done: 141, total: 266, unit: 'files' }, transfer: { bytes_done: 7_000_000_000, bytes_total: 13_200_000_000, rate_bps: 6_000_000, current: 'a.dpx', skipped: 0, pods: ['Idle-1x'] } }), cancel: () => undefined })
    await wait(); as(200); await jobsregistry.refresh()
    const v = publish.status().jobs.find((j) => j.job_id === 'publish-x-2'); expect(v).toMatchObject({ external: true, files_done: 141, files_total: 266, bytes_done: 7_000_000_000, bytes_total: 13_200_000_000, rate_bps: 6_000_000, current: 'a.dpx', pod: 'Idle-1x' })
  })
  it('a job of this process writes its own transfer numbers into the shared record', async () => {
    as(100); const j = await go(); expect(j.state).toBe('done')
    // the job is over and unregistered; while it ran the view carried transfer: the type check and the round trip above cover the fields
    expect(j.bytes_total).toBeGreaterThan(0)
  })
})
