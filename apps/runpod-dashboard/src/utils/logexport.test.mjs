import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queueRows, historyRows, toCsv, toHtml } from './logexport.js'

test('queue rows: a task, its events, volume, publish, render and failure rows', () => {
  const rows = queueRows({
    tasks: [{ id: 't1', kind: 'run', shot: 'cgi-042', round: 'r1', state: 'done', pod_name: 'p', started_at: '2026-11-20T09:00:00Z', events: [{ at: '2026-11-20T09:01:00Z', text: 'pod ready' }] }],
    vjobs: [{ id: 'v1', kind: 'pull', volume_id: 'vol', state: 'failed', error: 'boom' }],
    publish: [{ job_id: 'j1', round: '_TEST', state: 'done', files_done: 3, files_total: 3, bytes_done: 2e9, adapter: 'pod' }],
    renders: [{ id: 'r1', kind: 'review', state: 'done' }], failures: [{ id: 'f1', at: 'x', round: 'r', shot: 's', graph: 'g', stage: 'run', message: 'bad', node_type: 'KSampler' }],
  })
  assert.deepEqual(rows.map((r) => r.section), ['task', 'task event', 'volume job', 'publish', 'render', 'failure'])
  assert.equal(rows[1].detail, 'pod ready'); assert.equal(rows[2].error, 'boom'); assert.match(rows[3].detail, /3\/3 files, 2\.00 GB/)
})
test('csv: quotes commas, quotes and newlines; header first; empty is a header only', () => {
  const csv = toCsv(historyRows([{ kind: 'change', ts: 't', area: 'volume', action: 'a', what: 'x, "y"\nz' }]))
  assert.ok(csv.startsWith('Section,When,Id,What,State,Where,Detail,Error\r\n'))
  assert.ok(csv.includes('"volume a x, ""y""\nz"'))
  assert.equal(toCsv([]), 'Section,When,Id,What,State,Where,Detail,Error\r\n')
})
test('html: escaped, no script, row count shown', () => {
  const h = toHtml('Queue log', queueRows({ tasks: [{ id: '<b>', kind: 'k', state: 's' }] }))
  assert.ok(h.includes('&lt;b&gt;') && !h.includes('<script') && h.includes('1 rows'))
})
