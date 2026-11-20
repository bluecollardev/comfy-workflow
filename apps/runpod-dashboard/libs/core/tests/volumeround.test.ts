import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import * as history from '../src/history.js'
import * as imports from '../src/imports.js'
import * as library from '../src/library.js'
import * as mounts from '../src/mounts.js'
import * as podpull from '../src/podpull.js'
import * as queue from '../src/queue.js'
import * as volumeround from '../src/volumeround.js'
import { scratch } from './helpers.js'

// ADR-044 steps 2 to 4: the volume source (a fake S3 listing, no pod, no spend), the round adapter's describe, the three guards, the estimate and the queue tasks.
vi.setConfig({ testTimeout: 30_000 })   // adapters run in child processes and library.sources() asks panama: slow on a busy machine
const VOL = 'a3upg9ey48'
const ROW = (key: string, bytes = 1000) => `2026-11-17 10:00:00 ${String(bytes).padStart(10)} ${key}`
const W = 'comfy-shared/workflows'
const LISTING: Record<string, string[]> = {
  proxy_v005: [
    `${W}/proxy_v005/archival-080/archival-080__a__proxy_v005.json`, `${W}/proxy_v005/archival-080/archival-080__b__proxy_v005.json`, `${W}/proxy_v005/archival-080/archival-080__a__proxy_v005_api.json`,
    `${W}/proxy_v005/archival-084/archival-084__main__proxy_v005.json`,
    `${W}/proxy_v005/cgi-042/cgi-042__a__proxy_v005.json`,
    `${W}/proxy_v005/enhance-141/04_GRAPH/enhance-141__a__proxy_v005.json`,
  ],
  proxy_v004g: [`${W}/proxy_v004g/archival-080/archival-080__e__proxy_v004g.json`],
  canalv2: [`${W}/canalv2/README.md`],
}
let calls: string[][]
const aws: podpull.AwsRunner = async (args) => {
  calls.push(args)
  const url = args[2]
  if (!args.includes('--recursive')) return { code: 0, stdout: Object.keys(LISTING).map((r) => `                           PRE ${r}/`).join('\n'), stderr: '' }
  const round = Object.keys(LISTING).find((r) => url === `s3://${VOL}/${W}/${r}/`)
  if (!round) return { code: 1, stdout: '', stderr: 'NoSuchKey' }
  return { code: 0, stdout: LISTING[round].map((k) => ROW(k)).join('\n'), stderr: '' }
}
const opts = () => ({ aws })

beforeEach(() => {
  const dir = scratch(); process.env.HISTORY_FILE = join(dir, 'history.jsonl'); process.env.QUEUE_FILE = join(dir, 'queue.json')
  process.env.RUNPOD_S3_ACCESS_KEY = 'user_x'; process.env.RUNPOD_S3_SECRET_KEY = 'rps_y'
  const cfg = mounts.defaults(); cfg.dry_run = false; cfg.data_center_id = 'EU-RO-1'; cfg.shared_volume_id = VOL; cfg.network_volume_id = VOL; mounts.save(cfg)
  calls = []; volumeround.forgetCache(); queue.forget()
})
afterEach(() => { delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY; queue.stop(); queue.reset(); queue.forget() })

describe('browsing a round (Browse Files): a read-only tree by prefix', () => {
  const runner = (files: Record<string, string[]>, fail?: { code: number; stderr: string }): podpull.AwsRunner => async (args) => {
    calls.push(args)
    if (fail) return { code: fail.code, stdout: '', stderr: fail.stderr }
    const hit = Object.keys(files).find((p) => args[2] === `s3://${VOL}/${p}/`)
    if (!hit) return { code: 1, stdout: '', stderr: '' }   // aws s3 ls on a prefix with nothing in it: exit 1, no message
    return { code: 0, stdout: files[hit].map((k) => ROW(k, k.endsWith('.md') ? 2000 : 100)).join('\n'), stderr: '' }
  }
  it('lists a round: folders with totals, files with sizes, paths relative to the round, one recursive prefix call under comfy-shared/workflows/', async () => {
    const t = await volumeround.browseRound(VOL, 'proxy_v005', '', { aws: runner({ [`${W}/proxy_v005`]: LISTING.proxy_v005.concat([`${W}/proxy_v005/README.md`]) }) })
    expect(t).toMatchObject({ root: `${W}/proxy_v005`, files: 7, truncated: false })
    expect(t.entries.find((e) => e.path === 'archival-080')).toMatchObject({ dir: true, files: 3, bytes: 300 })
    expect(t.entries.find((e) => e.path === 'README.md')).toMatchObject({ dir: false, bytes: 2000 })
    expect(t.entries.map((e) => e.path)).toContain('enhance-141/04_GRAPH/enhance-141__a__proxy_v005.json')
    expect(calls).toHaveLength(1); expect(calls[0][2]).toBe(`s3://${VOL}/${W}/proxy_v005/`); expect(calls[0]).toContain('--recursive')
  })
  it('lists one shot: only its folder, paths start with the shot', async () => {
    const t = await volumeround.browseRound(VOL, 'proxy_v005', 'archival-080', { aws: runner({ [`${W}/proxy_v005/archival-080`]: LISTING.proxy_v005.filter((k) => k.includes('/archival-080/')) }) })
    expect(t.root).toBe(`${W}/proxy_v005/archival-080`); expect(t.files).toBe(3)
    expect(t.entries[0]).toMatchObject({ path: 'archival-080', dir: true, files: 3 })
    expect(t.entries.every((e) => e.path.startsWith('archival-080'))).toBe(true)
  })
  it('a prefix with nothing in it is an empty tree, not an error', async () => {
    await expect(volumeround.browseRound(VOL, 'base_v008', '', { aws: runner({}) })).resolves.toMatchObject({ entries: [], files: 0, bytes: 0, truncated: false })
  })
  it('stops at 3000 files and says so', async () => {
    const many = Array.from({ length: 3050 }, (_, i) => `${W}/big/s/f${String(i).padStart(5, '0')}.json`)
    const t = await volumeround.browseRound(VOL, 'big', '', { aws: runner({ [`${W}/big`]: many }) })
    expect(t.truncated).toBe(true); expect(t.files).toBe(3000)
  })
  it('a real failure keeps RunPod\'s first line, with no key or URL in it; a bad name is refused before any call', async () => {
    const err = await volumeround.browseRound(VOL, 'r', '', { aws: runner({}, { code: 255, stderr: 'An error occurred (AccessDenied) for user_x with rps_y at https://s3api-eu-ro-1.runpod.io/abc?X-Amz-Signature=zz' }) }).catch((e) => e as Error)
    expect((err as Error).message).toMatch(/AccessDenied/); expect((err as Error).message).not.toMatch(/user_x|rps_y|https?:/)
    await expect(volumeround.browseRound(VOL, '../x', '', { aws: runner({}) })).rejects.toThrow(/Not a round folder/)
    expect(calls).toHaveLength(1)
  })
})

describe('the round adapter (describe)', () => {
  it('is a built-in round adapter with a documentation header', async () => {
    const row = (await imports.list()).find((r) => r.id === 'brynley-rounds-layout')
    expect(row).toMatchObject({ builtin: true, kind: 'round' }); expect(row?.error).toBeUndefined()
    expect(imports.validateSource(imports.source('brynley-rounds-layout').text, 'brynley-rounds-layout')).toEqual([])
  })
  it('reads a listing, not a folder: shots, variants, graphs as the panel names them, locked shots flagged', async () => {
    const d = await imports.describeRound([
      { path: 'archival-080/archival-080__a__proxy_v005.json', bytes: 10 }, { path: 'archival-080/archival-080__b__proxy_v005.json', bytes: 11 }, { path: 'archival-080/archival-080__a__proxy_v005_api.json', bytes: 5 },
      { path: 'cgi-042/cgi-042__a__proxy_v005.json', bytes: 9 }, { path: 'enhance-141/04_GRAPH/enhance-141__a__proxy_v005.json', bytes: 9 }, { path: 'notes.txt', bytes: 1 },
    ], { round: 'proxy_v005' })
    expect(d).toMatchObject({ kind: 'round', round: 'proxy_v005', shots: ['archival-080', 'cgi-042', 'enhance-141'], variants: ['a', 'b'], locked: ['cgi-042', 'enhance-141'] })
    expect(d.graphs.map((g) => g.path)).toEqual(['proxy_v005/archival-080/archival-080__a__proxy_v005.json', 'proxy_v005/archival-080/archival-080__b__proxy_v005.json', 'proxy_v005/cgi-042/cgi-042__a__proxy_v005.json', 'proxy_v005/enhance-141/04_GRAPH/enhance-141__a__proxy_v005.json'])
    expect(d.graphs.filter((g) => g.locked).map((g) => g.shot)).toEqual(['cgi-042', 'enhance-141'])
    expect(d.findings.some((f) => /cgi-042 is locked/.test(f.text))).toBe(true)
  })
  it('refuses an adapter that is not a round adapter, and a listing it cannot be given a path outside of', async () => {
    await expect(imports.describeRound([], { round: 'x', adapter: 'comfy-shared' })).rejects.toThrow(/round adapter/)
    const d = await imports.describeRound([{ path: '../evil/x__a__r.json', bytes: 1 }, { path: '/abs/x__a__r.json', bytes: 1 }], { round: 'r' })
    expect(d.graphs).toEqual([])   // the runner drops paths that leave the round
  })
})

describe('the volume source (read-only, no pod)', () => {
  it('is in sources() with a volume chooser, and says why when it cannot be used', () => {
    expect(library.sources().find((s) => s.id === 'volume')).toMatchObject({ id: 'volume', needs: 'volume', available: true })
    delete process.env.RUNPOD_S3_ACCESS_KEY
    const s = library.sources().find((x) => x.id === 'volume')!
    expect(s.available).toBe(false); expect(s.reason).toMatch(/RUNPOD_S3_ACCESS_KEY/)
  })
  it('lists the rounds by prefix with shots, graph counts and locked shots; never the whole volume', async () => {
    const items = await library.list('volume', { volume_id: VOL, ...opts() } as never)
    const r5 = items.find((i) => i.id === 'proxy_v005')!
    expect(r5).toMatchObject({ source: 'volume', staged: true, verified: false, importable: true, volume_id: VOL, graphs: 5, locked: ['cgi-042', 'enhance-141'] })
    expect(r5.shots).toEqual(['archival-080', 'archival-084', 'cgi-042', 'enhance-141'])
    expect(items.find((i) => i.id === 'canalv2')).toMatchObject({ importable: false, shots: [] })   // listed, not a round
    expect(calls.every((a) => a[0] === 's3' && a[1] === 'ls')).toBe(true)   // only `aws s3 ls`: nothing writes
    expect(calls.every((a) => a[2] === `s3://${VOL}/${W}/` || a[2].startsWith(`s3://${VOL}/${W}/`) && a[2].endsWith('/'))).toBe(true)
    expect(calls.some((a) => a[2] === `s3://${VOL}/`)).toBe(false)   // never the whole volume
  })
  it('caches a round for a minute or two', async () => {
    await volumeround.describeRound(VOL, 'proxy_v005', opts()); const n = calls.length
    await volumeround.describeRound(VOL, 'proxy_v005', opts()); expect(calls.length).toBe(n)
    await volumeround.describeRound(VOL, 'proxy_v005', { ...opts(), now: () => new Date(Date.now() + 5 * 60_000) }); expect(calls.length).toBe(n + 1)
  })
  it('without S3 keys it is unavailable with the reason and nothing is started or listed', async () => {
    delete process.env.RUNPOD_S3_SECRET_KEY
    const st = await library.status('volume', { volume_id: VOL })
    expect(st.available).toBe(false); expect(st.reason).toMatch(/not set/)
    await expect(library.list('volume', { volume_id: VOL })).rejects.toMatchObject({ status: 409 })
    expect(calls).toEqual([])
  })
  it('refuses a round folder name that leaves the workflows folder', async () => { await expect(volumeround.roundFiles(VOL, '../models', opts())).rejects.toThrow(/Not a round folder/) })
})

// ----- the queue: in place, the three guards, the estimate -----
function world(over: Partial<queue.Deps> = {}) {
  const w = { runs: [] as { podId: string; paths: string[] }[], pulled: 0, ensured: [] as (string | undefined)[], created: 0 }
  queue.configure({
    describeVolumeRound: (v, r) => volumeround.describeRound(v, r, opts()),
    cardPrice: async () => 0.36,   // $/h: 600 s of one graph is $0.06
    runSeconds: () => ({ seconds: null, samples: 0 }), remainingUsd: () => null,
    ensureVolume: async (id) => { w.ensured.push(id) },
    volumePods: async () => [{ id: 'p1', name: 'pool', state: 'running', price: 0.36, gpu: 'RTX 4090' }],
    podReady: async () => ({ ready: true, price: 0.36 }), assignShot: () => {},
    pull: async () => { w.pulled++; return { id: 'x' } },
    createPod: async (n) => { w.created++; return { id: 'n1', name: n } },
    run: async (podId, paths) => { w.runs.push({ podId, paths }); return { id: `rj${w.runs.length}` } },
    runJob: ((id: string) => ({ id, state: 'running', ok: 0, failed: 0, results: [] })) as never,
    ...over,
  })
  return w
}

describe('importing a volume round: in place', () => {
  it('several cards for a shot: priced at the dearest, the plan says so, the task keeps the ordered list; an unknown key refuses', async () => {
    world({ cardPrice: async (g) => (g === 'a40' ? 0.18 : g === 'rtx5090' ? 0.72 : null) })
    const one = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['archival-080'], cards: { 'archival-080': ['a40'] } })
    const two = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['archival-080'], cards: { 'archival-080': ['a40', 'rtx5090'] } })
    expect(two.est_total_usd).toBe(Math.round(one.est_total_usd! * 4 * 100) / 100)   // 0.72 / 0.18
    expect(two.assumption).toMatch(/most expensive/); expect(one.assumption).not.toMatch(/most expensive/)
    await expect(queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['archival-080'], cards: { 'archival-080': ['a40', 'nope'] } })).rejects.toThrow(/Unknown card/)
    await queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['archival-080'], cards: { 'archival-080': ['a40', 'rtx5090'] }, approved_by: 'Lucas', cost_cap_usd: 50 })
    expect(queue.list().tasks.find((t) => t.shot === 'archival-080')).toMatchObject({ gpu: 'a40', gpus: ['a40', 'rtx5090'], price: 0.72 })
  })
  it('plans the shots, the graphs as the panel names them and the estimate with its assumption; locked shots are listed, not planned', async () => {
    world()
    const p = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL })
    expect(p).toMatchObject({ source: 'volume', volume_id: VOL, shots: ['archival-080', 'archival-084'], graphs: 3, locked: ['cgi-042', 'enhance-141'], refused: [], seconds_per_graph: 600, over_cap: false })
    expect(p.est_total_usd).toBe(0.18)   // 3 graphs x 600 s x $0.36/h
    expect(p.assumption).toMatch(/600 s/); expect(p.assumption).toMatch(/default/)
    expect(p.pull_hours).toBe(0)
  })
  it('uses the History median seconds per graph when runs were recorded', async () => {
    world({ runSeconds: volumeround.medianSecondsPerGraph })
    for (const s of [100, 200, 300]) history.record({ kind: 'job', job: 'run', state: 'done', what: 'x.json', detail: `prompt p; ${s}s` })
    history.record({ kind: 'job', job: 'run', state: 'done', what: 'sim.json', detail: '0.3s' })   // a simulation: not counted
    history.record({ kind: 'job', job: 'run', state: 'failed', what: 'bad.json', detail: '9999s' })
    const p = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['archival-080'] })
    expect(p).toMatchObject({ seconds_per_graph: 200, samples: 3, graphs: 2 }); expect(p.assumption).toMatch(/median of 3/)
    expect(p.est_total_usd).toBe(0.04)   // 2 x 200 s x 0.36/3600
  })
  it('queues one run task per shot with the graph paths, and NO pull: nothing is copied', async () => {
    const w = world()
    const imp = await queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'Lucas', cost_cap_usd: 5 })
    expect(imp).toMatchObject({ source: 'volume', volume_id: VOL, shots: ['archival-080', 'archival-084'], graphs: 3 })
    const t = queue.list().tasks
    expect(t.map((x) => `${x.kind}:${x.shot}`)).toEqual(['run:archival-080', 'run:archival-084'])   // no pull task
    expect(t[0].graphs).toEqual(['proxy_v005/archival-080/archival-080__a__proxy_v005.json', 'proxy_v005/archival-080/archival-080__b__proxy_v005.json'])
    expect(t.every((x) => x.depends_on.length === 0)).toBe(true)
    expect(w.pulled).toBe(0); expect(w.ensured).toEqual([VOL])
    await queue.tick(); await queue.tick()   // a pool pod takes the runs
    expect(w.runs.map((r) => r.paths)).toContainEqual(['proxy_v005/archival-084/archival-084__main__proxy_v005.json'])
    expect(w.pulled).toBe(0)
  })
  it('needs approved_by', async () => { world(); await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL })).rejects.toThrow(/approved_by/) })
})

describe('the three guards', () => {
  it('(a) a volume source never offers or accepts Replace / overwrite, and its code only ever lists', async () => {
    world()
    for (const k of ['replace', 'overwrite'] as const) {
      await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', [k]: true })).rejects.toThrow(/never overwritten/)
      await expect(queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, [k]: true })).rejects.toThrow(/never overwritten/)
      await expect(queue.importRounds([{ round: 'proxy_v005' }], { source: 'volume', volume_id: VOL, approved_by: 'L', [k]: true })).rejects.toThrow(/never overwritten/)
    }
    expect(queue.list().tasks).toEqual([])
    await volumeround.describeRound(VOL, 'proxy_v005', opts()); await volumeround.preflightRound(VOL, 'proxy_v005', {}, opts()).catch(() => {})
    for (const a of calls) expect(['ls', 'cp']).toContain(a[1])
    for (const a of calls.filter((x) => x[1] === 'cp')) expect(a[3]).toBe('-')   // a read to stdout, never a copy onto the volume
    for (const a of calls) expect(a.some((x) => ['rm', 'mv', 'sync', 'rb', 'mb'].includes(x))).toBe(false)
  })
  it('(b) locked shots and anything under 04_GRAPH are refused at start, in the core; listed, never run', async () => {
    const w = world()
    await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', shots: ['cgi-042'] })).rejects.toMatchObject({ status: 403 })
    await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', shots: ['archival-080', 'enhance-141'] })).rejects.toThrow(/enhance-141 is locked/)
    await expect(queue.importRounds([{ round: 'proxy_v005', shots: ['cgi-042'] }], { source: 'volume', volume_id: VOL, approved_by: 'L' })).rejects.toMatchObject({ status: 403 })
    const p = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, shots: ['cgi-042', 'archival-080'] })
    expect(p.refused).toEqual(['cgi-042']); expect(p.blocked).toMatch(/never run/)   // the plan says it before start
    expect(queue.list().tasks).toEqual([]); expect(w.runs).toEqual([])
    // all shots: the locked ones are left out, never queued
    await queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', cost_cap_usd: 5 })
    expect(queue.list().tasks.map((t) => t.shot)).not.toContain('cgi-042'); expect(queue.list().tasks.flatMap((t) => t.graphs ?? []).some((g) => /04_GRAPH|cgi-042/.test(g))).toBe(false)
  })
  it('(b) holds even if a replaced adapter says nothing is locked', async () => {
    world({ describeVolumeRound: async (v, r) => { const d = await volumeround.describeRound(v, r, opts()); return { ...d, locked: [] } } })
    // the core's own rule applied inside describeRound: cgi-042 and 04_GRAPH stay locked
    expect((await volumeround.describeRound(VOL, 'proxy_v005', opts())).locked).toEqual(['cgi-042', 'enhance-141'])
  })
  it('(c) the estimate is in the plan before start, and start refuses when it would pass the cap', async () => {
    world()
    const p = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, cost_cap_usd: 0.1 })
    expect(p).toMatchObject({ est_total_usd: 0.18, cost_cap_usd: 0.1, over_cap: true }); expect(p.blocked).toMatch(/passes the cap \$0.1/)
    await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', cost_cap_usd: 0.1 })).rejects.toMatchObject({ status: 402 })
    await expect(queue.importRounds([{ round: 'proxy_v005' }], { source: 'volume', volume_id: VOL, approved_by: 'L', cost_cap_usd: 0.1 })).rejects.toMatchObject({ status: 402 })
    expect(queue.list().tasks).toEqual([])
    await queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', cost_cap_usd: 0.2 })   // under the cap: starts
    expect(queue.list().tasks.length).toBe(2)
  })
  it('(c) also against what the USD 100 rule leaves', async () => {
    world({ remainingUsd: () => 0.05 })
    const p = await queue.planImport('proxy_v005', { source: 'volume', volume_id: VOL, cost_cap_usd: 50 })
    expect(p).toMatchObject({ over_cap: true, remaining_usd: 0.05 }); expect(p.blocked).toMatch(/agent spend cap/)
    await expect(queue.importRound('proxy_v005', { source: 'volume', volume_id: VOL, approved_by: 'L', cost_cap_usd: 50 })).rejects.toMatchObject({ status: 402 })
  })
  it('a BH import is unchanged by all this (an unknown source is refused, not guessed)', async () => {
    world({ shotsOf: async () => ['cgi-042'], planPull: async () => ({ price_per_hour: 1, ceiling_minutes: 30, bytes: 1 }) })
    await expect(queue.planImport('r', { source: 'nope' })).rejects.toThrow(/Unknown source/)
    const p = await queue.planImport('r', {})
    expect(p.source).toBeUndefined(); expect(p.shots).toEqual(['cgi-042'])
  })
})

describe('the models preflight (read-only)', () => {
  it('names the models a graph uses, with the loader that reads them (both ComfyUI formats)', () => {
    const ui = { nodes: [{ type: 'LTXVAudioVAELoader', widgets_values: ['LTX23_audio_vae_bf16.safetensors'] }, { type: 'KSampler', widgets_values: [1, 'euler'] }, { type: 'LoraLoader', widgets_values: ['a/b.safetensors', 1] }] }
    expect(volumeround.modelNamesOf(ui)).toEqual([{ name: 'a/b.safetensors', node_type: 'LoraLoader' }, { name: 'LTX23_audio_vae_bf16.safetensors', node_type: 'LTXVAudioVAELoader' }])
    expect(volumeround.modelNamesOf({ '3': { class_type: 'VAELoader', inputs: { vae_name: 'v.safetensors', other: 1 } } })).toEqual([{ name: 'v.safetensors', node_type: 'VAELoader' }])
  })
  it('reports a miss and where the same file is (the 2026-11-17 audio VAE case); changes nothing', async () => {
    const graph = JSON.stringify({ nodes: [{ type: 'LTXVAudioVAELoader', widgets_values: ['LTX23_audio_vae_bf16.safetensors'] }, { type: 'VAELoader', widgets_values: ['ok_vae.safetensors'] }, { type: 'UNETLoader', widgets_values: ['gone.safetensors'] }] })
    const fake: podpull.AwsRunner = async (args) => {
      calls.push(args)
      if (args[1] === 'cp') return { code: 0, stdout: graph, stderr: '' }
      if (args[2].includes('/models/')) return { code: 0, stdout: [ROW('comfy-shared/models/vae/LTX23_audio_vae_bf16.safetensors'), ROW('comfy-shared/models/vae/ok_vae.safetensors')].join('\n'), stderr: '' }
      return aws(args, {})
    }
    const r = await volumeround.preflightRound(VOL, 'proxy_v004g', {}, { aws: fake })
    expect(r.checked).toBe(1)
    expect(r.graphs[0].missing).toEqual([
      { name: 'gone.safetensors', node_type: 'UNETLoader', reads: ['models/diffusion_models/', 'models/unet/'], elsewhere: [] },
      { name: 'LTX23_audio_vae_bf16.safetensors', node_type: 'LTXVAudioVAELoader', reads: ['models/checkpoints/'], elsewhere: ['models/vae/LTX23_audio_vae_bf16.safetensors'] },
    ].sort((a, b) => 0))
    expect(calls.every((a) => a[1] === 'ls' || (a[1] === 'cp' && a[3] === '-'))).toBe(true)
    // the same in words: each missing model with where it belongs on the volume, what to do, never retried
    expect(r.problems.map((p) => [p.stage, p.retryable, p.missing_models[0].name])).toEqual([['load', false, 'gone.safetensors'], ['load', false, 'LTX23_audio_vae_bf16.safetensors']]); expect(r.problems[0].missing_models[0].where_on_volume).toBe('comfy-shared/models/diffusion_models/gone.safetensors'); expect(r.problems[0].recovery).toMatch(/Fetch gone\.safetensors to models\/diffusion_models\/.*Not retried/); expect(r.problems[1].recovery).toMatch(/exists elsewhere on the volume: models\/vae\/LTX23_audio_vae_bf16\.safetensors/)
  })
})
