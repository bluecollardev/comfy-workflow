import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CoreError } from '../src/errors.js'
import * as history from '../src/history.js'
import * as publish from '../src/publish.js'
import * as mounts from '../src/mounts.js'
import * as renders from '../src/renders.js'
import { scratch } from './helpers.js'

// ADR-048: rendered sequences. A fake pod (ssh), a fake ffmpeg (spawn), a fake sync: no pod, no ffmpeg, no aws, no RunPod.
let dir: string, shared: string, t: number
let pod: { record?: string | null; frames: number[]; lastM: number; outM: number; outS: number; failExit: number; nodir: boolean; hold: Promise<void> | null; header: Buffer; ffprobe: boolean; count: number | null; versions: string[]; vexists: boolean; cpu: { cores: number; memMb: number; dfKb: number } | 'fail' | null }
let scripts: string[], pulls: { req: Record<string, unknown> }[], emitted: string[], spawned: { cmd: string; args: string[] }[], podOk: boolean, ffmpegAt: string | null, versionExit: number, versionLine: string
let volText: string | null = null
let localCount = 10, cancelSeen: boolean, probeName = 'ARCHIVAL-085_MAIN_23.976_PRORES'
const SEQ = { dir: 'proxy_v004/shotA', name: 'ARCHIVAL-085_MAIN_23.976_PRORES', first: 0, last: 9, frames: 10, pad: 4 }
/** A DPX header the way the camera or OCIOWrite makes one: big-endian, 3840x2160, 10-bit RGB packed, with the given transfer. */
const dpxHeader = (o: { transfer?: number; colorimetric?: number; width?: number; height?: number; bits?: number } = {}) => { const b = Buffer.alloc(820); b.write('SDPX', 0); b.writeUInt32BE(o.width ?? 3840, 772); b.writeUInt32BE(o.height ?? 2160, 776); b.writeUInt8(50, 800); b.writeUInt8(o.transfer ?? 0, 801); b.writeUInt8(o.colorimetric ?? 0, 802); b.writeUInt8(o.bits ?? 10, 803); b.writeUInt16BE(0, 804); return b }
const hex = (b: Buffer) => b.toString('hex')
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
const until = async (f: () => unknown, n = 200) => { for (let i = 0; i < n && !f(); i++) await new Promise((r) => setTimeout(r, 5)) }
const job = (id: string) => renders.status(id).jobs[0]

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true }); process.env.RENDERS_FILE = join(dir, 'renders.json'); process.env.HISTORY_FILE = join(dir, 'h.jsonl')
  mounts.save({ ...mounts.load(), render: { ...mounts.RENDER_DEFAULT, kind: 'proxy', pull: true } })   // the tests below pull: a stored `pull: true` is kept (the default is off now); and render quick proxies (the shipped default kind is review)
  renders.reset(); t = Date.parse('2026-11-19T10:00:00Z'); scripts = []; pulls = []; emitted = []; spawned = []; podOk = true; ffmpegAt = '/opt/homebrew/bin/ffmpeg'; versionExit = 0; versionLine = 'ffmpeg version 9.0.2'; cancelSeen = false
  localCount = 10; volText = null; pod = { frames: range(0, 9), lastM: 100, outM: 0, outS: 0, failExit: 0, nodir: false, hold: null, header: dpxHeader(), ffprobe: true, count: null, versions: [], vexists: false, cpu: null }
  renders.setDeps({
    now: () => t, podName: () => 'CanalV2', volumeId: () => 'volx1', localRoot: () => shared, outputDir: () => '/workspace/comfy-shared/output',
    target: async () => (podOk ? { host: 'root@1.2.3.4', port: 22 } : { reason: 'Start the pod: rendering happens on the pod' }),
    ssh: async ({ script, onLine, signal }) => {
      scripts.push(script)
      if (script.includes('base64 < ')) { if (pod.record != null) onLine(`REC 0 ${Buffer.from(pod.record).toString('base64')}`); return { code: 0 } }   // the OCIO record the pod holds next to the sequence
      if (script.includes('NPROC')) { if (pod.cpu === 'fail') throw new Error('ssh: timeout'); if (pod.cpu) { onLine(`NPROC ${pod.cpu.cores}`); onLine(`MEM ${pod.cpu.memMb} ${Math.round(pod.cpu.memMb / 2)}`); onLine(`DF ${pod.cpu.dfKb}`) } return { code: 0 } }
      if (script.includes('PROBE-DONE')) {
        onLine('FFV ffmpeg version 7.1'); onLine(`OUTM ${pod.outM}`); onLine(`OUTS ${pod.outS}`); onLine('OMETS 0'); onLine('POUTM 0'); onLine('POUTS 0'); onLine('PMETS 0')
        if (pod.nodir) onLine('PROBE-NODIR')
        else { onLine(`HDR ${hex(pod.header)}`); onLine(`FFP ${pod.ffprobe ? 1 : 0}`); for (const f of pod.frames) onLine(`F 1000 ${pod.lastM}.0 ${probeName}.${String(f).padStart(4, '0')}.dpx`) }
        onLine('PROBE-DONE')
      } else if (script.startsWith('ls -1')) { for (const v of pod.versions) onLine(v) }
      else if (script.includes('CANCELLED')) { cancelSeen = true }
      else if (script.includes('nice -n 10')) {
        if (pod.hold) { await Promise.race([pod.hold, new Promise<void>((r) => signal.addEventListener('abort', () => r()))]); if (signal.aborted) return { code: 255 } }
        if (pod.vexists) { onLine('RENDER-VEXISTS'); return { code: 0 } }
        const nPass = (script.match(/^PASS \d+$/gm) ?? []).length || 1
        for (let k = 0; k < nPass; k++) { onLine(`PASS ${k}`); onLine('frame=5'); onLine('progress=continue'); onLine('frame=10'); onLine('progress=end'); if (pod.failExit) { onLine(`RENDER-EXIT ${pod.failExit}`); return { code: 0 } }
          if (pod.count !== null) { onLine(`RENDER-COUNT ${pod.count} 10`); return { code: 0 } }; onLine(`RENDER-DONE ${k} ${123456 + k} 10`) }
        onLine('RENDER-ALL')
      }
      return { code: 0 }
    },
    pull: async (req) => { pulls.push({ req: req as never }); return { steps: 1, failed: 0, warned: 0, cancelled: false } },
    listing: async (_v, d) => (d === 'proxy_v004/shotA' ? [{ name: `${SEQ.name}_960.mp4`, bytes: 777, modified: '2026-11-19T09:00:00' }, { name: `${SEQ.name}_1280.mp4`, bytes: 999, modified: '2026-11-19T09:01:00' }] : []),
    emit: async (_v, prefix) => { emitted.push(prefix) },
    findFfmpeg: async () => ffmpegAt, findFfprobe: async () => '/fake/ffprobe', deliverDirs: async () => [], deliverFiles: async () => [], readText: async () => volText,
    spawn: async (cmd, args, onLine) => { spawned.push({ cmd, args }); if (cmd.endsWith('ffprobe')) { onLine(String(localCount)); return { code: 0 } } if (args[0] === '-version') { onLine(versionLine); return { code: versionExit } } const part = args.at(-1)!; mkdirSync(join(part, '..'), { recursive: true }); writeFileSync(part, 'x'.repeat(50)); onLine('frame=4'); onLine('frame=10'); return { code: 0 } },
  })
})
afterEach(() => { renders.reset(); delete process.env.RENDERS_FILE })

describe('quoting and arguments', () => {
  const quoted = (s: string) => new Promise<string>((res, rej) => execFile('bash', ['-c', `printf %s ${renders.q(s)}`], (e, out) => (e ? rej(e) : res(out))))
  it('every file name stays data: spaces, quotes, ; $() and backticks survive bash exactly', async () => {
    for (const n of ["A B", "it's", 'a;rm -rf /', '$(touch /tmp/pwned)', '`id`', 'a"b', "x'; echo hi #"]) expect(await quoted(n)).toBe(n)
    expect(existsSync('/tmp/pwned')).toBe(false)
  })
  it('the exact ffmpeg arguments: fps from the name, pad, first, frames, width, .part output', () => {
    expect(renders.ffmpegArgs(SEQ, 1280, { outputDir: '/workspace/comfy-shared/output', frames: 10 })).toEqual(['ffmpeg', '-nostdin', '-y', '-loglevel', 'warning', '-framerate', '24000/1001', '-start_number', '0', '-i', `/workspace/comfy-shared/output/proxy_v004/shotA/${SEQ.name}.%04d.dpx`, '-frames:v', '10',
      '-vf', 'scale=1280:-2:flags=lanczos:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-colorspace', 'bt709', '-movflags', '+faststart', '-an', '-progress', 'pipe:1', '-f', 'mp4', `/workspace/comfy-shared/output/.proxies/proxy_v004/shotA/${SEQ.name}_1280.mp4.part`])
    const a = renders.ffmpegArgs({ ...SEQ, first: 1001, pad: 6 }, 960, { outputDir: '/o', frames: 5, fps: 25 }); expect(a[a.indexOf('-framerate') + 1]).toBe('25'); expect(a[a.indexOf('-start_number') + 1]).toBe('1001'); expect(a[a.indexOf('-i') + 1]).toMatch(/%06d\.dpx$/)
  })
  it('fps: the request, else _NN.NNN_ in the name (12 to 120), else 24', () => { expect(renders.fpsOf('a_23.976_b')).toBe('23.976'); expect(renders.rationalFps('23.976')).toBe('24000/1001'); expect(renders.rationalFps('29.97')).toBe('30000/1001'); expect(renders.rationalFps('59.94')).toBe('60000/1001'); expect(renders.rationalFps('25')).toBe('25'); expect(renders.rationalFps('12.5')).toBe('12.5'); expect(renders.fpsOf('a_3840X2160_23.976_x')).toBe('23.976'); expect(renders.fpsOf('a_200_b')).toBe('24'); expect(renders.fpsOf('plain')).toBe('24'); expect(renders.fpsOf('a_30_b', 48)).toBe('48') })
  it('a script with awkward names puts them in quotes only', () => {
    const s = renders.renderScript([{ args: renders.ffmpegArgs({ ...SEQ, name: "A B's;x" }, 960, { outputDir: '/o' }), fmt: 'mp4', verify: null }], 'job1', 0)
    expect(s).toContain(renders.q("/o/proxy_v004/shotA/A B's;x.%04d.dpx")); expect(s).not.toMatch(/;x\.%04d\.dpx[^']/)
  })
  it('validation: no .., no absolute, no % or slash in a name, a width from the list or source, whole numbers', () => {
    for (const bad of [{ ...SEQ, dir: '../x' }, { ...SEQ, dir: '/abs' }, { ...SEQ, name: 'a/b' }, { ...SEQ, name: 'a%d' }, { ...SEQ, last: -1 }, { ...SEQ, pad: 0 }, { ...SEQ, fps: 999 }, null]) expect(() => renders.validateSequence(bad as never)).toThrow()
    expect(() => renders.validateWidth(800)).toThrow(/width is source or one of/); expect(renders.validateWidth('source')).toBe('source'); expect(renders.validateWidth('1280')).toBe(1280)
  })
  it('reads ffmpeg -progress lines', () => {
    expect(renders.parseProgress('frame=123')).toEqual({ frame: 123 }); expect(renders.parseProgress('progress=end')).toEqual({ ended: true }); expect(renders.parseProgress('progress=continue')).toEqual({ ended: false })
    expect(renders.parseProgress('fps=23.1')).toBeNull(); expect(renders.parseProgress('Error opening input')).toBeNull(); expect(renders.parseProgress('frame=NaN')).toBeNull()
  })
})

describe('plan and the choice of adapter', () => {
  it('plan shape: out path, exists_remote (S3 listing), exists_local, gaps, adapters, where; the pod reason', async () => {
    const p = await renders.plan({ pod_id: 'p1', sequences: [{ ...SEQ, frames: 8 }], width: 960 })
    expect(p).toMatchObject({ pod_ok: true, where: 'pod', total_frames: 8, adapters: [{ id: 'pod', ok: true }, { id: 'local', ok: true }] })
    expect(p.sequences[0]).toMatchObject({ out: `output/.proxies/proxy_v004/shotA/${SEQ.name}_960.mp4`, exists_remote: true, exists_local: false, gaps: 0, complete: true, missing: [], where: 'pod', source: { width: 3840, height: 2160, bits: 10 } })
    podOk = false; const q = await renders.plan({ pod_id: 'p1', sequences: [SEQ], width: 960, where: 'pod' })
    expect(q.pod_ok).toBe(false); expect(q.reason).toBe('Start the pod: rendering happens on the pod')
  })
  it('auto: pod when it runs; else this PC; else both reasons; explicit pod and local fail with that adapter\'s reason', async () => {
    const A = (pod: boolean, local: boolean) => [{ id: 'pod' as const, ok: pod, reason: 'pod off' }, { id: 'local' as const, ok: local, reason: 'no ffmpeg', code: 'no_ffmpeg' }]
    expect(renders.chooseWhere('auto', A(true, true))).toBe('pod'); expect(renders.chooseWhere('auto', A(false, true))).toBe('local'); expect(renders.chooseWhere('auto', A(true, false))).toBe('pod')
    expect(() => renders.chooseWhere('auto', A(false, false))).toThrow(/on the pod, pod off; on this PC, no ffmpeg/)
    expect(() => renders.chooseWhere('pod', A(false, true))).toThrow('pod off'); expect(() => renders.chooseWhere('local', A(true, false))).toThrow('no ffmpeg')
    expect(renders.chooseWhere('pod', A(true, false))).toBe('pod'); expect(renders.chooseWhere('local', A(false, true))).toBe('local')
  })
  it('start refuses with the reason(s) (400) and plan with no pod_id works for local', async () => {
    podOk = false; ffmpegAt = null
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960 })).rejects.toThrow(/on the pod, Start the pod.*on this PC, ffmpeg is not installed/)
    await expect(renders.start({ sequences: [SEQ], width: 960, where: 'pod' })).rejects.toThrow(/Which pod/)
    ffmpegAt = '/opt/homebrew/bin/ffmpeg'; t += 31_000; const p = await renders.plan({ sequences: [SEQ], width: 960, where: 'local' }); expect(p.where).toBe('local'); expect(p.adapters[0].ok).toBe(false)
  })
})

describe('the missing or broken ffmpeg', () => {
  it('says to install it with Homebrew, with a code and an install hint, in plan, start and the status error; never installs anything', async () => {
    ffmpegAt = null; podOk = false
    const p = await renders.plan({ sequences: [SEQ], width: 960, where: 'local' }); const l = p.adapters.find((a) => a.id === 'local')!
    expect(l).toMatchObject({ ok: false, code: 'no_ffmpeg', install_hint: 'brew install ffmpeg', reason: 'ffmpeg is not installed on this PC. Install it with Homebrew: brew install ffmpeg (Homebrew itself: https://brew.sh), then try again.' })
    const e = await renders.start({ sequences: [SEQ], width: 960, where: 'local' }).catch((x) => x as CoreError)
    expect(e).toBeInstanceOf(CoreError); expect(e.status).toBe(400); expect(e.code).toBe('no_ffmpeg'); expect(e.message).toBe(l.reason)
    expect(spawned.every((s) => s.args[0] === '-version')).toBe(true)
  })
  it('a miss is looked at again after 30 s, so installing and retrying needs no restart; a hit stays cached', async () => {
    ffmpegAt = null; expect((await renders.adapterStates()).find((a) => a.id === 'local')!.ok).toBe(false)
    ffmpegAt = '/opt/homebrew/bin/ffmpeg'; t += 10_000; expect((await renders.adapterStates()).find((a) => a.id === 'local')!.ok).toBe(false)   // still the cached miss
    t += 25_000; expect((await renders.adapterStates()).find((a) => a.id === 'local')!.ok).toBe(true)
    ffmpegAt = null; t += 3_600_000; expect((await renders.adapterStates()).find((a) => a.id === 'local')!.ok).toBe(true)   // found once: kept
  })
  it('a found ffmpeg that does not run is a different reason with its first line, code ffmpeg_broken, and is re-checked after 30 s', async () => {
    versionExit = 1; versionLine = 'Bad CPU type in executable'
    const l = (await renders.adapterStates()).find((a) => a.id === 'local')!
    expect(l).toMatchObject({ ok: false, code: 'ffmpeg_broken', reason: 'ffmpeg was found at /opt/homebrew/bin/ffmpeg but did not run: Bad CPU type in executable' })
    versionExit = 0; t += 31_000; expect((await renders.adapterStates()).find((a) => a.id === 'local')!.ok).toBe(true)
  })
  it('the lookup order: PATH first, then the usual folders', async () => {
    renders.setDeps(null); renders.reset()
    const bin = join(dir, 'bin'); mkdirSync(bin); writeFileSync(join(bin, 'ffmpeg'), ''); const was = process.env.PATH; process.env.PATH = bin
    try { renders.setDeps({ spawn: async () => ({ code: 0 }) }); expect((await renders.ffmpegState()).path).toBe(join(bin, 'ffmpeg')) } finally { process.env.PATH = was }
    expect(renders.FFMPEG_PATHS).toEqual(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'])
  })
})

describe('rendering on the pod', () => {
  const go = async (o: Record<string, unknown> = {}) => { const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, ...o }); await renders.settled(); return job(job_id) }
  it('probe, render, pull exactly the proxy path (sync_parallel and the S3 or SSH transport are the sync\'s), states, History, journal event', async () => {
    const j = await go()
    expect(j).toMatchObject({ state: 'done', pulled_files: 1, pulled_bytes: 123456, frames_done: 10, frames_total: 10 }); expect(j.sequences[0]).toMatchObject({ state: 'pulled', where: 'pod', bytes: 123456, frames_done: 10 })
    expect(pulls).toHaveLength(1); expect(pulls[0].req).toMatchObject({ pod_id: 'p1', direction: 'pull', paths: [`output/.proxies/proxy_v004/shotA/${SEQ.name}_960.mp4`, `output/.proxies/proxy_v004/shotA/${SEQ.name}_960.mp4.meta.json`], trigger: 'render:pull', existing: 'size' })
    expect(scripts.filter((s) => s.includes('nice -n 10'))).toHaveLength(1); expect(scripts.find((s) => s.includes('nice -n 10'))).toContain("nice -n 10 'ffmpeg' '-nostdin'"); expect(emitted).toEqual(['output/.proxies/proxy_v004/shotA/'])
    const h = history.list({ kind: 'job' }).filter((e) => e.kind === 'job' && e.job === 'render'); expect(h).toHaveLength(1); expect(h[0]).toMatchObject({ state: 'done', files: 1, bytes: 123456, pod_id: 'p1' }); expect((h[0] as { what: string }).what).toMatch(/\(pod\)/)
  })
  it('pull: false pulls nothing and the sequence stays rendered', async () => { const j = await go({ pull: false }); expect(pulls).toHaveLength(0); expect(j.sequences[0].state).toBe('rendered') })
  it('a proxy that is already there and newer than the last frame is skipped (Skip existing, the default): everything done is a 400; unticked it renders again and the pull REPLACES the local file', async () => {
    pod.outM = 200; pod.outS = 555
    await expect(go()).rejects.toMatchObject({ status: 400, message: renders.ALL_DONE }); expect(scripts.some((s) => s.includes('nice -n 10'))).toBe(false); expect(pulls).toHaveLength(0)
    const j = await go({ skip_existing: false }); expect(scripts.some((s) => s.includes('nice -n 10'))).toBe(true); expect(j.sequences[0].state).toBe('pulled'); expect(pulls[0].req).toMatchObject({ existing: 'replace' })   // a stale local copy is not kept by the same-size rule
    pod.outM = 50; scripts = []; await go(); expect(scripts.some((s) => s.includes('nice -n 10'))).toBe(true); expect(pulls.at(-1)!.req).toMatchObject({ existing: 'size' })   // older than the last frame: rendered again
  })
  it('gaps are a warning; the contiguous run from first is rendered', async () => {
    pod.frames = [0, 1, 2, 3, 5, 6]; const j = await go({ allow_partial: true }); expect(j.sequences[0].warning).toMatch(/frame numbers? missing/); expect(j.sequences[0].frames_total).toBe(4); expect(j.sequences[0].out).toMatch(/_960_partial\.mp4$/)
    expect(scripts.find((s) => s.includes('nice -n 10'))).toContain("'-frames:v' '4'")
  })
  it('one failing sequence does not stop the next', async () => {
    const two = [{ ...SEQ, name: 'bad_24_x' }, SEQ]
    renders.setDeps({ ssh: async ({ script, onLine }) => { scripts.push(script); if (script.includes('PROBE-DONE')) { const n = script.includes('bad_24_x') ? 'bad_24_x' : SEQ.name; for (const f of range(0, 9)) onLine(`F 1000 5.0 ${n}.${String(f).padStart(4, '0')}.dpx`); onLine('OUTM 0'); onLine('OUTS 0'); onLine('PROBE-DONE') } else { onLine('PASS 0'); onLine(script.includes('bad_24_x.%04d.dpx') ? 'RENDER-EXIT 1' : 'RENDER-DONE 0 9 10'); if (!script.includes('bad_24_x.%04d.dpx')) onLine('RENDER-ALL') }; return { code: 0 } } })
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: two, width: 960 }); await renders.settled(); const j = job(job_id)
    expect(j.sequences.map((s) => s.state)).toEqual(['failed', 'pulled']); expect(j.sequences[0].error).toMatch(/ffmpeg failed \(exit 1\)/); expect(j.state).toBe('done'); expect(pulls).toHaveLength(1)
  })
  it('a frame missing on the pod fails that sequence with a clear message; no folder too', async () => {
    pod.frames = [1, 2]; let j = await go(); expect(j.sequences[0]).toMatchObject({ state: 'failed', error: expect.stringMatching(/first frame \(0000\) is not on the pod/) }); expect(j.state).toBe('failed')
    pod.nodir = true; j = await go(); expect(j.sequences[0].error).toMatch(/is not on the pod's output folder/)
  })
  it('status() answers from memory during a render; cancel kills the ffmpeg on the pod (a second ssh call) and the job is cancelled', async () => {
    let release!: () => void; pod.hold = new Promise<void>((r) => { release = r })
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960 }); await until(() => job(job_id).state === 'rendering' && scripts.some((s) => s.includes('nice -n 10')))
    const t0 = performance.now(); const s = job(job_id); expect(performance.now() - t0).toBeLessThan(10); expect(s).toMatchObject({ state: 'rendering', current: SEQ.name, pod_name: 'CanalV2' })
    renders.cancel(job_id); await renders.settled(); release()
    expect(cancelSeen).toBe(true); expect(scripts.at(-1)).toContain('rm -f'); expect(job(job_id).state).toBe('cancelled'); expect(pulls).toHaveLength(0)
  })
  it('finished jobs are kept in an index that survives a restart', async () => {
    const j = await go(); await renders.settled(); renders.reset(); process.env.RENDERS_FILE = join(dir, 'renders.json'); await renders.load()
    expect(renders.status().jobs.map((x) => x.job_id)).toContain(j.job_id)
  })
})

describe('rendering on this PC (the local adapter)', () => {
  const frames = (n: number, name = SEQ.name) => { mkdirSync(join(shared, 'output', SEQ.dir), { recursive: true }); for (let i = 0; i < n; i++) writeFileSync(join(shared, 'output', SEQ.dir, `${name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x') }
  const goLocal = async (o: Record<string, unknown> = {}) => { const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local', ...o }); await renders.settled(); return job(job_id) }
  it('the same ffmpeg arguments as the pod (bar the paths), a local ffmpeg, a .part renamed into place, no pull, state done', async () => {
    frames(10); const j = await goLocal()
    expect(j.sequences[0]).toMatchObject({ state: 'done', where: 'local', bytes: 50 }); expect(pulls).toHaveLength(0)
    const run = spawned.find((s) => s.args[0] !== '-version')!; expect(run.cmd).toBe('/opt/homebrew/bin/ffmpeg')
    const podArgs = renders.ffmpegArgs(SEQ, 960, { outputDir: '/workspace/comfy-shared/output', frames: 10 }).slice(1), strip = (a: string[]) => a.map((x) => x.replace('/workspace/comfy-shared/output', 'O').replace(join(shared, 'output'), 'O'))
    expect(strip(run.args)).toEqual(strip(podArgs))
    expect(existsSync(join(shared, 'output', '.proxies', SEQ.dir, `${SEQ.name}_960.mp4`))).toBe(true); expect(existsSync(join(shared, 'output', '.proxies', SEQ.dir, `${SEQ.name}_960.mp4.part`))).toBe(false)
  })
  it('no pod needed: pod_id omitted works; the History says (local)', async () => { frames(10); await goLocal(); expect((history.list({ kind: 'job' })[0] as { what: string }).what).toMatch(/on this PC \(local\)/) })
  it('frames missing here: the message says to sync the outputs first or render on the pod; gaps are a warning', async () => {
    let j = await goLocal(); expect(j.sequences[0]).toMatchObject({ state: 'failed', error: 'The frames are not on this PC yet: sync the outputs first, or render on the pod' })
    frames(10); const { unlinkSync } = await import('node:fs'); unlinkSync(join(shared, 'output', SEQ.dir, `${SEQ.name}.0003.dpx`))
    j = await goLocal({ allow_partial: true }); expect(j.sequences[0].warning).toMatch(/1 frame number missing/); expect(j.sequences[0].frames_total).toBe(3)
  })
  it('a proxy newer than the last frame is skipped: with nothing left to do the start says so (400)', async () => { frames(10); await goLocal(); spawned.length = 0; await expect(goLocal()).rejects.toMatchObject({ status: 400, message: renders.ALL_DONE }); expect(spawned.some((s) => s.args[0] !== '-version')).toBe(false) })
  it('never writes outside .proxies: a crafted sequence is refused before anything is spawned', async () => {
    expect(() => renders.validateSequence({ ...SEQ, dir: 'a/../../etc' })).toThrow(); frames(10)
    const j = await goLocal({ sequences: [{ ...SEQ, name: '..' }] }).catch((e) => e as Error); expect(j).toBeInstanceOf(Error)
    expect(spawned.some((s) => s.args[0] !== '-version')).toBe(false)
  })
  it('cancel kills the local child and removes the .part', async () => {
    frames(10); let seen!: AbortSignal
    renders.setDeps({ spawn: async (_c, args, _l, signal) => { if (args[0] === '-version') return { code: 0 }; seen = signal; writeFileSync(args.at(-1)!, 'half'); await new Promise<void>((r) => signal.addEventListener('abort', () => r())); return { code: null } } })
    const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local' }); await until(() => seen); renders.cancel(job_id); await renders.settled()
    expect(seen.aborted).toBe(true); expect(job(job_id).state).toBe('cancelled'); expect((await readdir(join(shared, 'output', '.proxies', SEQ.dir))).filter((n) => n.endsWith('.part'))).toEqual([])
  })
  it('auto: the pod is chosen, but a sequence the pod cannot read that is present here is rendered here (where recorded per sequence)', async () => {
    frames(10); pod.nodir = true
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960 }); await renders.settled(); const j = job(job_id)
    expect(j.sequences[0]).toMatchObject({ where: 'local', state: 'done' }); expect(pulls).toHaveLength(0)
  })
  it('retry: a failed job starts again with the sequences that did not finish; a running or finished one is refused', async () => {
    pod.nodir = true
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, where: 'pod' }); await renders.settled()
    expect(job(job_id).state).toBe('failed')
    pod.nodir = false; frames(10)
    const r = await renders.retry(job_id); await renders.settled()
    expect(r.job_id).not.toBe(job_id); expect(job(r.job_id).sequences.map((s) => s.name)).toEqual([SEQ.name])
    await expect(renders.retry(r.job_id)).rejects.toThrow(/Only a failed or cancelled/)
    await expect(renders.retry('render-nope')).rejects.toThrow(/No such render job/)
  })
  it('explicit where pod does not fall back', async () => { frames(10); pod.nodir = true; const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, where: 'pod' }); await renders.settled(); expect(job(job_id).sequences[0]).toMatchObject({ where: 'pod', state: 'failed' }) })
})

describe('proxies, the local file guard and clearLocal', () => {
  const proxyDir = () => join(shared, 'output', '.proxies')
  it('proxies(): remote from an S3 listing (the pod may be stopped), local by stat, the widest width found, a local_url', async () => {
    podOk = false; mkdirSync(join(proxyDir(), SEQ.dir), { recursive: true }); writeFileSync(join(proxyDir(), SEQ.dir, `${SEQ.name}_1280.mp4`), 'v')
    const r = await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: SEQ.name }, { dir: SEQ.dir, name: 'none' }] })
    expect(r.items[0]).toMatchObject({ width: 1280, exists_remote: true, remote_ready: true, exists_local: true, bytes: 999 }); expect(r.items[0].local_url).toBe(`localfile://p/proxy_v004/shotA/${SEQ.name}_1280.mp4`)
    expect(r.items[1]).toMatchObject({ exists_remote: false, exists_local: false, local_url: '' })
    expect((await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: SEQ.name }], width: 960 })).items[0]).toMatchObject({ width: 960, exists_remote: true, exists_local: false })
  })
  it('the remote listing is cached for 60 s', async () => {
    let calls = 0; renders.setDeps({ listing: async () => { calls++; return [] } }); renders.forgetListings()
    await renders.proxies({ pod_id: 'p1', items: [{ dir: 'a', name: 'x' }] }); await renders.proxies({ pod_id: 'p1', items: [{ dir: 'a', name: 'x' }] }); expect(calls).toBe(1); t += 61_000; await renders.proxies({ pod_id: 'p1', items: [{ dir: 'a', name: 'x' }] }); expect(calls).toBe(2)
  })
  it('resolveProxyFile: only a plain .mp4 inside the proxies folder (traversal, absolute, symlinks, wrong extension, wrong folder, unmapped)', async () => {
    mkdirSync(join(proxyDir(), 'd'), { recursive: true }); writeFileSync(join(proxyDir(), 'd', 'a.mp4'), 'abc'); writeFileSync(join(proxyDir(), 'd', 'a.dpx'), 'x'); writeFileSync(join(shared, 'secret.mp4'), 'secret'); mkdirSync(join(dir, 'outside')); writeFileSync(join(dir, 'outside', 'o.mp4'), 'o')
    symlinkSync(join(shared, 'secret.mp4'), join(proxyDir(), 'link.mp4')); symlinkSync(join(dir, 'outside'), join(proxyDir(), 'linkdir'))
    const ok = await renders.resolveProxyFile(proxyDir(), '/d/a.mp4'); expect(ok).toMatchObject({ ok: true, size: 3 })
    for (const bad of ['/../secret.mp4', '/d/../../secret.mp4', '/%2e%2e/secret.mp4', '/d/a.dpx', '/d/missing.mp4', '/link.mp4', '/linkdir/o.mp4', '//etc/passwd.mp4', '/d%5Ca.mp4', '/d/a.mp4%00.png', '/d']) expect((await renders.resolveProxyFile(proxyDir(), bad)).ok, bad).toBe(false)
    expect((await renders.resolveProxyFile(null, '/d/a.mp4'))).toMatchObject({ ok: false, status: 404 }); expect((await renders.resolveProxyFile(join(shared, 'output'), '/.proxies/../secret.mp4')).ok).toBe(false)
  })
  it('clearLocal removes ONLY files inside the mapped output/.proxies; a symlink out is unlinked, never followed; nothing else is touched', async () => {
    mkdirSync(join(proxyDir(), 'd', 'e'), { recursive: true }); writeFileSync(join(proxyDir(), 'd', 'a.mp4'), 'abc'); writeFileSync(join(proxyDir(), 'd', 'e', 'b.mp4'), 'de')
    const keep = join(shared, 'output', 'keep.dpx'), keep2 = join(shared, 'input.png'), outside = join(dir, 'outside'); mkdirSync(outside); writeFileSync(keep, 'k'); writeFileSync(keep2, 'k'); writeFileSync(join(outside, 'o.mp4'), 'o')
    symlinkSync(outside, join(proxyDir(), 'escape')); symlinkSync(join(outside, 'o.mp4'), join(proxyDir(), 'escape.mp4'))
    const r = await renders.clearLocal(); expect(r.removed).toBeGreaterThanOrEqual(2); expect(r.bytes).toBeGreaterThanOrEqual(5)
    expect(existsSync(keep) && existsSync(keep2) && existsSync(join(outside, 'o.mp4'))).toBe(true); expect(existsSync(join(proxyDir(), 'd', 'a.mp4'))).toBe(false); expect(existsSync(join(proxyDir(), 'd', 'e', 'b.mp4'))).toBe(false)
    renders.setDeps({ localRoot: () => null }); expect(await renders.clearLocal()).toEqual({ removed: 0, bytes: 0 })
  })
})


// ===== governance: completeness, the sidecar, the two kinds (docs/ADR-048 "Governance fit") =====
const ctrl = () => ({ job: (id: string) => renders.status(id).jobs[0] })
const runJob = async (o: Record<string, unknown>) => { const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, ...o }); await renders.settled(); return renders.status(job_id).jobs[0] }
void ctrl

describe('completeness: an incomplete sequence is refused unless a partial is asked for', () => {
  it('default: state incomplete, "Incomplete: frames ... missing (N gaps)", nothing rendered, never the full-length name (pod)', async () => {
    pod.frames = [0, 1, 2, 5, 6, 9]
    const j = await runJob({})
    expect(j.sequences[0]).toMatchObject({ state: 'incomplete', complete: false, error: 'Incomplete: frames 3-4, 7-8 are missing (2 gaps)', missing: [{ from: 3, to: 4 }, { from: 7, to: 8 }] })
    expect(scripts.some((s) => s.includes('nice -n 10'))).toBe(false); expect(pulls).toHaveLength(0); expect(j.state).toBe('failed')
  })
  it('the missing ranges are capped at 10 in the message', async () => {
    const S = { ...SEQ, last: 59, frames: 30 }; pod.frames = range(0, 59).filter((n) => n % 2 === 0)   // 30 single missing frames
    const j = await runJob({ sequences: [S] }); expect(j.sequences[0].error).toMatch(/^Incomplete: frames 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, \.\.\. are missing \(30 gaps\)$/); expect(j.sequences[0].missing).toHaveLength(10)
    expect(renders.incompleteMessage({ missing: [{ from: 5, to: 5 }], ranges: 1, gaps: 1 })).toBe('Incomplete: frames 5 is missing (1 gap)')
  })
  it('allow_partial renders the contiguous run and names it _partial; the full-length name is never written for it', async () => {
    pod.frames = [0, 1, 2, 3, 5, 6]; const j = await runJob({ allow_partial: true })
    expect(j.sequences[0]).toMatchObject({ state: 'pulled', partial: true, complete: false, out: `output/.proxies/proxy_v004/shotA/${SEQ.name}_960_partial.mp4` })
    const script = scripts.find((s) => s.includes('nice -n 10'))!; expect(script).toContain(`${SEQ.name}_960_partial.mp4.part`); expect(script).not.toMatch(new RegExp(`${SEQ.name}_960\\.mp4`))
    expect(pulls[0].req.paths).toEqual([`output/.proxies/proxy_v004/shotA/${SEQ.name}_960_partial.mp4`, `output/.proxies/proxy_v004/shotA/${SEQ.name}_960_partial.mp4.meta.json`])
  })
  it('the local adapter refuses and allows the same way', async () => {
    const dirF = join(shared, 'output', SEQ.dir); mkdirSync(dirF, { recursive: true }); for (const i of [0, 1, 2, 4]) writeFileSync(join(dirF, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), 'x')
    const { job_id } = await renders.start({ sequences: [{ ...SEQ, last: 4, frames: 4 }], width: 960, where: 'local' }); await renders.settled(); expect(renders.status(job_id).jobs[0].sequences[0]).toMatchObject({ state: 'incomplete', error: 'Incomplete: frames 3 is missing (1 gap)' })
    const b = await renders.start({ sequences: [{ ...SEQ, last: 4, frames: 4 }], width: 960, where: 'local', allow_partial: true }); await renders.settled(); expect(renders.status(b.job_id).jobs[0].sequences[0]).toMatchObject({ state: 'done', partial: true })
    expect(existsSync(join(shared, 'output', '.proxies', SEQ.dir, `${SEQ.name}_960_partial.mp4`))).toBe(true); expect(existsSync(join(shared, 'output', '.proxies', SEQ.dir, `${SEQ.name}_960.mp4`))).toBe(false)
  })
  it('plan() says complete and the missing ranges; odd files and unusual sizes are reported, not hidden', async () => {
    pod.frames = [0, 1, 4]; let p = await renders.plan({ pod_id: 'p1', sequences: [SEQ], width: 960 }); expect(p.sequences[0]).toMatchObject({ complete: false, missing: [{ from: 2, to: 3 }, { from: 5, to: 9 }], partial: false })
    p = await renders.plan({ pod_id: 'p1', sequences: [SEQ], width: 960, allow_partial: true }); expect(p.sequences[0].partial).toBe(true)
    const probe = renders.parseProbe([`F 10 1.0 ${SEQ.name}.0000.dpx`, `F 10 1.0 ${SEQ.name}.0001.dpx`, `F 99 1.0 ${SEQ.name}.0002.dpx`, `F 10 1.0 ${SEQ.name}.003.dpx`, 'F 10 1.0 other.0001.dpx'], { ...SEQ, last: 2 })
    expect(probe).toMatchObject({ complete: true, odd: 2, size_odd: 1 })
  })
})

describe('the sidecar travels with the proxy', () => {
  it('pod: written after the mp4 by the script (temp name, then mv), listed in the pull; the content says what it is', async () => {
    const j = await runJob({ fps: 25 }); const script = scripts.find((s) => s.includes('nice -n 10'))!
    expect(script).toMatch(/cat > '.*\.mp4\.meta\.json\.tmp' <<'RENDER_EOF_0'/); expect(script).toMatch(/mv '.*\.meta\.json\.tmp' '.*\.meta\.json'/)
    const body = script.split("<<'RENDER_EOF_0'\n")[1].split('\nRENDER_EOF_0')[0], m = JSON.parse(body)
    expect(m).toMatchObject({ kind: 'proxy', source_dir: SEQ.dir, name: SEQ.name, first: 0, last: 9, frames: 10, complete: true, partial: false, fps: 25, width: 960, adapter: 'pod', ffmpeg_version: 'ffmpeg version 7.1', source_sizes_total: 10000 }); expect(m.ffmpeg_args[0]).toBe('ffmpeg'); expect(m.rendered_at).toBeTruthy(); expect('not_a_deliverable' in m).toBe(false)
    expect(pulls[0].req.paths).toContain(`output/.proxies/proxy_v004/shotA/${SEQ.name}_960.mp4.meta.json`); expect(j.sequences[0].state).toBe('pulled')
  })
  it('local: an atomic write of the same content (no .tmp left) next to the mp4', async () => {
    const dirF = join(shared, 'output', SEQ.dir); mkdirSync(dirF, { recursive: true }); for (let i = 0; i < 10; i++) writeFileSync(join(dirF, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x')
    const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local' }); await renders.settled()
    const pdir = join(shared, 'output', '.proxies', SEQ.dir), names = await readdir(pdir); expect(names.sort()).toEqual([`${SEQ.name}_960.mp4`, `${SEQ.name}_960.mp4.meta.json`]); expect(job_id).toBeTruthy()
    const { readFileSync } = await import('node:fs'); expect(JSON.parse(readFileSync(join(pdir, `${SEQ.name}_960.mp4.meta.json`), 'utf8'))).toMatchObject({ kind: 'proxy', adapter: 'local', complete: true, frames: 10, fps: 23.976, ffmpeg_version: 'ffmpeg version 9.0.2' })
  })
  it('proxies() reads complete, partial, fps, frames and the real size from the sidecar; no sidecar is unknown, not an error', async () => {
    const pd = join(shared, 'output', '.proxies', SEQ.dir); mkdirSync(pd, { recursive: true }); writeFileSync(join(pd, `${SEQ.name}_960.mp4`), 'v')
    let r = (await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: SEQ.name }], width: 960 })).items[0]; expect(r).toMatchObject({ exists_local: true, complete: null, fps: null, frames: null, partial: false })
    writeFileSync(join(pd, `${SEQ.name}_960.mp4.meta.json`), JSON.stringify({ complete: false, partial: true, fps: 23.976, frames: 7, width: 3840, height: 2160 }))
    r = (await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: SEQ.name }], width: 960 })).items[0]; expect(r).toMatchObject({ complete: false, fps: 23.976, frames: 7 })
  })
})

describe('the source size is the default (4K, no scaling)', () => {
  it('the argument array without a scale size, for the proxy and the review; the file name carries the size', () => {
    const p = renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o' }); expect(p[p.indexOf('-vf') + 1]).toBe('scale=out_color_matrix=bt709,format=yuv420p'); expect(p[p.indexOf('-preset') + 1]).toBe('veryfast'); expect(p[p.indexOf('-crf') + 1]).toBe('18'); expect(p.at(-1)).toBe(`/o/.proxies/proxy_v004/shotA/${SEQ.name}.mp4.part`)
    const r = renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o', quality: 'review', final: '/o/deliver/x.mp4' }); expect(r[r.indexOf('-preset') + 1]).toBe('medium'); expect(r[r.indexOf('-crf') + 1]).toBe('14'); expect(r).toContain('-pix_fmt'); expect(r[r.indexOf('-pix_fmt') + 1]).toBe('yuv420p'); expect(r[r.indexOf('-vf') + 1]).toBe('scale=out_color_matrix=bt709,format=yuv420p')
    expect(renders.proxyRel(SEQ, 'source')).toBe(`output/.proxies/proxy_v004/shotA/${SEQ.name}.mp4`); expect(renders.proxyRel(SEQ, 1280)).toBe(`output/.proxies/proxy_v004/shotA/${SEQ.name}_1280.mp4`)
  })
  it('width omitted means the effective setting (source); the size is read from the first frame\'s DPX header', async () => {
    const p = await renders.plan({ pod_id: 'p1', sequences: [SEQ] }); expect(p.width).toBe('source'); expect(p.settings).toMatchObject({ proxy_width: 'source', review_width: 'source' }); expect(p.sequences[0].out).toBe(`output/.proxies/proxy_v004/shotA/${SEQ.name}.mp4`); expect(p.sequences[0].source).toEqual({ width: 3840, height: 2160, bits: 10 })
    expect(p.notes[0]).toMatch(/^slow: expect minutes per 100 frames/); expect(p.sequences[0].estimate).toMatchObject({ frames: 10 }); expect(p.sequences[0].estimate!.note).toMatch(/slow/)
    const h = renders.parseDpxInfo(dpxHeader({ transfer: 3, colorimetric: 3, width: 4096, height: 2160, bits: 10 }))!; expect(h).toMatchObject({ width: 4096, height: 2160, bits: 10, transfer: 3, colorimetric: 3, packing: 0, descriptor: 50, be: true }); expect(renders.parseDpxInfo(Buffer.from('nope'))).toBeNull()
    const j = await runJob({ width: undefined }); expect(j.width).toBe('source'); expect(scripts.find((s) => s.includes('nice -n 10'))).toContain("'scale=out_color_matrix=bt709,format=yuv420p'")
  })
})

describe('the review kind: the stitched, versioned deliverable', () => {
  const review = (o: Record<string, unknown> = {}) => runJob({ kind: 'review', approved_by: 'Lucas', width: undefined, codecs: ['h264'], ...o })
  it('plans the next version once per SHOT, not once per sequence (46 sequences made 46 slow round trips and the page showed "undefined" meanwhile)', async () => {
    let calls = 0
    renders.setDeps({ deliverDirs: async () => { calls++; return ['v001'] } })
    const mk = (shot: string, x: string) => ({ ...SEQ, name: `${shot}_${x}_FINAL_V03` })
    const seqs = [mk('ARCHIVAL-085', 'A'), mk('ARCHIVAL-085', 'B'), mk('ARCHIVAL-085', 'C'), mk('ARCHIVAL-090', 'A'), mk('ARCHIVAL-090', 'B')]
    const p = await renders.plan({ pod_id: 'p1', sequences: seqs, kind: 'review' })
    expect(p.sequences.map((x) => x.shot)).toEqual(['archival-085', 'archival-085', 'archival-085', 'archival-090', 'archival-090'])
    expect(p.sequences.every((x) => x.next_version === 2)).toBe(true)   // v001 exists: the next is v002 for every sequence of the shot
    expect(calls).toBe(2)                                                // one lookup per shot
  })
  it('shot id, versions and file names', () => {
    expect(renders.shotOf('CORROSION-015_MAIN_FINAL', 'x/y')).toBe('corrosion-015'); expect(renders.shotOf('archival-080b_x', 'a')).toBe('archival-080b'); expect(renders.shotOf('weird name', 'Some Dir/Last Seg')).toBe('last-seg')
    expect(renders.nextVersion([])).toBe(1); expect(renders.nextVersion(['v001', 'v003', 'junk', 'v002'])).toBe(4); expect(renders.versionName(7)).toBe('v007')
    expect(renders.reviewFile('ARCHIVAL-085_MAIN_FINAL_V03_3840X2160_23.976_PRORES422HQ')).toBe('ARCHIVAL-085_MAIN_FINAL_V03_3840X2160_23.976_PRORES422HQ.mov'); expect(renders.reviewFile('X_1', 'h264')).toBe('X_1.mp4'); expect(renders.reviewRel('archival-085', 12, 'CLIP_A')).toBe('output/deliver/archival-085/v012/CLIP_A.mov')
    for (const n of [renders.reviewFile('ARCHIVAL-085_A', 'h264'), renders.reviewFile('ARCHIVAL-085_A')]) expect(n).not.toMatch(/[0-9a-f]{16,}|uuid|mono|master/i)
  })
  it('needs the name of who says yes (400); a partial is rejected; width defaults to source', async () => {
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).rejects.toThrow('A review video needs the name of who says yes')
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review', approved_by: '  ' })).rejects.toMatchObject({ status: 400 })
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review', approved_by: 'L', allow_partial: true })).rejects.toThrow(/allow_partial is not available for kind review/)
    await expect(renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', allow_partial: true })).rejects.toThrow(/only made from a complete sequence/)
  })
  it('on the pod: a NEW version folder (mkdir, never overwritten), the 4K h264 argument array, DELIVERY.md and the sidecar written, the whole folder pulled, History with the approver', async () => {
    pod.versions = ['v001']
    const j = await review()
    expect(j).toMatchObject({ kind: 'review', approved_by: 'Lucas', state: 'done', width: 'source' }); expect(j.sequences[0]).toMatchObject({ state: 'pulled', shot: 'archival-085', version: 'v002', out: `output/deliver/archival-085/v002/${SEQ.name}.mp4` })
    const script = scripts.find((s) => s.includes('nice -n 10'))!
    expect(script).toContain("mkdir '/workspace/comfy-shared/output/deliver/archival-085/v002' || { echo RENDER-VEXISTS; exit 0; }"); expect(script).toContain('timeout 7200 nice -n 10'); expect(script).toContain("'-crf' '14'"); expect(script).toContain("'-preset' 'medium'"); expect(script).toContain("'scale=out_color_matrix=bt709,format=yuv420p'")
    expect(script).toContain("ffprobe -v error -count_frames"); expect(script).toContain("-f mp4 -i"); expect(script).not.toMatch(/ -rf |rm -rf/)
    const md = script.split("<<'RENDER_EOF_1'\n")[1].split('\nRENDER_EOF_1')[0]
    expect(md).toContain("Ready for Binc's review. Sending to the client is Binc's; this app never sends."); expect(md).toContain('Spec is not set in deliverables.csv; rendered at the source resolution 3840x2160, H.264, 23.976 fps (review of the full sequence).'); expect(md).toContain('for Lucas (the named yes)')
    expect(md).toContain('colour: DPX header: 3840x2160, 10-bit, packed, descriptor 50, transfer user defined (0)'); expect(md).toContain('colour: conversion told to ffmpeg: no colour transform applied'); expect(md).toContain('@@FRAMES_0@@ of 10 expected'); expect(md).not.toMatch(/proxy-resolution/)
    expect(pulls[0].req.paths).toEqual([`output/deliver/archival-085/v002/${SEQ.name}.mp4`, `output/deliver/archival-085/v002/${SEQ.name}.mp4.meta.json`, 'output/deliver/archival-085/v002/DELIVERY.md'])
    expect(emitted).toEqual(['output/deliver/archival-085/v002/'])
    const h = history.list({ kind: 'job' }).find((e) => e.kind === 'job' && e.job === 'render')!; expect(h).toMatchObject({ state: 'done' }); expect((h as { approved_by?: string }).approved_by).toBe('Lucas'); expect((h as { detail: string }).detail).toMatch(/shot archival-085 v002.*codecs h264/)
    const meta = JSON.parse(script.split("<<'RENDER_EOF_0'\n")[1].split('\nRENDER_EOF_0')[0].replace(/@@(BYTES|FRAMES|RATE)_\d@@/g, '0').replace(/@@SHA256_\d@@/g, 'x')); expect(meta).toMatchObject({ kind: 'review', shot: 'archival-085', version: 'v002', approved_by: 'Lucas', codec: 'h264', width: 3840, height: 2160, colour: { transform: 'none' } })
  })
  it('a race on the version folder bumps to the next version, never reuses one', async () => {
    let tries = 0; const orig = pod; void orig
    renders.setDeps({ ssh: async ({ script, onLine }) => { scripts.push(script); if (script.includes('PROBE-DONE')) { onLine('FFP 1'); onLine(`HDR ${hex(dpxHeader())}`); for (const f of range(0, 9)) onLine(`F 1000 1.0 ${SEQ.name}.${String(f).padStart(4, '0')}.dpx`); onLine('PROBE-DONE') } else if (script.startsWith('ls -1')) { /* none */ } else if (script.includes('nice -n 10')) { tries++; if (tries === 1) onLine('RENDER-VEXISTS'); else { onLine('PASS 0'); onLine('RENDER-DONE 0 5 10'); onLine('RENDER-ALL') } } return { code: 0 } } })
    const j = await review(); expect(tries).toBe(2); expect(j.sequences[0].version).toBe('v002')
  })
  it('the decoded frame count must equal the expected: a mismatch fails loudly and delivers nothing', async () => {
    pod.count = 9; const j = await review(); expect(j.sequences[0].state).toBe('failed'); expect(j.sequences[0].error).toMatch(/The frame count does not match: decoded 9 frames, expected 10\. The file was removed; nothing was delivered\./); expect(pulls).toHaveLength(0)
  })
  it('both codecs: h264 then ProRes 422 HQ in the same version folder, master name .mov, ProRes arguments, a note that the app cannot play it', async () => {
    const j = await review({ codecs: ['h264', 'prores422hq'] }); const script = scripts.find((s) => s.includes('nice -n 10'))!
    expect((script.match(/^PASS \d$/gm) ?? []).length + (script.match(/echo "PASS \d"/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(script).toContain("'-c:v' 'prores_ks' '-profile:v' '3' '-pix_fmt' 'yuv422p10le' '-vendor' 'apl0'"); expect(script).toContain(`${SEQ.name}.mov.part`); expect(script).toContain("-f mov -i"); expect(script).toContain("'scale=out_color_matrix=bt709,format=yuv422p10le'")
    expect(j.notes.join(' ')).toMatch(/ProRes .mov cannot be played in this app/); expect(pulls[0].req.paths).toContain(`output/deliver/archival-085/v001/${SEQ.name}.mov`); expect(pulls[0].req.paths).toContain(`output/deliver/archival-085/v001/${SEQ.name}.mov.meta.json`)
    expect(script).toContain(`${SEQ.name}.mp4`); const md = script.split("<<'RENDER_EOF_2'\n")[1].split('\nRENDER_EOF_2')[0]; expect(md).toContain('H.264 and ProRes 422 HQ'); expect(md).toContain('ProRes 422 HQ (prores_ks profile 3')
    expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', codecs: ['prores422hq'] })).notes.join(' ')).toMatch(/ProRes/)
    await expect(renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', codecs: ['divx' as never] })).rejects.toThrow(/codecs is a non-empty list/)
  })
  it('colour: frames that say log, linear or printing density are refused (stated, never guessed); an unreadable header too; the proxy still plays', async () => {
    { const m = mounts.load(); mounts.save({ ...m, render: { ...m.render, colour: { mode: 'ask' } } as never }) }   // this is the ask behaviour; the default (known) derives a linear header
    pod.header = dpxHeader({ transfer: 1 }); let j = await review(); expect(j.sequences[0]).toMatchObject({ state: 'skipped' }); expect(j.sequences[0].reason).toMatch(/colour not stated.*the DPX header says printing density.*Set render\.colour\.mode to format or guess, or pass colour_in/)
    pod.header = dpxHeader({ transfer: 3 }); j = await review(); expect(j.sequences[0].reason).toMatch(/logarithmic/); pod.header = dpxHeader({ transfer: 2 }); j = await review(); expect(j.sequences[0].reason).toMatch(/linear/)
    pod.header = Buffer.alloc(820); j = await review(); expect(j.sequences[0].error).toMatch(/header of the first frame could not be read/)
    pod.header = dpxHeader({ transfer: 1 }); j = await runJob({}); expect(j.sequences[0].state).toBe('pulled')   // a quick proxy is not a review
    // a person STATES the colour: the review renders with that conversion, the header is reported next to it; a bad value is a 400; the plan flags what is not stated
    pod.header = dpxHeader({ transfer: 2 }); const pl = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' }); expect(pl.sequences[0]).toMatchObject({ blocked: false, skip: 'colour not stated', header_transfer: 'linear (code 2)' }); expect(pl.sequences[0].flags.filter((f) => f.level === 'warn' && f.code === 'colour-not-stated')).toHaveLength(1)
    const st = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', colour_in: 'linear-p3-d65' }); expect(st.sequences[0].skip).toBeNull(); expect(st.sequences[0].flags.map((f) => f.code)).not.toContain('colour-not-stated')
    await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review', approved_by: 'Lucas', colour_in: 'rec2020' as never })).rejects.toMatchObject({ status: 400 })
    j = await review({ colour_in: 'linear-p3-d65' }); expect(j.sequences[0].state).toBe('pulled'); const sc = scripts[scripts.length - 1]; expect(sc).toContain('colorchannelmixer=rr=1.2249401'); expect(sc).toMatch(/"stated_by": "Lucas"/); expect(sc).toMatch(/"header_transfer": "linear \(code 2\)"/); expect(sc).toMatch(/"conversion": "linear-p3-d65"/); expect(sc).toMatch(/STATED by Lucas/)
    j = await review({ sequences: [{ ...SEQ, colour_in: 'linear-rec709' }] }); expect(j.sequences[0].state).toBe('pulled')   // per sequence
    pod.header = dpxHeader({ transfer: 1 })
    expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).sequences[0].colour_refusal).toMatch(/printing density/)
    expect(renders.colourLines(renders.parseDpxInfo(dpxHeader({ transfer: 6, colorimetric: 6 })), ['prores422hq']).join('\n')).toMatch(/transfer ITU-R 709-4 \(6\).*no colour transform applied.*10-bit 4:2:2 for ProRes/s)
  })
  describe('Convert To Rec.709 (default ON = today: converts when the colour is known; off is tag only: the frames\' signal kept and stated; the Tunnel preset always converts)', () => {
    const lastScript = () => scripts[scripts.length - 1]
    it('OFF: a stated colour is NOT converted: no colour filters, no Rec.709 primaries or transfer tags, the sidecar says kept and converted no, DELIVERY.md says NOT converted', async () => {
      pod.header = dpxHeader({ transfer: 2 })
      const j = await review({ colour_in: 'p3-d65-gamma26', rec709: false }); expect(j.sequences[0].state).toBe('pulled')
      const sc = lastScript()
      expect(sc).not.toContain('colorchannelmixer'); expect(sc).not.toContain('lutrgb'); expect(sc).not.toMatch(/color_primaries bt709/)
      expect(sc).toMatch(/"converted": "no"/); expect(sc).toMatch(/"rec709": false/); expect(sc).toMatch(/kept: p3-d65-gamma26 \(not converted to Rec\.709\)/)
      expect(sc).toMatch(/NOT converted to Rec\.709/); expect(sc).toMatch(/converted: no \(p3-d65-gamma26 kept as it is; Convert To Rec\.709 is off\)/)
      expect(sc).toMatch(/"stated_by": "Lucas"/)   // the statement of the colour is still recorded
    })
    it('ON (the default): the review is converted from Gamma 2.6 P3-D65 to a Rec.709 view and the files say converted: p3-d65-gamma26 -> rec709', async () => {
      pod.header = dpxHeader({ transfer: 2 })
      const j = await review({ colour_in: 'p3-d65-gamma26' }); expect(j.sequences[0].state).toBe('pulled')   // no rec709 given: the default is ON
      const sc = lastScript()
      expect(sc).toContain('colorchannelmixer=rr=1.2249401'); expect(sc).toContain('pow(val/maxval,2.6)'); expect(sc).toMatch(/color_primaries bt709/)
      expect(sc).toMatch(/"converted": "p3-d65-gamma26 -> rec709"/); expect(sc).toMatch(/"rec709": true/); expect(sc).toMatch(/converted: p3-d65-gamma26 -> rec709/)
    })
    it('the configuration decides when the request is silent (render.rec709, default on), a request wins over it, a bad value is a 400, and the plan carries the value; the Tunnel preset always converts', async () => {
      pod.header = dpxHeader({ transfer: 2 })
      expect(mounts.load().render.rec709).toBe(true)
      expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', colour_in: 'p3-d65-gamma26' })).rec709).toBe(true)
      { const m = mounts.load(); mounts.save({ ...m, render: { ...m.render, rec709: false } as never }) }
      expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', colour_in: 'p3-d65-gamma26' })).rec709).toBe(false)
      await review({ colour_in: 'p3-d65-gamma26', rec709: undefined }); expect(lastScript()).not.toContain('colorchannelmixer')   // silent request: the configuration's OFF
      await review({ colour_in: 'p3-d65-gamma26', rec709: true }); expect(lastScript()).toContain('colorchannelmixer=rr=1.2249401')   // the request's ON wins
      { const m = mounts.load(); mounts.save({ ...m, render: { ...m.render, rec709: true } as never }) }
      await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review', approved_by: 'Lucas', colour_in: 'p3-d65-gamma26', rec709: 'yes' as never })).rejects.toMatchObject({ status: 400, message: /rec709 is true or false/ })
      expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel', colour_in: 'p3-d65-gamma26' })).rec709).toBe(true)
    })
    it('the colour lines: converted adds the converted line, kept replaces the conversion claims, an unstated colour is as before', () => {
      const h = renders.parseDpxInfo(dpxHeader({ transfer: 2 })), st = { conversion: 'p3-d65-gamma26' as const, by: 'Lucas', at: '2026-11-21T00:00:00.000Z' }
      const on = renders.colourLines(h, ['prores422hq'], st, true).join('\n'); expect(on).toMatch(/converted Rec\.709 view/); expect(on).toMatch(/converted: p3-d65-gamma26 -> rec709$/)
      const off = renders.colourLines(h, ['prores422hq'], st, false).join('\n'); expect(off).not.toMatch(/converted Rec\.709 view/); expect(off).toMatch(/NOT converted to Rec\.709/); expect(off).toMatch(/converted: no/); expect(off).toMatch(/10-bit 4:2:2 for ProRes/)
      expect(renders.colourLines(h, ['h264']).join('\n')).toMatch(/no colour transform applied/)
    })
  })
  describe('the colour of log and linear frames is a setting (ADR-048)', () => {
    const setColour = (colour: Record<string, unknown>) => { const m = mounts.load(); mounts.save({ ...m, render: { ...m.render, colour } as never }) }
    const lastScript = () => scripts[scripts.length - 1]
    it('known (the default): a LINEAR header is converted from Gamma 2.6 P3-D65 (this project\'s colour, whatever the header says) with no setting and no click, the sidecar says it was derived (project default, not stated) and the plan warns; log and printing density are never derived', async () => {
      pod.header = dpxHeader({ transfer: 2 })
      const pl = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' }); expect(pl.settings.colour).toEqual({ mode: 'known' })
      expect(pl.sequences[0]).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'guess', colour_assumption: expect.stringMatching(/Gamma 2\.6 P3-D65 used as the project default/) }); expect(pl.sequences[0].flags.map((f) => f.code)).toContain('colour-guessed'); expect(pl.sequences[0].flags.map((f) => f.code)).not.toContain('colour-not-stated')
      let j = await review(); expect(j.sequences[0].state).toBe('pulled'); expect(lastScript()).toContain('colorchannelmixer=rr=1.2249401'); expect(lastScript()).toMatch(/"stated_by": "project default"/); expect(lastScript()).toMatch(/"guessed": true/); expect(lastScript()).toMatch(/Gamma 2\.6 P3-D65 used as the project default/)
      pod.header = dpxHeader({ transfer: 1 }); j = await review(); expect(j.sequences[0]).toMatchObject({ state: 'skipped', flags: [expect.objectContaining({ code: 'colour-not-stated' })] }); expect(j.sequences[0].reason).toMatch(/render\.colour\.mode known.*printing density/)   // a person states density and log
      pod.header = dpxHeader({ transfer: 2 }); j = await review({ colour_in: 'linear-rec709' }); expect(lastScript()).not.toContain('colorchannelmixer'); expect(lastScript()).toMatch(/"stated_by": "Lucas"/)   // a stated colour still wins
    })
    it('ask: a review is SKIPPED with a warning (job done, not failed); format converts from the configured format; guess converts from the header and says so everywhere; a per-run mode overrides; a stated colour_in still wins', async () => {
      pod.header = dpxHeader({ transfer: 2 }); setColour({ mode: 'ask' })
      let j = await review(); expect(j.state).toBe('done'); expect(j.sequences[0]).toMatchObject({ state: 'skipped', flags: [expect.objectContaining({ code: 'colour-not-stated', level: 'warn' })] }); expect(j.sequences[0].reason).toMatch(/render\.colour\.mode ask.*linear \(code 2\).*Set render\.colour\.mode to format or guess, or pass colour_in/)
      const pl = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' }); expect(pl.sequences[0]).toMatchObject({ skip: 'colour not stated', blocked: false }); expect(pl.sequences[0].flags.find((f) => f.code === 'colour-not-stated')!.level).toBe('warn'); expect(pl.settings.colour).toEqual({ mode: 'ask' })
      setColour({ mode: 'format', format: 'linear-p3-d65' }); j = await review(); expect(j.sequences[0].state).toBe('pulled'); expect(lastScript()).toContain('colorchannelmixer=rr=1.2249401'); expect(lastScript()).toMatch(/"stated_by": "configuration"/); expect(lastScript()).toMatch(/"conversion": "linear-p3-d65"/)
      j = await review({ colour_in: 'linear-rec709' }); expect(lastScript()).not.toContain('colorchannelmixer'); expect(lastScript()).toMatch(/"stated_by": "Lucas"/)   // a stated colour wins over the configured format
      setColour({ mode: 'guess' }); j = await review(); expect(j.sequences[0].state).toBe('pulled'); expect(lastScript()).toMatch(/"guessed": true/); expect(lastScript()).toMatch(/"assumption": "linear transfer: Rec\.709 primaries assumed/); expect(lastScript()).toMatch(/colour guessed from the DPX header: linear transfer/); expect(j.warnings!.join(' ')).toMatch(/colour guessed from the DPX header/)
      pod.header = dpxHeader({ transfer: 1 }); await review(); expect(lastScript()).toContain('pow(10'); expect(lastScript()).toMatch(/Cineon reference/)
      j = await review({ colour_mode: 'ask' }); expect(j.sequences[0].state).toBe('skipped')   // per run
      await expect(renders.start({ pod_id: 'p1', sequences: [SEQ], kind: 'review', approved_by: 'Lucas', colour_mode: 'maybe' as never })).rejects.toMatchObject({ status: 400 })
      setColour({ mode: 'ask' })
    })
    it('the setting round-trips through the configuration and a change is a History line naming who; mode format needs a valid format; the Tunnel preset never guesses', async () => {
      const m = mounts.load(); mounts.put({ ...m, approved_by: 'Lucas', render: { ...m.render, colour: { mode: 'format', format: 'linear-p3-d65' } } } as never); expect(mounts.load().render.colour).toMatchObject({ mode: 'format', format: 'linear-p3-d65', set_by: 'Lucas' })
      expect(() => mounts.put({ ...m, render: { ...m.render, colour: { mode: 'format' } } } as never)).toThrow(/render\.colour\.format/); expect(() => mounts.put({ ...m, render: { ...m.render, colour: { mode: 'format', format: 'nope' } } } as never)).toThrow(/render\.colour\.format/)
      expect((await import('../src/history.js')).list({ limit: 20 }).some((e) => e.action === 'render colour setting changed' && /format \(linear-p3-d65\), set by Lucas/.test(String(e.detail)))).toBe(true)
      setColour({ mode: 'guess' }); const t = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel' }); expect(t.sequences[0].flags.map((f) => f.code)).toContain('colour-not-set'); expect(t.sequences[0].blocked).toBe(true)   // strict: guess does not count
      setColour({ mode: 'format', format: 'linear-p3-d65' }); const f = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel' }); expect(f.sequences[0].flags.map((x) => x.code)).not.toContain('colour-not-set'); setColour({ mode: 'ask' })
    })
  })
  describe('the OCIO record: what the writer ComfyUI-OCIO says beats the DPX header (ADR-048)', () => {
    const setColour = (colour: Record<string, unknown>) => { const m = mounts.load(); mounts.save({ ...m, render: { ...m.render, colour } as never }) }
    const record = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ file: 'x.0000.dpx', writer: 'ComfyUI-OCIO', codec: 'dpx 16', attributes: { chromaticities: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.329], 'com.ocio.gamut': 'P3-D65', colorInteropID: id, 'com.ocio.colorspace': 'Gamma 2.6 P3-D65 - Display', ...extra }, kind: 'sequence', frames: 10 })
    const G26 = record('g26_p3d65_display'), lastScript = () => scripts[scripts.length - 1]
    it('the table: Gamma 2.6 P3-D65 is p3-d65-gamma26 and the siblings the converter supports; an unknown id, junk, a huge or an empty record is no record, and never throws', () => {
      expect(renders.parseOcioRecord(G26)).toMatchObject({ colour_in: 'p3-d65-gamma26', label: 'Gamma 2.6 P3-D65', colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65' })
      for (const [id, c] of [['srgb_p3d65_display', 'p3-d65-srgb'], ['g22_p3d65_display', 'p3-d65-gamma22'], ['lin_p3d65_scene', 'linear-p3-d65'], ['lin_rec709_scene', 'linear-rec709']]) expect(renders.parseOcioRecord(record(id))!.colour_in).toBe(c)
      for (const bad of [record('g24_rec2020_display'), record('constructor'), '{', '', 'null', '[]', '{"attributes":{}}', '{"attributes":{"colorInteropID":5}}', JSON.stringify({ attributes: { colorInteropID: 'g26_p3d65_display', pad: 'x'.repeat(300_000) } })]) expect(renders.parseOcioRecord(bad)).toBeNull()
      expect(renders.parseOcioRecord(null)).toBeNull(); expect(renders.parseOcioRecord(undefined)).toBeNull()
    })
    it('a record and a linear header: the plan uses the record, says so (source, ocio, header-disagrees at info level), and the review is not refused on the header', async () => {
      pod.header = dpxHeader({ transfer: 2 }); pod.record = G26
      const pl = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' }), x = pl.sequences[0]
      expect(x).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', header_disagrees: true, skip: null, colour_refusal: null, header_transfer: 'linear (code 2)', ocio: { colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65', label: 'Gamma 2.6 P3-D65' } })
      expect(x.flags.find((f) => f.code === 'header-disagrees')).toMatchObject({ level: 'info' }); expect(x.flags.map((f) => f.code)).not.toContain('colour-guessed')
      const j = await review(); expect(j.sequences[0]).toMatchObject({ state: 'pulled', colour_source: 'ocio-record', header_disagrees: true }); expect(j.sequences[0].flags ?? []).toEqual([]); expect(j.warnings ?? []).toEqual([])
      expect(lastScript()).toContain('pow(val/maxval,2.6)'); expect(lastScript()).not.toContain('pow(val/maxval,2.2)'); expect(lastScript()).toMatch(/"colour_source": "ocio-record"/); expect(lastScript()).toMatch(/"header_disagrees": true/); expect(lastScript()).toMatch(/"colorInteropID": "g26_p3d65_display"/); expect(lastScript()).toMatch(/"conversion": "p3-d65-gamma26"/); expect(lastScript()).toMatch(/OCIO record: stated by the writer ComfyUI-OCIO/); expect(lastScript()).toMatch(/The DPX header disagrees/)
    })
    it('a record and a header that agree: used, but no disagreement is flagged; in the mode ask a record still counts as stated', async () => {
      setColour({ mode: 'ask' }); pod.header = dpxHeader({ transfer: 2 }); pod.record = record('lin_p3d65_scene')
      const x = (await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).sequences[0]; expect(x).toMatchObject({ colour_in: 'linear-p3-d65', colour_source: 'ocio-record', skip: null }); expect(x.header_disagrees).toBeUndefined(); expect(x.flags.map((f) => f.code)).not.toContain('header-disagrees')
      pod.record = G26; expect((await review()).sequences[0].state).toBe('pulled')
    })
    it('no record, an unknown interop id and unreadable JSON all leave the old behaviour (known: a linear header is linear P3-D65, flagged as guessed)', async () => {
      pod.header = dpxHeader({ transfer: 2 })
      for (const rec of [null, record('g24_rec2020_display'), '{ not json', '']) { pod.record = rec; const x = (await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).sequences[0]; expect(x).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'guess' }); expect(x.ocio).toBeUndefined(); expect(x.header_disagrees).toBeUndefined() }
      pod.record = '{ not json'; const j = await review(); expect(j.sequences[0].state).toBe('pulled'); expect(lastScript()).toContain('colorchannelmixer=rr=1.2249401'); expect(lastScript()).toMatch(/"stated_by": "project default"/); expect(lastScript()).not.toMatch(/ocio-record/)
      setColour({ mode: 'ask' }); pod.record = record('nope'); pod.header = dpxHeader({ transfer: 1 }); expect((await review()).sequences[0].state).toBe('skipped')   // and a log header with no usable record is still refused
    })
    it('an explicit colour_in (per run or per sequence) beats the record; the record is not even consulted for it', async () => {
      pod.header = dpxHeader({ transfer: 2 }); pod.record = G26
      const x = (await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', colour_in: 'linear-rec709' })).sequences[0]; expect(x).toMatchObject({ colour_in: 'linear-rec709' }); expect(x.colour_source).toBeUndefined(); expect(x.ocio).toBeUndefined()
      scripts.length = 0; let j = await review({ colour_in: 'linear-rec709' }); expect(j.sequences[0].state).toBe('pulled'); expect(lastScript()).toMatch(/"stated_by": "Lucas"/); expect(lastScript()).not.toMatch(/ocio-record/); expect(scripts.some((s) => s.includes('base64 < '))).toBe(false)
      j = await review({ sequences: [{ ...SEQ, colour_in: 'p3-d65-srgb' }] }); expect(lastScript()).toMatch(/"conversion": "p3-d65-srgb"/); expect(lastScript()).not.toMatch(/ocio-record/)
    })
    it('the volume is the last resort: the pod has no record, the volume holds one', async () => {
      pod.header = dpxHeader({ transfer: 2 }); pod.record = null; volText = G26
      expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).sequences[0]).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record' })
      volText = '{ nope'; expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review' })).sequences[0].colour_source).toBe('guess')
    })
    it('on this PC the record is read from the sequence folder (<dir>/<stem>.json)', async () => {
      const d = join(shared, 'output', SEQ.dir); mkdirSync(d, { recursive: true }); for (let i = 0; i < 10; i++) writeFileSync(join(d, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader({ transfer: 2 }) : 'x')
      let x = (await renders.plan({ sequences: [SEQ], kind: 'review', where: 'local' })).sequences[0]; expect(x).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'guess' })
      writeFileSync(join(d, `${SEQ.name}.json`), G26); x = (await renders.plan({ sequences: [SEQ], kind: 'review', where: 'local' })).sequences[0]; expect(x).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', header_disagrees: true })
      const { job_id } = await renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'Lucas', where: 'local', codecs: ['h264'] }); await renders.settled()
      const { readFileSync } = await import('node:fs'), v1 = join(shared, 'output', 'deliver', 'archival-085', 'v001'), meta = JSON.parse(readFileSync(join(v1, `${SEQ.name}.mp4.meta.json`), 'utf8'))
      expect(renders.status(job_id).jobs[0].sequences[0]).toMatchObject({ state: 'done', colour_source: 'ocio-record' }); expect(meta.colour_stated).toMatchObject({ colour_source: 'ocio-record', header_disagrees: true, conversion: 'p3-d65-gamma26', ocio: { colorInteropID: 'g26_p3d65_display', colorspace: 'Gamma 2.6 P3-D65 - Display', gamut: 'P3-D65' } })
      expect(readFileSync(join(v1, 'DELIVERY.md'), 'utf8')).toMatch(/OCIO record: stated by the writer ComfyUI-OCIO.*DPX header disagrees/s)
      writeFileSync(join(d, `${SEQ.name}.json`), 'x'.repeat(300_000)); expect((await renders.plan({ sequences: [SEQ], kind: 'review', where: 'local' })).sequences[0].colour_source).toBe('guess')   // over 256 KB: no record
    })
    it('the Tunnel preset stays strict: a record counts as stated; with no record and no statement it never guesses', async () => {
      setColour({ mode: 'guess' }); pod.header = dpxHeader({ transfer: 2 }); pod.record = null
      let t = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel' }); expect(t.sequences[0].flags.map((f) => f.code)).toContain('colour-not-set'); expect(t.sequences[0].blocked).toBe(true); expect(t.sequences[0].colour_source).toBeUndefined()
      pod.record = G26; t = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel' }); expect(t.sequences[0]).toMatchObject({ colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', header_disagrees: true }); expect(t.sequences[0].flags.map((f) => f.code)).not.toContain('colour-not-set'); expect(t.warnings.join(' ')).not.toMatch(/the colour you chose/)
      pod.record = record('g24_rec2020_display'); t = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel' }); expect(t.sequences[0].flags.map((f) => f.code)).toContain('colour-not-set')   // an unknown id is not a statement
      pod.record = G26; t = await renders.plan({ pod_id: 'p1', sequences: [SEQ], preset: 'tunnel', colour_in: 'linear-rec709' }); expect(t.sequences[0]).toMatchObject({ colour_in: 'linear-rec709' }); expect(t.sequences[0].colour_source).toBeUndefined()   // a person still wins
    })
    it('a Tunnel run with a record starts (it is not refused for having no colour) and the sidecar names the record', async () => {
      setColour({ mode: 'ask' }); pod.header = dpxHeader({ transfer: 2 }); pod.record = G26
      const j = await runJob({ preset: 'tunnel', approved_by: 'Lucas', sequences: [{ ...SEQ, start_timecode: '01:00:00:00' }] }); expect(j.sequences[0]).toMatchObject({ colour_source: 'ocio-record', header_disagrees: true }); expect(j.sequences[0].state).not.toBe('failed')
      expect(lastScript()).toMatch(/"colour_in": "p3-d65-gamma26"/); expect(lastScript()).toMatch(/"colour_source": "ocio-record"/)
      pod.record = null; await expect(renders.start({ pod_id: 'p1', preset: 'tunnel', approved_by: 'Lucas', sequences: [{ ...SEQ, start_timecode: '01:00:00:00' }], width: 960 })).rejects.toMatchObject({ status: 400 })
    })
  })
  it('a failed render says what failed and what to do (render_sequences status): failure { stage, node, message, recovery, retryable, text }', async () => {
    pod.header = Buffer.alloc(820); const j = await review(); const f = j.sequences[0].failure!
    expect(j.sequences[0].state).toBe('failed'); expect(f).toMatchObject({ stage: expect.any(String), retryable: expect.any(Boolean), recovery: expect.any(String) }); expect(f.message).toMatch(/header of the first frame could not be read/); expect(f.text).toMatch(/^stage: .*\nnode: not obtained.*\nmessage: .*\nretryable: (yes|no)\nrecovery: /s)
    expect(j.failure?.text ?? f.text).toMatch(/recovery:/)
  })
  it('incomplete sequences are refused for a review, always', async () => { pod.frames = [0, 1, 2]; const j = await review(); expect(j.sequences[0].state).toBe('incomplete'); expect(scripts.some((s) => s.includes('nice -n 10'))).toBe(false) })
  it('on this PC: the same version rules, DELIVERY.md and sidecar with sha256 and the verified count, a never-overwritten version, ffprobe verification', async () => {
    const dirF = join(shared, 'output', SEQ.dir); mkdirSync(dirF, { recursive: true }); for (let i = 0; i < 10; i++) writeFileSync(join(dirF, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x')
    mkdirSync(join(shared, 'output', 'deliver', 'archival-085', 'v001'), { recursive: true }); writeFileSync(join(shared, 'output', 'deliver', 'archival-085', 'v001', 'keep.txt'), 'old')
    const { job_id } = await renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'Lucas', where: 'local', codecs: ['h264'] }); await renders.settled(); const j = renders.status(job_id).jobs[0]
    expect(j.sequences[0]).toMatchObject({ state: 'done', version: 'v002', where: 'local' }); const v2 = join(shared, 'output', 'deliver', 'archival-085', 'v002'), names = await readdir(v2)
    expect(names.sort()).toEqual([`${SEQ.name}.mp4`, `${SEQ.name}.mp4.meta.json`, 'DELIVERY.md']); expect(existsSync(join(shared, 'output', 'deliver', 'archival-085', 'v001', 'keep.txt'))).toBe(true)
    const { readFileSync } = await import('node:fs'), { createHash } = await import('node:crypto'), sha = createHash('sha256').update(readFileSync(join(v2, `${SEQ.name}.mp4`))).digest('hex')
    const md = readFileSync(join(v2, 'DELIVERY.md'), 'utf8'); expect(md).toContain(`sha256 ${sha}`); expect(md).toContain('decoded frame count (ffprobe -count_frames) 10 of 10 expected'); expect(md).toContain('50 bytes'); expect(md).not.toContain('@@')
    const meta = JSON.parse(readFileSync(join(v2, `${SEQ.name}.mp4.meta.json`), 'utf8')); expect(meta).toMatchObject({ kind: 'review', approved_by: 'Lucas', adapter: 'local', outputs: [{ codec: 'h264', bytes: 50, sha256: sha, frames_decoded: 10 }] }); expect(pulls).toHaveLength(0)
    const sp = spawned.find((x) => x.cmd.endsWith('ffprobe'))!; expect(sp.args).toContain('-count_frames'); expect(sp.args).toContain('mp4')
  })
  it('on this PC a frame-count mismatch removes the files and the empty version folder; nothing is delivered', async () => {
    const dirF = join(shared, 'output', SEQ.dir); mkdirSync(dirF, { recursive: true }); for (let i = 0; i < 10; i++) writeFileSync(join(dirF, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x')
    localCount = 8; const { job_id } = await renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'Lucas', where: 'local', codecs: ['h264'] }); await renders.settled()
    expect(renders.status(job_id).jobs[0].sequences[0].error).toMatch(/decoded 8 frames, expected 10/); expect(existsSync(join(shared, 'output', 'deliver', 'archival-085', 'v001'))).toBe(false)
  })
  it('never writes under Binc\'s mirror (projects/desktop/): the local adapter refuses it, nothing is created', async () => {
    const { mirrorDir } = await import('../src/paths.js'); const bad = join(mirrorDir(), 'CANALV2', 'ComfyUI-Shared'); renders.setDeps({ localRoot: () => bad })
    expect(() => renders.assertNotMirror(join(mirrorDir(), 'x'))).toThrow(/Binc's mirror/); renders.assertNotMirror(join(dir, 'ok'))
    const l = (await renders.adapterStates()).find((a) => a.id === 'local')!; expect(l.ok).toBe(false); expect(l.reason).toMatch(/inside Binc's mirror/)
    await expect(renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'L', where: 'local' })).rejects.toThrow(/Binc's mirror/); expect(existsSync(join(bad, 'output'))).toBe(false)
    expect(await renders.clearLocal()).toMatchObject({ removed: 0 })
  })
  it('proxies() lists the review versions of the shot (on the volume and on this PC) with the approver', async () => {
    renders.setDeps({ deliverFiles: async () => [{ name: `v001/${SEQ.name}.mp4`, bytes: 5000 }, { name: 'v001/DELIVERY.md', bytes: 9 }, { name: `v002/${SEQ.name}.mp4`, bytes: 6000 }] })
    const v2 = join(shared, 'output', 'deliver', 'archival-085', 'v002'); mkdirSync(v2, { recursive: true }); writeFileSync(join(v2, `${SEQ.name}.mp4`), 'x'); writeFileSync(join(v2, `${SEQ.name}.mp4.meta.json`), JSON.stringify({ approved_by: 'Lucas', rendered_at: '2026-11-19T10:00:00Z' }))
    const d = (await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: SEQ.name }] })).items[0].deliverables
    expect(d).toEqual([{ clip_name: SEQ.name, shot: 'archival-085', version: 'v001', file: `${SEQ.name}.mp4`, files: [`${SEQ.name}.mp4`], exists_local: false, exists_remote: true, bytes: 5000, local_url: '' }, { clip_name: SEQ.name, shot: 'archival-085', version: 'v002', file: `${SEQ.name}.mp4`, files: [`${SEQ.name}.mp4`], exists_local: true, exists_remote: true, bytes: 6000, approved_by: 'Lucas', rendered_at: '2026-11-19T10:00:00Z', local_url: `localfile://d/archival-085/v002/${SEQ.name}.mp4` }])
  })
})


// ===== conform: clip names, timecode, ProRes default, the cheap-card estimate =====
/** A DPX header with a television header (image data at 2048) and its time code at 1920 (BCD, the file's byte order). */
const dpxWithTc = (tc: number, o: { le?: boolean; width?: number; height?: number } = {}) => { const b = Buffer.alloc(2048); b.write(o.le ? 'XPDS' : 'SDPX', 0); const w = (off: number, v: number) => (o.le ? b.writeUInt32LE(v, off) : b.writeUInt32BE(v, off)); w(4, 2048); w(16, 4096); w(772, o.width ?? 3840); w(776, o.height ?? 2160); b.writeUInt8(50, 800); b.writeUInt8(10, 803); w(1920, tc); return b }
const EDL = { a: 'ARCHIVAL-077_A_FINAL_V03_3840X2160_23.976_PRORES422HQ', b: 'ARCHIVAL-077_B_FINAL_V03_3840X2160_23.976_PRORES422HQ', c: 'ARCHIVAL-077_C_FINAL_V02_1920X1080_23.976_PRORES422HQ' }

describe('clip names (the EDL\'s, so a conform relinks)', () => {
  it('accepts the 077 EDL names and trims; refuses traversal, slash, NUL, overlong, odd characters and uuid- or hash-looking names', () => {
    for (const n of Object.values(EDL)) expect(renders.validateClipName(n)).toBe(n); expect(renders.validateClipName('  ARCHIVAL-077_A  ')).toBe('ARCHIVAL-077_A'); expect(renders.validateClipName('A B.1')).toBe('A B.1')
    for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', 'a\u0000b', 'a\nb', 'x'.repeat(201), 'a;b', "a'b", '.hidden', 'name.', '3f2504e0-4f89-11d3-9a0c-0305e82c3301', 'clip_0123456789abcdef0123', 5 as never]) expect(() => renders.validateClipName(bad), String(bad)).toThrow()
    expect(renders.validateSequence({ ...SEQ, clip_name: EDL.a }).clip_name).toBe(EDL.a); expect(() => renders.validateSequence({ ...SEQ, clip_name: '../x' })).toThrow(/clip_name/); expect(renders.validateSequence({ ...SEQ }).clip_name).toBeUndefined()
    expect(renders.clipOf({ name: 'stem' })).toBe('stem'); expect(renders.clipOf({ name: 'stem', clip_name: 'EDL' })).toBe('EDL')
  })
  it('outputs carry the clip name: proxy source and downscale, partial, review mov and mp4 (the version is in the folder)', () => {
    const s = { ...SEQ, clip_name: EDL.a }
    expect(renders.proxyRel(s, 'source')).toBe(`output/.proxies/proxy_v004/shotA/${EDL.a}.mp4`); expect(renders.proxyRel(s, 1280)).toBe(`output/.proxies/proxy_v004/shotA/${EDL.a}_1280.mp4`); expect(renders.proxyRel(s, 'source', true)).toBe(`output/.proxies/proxy_v004/shotA/${EDL.a}_partial.mp4`)
    expect(renders.reviewRel('archival-077', 3, EDL.a)).toBe(`output/deliver/archival-077/v003/${EDL.a}.mov`); expect(renders.reviewRel('archival-077', 3, EDL.a, 'h264')).toBe(`output/deliver/archival-077/v003/${EDL.a}.mp4`)
    expect(renders.shotOf(EDL.a, 'x')).toBe('archival-077'); expect(renders.shotOf(EDL.c, 'x')).toBe('archival-077')
  })
})

describe('the start timecode (never invented)', () => {
  it('BCD decode from the television header, both byte orders; unset or invalid is null', () => {
    expect(renders.bcdTimecode(0x01000000)).toBe('01:00:00:00'); expect(renders.bcdTimecode(0x00595700)).toBe('00:59:57:00'); expect(renders.bcdTimecode(0x23595923)).toBe('23:59:59:23')
    for (const bad of [0, 0xffffffff, 0x0a000000, 0x24000000, 0x01600000, 0x01006000, 0x0100000a]) expect(renders.bcdTimecode(bad), bad.toString(16)).toBeNull()
    expect(renders.parseDpxInfo(dpxWithTc(0x01000000))!.timecode).toBe('01:00:00:00'); expect(renders.parseDpxInfo(dpxWithTc(0x00595700, { le: true }))).toMatchObject({ timecode: '00:59:57:00', be: false })
    expect(renders.parseDpxInfo(dpxWithTc(0))!.timecode).toBeNull(); expect(renders.parseDpxInfo(dpxHeader())!.timecode).toBeNull()   // a header cut at 820 bytes has no television header
  })
  it('-timecode goes into the argument array (ProRes and H.264) when the header has one, and not otherwise', () => {
    const a = renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o', codec: 'prores422hq', quality: 'review', timecode: '01:00:00:00', final: '/o/x.mov' }); expect(a[a.indexOf('-timecode') + 1]).toBe('01:00:00:00'); expect(a.indexOf('-timecode')).toBeLessThan(a.indexOf('-an'))
    expect(renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o', timecode: '00:59:57:00' })).toContain('-timecode'); expect(renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o' })).not.toContain('-timecode')
    expect(renders.ffmpegArgs(SEQ, 'source', { outputDir: '/o', timecode: null })).not.toContain('-timecode')
  })
  it('a review on the pod embeds it, and records it (and its source) in the sidecar and DELIVERY.md; without one it says so', async () => {
    pod.header = dpxWithTc(0x01000000); let j = await runJob({ kind: 'review', approved_by: 'L', width: undefined, codecs: ['prores422hq'] }); expect(j.sequences[0].state).toBe('pulled')
    let script = scripts.filter((s) => s.includes('nice -n 10')).at(-1)!; expect(script).toContain("'-timecode' '01:00:00:00'")
    const meta = JSON.parse(script.split("<<'RENDER_EOF_0'\n")[1].split('\nRENDER_EOF_0')[0].replace(/@@(BYTES|FRAMES|RATE)_\d@@/g, '0').replace(/@@SHA256_\d@@/g, 'x')); expect(meta).toMatchObject({ start_timecode: '01:00:00:00', timecode_source: 'DPX television header (SMPTE 268M, byte 1920)', codec: 'prores422hq' })
    expect(script.split("<<'RENDER_EOF_1'\n")[1]).toContain('Start timecode: 01:00:00:00, read from the DPX television header')
    pod.header = dpxHeader(); j = await runJob({ kind: 'review', approved_by: 'L', width: undefined, codecs: ['prores422hq'] }); script = scripts.filter((s) => s.includes('nice -n 10')).at(-1)!
    expect(script).not.toContain("'-timecode'"); expect(script.split("<<'RENDER_EOF_1'\n")[1]).toContain('no timecode in the DPX header (the file has no television header); none embedded (never invented)')
    expect(JSON.parse(script.split("<<'RENDER_EOF_0'\n")[1].split('\nRENDER_EOF_0')[0].replace(/@@(BYTES|FRAMES|RATE)_\d@@/g, '0').replace(/@@SHA256_\d@@/g, 'x'))).toMatchObject({ start_timecode: null, timecode_note: 'no timecode in the DPX header (the file has no television header)' })
  })
})

describe('ProRes 422 HQ is the review default; the proxy stays H.264', () => {
  it('review with no codecs: one ProRes .mov pass, source size; plan says the proxy is always H.264', async () => {
    const j = await runJob({ kind: 'review', approved_by: 'L', width: undefined }); const script = scripts.filter((s) => s.includes('nice -n 10')).at(-1)!
    expect(j.codecs).toEqual(['prores422hq']); expect(script).toContain("'prores_ks'"); expect(script).not.toContain("'libx264'"); expect(j.sequences[0].out).toBe(`output/deliver/archival-085/v001/${SEQ.name}.mov`)
    expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy' })).notes.join(' ')).toMatch(/always H\.264 \(this app cannot play ProRes\)/); expect(mounts_default()).toEqual(['prores422hq'])
    const px = await runJob({}); expect(scripts.filter((s) => s.includes('nice -n 10')).at(-1)).toContain("'libx264'"); expect(px.kind).toBe('proxy')
  })
})
const mounts_default = () => ['prores422hq']

describe('conform: three takes of one shot, one v### folder; frames untouched; the 1080p take at its own size', () => {
  const take = (k: 'a' | 'b' | 'c') => ({ dir: 'rounds/archival-077', name: `ARCHIVAL-077_${k.toUpperCase()}_FRAMES`, clip_name: EDL[k], first: 0, last: 9, frames: 10, pad: 4 })
  it('077a/b/c in one job: separate clip names in the SAME shot version folder; DELIVERY.md gains a section per clip; the frames and their folders are never written', async () => {
    renders.setDeps({ ssh: async ({ script, onLine }) => { scripts.push(script)
      if (script.includes('PROBE-DONE')) { const m = /ARCHIVAL-077_([ABC])_FRAMES/.exec(script)![1]; onLine('FFV ffmpeg 7'); onLine('FFP 1'); onLine(`HDR ${hex(m === 'C' ? dpxWithTc(0x01000000, { width: 1920, height: 1080 }) : dpxWithTc(0x01000000))}`); for (const f of range(0, 9)) onLine(`F 1000 1.0 ARCHIVAL-077_${m}_FRAMES.${String(f).padStart(4, '0')}.dpx`); onLine('PROBE-DONE') }
      else if (script.startsWith('ls -1')) { /* no versions yet */ } else if (script.includes('nice -n 10')) { onLine('PASS 0'); onLine('RENDER-DONE 0 7 10'); onLine('RENDER-ALL') } return { code: 0 } } })
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: [take('a'), take('b'), take('c')], kind: 'review', approved_by: 'Lucas' }); await renders.settled(); const j = renders.status(job_id).jobs[0]
    expect(j.sequences.map((x) => [x.shot, x.version, x.clip_name, x.state])).toEqual([['archival-077', 'v001', EDL.a, 'pulled'], ['archival-077', 'v001', EDL.b, 'pulled'], ['archival-077', 'v001', EDL.c, 'pulled']])
    const runs = scripts.filter((s) => s.includes('nice -n 10')); expect(runs).toHaveLength(3)
    expect(runs[0]).toContain("mkdir '/workspace/comfy-shared/output/deliver/archival-077/v001' || { echo RENDER-VEXISTS; exit 0; }"); expect(runs[1]).toContain("mkdir -p '/workspace/comfy-shared/output/deliver/archival-077/v001'"); expect(runs[1]).not.toContain('RENDER-VEXISTS'); expect(runs[2]).not.toContain('RENDER-VEXISTS')
    expect(runs[0]).toContain(`/v001/${EDL.a}.mov.part`); expect(runs[1]).toContain(`/v001/${EDL.b}.mov.part`); expect(runs[2]).toContain(`/v001/${EDL.c}.mov.part`)
    expect(runs[0]).toContain('cat > ') ; expect(runs[1]).toMatch(/cat '.*DELIVERY\.md\.tmp' >> '.*DELIVERY\.md'/); expect(runs[0]).not.toMatch(/>> '.*DELIVERY\.md'/)
    for (const r of runs) { expect(r).not.toMatch(/rm -rf|mv '[^']*\.dpx|> '[^']*\.dpx/); expect(r).toContain('/workspace/comfy-shared/output/rounds/archival-077/ARCHIVAL-077_') }   // frames are only read
    expect(pulls.map((p) => (p.req.paths as string[])[0])).toEqual([`output/deliver/archival-077/v001/${EDL.a}.mov`, `output/deliver/archival-077/v001/${EDL.b}.mov`, `output/deliver/archival-077/v001/${EDL.c}.mov`])
    const md = runs[1].split("<<'RENDER_EOF_1'\n")[1]; expect(md).toContain(`Clip name: \`${EDL.b}\``); expect(md).toContain("differs from the frames' stem `ARCHIVAL-077_B_FRAMES`; the frames keep their served names")
    expect(runs[2].split("<<'RENDER_EOF_1'\n")[1]).toContain('the source resolution 1920x1080')   // the 1080p take is rendered at ITS size
    expect(runs[2]).toContain("'scale=out_color_matrix=bt709,format=yuv422p10le'"); expect(runs[2]).not.toMatch(/scale=3840|scale=1920/)
    const plan = await renders.plan({ pod_id: 'p1', sequences: [take('c')] }); expect(plan.sequences[0].source).toEqual({ width: 1920, height: 1080, bits: 10 })
  })
  it('the default clip name is the DPX stem; an override is recorded in the sidecar; the plan returns clip_name', async () => {
    const p = await renders.plan({ pod_id: 'p1', sequences: [SEQ, { ...SEQ, name: 'OTHER_1', clip_name: EDL.a }], kind: 'review' }); expect(p.sequences.map((x) => x.clip_name)).toEqual([SEQ.name, EDL.a]); expect(p.sequences[0].out).toBe(`output/deliver/archival-085/v001/${SEQ.name}.mov`)
    await runJob({ sequences: [{ ...SEQ, clip_name: EDL.a }], kind: 'review', approved_by: 'L', width: undefined }); const script = scripts.filter((s) => s.includes('nice -n 10')).at(-1)!
    expect(JSON.parse(script.split("<<'RENDER_EOF_0'\n")[1].split('\nRENDER_EOF_0')[0].replace(/@@(BYTES|FRAMES|RATE)_\d@@/g, '0').replace(/@@SHA256_\d@@/g, 'x'))).toMatchObject({ clip_name: EDL.a, frames_stem: SEQ.name, shot: 'archival-077' })
  })
  it('proxies() finds proxies and reviews by clip name and returns clip_name', async () => {
    const pd = join(shared, 'output', '.proxies', SEQ.dir); mkdirSync(pd, { recursive: true }); writeFileSync(join(pd, `${EDL.a}.mp4`), 'v'); writeFileSync(join(pd, `${EDL.a}_1280.mp4`), 'v')
    const r = (await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: 'STEM_X', clip_name: EDL.a }] })).items[0]; expect(r).toMatchObject({ clip_name: EDL.a, exists_local: true, local_url: `localfile://p/proxy_v004/shotA/${EDL.a}.mp4` })
    const d = join(shared, 'output', 'deliver', 'archival-077', 'v001'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `${EDL.a}.mov`), 'm'); writeFileSync(join(d, `${EDL.a}.mp4`), 'p'); writeFileSync(join(d, `${EDL.b}.mov`), 'q')
    const dl = (await renders.proxies({ pod_id: 'p1', items: [{ dir: SEQ.dir, name: 'STEM_X', clip_name: EDL.a }] })).items[0].deliverables; expect(dl).toHaveLength(1); expect(dl[0]).toMatchObject({ clip_name: EDL.a, version: 'v001', file: `${EDL.a}.mp4`, files: [`${EDL.a}.mov`, `${EDL.a}.mp4`], exists_local: true, local_url: `localfile://d/archival-077/v001/${EDL.a}.mp4` })
  })
})

describe('a cheap card is enough: the pod\'s CPU, disk and the output estimate in the plan', () => {
  const planPod = (o: Record<string, unknown> = {}) => renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', ...o })
  it('4 cores warns for a source-size review; 16 does not; a downscale proxy does not', async () => {
    pod.cpu = { cores: 4, memMb: 16000, dfKb: 500 * 1024 * 1024 }; let p = await planPod(); expect(p.pod_cpu).toEqual({ cores: 4, mem_mb: 16000, free_gb: 500 }); expect(p.notes.join(' ')).toContain('This pod has 4 vCPUs: a 4K review will be slow (expect minutes per 100 frames). A pod with more cores or On this PC may be faster.')
    pod.cpu = { cores: 16, memMb: 64000, dfKb: 500 * 1024 * 1024 }; p = await planPod(); expect(p.pod_cpu!.cores).toBe(16); expect(p.notes.join(' ')).not.toContain('vCPUs')
    pod.cpu = { cores: 4, memMb: 16000, dfKb: 500 * 1024 * 1024 }; expect((await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'proxy', width: 960 })).notes.join(' ')).not.toContain('vCPUs')
  })
  it('a failing or missing probe leaves pod_cpu out, without an error', async () => {
    pod.cpu = 'fail'; let p = await planPod(); expect('pod_cpu' in p).toBe(false); expect(p.pod_ok).toBe(true); pod.cpu = null; p = await planPod(); expect('pod_cpu' in p).toBe(false)
    renders.setDeps({ ssh: async ({ script }) => { if (script.includes('NPROC')) return await new Promise(() => undefined); return { code: 0 } } })   // a probe that never answers: the 5 s limit ends it
    const t0 = Date.now(); const q = await Promise.race([renders.probePod('p1', { host: 'h', port: 22 }), new Promise<'late'>((r) => setTimeout(() => r('late'), 6500))]); expect(q).toBeNull(); expect(Date.now() - t0).toBeLessThan(6400)
  }, 10_000)
  it('output estimate arithmetic: ProRes 422 HQ about 5.3 GB per minute at 24 fps at 4K, scaled by pixels; H.264 less', () => {
    expect(renders.outputGb(1440, 24, ['prores422hq'], 'review', 1)).toBe(5.3); expect(renders.outputGb(2880, 24, ['prores422hq'], 'review', 1)).toBe(10.6); expect(renders.outputGb(1440, 24, ['prores422hq'], 'review', 0.25)).toBe(1.3)
    expect(renders.outputGb(1440, 24, ['h264'], 'review', 1)).toBe(0.8); expect(renders.outputGb(1440, 24, ['h264'], 'proxy', 1)).toBe(0.4); expect(renders.outputGb(1440, 24, ['h264', 'prores422hq'], 'review', 1)).toBe(6.1); expect(renders.outputGb(0, 24, ['prores422hq'], 'review', 1)).toBe(0)
  })
  it('estimate.output_gb per sequence and in total; low disk is a note, never a refusal; a big output mentions the 5 GB sync gate', async () => {
    const S = { ...SEQ, last: 2879, frames: 2880 }; pod.frames = range(0, 2879)
    pod.cpu = { cores: 16, memMb: 64000, dfKb: 3 * 1024 * 1024 }
    const p = await planPod({ sequences: [S] }); expect(p.sequences[0].estimate!.output_gb).toBe(10.6); expect(p.estimate.output_gb).toBe(10.6); expect(p.pod_ok).toBe(true)
    expect(p.notes.join(' ')).toContain("Only 3 GB are free on the pod's output volume; about 10.6 GB is needed"); expect(p.notes.join(' ')).toContain('About 10.6 GB: a sync of this size asks for approval (Auto sync) or takes a while.')
    const small = await planPod(); expect(small.notes.join(' ')).not.toContain('sync of this size')
  })
  it('on this PC: the local free space is compared with the estimate, as a note', async () => {
    renders.setDeps({ localFree: async () => 2e9 }); const dirF = join(shared, 'output', SEQ.dir); mkdirSync(dirF, { recursive: true }); for (let i = 0; i < 2880; i++) writeFileSync(join(dirF, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : '')
    const p = await renders.plan({ sequences: [{ ...SEQ, last: 2879, frames: 2880 }], kind: 'review', where: 'local' })
    expect(p.local_free_gb).toBe(2); expect(p.notes.join(' ')).toContain('Only 2 GB are free on this PC; about 10.6 GB is needed (not refused).'); expect('pod_cpu' in p).toBe(false)
  })
  it('the measured encode rate goes into the sidecar and DELIVERY.md (placeholders filled on the pod; locally from the clock)', async () => {
    await runJob({ kind: 'review', approved_by: 'L', width: undefined, codecs: ['h264'] }); const script = scripts.filter((s) => s.includes('nice -n 10')).at(-1)!
    expect(script).toContain('RATE_0=$(awk'); expect(script).toContain('"s/@@RATE_0@@/${RATE_0:-0}/g"');   // an empty rate (the awk failed) is written as 0, never as nothing: an empty value made the sidecar invalid JSON and Auto-publish dropped the source frames
     expect(script.split("<<'RENDER_EOF_1'\n")[1]).toContain('Measured encode rate: h264 @@RATE_0@@ frames per second'); expect(script).toContain('"render_fps": @@RATE_0@@')
  })
})

describe('publish when the render finishes (ADR-050): per run, with the same approver, only from files on this PC', () => {
  let uploads: string[], posts: number
  const frames = (n = 10) => { mkdirSync(join(shared, 'output', SEQ.dir), { recursive: true }); for (let i = 0; i < n; i++) writeFileSync(join(shared, 'output', SEQ.dir, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x') }
  beforeEach(async () => {
    uploads = []; posts = 0; process.env.SETTINGS_ENV_FILE = join(dir, '.env'); process.env.PUBLISH_SLACK_HOST_ALLOW = 'hooks.slack.com'; publish.reset()
    publish.setDeps({ outputRoot: () => join(shared, 'output'), parallel: () => 2,
      aws: async (a) => { if (a[1] === 'cp') uploads.push(a[3]); return a[1] === 'presign' ? { code: 0, stdout: 'https://s3.example/x?X-Amz-Signature=1', stderr: '' } : { code: a[1] === 'ls' ? 1 : 0, stdout: '', stderr: '' } },
      fetch: (async () => { posts++; return new Response('ok') }) as unknown as typeof fetch })
    await publish.setSettings({ s3: { credentials: 'app', bucket: 'my-internal-bucket', region: 'us-west-2', prefix: 'renders', access_key_id: 'AKIAEXAMPLE12345', secret_access_key: 'secretsecretsecret1234' }, slack: { webhook_url: 'https://hooks.slack.com/services/T/B/XXXXXXXX' } })
  })
  afterEach(() => { publish.reset(); delete process.env.PUBLISH_SLACK_HOST_ALLOW; delete process.env.PUBLISH_S3_ACCESS_KEY_ID; delete process.env.PUBLISH_S3_SECRET_ACCESS_KEY; delete process.env.PUBLISH_SLACK_WEBHOOK_URL })
  it('needs approved_by, also for a proxy, and a configured destination; refuses a bad target list', async () => {
    frames()
    await expect(renders.start({ sequences: [SEQ], width: 960, where: 'local', publish: { targets: ['s3'] } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/approved_by/) })
    await expect(renders.start({ sequences: [SEQ], width: 960, where: 'local', approved_by: 'L', publish: { targets: ['ftp' as never] } })).rejects.toMatchObject({ status: 400 })
    await publish.setSettings({ clear: ['s3_keys'] }); await expect(renders.start({ sequences: [SEQ], width: 960, where: 'local', approved_by: 'L', publish: { targets: ['s3'] } })).rejects.toThrow(/S3 is not configured/)
  })
  it('a proxy rendered on this PC is published after it exists, with the job approver, and the job shows the publish state', async () => {
    frames(); const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local', approved_by: 'Lucas', publish: { targets: ['s3', 'slack'] } }); await renders.settled(); await publish.settled()
    const j = job(job_id); expect(j.publish).toMatchObject({ state: 'done' }); expect(j.publish!.job_id).toMatch(/^publish-/)
    expect(uploads).toEqual([`s3://my-internal-bucket/renders/.proxies/${SEQ.dir}/${SEQ.name}_960.mp4`]); expect(posts).toBe(1)
    expect(publish.status(j.publish!.job_id).jobs[0].approved_by).toBe('Lucas')
  })
  it('a review publishes its whole version folder (movie, DELIVERY.md, sidecar)', async () => {
    frames(); const { job_id } = await renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'Lucas', where: 'local', codecs: ['h264'], publish: { targets: ['s3'] } }); await renders.settled(); await publish.settled()
    expect(job(job_id).publish).toMatchObject({ state: 'done' }); expect(uploads.map((u) => u.split('/').pop()).sort()).toEqual(['DELIVERY.md', `${SEQ.name}.mp4`, `${SEQ.name}.mp4.meta.json`].sort())
    expect(uploads.every((u) => u.startsWith('s3://my-internal-bucket/renders/deliver/archival-085/v001/'))).toBe(true)
  })
  it('a render that stayed on the pod (pull off, Sync off) is published from the VOLUME, streamed through this PC: no "pull first", no local copy', async () => {
    const asked: string[] = []
    publish.setDeps({ volumeId: () => 'volx1', volumeAccess: async () => ({ ok: true, id: 'ID', secret: 'SEC', endpoint: 'https://s3api-eu-ro-1.runpod.io', bucket: 'volx1', region: 'eu-ro-1' }), volumeRecord: async () => ({ id: 'volx1', name: 'Shared', datacenter: 'EU-RO-1' }),
      aws: async (a) => {
        if (a[1] === 'ls' && /^s3:\/\/volx1\//.test(a[2] ?? '')) { asked.push(a[2]); return a.includes('--recursive') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: `2026-11-19 10:00:00 ${'10'.padStart(10)} ${SEQ.name}_960.mp4`, stderr: '' } }   // the movie is on the volume
        if (a[1] === 'cp') uploads.push(a[3])
        return a[1] === 'presign' ? { code: 0, stdout: 'https://s3.example/x?X-Amz-Signature=1', stderr: '' } : { code: a[1] === 'ls' ? 1 : 0, stdout: '', stderr: '' } } })
    const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, where: 'pod', pull: false, approved_by: 'L', publish: { targets: ['s3'] } }); await renders.settled()
    const pub = job(job_id).publish; expect(pub?.error ?? '').not.toMatch(/Pull the renders/); expect(pub?.state).not.toBe('refused'); expect(pub?.job_id).toMatch(/^publish-/)   // a publish job was made from the volume item
    expect(asked.some((p) => p.includes('.proxies'))).toBe(true)
  })
  it('a failed render publishes nothing; a run without publish never touches it', async () => {
    const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local', approved_by: 'L', publish: { targets: ['s3'] } }); await renders.settled()   // no frames here
    expect(job(job_id).state).toBe('failed'); expect(job(job_id).publish).toBeUndefined(); expect(uploads).toEqual([])
    frames(); const b = await renders.start({ sequences: [SEQ], width: 1280, where: 'local' }); await renders.settled(); expect(job(b.job_id).publish).toBeUndefined(); expect(uploads).toEqual([])
  })
})

describe('Skip existing (default true; per run, never a stored default)', () => {
  const SEQ2 = { ...SEQ, name: 'ARCHIVAL-086_MAIN_23.976_PRORES' }
  const mk = (name: string, n = 10) => { mkdirSync(join(shared, 'output', SEQ.dir), { recursive: true }); for (let i = 0; i < n; i++) writeFileSync(join(shared, 'output', SEQ.dir, `${name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x') }
  const local = async (o: Record<string, unknown> = {}) => { const { job_id } = await renders.start({ sequences: [SEQ], width: 960, where: 'local', ...o }); await renders.settled(); return job(job_id) }
  const proxy = (name: string) => join(shared, 'output', '.proxies', SEQ.dir, `${name}_960.mp4`)
  it('proxy: the plan says what would be skipped and counts it; a job mixes skipped and rendered with the reason, and History counts it', async () => {
    mk(SEQ.name); mk(SEQ2.name); await local()
    const p = await renders.plan({ sequences: [SEQ, SEQ2], width: 960, where: 'local' }); expect(p.skip_existing).toBe(true); expect(p.sequences.map((x) => x.skip)).toEqual(['already rendered', null]); expect(p.totals).toEqual({ to_render: 1, skipped: 1 })
    const off = await renders.plan({ sequences: [SEQ, SEQ2], width: 960, where: 'local', skip_existing: false }); expect(off.skip_existing).toBe(false); expect(off.sequences.map((x) => x.skip)).toEqual([null, null]); expect(off.totals).toEqual({ to_render: 2, skipped: 0 })
    const j = await local({ sequences: [SEQ, SEQ2] }); expect(j.sequences.map((x) => [x.state, x.reason])).toEqual([['skipped', 'already rendered'], ['done', undefined]]); expect(j.summary).toMatch(/1 rendered, 1 already there/)
    expect((history.list({ kind: 'job' })[0] as { detail: string }).detail).toMatch(/1 already there/)
  })
  it('proxy: everything already rendered is a 400; unticked, it renders again', async () => {
    mk(SEQ.name); await local(); await expect(local()).rejects.toMatchObject({ status: 400, message: 'Everything in this scope is already rendered: untick Skip existing to render again' })
    spawned.length = 0; const j = await local({ skip_existing: false }); expect(j.sequences[0].state).toBe('done'); expect(spawned.some((s) => s.args[0] !== '-version')).toBe(true)
  })
  it('proxy: re-rendering writes a .part and renames it, so a failed render keeps the old proxy intact', async () => {
    mk(SEQ.name); await local(); const { statSync, readFileSync } = await import('node:fs'), before = readFileSync(proxy(SEQ.name), 'utf8'), size = statSync(proxy(SEQ.name)).size
    renders.setDeps({ spawn: async (_c, args) => { if (args[0] === '-version') return { code: 0 }; writeFileSync(args.at(-1)!, 'HALF-WRITTEN-NEW'); return { code: 1 } } })
    const j = await local({ skip_existing: false }); expect(j.sequences[0].state).toBe('failed'); expect(readFileSync(proxy(SEQ.name), 'utf8')).toBe(before); expect(statSync(proxy(SEQ.name)).size).toBe(size)
  })
  it('review: a clip that already has a review version is skipped (no new version); unticked it makes the next one', async () => {
    mk(SEQ.name); const v1 = join(shared, 'output', 'deliver', 'archival-085', 'v001'); mkdirSync(v1, { recursive: true }); writeFileSync(join(v1, `${SEQ.name}.mov`), 'old')
    const p = await renders.plan({ sequences: [SEQ], kind: 'review', where: 'local' }); expect(p.sequences[0].skip).toBe('already has review v001'); expect(p.totals).toEqual({ to_render: 0, skipped: 1 })
    await expect(renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'L', where: 'local', codecs: ['h264'] })).rejects.toMatchObject({ status: 400, message: renders.ALL_DONE })
    mk(SEQ2.name); const { job_id } = await renders.start({ sequences: [SEQ, SEQ2], kind: 'review', approved_by: 'L', where: 'local', codecs: ['h264'] }); await renders.settled()
    const j = job(job_id); expect(j.sequences[0]).toMatchObject({ state: 'skipped', reason: 'already has review v001' }); expect(existsSync(join(shared, 'output', 'deliver', 'archival-085', 'v002', `${SEQ.name}.mp4`))).toBe(false)
    const again = await renders.start({ sequences: [SEQ], kind: 'review', approved_by: 'L', where: 'local', codecs: ['h264'], skip_existing: false }); await renders.settled()
    expect(job(again.job_id).sequences[0]).toMatchObject({ state: 'done' }); expect(existsSync(join(shared, 'output', 'deliver', 'archival-085', 'v003', `${SEQ.name}.mp4`)) || existsSync(join(shared, 'output', 'deliver', 'archival-085', 'v002', `${SEQ.name}.mp4`))).toBe(true)
  })
  it('a review that is on the volume only (S3 listing) also counts', async () => {
    renders.setDeps({ deliverFiles: async () => [{ name: `v004/${SEQ.name}.mov`, bytes: 9 }, { name: 'v004/DELIVERY.md', bytes: 1 }] })
    const p = await renders.plan({ pod_id: 'p1', sequences: [SEQ], kind: 'review', where: 'local' }); expect(p.sequences[0].skip).toBe('already has review v004')
  })
  it('more than 30 sequences (no per-sequence probe): the plan counts what exists on this PC or the volume, and start refuses when all of it is there', async () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ ...SEQ, name: `ARCHIVAL-${String(200 + i)}_MAIN` }))
    mkdirSync(join(shared, 'output', '.proxies', SEQ.dir), { recursive: true }); for (const s of many) writeFileSync(proxy(s.name), 'p')
    const p = await renders.plan({ sequences: many, width: 960, where: 'local' }); expect(p.totals).toEqual({ to_render: 0, skipped: 31 })
    await expect(renders.start({ sequences: many, width: 960, where: 'local' })).rejects.toMatchObject({ status: 400, message: renders.ALL_DONE })
  })
  it('the configuration holds the starting value (default true); a request that omits it uses it, an explicit value wins', async () => {
    expect(renders.effectiveSettings().skip_existing).toBe(true); mounts.save({ ...mounts.load(), render: { ...mounts.load().render!, skip_existing: false } })
    expect((await renders.plan({ sequences: [SEQ], width: 960, where: 'local' })).skip_existing).toBe(false); expect((await renders.plan({ sequences: [SEQ], width: 960, where: 'local', skip_existing: true })).skip_existing).toBe(true)
  })
})

describe('a start never publishes by configuration alone', () => {
  it('render.publish pre-ticks only: without an explicit publish field nothing is published; with it, approved_by is still required', async () => {
    mounts.save({ ...mounts.load(), render: { ...mounts.RENDER_DEFAULT, kind: 'proxy', where: 'local', pull: true, publish: { s3: true, slack: false } } })
    const frames = () => { mkdirSync(join(shared, 'output', SEQ.dir), { recursive: true }); for (let i = 0; i < 10; i++) writeFileSync(join(shared, 'output', SEQ.dir, `${SEQ.name}.${String(i).padStart(4, '0')}.dpx`), i === 0 ? dpxHeader() : 'x') }
    frames(); const { job_id } = await renders.start({ sequences: [SEQ], width: 960 }); await renders.settled(); expect(job(job_id).publish).toBeUndefined()
    await expect(renders.start({ sequences: [SEQ], width: 1280, publish: { targets: ['s3'] } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/approved_by/) })
  })
})

describe('a failed review render leaves no empty version folder (it would eat the number)', () => {
  it('the pod script removes the version folder it created when ffmpeg fails or the count is wrong, and only that one; a later take of the same shot (createDir false) leaves the folder', () => {
    const passes = [{ args: ['ffmpeg', '-i', 'in', '/o/deliver/s/v003/s.mov.part'], fmt: 'mov', verify: 10 }] as never
    const first = renders.renderScript(passes, 'j', 0, [], { versionDir: '/o/deliver/s/v003', createDir: true }), later = renders.renderScript(passes, 'j', 0, [], { versionDir: '/o/deliver/s/v003', createDir: false })
    expect(first).toMatch(/rm -f '\/o\/deliver\/s\/v003\/s\.mov\.part'; rmdir '\/o\/deliver\/s\/v003' 2>\/dev\/null; echo "RENDER-EXIT \$rc"/); expect(first).toMatch(/rmdir '\/o\/deliver\/s\/v003' 2>\/dev\/null; echo "RENDER-COUNT/)
    expect(later).not.toContain('rmdir')
  })
})

describe('where a render came from (the Queue shows MCP actions)', () => {
  it('under an MCP tool call: origin mcp + the client name + a History line; from the window: origin window; Auto-publish: auto-publish', async () => {
    const history = await import('../src/history.js')
    const j = await history.runAs({ source: 'mcp', tool: 'render_sequences', client: 'claude-code', approved_by: 'Lucas' }, () => runJob({ approved_by: 'Lucas' })); expect(j).toMatchObject({ origin: 'mcp', mcp_client: 'claude-code' })
    expect(history.list({ limit: 30 }).some((e) => e.kind === 'change' && e.action === 'started by MCP' && /render proxy/.test(e.what) && /claude-code.*Lucas/s.test(String(e.detail)))).toBe(true)
    expect((await runJob({})).origin).toBe('window'); expect((await runJob({ trigger: 'auto-publish' })).origin).toBe('auto-publish')
  })

  // docs/ADR-064: Generated on a render that ran on a pod is sent BY THE POD to the storage that listens, with nothing pulled to this PC
  it('Generated: a proxy rendered on the pod (not pulled) is put to the storage by the pod, through a signed link', async () => {
    const storage = await import('../src/storage.js')
    process.env.STORAGE_ADAPTERS_FILE = join(dir, 'storage-adapters.json')
    await storage.save({ id: 'wasabi', bucket: 'bincvfx', region: 'ap-southeast-1', ...{ access_key_id: 'WASABIKEY12345678', secret_access_key: 'wasabisecretwasabisecret1234' }, enabled: true })
    const syncrules = await import('../src/syncrules.js'); process.env.SYNC_RULES_FILE = join(dir, 'sync-rules.json'); syncrules.set('*', 'generated', [{ type: 'storage', id: 'wasabi' }])
    storage.setAws(async () => ({ code: 1, stdout: '', stderr: '' }) as never)
    const put: string[] = []
    publish.setDeps({ ssh: (async (o: { script: string; onLine: (l: string) => void }) => { put.push(o.script); o.onLine(`PUBLISH-SHA ${'b'.repeat(64)}`); o.onLine('PUBLISH-OK'); return { code: 0 } }) as never })
    try {
      const { job_id } = await renders.start({ pod_id: 'p1', sequences: [SEQ], width: 960, where: 'pod', pull: false })
      await until(() => job(job_id).state === 'done' && history.list({ limit: 20 }).some((e) => /storage upload on generated/.test(e.action ?? '')))
      expect(put.length).toBeGreaterThan(0)
      expect(put[0]).toContain(`/workspace/comfy-shared/output/.proxies/proxy_v004/shotA/${SEQ.name}_960.mp4`); expect(put[0]).toContain('s3.ap-southeast-1.wasabisys.com/bincvfx/.proxies/proxy_v004/shotA/')
      expect(put[0]).not.toContain('wasabisecret')
    } finally { publish.setDeps(null); storage.setAws(null); delete process.env.STORAGE_ADAPTERS_FILE; delete process.env.SYNC_RULES_FILE }
  })
})
