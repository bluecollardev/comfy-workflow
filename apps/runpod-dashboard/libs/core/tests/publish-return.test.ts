import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import * as layout from '../src/publishlayout.js'
import * as publish from '../src/publish.js'
import * as renders from '../src/renders.js'
import * as settingsEnv from '../src/settings.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// ADR-050 "The BKK return layout, the manifest and the Tunnel proxy": keys, RETURN-MANIFEST.json (bh-return-1), sha256s, shots as child jobs. Fakes only.
const BUCKET = 'my-internal-bucket', PFX = 'returns/BKK/', ROUND = 'qc_2026-11-19_r01', ROOT = `${PFX}${ROUND}/`
let dir: string, out: string, objs: Map<string, string>, order: string[], live = 0, maxLive = 0, failCp: Set<string>, hold: Promise<void> | null, posts: { text: string }[], gate: Map<string, Promise<void>>
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const write = (rel: string, body: string | Buffer = 'x') => { const p = join(out, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body) }
const dpxHdr = (w = 3840, h = 2160, bits = 16) => { const b = Buffer.alloc(2048); b.write('SDPX', 0); b.writeUInt32BE(2048, 4); b.writeUInt32BE(1_000_000, 16); b.writeUInt32BE(w, 772); b.writeUInt32BE(h, 776); b.writeUInt32BE(0x01000000, 1920); b[800] = 50; b[801] = 6; b[802] = 6; b[803] = bits; return b }
const frames = (stem: string, dirRel: string, n: number, first = 1) => { for (let i = 0; i < n; i++) write(`${dirRel}/${stem}.${String(first + i).padStart(4, '0')}.dpx`, Buffer.concat([dpxHdr(), Buffer.from(`frame${i}`)])) }
const fakeAws: podpull.AwsRunner = async (args, _e, o) => {
  if (args[1] === 'ls') { const pre = /^s3:\/\/[^/]+\/(.*)$/.exec(args[2])![1], rec = args.includes('--recursive'), rows = [...objs].filter(([k]) => k.startsWith(pre) && (rec || !k.slice(pre.length).includes('/'))).map(([k, v]) => `2026-11-19 10:00:00 ${String(Buffer.byteLength(v)).padStart(10)} ${rec ? k : k.slice(pre.length)}`); const pres = rec ? [] : [...new Set([...objs.keys()].filter((k) => k.startsWith(pre) && k.slice(pre.length).includes('/')).map((k) => k.slice(pre.length).split('/')[0]))].map((d) => `                           PRE ${d}/`); return { code: rows.length || pres.length ? 0 : 1, stdout: [...pres, ...rows].join('\n'), stderr: '' } }
  if (args[1] === 'presign') return { code: 0, stdout: `https://s3.example/${args[2].slice(5)}?X-Amz-Signature=s\n`, stderr: '' }
  if (args[1] === 'cp' && args[3] === '-') { const k = args[2].replace(/^s3:\/\/[^/]+\//, ''); return objs.has(k) ? { code: 0, stdout: objs.get(k)!, stderr: '' } : { code: 1, stdout: '', stderr: 'An error occurred (404) when calling the HeadObject operation: Not Found' } }
  if (args[1] === 'cp') {
    live++; maxLive = Math.max(maxLive, live)
    try {
      const key = args[3].replace(/^s3:\/\/[^/]+\//, ''); const g = [...gate].find(([k]) => key.includes(k)); if (g) await Promise.race([g[1], new Promise<void>((r) => o?.signal?.addEventListener('abort', () => r()))])
      if (hold) await hold
      if (o?.signal?.aborted) return { code: 130, stdout: '', stderr: '' }
      if ([...failCp].some((f) => key.endsWith(f))) return { code: 1, stdout: '', stderr: 'upload failed: AccessDenied' }
      const body = (await import('node:fs/promises')).readFile(args[2], 'utf8'); objs.set(key, await body); order.push(key); o?.onData?.(`Completed 1 Bytes/1 Bytes\r`); return { code: 0, stdout: '', stderr: '' }
    } finally { live-- }
  }
  return { code: 2, stdout: '', stderr: 'unexpected' }
}
const fakeSpawn = (_c: string, args: string[]): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess & { closed?: boolean }, so = new PassThrough(), se = new PassThrough(), si = new PassThrough(); Object.assign(c, { stdout: so, stderr: se, stdin: si })
  const close = (n: number | null) => { if (!c.closed) { c.closed = true; c.emit('close', n) } }
  ;(c as unknown as { kill: () => boolean }).kill = () => { setImmediate(() => close(null)); return true }
  if (args[2] === '-') { let body = ''; si.on('data', (d) => { body += String(d) }); si.on('end', () => { const k = args[3].replace(/^s3:\/\/[^/]+\//, ''); objs.set(k, body); order.push(k); setImmediate(() => close(0)) }) }
  return c
}
const fakeFetch = (async (_u: string, init: { body: string }) => { posts.push(JSON.parse(init.body)); return new Response('ok') }) as unknown as typeof fetch
const finish = async (id: string) => { await publish.settled(); return publish.status(id).jobs[0] }
const go = async (items: unknown[], o: Record<string, unknown> = {}) => { const { job_id } = await publish.run({ items, targets: ['s3'], approved_by: 'Lucas', round: ROUND, ...o }); return finish(job_id) }
const manifestOf = (r: string) => JSON.parse(objs.get(`${PFX}${r}/RETURN-MANIFEST.json`)!) as layout.Manifest
const manifest = () => JSON.parse(objs.get(`${ROOT}RETURN-MANIFEST.json`)!) as layout.Manifest

beforeEach(async () => {
  dir = scratch(); out = join(dir, 'shared', 'output'); mkdirSync(out, { recursive: true }); process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'
  for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k]
  objs = new Map(); order = []; live = 0; maxLive = 0; failCp = new Set(); hold = null; posts = []; gate = new Map()
  publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, spawn: fakeSpawn, now: () => Date.parse('2026-11-19T07:21:31Z'), findFfmpeg: async () => null, podInfo: async () => null })
  await publish.setSettings({ s3: { credentials: 'app', bucket: BUCKET, region: 'us-west-2', access_key_id: 'AKIAEXAMPLEKEY1234', secret_access_key: 'secretsecretsecret1234' }, slack: { webhook_url: 'https://hooks.slack.com/services/T/B/XXXXXXXXXXXX', preview_frame: false, volume_source: false, file_links: false, folder_link: false } })
})
afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; for (const k of settingsEnv.PUBLISH_SECRETS) delete process.env[k] })

describe('layout keys', () => {
  const key = (path: string, clipNames: Record<string, string> = {}) => layout.layoutKey({ prefix: PFX, round: ROUND, path, clipNames, shotOf: (n, d) => (/^[A-Za-z]+-\d+[a-z]?/.exec(n)?.[0] ?? d.split('/').pop() ?? 'shot').toLowerCase(), deliverShot: (p) => (/^deliver\/([^/]+)\/v\d+\//.exec(p)?.[1] ?? null) })
  it('DPX frames to <shot>/<clip>/<clip>.<frame>.dpx (the frame number as on disk), movies to <shot>/<clip>.<ext>, the rest to <shot>/<file>; the clip name renames only the upload', () => {
    expect(key('proxy_v004/x/ARCHIVAL-077_A_FINAL_V03.0012.dpx')).toMatchObject({ key: `${ROOT}archival-077/ARCHIVAL-077_A_FINAL_V03/ARCHIVAL-077_A_FINAL_V03.0012.dpx`, shot: 'archival-077', clip: 'ARCHIVAL-077_A_FINAL_V03', role: 'dpx' })
    const r = key('x/ARCH-077_stem.0007.dpx', { 'ARCH-077_stem': 'ARCHIVAL-077_B_FINAL_V03' }); expect(r).toMatchObject({ key: `${ROOT}archival-077/ARCHIVAL-077_B_FINAL_V03/ARCHIVAL-077_B_FINAL_V03.0007.dpx`, renamed_from: 'ARCH-077_stem.0007.dpx', stem: 'ARCH-077_stem' })
    expect(key('.proxies/a/ARCHIVAL-085_MAIN.mp4').key).toBe(`${ROOT}archival-085/ARCHIVAL-085_MAIN.mp4`); expect(key('deliver/depth-105/v002/Clip_X.mov')).toMatchObject({ key: `${ROOT}depth-105/Clip_X.mov`, role: 'review' }); expect(key('a/ARCHIVAL-085_MAIN.mp4', { 'ARCHIVAL-085_MAIN': 'EDL_NAME' }).key).toBe(`${ROOT}archival-085/EDL_NAME.mp4`)
    expect(key('deliver/depth-105/v002/DELIVERY.md')).toMatchObject({ key: `${ROOT}depth-105/DELIVERY.md`, role: 'sidecar' }); expect(key('deliver/depth-105/v002/Clip_X.mov.meta.json').role).toBe('sidecar'); expect(layout.roleOf('g/graph.json')).toBe('graph'); expect(layout.elementOf('ARCHIVAL-077_A_FINAL_V03')).toBe('A'); expect(layout.elementOf('ARCHIVAL-085_MAIN_23.976')).toBe('main')
  })
  it('round and clip names are validated', () => {
    expect(() => layout.validateRound(undefined)).toThrow('Publishing to a return needs a round name'); expect(() => layout.validateRound('')).toThrow(/needs a round name/)
    for (const bad of ['ab', 'a b c', '../x', 'x'.repeat(101), 'a/b']) expect(() => layout.validateRound(bad), bad).toThrow(/round is 3 to 100/)
    expect(layout.validateRound('qc_2026-11-02_r01')).toBe('qc_2026-11-02_r01'); expect(layout.validateClipNames({ stem: 'ARCHIVAL-077_A_FINAL' })).toEqual({ stem: 'ARCHIVAL-077_A_FINAL' })
    for (const bad of [{ a: '../x' }, { a: 'a/b' }, { a: '' }, { 'a/b': 'ok' }, { a: 'clip_0123456789abcdef0123' }]) expect(() => layout.validateClipNames(bad)).toThrow(/clip_names/)
    expect(layout.layoutFor('returns/BKK/')).toBe('bkk-return'); expect(layout.layoutFor('renders/')).toBe('as-is'); expect(layout.layoutFor('returns/BKK/', 'as-is')).toBe('as-is')
  })
  it('a returned_at with the local UTC offset', () => { expect(layout.isoWithOffset(Date.parse('2026-11-19T07:21:31Z'))).toMatch(/^2026-11-19T\d\d:21:31[+-]\d\d:\d\d$/) })
})

describe('plan: the round and the layout', () => {
  it('bkk-return is the default under returns/BKK/; the round is required (400); keys, renamed_from and the round are in the plan; a setting can switch it off', async () => {
    write('proxy_v004/shotA/ARCH-077_stem.0001.dpx', 'a'); write('proxy_v004/shotA/ARCH-077_stem.0002.dpx', 'b')
    expect((await publish.settings()).s3).toMatchObject({ layout: 'bkk-return', prefix: PFX })
    await expect(publish.plan({ items: ['proxy_v004/shotA'], targets: ['s3'] })).rejects.toMatchObject({ status: 400, message: 'Publishing to a return needs a round name' }); await expect(publish.plan({ items: ['proxy_v004/shotA'], targets: ['s3'], round: 'x' })).rejects.toMatchObject({ status: 400 })
    const p = await publish.plan({ items: ['proxy_v004/shotA'], targets: ['s3'], round: ROUND, clip_names: { 'ARCH-077_stem': 'ARCHIVAL-077_A_FINAL_V03' }, start_timecodes: { 'ARCH-077_stem': '01:00:00:00' } })
    expect(p).toMatchObject({ layout: 'bkk-return', round: ROUND, ok: true, sequences: [{ stem: 'ARCH-077_stem', start_timecode: '01:00:00:00', timecode_source: 'sequence field' }] }); expect(p.items.map((i) => [i.s3_key, i.renamed_from])).toEqual([[`${ROOT}archival-077/ARCHIVAL-077_A_FINAL_V03/ARCHIVAL-077_A_FINAL_V03.0001.dpx`, 'ARCH-077_stem.0001.dpx'], [`${ROOT}archival-077/ARCHIVAL-077_A_FINAL_V03/ARCHIVAL-077_A_FINAL_V03.0002.dpx`, 'ARCH-077_stem.0002.dpx']])
    await publish.setSettings({ s3: { layout: 'as-is' } }); expect((await publish.plan({ items: ['proxy_v004/shotA'], targets: ['s3'] })).items[0].s3_key).toBe(`${PFX}proxy_v004/shotA/ARCH-077_stem.0001.dpx`)
    await expect(publish.setSettings({ s3: { layout: 'weird' } })).rejects.toMatchObject({ status: 400 }); await publish.setSettings({ s3: { layout: '', prefix: 'renders' } }); expect((await publish.settings()).s3.layout).toBe('as-is')
  })
  it('publish.rounds() lists the rounds in the destination, newest name first, capped', async () => {
    for (const r of ['qc_2026-11-02_r01', 'depth-105_h3_iterations_2026-11-03_r01', 'qc_2026-11-19_r01']) objs.set(`${PFX}${r}/RETURN-MANIFEST.json`, '{}')
    objs.set(`${PFX}loose.txt`, 'x'); expect((await publish.rounds()).rounds.map((r) => r.name)).toEqual(['qc_2026-11-19_r01', 'qc_2026-11-02_r01', 'depth-105_h3_iterations_2026-11-03_r01'])
  })
})

describe('a return: sha256, the manifest, the inventory', () => {
  it('a mixed run: the DPX frames, a proxy, its sidecar and a graph, with exact keys and the manifest nesting; the manifest goes up last', async () => {
    frames('ARCH-077_stem', 'proxy_v004/shotA', 3); write('.proxies/proxy_v004/shotA/ARCH-077_stem.mp4', 'mp4bytes'); write('.proxies/proxy_v004/shotA/ARCH-077_stem.mp4.meta.json', JSON.stringify({ kind: 'proxy', fps: 23.976, frames: 3, width: 1920, height: 1080, preset: 'tunnel' })); write('graphs/g.json', '{"nodes":1}')
    const j = await go(['proxy_v004/shotA', '.proxies/proxy_v004/shotA', 'graphs'], { clip_names: { 'ARCH-077_stem': 'ARCHIVAL-077_A_FINAL_V03' }, approved_by: 'Lucas' })
    expect(j.state).toBe('done'); expect(j.manifest).toEqual({ updated: true, shots: 2, path: `${ROOT}RETURN-MANIFEST.json` }); expect(j.sha256_count).toBe(j.results!.filter((r) => r.sha256 !== 'n/a').length); expect(j.results!.find((r) => r.path.endsWith('.0002.dpx'))).toMatchObject({ sha256: sha(Buffer.concat([dpxHdr(), Buffer.from('frame1')])), bytes: 2054 }); expect(order.at(-2)).toBe(`${ROOT}RETURN-MANIFEST.json`); expect(order.at(-1)).toMatch(/_inventory_2026-11-19\.csv$/)
    const m = manifest(); expect(Object.keys(m)).toEqual(['schema_version', 'round', 'returned_by', 'returned_at', 'pod', 'items']); expect(m).toMatchObject({ schema_version: 'bh-return-1', round: ROUND, returned_by: 'Lucas', pod: { provider: 'n/a', pod_id: 'n/a', gpu: 'n/a', hours: 0, cost_usd: 0, paid_by: 'n/a', provider_api_calls: 'n/a' } }); expect(m.returned_at).toMatch(/^2026-11-19T\d\d:21:31[+-]\d\d:\d\d$/)
    expect(m.items.map((i) => [i.shot, i.element])).toEqual([['archival-077', 'A'], ['graphs', 'main']].sort((a, b) => a[0].localeCompare(b[0])).map((x) => x)) 
    const it = m.items.find((i) => i.shot === 'archival-077')!; expect(Object.keys(it)).toEqual(['shot', 'element', 'input_final', 'graph', 'outputs', 'measures'])
    expect(it.input_final.delivered_name).toBe('ARCHIVAL-077_A_FINAL_V03'); expect(it.measures).toEqual({ kind: 'FINAL delivery', frames: 3, notes: 'delivered as ARCHIVAL-077_A_FINAL_V03; on disk ARCH-077_stem; start timecode 01:00:00:00 (DPX header)' })
    const dpx = it.outputs.filter((o) => o.role === 'dpx'); expect(dpx.map((o) => o.path)).toEqual([1, 2, 3].map((n) => `archival-077/ARCHIVAL-077_A_FINAL_V03/ARCHIVAL-077_A_FINAL_V03.${String(n).padStart(4, '0')}.dpx`))
    expect(dpx[0]).toMatchObject({ sha256: sha(Buffer.concat([dpxHdr(), Buffer.from('frame0')])), bytes: 2048 + 6, width: 3840, height: 2160, bit_depth: 16, codec: 'dpx', frames: 3, fps: '24' })
    const proxy = it.outputs.find((o) => o.role === 'proxy-h264')!; expect(proxy).toMatchObject({ path: 'archival-077/ARCHIVAL-077_A_FINAL_V03.mp4', sha256: sha('mp4bytes'), bytes: 8, width: 1920, height: 1080, codec: 'h264', bit_depth: 8, frames: 3, fps: '24000/1001', colour: { working_space: 'Rec.709 tagged' } })
    expect(it.outputs.find((o) => o.role === 'sidecar')!.path).toBe('archival-077/ARCHIVAL-077_A_FINAL_V03.mp4.meta.json'); expect(m.items.find((i) => i.shot === 'graphs')!.outputs[0].role).toBe('graph')
    const seqDigest = sha(dpx.map((o) => `${o.path.split('/').pop()} ${o.sha256}\n`).join('')); expect(it.input_final.sha256).toBe(seqDigest)
    expect(objs.get(`${ROOT}archival-077/ARCHIVAL-077_A_FINAL_V03/ARCHIVAL-077_A_FINAL_V03.0002.dpx`)).toContain('frame1'); expect(objs.has(`${ROOT}archival-077/ARCH-077_stem/ARCH-077_stem.0001.dpx`)).toBe(false)   // frames on disk are never renamed, only the upload is
    const csv = objs.get(`${ROOT}_inventory_2026-11-19.csv`)!; expect(csv.split('\n')[0]).toBe('shot,name,role,frames,bytes,sha256'); expect(csv).toContain('archival-077,ARCHIVAL-077_A_FINAL_V03.0001.dpx,dpx,3,2054,')
  })
  it('merges with the manifest already in the round: other shots stay, this shot is replaced; a corrupt one is a 409 and nothing is overwritten', async () => {
    const TR = '_TEST_merge_r01'   // a _TEST_ round may be written over again; any other round never is
    write('a/ARCHIVAL-100_main.mp4', 'one'); write('b/ARCHIVAL-101_main.mp4', 'two')
    await go(['a'], { round: TR }); const first = manifestOf(TR); expect(first.items.map((i) => i.shot)).toEqual(['archival-100'])
    write('b/ARCHIVAL-101_main.mp4', 'twotwo'); await go(['b'], { round: TR }); const m = manifestOf(TR); expect(m.items.map((i) => i.shot)).toEqual(['archival-100', 'archival-101']); expect(m.items[0].outputs[0].sha256).toBe(sha('one'))
    write('a/ARCHIVAL-100_main.mp4', 'one-changed'); await go(['a'], { round: TR }); const again = manifestOf(TR); expect(again.items).toHaveLength(2); expect(again.items.find((i) => i.shot === 'archival-100')!.outputs[0].sha256).toBe(sha('one-changed')); expect(again.items.find((i) => i.shot === 'archival-101')!.outputs[0].sha256).toBe(sha('twotwo'))
    objs.set(`${PFX}${TR}/RETURN-MANIFEST.json`, '{ not json'); const j = await go(['a'], { round: TR }); expect(j.state).toBe('failed'); expect(j.error).toMatch(/cannot be read/); expect(j.manifest).toMatchObject({ updated: false, path: `${PFX}${TR}/RETURN-MANIFEST.json`, error: expect.stringMatching(/cannot be read/) }); expect(objs.get(`${PFX}${TR}/RETURN-MANIFEST.json`)).toBe('{ not json')
  })
  it('every element gets its own <CLIP>_MANIFEST.json next to its files, with the sha256 of each file; one already in a real round is left alone', async () => {
    write('s100/ARCHIVAL-100_main.mp4', 'abc'); const j = await go(['s100'], { round: '_TEST_each_r01' }); expect(j.state).toBe('done')
    const k = `${PFX}_TEST_each_r01/archival-100/ARCHIVAL-100_main_MANIFEST.json`; expect(objs.has(k)).toBe(true)
    const m = JSON.parse(objs.get(k)!); expect(m).toMatchObject({ schema_version: expect.any(String), round: '_TEST_each_r01', returned_by: 'Lucas', item: { shot: 'archival-100' } }); expect(m.item.outputs[0].sha256).toBe(sha('abc'))
    write('s101/ARCHIVAL-101_main.mp4', 'xyz'); const real = `${PFX}${ROUND}/archival-101/ARCHIVAL-101_main_MANIFEST.json`; objs.set(real, '{"theirs":1}')
    const j2 = await go(['s101']); expect(j2.state).toBe('done'); expect(objs.get(real)).toBe('{"theirs":1}')
  })
  it('an element manifest is written on every publish: one of ours in a real round is replaced, one that is not ours is left, unless the run has allow_overwrite', async () => {
    write('s102/ARCHIVAL-102_main.mp4', 'v1'); const real = `${PFX}${ROUND}/archival-102/ARCHIVAL-102_main_MANIFEST.json`
    expect((await go(['s102'])).state).toBe('done'); const first = JSON.parse(objs.get(real)!); expect(first.item.outputs[0].sha256).toBe(sha('v1'))
    write('s102/ARCHIVAL-102_main.mp4', 'v2 longer'); const j2 = await go(['s102'], { allow_overwrite: true }); expect(j2.state).toBe('done')
    expect(JSON.parse(objs.get(real)!).item.outputs[0].sha256).toBe(sha('v2 longer'))   // ours (schema_version) and allow_overwrite: replaced with the new file's hash
    objs.set(real, '{"theirs":1}'); write('s102/ARCHIVAL-102_main.mp4', 'v2 longer'); expect((await go(['s102'])).state).toBe('done'); expect(objs.get(real)).toBe('{"theirs":1}')   // not ours, no allow_overwrite: left
    expect((await go(['s102'], { allow_overwrite: true })).state).toBe('done'); expect(JSON.parse(objs.get(real)!)).toMatchObject({ schema_version: expect.any(String) })   // not ours but allow_overwrite: replaced
  })
  it('a failed upload adds nothing to the manifest and the manifest is not written', async () => {
    write('a/ARCHIVAL-100_main.mp4', 'one'); failCp.add('ARCHIVAL-100_main.mp4'); const j = await go(['a']); expect(j.state).toBe('failed'); expect(objs.has(`${ROOT}RETURN-MANIFEST.json`)).toBe(false); expect(j.manifest).toBeUndefined(); expect(j.children[0]).toMatchObject({ state: 'failed', shot: 'archival-100' })
  })
  it('no secret and no signed URL in the manifest or the inventory', async () => {
    write('a/ARCHIVAL-100_main.mp4', 'one'); await go(['a']); const all = [...objs.values()].join('\n'); expect(all).not.toMatch(/AKIA|secretsecret|X-Amz|hooks\.slack/)
  })
})

describe('shots as child jobs', () => {
  const three = () => { for (const n of ['100', '101', '102']) write(`s${n}/ARCHIVAL-${n}_main.mp4`, `body${n}`); return ['s100', 's101', 's102'] }
  it('one child per shot with its own progress; ids and parent_id; counts; the approver on each; sequential by default', async () => {
    const j = await go(three()); expect(j).toMatchObject({ kind: 'publish', trigger: 'manual', state: 'done', streams: 1, counts: { done: 3, queued: 0, failed: 0, uploading: 0, cancelled: 0 } })
    expect(j.children.map((c) => [c.id, c.parent_id, c.shot, c.clip, c.state, c.files, c.files_done, c.approved_by])).toEqual([100, 101, 102].map((n, i) => [`${j.job_id}:${i}`, j.job_id, `archival-${n}`, `ARCHIVAL-${n}_main`, 'done', 1, 1, 'Lucas'])); expect(maxLive).toBe(1); expect(j.children[0]).toMatchObject({ bytes: 7, bytes_done: 7, current: '' })
    expect(manifest().items.map((i) => i.shot)).toEqual(['archival-100', 'archival-101', 'archival-102'])
  })
  it('streams: up to that many shots at once, and the manifest mutex loses no item under parallel children', async () => {
    three(); let release!: () => void; hold = new Promise((r) => { release = r }); const { job_id } = await publish.run({ items: three(), targets: ['s3'], approved_by: 'L', round: ROUND, streams: 3 })
    await new Promise((r) => setTimeout(r, 40)); expect(publish.status(job_id).jobs[0].children.map((c) => c.state)).toEqual(['uploading', 'uploading', 'uploading']); release(); const j = await finish(job_id)
    expect(maxLive).toBeGreaterThan(1); expect(j.streams).toBe(3); expect(j.state).toBe('done'); expect(manifest().items.map((i) => i.shot)).toEqual(['archival-100', 'archival-101', 'archival-102'])
    const two = publish.run({ items: ['s100'], targets: ['s3'], approved_by: 'A', round: ROUND }), other = publish.run({ items: ['s101'], targets: ['s3'], approved_by: 'B', round: ROUND }); await Promise.all([two, other]); await publish.settled(); expect(manifest().items).toHaveLength(3)   // two runs at once, one round
  })
  it('one child failing while the others finish; retry sends only what is missing; the failed child added nothing to the manifest meanwhile', async () => {
    write('s100/ARCHIVAL-100_main.mp4', 'a'); write('s101/ARCHIVAL-101_main.mp4', 'b'); write('s101/ARCHIVAL-101_main.mp4.meta.json', '{}'); failCp.add('ARCHIVAL-101_main.mp4.meta.json')
    const j = await go(['s100', 's101']); expect(j.state).toBe('failed'); expect(j.children.map((c) => c.state)).toEqual(['done', 'failed']); expect(j.children[1].error).toMatch(/meta\.json/); expect(manifest().items.map((i) => i.shot)).toEqual(['archival-100'])
    failCp.clear(); order.length = 0; const r = await publish.retry({ child_id: j.children[1].id }); expect(r.child_id).toBe(j.children[1].id); const k = await finish(j.job_id)
    expect(k.state).toBe('done'); expect(k.children.map((c) => c.state)).toEqual(['done', 'done']); expect(order.filter((x) => /\.(mp4|json)$/.test(x) && !/RETURN|inventory|_MANIFEST/.test(x))).toEqual([`${ROOT}archival-101/ARCHIVAL-101_main.mp4.meta.json`])   // the mp4 was already there with the same size
    expect(k.children[1]).toMatchObject({ skipped: 1, files: 1 }); expect(manifest().items.map((i) => i.shot)).toEqual(['archival-100', 'archival-101'])
    await expect(publish.retry({ child_id: j.children[0].id })).rejects.toMatchObject({ status: 400 }); await expect(publish.retry('nope:1')).rejects.toMatchObject({ status: 404 })
  })
  it('after a restart a failed shot is sent again as a new job from the request it started with', async () => {
    process.env.PUBLISH_JOBS_FILE = join(out, 'jobs-restart.json')
    write('s100/ARCHIVAL-100_main.mp4', 'a'); write('s101/ARCHIVAL-101_main.mp4', 'b'); write('s101/ARCHIVAL-101_main.mp4.meta.json', '{}'); failCp.add('ARCHIVAL-101_main.mp4.meta.json')
    const j = await go(['s100', 's101']); expect(j.state).toBe('failed'); expect(j.retryable).toBe(true)
    await publish.settled(); const record = readFileSync(process.env.PUBLISH_JOBS_FILE as string, 'utf8'); publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, spawn: fakeSpawn, now: () => Date.parse('2026-11-19T07:21:31Z'), findFfmpeg: async () => null, podInfo: async () => null })
    writeFileSync(process.env.PUBLISH_JOBS_FILE as string, record)   // what the app read back from disk: a record, nothing retained
    failCp.clear(); order.length = 0
    const r = await publish.retry({ child_id: j.children[1].id }); expect(r.job_id).toBeTruthy()
    const k = await finish(r.job_id); expect(k.state).toBe('done'); expect(k.children.map((c) => c.shot)).toContain('archival-101'); expect(order.filter((x) => /\.(mp4|json)$/.test(x) && !/RETURN|inventory|_MANIFEST/.test(x))).toEqual([`${ROOT}archival-101/ARCHIVAL-101_main.mp4.meta.json`])   // only the missing file is sent: the rest is there with the same size
    await expect(publish.retry({ child_id: j.children[0].id })).rejects.toMatchObject({ status: 400 })
    // a record from before requests were kept: status says it cannot be retried, and a retry says why
    const old = JSON.parse(record); delete old[0].request; writeFileSync(process.env.PUBLISH_JOBS_FILE as string, JSON.stringify(old)); publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, spawn: fakeSpawn, findFfmpeg: async () => null, podInfo: async () => null })
    publish.status(); await new Promise((r) => setTimeout(r, 30)); expect(publish.status().jobs[0]).toMatchObject({ retryable: false }); await expect(publish.retry({ child_id: j.children[1].id })).rejects.toMatchObject({ status: 400 })
    delete process.env.PUBLISH_JOBS_FILE
  })
  it('a round that is not a _TEST_ round is never overwritten: another size is refused, the same size is skipped, a manifest that is not ours is left untouched (409); a _TEST_ round is written over', async () => {
    const REAL = 'qc_2026-11-19_r01', RR = `${PFX}${REAL}/`
    write('s100/ARCHIVAL-100_main.mp4', 'abc'); const key = `${RR}archival-100/ARCHIVAL-100_main.mp4`
    objs.set(key, 'different-size-body')
    const refused = await publish.plan({ items: ['s100'], targets: ['s3'], round: REAL })
    expect(refused.ok).toBe(false); expect(refused.refused.map((r) => r.reason).join(' ')).toMatch(/never overwritten/)
    await expect(publish.run({ items: ['s100'], targets: ['s3'], approved_by: 'L', round: REAL })).rejects.toThrow(/never overwritten/); expect(objs.get(key)).toBe('different-size-body')
    objs.set(key, 'abc'); objs.set(`${RR}RETURN-MANIFEST.json`, '{"theirs":true}')
    const same = await publish.plan({ items: ['s100'], targets: ['s3'], round: REAL }); expect(same.ok).toBe(true); expect(same.items.map((i) => i.skip)).toContain('same size already there')
    write('s101/ARCHIVAL-101_main.mp4', 'new'); const { job_id } = await publish.run({ items: ['s101'], targets: ['s3'], approved_by: 'L', round: REAL }); const j = await finish(job_id)
    expect(j.state).toBe('failed'); expect(j.error).toMatch(/cannot be read|nothing was overwritten/); expect(objs.get(`${RR}RETURN-MANIFEST.json`)).toBe('{"theirs":true}')
    objs.set(`${PFX}_TEST_2026-11-20/archival-100/ARCHIVAL-100_main.mp4`, 'old-different-size'); const test = await publish.plan({ items: ['s100'], targets: ['s3'], round: '_TEST_2026-11-20' }); expect(test.ok).toBe(true)
  })
  it('cancelling a child leaves the others; cancelling the parent cancels every child that is not done', async () => {
    three(); gate.set('ARCHIVAL-100_main', new Promise(() => undefined)); const { job_id } = await publish.run({ items: ['s100', 's101', 's102'], targets: ['s3'], approved_by: 'L', round: ROUND, streams: 3 })
    await new Promise((r) => setTimeout(r, 40)); publish.cancel(`${job_id}:0`); const j = await finish(job_id)
    expect(j.children.map((c) => c.state)).toEqual(['cancelled', 'done', 'done']); expect(j.state).toBe('done_with_warning'); expect(manifest().items.map((i) => i.shot)).toEqual(['archival-101', 'archival-102'])
    const hang = new Promise<void>(() => undefined); gate.clear(); gate.set('ARCHIVAL-101_main', hang); publish.reset(); publish.setDeps({ aws: fakeAws, fetch: fakeFetch, outputRoot: () => out, parallel: () => 4, spawn: fakeSpawn, findFfmpeg: async () => null, podInfo: async () => null })
    const r = await publish.run({ items: ['s101', 's102'], targets: ['s3'], approved_by: 'L', round: 'other_round_r01', streams: 2 }); await new Promise((x) => setTimeout(x, 40)); publish.cancel(r.job_id); const k = await finish(r.job_id)
    expect(k.state).toBe('cancelled'); expect(k.children.every((c) => c.state === 'cancelled' || c.state === 'done')).toBe(true); expect(k.children.some((c) => c.state === 'cancelled')).toBe(true)
  })
  it('Slack: one message per shot by default for the BKK return, or one per run with slack.per_shot false', async () => {
    three(); const j = await go(['s100', 's101', 's102'], { targets: ['s3', 'slack'] }); expect(posts).toHaveLength(3); expect(posts[0].text).toContain('archival-100'); expect(j.children.every((c) => c.slack.state === 'sent')).toBe(true); expect(j.slack.state).toBe('sent')
    posts.length = 0; await publish.setSettings({ slack: { per_shot: false } }); objs.clear(); const k = await go(['s100', 's101', 's102'], { targets: ['s3', 'slack'] }); expect(posts).toHaveLength(1); expect(k.children.every((c) => c.slack.state === 'skipped')).toBe(true)
    posts.length = 0; await publish.setSettings({ s3: { layout: 'as-is' }, slack: { per_shot: true } }); const as = await go(['s100', 's101'], { targets: ['s3', 'slack'], round: undefined }); expect(as.state).toBe('done'); expect(posts).toHaveLength(2)
  })
  it('the event loop stays free with a 5,000-frame set (hashes and uploads are chunked and async)', async () => {
    for (let i = 0; i < 5000; i++) write(`big/ARCHIVAL-300_main.${String(i + 1).padStart(4, '0')}.dpx`, `f${i}`)
    let worst = 0, last = performance.now(); const t = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1)
    const j = await go(['big'], { start_timecodes: { 'ARCHIVAL-300_main': '01:00:00:00' } }); clearInterval(t); expect(j.state).toBe('done'); expect(manifest().items[0].outputs.filter((o) => o.role === 'dpx')).toHaveLength(5000); expect(worst).toBeLessThan(500)
  }, 120_000)
})

describe('the EDL judges each sequence of a return (ADR-050)', () => {
  const FILE = join(import.meta.dirname, 'fixtures', 'v11-excerpt.edl'), E231 = 'ENHANCE-231_MAIN_FINAL_V01_3840X2160_23.976_PRORES422HQ', X102 = 'ARCHIVAL-102_MAIN-B_FINAL_V01_3840X2160_24_X'
  beforeEach(async () => { const edl = await import('../src/edl.js'); edl.reset(); await edl.load({ source: { file: FILE } }) })
  afterEach(async () => { (await import('../src/edl.js')).reset() })
  it('a frame count that differs holds the sequence back with its flags; an override delivers it, is recorded in the manifest notes and in job.edl_overrides; not-in-edl has no override and the other sequences go on', async () => {
    frames(E231, 'q', 3); frames(X102, 'q', 2)
    const p = await publish.plan({ items: ['q'], targets: ['s3'], round: ROUND })
    expect(p.sequences!.map((x) => [x.stem, x.blocked, x.expected_frames, x.flags.filter((f) => f.level === 'block').map((f) => f.code)])).toEqual([[X102, true, null, ['not-in-edl']], [E231, true, 247, ['frames-differ-from-edl']]]); expect(p.sequences![1]).toMatchObject({ clip: E231, shot: 'enhance-231', start_timecode: '01:00:00:00', timecode_source: 'DPX header', edl_element: { speeds: [95] } })
    expect(p.ok).toBe(false); expect(p.blockers[0]).toMatch(/^Every sequence is held back/); expect(p.items.every((i) => i.skip === 'blocked' && i.reason)).toBe(true)
    await expect(publish.run({ items: ['q'], targets: ['s3'], approved_by: 'L', round: ROUND })).rejects.toMatchObject({ status: 400 })
    const j = await go(['q'], { edl_override: { [E231]: true, [X102]: true } })   // not-in-edl is never overridable
    expect(j.state).toBe('done'); expect(j.edl_overrides).toEqual([{ stem: E231, frames: 3, expected: 247 }]); const it = manifest().items; expect(it.map((i) => i.shot)).toEqual(['enhance-231']); expect(it[0].measures.notes).toContain('EDL override: 3 frames vs 247 in the cut'); expect(it[0].measures.notes).toContain('start timecode 01:00:00:00 (DPX header)')
    expect([...objs.keys()].some((k) => k.includes('archival-102'))).toBe(false)
  })
  it('a low-resolution source warns and is noted in the manifest; a missing timecode (no field, header or EDL) holds the sequence; the field is accepted per stem', async () => {
    const CR = 'CREATURE-266_BREACH-ALT1_FINAL_V01_1280X720_24_H264'; frames(CR, 'r', 2)
    const p = await publish.plan({ items: ['r'], targets: ['s3'], round: ROUND, edl_override: { [CR]: true } }); expect(p.sequences![0].flags.map((f) => f.code)).toEqual(['frames-differ-from-edl', 'low-source-resolution']); expect(p.sequences![0].flags[0].level).toBe('warn')
    expect((await go(['r'], { edl_override: { [CR]: true } })).state).toBe('done'); expect(manifest().items[0].measures.notes).toContain('the source is 1280x720: flag if the 4K is not usable')
    write('t/NOWHERE-001_MAIN.0001.dpx', 'a'); const q = await publish.plan({ items: ['t'], targets: ['s3'], round: ROUND }); expect(q.sequences![0]).toMatchObject({ blocked: true, start_timecode: null }); expect(q.sequences![0].flags.map((f) => f.code)).toEqual(expect.arrayContaining(['no-start-timecode', 'not-in-edl']))
    const ok = await publish.plan({ items: ['t'], targets: ['s3'], round: ROUND, start_timecodes: { 'NOWHERE-001_MAIN': '02:00:00:00' } }); expect(ok.sequences![0]).toMatchObject({ start_timecode: '02:00:00:00', timecode_source: 'sequence field' }); expect(ok.sequences![0].flags.map((f) => f.code)).toEqual(['not-in-edl'])
    await expect(publish.plan({ items: ['t'], targets: ['s3'], round: ROUND, start_timecodes: { x: '1:2' } })).rejects.toMatchObject({ status: 400 })
  })
})

describe('async rule', () => { it('publishlayout.ts has no synchronous file or process calls', async () => { const { readFileSync } = await import('node:fs'); const t = readFileSync(join(import.meta.dirname, '..', 'src', 'publishlayout.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); expect(t.match(/\b(spawnSync|execSync|readFileSync|writeFileSync|statSync|readdirSync|existsSync)\b/g) ?? []).toEqual([]) }) })
void renders

describe('where a job came from (the Queue shows MCP actions)', () => {
  it('a publish started under an MCP tool call carries origin mcp and the client name and a History line "started by MCP"; the window one is origin window; it is in the shared running file while it runs', async () => {
    const history = await import('../src/history.js'), reg = await import('../src/jobsregistry.js'); reg.reset()
    frames('ARCHIVAL-100_main', 's100', 2); frames('ARCHIVAL-101_main', 's101', 2)
    const a = await history.runAs({ source: 'mcp', tool: 'publish', client: 'claude-code', approved_by: 'Lucas' }, () => go(['s100'], { start_timecodes: { 'ARCHIVAL-100_main': '01:00:00:00' } }))
    expect(a).toMatchObject({ origin: 'mcp', mcp_client: 'claude-code' }); expect(history.list({ limit: 20 }).some((e) => e.kind === 'change' && e.action === 'started by MCP' && /publish 2 files.*claude-code.*Lucas/s.test(`${e.what} ${e.detail}`))).toBe(true)
    const b = await go(['s101'], { start_timecodes: { 'ARCHIVAL-101_main': '01:00:00:00' } }); expect(b.origin).toBe('window'); expect(b.mcp_client).toBeUndefined()
  })
})

describe('a failed publish says what failed (publish status)', () => {
  it('a failed child and job carry failure { stage: transfer, message, recovery, retryable }', async () => {
    frames('ARCHIVAL-100_main', 's100', 2); failCp.add('ARCHIVAL-100_main.0001.dpx')
    const j = await go(['s100'], { start_timecodes: { 'ARCHIVAL-100_main': '01:00:00:00' } }); const c = j.children[0] as unknown as { failure?: { stage: string; text: string; retryable: boolean } }
    expect(j.state).toBe('failed'); expect(c.failure).toMatchObject({ stage: 'transfer' }); expect(c.failure!.text).toMatch(/^stage: transfer\nnode: not obtained.*\nmessage: .*AccessDenied.*\nretryable: (yes|no)\nrecovery: /s); expect(j.failure?.stage).toBe('transfer')
  })
  it('status({ summary: true }), what the window polls, leaves out the per-file lists but keeps the counts; the full status (MCP, a job by id) is unchanged', async () => {
    frames('ARCHIVAL-100_main', 's100', 60)
    const j = await go(['s100'], { start_timecodes: { 'ARCHIVAL-100_main': '01:00:00:00' } })
    expect(j.results!.length).toBeGreaterThan(50)
    const full = publish.status().jobs.find((x) => x.job_id === j.job_id)!, slim = publish.status(undefined, { summary: true }).jobs.find((x) => x.job_id === j.job_id)!
    expect(slim.files).toEqual([]); expect(slim.results).toBeUndefined()
    expect(slim.sha256_count).toBe(full.sha256_count); expect(slim.files_total).toBe(full.files_total); expect(slim.state).toBe(full.state); expect(slim.links).toEqual(full.links); expect(slim.children.map((c) => c.state)).toEqual(full.children.map((c) => c.state))
    expect(publish.status(j.job_id, { summary: true }).jobs[0].results).toEqual(full.results)   // asked for by id: whole
    expect(publish.status().jobs.find((x) => x.job_id === j.job_id)!.results).toEqual(full.results)
    const a = JSON.stringify(full).length, b = JSON.stringify(slim).length
    console.log('publish status of one 60-file job: ' + a + ' bytes full, ' + b + ' bytes summary')
    expect(b).toBeLessThan(a / 2)
  })
})
