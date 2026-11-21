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
test('phaseChips: Sync is a step only when the job really copies to this PC (the core says `pull`); an older core keeps the old rule', () => {
  assert.deepEqual(phaseChips({ state: 'done', pull: false, sequences: [{ where: 'pod' }] }).map((c) => c.id), ['rendering'])   // the renders stayed on the volume: no Sync chip
  assert.deepEqual(phaseChips({ state: 'done', pull: true, sequences: [{ where: 'pod' }] }).map((c) => c.id), ['rendering', 'syncing'])
  assert.deepEqual(phaseChips({ state: 'done', pull: false, pulled_files: 2, sequences: [{ where: 'pod' }] }).map((c) => c.id), ['rendering', 'syncing'])   // it did pull files
  assert.deepEqual(phaseChips({ state: 'pulling', pull: false, sequences: [{ where: 'pod' }] }).map((c) => c.id), ['rendering', 'syncing'])
  assert.deepEqual(phaseChips({ state: 'done', sequences: [{ where: 'pod' }] }).map((c) => c.id), ['rendering', 'syncing'])   // a core that does not say
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

import { redactReason, reasonText, failureRecord, historyNote, summaryNote, paged, NOTE_FIRST } from './generations.js'
test('reasonText: the translation of a code, else the raw reason with URLs and keys struck out', () => {
  const tr = (k) => ({ 'outputs.dpx.reason.timeout': 'The file did not arrive in time' }[k] ?? k)
  assert.equal(reasonText({ code: 'timeout', reason: 'x' }, tr), 'The file did not arrive in time')
  assert.equal(reasonText({ code: 'unknown', reason: 'boom' }, tr), 'boom')   // no translation: the raw reason
  assert.equal(reasonText({ reason: 'GET https://pod.proxy.runpod.net/view?token=abc failed AKIAABCDEFGHIJKLMNOP' }, tr), 'GET <url> failed <key>')
  assert.equal(reasonText({}, tr), '?'); assert.ok(redactReason('x '.repeat(900)).length <= 300)
})
test('failureRecord and the History notes: the first 20 one by one, then one summary', () => {
  const f = failureRecord({ key: 'v/seqs/a/s.####.dpx', name: 's.####.dpx' }, { reason: 'bad https://x.y/z', code: '' }, 'ComfyUI-Dev', '2026-11-20T10:00:00Z')
  assert.deepEqual(f, { key: 'v/seqs/a/s.####.dpx', name: 's.####.dpx', pod_name: 'ComfyUI-Dev', reason: 'bad <url>', code: '', at: '2026-11-20T10:00:00Z' })
  assert.deepEqual(historyNote(f, 0), { kind: 'change', area: 'outputs', action: 'preview failed', what: 's.####.dpx', detail: 'ComfyUI-Dev: bad <url>' })
  assert.ok(historyNote(f, NOTE_FIRST - 1)); assert.equal(historyNote(f, NOTE_FIRST), null)
  assert.equal(summaryNote({ failed: 20, done: 20 }), null)
  assert.equal(summaryNote({ failed: 500, done: 500, label: 'Dev' }).action, 'previews failed')
})
test('paged: slice, info, clamped page, empty', () => {
  const l = Array.from({ length: 23 }, (_, i) => i)
  assert.deepEqual(paged(l, 0, 10).rows, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); assert.equal(paged(l, 2, 10).info, '21–23 of 23'); assert.equal(paged(l, 9, 10).page, 2); assert.equal(paged(l, 0, 25).count, 1)
  assert.deepEqual(paged([], 3, 10), { rows: [], count: 1, page: 0, info: '0' })
})

// ----- retry of a finished preview batch -----
import { retrySelection, retryBlock, groupFailures, failuresText } from './generations.js'
test('retrySelection: exactly the failed ones, in the batch order, without duplicates; a key the batch no longer holds is left out', () => {
  const all = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, job: { k } }))
  assert.deepEqual(retrySelection(all, ['d', 'b', 'zz', 'b']).map((i) => i.key), ['b', 'd'])
  assert.deepEqual(retrySelection(all, []), []); assert.deepEqual(retrySelection(null, ['a']), [])
})
test('retryBlock: running first, then nothing failed, no pod, a pod that is not running; else usable', () => {
  const ok = { running: false, failedCount: 3, podId: 'p1', pod: { id: 'p1', status: 'running' } }
  assert.equal(retryBlock(ok), '')
  assert.equal(retryBlock({ ...ok, running: true }), 'retryBlockedRunning'); assert.equal(retryBlock({ ...ok, failedCount: 0 }), 'retryBlockedNone')
  assert.equal(retryBlock({ ...ok, podId: '' }), 'retryBlockedNoPod'); assert.equal(retryBlock({ ...ok, pod: undefined }), 'retryBlockedNoPod')
  assert.equal(retryBlock({ ...ok, pod: { id: 'p1', status: 'stopped' } }), 'retryBlockedStopped')
})
test('groupFailures: by reason, the biggest group first, the first names only; failuresText has the line, one row per failure and the capped note', () => {
  const f = (name, code) => ({ name, code, reason: code, pod_name: 'P' })
  const list = [f('a', 'timeout'), f('b', 'timeout'), f('c', 'other'), f('d', 'timeout'), f('e', 'timeout')]
  const g = groupFailures(list, (x) => x.code, 3)
  assert.deepEqual(g.map((x) => [x.text, x.n, x.names.length]), [['timeout', 4, 3], ['other', 1, 1]])
  const txt = failuresText({ failures: list, failed: 7 }, (x) => x.code, 'Previews: 10 of 10 · 7 failed')
  assert.equal(txt.split('\n')[0], 'Previews: 10 of 10 · 7 failed'); assert.equal(txt.split('\n').length, 1 + 5 + 1); assert.match(txt, /\(\+2 more, in the History\)/)
})
