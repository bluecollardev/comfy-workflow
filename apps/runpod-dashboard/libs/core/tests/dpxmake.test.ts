import { describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as dpxmake from '../src/dpxmake.js'
import * as edl from '../src/edl.js'
import { scratch } from './helpers.js'

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const MASTER = 'temp/rounds/mono_v019/archival-077/approved/05-outputs/Approved/master/archival-077_a.mov'
const ok = { pod_id: 'p', approved_by: 'L', items: [{ master: MASTER, shot: 'archival-077', element: 'a', frames_expected: 5 }] }
const fake = (lines: (script: string, n: number) => { out: string[]; code: number }) => {
  const seen: string[] = []
  dpxmake.setDeps({ target: async () => ({ host: 'root@1.2.3.4', port: 22 }), outputDir: () => '/workspace/comfy-shared/output', ssh: async ({ script, onLine }) => { seen.push(script); const r = lines(script, seen.length); r.out.forEach((l) => onLine(l)); return { code: r.code } } })
  return seen
}
const good = (n = 5) => ['PROBE archival-077_a_mono_v019_NOT_RELEASED frames=5 fps=24000/1001 pix_fmt=yuv422p10le size=64x48 tag=bt709 range_tag=tv matrix=bt709 range=tv tagged=true', `FRAMES archival-077_a_mono_v019_NOT_RELEASED ${n}`, 'CHECK archival-077_a_mono_v019_NOT_RELEASED bits=16 magic=SDPX', 'DONE x 5']

describe('dpxmake: validation, before anything runs', () => {
  it('refuses a missing approver, a missing pod, bad names and paths', async () => {
    let called = 0; dpxmake.setDeps({ target: async () => { called++; return { host: 'h', port: 22 } }, ssh: async () => ({ code: 0 }), outputDir: () => '/w/output' })
    await expect(dpxmake.run({ ...ok, approved_by: ' ' })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.run({ ...ok, pod_id: '' })).rejects.toMatchObject({ status: 400 })
    const it0 = ok.items[0]
    for (const bad of [{ master: '../etc/x.mov' }, { master: 'a/../b.mov' }, { master: '/abs/x.mov' }, { master: 'a/x.mov; rm -rf /' }, { master: "a/'x.mov" }, { master: 'a/x.txt' }, { master: 'a//x.mov' }, { shot: 'a b' }, { shot: '..' }, { shot: 'a/b' }, { element: "a'" }, { element: '$(x)' }, { element: '' }, { frames_expected: 0 }, { frames_expected: 1.5 }, { fps: 0 }])
      await expect(dpxmake.run({ ...ok, items: [{ ...it0, ...bad }] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.run({ ...ok, round: '../x' })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.run({ ...ok, round: 'a;b' })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.run({ ...ok, items: [it0, it0] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.run({ ...ok, items: [] })).rejects.toMatchObject({ status: 400 })
    expect(called).toBe(0); dpxmake.setDeps(null)
  })
  it('plan returns the folder and the file name without asking a pod, and validates', async () => {
    const r = await dpxmake.plan({ items: [{ master: MASTER, shot: 'archival-077', element: 'a', frames_expected: 5 }] })
    expect(r.round).toBe('mono_v019')
    expect(r.rows[0]).toMatchObject({ out_dir: 'mono_v019/archival-077/archival-077_a/dpx', first_frame: 'mono_v019/archival-077/archival-077_a/dpx/archival-077_a_mono_v019_NOT_RELEASED.0000.dpx', last_frame: 'mono_v019/archival-077/archival-077_a/dpx/archival-077_a_mono_v019_NOT_RELEASED.0004.dpx' })
    await expect(dpxmake.plan({ items: [{ master: '../x.mov', shot: 's', element: 'a' }] })).rejects.toMatchObject({ status: 400 })
  })
})

describe('dpxmake: the script and the results', () => {
  it('sends one script per item with the quoted master, the output name and the filter, and checks the folder first', async () => {
    const seen = fake(() => ({ out: good(), code: 0 }))
    const r = await dpxmake.run(ok)
    expect(seen).toHaveLength(1); const s = seen[0]
    expect(s.startsWith('set -euo pipefail')).toBe(true)
    expect(s).toContain(`M='/workspace/comfy-shared/${MASTER}'`)
    expect(s).toContain("OUT='/workspace/comfy-shared/output/mono_v019/archival-077/archival-077_a/dpx'")
    expect(s).toContain("NAME='archival-077_a_mono_v019_NOT_RELEASED'")
    expect(s).toContain('"scale=in_range=$RANGE:out_range=pc:in_color_matrix=$MATRIX,format=rgb48le"')
    expect(s).toContain("nice ffmpeg '-hide_banner' '-loglevel' 'warning' '-nostdin' '-y' '-i' \"$M\" '-vf'")
    expect(s).toContain("'-c:v' 'dpx' '-pix_fmt' 'rgb48le' '-start_number' '0' \"$TMP/$NAME.%04d.dpx\"")
    expect(s).toContain('ls -A "$OUT"'); expect(s).toContain('mv "$TMP" "$OUT"'); expect(s).toContain('-j803')
    expect(r.results).toEqual([{ shot: 'archival-077', element: 'a', frames: 5, expected: 5, ok: true, out_dir: 'mono_v019/archival-077/archival-077_a/dpx', colour: { matrix: 'bt709', range: 'tv', tagged: true } }])
    dpxmake.setDeps(null)
  })
  it('an existing folder is refused by the script; the item fails with the reason', async () => {
    fake(() => ({ out: ['ERR /x/dpx already holds files; nothing written'], code: 2 }))
    const r = await dpxmake.run(ok)
    expect(r.results[0]).toMatchObject({ ok: false, frames: 0, error: '/x/dpx already holds files; nothing written' }); dpxmake.setDeps(null)
  })
  it('reports untagged masters as such, a wrong count as a failure, and a failed item does not stop the next', async () => {
    fake((_s, n) => n === 1
      ? { out: ['PROBE x frames=7 matrix=bt709 range=tv tagged=false', 'NOTE x the master carries no colour matrix tag: bt709 assumed', 'FRAMES x 7', 'CHECK x bits=16 magic=SDPX', 'ERR frame count 7, expected 5; not put in place'], code: 3 }
      : { out: good(), code: 0 })
    const r = await dpxmake.run({ ...ok, items: [ok.items[0], { master: MASTER, shot: 'archival-078', element: 'b', frames_expected: 5 }] })
    expect(r.results.map((x) => [x.shot, x.ok])).toEqual([['archival-077', false], ['archival-078', true]])
    expect(r.results[0].colour).toEqual({ matrix: 'bt709', range: 'tv', tagged: false }); expect(r.results[0].notes?.[0]).toMatch(/no colour matrix tag/); expect(r.results[0].error).toMatch(/frame count 7/)
    dpxmake.setDeps(null)
  })
  it('a count that differs from frames_expected fails even if the script said nothing, and a non-zero exit without a line is an error', async () => {
    fake((_s, n) => (n === 1 ? { out: good(4), code: 0 } : { out: [], code: 255 }))
    const r = await dpxmake.run({ ...ok, items: [ok.items[0], { master: MASTER, shot: 's2', element: 'a' }] })
    expect(r.results[0]).toMatchObject({ ok: false, error: 'frame count 4, expected 5' }); expect(r.results[1]).toMatchObject({ ok: false, error: 'the script ended with code 255' }); dpxmake.setDeps(null)
  })
  it('colourOf: tagged matrix, bt709 when untagged, range tv unless pc', () => {
    expect(dpxmake.colourOf({ color_space: 'smpte170m', color_range: 'pc' })).toEqual({ matrix: 'bt601', range: 'pc', tagged: true })
    expect(dpxmake.colourOf({ color_space: 'bt2020nc' })).toEqual({ matrix: 'bt2020', range: 'tv', tagged: true })
    expect(dpxmake.colourOf({})).toEqual({ matrix: 'bt709', range: 'tv', tagged: false })
  })
})

describe('dpxmake: the real ffmpeg arguments', () => {
  const prores = ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-colorspace', 'bt709', '-color_range', 'tv']
  const enc = (dir: string, src: string, file: string) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '5', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le', ...prores, join(dir, file)])
  const unpack = (m: string, out: string) => { mkdirSync(out); execFileSync('ffmpeg', [...dpxmake.ffmpegArgs({ input: m, out: join(out, 'c.%04d.dpx'), matrix: 'bt709', range: 'tv' })]) }
  it.skipIf(!hasFfmpeg)('writes 5 numbered 16-bit DPX files, straight, with the range expanded and the matrix right', () => {
    const d = scratch()
    enc(d, 'testsrc2=size=64x48:rate=24', 'a.mov'); enc(d, 'color=c=gray:size=64x48:rate=24', 'g.mov')
    unpack(join(d, 'a.mov'), join(d, 'oa')); unpack(join(d, 'g.mov'), join(d, 'og'))
    expect(readdirSync(join(d, 'oa')).sort()).toEqual([0, 1, 2, 3, 4].map((i) => `c.${String(i).padStart(4, '0')}.dpx`))
    const files = readdirSync(join(d, 'oa')).sort().map((f) => readFileSync(join(d, 'oa', f)))
    for (const b of files) { expect(['SDPX', 'XPDS']).toContain(b.subarray(0, 4).toString()); expect(b[803]).toBe(16) }
    expect(new Set(files.map((b) => b.toString('hex'))).size).toBeGreaterThan(1)
    const g = readFileSync(join(d, 'og', 'c.0000.dpx')), be = g.subarray(0, 4).toString() === 'SDPX', off = be ? g.readUInt32BE(4) : g.readUInt32LE(4)
    const expected = (128 / 255) * 65535   // mid grey 0x80, full range
    for (const ch of [0, 1, 2]) { const v = be ? g.readUInt16BE(off + ch * 2) : g.readUInt16LE(off + ch * 2); expect(Math.abs(v - expected) / 65535).toBeLessThan(0.03) }
  }, 30000)
  it.skipIf(!hasFfmpeg)('the whole script runs (here with bash standing in for the pod): unpacks, checks, renames into place; a second run is refused and writes nothing', async () => {
    const d = scratch(), root = join(d, 'comfy-shared'), mdir = join(root, 'temp/rounds/mono_v019/archival-077/approved/05-outputs/Approved/master'); mkdirSync(mdir, { recursive: true })
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=24', '-frames:v', '5', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-colorspace', 'bt709', '-color_range', 'tv', join(mdir, 'archival-077_a.mov')])
    dpxmake.setDeps({ target: async () => ({ host: 'x', port: 22 }), outputDir: () => join(root, 'output'), ssh: async ({ script, onLine }) => { const r = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8' }); for (const l of `${r.stdout}${r.stderr}`.split('\n')) if (l) onLine?.(l); return { code: r.status } } })
    const first = await dpxmake.run({ ...ok, items: [{ ...ok.items[0], frames_expected: 5 }] })
    expect(first.results[0]).toMatchObject({ ok: true, frames: 5, colour: { matrix: 'bt709', range: 'tv', tagged: true } })
    const out = join(root, 'output', first.results[0].out_dir); expect(readdirSync(out).sort()[0]).toBe('archival-077_a_mono_v019_NOT_RELEASED.0000.dpx'); expect(readdirSync(out)).toHaveLength(5); expect(readdirSync(join(root, 'output/mono_v019/archival-077/archival-077_a')).filter((f) => f.startsWith('.dpx_tmp'))).toEqual([])
    const second = await dpxmake.run(ok); expect(second.results[0].ok).toBe(false); expect(readdirSync(out)).toHaveLength(5)
    dpxmake.setDeps(null)
  }, 60000)
})

describe('dpxmake: an element is a cut of its master (source ranges)', () => {
  it('range arithmetic: 123_C is one range from 2 s (master frames 48..113), 123_F is two ranges, out is exclusive', () => {
    const c = dpxmake.rangeFrames([{ in: '00:00:02:00', out: '00:00:04:18' }], { fps: 23.976 })
    expect(c.base).toBe(24); expect(c.rows).toEqual([{ in: '00:00:02:00', out: '00:00:04:18', first_frame: 48, end_frame: 114, frames: 66 }]); expect(c.total).toBe(66); expect(c.select).toBe('between(n\\,48\\,113)')
    const f = dpxmake.rangeFrames([{ in: '00:00:03:01', out: '00:00:03:20' }, { in: '00:00:05:00', out: '00:00:06:00' }])
    expect(f.rows.map((r) => [r.first_frame, r.end_frame - 1, r.frames])).toEqual([[73, 91, 19], [120, 143, 24]]); expect(f.total).toBe(43); expect(f.select).toBe('between(n\\,73\\,91)+between(n\\,120\\,143)')
    expect(dpxmake.rangeFrames([{ in: '01:00:00:02', out: '01:00:00:05' }], { start: '01:00:00:00' }).rows[0]).toMatchObject({ first_frame: 2, frames: 3 })
  })
  it('validates the ranges strictly, before anything runs', async () => {
    const r = (x: { in: string; out: string }[], more: object = {}) => dpxmake.run({ ...ok, items: [{ ...ok.items[0], frames_expected: undefined, source_ranges: x, ...more }] })
    const A = { in: '00:00:02:00', out: '00:00:03:00' }
    for (const x of [[{ in: '2:00', out: '00:00:03:00' }], [{ in: '00:00:02:24', out: '00:00:04:00' }], [{ in: '00:00:03:00', out: '00:00:02:00' }], [{ in: '00:00:02:00', out: '00:00:02:00' }], [A, { in: '00:00:02:10', out: '00:00:05:00' }], [{ in: '00:00:05:00', out: '00:00:06:00' }, A], [], Array.from({ length: 21 }, (_, i) => ({ in: `00:00:${String(i * 2).padStart(2, '0')}:00`, out: `00:00:${String(i * 2).padStart(2, '0')}:05` })), [{ in: '00:00:02:00; rm', out: '00:00:03:00' }]])
      await expect(r(x)).rejects.toMatchObject({ status: 400 })
    await expect(r([A], { frames_expected: 5 })).rejects.toMatchObject({ status: 400 })   // the range is 24 frames
    await expect(r([A], { start_timecode_of_master: '1:00' })).rejects.toMatchObject({ status: 400 })
    await expect(r([A], { start_timecode_of_master: '01:00:00:00' })).rejects.toMatchObject({ status: 400 })   // the range is before the master's start
  })
  it('the script carries the ranges, the master timecode base, the select filter and fps_mode with its fallback; plan shows the master frames', async () => {
    const seen = fake(() => ({ out: good(5), code: 0 }))
    const items = [{ master: MASTER, shot: 'archival-123', element: 'f', source_ranges: [{ in: '00:00:03:01', out: '00:00:03:20' }, { in: '00:00:05:00', out: '00:00:06:00' }], fps: 23.976 }]
    const r = await dpxmake.run({ ...ok, items }); const s = seen[0]
    expect(s).toContain("RANGES=('00:00:03:01-00:00:03:20' '00:00:05:00-00:00:06:00')")
    expect(s).toContain('SEL="${SEL:+$SEL+}between(n\\\\,$A\\\\,$((B-1)))"')
    expect(s).toContain(`'-vf' "select='$SEL',scale=in_range=$RANGE:out_range=pc:in_color_matrix=$MATRIX,format=rgb48le" $VSYNC '-c:v' 'dpx'`)
    expect(s).toContain('VSYNC="-fps_mode passthrough"'); expect(s).toContain('VSYNC="-vsync 0"'); expect(s).toContain('ERR frame count $N, the ranges are $TOTAL frames')
    expect(r.results[0].expected).toBe(43)   // the sum of the ranges
    const p = await dpxmake.plan({ items })
    expect(p.rows[0]).toMatchObject({ frames_expected: 43, select: 'between(n\\,73\\,91)+between(n\\,120\\,143)', last_frame: expect.stringMatching(/\.0042\.dpx$/) }); expect(p.rows[0].ranges?.[1]).toEqual({ in: '00:00:05:00', out: '00:00:06:00', first_frame: 120, end_frame: 144, frames: 24 })
    dpxmake.setDeps(null)
  })
  it('without source_ranges the script is the whole master, as before', async () => {
    const seen = fake(() => ({ out: good(), code: 0 })); await dpxmake.run(ok)
    expect(seen[0]).not.toContain('select='); expect(seen[0]).not.toContain('RANGES=('); dpxmake.setDeps(null)
  })

  const EDL = [
    'TITLE: test', 'FCM: NON-DROP FRAME', '',
    '000001  ARCHIVAL-123_C_FINAL_V01_3840X2160_23.976_PRORES422HQ V     C 00:00:02:00 00:00:04:18 01:00:00:00 01:00:02:18 ', '*FROM CLIP NAME: ARCHIVAL-123_C_FINAL_V01_3840X2160_23.976_PRORES422HQ', '',
    '000002  ARCHIVAL-123_F_FINAL_V01_3840X2160_23.976_PRORES422HQ V     C 00:00:03:01 00:00:03:20 01:00:02:18 01:00:03:13 ', '',
    '000003  ARCHIVAL-123_F_FINAL_V01_3840X2160_23.976_PRORES422HQ V     C 00:00:05:00 00:00:06:00 01:00:03:13 01:00:04:13 ', '',
    '000004  ARCHIVAL-087_A_FINAL_V01_3840X2160_23.976_PRORES422HQ V     C 00:00:00:00 00:00:01:00 01:00:04:13 01:00:05:13 ',
    'M2      ARCHIVAL-087_A_FINAL_V01_3840X2160_23.976_PRORES422HQ          012.0 00:00:00:00', ''].join('\n')
  it('from_edl fills frames, ranges and fps from the loaded EDL, and says to load it when it is not', async () => {
    const d = scratch(); edl.reset()
    await expect(dpxmake.plan({ items: [{ master: MASTER, shot: 'archival-123', element: 'c', from_edl: true }] })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/load it/i) })
    writeFileSync(join(d, 'x.edl'), EDL); await edl.load({ source: { file: join(d, 'x.edl') } })
    const p = await dpxmake.plan({ items: [{ master: MASTER, shot: 'archival-123', element: 'c', from_edl: true }, { master: MASTER, shot: 'archival-123', element: 'f', from_edl: true }] })
    expect(p.rows[0]).toMatchObject({ frames_expected: 66, select: 'between(n\\,48\\,113)' }); expect(p.rows[1]).toMatchObject({ frames_expected: 43, select: 'between(n\\,73\\,91)+between(n\\,120\\,143)' })
    await expect(dpxmake.plan({ items: [{ master: MASTER, shot: 'archival-999', element: 'a', from_edl: true }] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxmake.plan({ items: [{ master: MASTER, shot: 'archival-087', element: 'a', from_edl: true }] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/retime/) })
    const seen = fake(() => ({ out: good(66), code: 0 })); await dpxmake.run({ ...ok, items: [{ master: MASTER, shot: 'archival-123', element: 'c', from_edl: true }] })
    expect(seen[0]).toContain("RANGES=('00:00:02:00-00:00:04:18')"); expect(seen[0]).toContain("EXPECTED='66'"); dpxmake.setDeps(null); edl.reset()
  })

  it.skipIf(!hasFfmpeg)('the whole script unpacks exactly the ranges, in order, contiguous from 0000: the picture bytes equal the selected frames of a whole-master unpack', async () => {
    const d = scratch(), root = join(d, 'comfy-shared'), mdir = join(root, 'temp/m'); mkdirSync(mdir, { recursive: true })
    const enc = (file: string, tc: string[]) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "color=c=black:size=64x48:rate=24,geq=r='N*20+X':g='255-N*20':b='128+Y'", '-frames:v', '12', '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-colorspace', 'bt709', '-color_range', 'tv', ...tc, join(mdir, file)])
    enc('t.mov', []); enc('tc.mov', ['-timecode', '01:00:00:00'])
    const whole = join(d, 'whole'); mkdirSync(whole); execFileSync('ffmpeg', [...dpxmake.ffmpegArgs({ input: join(mdir, 't.mov'), out: join(whole, 'w.%04d.dpx'), matrix: 'bt709', range: 'tv' })])
    expect(readdirSync(whole)).toHaveLength(12)
    const pic = (f: string) => { const b = readFileSync(f), off = b.subarray(0, 4).toString() === 'SDPX' ? b.readUInt32BE(4) : b.readUInt32LE(4); return b.subarray(off).toString('hex') }
    const lines: string[] = []
    dpxmake.setDeps({ target: async () => ({ host: 'x', port: 22 }), outputDir: () => join(root, 'output'), ssh: async ({ script, onLine }) => { const r = spawnSync('bash', ['-s'], { input: script, encoding: 'utf8' }); for (const l of `${r.stdout}${r.stderr}`.split('\n')) if (l) { lines.push(l); onLine?.(l) } return { code: r.status } } })
    const picked = [2, 3, 4, 8, 9]
    // no timecode tag: ranges from 00:00:00:00; the same cut of a master whose own timecode (01:00:00:00) is read from its tag; and with the base given
    const r1 = await dpxmake.run({ ...ok, items: [{ master: 'temp/m/t.mov', shot: 's1', element: 'a', source_ranges: [{ in: '00:00:00:02', out: '00:00:00:05' }, { in: '00:00:00:08', out: '00:00:00:10' }], frames_expected: 5, fps: 24 }, { master: 'temp/m/tc.mov', shot: 's2', element: 'a', source_ranges: [{ in: '01:00:00:02', out: '01:00:00:05' }, { in: '01:00:00:08', out: '01:00:00:10' }] }, { master: 'temp/m/t.mov', shot: 's3', element: 'a', source_ranges: [{ in: '01:00:00:02', out: '01:00:00:05' }, { in: '01:00:00:08', out: '01:00:00:10' }], start_timecode_of_master: '01:00:00:00' }, { master: 'temp/m/t.mov', shot: 's4', element: 'a', source_ranges: [{ in: '00:00:00:08', out: '00:00:00:20' }] }] })
    expect(r1.results.map((x) => [x.shot, x.ok, x.frames])).toEqual([['s1', true, 5], ['s2', true, 5], ['s3', true, 5], ['s4', false, 0]])   // s4 runs past the master's 12 frames: refused; a failed item does not stop the others
    expect(r1.results[3].error).toMatch(/master frames 8\.\.19; the master has 12/)
    expect(r1.results[0].ranges).toEqual([{ in: '00:00:00:02', out: '00:00:00:05', first_frame: 2, end_frame: 5, frames: 3 }, { in: '00:00:00:08', out: '00:00:00:10', first_frame: 8, end_frame: 10, frames: 2 }])
    expect(lines.some((l) => /^NOTE s2_a_\S+ master timecode base 01:00:00:00 \(the master's own timecode tag\)/.test(l))).toBe(true)
    expect(lines.some((l) => /^SELECT s1_a_\S+ between\(n\\,2\\,4\)\+between\(n\\,8\\,9\)$/.test(l))).toBe(true)
    for (const s of ['s1', 's2', 's3']) {
      const out = join(root, 'output', 'mono_v019', s, `${s}_a`, 'dpx'), files = readdirSync(out).sort()
      expect(files).toEqual([0, 1, 2, 3, 4].map((i) => `${s}_a_mono_v019_NOT_RELEASED.${String(i).padStart(4, '0')}.dpx`))
      files.forEach((f, i) => expect(pic(join(out, f)) === pic(join(whole, `w.${String(picked[i]).padStart(4, '0')}.dpx`))).toBe(true))
    }
    expect(new Set(readdirSync(whole).map((f) => pic(join(whole, f)))).size).toBe(12)   // every frame differs, so the comparison means something
    expect(readdirSync(join(root, 'output/mono_v019')).sort()).toEqual(['s1', 's2', 's3']); dpxmake.setDeps(null)
  }, 90000)
})
