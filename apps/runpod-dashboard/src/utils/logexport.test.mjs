import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queueRows, historyRows, toCsv, toHtml } from './logexport.js'

const LONG = 'archival-123_c.0009.dpx: upload failed: An error occurred (RequestTimeout) when calling the UploadPart operation (reached max retries: 2): Your socket connection to the server was not read from or written to within the timeout period. Idle connections will be closed.'
test('queue rows: a task, its events, volume, publish with shots and failed files, render, failure', () => {
  const rows = queueRows({
    tasks: [{ id: 't1', kind: 'run', shot: 'cgi-042', round: 'r1', state: 'done', pod_name: 'p', started_at: '2026-11-20T09:00:00Z', events: [{ at: '2026-11-20T09:01:00Z', text: 'pod ready' }] }],
    vjobs: [{ id: 'v1', kind: 'pull', volume_id: 'vol', state: 'failed', error: 'boom' }],
    publish: [{ job_id: 'j1', state: 'failed', targets: ['s3', 'slack'], files_done: 23, files_total: 71, bytes_done: 1e9, adapter: 'pod', pod: 'c2', pod_files: 21, pc_files: 2, failed: [{ path: 'a.dpx', error: LONG }], children: [{ shot: 'archival-123', clip: 'c', state: 'failed', files: 71, files_done: 23, error: 'failed' }] }],
    renders: [{ job_id: 'r1', kind: 'review', state: 'failed', error: 'e', sequences: [{ name: 's1', error: 'ffmpeg exited 1' }] }], failures: [{ id: 'f1', at: 'x', round: 'r', shot: 's', graph: 'g', stage: 'run', message: 'bad', node_type: 'KSampler' }],
  })
  assert.deepEqual(rows.map((r) => r.kind), ['task', 'task event', 'volume job', 'publish', 'publish shot', 'render', 'failure'])
  assert.equal(rows[2].error, 'boom')
  const pub = rows[3]
  assert.match(pub.what, /publish 71 files to s3 \+ slack/); assert.equal(pub.size, '23 of 71 files · 1.00 GB'); assert.equal(pub.via, '21 via pod c2, 2 via this PC')
  assert.ok(pub.error.includes(LONG) && pub.error.includes('archival-123: failed'), 'the whole error, never cut')
  assert.match(rows[5].error, /s1: ffmpeg exited 1/)
})
test('csv: the report columns; quotes commas, quotes and newlines; empty is a header only', () => {
  const csv = toCsv(historyRows([{ kind: 'change', ts: 't', area: 'volume', action: 'a', what: 'x, "y"\nz' }]))
  assert.ok(csv.startsWith('Time,Kind,What,Pod,State,Files / size,Error,Via\r\n'))
  assert.ok(csv.includes('"volume a x, ""y""\nz"'))
  assert.equal(toCsv([]), 'Time,Kind,What,Pod,State,Files / size,Error,Via\r\n')
})
test('html: escaped, no script, row count shown', () => {
  const h = toHtml('Queue log', queueRows({ tasks: [{ id: '<b>', kind: '<k>', state: 's' }] }))
  assert.ok(h.includes('&lt;k&gt;') && !h.includes('<script') && h.includes('1 rows'))
})
