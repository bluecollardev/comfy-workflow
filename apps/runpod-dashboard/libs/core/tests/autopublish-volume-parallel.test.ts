import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as autopublish from '../src/autopublish.js'
import * as publish from '../src/publish.js'
import * as dpxprep from '../src/dpxprep.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 amendment (2026-11-21): the volume scan lists and reads with a bounded pool. Fakes only: a volume tree in a map and a fake aws that counts what runs at once.
vi.setConfig({ testTimeout: 30_000 })
const VOLB = 'vol1', D = 'comfy-shared/output/deliver/', MIN = 60_000
let dir: string, t: number, volume: Map<string, string>, mtimes: Map<string, string>, calls: string[][]
let active: { ls: number; cp: number }, peak: { ls: number; cp: number }, delayMs: number, hangPrefix: string | null, throttleLeft: number, throttledAt: number, peakAfterThrottle: { ls: number; cp: number }
const clock = () => t
const sidecar = (o: Record<string, unknown> = {}) => JSON.stringify({ kind: 'review', ...o })
const vreview = (shot: string, v = 'v001', o: { noSidecar?: boolean; meta?: Record<string, unknown> } = {}) => {
  const clip = `${shot.toUpperCase()}_MAIN`, d = `${D}${shot}/${v}/`
  volume.set(`${d}${clip}.mov`, 'MOVIE'); if (!o.noSidecar) volume.set(`${d}${clip}.mov.meta.json`, sidecar(o.meta)); volume.set(`${d}DELIVERY.md`, 'md')
}
const row = (k: string, n: number, at: string) => `${at} ${String(n).padStart(10)} ${k}`
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => { const x = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(x); res() }, { once: true }) })
const fakeAws: podpull.AwsRunner = async (args, _e, o) => {
  calls.push(args)
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2] ?? ''), kind = args[1] === 'ls' ? 'ls' : 'cp'
  if (!m || m[1] !== VOLB || (args[1] !== 'ls' && !(args[1] === 'cp' && args[3] === '-'))) return { code: 2, stdout: '', stderr: 'unexpected' }
  active[kind]++; peak[kind] = Math.max(peak[kind], active[kind]); if (throttledAt) peakAfterThrottle[kind] = Math.max(peakAfterThrottle[kind], active[kind])
  try {
    if (hangPrefix && m[2].startsWith(hangPrefix)) { await new Promise<void>((res) => o?.signal?.addEventListener('abort', () => res(), { once: true })); return { code: 130, stdout: '', stderr: '' } }
    if (delayMs) await sleep(delayMs, o?.signal)
    if (o?.signal?.aborted) return { code: 130, stdout: '', stderr: '' }
    if (throttleLeft > 0) { throttleLeft--; throttledAt = calls.length; peakAfterThrottle = { ls: 0, cp: 0 }; return { code: 1, stdout: '', stderr: 'An error occurred (SlowDown) when calling the ListObjectsV2 operation: Please reduce your request rate.' } }
    if (kind === 'cp') return volume.has(m[2]) ? { code: 0, stdout: volume.get(m[2])!, stderr: '' } : { code: 1, stdout: '', stderr: '404 Not Found' }
    const pre = m[2], under = [...volume].filter(([k]) => k.startsWith(pre)).sort(), pres = new Set<string>(), files: string[] = []
    for (const [k, b] of under) { const r = k.slice(pre.length); if (r.includes('/')) pres.add(`${r.split('/')[0]}/`); else files.push(row(r, Buffer.byteLength(b), mtimes.get(k) ?? '2026-11-18 10:00:00')) }
    return { code: pres.size || files.length ? 0 : 1, stdout: [...[...pres].map((x) => `                           PRE ${x}`), ...files].join('\n'), stderr: '' }
  } finally { active[kind]-- }
}
const scan = () => autopublish.scanVolume()
const rows = async () => { const why = Object.fromEntries((await autopublish.statusNow()).watching.skipped.map((x) => [`${x.shot}/${x.version}`, x.reason])); return (await autopublish.reviews()).reviews.map((r) => ({ shot: r.shot, version: r.version, complete: r.complete, why: why[`${r.shot}/${r.version}`] ?? null, files: r.files.map((f) => `${f.name}:${f.bytes}`) })) }
const calls_of = (kind: string, re?: RegExp) => calls.filter((c) => c[1] === kind && (!re || re.test(c[2] ?? ''))).length

beforeEach(async () => {
  dir = scratch(); const out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env')
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  volume = new Map(); mtimes = new Map(); calls = []; t = Date.parse('2026-11-19T10:00:00'); active = { ls: 0, cp: 0 }; peak = { ls: 0, cp: 0 }; delayMs = 0; hangPrefix = null; throttleLeft = 0; throttledAt = 0; peakAfterThrottle = { ls: 0, cp: 0 }
  publish.reset(); autopublish.reset(); dpxprep.reset()
  publish.setDeps({ aws: fakeAws, outputRoot: () => out, now: clock, volumeId: () => VOLB, findFfmpeg: async () => null, podInfo: async () => null,
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  autopublish.setDeps({ now: clock, outputRoot: () => out })
  await publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: 'my-bucket', prefix: 'renders', region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' } })
  await autopublish.setSettings({ scope: 'all', sources: { local: false, volume: true } })
})
afterEach(() => {
  Object.assign(autopublish.volumeScanLimits, { listMs: 60_000, scanMs: 5 * 60_000, graceMs: 5_000 }); Object.assign(autopublish.volumeScanPool, { list: 6, read: 8, retries: 2, backoffMs: 400 })
  autopublish.reset(); dpxprep.reset(); publish.reset(); for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
})
const fill = (shots = 12, versions = 2) => { for (let i = 0; i < shots; i++) for (let v = 1; v <= versions; v++) vreview(`s-${String(i).padStart(3, '0')}`, `v${String(v).padStart(3, '0')}`) }

describe('the volume scan with a bounded pool', () => {
  it('never has more listings than `list` or reads than `read` at once, and does use the pool', async () => {
    fill(12, 2); delayMs = 8
    expect(await scan()).toMatchObject({ scanned: true, reviews: 24 })
    expect(peak.ls).toBeLessThanOrEqual(autopublish.volumeScanPool.list); expect(peak.ls).toBeGreaterThan(1)
    expect(peak.cp).toBeLessThanOrEqual(autopublish.volumeScanPool.read); expect(peak.cp).toBeGreaterThan(1)
    expect(autopublish.volumeScanStats()).toMatchObject({ lists: 1 + 12 + 24, reads: 24, reused: 0, throttled: 0 })
    Object.assign(autopublish.volumeScanPool, { list: 2, read: 3 }); autopublish.reset(); calls.length = 0; peak = { ls: 0, cp: 0 }; t += MIN
    expect(await scan()).toMatchObject({ scanned: true, reviews: 24 }); expect(peak.ls).toBeLessThanOrEqual(2); expect(peak.cp).toBeLessThanOrEqual(3)
  })
  it('gives the serial walk\'s result on the same fixture, in the same order, whatever the insertion order and pool', async () => {
    for (const s of ['c-003', 'a-001', 'b-002']) for (const v of ['v002', 'v001']) vreview(s, v)
    vreview('d-004', 'v001', { noSidecar: true }); vreview('e-005', 'v001', { meta: { kind: 'proxy' } }); volume.set(`${D}f-006/v001/`, ''); volume.set(`${D}a-001/notes.txt`, 'loose')
    Object.assign(autopublish.volumeScanPool, { list: 1, read: 1 }); await scan(); const serial = await rows()
    expect(serial.map((r) => `${r.shot}/${r.version}`)).toEqual(['a-001/v001', 'a-001/v002', 'b-002/v001', 'b-002/v002', 'c-003/v001', 'c-003/v002', 'd-004/v001', 'e-005/v001'])
    expect(serial.find((r) => r.shot === 'd-004')).toMatchObject({ complete: false, why: 'a sidecar (.meta.json) is missing' })
    Object.assign(autopublish.volumeScanPool, { list: 6, read: 8 }); autopublish.reset(); t += MIN; delayMs = 3; await scan()
    expect(await rows()).toEqual(serial)
  })
  it('a hung request stops that scan with a reason; the others are not blocked and nothing stays running', async () => {
    fill(6, 2); hangPrefix = `${D}s-003/v001/`; Object.assign(autopublish.volumeScanLimits, { listMs: 60 })
    const t0 = Date.now(), r = await scan()
    expect(r.scanned).toBe(false); expect(r.error).toMatch(/Listing the volume took longer than 0\.06 seconds/); expect(Date.now() - t0).toBeLessThan(3000)
    const w = (await autopublish.statusNow()).watching.volume; expect(w).toMatchObject({ scanning: false, scan_started_at: null, scan_progress: null }); expect(w.scan_error?.reason).toMatch(/took longer/)
    await sleep(60); const n = calls.length; await sleep(120); expect(calls.length).toBe(n)   // no worker keeps asking
    hangPrefix = null; Object.assign(autopublish.volumeScanLimits, { listMs: 60_000 }); t += MIN; expect(await scan()).toMatchObject({ scanned: true, reviews: 12 })
  })
  it('a slow-down answer halves the pool for the rest of the scan, backs off, and is retried at most twice', async () => {
    fill(8, 2); delayMs = 4; throttleLeft = 1; Object.assign(autopublish.volumeScanPool, { backoffMs: 5 })
    expect(await scan()).toMatchObject({ scanned: true, reviews: 16 })
    const st = autopublish.volumeScanStats()!; expect(st.throttled).toBe(1); expect(st.pool).toEqual({ list: 3, read: 4 })
    expect(peakAfterThrottle.ls).toBeLessThanOrEqual(3 + 0); expect(peakAfterThrottle.cp).toBeLessThanOrEqual(4)
    // always limited: the first listing is asked 1 + retries (2) = 3 times, then the scan fails with the reason and keeps the last good result
    autopublish.reset(); calls.length = 0; throttleLeft = 1_000; t += MIN
    const r = await scan(); expect(r.scanned).toBe(false); expect(r.error).toMatch(/SlowDown|limiting|reduce your request rate/i); expect(calls_of('ls')).toBe(1 + autopublish.volumeScanPool.retries)
    expect(autopublish.volumeScanStats()!.pool).toEqual({ list: 1, read: 2 })
  })
  it('a slow-down on a sidecar read is retried, never read as an empty sidecar', async () => {
    vreview('a-001', 'v001', { meta: { colour_verdict: 'refused' } }); Object.assign(autopublish.volumeScanPool, { backoffMs: 5 })
    let first = true; const real = fakeAws
    publish.setDeps({ aws: async (a, e, o) => { if (a[1] === 'cp' && a[3] === '-' && first) { first = false; return { code: 1, stdout: '', stderr: 'An error occurred (SlowDown) when calling the GetObject operation' } } return real(a, e, o) } })
    await scan(); expect((await rows())[0]).toMatchObject({ shot: 'a-001', complete: false, why: 'the sidecar says the colour was refused' }); expect(autopublish.volumeScanStats()!.throttled).toBe(1)
  })
  it('a folder that has not changed is not read again; only the one that changed is', async () => {
    fill(5, 2); await scan(); expect(calls_of('cp')).toBe(10); const first = await rows()
    calls.length = 0; t += MIN; await scan(); expect(calls_of('cp')).toBe(0); expect(autopublish.volumeScanStats()).toMatchObject({ reused: 10, reads: 0 }); expect(await rows()).toEqual(first)
    calls.length = 0; t += MIN; volume.set(`${D}s-002/v002/S-002_MAIN.mov.meta.json`, sidecar({ colour_verdict: 'refused', filler: 'x' })); mtimes.set(`${D}s-002/v002/S-002_MAIN.mov.meta.json`, '2026-11-19 11:00:00')
    await scan(); expect(calls_of('cp')).toBe(1); expect(autopublish.volumeScanStats()).toMatchObject({ reused: 9, reads: 1 }); expect((await rows()).find((r) => r.shot === 's-002' && r.version === 'v002')).toMatchObject({ complete: false, why: 'the sidecar says the colour was refused' })
    calls.length = 0; t += MIN; volume.delete(`${D}s-004/v002/S-004_MAIN.mov`); volume.delete(`${D}s-004/v002/S-004_MAIN.mov.meta.json`); volume.delete(`${D}s-004/v002/DELIVERY.md`); await scan(); expect((await rows()).length).toBe(9)   // a folder that is gone is gone
  })
  it('a sidecar that could not be read is tried again at the next scan', async () => {
    vreview('a-001'); const key = `${D}a-001/v001/A-001_MAIN.mov.meta.json`; const real = fakeAws; let fail = true
    publish.setDeps({ aws: async (a, e, o) => (fail && a[1] === 'cp' && a[2]?.endsWith('meta.json') ? { code: 1, stdout: '', stderr: '404 Not Found' } : real(a, e, o)) })
    await scan(); expect(autopublish.volumeScanStats()).toMatchObject({ reads: 1, reused: 0 }); fail = false; calls.length = 0; t += MIN; await scan(); expect(autopublish.volumeScanStats()).toMatchObject({ reads: 1, reused: 0 }); expect(volume.has(key)).toBe(true)
  })
  it('is much faster than the serial walk on the same fixture (25 shots, 4 versions, 6 ms a request) and the second scan reads nothing', async () => {
    fill(25, 4); delayMs = 6
    Object.assign(autopublish.volumeScanPool, { list: 1, read: 1 }); let t0 = Date.now(); await scan(); const serial = Date.now() - t0; const sst = autopublish.volumeScanStats()!
    Object.assign(autopublish.volumeScanPool, { list: 6, read: 8 }); autopublish.reset(); t += MIN; t0 = Date.now(); await scan(); const parallel = Date.now() - t0; const pst = autopublish.volumeScanStats()!
    expect(sst).toMatchObject({ lists: 1 + 25 + 100, reads: 100 }); expect(pst).toMatchObject({ lists: 1 + 25 + 100, reads: 100 })   // the same requests, in a pool
    expect(parallel).toBeLessThan(serial / 2); t += MIN; t0 = Date.now(); await scan(); const again = Date.now() - t0
    expect(autopublish.volumeScanStats()).toMatchObject({ lists: 1 + 25 + 100, reads: 0, reused: 100 }); expect(again).toBeLessThan(serial / 3)
    console.log(`scan 25 shots x 4 versions, 6 ms a request: serial ${serial} ms (${sst.requests} requests one after the other), pool ${parallel} ms, unchanged rescan ${again} ms (${autopublish.volumeScanStats()!.requests} requests, 0 reads)`)
  })
  it('cancelling stops every worker; scanning is reset and no request is made afterwards', async () => {
    fill(20, 3); delayMs = 40
    const p = scan(); await sleep(30); autopublish.cancelVolumeScan(); const r = await p
    expect(r.scanned).toBe(false); expect(r.error).toMatch(/cancelled/); expect((await autopublish.statusNow()).watching.volume).toMatchObject({ scanning: false, scan_progress: null })
    await sleep(100); const n = calls.length; await sleep(150); expect(calls.length).toBe(n); expect(n).toBeLessThan(1 + 20 + 60)
  })
  it('reports how far the scan is while it runs and nothing when it is idle', async () => {
    fill(10, 2); delayMs = 25
    const p = scan(); const seen: { shots_done: number; shots_total: number; versions_done: number }[] = []
    for (let i = 0; i < 12; i++) { await sleep(20); const v = (await autopublish.statusNow()).watching.volume; if (v.scan_progress) seen.push({ ...v.scan_progress }) }
    await p; expect(seen.length).toBeGreaterThan(0); expect(seen.some((x) => x.shots_total === 10)).toBe(true); expect(Math.max(...seen.map((x) => x.shots_done))).toBeGreaterThan(0)
    expect((await autopublish.statusNow()).watching.volume.scan_progress).toBeNull()
  })
})
