import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as edl from '../src/edl.js'
import type * as podpull from '../src/podpull.js'
import { scratch } from './helpers.js'

// The V11 EDL (ADR-050): a small CMX3600 excerpt shaped like the real list (the real one is read from the exchange bucket; no test reaches a network).
const FILE = join(import.meta.dirname, 'fixtures', 'v11-excerpt.edl'), TEXT = readFileSync(FILE, 'utf8')
let dir: string, calls: string[][], fail: string | null
const aws: podpull.AwsRunner = async (args) => { calls.push(args); return fail ? { code: 1, stdout: '', stderr: fail } : { code: 0, stdout: TEXT, stderr: '' } }
const el = (clip: string) => { const m = edl.lookup({ clip }); if (m.match === 'ambiguous' || m.match === 'not-in-edl') throw new Error(`${clip}: ${m.match}`); return m.element }
const byShot = (shot: string, element: string) => { const m = edl.lookup({ shot, element }); return m }

beforeEach(() => { dir = scratch(); edl.reset(); calls = []; fail = null; edl.setDeps({ aws, now: () => Date.parse('2026-11-19T10:00:00Z') }) })
afterEach(() => { edl.reset() })

describe('parse and group per element', () => {
  it('the oracle values of the real V11 list: frames in the cut, speeds, first source-in', async () => {
    await edl.load({ source: { file: FILE } }); expect(edl.status()).toMatchObject({ loaded: true, events: 16, sha256: createHash('sha256').update(TEXT).digest('hex') }); expect(edl.status().elements).toBe(edl.elements().length)
    expect(byShot('enhance-146', 'b')).toMatchObject({ match: 'shot-element', element: { frames_in_cut: 260, speeds: [90], shot: 'enhance-146', element: 'b', kind: 'FINAL', version: 'V01', raster: '3840x2160' } })
    expect(byShot('enhance-231', 'main')).toMatchObject({ element: { frames_in_cut: 247, speeds: [95] } })
    const cr = byShot('creature-266', 'breach-alt1'); expect(cr).toMatchObject({ element: { frames_in_cut: 140, speeds: [500, 80, 500], raster: '1280x720', kind: 'ALT', element: 'breach-alt1', events: 3 } }); expect((cr as { element: edl.EdlElement }).element.frameflex.length).toBe(1); expect((cr as { element: edl.EdlElement }).element.effects[0]).toMatch(/^TIMEWARP EFFECT/)
    expect(byShot('photoreal-013', 'sunlight')).toMatchObject({ element: { frames_in_cut: 212, events: 4 } })   // the 12-frame dissolve row counts its own range; the zero-length cut row counts 0
    expect(byShot('photoreal-013', 'top')).toMatchObject({ element: { first_source_in: '00:00:00:00', frames_in_cut: 209 } })
    expect(byShot('archival-080', 'a')).toMatchObject({ element: { first_source_in: '01:00:00:00', frames_in_cut: 94, kind: 'STILL' } }); expect(byShot('archival-101', 'a')).toMatchObject({ element: { first_source_in: '01:00:00:00', frames_in_cut: 89 } })
    expect(byShot('archival-102', 'main')).toMatchObject({ element: { frames_in_cut: 128 } }); expect(byShot('photoreal-013', 'chasmfast07')).toMatchObject({ element: { speeds: [-100] } })
    const e = el('ENHANCE-146_B_FINAL_V01_3840X2160_23.976_PRORES422HQ'); expect(e).toMatchObject({ record_in: '01:00:00:00', record_out: '01:00:10:20', source_ranges: [{ in: '00:00:00:00', out: '00:00:09:18' }] })
  })
  it('matching: the exact clip name first (case-insensitive, no extension); else shot and element when unique; ambiguous with candidates (never a guess); none is not-in-edl', async () => {
    await edl.load({ source: { file: FILE } })
    expect(edl.lookup({ clip: 'enhance-146_b_final_v01_3840x2160_23.976_prores422hq.MOV' })).toMatchObject({ match: 'exact' })
    expect(edl.lookup({ clip: 'ENHANCE-146_B_FINAL_V09_whatever' })).toMatchObject({ match: 'shot-element', element: { frames_in_cut: 260 } })
    const amb = edl.lookup({ shot: 'carter-reframe', element: 'main' }); expect(amb.match).toBe('ambiguous'); expect((amb as { candidates: edl.EdlElement[] }).candidates.map((c) => c.version).sort()).toEqual(['V01', 'V02'])
    expect(edl.lookup({ clip: 'CARTER-REFRAME_MAIN_FINAL_V02_3840X2160_24_HEVC' })).toMatchObject({ match: 'exact', element: { version: 'V02' } })   // a clip name picks one
    expect(edl.lookup({ clip: 'ARCHIVAL-102_MAIN-B_FINAL_V01_3840X2160_24_X' })).toEqual({ match: 'not-in-edl' }); expect(edl.lookup({ shot: 'nope-001' })).toEqual({ match: 'not-in-edl' }); expect(edl.matchSequence({ name: 'ENHANCE-231_MAIN_FINAL_V01_3840X2160_23.976_PRORES422HQ' })).toMatchObject({ match: 'exact' })
    expect(edl.matchSequence({ name: 'stem', clip_name: 'ENHANCE-146_B_FINAL_V01_3840X2160_23.976_PRORES422HQ' })).toMatchObject({ match: 'exact' }); expect(edl.parseName('ARCHIVAL-077_A_FINAL_V03_3840X2160_23.976_PRORES422HQ')).toMatchObject({ shot: 'archival-077', element: 'a', version: 'V03' })
  })
  it('a file that is not an edit list is a 400; the 121-event size parses without holding the event loop', async () => {
    writeFileSync(join(dir, 'x.edl'), 'hello'); await expect(edl.load({ source: { file: join(dir, 'x.edl') } })).rejects.toMatchObject({ status: 400 })
    const big = Array.from({ length: 121 * 8 }, (_, i) => `${String(i + 1).padStart(6, '0')}  CLIP-${String(i).padStart(3, '0')}_MAIN_FINAL_V01_3840X2160_24_X  V  C  00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00 \n*FROM CLIP NAME: X`).join('\n')
    let worst = 0, last = performance.now(); const t = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last); last = n }, 1); const ev = await edl.parse(big); clearInterval(t); expect(ev).toHaveLength(968); expect(worst).toBeLessThan(300)
  })
})

describe('the source, the cache and offline', () => {
  it('reads the V11 path of the Panama bucket read-only, caches the file and its sha256, and a failed fetch keeps the cached copy (works offline)', async () => {
    const s = await edl.load(); expect(s).toMatchObject({ loaded: true, events: 16 }); expect(s.source).toMatch(/^s3:\/\/.+\/rounds\/tunnel-v11-edl-2026-11-18\/PANAMA 2026_2\.0_v11_110426_COLOR_VFX1\.edl$/)
    expect(calls).toHaveLength(1); expect(calls[0].slice(0, 2)).toEqual(['s3', 'cp']); expect(calls[0][3]).toBe('-'); expect(calls[0].join(' ')).not.toMatch(/\b(rm|mv|sync|put)\b/); expect(existsSync(join(dir, 'edl', 'current.edl'))).toBe(true); expect(JSON.parse(readFileSync(join(dir, 'edl', 'current.json'), 'utf8')).sha256).toBe(s.sha256)
    edl.reset(); edl.setDeps({ aws, now: () => Date.now() }); fail = 'Could not connect to the endpoint URL "https://s3.example/x?sig=1"'; const off = await edl.load(); expect(off).toMatchObject({ loaded: true, events: 16, elements: s.elements }); expect(off.error).toMatch(/could not|Could not/i); expect(off.error).not.toMatch(/https?:/)
    edl.reset(); expect(edl.status()).toMatchObject({ loaded: false, events: 0 }); await edl.ensure(); expect(edl.status().loaded).toBe(true)   // the cache on disk is read at once without the network
    scratch(); edl.reset(); fail = 'boom'; edl.setDeps({ aws }); await expect(edl.load()).rejects.toMatchObject({ status: 502 })   // nothing cached: the failure is the answer
  })
  it('no sync fs and no secret in edl.ts', () => { const src = readFileSync(join(import.meta.dirname, '..', 'src', 'edl.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''); expect(src.match(/\b(readFileSync|writeFileSync|statSync|readdirSync|existsSync|spawnSync|execSync)\b/g) ?? []).toEqual([]) })
})
