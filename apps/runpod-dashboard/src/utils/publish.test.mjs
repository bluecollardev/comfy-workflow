// Publishing helpers (src/utils/publish.js): the destination preview, keys, the Slack message, channel names, a target's reason. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { s3Dest, s3Key, fillMessage, unknownPlaceholders, channelName, targetState, expiryText, localPath, publishActive, PLACEHOLDERS, roundProblem, timecodeProblem, dpxStem, roundExample, roundTemplateProblem } from './publish.js'

test('s3Dest: s3://bucket/prefix/ whatever slashes the fields carry; no bucket is empty', () => {
  assert.equal(s3Dest('beinghuman-deliveries', 'imax/restoration'), 's3://beinghuman-deliveries/imax/restoration/')
  assert.equal(s3Dest(' b ', '/a/b/'), 's3://b/a/b/'); assert.equal(s3Dest('b', ''), 's3://b/'); assert.equal(s3Dest('b'), 's3://b/'); assert.equal(s3Dest('', 'x'), ''); assert.equal(s3Dest(undefined, undefined), '')
})
test('s3Key: the prefix then the path under the output folder', () => {
  assert.equal(s3Key('imax', 'deliver/a/v001/x.mov'), 'imax/deliver/a/v001/x.mov'); assert.equal(s3Key('/imax/', '/deliver/x.mp4'), 'imax/deliver/x.mp4'); assert.equal(s3Key('', 'a/b'), 'a/b'); assert.equal(s3Key(undefined, 'a'), 'a')
})
test('fillMessage fills known placeholders and leaves unknown ones as typed', () => {
  assert.equal(fillMessage('{shot} {version}: {files} files', { shot: 'archival-085', version: 'v003', files: 3 }), 'archival-085 v003: 3 files')
  assert.equal(fillMessage('{nope} {shot}', { shot: 'a' }), '{nope} a'); assert.equal(fillMessage('{shot}', { shot: null }), '{shot}'); assert.equal(fillMessage(undefined, {}), '')
})
test('unknownPlaceholders lists the ones the app does not know, once', () => {
  assert.deepEqual(unknownPlaceholders('{shot} {nope} {nope} {links} {other}'), ['nope', 'other']); assert.deepEqual(unknownPlaceholders('plain'), [])
  for (const p of PLACEHOLDERS) assert.deepEqual(unknownPlaceholders(`{${p}}`), [])
})
test('channelName adds the # to a bare name and leaves # and @ alone', () => {
  assert.equal(channelName('deliveries'), '#deliveries'); assert.equal(channelName(' #deliveries '), '#deliveries'); assert.equal(channelName('@brynley'), '@brynley'); assert.equal(channelName(''), ''); assert.equal(channelName(null), '')
})
test('targetState: ready, or the core\'s problem as the reason, or Not configured', () => {
  assert.deepEqual(targetState({ s3: { ready: true } }, 's3'), { ok: true, reason: '' })
  assert.deepEqual(targetState({ s3: { ready: false, problem: 'Enter a bucket' } }, 's3'), { ok: false, reason: 'Enter a bucket' })
  assert.deepEqual(targetState({ s3: { ready: false } }, 's3'), { ok: false, reason: 'Not configured' }); assert.deepEqual(targetState({}, 'slack'), { ok: false, reason: 'Not configured' }); assert.equal(targetState(null, 's3').ok, false)
})
test('expiryText: a date and time, or nothing', () => {
  assert.match(expiryText('2026-11-22T10:00:00Z'), /2026/); assert.equal(expiryText(''), ''); assert.equal(expiryText('nope'), ''); assert.equal(expiryText(undefined), '')
})
test('localPath cuts output/ and comfy-shared/output/ off a deliverable\'s file', () => {
  assert.equal(localPath('output/deliver/a/v001/x.mov'), 'deliver/a/v001/x.mov'); assert.equal(localPath('comfy-shared/output/deliver/x.mp4'), 'deliver/x.mp4'); assert.equal(localPath('/deliver/x.mp4'), 'deliver/x.mp4'); assert.equal(localPath(undefined), '')
})
test('publishActive: queued, uploading and posting', () => {
  for (const s of ['queued', 'uploading', 'posting']) assert.equal(publishActive({ state: s }), true)
  for (const s of ['done', 'done_with_warning', 'failed', 'cancelled']) assert.equal(publishActive({ state: s }), false); assert.equal(publishActive(null), false)
})
test('round names, timecodes, DPX stems and the round template', () => {
  for (const ok of ['qc_2026-11-02_r01', 'abc', 'a.b-c_d']) assert.equal(roundProblem(ok), '')
  for (const bad of ['', 'ab', 'a b', 'x/y', 'é1234', 'a'.repeat(101)]) assert.equal(roundProblem(bad), 'round')
  for (const ok of ['00:00:00:00', '01:00:00:00', '23:59:59:23']) assert.equal(timecodeProblem(ok), '')
  for (const bad of ['', '0:0:0:0', '00:60:00:00', '00:00:00', '00:00:00;00', 'aa:bb:cc:dd']) assert.equal(timecodeProblem(bad), 'timecode')
  assert.equal(dpxStem('output/p/a/ARCH_X.0001.dpx'), 'ARCH_X'); assert.equal(dpxStem('a/b.mp4'), ''); assert.equal(dpxStem('x.12.DPX'), 'x')
  assert.equal(roundExample('tunnel-v11_{date}_r01', new Date('2026-11-19T10:00:00Z')), 'tunnel-v11_2026-11-19_r01')
  assert.equal(roundTemplateProblem('tunnel-v11_{date}_r01'), ''); assert.equal(roundTemplateProblem('x {date}'), 'round'); assert.equal(roundTemplateProblem('a_{when}'), 'round'); assert.equal(roundTemplateProblem(''), 'round')
})
