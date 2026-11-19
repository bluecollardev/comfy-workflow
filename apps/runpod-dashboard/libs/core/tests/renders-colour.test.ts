import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as renders from '../src/renders.js'
import { scratch } from './helpers.js'

// ADR-048 "Colour details in the plan": the first 2 KB of every sequence's first frame, decoded. Fakes only: a fake pod (ssh), a scratch folder.
let dir: string, shared: string, t: number
let sshCalls: string[], headers: Map<string, Buffer>, sshFail: boolean
const seqN = (i: number, o: Partial<renders.Sequence> = {}): renders.Sequence => ({ dir: `proxy/shot${String(i).padStart(2, '0')}`, name: `ARCHIVAL-${String(100 + i)}_MAIN`, first: 0, last: 9, frames: 10, pad: 4, ...o })
const frame0 = (s: renders.Sequence) => `${s.dir}/${s.name}.${String(s.first).padStart(s.pad, '0')}.dpx`
/** A DPX header as a camera or OCIOWrite writes it, 2048 bytes. */
function dpx(o: { le?: boolean; transfer?: number; colorimetric?: number; descriptor?: number; bits?: number; packing?: number; encoding?: number; width?: number; height?: number; orientation?: number; aspect?: [number, number]; tc?: number; rate?: number; filmRate?: number; offset?: number; fileSize?: number; pixels?: number[] } = {}): Buffer {
  const b = Buffer.alloc(2048), le = !!o.le
  b.write(le ? 'XPDS' : 'SDPX', 0)
  const w16 = (v: number, at: number) => (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at)), w32 = (v: number, at: number) => (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at))
  const wf = (v: number, at: number) => (le ? b.writeFloatLE(v, at) : b.writeFloatBE(v, at))
  w32(o.offset ?? 2048, 4); w32(o.fileSize ?? 1_000_000, 16)   // where the image data starts decides which headers the file has
  w16(o.orientation ?? 0, 768); w32(o.width ?? 3840, 772); w32(o.height ?? 2160, 776)
  b[800] = o.descriptor ?? 50; b[801] = o.transfer ?? 3; b[802] = o.colorimetric ?? 3; b[803] = o.bits ?? 16; w16(o.packing ?? 1, 804); w16(o.encoding ?? 0, 806)
  if (o.aspect) { w32(o.aspect[0], 1628); w32(o.aspect[1], 1632) }
  if (o.tc !== undefined) w32(o.tc, 1920)
  if (o.rate !== undefined) wf(o.rate, 1940)
  if (o.filmRate !== undefined) wf(o.filmRate, 1724)
  if (o.pixels) { b.set(o.pixels, 1664); b.set(o.pixels, 1920); b.set(o.pixels, 1940) }
  return b
}
const put = (s: renders.Sequence, buf: Buffer | null) => { if (buf) headers.set(frame0(s), buf) }
const writeLocal = (s: renders.Sequence, buf: Buffer) => { const p = join(shared, 'output', frame0(s)); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, buf) }

beforeEach(() => {
  dir = scratch(); shared = join(dir, 'shared'); mkdirSync(join(shared, 'output'), { recursive: true }); process.env.RENDERS_FILE = join(dir, 'renders.json'); process.env.HISTORY_FILE = join(dir, 'h.jsonl')
  renders.reset(); t = Date.parse('2026-11-19T10:00:00Z'); sshCalls = []; headers = new Map(); sshFail = false
  renders.setDeps({
    now: () => t, podName: () => 'Pod', volumeId: () => 'volx1', localRoot: () => shared, outputDir: () => '/workspace/comfy-shared/output',
    target: async () => ({ host: 'root@1.2.3.4', port: 22 }),
    ssh: async ({ script, onLine }) => {
      if (script.includes('base64 -w0')) {
        sshCalls.push(script); if (sshFail) throw new Error('ssh: timeout')
        const files = [...script.matchAll(/\[ -r '(.+?)' \]/g)].map((m) => m[1].replace('/workspace/comfy-shared/output/', ''))
        files.forEach((f, k) => { const b = headers.get(f); if (b) onLine(`HDR ${k} ${b.toString('base64')}`) })
      }
      return { code: 0 }
    },
    pull: async () => ({ steps: 1, failed: 0, warned: 0, cancelled: false }), listing: async () => [], emit: async () => undefined,
    findFfmpeg: async () => '/opt/homebrew/bin/ffmpeg', findFfprobe: async () => '/fake/ffprobe', deliverDirs: async () => [], deliverFiles: async () => [],
    spawn: async (_c, args, onLine) => { if (args[0] === '-version') onLine('ffmpeg version 9.0'); return { code: 0 } },
  })
})
afterEach(() => { renders.reset(); delete process.env.RENDERS_FILE })

describe('colourDetails: the code tables and the byte order', () => {
  it('names every transfer and colorimetric code 0-13, and unknown ones as unknown (n)', () => {
    const names = ['user defined', 'printing density', 'linear', 'logarithmic', 'unspecified video', 'SMPTE 240M']
    names.forEach((n, i) => expect(renders.colourDetails(dpx({ transfer: i, colorimetric: i }), false)).toMatchObject({ transfer: i, transfer_name: n, colorimetric: i, colorimetric_name: n }))
    for (const [code, re] of [[6, /709/], [7, /601/], [8, /601/], [9, /NTSC/], [10, /PAL/], [11, /Z linear/], [12, /Z homogeneous/], [13, /ADX/]] as const) expect(renders.colourDetails(dpx({ transfer: code }), false)!.transfer_name).toMatch(re)
    expect(renders.colourDetails(dpx({ transfer: 77, colorimetric: 99 }), false)).toMatchObject({ transfer_name: 'unknown (77)', colorimetric_name: 'unknown (99)' })
  })
  it('descriptor, packing, encoding, size, bits', () => {
    expect(renders.colourDetails(dpx({ descriptor: 50, packing: 0, bits: 10, encoding: 1 }), false)).toMatchObject({ descriptor: 50, descriptor_name: 'RGB', packing_name: 'packed', encoding: 1, bits: 10, width: 3840, height: 2160 })
    expect(renders.colourDetails(dpx({ descriptor: 51, packing: 1 }), false)).toMatchObject({ descriptor_name: 'RGBA', packing_name: 'filled A' }); expect(renders.colourDetails(dpx({ descriptor: 52, packing: 2 }), false)).toMatchObject({ descriptor_name: 'ABGR', packing_name: 'filled B' })
    expect(renders.colourDetails(dpx({ descriptor: 100 }), false)!.descriptor_name).toMatch(/CbYCrY/); expect(renders.colourDetails(dpx({ descriptor: 200, packing: 9 }), false)).toMatchObject({ descriptor_name: 'unknown (200)', packing_name: 'unknown (9)' })
  })
  it('big and little endian read the same values', () => {
    const a = renders.colourDetails(dpx({ transfer: 1, width: 4096, height: 3112, aspect: [1, 1], tc: 0x10203004, rate: 24, orientation: 0 }), false), b = renders.colourDetails(dpx({ le: true, transfer: 1, width: 4096, height: 3112, aspect: [1, 1], tc: 0x10203004, rate: 24, orientation: 0 }), false)
    expect({ ...a, endian: '' }).toEqual({ ...b, endian: '' }); expect(a).toMatchObject({ endian: 'big', width: 4096, height: 3112, pixel_aspect: '1:1', start_timecode: '10:20:30:04', frame_rate_hint: 24, orientation: 0 }); expect(b!.endian).toBe('little')
  })
  it('timecode and frame rate are never invented: unset or invalid is null', () => {
    expect(renders.colourDetails(dpx({ tc: 0xffffffff, rate: NaN }), false)).toMatchObject({ start_timecode: null, frame_rate_hint: null, timecode_note: 'the television header has no valid time code' }); expect(renders.colourDetails(dpx({ tc: 0x25000000, rate: 0 }), false)).toMatchObject({ start_timecode: null, frame_rate_hint: null })
    expect(renders.colourDetails(dpx(), false)!.pixel_aspect).toBeUndefined()
  })
  it('a file shaped like Binc\'s real one (image data at 1664: no film header, no television header) gives NO timecode and NO frame rate, though the pixel bytes at 1664 and 1920 look like valid BCD and a float', () => {
    for (const pixels of [[0x01, 0x02, 0x03, 0x04], [0x12, 0x34, 0x56, 0x59], [0x00, 0x23, 0x23, 0x23], [0x41, 0xc0, 0x00, 0x00] /* 24.0 as a float */]) for (const le of [false, true]) {
      const d = renders.colourDetails(dpx({ le, offset: 1664, pixels }), false)!
      expect(d, `${pixels}`).toMatchObject({ start_timecode: null, frame_rate_hint: null, timecode_note: 'no television header in this file', width: 3840 })
    }
    expect(renders.parseDpxInfo(dpx({ offset: 1664, pixels: [1, 2, 3, 4] }))).toMatchObject({ has_film_header: false, has_tv_header: false, timecode: null, frame_rate: null, data_offset: 1664 })
  })
  it('image data at 2048 with a real television header: the time code at 1920 and the frame rate at 1940, both byte orders, drop-frame honoured', () => {
    for (const le of [false, true]) expect(renders.colourDetails(dpx({ le, tc: 0x01000000, rate: 23.976 }), false)).toMatchObject({ start_timecode: '01:00:00:00', frame_rate_hint: 23.976 })
    expect(renders.colourDetails(dpx({ tc: 0x01000023, rate: 23.976 }), false)!.start_timecode).toBe('01:00:00:23')   // frame 23 is fine, frame 24 is not for 23.976:
    expect(renders.colourDetails(dpx({ tc: 0x01000024, rate: 23.976 }), false)!.start_timecode).toBeNull(); expect(renders.colourDetails(dpx({ tc: 0x01000023, rate: 24 }), false)!.start_timecode).toBe('01:00:00:23')
    expect(renders.colourDetails(dpx({ tc: 0x01000024, rate: 29.97 }), false)!.start_timecode).toBe('01:00:00:24'); expect(renders.colourDetails(dpx({ tc: 0x01000050, rate: 29.97 }), false)!.start_timecode).toBe('01:00:00;10')   // bit 6 of the frames nibble: drop-frame
  })
  it('image data at 1920 (a film header only): no timecode, but the film frame rate is readable', () => {
    expect(renders.colourDetails(dpx({ offset: 1920, filmRate: 24, tc: 0x01000000, rate: 25 }), false)).toMatchObject({ start_timecode: null, frame_rate_hint: 24, timecode_note: 'no television header in this file' })
  })
  it('a corrupt offset (below 1664, or past the file size field) reads neither header', () => {
    for (const offset of [0, 800, 1663, 2_000_000]) expect(renders.colourDetails(dpx({ offset, tc: 0x01000000, rate: 24, filmRate: 24 }), false)).toMatchObject({ start_timecode: null, frame_rate_hint: null, timecode_note: expect.stringMatching(/no valid offset/) })
    expect(renders.parseDpxInfo(dpx({ offset: 1_000_001 }))!.data_offset).toBeNull()
  })
  it('a short, corrupt or non-DPX header is null, and never throws', () => {
    expect(renders.colourDetails(null, false)).toBeNull(); expect(renders.colourDetails(new Uint8Array(100), false)).toBeNull(); expect(renders.colourDetails(Buffer.alloc(2048, 7), true)).toBeNull()
    expect(renders.colourDetails(dpx().subarray(0, 830), false)).toMatchObject({ width: 3840, start_timecode: null, frame_rate_hint: null })   // short but readable
  })
  it('the verdict: log, linear, printing density and ADX are refused for a REVIEW with the field named; a proxy is never refused; display encodings are ok', () => {
    for (const tr of [1, 2, 3, 11, 12, 13]) expect(renders.colourDetails(dpx({ transfer: tr }), true)).toMatchObject({ verdict: 'refused', refusal: expect.stringMatching(/^transfer: .+ \(code \d+\)/) })
    expect(renders.colourDetails(dpx({ transfer: 1 }), true)!.refusal).toMatch(/transfer: printing density/)
    expect(renders.colourDetails(dpx({ transfer: 1 }), false)).toMatchObject({ verdict: 'ok' }); expect(renders.colourDetails(dpx({ transfer: 1 }), false)!.refusal).toBeUndefined()
    for (const tr of [0, 4, 5, 6, 7]) expect(renders.colourDetails(dpx({ transfer: tr }), true)!.verdict).toBe('ok')
    expect(renders.colourDetails(dpx(), false)!.conversion).toMatch(/^none: .*no colour transform applied.*BT\.709/)
  })
})

describe('plan: the header pass covers every sequence', () => {
  const pod = (seqs: renders.Sequence[], o: Record<string, unknown> = {}) => renders.plan({ pod_id: 'p1', sequences: seqs, width: 960, where: 'pod', ...o })
  it('46 sequences no longer skip the header: size and colour show, with at most 2 ssh calls (40 per call), nothing else heavy', async () => {
    const seqs = Array.from({ length: 46 }, (_, i) => seqN(i)); seqs.forEach((s, i) => put(s, dpx(i < 44 ? { transfer: 3, colorimetric: 3 } : { transfer: 6, colorimetric: 6, width: 1920, height: 1080, bits: 10, packing: 0 })))
    const p = await pod(seqs)
    expect(sshCalls).toHaveLength(2); expect(sshCalls[0].match(/base64 -w0/g)).toHaveLength(40); expect(sshCalls[1].match(/base64 -w0/g)).toHaveLength(6)
    expect(p.sequences).toHaveLength(46); expect(p.sequences[0].source).toEqual({ width: 3840, height: 2160, bits: 16 }); expect(p.sequences[0].colour).toMatchObject({ transfer_name: 'logarithmic', descriptor_name: 'RGB', packing_name: 'filled A' }); expect(p.sequences[45].source).toEqual({ width: 1920, height: 1080, bits: 10 })
    expect(p.colour_summary.uniform).toBe(false); expect(p.colour_summary.groups.map((g) => [g.count, g.transfer_name, g.width])).toEqual([[44, 'logarithmic', 3840], [2, 'ITU-R 709-4', 1920]])
    expect(p.source_summary.groups).toEqual([{ width: 3840, height: 2160, bits: 16, count: 44 }, { width: 1920, height: 1080, bits: 10, count: 2 }])
  })
  it('a re-plan within 10 minutes reuses the cache; after that it asks again', async () => {
    const seqs = Array.from({ length: 5 }, (_, i) => seqN(i)); seqs.forEach((s) => put(s, dpx()))
    await pod(seqs); await pod(seqs); expect(sshCalls).toHaveLength(1)
    t += 11 * 60_000; await pod(seqs); expect(sshCalls).toHaveLength(2)
    put(seqN(9), dpx()); await pod([...seqs, seqN(9)]); expect(sshCalls).toHaveLength(3); expect(sshCalls[2].match(/base64 -w0/g)).toHaveLength(1)   // only the new sequence is asked for
  })
  it('a pod that does not answer leaves the plan intact with colour null and a count of unreadable', async () => {
    sshFail = true; const seqs = [seqN(0), seqN(1)]; const p = await pod(seqs)
    expect(p.sequences).toHaveLength(2); expect(p.sequences[0].colour).toBeNull(); expect(p.sequences[0].source).toBeNull(); expect(p.colour_summary).toMatchObject({ groups: [], unreadable: 2, uniform: false })
  })
  it('a corrupt header (not a DPX) is null for that sequence only; the rest still show', async () => {
    const seqs = [seqN(0), seqN(1), seqN(2)]; put(seqs[0], dpx()); put(seqs[1], Buffer.alloc(2048, 9)); put(seqs[2], dpx())
    const p = await pod(seqs); expect(p.sequences.map((s) => s.colour === null)).toEqual([false, true, false]); expect(p.colour_summary).toMatchObject({ unreadable: 1, uniform: false }); expect(p.colour_summary.groups[0].count).toBe(2)
  })
  it('uniform: one group when every sequence says the same', async () => {
    const seqs = Array.from({ length: 3 }, (_, i) => seqN(i)); seqs.forEach((s) => put(s, dpx())); const p = await pod(seqs)
    expect(p.colour_summary).toMatchObject({ uniform: true, unreadable: 0 }); expect(p.colour_summary.groups).toHaveLength(1); expect(p.colour_summary.groups[0].key).toBeTruthy()
  })
  it('a review is refused on colour with the precise reason per sequence and per group; a proxy plan never refuses', async () => {
    const s = seqN(0); put(s, dpx({ transfer: 1, colorimetric: 1 }))
    const r = await pod([s], { kind: 'review' }); expect(r.sequences[0].colour).toMatchObject({ verdict: 'refused', refusal: expect.stringMatching(/transfer: printing density/) }); expect(r.sequences[0].colour_refusal).toMatch(/transfer: printing density/); expect(r.colour_summary.groups[0]).toMatchObject({ verdict: 'refused', refusal: expect.stringContaining('printing density') })
    const q = await pod([s]); expect(q.sequences[0].colour).toMatchObject({ verdict: 'ok' }); expect(q.sequences[0].colour_refusal).toBeUndefined()
  })
  it('concurrent plans make one ssh call at a time', async () => {
    let live = 0, max = 0
    renders.setDeps({ ssh: async ({ script, onLine }) => { if (!script.includes('base64 -w0')) return { code: 0 }; live++; max = Math.max(max, live); await new Promise((r) => setTimeout(r, 15)); onLine(`HDR 0 ${dpx().toString('base64')}`); live--; return { code: 0 } } })
    await Promise.all([pod([seqN(0)]), pod([seqN(1)]), pod([seqN(2)])]); expect(max).toBe(1)
  })
  it('on this PC: the header comes from a file read, cached by path, size and mtime', async () => {
    const seqs = [seqN(0), seqN(1)]; seqs.forEach((s) => writeLocal(s, dpx({ transfer: 6, colorimetric: 6, bits: 10, width: 1920, height: 1080 })))
    const loc = () => renders.plan({ sequences: seqs, width: 960, where: 'local' })
    let p = await loc(); expect(p.sequences[0].colour).toMatchObject({ transfer_name: 'ITU-R 709-4', width: 1920 }); expect(p.source_summary.groups).toEqual([{ width: 1920, height: 1080, bits: 10, count: 2 }]); expect(sshCalls).toHaveLength(0)
    writeLocal(seqs[0], dpx({ transfer: 3 })); utimesSync(join(shared, 'output', frame0(seqs[0])), new Date(t + 5000), new Date(t + 5000))   // changed on disk: not served from the cache
    p = await loc(); expect(p.sequences[0].colour!.transfer_name).toBe('logarithmic'); expect(p.sequences[1].colour!.transfer_name).toBe('ITU-R 709-4')
    const gone = await renders.plan({ sequences: [seqN(30)], width: 960, where: 'local' }); expect(gone.sequences[0].colour).toBeNull()
  })
})

describe('plan().warnings is always there (the Tunnel preset flags a source that is not display-referred; it is tagged, never converted)', () => {
  it('an array on every plan; the Tunnel preset names a log source; the preset and a plain proxy plan both carry it', async () => {
    const s = seqN(0); put(s, dpx({ transfer: 3 })); const plain = await renders.plan({ pod_id: 'p1', sequences: [s], width: 960, where: 'pod' }); expect(plain.warnings).toEqual([]); expect(plain.preset).toBe('none')
    const t = await renders.plan({ pod_id: 'p1', sequences: [s], where: 'pod', preset: 'tunnel' }); expect(t.preset).toBe('tunnel'); expect(t.warnings).toHaveLength(1); expect(t.warnings[0]).toMatch(/logarithmic.*converted from the colour you chose \(not set\)/); expect(t.sequences[0].colour!.conversion).toBe('Rec.709 view converted from the colour you choose (colour_in), not from this header; header transfer: logarithmic')
    const ok = seqN(1); put(ok, dpx({ transfer: 6, colorimetric: 6 })); expect((await renders.plan({ pod_id: 'p1', sequences: [ok], where: 'pod', preset: 'tunnel' })).warnings).toEqual([])
  })
})

describe('the Tunnel preset against the EDL (ADR-050)', () => {
  const E146 = 'ENHANCE-146_B_FINAL_V01_3840X2160_23.976_PRORES422HQ'
  it('plan rows carry flags[], expected_frames, edl_element, the resolved start_timecode with its source and suggested_colour; blocked rows are not counted to render; start refuses when none can be taken', async () => {
    const edl = await import('../src/edl.js'), { join } = await import('node:path'); edl.reset(); await edl.load({ source: { file: join(import.meta.dirname, 'fixtures', 'v11-excerpt.edl') } })
    try {
      const a = seqN(0, { name: E146, frames: 260, last: 259, colour_in: 'p3-d65-gamma26' }), b = seqN(1, { name: 'CORROSION-012_MAIN' }), c = seqN(2, { name: E146, dir: 'proxy/shot09', frames: 234, last: 233, colour_in: 'p3-d65-srgb' })
      for (const x of [a, b, c]) put(x, dpx())
      const t = await renders.plan({ pod_id: 'p1', sequences: [a, b, c], where: 'pod', preset: 'tunnel' }), [ra, rb, rc] = t.sequences
      expect(ra).toMatchObject({ start_timecode: '00:00:00:00', timecode_source: 'EDL', expected_frames: 260, blocked: false, flags: [], edl_element: { clip: E146, speeds: [90] } })
      expect(rb).toMatchObject({ blocked: true, start_timecode: null, suggested_colour: 'kodak-log' }); expect(rb.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['no-start-timecode', 'colour-not-set', 'not-in-edl']))
      expect(rc.flags).toEqual([{ code: 'frames-differ-from-edl', level: 'block', message: '234 frames, the EDL cut has 260 (speeds 90%): the DPX must carry the retime' }]); expect(t.totals.blocked).toBe(2); expect(t.totals.to_render).toBe(1); expect(t.edl).toMatchObject({ loaded: true })
      const o = await renders.plan({ pod_id: 'p1', sequences: [c], where: 'pod', preset: 'tunnel', edl_override: { [E146]: true } }); expect(o.sequences[0].blocked).toBe(false)
      await expect(renders.start({ pod_id: 'p1', sequences: [b], where: 'pod', preset: 'tunnel' })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^Refused: CORROSION-012_MAIN: .*Colour not set/) })
      const plain = await renders.plan({ pod_id: 'p1', sequences: [a], width: 960, where: 'pod' }); expect(plain.sequences[0].flags).toEqual([])   // outside the Tunnel preset the EDL says nothing blocking
    } finally { edl.reset() }
  })
})
