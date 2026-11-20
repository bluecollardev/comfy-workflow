import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as dpxfix from '../src/dpxfix.js'
import { scratch } from './helpers.js'

/** A DPX of the pipeline: big-endian, the header says linear (2/2), no timecode, the picture bytes are a marker. */
const dpx = (i: number, le = false) => {
  const b = Buffer.alloc(2048 + 64); b.write(le ? 'XPDS' : 'SDPX', 0)
  const w32 = (o: number, v: number) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o))
  w32(4, 2048); w32(772, 4); w32(776, 4); b[801] = 2; b[802] = 2; b[803] = 16
  b.write(`old_name.${i}.dpx`, 36); for (let k = 0; k < 64; k++) b[2048 + k] = (i * 7 + k) & 255
  return b
}
const run = (src: string, out: string, clip: string, tc: string, fps: number) => execFileSync('python3', ['-', src, out, clip, tc, String(fps)], { input: dpxfix.PYTHON, encoding: 'utf8' })

describe('dpxfix: corrected copies of the DPX frames', () => {
  it('writes copies with the colour code user-defined, the timecode, the frame rate and the gamma; the picture bytes and the originals are untouched', () => {
    const d = scratch('dpxfix'), src = join(d, 'src'), out = join(d, 'out'); mkdirSync(src)
    for (let i = 0; i < 3; i++) writeFileSync(join(src, `x_mono.${String(i).padStart(4, '0')}.dpx`), dpx(i))
    const log = run(src, out, 'ARCHIVAL-080_A_STILL_V01_6336X2688_PNG', '01:00:00:22', 23.976)
    expect(log).toMatch(/CHECK ARCHIVAL-080_A_STILL_V01_6336X2688_PNG 3\/3 headers right/)
    expect(readdirSync(out).sort()).toEqual([0, 1, 2].map((i) => `ARCHIVAL-080_A_STILL_V01_6336X2688_PNG.${String(i).padStart(4, '0')}.dpx`))
    const f = (i: number) => readFileSync(join(out, `ARCHIVAL-080_A_STILL_V01_6336X2688_PNG.${String(i).padStart(4, '0')}.dpx`))
    const h = f(0)
    expect([h[801], h[802], h[803]]).toEqual([0, 0, 16])   // user-defined, user-defined; the bit depth stays
    expect(h.subarray(1920, 1924).toString('hex')).toBe('01000022')   // 01:00:00:22 as BCD HHMMSSFF
    expect(f(1).subarray(1920, 1924).toString('hex')).toBe('01000023'); expect(f(2).subarray(1920, 1924).toString('hex')).toBe('01000100')   // 23 frames to a second: 22, 23, then 01:00:01:00
    expect(h.readFloatBE(1940)).toBeCloseTo(23.976, 3); expect(h.readFloatBE(1948)).toBeCloseTo(2.6, 5); expect(h.readFloatBE(1724)).toBeCloseTo(23.976, 3)
    expect([h.readUInt32BE(1712), h.readUInt32BE(1716)]).toEqual([1, 3]); expect(f(2).readUInt32BE(1712)).toBe(3)
    expect(h.subarray(36, 36 + 'ARCHIVAL-080_A_STILL_V01_6336X2688_PNG.0000.dpx'.length).toString()).toBe('ARCHIVAL-080_A_STILL_V01_6336X2688_PNG.0000.dpx')
    expect(h.subarray(2048).equals(dpx(0).subarray(2048))).toBe(true)   // the picture is byte for byte
    expect(readFileSync(join(src, 'x_mono.0000.dpx'))[801]).toBe(2)     // the original still says linear: it is never changed
  })
  it('a little-endian DPX is patched in its own byte order', () => {
    const d = scratch('dpxfix-le'), src = join(d, 'src'), out = join(d, 'out'); mkdirSync(src); writeFileSync(join(src, 'a.0000.dpx'), dpx(0, true))
    run(src, out, 'CLIP', '00:00:00:00', 24); const h = readFileSync(join(out, 'CLIP.0000.dpx'))
    expect(h.readFloatLE(1940)).toBeCloseTo(24, 5); expect(h.readFloatLE(1948)).toBeCloseTo(2.6, 5); expect(h.subarray(1920, 1924).toString('hex')).toBe('00000000')
  })
  it('refuses what is not a DPX and a folder with no frames, and checks its input before it runs anything', async () => {
    const d = scratch('dpxfix-bad'), src = join(d, 'src'), out = join(d, 'out'); mkdirSync(src); writeFileSync(join(src, 'a.0000.dpx'), Buffer.alloc(3000))
    expect(() => run(src, out, 'CLIP', '00:00:00:00', 24)).toThrow()
    const ok = { pod_id: 'p', approved_by: 'L', items: [{ src_dir: 'mono_v015/x/y/dpx', clip: 'CLIP', start_timecode: '00:00:00:00' }] }
    await expect(dpxfix.run({ ...ok, approved_by: '' })).rejects.toMatchObject({ status: 400 })
    await expect(dpxfix.run({ ...ok, items: [{ ...ok.items[0], src_dir: '../etc' }] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxfix.run({ ...ok, items: [{ ...ok.items[0], clip: 'a; rm -rf /' }] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxfix.run({ ...ok, items: [{ ...ok.items[0], start_timecode: '1:00' }] })).rejects.toMatchObject({ status: 400 })
  })
  it('sends the script to the pod once per clip and reports a clip whose headers did not check as not ok', async () => {
    const seen: string[] = []
    dpxfix.setDeps({ target: async () => ({ host: 'root@1.2.3.4', port: 22 }), outputDir: () => '/workspace/comfy-shared/output', ssh: async ({ script, onLine }) => { seen.push(script); onLine?.('FRAMES A 2/2'); onLine?.(seen.length === 1 ? 'CHECK A 2/2 headers right' : 'CHECK B 1/2 headers right'); return { code: seen.length === 1 ? 0 : 3 } } })
    const r = await dpxfix.run({ pod_id: 'p', approved_by: 'L', items: [{ src_dir: 'mono_v015/a/a_x/dpx', clip: 'A', start_timecode: '01:00:00:00' }, { src_dir: 'mono_v015/b/b_x/dpx', clip: 'B', start_timecode: '00:00:00:00', fps: 24 }] })
    expect(seen).toHaveLength(2); expect(seen[0]).toContain("'/workspace/comfy-shared/output/mono_v015/a/a_x/dpx' '/workspace/comfy-shared/output/_delivery_v11/A' 'A' '01:00:00:00' '23.976'")
    expect(r.results.map((x) => [x.clip, x.ok, x.out_dir])).toEqual([['A', true, '_delivery_v11/A'], ['B', false, '_delivery_v11/B']]); dpxfix.setDeps(null)
  })
  it('plan refuses an empty list and a folder that is not plain, before it asks anything', async () => {
    await expect(dpxfix.plan({ items: [] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxfix.plan({ items: [{ src_dir: '../etc' }] })).rejects.toMatchObject({ status: 400 })
    await expect(dpxfix.plan({ items: [{ src_dir: '/abs/path' }] })).rejects.toMatchObject({ status: 400 })
  })
})
