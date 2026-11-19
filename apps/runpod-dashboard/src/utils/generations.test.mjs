// Generations in the Queue (src/utils/generations.js): the phase, the chips, the ETA text, titles, ordering, files, the previews line. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseOf, phaseChips, etaSeconds, etaText, jobTitle, orderJobs, jobFiles, batchLine, percentOf, KEEP_FINISHED } from './generations.js'

const T = { 'queue.gen.review': 'Review', 'queue.gen.proxy': 'Proxy', 'queue.gen.sequenceOne': '{n} sequence', 'queue.gen.sequenceMany': '{n} sequences', 'queue.gen.previews': 'Previews', 'queue.gen.ofTotal': '{done} of {total}', 'queue.gen.failedN': '{n} failed' }
const t = (k, p = {}) => String(T[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => p[x])

test('phaseOf: rendering, syncing, publishing, and nothing once it ended', () => {
  assert.equal(phaseOf({ state: 'queued' }), 'rendering'); assert.equal(phaseOf({ state: 'rendering' }), 'rendering'); assert.equal(phaseOf({ state: 'pulling' }), 'syncing'); assert.equal(phaseOf({ state: 'publishing' }), 'publishing')
  for (const s of ['done', 'failed', 'cancelled']) assert.equal(phaseOf({ state: s }), ''); assert.equal(phaseOf(null), '')
})
test('phaseChips: the sync chip for a pod render, the publish chip when it publishes; the active one marked; earlier ones done', () => {
  const pod = { state: 'pulling', sequences: [{ where: 'pod' }], publish: { state: 'queued' } }
  assert.deepEqual(phaseChips(pod).map((c) => [c.id, c.active, c.done]), [['rendering', false, true], ['syncing', true, false], ['publishing', false, false]])
  assert.deepEqual(phaseChips({ state: 'rendering', sequences: [{ where: 'local' }] }).map((c) => c.id), ['rendering'])
  assert.deepEqual(phaseChips({ state: 'done', sequences: [{ where: 'pod' }] }).map((c) => [c.id, c.done]), [['rendering', true], ['syncing', true]])
  assert.equal(phaseChips({ state: 'failed', sequences: [{ where: 'pod' }] }).every((c) => !c.done && !c.active), true)
})
test('etaSeconds and etaText', () => {
  assert.equal(etaSeconds({ state: 'rendering', rate_fps: 9, frames_total: 412, frames_done: 140 }), 30); assert.equal(etaSeconds({ state: 'rendering', rate_fps: 0, frames_total: 5, frames_done: 1 }), null); assert.equal(etaSeconds({ state: 'done', rate_fps: 9, frames_total: 5, frames_done: 1 }), null)
  assert.equal(etaText(30), 'about 30 s left'); assert.equal(etaText(0), 'about 1 s left'); assert.equal(etaText(240), 'about 4 min left'); assert.equal(etaText(5400), 'about 1 h 30 min left'); assert.equal(etaText(null), '')
})
test('jobTitle: the clip name of a single sequence, else the count', () => {
  assert.equal(jobTitle({ kind: 'review', sequences: [{ name: 'a', clip_name: 'ARCHIVAL-077_A' }] }, t), 'Review: ARCHIVAL-077_A'); assert.equal(jobTitle({ sequences: [{ name: 'a' }] }, t), 'Proxy: a')
  assert.equal(jobTitle({ kind: 'review', sequences: [{}, {}, {}] }, t), 'Review: 3 sequences')
})
test('orderJobs: running first (newest first), then the last 20 finished; dismissed ones left out', () => {
  const jobs = [{ job_id: 'a', state: 'done', started_at: '2026-01-01' }, { job_id: 'b', state: 'rendering', started_at: '2026-01-02' }, { job_id: 'c', state: 'rendering', started_at: '2026-01-03' }, { job_id: 'd', state: 'failed', started_at: '2026-01-04' }]
  assert.deepEqual(orderJobs(jobs).map((j) => j.job_id), ['c', 'b', 'd', 'a']); assert.deepEqual(orderJobs(jobs, ['c', 'a']).map((j) => j.job_id), ['b', 'd'])
  const many = Array.from({ length: 30 }, (_, i) => ({ job_id: `j${i}`, state: 'done', started_at: `2026-02-${String(i + 1).padStart(2, '0')}` }))
  assert.equal(orderJobs(many).length, KEEP_FINISHED); assert.equal(orderJobs(many)[0].job_id, 'j29')
})
test('jobFiles: the clip-named files a job wrote', () => {
  assert.deepEqual(jobFiles({ sequences: [{ files: [{ name: 'A.mov' }, { name: 'A.mp4' }] }, { out: 'output/.proxies/x/B.mp4' }, { files: [{ name: 'A.mov' }] }] }), ['A.mov', 'A.mp4', 'B.mp4']); assert.deepEqual(jobFiles({}), [])
})
test('batchLine and percentOf', () => {
  assert.equal(batchLine({ done: 12, total: 40, failed: 1 }, t), 'Previews: 12 of 40 · 1 failed'); assert.equal(batchLine({ done: 3, total: 3, failed: 0 }, t), 'Previews: 3 of 3')
  assert.equal(percentOf({ frames_done: 140, frames_total: 412 }), 34); assert.equal(percentOf({ state: 'done' }), 100); assert.equal(percentOf({}), 0)
})
