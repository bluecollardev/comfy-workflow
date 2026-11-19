import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queueBadge } from './queuebadge.js'

test('queueBadge: every pending or working item counts once; a dry-run entry counts and is its own part', () => {
  const b = queueBadge({ queueCount: 2, renderJobs: [{ state: 'rendering' }, { state: 'running' }, { state: 'done' }, { state: 'rendering', trigger: 'auto-publish' }], previewsRunning: true,
    publishJobs: [{ state: 'uploading', children: [{}, {}] }, { state: 'posting', trigger: 'auto-publish' }, { state: 'done' }, { state: 'uploading', parent_id: 'p' }, { state: 'uploading', kind: 'scan' }],
    entries: [{ state: 'uploading' }, { state: 'waiting' }, { state: 'waiting' }, { state: 'would_upload' }, { state: 'would_upload' }, { state: 'capped' }, { state: 'done' }], generate: { generating: 2, waiting_to_settle: [{}, {}, {}] } })
  const n = Object.fromEntries(b.parts.map((p) => [p.key, p.n]))
  assert.deepEqual(n, { imports: 2, generations: 3, previews: 1, uploads: 2, autogen: 1, wouldUpload: 2, waiting: 6 })   // 1 uploading entry is the auto-publish job; 2 generating minus 1 auto render; waiting 2 + capped 1 + 3 settling
  assert.equal(b.total, 17); assert.equal(b.text, '17'); assert.equal(b.show, true); assert.equal(b.dot, false)
})
test('queueBadge: four dry-run entries alone: the number 4 and a yellow button, never hidden', () => {
  const b = queueBadge({ entries: [1, 2, 3, 4].map(() => ({ state: 'would_upload' })) })
  assert.equal(b.total, 4); assert.equal(b.show, true); assert.equal(b.tone, 'warning'); assert.equal(b.pulse, false)
})
test('queueBadge: tone: green only while Auto-publish is live and something works, yellow while anything is pending, none when idle; a scan is a pulsing dot', () => {
  assert.equal(queueBadge({ renderJobs: [{ state: 'rendering' }], autoLive: true }).tone, 'success'); assert.equal(queueBadge({ renderJobs: [{ state: 'rendering' }], autoLive: true }).pulse, true)
  assert.equal(queueBadge({ entries: [{ state: 'waiting' }], autoLive: true }).tone, 'success')   // an entry counting down in live mode
  assert.equal(queueBadge({ entries: [{ state: 'waiting' }], autoLive: false }).tone, 'warning'); assert.equal(queueBadge({ renderJobs: [{ state: 'rendering' }] }).tone, 'warning')
  assert.equal(queueBadge({}).tone, 'none'); assert.equal(queueBadge({}).show, false)
  const s = queueBadge({ scanning: true }); assert.equal(s.dot, true); assert.equal(s.show, true); assert.equal(s.pulse, true); assert.equal(s.total, 0)
})
test('queueBadge: missing fields do not break it; 99+', () => {
  for (const x of [undefined, {}, { renderJobs: null, publishJobs: undefined, entries: null, generate: {} }]) { const b = queueBadge(x); assert.equal(b.show, false); assert.equal(b.total, 0) }
  assert.equal(queueBadge({ queueCount: 150 }).text, '99+'); assert.equal(queueBadge({ generate: { generating: [{}, {}] } }).total, 2)
})
