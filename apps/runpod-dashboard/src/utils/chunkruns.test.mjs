import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkKey, mergeChunkRuns, frameUnions, seqKey, frameNo } from './chunkruns.js'

// Chunked renders (ADR-056): a probe and several chunks are separate runs writing ONE sequence into one folder.
const CLIP = 'CGI-072_BACKHALF-B_FINAL_V02_1920X1080_23.976_PRORES422HQ'
const DIR = `delivery_v008/${CLIP}`
const GRAPH = 'base_v008/cgi-072/cgi-072__backhalf-b__base_v008.json'
const fr = (n, extra = {}) => ({ filename: `${CLIP}.${String(n).padStart(4, '0')}.dpx`, subfolder: DIR, type: 'output', kind: 'image', ...extra })
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => fr(a + i))
const run = (id, files, extra = {}) => ({ prompt_id: id, workflow: GRAPH, source: 'pod', started_at: `2026-11-21T09:${id.slice(-2)}:00Z`, duration_s: 100, files, saved: false, ...extra })
// the probe 0-9 and chunks of 11 (10-20, 21-31, 32-42, 43-53, 54-64) and the last of 5 (65-69), newest first like the window lists them
const CHUNKS = [[65, 69], [54, 64], [43, 53], [32, 42], [21, 31], [10, 20], [0, 9]]
const runs = (extra = []) => [...CHUNKS.map(([a, b], i) => run(`c0000000-00${50 - i}`, range(a, b))), ...extra]

test('seqKey and frameNo read the folder, the clip and the frame number', () => {
  assert.equal(seqKey(fr(5)), `output/${DIR}/${CLIP}`); assert.equal(frameNo(fr(5)), 5)
  assert.equal(seqKey({ filename: 'x.mp4', subfolder: 'a' }), null); assert.equal(frameNo({ filename: 'x.mp4' }), null)
})

test('frameUnions: 7 runs of one sequence are 70 frames, contiguous; a re-run of frames 10-20 counts once', () => {
  const u = frameUnions(runs([run('c0000000-0001', range(10, 20))])).get(seqKey(fr(0)))
  assert.deepEqual(u, { count: 70, min: 0, max: 69, contiguous: true })
})

test('frameUnions: a missing chunk is a gap (count short, not contiguous); only frames 0-59 is 60 and contiguous', () => {
  const gap = frameUnions(runs().filter((r) => !r.files.some((f) => f.filename.endsWith('.0030.dpx')))).get(seqKey(fr(0)))
  assert.equal(gap.count, 59); assert.equal(gap.contiguous, false)
  const short = frameUnions(runs().slice(1)).get(seqKey(fr(0)))   // newest-first: slice(1) drops the last chunk 65-69
  assert.deepEqual(short, { count: 65, min: 0, max: 64, contiguous: true })
  const sixty = frameUnions([run('c0000000-0040', range(0, 59))]).get(seqKey(fr(0)))   // frames 0-59 only: 60, contiguous
  assert.deepEqual(sixty, { count: 60, min: 0, max: 59, contiguous: true })
})

test('frameUnions ignores temp files and non-DPX files', () => {
  const u = frameUnions([run('a-01', [{ filename: 'ComfyUI_temp_abc_00001_.png', subfolder: '', type: 'temp' }, fr(3, { type: 'temp' }), fr(4)])])
  assert.equal(u.size, 1); assert.equal([...u.values()][0].count, 1)
})

test('chunkKey: graph plus DPX folders; volume runs, unnamed graphs and runs without DPX never merge', () => {
  assert.equal(chunkKey(run('a-01', range(0, 2))), `${GRAPH}|${DIR}`)
  assert.equal(chunkKey(run('a-01', range(0, 2), { source: 'volume' })), '')
  assert.equal(chunkKey(run('a-01', range(0, 2), { workflow: '' })), '')
  assert.equal(chunkKey(run('a-01', [{ filename: 'a.mp4', subfolder: 'x', type: 'output' }])), '')
})

test('mergeChunkRuns: 8 runs (7 chunks and a re-run) are one row with the union of files, the total time and the newest start', () => {
  const rr = run('c0000000-0001', range(10, 20), { duration_s: 50 })
  const out = mergeChunkRuns([...runs(), rr])
  assert.equal(out.length, 1)
  const m = out[0]
  assert.equal(m.chunk_count, 8); assert.equal(m.chunks.length, 8)
  assert.equal(m.files.length, 70)                       // the re-run's 11 frames are the same files
  assert.equal(m.duration_s, 7 * 100 + 50)
  assert.equal(m.started_at, runs()[0].started_at)         // the newest chunk
  assert.equal(m.prompt_id, runs()[0].prompt_id)
})

test('mergeChunkRuns: different graphs, different folders and single runs stay as they are, in order', () => {
  const other = run('d0000000-0099', range(0, 9), { workflow: 'base_v008/cgi-072/cgi-072__head__base_v008.json' })
  const elsewhere = run('e0000000-0098', range(0, 9).map((f) => ({ ...f, subfolder: 'other_folder' })))
  const input = [other, ...runs(), elsewhere]
  const out = mergeChunkRuns(input)
  assert.equal(out.length, 3)
  assert.equal(out[0], other); assert.equal(out[1].chunk_count, 7); assert.equal(out[2], elsewhere)
})
