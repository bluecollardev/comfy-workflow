import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint, write, check, skip } from './gate.mjs'

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'gate-'))
  const sh = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' })
  sh('init', '-q'); sh('config', 'user.email', 't@example.com'); sh('config', 'user.name', 't')
  mkdirSync(join(root, 'apps/runpod-dashboard/src'), { recursive: true }); mkdirSync(join(root, 'apps/runpod-dashboard/build'), { recursive: true }); mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'apps/runpod-dashboard/src/a.js'), 'a'); writeFileSync(join(root, 'apps/runpod-dashboard/package.json'), '{"version":"1.0.0"}')
  writeFileSync(join(root, 'apps/runpod-dashboard/build/build-info.json'), '{}'); writeFileSync(join(root, 'start.sh'), 'x'); writeFileSync(join(root, 'scripts/s.sh'), 's'); writeFileSync(join(root, '.gitignore'), '.gate/\n')
  sh('add', '-A'); sh('commit', '-qm', 'init')
  return root
}
test('no pass on record: refused with what to run', () => {
  const root = repo(); const r = check(root); assert.equal(r.ok, false); assert.match(r.message, /No passing gate/); assert.match(r.message, /start\.sh test/); rmSync(root, { recursive: true, force: true })
})
test('a pass is valid for the same code, through a version bump and a build-info change, and for new untracked files only until they change', () => {
  const root = repo(); write(root, ['core', 'browser']); assert.equal(check(root).ok, true); assert.match(check(root).message, /core, browser/)
  writeFileSync(join(root, 'apps/runpod-dashboard/package.json'), '{"version":"1.0.1"}'); writeFileSync(join(root, 'apps/runpod-dashboard/build/build-info.json'), '{"x":1}')
  assert.equal(check(root).ok, true, 'what a release itself changes does not invalidate the pass'); rmSync(root, { recursive: true, force: true })
})
test('changed, added or removed code invalidates the pass', () => {
  const root = repo(); write(root); const a = join(root, 'apps/runpod-dashboard/src/a.js')
  writeFileSync(a, 'changed'); const r = check(root); assert.equal(r.ok, false); assert.match(r.message, /code changed/)
  write(root); assert.equal(check(root).ok, true)
  writeFileSync(join(root, 'apps/runpod-dashboard/src/new.js'), 'n'); assert.equal(check(root).ok, false, 'a new file counts')
  write(root); writeFileSync(join(root, 'scripts/s.sh'), 'edited'); assert.equal(check(root).ok, false, 'scripts count')
  rmSync(root, { recursive: true, force: true })
})
test('files outside the tested paths do not matter (docs, the changelog)', () => {
  const root = repo(); write(root); writeFileSync(join(root, 'CHANGELOG.md'), 'new entry'); mkdirSync(join(root, 'docs')); writeFileSync(join(root, 'docs/x.md'), 'd')
  assert.equal(check(root).ok, true); rmSync(root, { recursive: true, force: true })
})
test('an old pass is refused (default 24 hours), and a fresh one is not', () => {
  const root = repo(); write(root)
  assert.equal(check(root, { now: Date.now() + 23 * 3_600_000 }).ok, true)
  const r = check(root, { now: Date.now() + 25 * 3_600_000 }); assert.equal(r.ok, false); assert.match(r.message, /hours old/)
  assert.equal(check(root, { maxAgeHours: 48, now: Date.now() + 25 * 3_600_000 }).ok, true); rmSync(root, { recursive: true, force: true })
})
test('a skip needs a reason and is recorded with it', () => {
  const root = repo(); assert.throws(() => skip(root, '  '), /needs a reason/)
  skip(root, 'Lucas: no tests for this patch'); const line = JSON.parse(readFileSync(join(root, '.gate/skips.log'), 'utf8').trim().split('\n')[0])
  assert.equal(line.reason, 'Lucas: no tests for this patch'); assert.ok(line.at && line.head); rmSync(root, { recursive: true, force: true })
})
test('the fingerprint is stable and ignores the order files were created in', () => {
  const root = repo(); const a = fingerprint(root); const b = fingerprint(root); assert.equal(a.sha, b.sha); assert.ok(a.files >= 3); rmSync(root, { recursive: true, force: true })
})
