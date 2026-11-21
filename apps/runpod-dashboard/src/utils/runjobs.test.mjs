import test from 'node:test'
import assert from 'node:assert/strict'
import { liveText, liveState, framesText, chunkText, genLine, percentOf, rateText, etaText, selectRows, podLabel, isRunning } from './runjobs.js'

const live = { state: 'live', node: '7', node_class: 'SeedVR2VideoUpscaler', node_title: 'SeedVR2 sampling', step: 3, max: 12, percent: 25, ts: 1 }
const job = (o = {}) => ({ job_id: 'a', state: 'running', started_at: '2026-11-21T10:00:00Z', pod_id: 'p1', pod_name: 'Pod One', element: 'x y', frames_done: 122, frames_total: 209, chunk: 5, chunks: 8, ...o })

test('liveText: the node title (else the class, else the id) with the step and percent; nothing when there is nothing live', () => {
  assert.equal(liveText(live), 'SeedVR2 sampling 3/12 · 25%')
  assert.equal(liveText({ ...live, node_title: undefined }), 'SeedVR2VideoUpscaler 3/12 · 25%')
  assert.equal(liveText({ state: 'live', node: '9', ts: 1 }), 'node 9')
  assert.equal(liveText({ state: 'waiting', ts: 1 }), '')
  assert.equal(liveText({ state: 'none', reason: 'x', ts: 1 }), '')
  assert.equal(liveText(undefined), '')
})
test('liveState: live, waiting (open, nothing running) and none (no socket)', () => {
  assert.equal(liveState(live), 'live'); assert.equal(liveState({ state: 'waiting', ts: 1 }), 'waiting'); assert.equal(liveState({ state: 'none', ts: 1 }), 'none'); assert.equal(liveState(undefined), 'none')
})
test('the row text: frames, chunk k of n, ComfyUI step while running, the frames when over', () => {
  assert.equal(framesText(job()), '122 of 209 frames'); assert.equal(chunkText(job()), 'chunk 5 of 8')
  assert.equal(genLine(job({ live })), 'chunk 5 of 8 · SeedVR2 sampling 3/12 · 25%')
  assert.equal(genLine(job({ live: { state: 'waiting', ts: 1 } })), 'chunk 5 of 8')
  assert.equal(genLine(job({ state: 'done', live })), 'chunk 5 of 8 · 122 of 209 frames')
  assert.equal(percentOf(job()), 58); assert.equal(percentOf(job({ frames_total: 0 })), null)
  assert.equal(rateText(job({ rate_spf: 29.4 })), '29 s/frame'); assert.equal(rateText(job()), '')
  assert.equal(etaText(job({ eta: '2026-11-21T12:12:00Z' }), 'en-GB').startsWith('ETA '), true)
  assert.equal(etaText(job({ state: 'done', eta: '2026-11-21T12:12:00Z' })), ''); assert.equal(etaText(job()), '')
})
test('podLabel and isRunning', () => {
  assert.equal(podLabel(job()), 'Pod One'); assert.equal(podLabel({ pod_id: 'p9' }), 'p9'); assert.equal(isRunning(job()), true); assert.equal(isRunning(job({ state: 'done' })), false)
})
test('selectRows: every running run (newest first), then the newest finished ones, at most `keep`', () => {
  const rows = selectRows([job({ job_id: 'r1', started_at: '2026-11-21T10:00:00Z' }), job({ job_id: 'r2', started_at: '2026-11-21T11:00:00Z' }), job({ job_id: 'd1', state: 'done', finished_at: '2026-11-21T09:00:00Z' }), job({ job_id: 'd2', state: 'failed', finished_at: '2026-11-21T09:30:00Z' }), job({ job_id: 'd3', state: 'done', finished_at: '2026-11-21T08:00:00Z' }), null, {}], 2)
  assert.deepEqual(rows.map((j) => j.job_id), ['r2', 'r1', 'd2', 'd1'])
  assert.deepEqual(selectRows(undefined), [])
})
