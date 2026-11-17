import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import * as mounts from '../src/mounts.js'
import * as outputruns from '../src/outputruns.js'
import * as outputsources from '../src/outputsources.js'
import * as podpull from '../src/podpull.js'
import * as volumeround from '../src/volumeround.js'
import { scratch } from './helpers.js'

vi.setConfig({ testTimeout: 30_000 })
const VOL = 'a3upg9ey48'
const O = 'comfy-shared/output'
const ROW = (key: string, bytes = 1000, at = '2026-11-17 10:00:00') => `${at} ${String(bytes).padStart(10)} ${key}`
// a fake volume: key -> [bytes, modified]
let TREE: Record<string, [number, string]>
let calls: string[][]
const aws: podpull.AwsRunner = async (args) => {
  calls.push(args)
  const m = /^s3:\/\/([^/]+)\/(.*)$/.exec(args[2]); if (!m || m[1] !== VOL) return { code: 1, stdout: '', stderr: 'NoSuchBucket' }
  const dir = m[2], recursive = args.includes('--recursive')
  const under = Object.entries(TREE).filter(([k]) => k.startsWith(dir))
  if (recursive) return { code: 0, stdout: under.map(([k, [b, t]]) => ROW(k, b, t)).join('\n'), stderr: '' }
  const pre = new Set<string>(), out: string[] = []
  for (const [k, [b, t]] of under) { const r = k.slice(dir.length); if (r.includes('/')) pre.add(r.split('/')[0] + '/'); else out.push(ROW(r, b, t)) }
  return { code: 0, stdout: [...[...pre].sort().map((p) => `                           PRE ${p}`), ...out].join('\n'), stderr: '' }
}
const opts = () => ({ aws, fresh: true })
const frames = (dir: string, n: number, at: string) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${dir}/${dir.split('/').pop()}_proxy.${String(i).padStart(4, '0')}.dpx`, [49768064, at] as [number, string]]))

beforeEach(() => {
  const dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); delete process.env.OUTPUT_RUNS_FILE
  process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
  const cfg = mounts.defaults(); cfg.dry_run = false; cfg.data_center_id = 'EU-RO-1'; cfg.shared_volume_id = VOL; cfg.network_volume_id = VOL; mounts.save(cfg)
  TREE = {
    ...frames(`${O}/proxy_v004/archival-080/archival-080_a_v004_dpx16`, 5, '2026-11-17 09:00:00'),
    [`${O}/proxy_v004/archival-080/archival-080_a_v004_dpx16/archival-080_a_v004_proxy.json`]: [300, '2026-11-17 09:30:00'],
    [`${O}/proxy_v004/archival-080/clip/clip.mp4`]: [9000, '2026-11-16 08:00:00'],
    [`${O}/proxy_v004/archival-084/x/x.png`]: [10, '2026-11-15 08:00:00'],
    [`${O}/proxy_v005/archival-080/y/y.png`]: [10, '2026-11-17 12:00:00'],
    [`${O}/delivery_v003_tests/t.png`]: [10, '2026-11-01 08:00:00'],
  }
  calls = []; volumeround.forgetCache()
})
afterEach(() => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY })

describe('volume-s3 source', () => {
  it('level 1 lists the top-level folders only, one level (no recursive listing)', async () => {
    const l = await outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: '' })
    expect(l.folders).toEqual(['delivery_v003_tests', 'proxy_v004', 'proxy_v005'])
    expect(l.prefix).toBe('')
    expect(calls).toHaveLength(1); expect(calls[0]).not.toContain('--recursive')
  })
  it('a shot prefix lists leaf folders as runs: newest LastModified, sizes, DPX frames, sequence tile logic', async () => {
    const l = await outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: 'proxy_v004/archival-080' })
    expect(l.folders).toEqual(['archival-080_a_v004_dpx16', 'clip'])
    const D = 'proxy_v004/archival-080/archival-080_a_v004_dpx16'
    expect(l.runs.map((r) => r.folder)).toEqual([D, 'proxy_v004/archival-080/clip'])   // newest first
    const seq = l.runs[0]
    expect(seq).toMatchObject({ source: 'volume-s3', started_at: '2026-11-17T09:30:00', workflow: null })
    expect(seq.files).toHaveLength(6)
    expect(seq.files.filter((f) => f.filename.endsWith('.dpx'))).toHaveLength(5)
    expect(seq.files[0]).toMatchObject({ subfolder: D, type: 'output', bytes: 49768064 })
    expect(`${O}/${seq.files[0].subfolder}/${seq.files[0].filename}`).toBe(`${O}/${D}/${D.split('/')[2]}_proxy.0000.dpx`)   // key = output/<subfolder>/<filename>
  })
  it('caps the objects and says so', async () => {
    for (let i = 0; i < outputsources.MAX_OBJECTS + 10; i++) TREE[`${O}/proxy_v004/archival-090/big/f${String(i).padStart(5, '0')}.png`] = [1, '2026-11-17 10:00:00']
    const l = await outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: 'proxy_v004/archival-090' })
    expect(l.capped).toBe(true); expect(l.total).toBe(outputsources.MAX_OBJECTS + 10)
    expect(l.runs[0].files).toHaveLength(outputsources.MAX_OBJECTS)
  })
  it('starts in output/*/<shot>/ when the pod has a shot, else the root', async () => {
    const l = await outputsources.volumeS3.list({ volume_id: VOL, shot: 'archival-084' }, opts())
    expect(l.prefix).toBe('proxy_v004/archival-084'); expect(l.runs[0].folder).toBe('proxy_v004/archival-084/x')
    const none = await outputsources.volumeS3.list({ volume_id: VOL, shot: 'nope-999' }, opts())
    expect(none.prefix).toBe(''); expect(none.start_note).toMatch(/nope-999/)
    const rnd = await outputsources.volumeS3.list({ volume_id: VOL, shot: 'archival-080', round: 'proxy_v005' }, opts())
    expect(rnd.prefix).toBe('proxy_v005/archival-080')
  })
  it('is unavailable with the reason when the S3 keys are missing, and starts nothing', async () => {
    delete process.env.RUNPOD_S3_ACCESS_KEY
    const a = await outputsources.volumeS3.available({ volume_id: VOL }, opts())
    expect(a.ok).toBe(false); expect(a.reason).toMatch(/RUNPOD_S3_ACCESS_KEY/)
    await expect(outputsources.volumeS3.list({ volume_id: VOL }, opts())).rejects.toThrow(/S3_ACCESS_KEY/)
    expect(calls).toHaveLength(0)
  })
  it('is unavailable with no volume at all', async () => {
    const cfg = mounts.load(); cfg.shared_volume_id = ''; cfg.network_volume_id = ''; mounts.save(cfg)
    expect((await outputsources.volumeS3.available({}, opts())).reason).toMatch(/No network volume/)
  })
  it('only ever reads: every aws call is `s3 ls`', async () => {
    await outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: '' })
    await outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: 'proxy_v004/archival-080' })
    await outputsources.volumeS3.list({ volume_id: VOL, shot: 'archival-080' }, opts())
    expect(calls.length).toBeGreaterThan(2)
    for (const c of calls) { expect(c.slice(0, 2)).toEqual(['s3', 'ls']); expect(c.join(' ')).not.toMatch(/\b(rm|mv|sync|put|mb|rb|delete)\b/) }
  })
  it('rejects a prefix that climbs out', async () => {
    await expect(outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: '../workflows' })).rejects.toThrow(/Not a folder/)
    await expect(outputsources.volumeS3.list({ volume_id: VOL }, { ...opts(), prefix: 'a//b' })).rejects.toThrow()
  })
  it('caches a prefix for 90 s', async () => {
    const o = { aws }
    await outputsources.volumeS3.list({ volume_id: VOL }, { ...o, prefix: '' }); await outputsources.volumeS3.list({ volume_id: VOL }, { ...o, prefix: '' })
    expect(calls).toHaveLength(1)
  })
  it('address is the s3file base of the volume', async () => {
    expect(await outputsources.volumeS3.address(null, { volume_id: VOL })).toBe(`s3file://${VOL}`)
  })
})

describe('registry and merge', () => {
  const run = (id: string, source: outputsources.SourceId, at: string | null, files: [string, string][] = [['', `${id}.png`]]): outputsources.OutputRun => ({ prompt_id: id, workflow: null, started_at: at, files: files.map(([subfolder, filename]) => ({ filename, subfolder, type: 'output' as const })), source })
  it('registers the three sources in precedence order', () => {
    expect(outputsources.sources().map((s) => s.id)).toEqual(['pod-history', 'saved', 'volume-s3'])
    for (const s of outputsources.sources()) expect(typeof s.available + typeof s.list + typeof s.address).toBe('functionfunctionfunction')
  })
  it('live wins over saved on the same prompt, and saved over a volume folder it wrote into; newest first', () => {
    const merged = outputsources.mergeRuns({
      'pod-history': [run('p1', 'pod-history', '2026-11-17T10:00:00', [['f', 'a.png']])],
      saved: [run('p1', 'saved', '2026-11-17T10:00:00', [['f', 'a.png']]), run('p2', 'saved', '2026-11-16T10:00:00', [['g', 'b.png']])],
      'volume-s3': [run('volume:v:f', 'volume-s3', '2026-11-17T10:01:00', [['f', 'a.png'], ['f', 'z.png']]), run('volume:v:g', 'volume-s3', '2026-11-16T10:00:00', [['g', 'b.png']]), run('volume:v:h', 'volume-s3', '2026-11-18T10:00:00', [['h', 'c.png']])],
    })
    expect(merged.map((r) => [r.prompt_id, r.source])).toEqual([['volume:v:h', 'volume-s3'], ['p1', 'pod-history'], ['p2', 'saved']])
  })
  it('listOutputs reports a failing source with its reason and still answers with the others', async () => {
    delete process.env.RUNPOD_S3_SECRET_KEY
    outputruns.record({ pod_id: 'p', volume_id: VOL }, [{ prompt_id: 's1', status: 'success', started_at: '2026-11-17T08:00:00Z', outputs: [{ filename: 'a.png', subfolder: 's', type: 'output' }] }])
    const a = await outputsources.listOutputs({ volume_id: VOL }, { ...opts(), source: undefined })
    expect(a.runs.map((r) => r.source)).toEqual(['saved'])
    expect(a.sources.find((s) => s.id === 'volume-s3')).toMatchObject({ ok: false }); expect(a.sources.find((s) => s.id === 'volume-s3')?.reason).toMatch(/S3_/)
    expect(a.sources.find((s) => s.id === 'pod-history')?.ok).toBe(false)
    await expect(outputsources.listOutputs({}, { source: 'nope' })).rejects.toThrow(/Unknown output source/)
  })
})

describe('the s3file guard', () => {
  const U = (key: string, vol = VOL) => `s3file://${vol}/${encodeURIComponent(key)}`
  it('accepts a key under comfy-shared/output/ of a known volume (case-insensitive host)', () => {
    expect(outputsources.guardS3FileUrl(U(`${O}/proxy_v004/a b/f.dpx`))).toEqual({ volume_id: VOL, key: `${O}/proxy_v004/a b/f.dpx` })
    expect(outputsources.guardS3FileUrl(U(`${O}/x.dpx`, VOL.toUpperCase())).volume_id).toBe(VOL)
  })
  it.each([
    ['outside output', 'comfy-shared/models/x.safetensors'], ['the workflows', 'comfy-shared/workflows/r/a.json'], ['a sibling prefix', 'comfy-shared/output2/x'], ['dot dot', `${O}/../models/x`], ['dot dot encoded in segments', `${O}/a/../../x`],
    ['empty segment', `${O}//x`], ['a folder', `${O}/a/`], ['the root only', `${O}/`], ['a backslash', `${O}/a\\..\\x`],
  ])('rejects %s', (_n, key) => { expect(() => outputsources.guardS3FileUrl(U(key))).toThrow(/Only files under/) })
  it('rejects another volume, another scheme and a query', () => {
    expect(() => outputsources.guardS3FileUrl(U(`${O}/x.dpx`, 'zzzzzzzzzz'))).toThrow(/unknown volume/)
    expect(() => outputsources.guardS3FileUrl(`https://${VOL}/${encodeURIComponent(`${O}/x`)}`)).toThrow()
    expect(() => outputsources.guardS3FileUrl(`${U(`${O}/x`)}?versionId=1`)).toThrow()
    expect(() => outputsources.guardS3FileUrl('not a url')).toThrow()
  })
  it('a signed read of a guarded key points at the volume\'s endpoint in path style, with the signature in headers only', async () => {
    const r = await outputsources.signGet(U(`${O}/p/f.dpx`), { now: new Date('2026-11-17T00:00:00Z'), range: 'bytes=0-0' })
    expect(r.url).toBe('https://s3api-eu-ro-1.runpod.io/a3upg9ey48/comfy-shared/output/p/f.dpx')
    expect(r.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=user_x\/20261117\/EU-RO-1\/s3\/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(JSON.stringify(r)).not.toContain('rps_y')
    expect((await outputsources.signGet(U(`${O}/p/f.dpx`), { range: 'bytes=0-1,5-9' })).headers.range).toBeUndefined()   // only a single range is forwarded
    await expect(outputsources.signGet(U('comfy-shared/models/x'))).rejects.toThrow(/Only files under/)
  })
  it('signing without keys is a clear 409, not a crash', async () => {
    delete process.env.RUNPOD_S3_SECRET_KEY
    await expect(outputsources.signGet(U(`${O}/p/f.dpx`))).rejects.toMatchObject({ status: 409 })
  })
})
