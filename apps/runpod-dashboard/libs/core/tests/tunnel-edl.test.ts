import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import * as edl from '../src/edl.js'
import * as tunnel from '../src/tunnel.js'
import * as renders from '../src/renders.js'
import * as mounts from '../src/mounts.js'
import * as configio from '../src/configio.js'
import { scratch } from './helpers.js'

const FILE = join(import.meta.dirname, 'fixtures', 'v11-excerpt.edl')
const E146 = 'ENHANCE-146_B_FINAL_V01_3840X2160_23.976_PRORES422HQ', CR = 'CREATURE-266_BREACH-ALT1_FINAL_V01_1280X720_24_H264'
let dir: string
beforeEach(async () => { dir = scratch(); edl.reset(); await edl.load({ source: { file: FILE } }) })
afterEach(() => edl.reset())
const a = (o: Partial<tunnel.AssessIn> & { name: string; frames: number }) => tunnel.assess({ strict: true, needColour: true, colour_in: 'p3-d65-gamma26', ...o })
const codes = (x: tunnel.Assessment) => x.flags.map((f) => `${f.level}:${f.code}`)

describe('start timecode: field, then DPX header, then the EDL source-in of the first event, never a default', () => {
  it('precedence and its source', () => {
    expect(a({ name: E146, frames: 260, start_timecode: '02:00:00:00', header_tc: '03:00:00:00' })).toMatchObject({ start_timecode: '02:00:00:00', timecode_source: 'sequence field' })
    expect(a({ name: E146, frames: 260, header_tc: '03:00:00:00' })).toMatchObject({ start_timecode: '03:00:00:00', timecode_source: 'DPX header' })
    expect(a({ name: E146, frames: 260, header_tc: '03:00:00;00' })).toMatchObject({ start_timecode: '00:00:00:00', timecode_source: 'EDL' })   // a drop-frame header value is not valid here
    expect(a({ name: 'ARCHIVAL-080_A_STILL_V01_3840X2160_24_PNG', frames: 94 })).toMatchObject({ start_timecode: '01:00:00:00', timecode_source: 'EDL', flags: [] })
  })
  it('none anywhere (not in the EDL, no EDL): the sequence is flagged and blocked, no default value', async () => {
    const x = a({ name: 'ZZZ-001_MAIN_FINAL_V01', frames: 10 }); expect(x).toMatchObject({ start_timecode: null, timecode_source: null, blocked: true }); expect(codes(x)).toEqual(expect.arrayContaining(['block:no-start-timecode', 'block:not-in-edl']))
    expect(x.flags.find((f) => f.code === 'no-start-timecode')!.message).toBe('No start timecode: set it or load the EDL'); expect(x.flags.find((f) => f.code === 'not-in-edl')!.message).toBe('Not in the V11 EDL: do not deliver')
    edl.reset(); const y = a({ name: E146, frames: 260 }); expect(codes(y)).toEqual(['warn:no-edl', 'block:no-start-timecode']); expect(y.flags[0].message).toBe('No EDL loaded'); expect(a({ name: E146, frames: 260, header_tc: '01:00:00:00' }).blocked).toBe(false)   // the header still works without the EDL
  })
  it('a stored render.start_timecode_default is ignored and dropped on the next save', () => {
    mounts.save({ ...mounts.defaults(), render: { ...mounts.defaults().render, start_timecode_default: '09:09:09:09' } as never }); const r = mounts.load().render as unknown as Record<string, unknown>
    expect('start_timecode_default' in r).toBe(false); mounts.save(mounts.load()); expect(JSON.stringify(mounts.load())).not.toMatch(/start_timecode_default/); expect(() => mounts.validate({ ...mounts.load(), render: { ...mounts.load().render, start_timecode_default: 'x' } as never })).not.toThrow()
  })
})

describe('frames against the EDL, what is not in it, the raster', () => {
  it('a different frame count blocks with the retime message and the speeds; an override lets it through and records the note and the override', () => {
    const x = a({ name: E146, frames: 234 }); expect(x).toMatchObject({ expected_frames: 260, blocked: true, edl_element: { clip: E146, speeds: [90], frames_in_cut: 260 } }); expect(x.flags.find((f) => f.code === 'frames-differ-from-edl')).toEqual({ code: 'frames-differ-from-edl', level: 'block', message: '234 frames, the EDL cut has 260 (speeds 90%): the DPX must carry the retime' })
    const o = a({ name: E146, frames: 234, override: true }); expect(o.blocked).toBe(false); expect(o.notes).toContain('EDL override: 234 frames vs 260 in the cut'); expect(o.overridden).toEqual({ stem: E146, frames: 234, expected: 260 }); expect(a({ name: E146, frames: 260 }).flags).toEqual([])
    expect(a({ name: CR, frames: 108 }).flags.find((f) => f.code === 'frames-differ-from-edl')!.message).toBe('108 frames, the EDL cut has 140 (speeds 500%, 80%, 500%): the DPX must carry the retime')
  })
  it('not in the EDL has no override; ambiguous asks for the clip name; a 1280x720 source warns and is noted', () => {
    const n = a({ name: 'ARCHIVAL-102_MAIN-B_FINAL_V01_3840X2160_24_X', frames: 128, override: true, start_timecode: '01:00:00:00' }); expect(n.blocked).toBe(true); expect(codes(n)).toContain('block:not-in-edl')
    const m = a({ name: 'CARTER-REFRAME_MAIN_FINAL_V09_X', frames: 72, start_timecode: '01:00:00:00' }); expect(m).toMatchObject({ edl_match: 'ambiguous', blocked: true }); expect(m.candidates!.length).toBe(2); expect(codes(m)).toContain('block:ambiguous-edl-element'); expect(a({ name: 'CARTER-REFRAME_MAIN_FINAL_V02_3840X2160_24_HEVC', frames: 72 }).blocked).toBe(false)
    const low = a({ name: CR, frames: 140 }); expect(low.blocked).toBe(false); expect(low.flags).toEqual([{ code: 'low-source-resolution', level: 'warn', message: 'the source is 1280x720: flag if the 4K is not usable' }]); expect(low.notes).toContain('the source is 1280x720: flag if the 4K is not usable')
  })
  it('colour must be chosen (no default); corrosion suggests Kodak log and never applies it', () => {
    const c = tunnel.assess({ name: 'CORROSION-012_MAIN', frames: 5, start_timecode: '01:00:00:00', strict: true, needColour: true }); expect(codes(c)).toContain('block:colour-not-set'); expect(c).toMatchObject({ suggested_colour: 'kodak-log', colour_in: null })
    expect(a({ name: E146, frames: 260 }).suggested_colour).toBeNull(); expect(() => tunnel.validateColourIn('rec709')).toThrow(/colour_in is one of/); expect(tunnel.validateColourIn(undefined)).toBeUndefined()
  })
})

describe('the proxy is a converted Rec.709 view, per colour', () => {
  const seq = { dir: 'd', name: 'S', first: 1, last: 3, frames: 3, pad: 4 }
  const vf = (c: tunnel.ColourIn | null) => { const args = renders.ffmpegArgs(seq, 'tunnel', { outputDir: '/o', frames: 3, dims: { width: 3840, height: 2160 }, colourIn: c }); return { args, vf: args[args.indexOf('-vf') + 1] } }
  it('the argument chain per colour: linearise with the named transfer, P3 to 709 matrix, 709 transfer, limited YUV tagged bt709; log is only tagged; DPX frames are never converted', () => {
    const g26 = vf('p3-d65-gamma26'); expect(g26.vf).toMatch(/^scale=1920:1080:flags=lanczos,format=gbrp16le,lutrgb=.*pow\(val\/maxval,2\.6\).*colorchannelmixer=rr=1\.2249401.*bb=1\.0982735,lutrgb=.*1\.099\*pow.*,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p$/)
    expect(vf('p3-d65-gamma22').vf).toMatch(/pow\(val\/maxval,2\.2\)/); expect(vf('p3-d65-srgb').vf).toMatch(/12\.92.*2\.4/)
    const log = vf('kodak-log'); expect(log.vf).toBe('scale=1920:1080:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p'); expect(log.vf).not.toMatch(/lutrgb|colorchannelmixer/)
    for (const c of ['p3-d65-gamma26', 'kodak-log'] as const) { const { args } = vf(c); expect(args).toEqual(expect.arrayContaining(['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-pix_fmt', 'yuv420p'])); expect(args.join(' ')).not.toMatch(/\.dpx'?\s+-vf.*-c:v dpx/) }
    expect(tunnel.colourBlock('p3-d65-gamma26')).toEqual({ working_space: 'P3-D65', transfer: 'gamma 2.6', proxy: 'Rec.709 view (converted)' }); expect(tunnel.colourBlock('p3-d65-srgb').transfer).toBe('sRGB'); expect(tunnel.colourBlock('p3-d65-gamma22').transfer).toBe('gamma 2.2'); expect(tunnel.colourBlock('kodak-log')).toEqual({ working_space: 'Kodak log', transfer: 'log', proxy: 'tagged only (log)' })
  })
  let ffmpeg = true; try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { ffmpeg = false }
  // zscale is not in the local ffmpeg and `colorspace` takes neither RGB nor gamma 2.6, so the chain is lutrgb + colorchannelmixer + lutrgb (see tunnel.ts)
  it.skipIf(!ffmpeg)('the real local ffmpeg converts a synthetic P3-D65 frame to the Rec.709 view an independent calculation gives (within 2 of 255)', () => {
    const M = tunnel.P3_TO_709, oetf = (x: number) => (x < 0.018 ? 4.5 * x : 1.099 * x ** 0.45 - 0.099), dec = (v: number) => v ** 2.6
    for (const rgb of [[255, 0, 0], [128, 128, 128], [128, 64, 64]]) {
      const chain = [...tunnel.colourFilters('p3-d65-gamma26')!, 'scale=out_color_matrix=bt709:out_range=tv', 'format=yuv420p'].join(',')
      const out = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}:s=64x64:r=1:d=1`, '-frames:v', '1', '-vf', chain, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], { maxBuffer: 1 << 20 })
      const lin = rgb.map((v) => dec(v / 255)), e = [0, 1, 2].map((i) => oetf(Math.min(1, Math.max(0, M[i][0] * lin[0] + M[i][1] * lin[1] + M[i][2] * lin[2]))))
      const y = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2], want = [16 + 219 * y, 128 + 224 * ((e[2] - y) / 1.8556), 128 + 224 * ((e[0] - y) / 1.5748)], got = [out[0], out[64 * 64], out[64 * 64 + 32 * 32]]
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(2)
    }
  })
})

describe('an import never switches on spend', () => {
  it('auto_publish.generate enabled or where: pod comes in OFF and local, with a note in the plan', () => {
    mounts.save(mounts.defaults())
    const file = { ...configio.exportConfig({ includeSecrets: false }), config: { ...(configio.exportConfig({ includeSecrets: false }) as { config: object }).config, auto_publish: { enabled: true, generate: { enabled: true, where: 'pod', settle_minutes: 7 } } } }
    const plan = configio.planImport(file as never) as { sections: { key: string; note?: string | null }[] }; expect(plan.sections.find((s) => s.key === 'pod_defaults')?.note).toMatch(/Auto-generate will be imported turned OFF/)
    configio.applyImport(file as never, { sections: ['pod_defaults'] }); expect(mounts.load().auto_publish!.generate).toMatchObject({ enabled: false, where: 'local', settle_minutes: 7 }); expect(mounts.load().auto_publish!.enabled).toBe(false)
  })
})

describe('a stated colour lets log and linear frames through (policy/colour.md: stated by a person, never guessed)', () => {
  const seq = { dir: 'd', name: 'S', first: 1, last: 3, frames: 3, pad: 4 }, vf = (c: tunnel.ColourIn | null, codec?: 'prores422hq') => { const a = renders.ffmpegArgs(seq, 'source', { outputDir: '/o', frames: 3, quality: 'review', codec: codec ?? 'h264', colourIn: c }); return { a, vf: a[a.indexOf('-vf') + 1] } }
  it('the chains: linear-p3-d65 = P3 to 709 matrix then the 709 transfer; linear-rec709 = the transfer only; a review without a stated colour has no conversion', () => {
    expect(vf('linear-p3-d65').vf).toMatch(/^format=gbrp16le,colorchannelmixer=rr=1\.2249401.*,lutrgb=.*1\.099\*pow.*,scale=out_color_matrix=bt709,format=yuv420p$/); expect(vf('linear-p3-d65').vf).not.toMatch(/pow\(val\/maxval,2/)
    expect(vf('linear-rec709').vf).toMatch(/^format=gbrp16le,lutrgb=.*1\.099\*pow.*,scale=out_color_matrix=bt709,format=yuv420p$/); expect(vf('linear-rec709').vf).not.toMatch(/colorchannelmixer/)
    expect(vf(null).vf).toBe('scale=out_color_matrix=bt709,format=yuv420p'); expect(vf('linear-p3-d65', 'prores422hq').vf).toMatch(/yuv422p10le$/); expect(vf('linear-p3-d65').a).toEqual(expect.arrayContaining(['-color_primaries', 'bt709', '-color_trc', 'bt709']))
    expect(tunnel.colourBlock('linear-p3-d65')).toEqual({ working_space: 'Linear P3-D65', transfer: 'linear', proxy: 'Rec.709 view (converted)' }); expect(tunnel.colourBlock('linear-rec709').working_space).toBe('Linear Rec.709')
    expect(() => renders.validateSequence({ ...seq, colour_in: 'rec709' })).toThrow(/colour_in is one of/); expect(renders.validateSequence({ ...seq, colour_in: 'linear-rec709' }).colour_in).toBe('linear-rec709')
  })
  it('the refusal carries the hint; generate.colour_in is validated, needs a name to state, is recorded, and an import keeps it', () => {
    const h = { transfer: 2, colorimetric: 2 } as never; expect(renders.colourRefusal(h)).toMatch(/linear \(code 2\).*State the colour of these frames \(Generate window: Colour\)\./)
    const base = mounts.load(), put = (g: Record<string, unknown>, who?: string) => mounts.put({ ...base, auto_publish: { ...base.auto_publish, ...(who ? { approved_by: who } : {}), generate: { ...base.auto_publish!.generate, ...g } } as never })
    expect(() => put({ colour_in: 'linear-p3-d65' })).toThrow(/Stating the colour of frames is a person's act/); expect(() => put({ colour_in: 'rec2020' }, 'Lucas')).toThrow(/colour_in is empty or one of/)
    put({ colour_in: 'linear-p3-d65' }, 'Lucas'); expect(mounts.load().auto_publish!.generate.colour_in).toBe('linear-p3-d65'); expect(JSON.stringify(mounts.load())).not.toMatch(/Lucas/)
    const f = configio.exportConfig({ includeSecrets: false }); mounts.save(mounts.defaults()); configio.applyImport(f as never, { sections: ['pod_defaults'] }); expect(mounts.load().auto_publish!.generate.colour_in).toBe('linear-p3-d65'); expect(mounts.defaults().auto_publish!.generate.colour_in).toBeNull()
  })
})
