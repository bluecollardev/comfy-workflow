// Auto-publish helpers (src/utils/autopublish.js). `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { versionTag, secondsUntil, countdownText, entryLine, parseReviewPath, settingsProblem, AP_DEFAULTS, apFill, apIsDefault, targetsText, todayText, CAP_START, GEN_DEFAULTS, genIsDefault } from './autopublish.js'

test('versionTag keeps the core\'s folder name: v003 stays v003 (it was read as a number and became v000)', () => { assert.equal(versionTag('v003'), 'v003'); assert.equal(versionTag('v12'), 'v012'); assert.equal(entryLine({ shot: 'archival-084', version: 'v003', files: 5, bytes: 1 }, () => '58.4 MB'), 'archival-084 v003 · 5 files · 58.4 MB') })
test('versionTag pads to three digits', () => { assert.equal(versionTag(2), 'v002'); assert.equal(versionTag('12'), 'v012'); assert.equal(versionTag(1234), 'v1234'); assert.equal(versionTag(undefined), 'v000') })
test('secondsUntil: whole seconds left, never negative, null without a time', () => {
  const now = Date.parse('2026-11-19T10:00:00Z')
  assert.equal(secondsUntil('2026-11-19T10:09:41Z', now), 581); assert.equal(secondsUntil('2026-11-19T10:00:00.400Z', now), 1); assert.equal(secondsUntil('2026-11-19T09:00:00Z', now), 0); assert.equal(secondsUntil('nope', now), null); assert.equal(secondsUntil(undefined, now), null)
})
test('countdownText: m:ss, past an hour keeps counting minutes', () => { assert.equal(countdownText(581), '9:41'); assert.equal(countdownText(0), '0:00'); assert.equal(countdownText(3665), '61:05'); assert.equal(countdownText(null), '') })
test('entryLine: shot, version, files and size', () => {
  const size = (n) => `${(n / 1e9).toFixed(1)} GB`
  assert.equal(entryLine({ shot: 'archival-085', version: 2, files: 3, bytes: 2.1e9 }, size), 'archival-085 v002 · 3 files · 2.1 GB'); assert.equal(entryLine({ shot: 'a', version: 1, files: 1, bytes: 0 }, size), 'a v001 · 1 file · 0.0 GB')
})
test('parseReviewPath: only a review version folder under deliver/', () => {
  assert.deepEqual(parseReviewPath('deliver/archival-085/v003'), { shot: 'archival-085', version: 3 }); assert.deepEqual(parseReviewPath('output/deliver/x/v012/'), { shot: 'x', version: 12 })
  for (const bad of ['deliver/archival-085', 'deliver/a/v003/a.mp4', '.proxies/a/v001', 'deliver/a/vx', '', null]) assert.equal(parseReviewPath(bad), null, String(bad))
})
test('settingsProblem: the window 0 to 120 and the cap 1 to 100 (0 or empty is no limit), whole numbers', () => {
  assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 5 }), ''); assert.equal(settingsProblem({ window_minutes: 0, daily_cap: 1 }), ''); assert.equal(settingsProblem({ window_minutes: 120, daily_cap: 100 }), '')
  assert.equal(settingsProblem({ window_minutes: 121, daily_cap: 5 }), 'window'); assert.equal(settingsProblem({ window_minutes: -1, daily_cap: 5 }), 'window'); assert.equal(settingsProblem({ window_minutes: 1.5, daily_cap: 5 }), 'window'); assert.equal(settingsProblem({ window_minutes: '', daily_cap: 5 }), 'window')
  assert.equal(settingsProblem({ window_minutes: 10, daily_cap: null }), ''); assert.equal(settingsProblem({ window_minutes: 10 }), ''); assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 0 }), ''); assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 101 }), 'cap')
})

test('apFill and apIsDefault: the configuration\'s auto_publish with its defaults (S3 on, Slack and Tunnel off), and when it is just the defaults', () => {
  assert.deepEqual(apFill(undefined), AP_DEFAULTS); assert.deepEqual(apFill({ daily_cap: 9 }), { ...AP_DEFAULTS, daily_cap: 9 }); assert.equal('daily_cap' in apFill(undefined), false)   // no cap key unless the core has one
  assert.deepEqual(apFill({ targets: { slack: true } }).targets, { s3: true, slack: true, tunnel: false })
  assert.deepEqual(apFill({ slack: true }).targets, { s3: true, slack: true, tunnel: false }); assert.equal('slack' in apFill({ slack: true }), false)   // an older core's boolean becomes a target
  assert.equal(apIsDefault(undefined), true); assert.equal(apIsDefault({}), true); assert.equal(apIsDefault({ ...AP_DEFAULTS }), true)
  assert.equal(apIsDefault({ daily_cap: null }), true); assert.equal(apIsDefault({ daily_cap: 5 }), false); assert.equal(apIsDefault({ enabled: true }), false); assert.equal(apIsDefault({ window_minutes: 11 }), false); assert.equal(apIsDefault({ standing: { approved_by: 'B', at: 'x' } }), false); assert.equal(apIsDefault({ targets: { slack: true } }), false); assert.equal(apIsDefault({ slack: false }), true)
})
test('targetsText: S3 + Slack in a fixed order, from an object or a list', () => {
  assert.equal(targetsText({ s3: true, slack: true, tunnel: false }), 'S3 + Slack'); assert.equal(targetsText(['slack', 's3']), 'S3 + Slack'); assert.equal(targetsText({ s3: true }), 'S3'); assert.equal(targetsText(undefined), ''); assert.equal(targetsText(['tunnel']), 'Tunnel')
})
test('settingsProblem: at least one of S3 or Slack when targets are given', () => {
  assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 5, targets: { s3: false, slack: false, tunnel: false } }), 'targets'); assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 5, targets: { s3: false, slack: true } }), ''); assert.equal(settingsProblem({ window_minutes: 10, daily_cap: 5 }), '')
})

test('todayText: with a cap and without', () => {
  const t = (k, p) => ({ 'autopublish.today.noCap': `Today: ${p.count} uploaded`, 'autopublish.today.ofCap': `Today: ${p.count} of ${p.cap}` })[k]
  assert.equal(todayText({ today: { count: 3 }, daily_cap: 5 }, t), 'Today: 3 of 5'); assert.equal(todayText({ today: { count: 3 }, daily_cap: null }, t), 'Today: 3 uploaded'); assert.equal(todayText({}, t), 'Today: 0 uploaded'); assert.equal(CAP_START, 5)
})

test('generate: defaults, the untouched object, and the rules (settle 1..120, most per day, the approver for a pod)', () => {
  assert.deepEqual(GEN_DEFAULTS, { enabled: false, where: 'local', preset: 'review', max_per_day: 20, settle_minutes: 5, fallback_local: false })
  assert.equal(genIsDefault(undefined), true); assert.equal(genIsDefault({ ...GEN_DEFAULTS }), true); assert.equal(genIsDefault({ enabled: true }), false); assert.equal(apIsDefault({ generate: { ...GEN_DEFAULTS } }), true); assert.equal(apIsDefault({ generate: { enabled: true } }), false)
  const on = { ...GEN_DEFAULTS, enabled: true }, base = { window_minutes: 10 }
  assert.equal(settingsProblem({ ...base, generate: on }), ''); assert.equal(settingsProblem({ ...base, generate: { ...on, settle_minutes: 0 } }), 'settle'); assert.equal(settingsProblem({ ...base, generate: { ...on, settle_minutes: 121 } }), 'settle')
  assert.equal(settingsProblem({ ...base, generate: { ...on, max_per_day: null } }), ''); assert.equal(settingsProblem({ ...base, generate: { ...on, max_per_day: 0 } }), 'genmax')
  assert.equal(settingsProblem({ ...base, generate: { ...on, where: 'pod' }, approved_by: '' }), 'approver'); assert.equal(settingsProblem({ ...base, generate: { ...on, where: 'pod' }, approved_by: 'B' }), '')
  assert.equal(settingsProblem({ ...base, generate: { ...GEN_DEFAULTS, where: 'pod' } }), '')   // off: nothing to check
  assert.equal(apFill({ generate: { enabled: true } }).generate.settle_minutes, 5); assert.equal('generate' in apFill({}), false)
})

// View In Outputs on an Auto-publish row (outputsTarget): enabled only when the review has files, a folder can be named and a pod is on the volume.
import { outputsTarget, reviewFolder } from './autopublish.js'
const PODS = [{ id: 'p-stopped', status: 'stopped', volume_id: 'v1' }, { id: 'p-run', status: 'running', volume_id: 'v1' }, { id: 'p-other', status: 'running', volume_id: 'v2' }]
test('reviewFolder is deliver/<shot>/<vNNN> from a number or a folder name', () => { assert.equal(reviewFolder('archival-087', 2), 'deliver/archival-087/v002'); assert.equal(reviewFolder('archival-087', 'v002'), 'deliver/archival-087/v002') })
test('outputsTarget: files and a pod on the volume give the folder and the running pod first; zero files or a failed row with none is "nothing"; no shot or version is "nofolder"; no pod on the volume is "nopod"', () => {
  assert.deepEqual(outputsTarget({ shot: 'archival-087', version: 2, files: 3 }, { pods: PODS, volumeId: 'v1' }), { ok: true, pod_id: 'p-run', folder: 'deliver/archival-087/v002' })
  assert.deepEqual(outputsTarget({ shot: 'archival-087', version: 2, files: 0 }, { pods: PODS, volumeId: 'v1' }), { ok: false, reason: 'nothing' })
  assert.deepEqual(outputsTarget({ shot: 'x', version: 1, state: 'failed' }, { pods: PODS, volumeId: 'v1' }), { ok: false, reason: 'nothing' })
  assert.deepEqual(outputsTarget({ shot: '', version: 2, files: 3 }, { pods: PODS, volumeId: 'v1' }), { ok: false, reason: 'nofolder' })
  assert.deepEqual(outputsTarget({ shot: 'x', files: 3 }, { pods: PODS, volumeId: 'v1' }), { ok: false, reason: 'nofolder' })
  assert.deepEqual(outputsTarget({ shot: 'x', version: 1, files: 3 }, { pods: PODS, volumeId: 'v9' }), { ok: false, reason: 'nopod' })
  assert.equal(outputsTarget({ shot: 'x', version: 1, files: 3 }, { pods: [{ id: 'a', status: 'stopped', volume_id: 'v1' }], volumeId: 'v1' }).pod_id, 'a')   // a stopped pod is enough: the volume listing needs no running pod
})
test('outputsTarget: a held row has no file count of its own, so the review\'s file list decides', () => {
  assert.equal(outputsTarget({ shot: 'x', version: 1 }, { review: { files: [{ name: 'a.mov' }] }, pods: PODS, volumeId: 'v1' }).ok, true)
  assert.equal(outputsTarget({ shot: 'x', version: 1 }, { review: { files: [] }, pods: PODS, volumeId: 'v1' }).reason, 'nothing')
  assert.equal(outputsTarget({ shot: 'x', version: 1 }, { pods: PODS, volumeId: 'v1' }).reason, 'nothing')
})
import { folderOf } from './autopublish.js'
test('folderOf: the dir of an Auto-generate key, "" for a key without one; outputsTarget with a render\'s own folder needs a pod and files', () => {
  assert.equal(folderOf('delivery_v008/CGI-072_HEAD/CGI-072_HEAD'), 'delivery_v008/CGI-072_HEAD'); assert.equal(folderOf('STEM'), ''); assert.equal(folderOf(''), '')
  assert.deepEqual(outputsTarget({ folder: 'delivery_v008/X', files: 1 }, { pods: PODS, volumeId: 'v1' }), { ok: true, pod_id: 'p-run', folder: 'delivery_v008/X' })
  assert.equal(outputsTarget({ folder: '', files: 1 }, { pods: PODS, volumeId: 'v1' }).reason, 'nofolder'); assert.equal(outputsTarget({ folder: 'x', files: 0 }, { pods: PODS, volumeId: 'v1' }).reason, 'nothing'); assert.equal(outputsTarget({ folder: 'x', files: 1 }, { pods: [], volumeId: 'v1' }).reason, 'nopod')
})
