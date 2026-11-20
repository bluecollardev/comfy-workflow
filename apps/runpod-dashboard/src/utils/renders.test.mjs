// Render sequences helpers (src/utils/renders.js): tiles into plan items, frame-name parsing, fps from a name, the plan line numbers, adapters, ffmpeg problem, job progress, reviews. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { galleryTiles } from './outputs.js'
import { parseFrameName, fpsFromName, fpsFor, sequenceItem, sequenceItems, planSummary, adapterMap, whereState, ffmpegProblem, jobPercent, currentSequence, jobFor, missingText, isComplete, shotOfName, versionName, reviewFolder, latestReview, reviewMp4, unplayableFiles, deliverableParts, seqKey, clipProblem, outputNames, sourceGroups, dimsText, scaledHeight, colourGroups, colourLine, conversions, noTransform, refusals, colourText, renderProblem, renderIsDefault, RENDER_DEFAULTS, widthLabel } from './renders.js'

const f = (name, sub = 'a/b', type = 'output') => ({ filename: name, subfolder: sub, type })
const NAME = 'ARCHIVAL-085_MAIN_FINAL_V03_3840X2160_23.976_PRORES422HQ'

test('parseFrameName: stem, separator, pad and number', () => {
  assert.deepEqual(parseFrameName(`${NAME}.0000.dpx`), { name: NAME, sep: '.', pad: 4, number: 0 })
  assert.deepEqual(parseFrameName('x.00123.DPX'), { name: 'x', sep: '.', pad: 5, number: 123 })
  assert.deepEqual(parseFrameName('shot_0007.dpx'), { name: 'shot', sep: '_', pad: 4, number: 7 })
  assert.equal(parseFrameName('clip.png'), null); assert.equal(parseFrameName('nonumber.dpx'), null)
})
test('fpsFromName: a rate between underscores (12 to 120); sizes and other numbers never match', () => {
  assert.equal(fpsFromName(NAME), 23.976); assert.equal(fpsFromName('a_25_b'), 25); assert.equal(fpsFromName('a_30_'), 30)
  assert.equal(fpsFromName('a_3840X2160_b'), null); assert.equal(fpsFromName('a_10_b'), null); assert.equal(fpsFromName('a_240_b'), null); assert.equal(fpsFromName('plain'), null)
})
test('fpsFor: a fixed choice wins, auto is the name\'s rate, else 24', () => {
  assert.equal(fpsFor('auto', NAME), 23.976); assert.equal(fpsFor('auto', 'plain'), 24); assert.equal(fpsFor('25', NAME), 25); assert.equal(fpsFor(30, 'x'), 30)
})
test('sequenceItem: first, last, frames, pad, dir and name from a gallery tile; unrenderable tiles are null', () => {
  const [tile] = galleryTiles([2, 0, 1, 3].map((n) => f(`${NAME}.${String(n).padStart(4, '0')}.dpx`)))
  assert.deepEqual(sequenceItem(tile), { dir: 'a/b', name: NAME, first: 0, last: 3, frames: 4, pad: 4, fps: 23.976 })
  const [gap] = galleryTiles([f('s.0100.dpx'), f('s.0101.dpx'), f('s.0105.dpx')])   // a gap: frames is the count, last - first + 1 is the span
  assert.deepEqual(sequenceItem(gap, '25'), { dir: 'a/b', name: 's', first: 100, last: 105, frames: 3, pad: 4, fps: 25 })
  assert.equal(sequenceItem(galleryTiles([f('s.0001.dpx', 'a', 'temp')])[0]), null)   // a temp file is not under the output folder
  assert.equal(sequenceItem(galleryTiles([f('s_0001.dpx'), f('s_0002.dpx')])[0]), null)   // the core reads NAME.%04d.dpx only
  assert.equal(sequenceItem(galleryTiles([f('a.png')])[0]), null); assert.equal(sequenceItem(null), null)
  assert.equal(sequenceItem(galleryTiles([f('s.0001.dpx', '')])[0]).dir, '')
})
test('sequenceItems: one item per sequence, in order, duplicates once, unrenderable counted', () => {
  const tiles = galleryTiles([f('a.0000.dpx', 'x'), f('a.0001.dpx', 'x'), f('b.0000.dpx', 'y'), f('c_0.dpx', 'z'), f('c_1.dpx', 'z'), f('pic.png', 'x')])
  const { items, skipped } = sequenceItems(tiles)
  assert.deepEqual(items.map(seqKey), ['x/a', 'y/b']); assert.equal(skipped, 1)
  assert.deepEqual(items[0].frames, 2)
})
test('planSummary: sequences, frames, already rendered, gaps, adapter split, complete and incomplete', () => {
  const s = planSummary({ total_frames: 412, sequences: [{ frames: 100, exists_remote: true, where: 'pod', gaps: 0, complete: true }, { frames: 200, exists_local: true, where: 'local', gaps: 2, complete: false }, { frames: 112, where: 'pod', gaps: [1, 2], complete: false }] })
  assert.deepEqual(s, { sequences: 3, frames: 412, rendered: 2, gaps: 4, complete: 1, incomplete: 2, pod: 2, local: 1 })
  assert.equal(planSummary(null).sequences, 0)
  assert.equal(planSummary({ sequences: [{ frames: 5, gaps: 3 }] }).incomplete, 1)   // no `complete` field: gaps decide
  assert.equal(isComplete({ gaps: 0 }), true); assert.equal(isComplete({ complete: false, gaps: 0 }), false)
})
test('missingText: ranges and single frames', () => assert.equal(missingText([{ from: 101, to: 150 }, { from: 200, to: 200 }]), '101-150, 200'))
test('adapterMap and whereState: Auto needs one adapter, the others their own', () => {
  const ad = [{ id: 'pod', ok: false, reason: 'Start the pod' }, { id: 'local', ok: true }]
  assert.equal(adapterMap(ad).pod.reason, 'Start the pod'); assert.equal(adapterMap([]).local.ok, false)
  assert.deepEqual(whereState('auto', ad), { ok: true, why: [] }); assert.deepEqual(whereState('pod', ad), { ok: false, why: ['Start the pod'] }); assert.equal(whereState('local', ad).ok, true)
  assert.deepEqual(whereState('auto', [{ id: 'pod', ok: false, reason: 'a' }, { id: 'local', ok: false, reason: 'b' }]), { ok: false, why: ['a', 'b'] })
})
test('ffmpegProblem: the local adapter\'s code or a start error; a blocker only when nothing else can render', () => {
  const miss = { id: 'local', ok: false, code: 'no_ffmpeg', reason: 'ffmpeg is not installed on this PC. Install it with Homebrew: brew install ffmpeg', install_hint: 'brew install ffmpeg' }
  const podOk = { id: 'pod', ok: true }, podNo = { id: 'pod', ok: false, reason: 'x' }
  assert.deepEqual(ffmpegProblem([podOk, miss], 'auto'), { kind: 'missing', reason: miss.reason, hint: 'brew install ffmpeg', blocker: false })
  assert.equal(ffmpegProblem([podNo, miss], 'auto').blocker, true); assert.equal(ffmpegProblem([podOk, miss], 'local').blocker, true); assert.equal(ffmpegProblem([podNo, miss], 'pod').blocker, false)
  assert.equal(ffmpegProblem([podOk, { id: 'local', ok: false, code: 'ffmpeg_broken', reason: 'crashed' }], 'local').kind, 'broken')
  assert.equal(ffmpegProblem([podOk, { id: 'local', ok: true }], 'auto'), null)
  assert.equal(ffmpegProblem([], 'auto', { code: 'no_ffmpeg', message: 'm' }).kind, 'missing')
  assert.equal(ffmpegProblem([], 'auto', new Error('ffmpeg is not installed on this PC')).kind, 'missing'); assert.equal(ffmpegProblem([], 'auto', new Error('boom')), null)
})
test('jobPercent, currentSequence, jobFor', () => {
  assert.equal(jobPercent({ frames_done: 140, frames_total: 412 }), 34); assert.equal(jobPercent({ frames_done: 5, frames_total: 0 }), 0); assert.equal(jobPercent({ state: 'done', frames_done: 1, frames_total: 9 }), 100); assert.equal(jobPercent({ frames_done: 99, frames_total: 10 }), 100); assert.equal(jobPercent(null), 0)
  const j = { sequences: [{ state: 'rendered' }, { state: 'rendering' }, { state: 'waiting' }] }
  assert.equal(currentSequence(j), 2); assert.equal(currentSequence({ sequences: [{ state: 'rendered' }, { state: 'waiting' }] }), 2); assert.equal(currentSequence({ sequences: [{ state: 'done' }, { state: 'done' }] }), 2); assert.equal(currentSequence({}), 0)
  const jobs = [{ job_id: 'a', pod_id: 'p1', state: 'done', started_at: '2026-01-02' }, { job_id: 'b', pod_id: 'p1', state: 'rendering', started_at: '2026-01-01' }, { job_id: 'c', pod_id: 'p2', state: 'done', started_at: '2026-01-03' }, { job_id: 'd', pod_id: '', state: 'done', started_at: '2026-01-04' }]
  assert.equal(jobFor(jobs, 'p1').job_id, 'b'); assert.equal(jobFor(jobs, 'p2').job_id, 'd'); assert.equal(jobFor([], 'p1'), null)
})
test('review helpers: shot from the name, versions, folder, the latest deliverable, the playable mp4', () => {
  assert.equal(shotOfName(NAME), 'archival-085'); assert.equal(shotOfName('cgi-042b_x'), 'cgi-042b'); assert.equal(shotOfName('proxy'), '')
  assert.equal(versionName(3), 'v003'); assert.equal(reviewFolder('archival-085', 12), 'output/deliver/archival-085/v012/')
  for (const v of ['v001', 'V001', 'v1', '1', 1]) assert.equal(versionName(v), 'v001')   // a value that already has its v never becomes 'vv001'
  assert.equal(reviewFolder('archival-077', 'v001'), 'output/deliver/archival-077/v001/')
  const dels = [{ shot: 'archival-085', version: 1, exists_local: true }, { shot: 'ARCHIVAL-085', version: 3, exists_remote: true }, { shot: 'archival-085', version: 4 }, { shot: 'other-1', version: 9, exists_local: true }]
  assert.equal(latestReview(dels, { name: NAME }).version, 3); assert.equal(latestReview(dels, { name: 'zzz' }), null); assert.equal(latestReview([], { name: NAME }), null)
  const d = { file: 'output/deliver/s/v001/s_review_mono_v001.mp4', local_url: 'x://one', files: [{ name: 's_review_mono_v001.mp4', codec: 'h264', local_url: 'x://mp4' }, { name: 's_review_master_v001.mov', codec: 'prores422hq' }] }
  assert.deepEqual(reviewMp4(d), { local_url: 'x://mp4', file: 'output/deliver/s/v001/s_review_mono_v001.mp4' }); assert.deepEqual(unplayableFiles(d), ['s_review_master_v001.mov'])
  assert.deepEqual(reviewMp4({ file: 'deliver/s/v1/a.mp4', local_url: 'u' }), { local_url: 'u', file: 'deliver/s/v1/a.mp4' }); assert.equal(reviewMp4({ file: 'deliver/s/v1/a.mov' }), null); assert.equal(reviewMp4(null), null)
  assert.deepEqual(deliverableParts({ file: 'output/deliver/s/v001/a.mp4' }), { subfolder: 'deliver/s/v001', filename: 'a.mp4' }); assert.deepEqual(deliverableParts({ file: 'comfy-shared/output/deliver/a.mp4' }), { subfolder: 'deliver', filename: 'a.mp4' })
})

test('clipProblem: the core\'s rules for a clip name', () => {
  assert.equal(clipProblem('ARCHIVAL-077_A.v2 final'), ''); assert.equal(clipProblem(NAME), '')
  assert.equal(clipProblem(''), 'clipEmpty'); assert.equal(clipProblem('   '), 'clipEmpty'); assert.equal(clipProblem('a/b'), 'clipSlash'); assert.equal(clipProblem('a\\b'), 'clipSlash'); assert.equal(clipProblem('a..b'), 'clipSlash')
  assert.equal(clipProblem('a:b'), 'clipChars'); assert.equal(clipProblem('a\u0007b'), 'clipChars'); assert.equal(clipProblem('é'), 'clipChars'); assert.equal(clipProblem('x'.repeat(200)), ''); assert.equal(clipProblem('x'.repeat(201)), 'clipLong')
})
test('outputNames: review is <clip>.mov and/or .mp4; a proxy is <clip>.mp4 at source or <clip>_<width>.mp4', () => {
  assert.deepEqual(outputNames({ name: 'a' }, { kind: 'review', codecs: ['prores422hq'] }), ['a.mov']); assert.deepEqual(outputNames({ name: 'a', clip_name: 'C' }, { kind: 'review', codecs: ['h264', 'prores422hq'] }), ['C.mov', 'C.mp4'])
  assert.deepEqual(outputNames({ name: 'a' }, { kind: 'proxy', width: 'source' }), ['a.mp4']); assert.deepEqual(outputNames({ name: 'a', clip_name: 'C' }, { kind: 'proxy', width: 1280 }), ['C_1280.mp4'])
})
test('render settings: defaults (ProRes, source size), validation, and the untouched object', () => {
  assert.deepEqual(RENDER_DEFAULTS, { where: 'auto', kind: 'review', proxy_width: 'source', review_width: 'source', codecs: ['prores422hq'], fps: 'auto', pull: false, publish: { s3: true, slack: false }, skip_existing: true, preset: 'none' })
  assert.equal(renderProblem(RENDER_DEFAULTS), ''); assert.equal(renderProblem(null), ''); assert.equal(renderProblem({ ...RENDER_DEFAULTS, codecs: [] }), 'codecs'); assert.equal(renderProblem({ ...RENDER_DEFAULTS, codecs: ['x'] }), 'codecs')
  assert.equal(renderProblem({ ...RENDER_DEFAULTS, proxy_width: 1000 }), 'width'); assert.equal(renderProblem({ ...RENDER_DEFAULTS, where: 'x' }), 'choice')
  assert.equal(renderIsDefault({}), true); assert.equal(renderIsDefault({ ...RENDER_DEFAULTS }), true); assert.equal(renderIsDefault({ fps: 25 }), false)
  assert.equal(widthLabel(1280), '1280 px'); assert.equal(widthLabel('source'), 'source size')
})

const C = (o = {}) => ({ transfer_name: 'logarithmic', colorimetric_name: 'unspecified video', descriptor_name: 'RGB', bits: 16, packing_name: 'packed', endian: 'big', width: 3840, height: 2160, verdict: 'ok', conversion: 'none: a plain scale, no colour transform', ...o })
test('sourceGroups: the core\'s summary, else grouped from the sequences; nothing read is empty', () => {
  assert.deepEqual(sourceGroups({ source_summary: { groups: [{ width: 1, height: 2, bits: 8, count: 3 }] } }), [{ width: 1, height: 2, bits: 8, count: 3 }])
  assert.deepEqual(sourceGroups({ sequences: [{ source: { width: 3840, height: 2160, bits: 16 } }, { source: { width: 3840, height: 2160, bits: 16 } }, { source: { width: 1920, height: 1080, bits: 10 } }, {}] }), [{ width: 3840, height: 2160, bits: 16, count: 2 }, { width: 1920, height: 1080, bits: 10, count: 1 }])
  assert.deepEqual(sourceGroups({ sequences: [{}] }), []); assert.deepEqual(sourceGroups(null), [])
})
test('dimsText and scaledHeight: the size with its depth, and the even height an aspect-keeping downscale gives', () => {
  assert.equal(dimsText({ width: 3840, height: 2160, bits: 16 }), '3840 × 2160, 16-bit'); assert.equal(dimsText({ width: 10, height: 20 }), '10 × 20')
  assert.equal(scaledHeight({ width: 3840, height: 2160 }, 1920), 1080); assert.equal(scaledHeight({ width: 4096, height: 1716 }, 1280), 536); assert.equal(scaledHeight({ width: 3840, height: 2160 }, 960), 540)
})
test('colourGroups, colourLine, conversions, refusals and colourText', () => {
  const plan = { sequences: [{ name: 'a', colour: C() }, { name: 'b', colour: C() }, { name: 'c', colour: C({ transfer_name: 'linear', verdict: 'refused', refusal: 'a linear transfer is not a review' }) }, { name: 'd' }] }
  const gs = colourGroups(plan)
  assert.equal(gs.length, 2); assert.equal(gs[0].count, 2); assert.equal(gs[1].verdict, 'refused')
  assert.equal(colourLine(gs[0]), 'Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian')
  assert.deepEqual(conversions(plan), ['none: a plain scale, no colour transform']); assert.equal(noTransform('none: a plain scale'), true); assert.equal(noTransform('BT.709 matrix'), false)
  assert.deepEqual(refusals(gs), ['a linear transfer is not a review']); assert.deepEqual(refusals([]), [])
  assert.equal(colourText(plan), ['2 sequences: Transfer: logarithmic · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian · 3840 × 2160 · Review allowed', '1 sequence: Transfer: linear · Colorimetric: unspecified video · RGB · 16-bit packed · big-endian · 3840 × 2160 · Review refused: a linear transfer is not a review', 'Conversion applied: none: a plain scale, no colour transform'].join('\n'))
  assert.deepEqual(colourGroups({ colour_summary: { groups: [{ count: 9, verdict: 'ok' }] } }), [{ count: 9, verdict: 'ok' }]); assert.deepEqual(colourGroups({}), [])
})
