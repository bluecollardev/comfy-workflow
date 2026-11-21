import { describe, expect, it } from 'vitest'
import * as layout from '../src/publishlayout.js'

describe('issuesOf with facts: frame count, colour, rate and stray files', () => {
  const item = (delivered = 'ARCHIVAL-087_RAIN_FINAL_V01_3840X2160_23.976_PRORES422HQ', frames = 96) => ({ shot: 'archival-087', element: 'RAIN', input_final: { delivered_name: delivered, sha256: 'x' }, graph: { name: 'n/a', sha256: 'n/a', returned_path: 'n/a' },
    outputs: [{ path: 'archival-087/C/C.0000.dpx', role: 'dpx', sha256: 'x', bytes: 5 }, { path: 'archival-087/C/C.0001.dpx', role: 'dpx', sha256: 'x', bytes: 5 }, { path: 'archival-087/C.mov', role: 'review', sha256: 'x', bytes: 1 }, { path: 'archival-087/C.mp4', role: 'proxy-h264', sha256: 'x', bytes: 1 }], measures: { kind: 'FINAL delivery', frames, notes: '' } }) as never
  const ok = { colour_in: 'p3-d65-gamma26', colour_source: 'ocio-record', fps: '23.976' }
  it('is empty when every fact agrees', () => { expect(layout.issuesOf(item(), { expected_frames: 96, reviews: [ok], current_colour_in: 'p3-d65-gamma26', strays: [] })).toEqual([]) })
  it('raises a frame-count mismatch with both numbers, only when the cut is known', () => {
    const i = layout.issuesOf(item(undefined, 94), { expected_frames: 96, reviews: [ok] })
    expect(i).toHaveLength(1); expect(i[0]).toMatchObject({ code: 'frame-count-mismatch', severity: 'warning' }); expect(i[0].text).toContain('94'); expect(i[0].text).toContain('96')
    expect(layout.issuesOf(item(undefined, 94), { reviews: [ok] })).toEqual([]); expect(layout.issuesOf(item(undefined, 94), { expected_frames: null, reviews: [ok] })).toEqual([])
  })
  it('says the colour is unstated only when a review exists and records none', () => {
    expect(layout.issuesOf(item(), { reviews: [{ fps: '23.976' }] }).map((x) => x.code)).toEqual(['colour-unstated'])
    expect(layout.issuesOf(item(), { reviews: [] })).toEqual([])
  })
  it('raises header-disagrees, a review made under another colour, and a different rate', () => {
    expect(layout.issuesOf(item(), { reviews: [{ ...ok, header_disagrees: true, ocio_label: 'Gamma 2.6 P3-D65' }] }).map((x) => x.code)).toEqual(['header-disagrees-record'])
    expect(layout.issuesOf(item(), { reviews: [ok], current_colour_in: 'linear-p3-d65' }).map((x) => x.code)).toEqual(['review-colour-differs'])
    expect(layout.issuesOf(item(), { reviews: [{ ...ok, fps: '24' }] }).map((x) => x.code)).toEqual(['review-fps-differs'])
    expect(layout.issuesOf(item('PHOTOREAL-013_ASCENT_FINAL_V01_1920X1080_24_HEVC'), { reviews: [{ ...ok, fps: '24' }] })).toEqual([])
  })
  it('does not compare colour when nothing is stated for this publish', () => { expect(layout.issuesOf(item(), { reviews: [ok] })).toEqual([]) })
  it('finds DPX in the element folder that are not its own, with their sizes', () => {
    const root = 'returns/BKK/r/', listing = new Map<string, number>([[`${root}archival-087/C/C.0000.dpx`, 5], [`${root}archival-087/C/C.0001.dpx`, 5], [`${root}archival-087/C/C.0002.dpx`, 49768448], [`${root}archival-087/other/Z.0000.dpx`, 5], [`${root}archival-087/C/notes.txt`, 3]])
    const s = layout.straysOf(item(), listing, root)
    expect(s).toEqual([{ name: 'C.0002.dpx', bytes: 49768448 }])
    const i = layout.issuesOf(item(), { reviews: [ok], strays: s }); expect(i.map((x) => x.code)).toEqual(['stray-files']); expect(i[0].text).toContain('49768448')
  })
})

describe('roundIssuesOf: elements with no frames, with the failure on record', () => {
  const fail = { shot: 'photoreal-013', element: 'F23', graph: 'photoreal-013_f23', stage: 'execute', node: '14 (VAEDecodeTiled)', message: 'exit code 137: out of memory', recovery: 'Memory ran out: use a smaller chunk.', retryable: false, retries: 4, at: '2026-11-21T05:34:58Z', pod: 'p1' }
  it('lists an expected element that was not delivered, with the failure fields', () => {
    const r = layout.roundIssuesOf([{ shot: 'photoreal-013', element: 'F23' }, { shot: 'photoreal-013', element: 'ASCENT' }], [{ shot: 'photoreal-013', element: 'ASCENT' }], [fail])
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ shot: 'photoreal-013', element: 'F23', code: 'not-generated', severity: 'warning', failure: { stage: 'execute', node: '14 (VAEDecodeTiled)', attempts: 5, retryable: false, pod: 'p1' } })
    expect(r[0].text).toContain('137'); expect(r[0].text).toContain('smaller chunk')
  })
  it('says so when no failure is on record, and matches case-insensitively', () => {
    const r = layout.roundIssuesOf([{ shot: 'cgi-072', element: 'HEAD' }], [], [])
    expect(r[0].failure).toBeNull(); expect(r[0].text).toContain('no failure is on record')
    expect(layout.roundIssuesOf([{ shot: 'cgi-072', element: 'HEAD' }], [{ shot: 'CGI-072', element: 'head' }], [])).toEqual([])
  })
})
