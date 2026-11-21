import test from 'node:test'
import assert from 'node:assert/strict'
import { rowKind, counters, counterLine, percentOf, podName, orderRows, canRelaunch, canRemove, isRunning, isFinished } from './previewjobs.js'

const job = (o = {}) => ({ job_id: 'a', state: 'running', started_at: '2026-11-21T10:00:00Z', pod_id: 'p1', trigger: 'manual', frames_total: 650, frames_done: 412, frames_written: 412, thumbs_done: 380, thumbs_made: 380, posters_total: 0, posters_done: 0, posters_failed: 0, failed: 0, relaunchable: false, ...o })
const word = (id) => ({ frames: 'Frames', thumbs: 'Thumbnails', posters: 'Posters' }[id])

test('rowKind: Auto Previews for the automatic trigger, Posters for a posters-only job, Thumbnails for a run that only added thumbnails, else Frame Previews', () => {
  assert.equal(rowKind(job()), 'frames')
  assert.equal(rowKind(job({ trigger: 'automatic' })), 'auto')
  assert.equal(rowKind(job({ frames_total: 0, frames_done: 0, thumbs_done: 0, thumbs_made: 0, posters_total: 12, posters_done: 3 })), 'posters')
  assert.equal(rowKind(job({ frames_written: 0, frames_done: 300, thumbs_made: 280 })), 'thumbnails')   // every JPEG was already there, thumbnails were made
  assert.equal(rowKind(job({ frames_written: 0, frames_done: 0, thumbs_made: 0 })), 'frames')   // just started: nothing to say yet
  assert.equal(rowKind(job({ frames_total: 100, posters_total: 5, frames_written: 40 })), 'frames')   // frames and posters in one job: a frame-previews job
})
test('counters and the line: frames, thumbnails (of the same frames) and posters, only for the kinds that have work', () => {
  assert.deepEqual(counters(job()).map((c) => c.id), ['frames', 'thumbs'])
  assert.equal(counterLine(job(), word), 'Frames 412 of 650 · Thumbnails 380 of 650')
  assert.equal(counterLine(job({ posters_total: 12, posters_done: 3 }), word), 'Frames 412 of 650 · Thumbnails 380 of 650 · Posters 3 of 12')
  assert.equal(counterLine(job({ frames_total: 0, posters_total: 12, posters_done: 3 }), word), 'Posters 3 of 12')
  assert.equal(counterLine(job({ frames_total: 0 }), word), '')
})
test('percentOf: frames and posters done plus the failed ones, of everything the job has to do; null with no total', () => {
  assert.equal(percentOf(job()), 63)
  assert.equal(percentOf(job({ frames_total: 10, frames_done: 8, failed: 2 })), 100)
  assert.equal(percentOf(job({ frames_total: 10, frames_done: 5, posters_total: 10, posters_done: 5 })), 50)
  assert.equal(percentOf(job({ frames_total: 0 })), null)
  assert.equal(percentOf(job({ frames_total: 10, frames_done: 99 })), 100)
})
test('podName: the name from the pods list, else the id', () => {
  assert.equal(podName(job(), [{ id: 'p1', name: 'ComfyUI-previews' }]), 'ComfyUI-previews')
  assert.equal(podName(job(), []), 'p1'); assert.equal(podName(job({ pod_id: '' }), []), '')
})
test('orderRows: running first (newest start first), then the others newest first, a removed one is hidden', () => {
  const rows = orderRows([job({ job_id: 'old', state: 'done', started_at: '2026-11-21T08:00:00Z', finished_at: '2026-11-21T08:10:00Z' }), job({ job_id: 'run1', started_at: '2026-11-21T09:00:00Z' }), job({ job_id: 'run2', started_at: '2026-11-21T09:30:00Z' }), job({ job_id: 'new', state: 'failed', started_at: '2026-11-21T08:50:00Z', finished_at: '2026-11-21T08:51:00Z' })], ['old'])
  assert.deepEqual(rows.map((j) => j.job_id), ['run2', 'run1', 'new'])
  assert.deepEqual(orderRows(null), [])
})
test('Relaunch needs the core to say so and a stopped job; Remove is for a job that is over', () => {
  assert.equal(canRelaunch(job({ state: 'failed', relaunchable: true })), true)
  assert.equal(canRelaunch(job({ state: 'running', relaunchable: true })), false)
  assert.equal(canRelaunch(job({ state: 'done', relaunchable: false })), false)
  assert.equal(canRemove(job({ state: 'cancelled' })), true); assert.equal(canRemove(job()), false)
  assert.equal(isRunning(job()), true); assert.equal(isFinished(job({ state: 'interrupted' })), true)
})
