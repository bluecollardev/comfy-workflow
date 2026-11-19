import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedSections, changedKeys, notLanded, clockNow } from './savefeedback.js'

test('changedSections names each changed section once; defaults added around an untouched section are not a change', () => {
  const before = { image: 'a', auto_publish: { enabled: false }, render: { kind: 'proxy' }, sync_exclude: [], sync_exclude_delete: false, dry_run: false }
  const sent = { image: 'a', auto_publish: { enabled: true }, render: { kind: 'review' }, sync_exclude: ['x'], sync_exclude_delete: true, dry_run: true, weird: 1 }
  assert.deepEqual(changedSections(before, sent), ['Auto-publish', 'Render', 'Sync', 'Settings'])
  assert.deepEqual(changedSections(before, before), [])
  assert.deepEqual(changedSections({ render: { kind: 'proxy' } }, { render: { kind: 'proxy', pull: false, publish: { s3: false } }, outputs: { hide_empty_folders: true }, env: {} }), ['Outputs window'])   // a non-empty new key counts, defaults and empties do not
  assert.deepEqual(changedKeys(before, sent), ['auto_publish', 'render', 'sync_exclude', 'sync_exclude_delete', 'weird'])
})
test('notLanded: a changed key that still reads as before, or is missing, did not land', () => {
  const before = { auto_publish: { enabled: false }, render: { kind: 'proxy' } }
  assert.deepEqual(notLanded(before, { ...before, auto_publish: { enabled: true } }, ['auto_publish', 'render'], { auto_publish: { enabled: true }, render: { kind: 'review' } }), ['render'])
  assert.deepEqual(notLanded({}, {}, ['render'], { render: { kind: 'review' } }), ['render']); assert.deepEqual(notLanded({}, { render: { kind: 'review' } }, ['render'], { render: { kind: 'review' } }), [])
  assert.equal(clockNow(new Date(2026, 10, 19, 9, 5, 7)), '09:05:07')
})
