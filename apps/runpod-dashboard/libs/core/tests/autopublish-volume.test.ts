import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as autopublish from '../src/autopublish.js'
import * as publish from '../src/publish.js'
import * as dpxprep from '../src/dpxprep.js'
/** The fix itself (ssh to a pod) is faked: the plan says what the sequence is, the run copies the frames into the corrected folder of the fake volume (ADR-057 decision 7). */
let fixRuns = 0
const fakeFix = (clip: string, srcDir: string, stem: string, o: { expected?: number | null; ok?: boolean; why?: string; runFails?: boolean } = {}) => {
  const src = () => [...volume.keys()].filter((k) => k.startsWith(`comfy-shared/output/${srcDir}/${stem}.`))
  dpxprep.setDeps({
    plan: async (a) => ({ rows: a.items!.map((i) => ({ src_dir: i.src_dir ?? '', stem: i.stem ?? '', clip, frames: src().length, expected_frames: o.expected ?? null, start_timecode: '01:00:00:00', timecode_source: 'EDL', fps: 23.976, ok: o.ok !== false, why: o.why ?? '' })), settings: {} as never }),
    run: async (a) => { fixRuns++; if (o.runFails) throw new Error('ssh dropped'); for (const k of src()) volume.set(`comfy-shared/output/_delivery_v11/${clip}/${clip}${k.slice(k.lastIndexOf('.', k.length - 5))}`, volume.get(k)!); return { results: a.items!.map((i) => ({ clip: i.clip, frames: src().length, out_dir: `_delivery_v11/${i.clip}`, ok: true })), out_root: '', settings: {} as never } },
    pods: async () => [{ id: 'p1', name: 'pod' }],
  })
}
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 "Auto-publish sources: this PC and/or the volume". Fakes only: a volume tree in a map, a fake aws, fake processes.
vi.setConfig({ testTimeout: 30_000 })
const VOLB = 'vol1', D = 'comfy-shared/output/deliver/', MIN = 60_000
let dir: string, out: string, t: number, volume: Map<string, string>, dest: Map<string, number>, bodies: Map<string, string>, calls: string[][], spawned: string[][], volFail: boolean, hang: boolean
const clock = () => t
const write = (rel: string, body = 'x') => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body) }
const sidecar = (o: Record<string, unknown> = {}) => JSON.stringify({ kind: 'review', ...o })
/** A review on the volume: the movie, its sidecar and DELIVERY.md (or a variation). */
const vreview = (shot: string, v = 'v001', o: { noSidecar?: boolean; meta?: Record<string, unknown>; extra?: Record<string, string>; clip?: string } = {}) => {
  const clip = o.clip ?? `${shot.toUpperCase()}_MAIN`, d = `${D}${shot}/${v}/`
  volume.set(`${d}${clip}.mov`, 'MOVIE'); if (!o.noSidecar) volume.set(`${d}${clip}.mov.meta.json`, sidecar(o.meta)); volume.set(`${d}DELIVERY.md`, 'md')
  for (const [k, b] of Object.entries(o.extra ?? {})) volume.set(`${d}${k}`, b)
}
const lreview = (shot: string, v = 'v001') => { const d = `deliver/${shot}/${v}`; write(`${d}/${shot.toUpperCase()}_MAIN.mov`, 'LOCALMOVIE'); write(`${d}/${shot.toUpperCase()}_MAIN.mov.meta.json`, sidecar()); write(`${d}/DELIVERY.md`, 'md') }
const row = (k: string, n: number) => `2026-11-18 10:00:00 ${String(n).padStart(10)} ${k}`
const fakeAws: podpull.AwsRunner = async (args, _e, o) => {
  calls.push(args)
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2] ?? '')
  if (args[1] === 'ls' && m) {
    const store = m[1] === VOLB ? volume : new Map([...dest].map(([k, n]) => [k, 'x'.repeat(n)])), pre = m[2], rec = args.includes('--recursive')
    if (m[1] === VOLB) { if (hang) return new Promise((res) => o?.signal?.addEventListener('abort', () => res({ code: 130, stdout: '', stderr: '' }))); if (volFail) return { code: 1, stdout: '', stderr: 'An error occurred (503) when calling the ListObjectsV2 operation: Service Unavailable' } }
    const under = [...store].filter(([k]) => k.startsWith(pre)).sort(), pres = new Set<string>(), files: string[] = []
    for (const [k, b] of under) { const r = k.slice(pre.length); if (!rec && r.includes('/')) pres.add(`${r.split('/')[0]}/`); else files.push(row(rec ? k : r, Buffer.byteLength(b))) }
    return { code: pres.size || files.length ? 0 : 1, stdout: [...[...pres].map((x) => `                           PRE ${x}`), ...files].join('\n'), stderr: '' }
  }
  if (args[1] === 'cp' && args[3] === '-' && m) { if (m[1] === VOLB) return volume.has(m[2]) ? { code: 0, stdout: volume.get(m[2])!, stderr: '' } : { code: 1, stdout: '', stderr: '404 Not Found' }; return bodies.has(m[2]) ? { code: 0, stdout: bodies.get(m[2])!, stderr: '' } : { code: 1, stdout: '', stderr: '404 Not Found' } }
  if (args[1] === 'cp') { const { readFile } = await import('node:fs/promises'); const body = await readFile(args[2], 'utf8'); dest.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), Buffer.byteLength(body)); bodies.set(args[3].replace(/^s3:\/\/[^/]+\//, ''), body); return { code: 0, stdout: '', stderr: '' } }
  if (args[1] === 'presign') return { code: 0, stdout: 'https://s3.example/x?X-Amz-Signature=s\n', stderr: '' }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_c: string, args: string[]): ChildProcess => {
  spawned.push(args)
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }, so = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: new PassThrough(), stdin: si })
  const close = (n: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', n) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { setImmediate(() => close(null)); return true }
  if (args[3] === '-') { const key = args[2].replace(/^s3:\/\/[^/]+\//, ''); setImmediate(() => { so.write(volume.get(key) ?? ''); so.end(); setImmediate(() => close(0)) }) }
  else if (args[2] === '-') { let body = ''; si.on('data', (d) => { body += String(d) }); si.on('end', () => { const k = args[3].replace(/^s3:\/\/[^/]+\//, ''); bodies.set(k, body); dest.set(k, Buffer.byteLength(body)); setImmediate(() => close(0)) }) }
  return c
}
const fakeFetch = (async () => new Response('ok')) as unknown as typeof fetch
const ON = { enabled: true, approved_by: 'Lucas', understood: true, require_approval: true }   // these tests are of the approval gate; the default (false) is tested in the pipeline tests
const approve = (shot: string, v = 'v001') => autopublish.approve({ shot, version: v, approved_by: 'Brynley' })
const scan = () => autopublish.scanVolume()
const reviews = async () => (await autopublish.reviews()).reviews
const pend = () => autopublish.status().pending

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  volume = new Map(); dest = new Map(); bodies = new Map(); calls = []; spawned = []; volFail = false; hang = false; t = Date.parse('2026-11-19T10:00:00')
  publish.reset(); autopublish.reset(); dpxprep.reset(); fixRuns = 0
  publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, now: clock, spawn: fakeSpawn, volumeId: () => VOLB, findFfmpeg: async () => null, podInfo: async () => null,
    volumeAccess: async () => ({ ok: true, id: 'RPKEY', secret: 'RPSECRET', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: VOLB, region: 'EU-RO-1' }) })
  autopublish.setDeps({ now: clock, outputRoot: () => out })
  await publish.setSettings({ s3: { layout: 'as-is', credentials: 'app', bucket: 'my-bucket', prefix: 'renders', region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' }, slack: { preview_frame: false, volume_source: false, file_links: false, folder_link: false } })
})
afterEach(() => { autopublish.reset(); dpxprep.reset(); publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('the sources and the scan', () => {
  it('both places by default; both off is a 400; each can be turned off alone', async () => {
    expect(await autopublish.settings()).toMatchObject({ sources: { local: true, volume: true }, volume_scan_minutes: 5 })
    await expect(autopublish.setSettings({ sources: { local: false, volume: false } })).rejects.toMatchObject({ status: 400, message: 'Choose at least one place to watch' }); await expect(autopublish.setSettings({ volume_scan_minutes: 0 })).rejects.toMatchObject({ status: 400 }); await expect(autopublish.setSettings({ sources: { volume: 'x' as never } })).rejects.toMatchObject({ status: 400 })
    lreview('a-001'); vreview('b-002'); await scan(); expect((await reviews()).map((r) => [r.shot, r.source])).toEqual([['a-001', 'local'], ['b-002', 'volume']])
    await autopublish.setSettings({ sources: { volume: false }, volume_scan_minutes: 30 }); expect((await reviews()).map((r) => r.shot)).toEqual(['a-001']); expect((await scan()).scanned).toBe(false)
    await autopublish.setSettings({ sources: { local: false, volume: true } }); expect((await reviews()).map((r) => [r.shot, r.source])).toEqual([['b-002', 'volume']]); expect((await autopublish.settings()).volume_scan_minutes).toBe(30)
  })
  it('lists only deliver/ one level at a time (never the whole tree), reads each sidecar as a small object, and this PC wins when both have a version', async () => {
    vreview('a-001'); vreview('a-001', 'v002'); vreview('b-002'); lreview('b-002'); volume.set('comfy-shared/output/other/big.dpx', 'x'); volume.set(`${D}a-001/notes.txt`, 'loose')
    const r = await scan(); expect(r).toMatchObject({ scanned: true, reviews: 3 }); const rows = await reviews()
    expect(rows.map((x) => [x.shot, x.version, x.source, x.on_pc])).toEqual([['a-001', 'v001', 'volume', false], ['a-001', 'v002', 'volume', false], ['b-002', 'v001', 'local', true]])   // b-002 v001 is on both: this PC's
    expect(calls.filter((c) => c[1] === 'ls').every((c) => !c.includes('--recursive'))).toBe(true); expect(calls.some((c) => /other\//.test(c[2] ?? ''))).toBe(false); expect(calls.filter((c) => c[1] === 'cp' && c[3] === '-').length).toBe(3)   // one sidecar per movie
  })
  it('the same checks as a local review: no sidecar, kind not review, partial, colour refused, a weight; a sidecar over 256 KB is not read', async () => {
    vreview('s-001', 'v001', { noSidecar: true }); vreview('s-002', 'v001', { meta: { kind: 'proxy' } }); vreview('s-003', 'v001', { meta: { colour_verdict: 'refused' } }); vreview('s-004', 'v001', { meta: { partial: true } }); vreview('s-005', 'v001', { extra: { 'm.safetensors': 'w' } }); vreview('s-006', 'v001', { extra: { 'X_partial.mov': 'p' } })
    await scan(); const w = (await autopublish.statusNow()).watching; const why = Object.fromEntries(w.skipped.map((x) => [x.shot, x.reason]))
    expect(why).toMatchObject({ 's-001': 'a sidecar (.meta.json) is missing', 's-002': 'the sidecar says this is not a review video', 's-003': 'the sidecar says the colour was refused', 's-004': 'the sidecar says it is partial', 's-005': 'a model weight is in the folder', 's-006': 'a partial file is in the folder' })
    vreview('s-007', 'v001', { meta: { filler: 'x'.repeat(300_000) } }); await scan(); expect((await reviews()).find((r) => r.shot === 's-007')!.complete).toBe(true); expect(calls.filter((c) => c[1] === 'cp' && c[3] === '-' && /s-007/.test(c[2])).length).toBe(0)   // too big to read: treated as an empty sidecar
  })
  it('caps: 500 versions and 5,000 objects; chunked (the event loop stays free); abortable; one scan at a time', async () => {
    for (let i = 0; i < 520; i++) vreview(`c-${String(i).padStart(3, '0')}`); let worst = 0, last = performance.now(); const tm = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1)
    await scan(); clearInterval(tm); expect((await reviews()).length).toBe(autopublish.VOLUME_MAX_VERSIONS); expect(worst).toBeLessThan(500)
    volume.clear(); for (let i = 0; i < 5100; i++) volume.set(`${D}d-001/v001/f${i}.txt`, 'x'); vreview('d-002'); await scan(); expect((await reviews()).length).toBe(0)   // the object cap stopped the scan inside the first version
    volume.clear(); vreview('e-001'); calls.length = 0; hang = true; const p = autopublish.scanVolume(); const q = autopublish.scanVolume(); await new Promise((r) => setTimeout(r, 20)); autopublish.cancelVolumeScan(); const [a, b] = await Promise.all([p, q]); expect(a.scanned).toBe(false); expect(b.error).toMatch(/cancelled/); expect(calls.filter((c) => c[1] === 'ls').length).toBeLessThan(10)
  })
  it('the scan timer: volume_scan_minutes apart, only when Auto-publish is on and the volume is watched; Scan now runs at once; the listing is cached between scans', async () => {
    vreview('t-001'); expect(await autopublish.volumeTick()).toBe(false)   // Auto-publish is off
    await autopublish.setSettings({ ...ON, volume_scan_minutes: 5 }); expect(await autopublish.volumeTick()).toBe(true); const n = calls.length
    expect(await autopublish.volumeTick()).toBe(false); await reviews(); await autopublish.statusNow(); await autopublish.consider(); expect(calls.length).toBe(n)   // nothing listed again: the cache
    t += 4 * MIN; expect(await autopublish.volumeTick()).toBe(false); t += 2 * MIN; expect(await autopublish.volumeTick()).toBe(true); const m = calls.length; await scan(); expect(calls.length).toBeGreaterThan(m)   // Scan now ignores the timer
    await autopublish.setSettings({ sources: { volume: false } }); t += 60 * MIN; expect(await autopublish.volumeTick()).toBe(false)
  })
})

describe('approving, publishing by streaming, and the status', () => {
  it('a version found only on the volume can be approved; one that is nowhere is a 404 that says where it looked', async () => {
    await expect(approve('z-001')).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/not been scanned yet/) }); vreview('z-001'); await scan()
    expect((await approve('z-001')).approved_by).toBe('Brynley'); await expect(approve('z-099')).rejects.toMatchObject({ status: 404, message: expect.stringMatching(/in the last volume scan \(0 min ago\)/) })
    await autopublish.setSettings({ sources: { volume: false } }); await expect(approve('y-001')).rejects.toMatchObject({ status: 404, message: 'There is no review y-001 v001 on this PC' })
  })
  it('a volume review is streamed volume -> bucket (two piped processes, no download), and with include_dpx so are the source frames the sidecar names', async () => {
    vreview('v-001', 'v001', { meta: { source_dir: 'proxy_v004/x', name: 'STEM_V' } }); for (let i = 1; i <= 3; i++) volume.set(`comfy-shared/output/proxy_v004/x/STEM_V.000${i}.dpx`, `frame${i}`); volume.set('comfy-shared/output/proxy_v004/x/OTHER.0001.dpx', 'no'); fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V')
    await scan(); await approve('v-001'); await autopublish.setSettings({ ...ON, window_minutes: 0, include_dpx: true }); await autopublish.setSettings({ dry_run: false, understood: true }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    expect([...dest.keys()].sort()).toEqual(['renders/deliver/v-001/v001/V-001_MAIN.mov', 'renders/deliver/v-001/v001/V-001_MAIN.mov.meta.json', 'renders/deliver/v-001/v001/DELIVERY.md', 'renders/_delivery_v11/STEM_V/STEM_V.0001.dpx', 'renders/_delivery_v11/STEM_V/STEM_V.0002.dpx', 'renders/_delivery_v11/STEM_V/STEM_V.0003.dpx'].sort())   // the corrected copies, never the original frames of proxy_v004/x
    expect(spawned.filter((a) => a[3] === '-').length).toBe(6); expect(spawned.filter((a) => a[3] === '-')[0].slice(0, 2)).toEqual(['s3', 'cp']); expect(calls.some((c) => c[1] === 'cp' && c[2] !== undefined && !String(c[2]).startsWith('s3://') && c[3] !== '-' && /v-001/.test(c[3]))).toBe(false)   // nothing was copied from a local file
    expect(bodies.get('renders/deliver/v-001/v001/V-001_MAIN.mov')).toBe('MOVIE'); expect((await autopublish.statusNow()).recent[0]).toMatchObject({ state: 'done', shot: 'v-001' })
  })
  it('a sidecar the pod left a value empty in (invalid JSON) is repaired, so the source frames still go; one that cannot be read at all holds the review with a reason', async () => {
    expect(autopublish.parseSidecar('{"a": 1, "outputs": [ {"render_fps": \n  } ], "name": "S"}')).toMatchObject({ a: 1, name: 'S', outputs: [{ render_fps: null }] })
    expect(autopublish.parseSidecar('not json at all')).toEqual({ unreadable: true })
    vreview('v-001', 'v001', { meta: { source_dir: 'proxy_v004/x', name: 'STEM_V' } }); volume.set(`${D}v-001/v001/V-001_MAIN.mov.meta.json`, '{"source_dir": "proxy_v004/x", "name": "STEM_V", "outputs": [ {"render_fps": \n  } ]}')
    for (let i = 1; i <= 3; i++) volume.set(`comfy-shared/output/proxy_v004/x/STEM_V.000${i}.dpx`, `frame${i}`)
    fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V'); vreview('b-002'); volume.set(`${D}b-002/v001/B-002_MAIN.mov.meta.json`, 'garbage{')
    await scan(); await approve('v-001'); await approve('b-002'); await autopublish.setSettings({ ...ON, window_minutes: 0, include_dpx: true }); await autopublish.setSettings({ dry_run: false, understood: true }); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    expect([...dest.keys()].filter((k) => /\.dpx$/.test(k)).sort()).toEqual(['renders/_delivery_v11/STEM_V/STEM_V.0001.dpx', 'renders/_delivery_v11/STEM_V/STEM_V.0002.dpx', 'renders/_delivery_v11/STEM_V/STEM_V.0003.dpx'])   // the corrected frames went although the sidecar had an empty value
    expect([...dest.keys()].some((k) => /b-002/i.test(k))).toBe(false)   // the unreadable one was not uploaded without its frames
    expect(JSON.stringify((await autopublish.statusNow()).watching.skipped)).toMatch(/b-002[^]*cannot be read/)
  })
  it('a volume review needs its approval like any other: scanning more places never uploads more by itself', async () => {
    vreview('n-001'); await autopublish.setSettings({ ...ON, window_minutes: 0 }); await autopublish.setSettings({ dry_run: false, understood: true }); await scan(); await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); expect(dest.size).toBe(0); expect(pend()).toEqual([])
  })
  it('a volume that cannot be listed (503) is reported in the status and does not break the local side', async () => {
    lreview('l-001'); await approve('l-001'); await autopublish.setSettings({ ...ON, window_minutes: 10 }); volFail = true; const r = await scan(); expect(r).toMatchObject({ scanned: false, error: expect.stringMatching(/503/) })
    const w = (await autopublish.statusNow()).watching; expect(w.volume.error).toMatch(/503/); expect(w.summary).toContain('it could not be listed'); await autopublish.consider(); expect(pend().map((p) => p.shot)).toEqual(['l-001'])   // the local review is queued all the same
    volFail = false; t += 11_000; expect((await scan()).scanned).toBe(true); expect((await autopublish.statusNow()).watching.volume.error).toBeUndefined()
  })
  it('status.watching names both places and says what it sees; no secret anywhere in it', async () => {
    await autopublish.setSettings({ require_approval: true }); lreview('a-001'); vreview('b-002'); vreview('b-003'); await scan(); t += 2 * MIN
    let w = (await autopublish.statusNow()).watching; expect(w).toMatchObject({ local: { enabled: true, root: out, root_exists: true, reviews: 1 }, volume: { enabled: true, id: 'vol1', reviews: 2, scanning: false }, reviews: 3, approved: 0 }); expect(w.volume.scanned_at).toBe(new Date(t - 2 * MIN).toISOString())
    expect(w.summary).toBe('Watching this PC (1 review) and the volume (2 reviews, scanned 2 minutes ago): none approved yet (Approve a review, or Binc says yes)')
    await approve('b-002'); await autopublish.setSettings({ sources: { local: false } }); t += 11_000; w = (await autopublish.statusNow()).watching; expect(w.summary).toMatch(/^Watching the volume \(2 reviews, scanned 2 minutes ago\): 1 approved, 0 waiting for their window$/); expect(w.local.enabled).toBe(false)
    expect(JSON.stringify(await autopublish.statusNow())).not.toMatch(/RPKEY|RPSECRET|AKIA|secretsecret/)
  })
})

describe('Auto-publish is a pipeline: no approval record needed (require_approval false, the default)', () => {
  const pending = async () => (await autopublish.statusNow()).pending
  it('a valid VOLUME review queues with no approval record, under the standing approver; a held one does not, until released; require_approval true keeps the old gate', async () => {
    vreview('b-002'); vreview('c-003')
    await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, require_approval: false, sources: { local: false, volume: true } }); expect((await autopublish.settings()).require_approval).toBe(false)
    await autopublish.hold({ shot: 'c-003', version: 'v001' }); await scan(); await autopublish.consider()
    expect((await pending()).map((e) => [e.shot, e.state, e.approved_by])).toEqual([['b-002', 'would_upload', 'Lucas']])   // dry run first; the standing approver is named; the held one is not there
    const w = (await autopublish.statusNow()).watching; expect(w.summary).not.toMatch(/none approved/); expect(w.summary).toMatch(/1 eligible|eligible/); expect(w.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ shot: 'c-003', reason: 'held by a person' })]))
    await autopublish.release({ shot: 'c-003', version: 'v001' }); await autopublish.consider(); expect((await pending()).map((e) => e.shot).sort()).toEqual(['b-002', 'c-003'])
    await autopublish.off(); await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, require_approval: true }); await autopublish.consider(); expect(await pending()).toEqual([])   // approvals required: none approved, nothing queues
    t += 11_000; expect((await autopublish.statusNow()).watching.summary).toMatch(/none approved yet/); await approve('b-002'); await autopublish.consider(); expect((await pending()).map((e) => e.shot)).toEqual(['b-002'])
  })
  it('LIVE with require_approval false: the queued volume review uploads when its window ends; the send-time check must not need an approval record (it cancelled as "approval revoked")', async () => {
    vreview('d-004')
    await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, require_approval: false, sources: { local: false, volume: true }, window_minutes: 0 })
    await autopublish.setSettings({ dry_run: false, understood: true })
    await scan(); await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
    const st = await autopublish.statusNow()
    expect(st.recent.map((e) => [e.shot, e.state, e.reason])).toEqual([['d-004', 'done', undefined]])
    expect([...dest.keys()].some((k) => k.includes('d-004'))).toBe(true)
  })
})

describe('the version of a volume review is its folder name, never an empty folder', () => {
  it('v001 and v002 are empty folders left by failed renders and v003 holds the review: the entry, the status and the key all say v003; an empty folder is not a review', async () => {
    volume.set(`${D}archival-084/v001/`, ''); volume.set(`${D}archival-084/v002/`, ''); vreview('archival-084', 'v003', { clip: 'archival-084_main_mono_v015_NOT_RELEASED' })
    await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, require_approval: false, sources: { local: false, volume: true } }); await scan(); await autopublish.consider()
    const rows = (await autopublish.reviews()).reviews.filter((r) => r.shot === 'archival-084'); expect(rows.filter((r) => r.complete).map((r) => r.version)).toEqual(['v003']); expect(rows.map((r) => r.version)).toEqual(['v003'])   // the empty v001 and v002 are not reviews: not listed, not counted
    expect((await autopublish.statusNow()).watching).toMatchObject({ reviews: 1, volume: { reviews: 1 } })
    const p = (await autopublish.statusNow()).pending; expect(p.map((e) => [e.shot, e.version, e.files])).toEqual([['archival-084', 'v003', 3]]); await autopublish.cancel({ id: p[0].id })
    const r = (await autopublish.statusNow()).recent[0]; expect(r).toMatchObject({ shot: 'archival-084', version: 'v003', state: 'cancelled' })
  })
})

describe('the EDL judges a return in a dry run as in a live one; a _TEST_ round waives only the frame count (ADR-050)', () => {
  const STEM = 'ARCHIVAL-080_A_STILL_V01_3840X2160_24_PNG'
  const setup = async (round: string) => {
    const edl = await import('../src/edl.js'); edl.reset(); await edl.load({ source: { file: join(import.meta.dirname, 'fixtures', 'v11-excerpt.edl') } })
    vreview('archival-080', 'v001', { clip: STEM, meta: { source_dir: 'proxy_v004/x', name: STEM, first: 1, last: 3 } }); for (const n of [1, 2, 3]) volume.set(`comfy-shared/output/proxy_v004/x/${STEM}.${String(n).padStart(4, '0')}.dpx`, `frame${n}`)
    await publish.setSettings({ s3: { layout: 'bkk-return', prefix: 'returns/BKK/' } })
    await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, require_approval: false, include_dpx: true, round, sources: { local: false, volume: true } }); await scan()
  }
  it('a real round: frames-differ blocks even in a dry run (skipped with the reason, never "would upload"); a _TEST_ round shows the waiver as a warning and queues', async () => {
    await setup('qc_{date}_r01'); await autopublish.consider(); let st = await autopublish.statusNow(); expect(st.pending).toEqual([]); expect(st.watching.skipped).toEqual([expect.objectContaining({ shot: 'archival-080', version: 'v001', reason: expect.stringMatching(/held back: dpx fix: .*frame count 3 of 94/) })])
    await autopublish.off(); await autopublish.setSettings({ enabled: true, approved_by: 'Lucas', understood: true, round: '_TEST_{date}' }); t += 6 * MIN; await autopublish.consider(); st = await autopublish.statusNow()
    expect(st.pending.map((e) => [e.version, e.state, e.reason])).toEqual([['v001', 'would_upload', expect.stringMatching(/EDL frame count not checked in a test round: 3 frames, the cut has 94/)]])
  })
  it('a test round still blocks not-in-edl; a round called tunnel-v11_test or _test_x is NOT a test round', async () => {
    await setup('_TEST_{date}'); const pubs = await import('../src/publish.js'); expect(pubs.isTestRound('_TEST_2026-11-19')).toBe(true); for (const r of ['tunnel-v11_test', '_test_x', 'x_TEST_', 'TEST_a']) expect(pubs.isTestRound(r), r).toBe(false)
    const p = await pubs.plan({ items: [{ where: 'volume', path: 'proxy_v004/x', stem: STEM }], targets: ['s3'], round: '_TEST_r1' }); expect(p.sequences![0]).toMatchObject({ blocked: false, notes: expect.arrayContaining(['EDL check waived: test round']) }); expect(p.sequences![0].flags.find((f) => f.code === 'frames-differ-from-edl')).toMatchObject({ level: 'warn' })
    volume.set('comfy-shared/output/proxy_v004/y/ARCHIVAL-102_MAIN-B_FINAL_V01.0001.dpx', 'a'); const n = await pubs.plan({ items: [{ where: 'volume', path: 'proxy_v004/y', stem: 'ARCHIVAL-102_MAIN-B_FINAL_V01' }], targets: ['s3'], round: '_TEST_r1', start_timecodes: { 'ARCHIVAL-102_MAIN-B_FINAL_V01': '01:00:00:00' } }); expect(n.sequences![0].blocked).toBe(true); expect(n.sequences![0].flags.map((f) => f.code)).toContain('not-in-edl')
    const r = await pubs.plan({ items: [{ where: 'volume', path: 'proxy_v004/x', stem: STEM }], targets: ['s3'], round: 'tunnel-v11_test' }); expect(r.sequences![0].blocked).toBe(true)
  })
})

describe('Auto-publish uploads the corrected copies of the DPX (ADR-057 decision 7, issue 12)', () => {
  const live = async (o: Record<string, unknown> = {}) => {
    vreview('v-001', 'v001', { meta: { source_dir: 'proxy_v004/x', name: 'STEM_V' } }); for (let i = 1; i <= 3; i++) volume.set(`comfy-shared/output/proxy_v004/x/STEM_V.000${i}.dpx`, `frame${i}`)
    await scan(); await approve('v-001'); await autopublish.setSettings({ ...ON, window_minutes: 0, include_dpx: true, ...o }); await autopublish.setSettings({ dry_run: false, understood: true })
    await autopublish.consider(); await autopublish.tick(); await autopublish.settled()
  }
  const dpxKeys = () => [...dest.keys()].filter((k) => /\.dpx$/.test(k)).sort()
  it('the upload carries the corrected copy under _delivery_v11, never the original frames', async () => {
    fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V'); await live()
    expect(dpxKeys()).toEqual([1, 2, 3].map((n) => `renders/_delivery_v11/STEM_V/STEM_V.000${n}.dpx`)); expect(dpxKeys().some((k) => /proxy_v004/.test(k))).toBe(false); expect(fixRuns).toBe(1)
    expect((await autopublish.statusNow()).recent[0]).toMatchObject({ state: 'done', shot: 'v-001' })
  })
  it('a plan that carries a flag holds the whole review back with the reason: nothing is uploaded and it is listed as skipped', async () => {
    fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V', { expected: 5 }); await live()
    expect(dest.size).toBe(0); expect(fixRuns).toBe(0)   // nothing written, nothing uploaded, not even the video
    expect(JSON.stringify((await autopublish.statusNow()).watching.skipped)).toMatch(/v-001[^]*held back: dpx fix: STEM_V: frame count 3 of 5/)
  })
  it('a fix that fails at upload holds the review (no video, no frames) and is not tried again for ten minutes', async () => {
    fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V', { runFails: true }); await live()
    expect(dest.size).toBe(0); expect(fixRuns).toBe(1); expect((await autopublish.statusNow()).recent[0]).toMatchObject({ shot: 'v-001', state: 'cancelled', reason: expect.stringMatching(/held back: dpx fix: .*ssh dropped/) })
    await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); expect(fixRuns).toBe(1)   // held for ten minutes
    t += 11 * MIN; await autopublish.consider(); await autopublish.tick(); await autopublish.settled(); expect(fixRuns).toBe(2)
  })
  it('a sequence that is not in the EDL goes as a video only, with the reason', async () => {
    dpxprep.setDeps({ plan: async (a) => ({ rows: a.items!.map((i) => ({ src_dir: i.src_dir ?? '', stem: i.stem ?? '', clip: '', frames: 3, expected_frames: null, start_timecode: '00:00:00:00', timecode_source: null, fps: 23.976, ok: false, why: 'not in the EDL' })), settings: {} as never }), pods: async () => [{ id: 'p1', name: 'pod' }] })
    await live(); expect(dpxKeys()).toEqual([]); expect([...dest.keys()].some((k) => /V-001_MAIN\.mov$/.test(k))).toBe(true); expect(fixRuns).toBe(0)
    expect((await autopublish.statusNow()).recent[0]).toMatchObject({ state: 'done', reason: expect.stringMatching(/video only for: STEM_V: not in the EDL/) })
  })
  it('fix_dpx off: the DPX are never included (the review video only), the fix never runs and the status says so', async () => {
    fakeFix('STEM_V', 'proxy_v004/x', 'STEM_V'); await live({ fix_dpx: false })
    expect(dpxKeys()).toEqual([]); expect(fixRuns).toBe(0); expect([...dest.keys()].some((k) => /V-001_MAIN\.mov$/.test(k))).toBe(true)
    expect(autopublish.status().dpx).toMatchObject({ include: true, fix: false, fixing: 0, mode: expect.stringMatching(/off: fix_dpx is off.*no DPX/) })
  })
  it('fix_dpx is a boolean, on by default, in the settings and the status; include_dpx off behaves as before', async () => {
    expect((await autopublish.settings()).fix_dpx).toBe(true); await expect(autopublish.setSettings({ fix_dpx: 'no' as never })).rejects.toMatchObject({ status: 400 })
    expect((await autopublish.setSettings({ fix_dpx: false })).fix_dpx).toBe(false); await autopublish.statusNow(); expect(autopublish.status().dpx).toMatchObject({ include: false, fix: false, mode: 'not included' })
    expect((await autopublish.setSettings({ fix_dpx: true })).fix_dpx).toBe(true)
  })
})
