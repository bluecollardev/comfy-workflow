// Sync: leave out (src/utils/syncexclude.js): the core's pattern rules, one pattern per line, the folder tick's pattern. `npm run dpx:test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excludeProblem, parsePatterns, listProblem, folderPattern, isCanalV2, MAX_PATTERNS } from './syncexclude.js'

test('excludeProblem: trimmed, not empty, at most 200, no .., NUL, newline or leading ~', () => {
  for (const ok of ['CANALV2/', '/CANALV2/', '*.tmp', 'a b/c', 'x'.repeat(200), ' padded ']) assert.equal(excludeProblem(ok), '', ok)
  assert.equal(excludeProblem(''), 'excludeEmpty'); assert.equal(excludeProblem('  '), 'excludeEmpty'); assert.equal(excludeProblem(null), 'excludeEmpty')
  assert.equal(excludeProblem('x'.repeat(201)), 'excludeLong')
  for (const bad of ['../x', 'a/../b', '~/x', 'a\nb', 'a\u0000b']) assert.equal(excludeProblem(bad), 'excludeBad', JSON.stringify(bad))
})
test('parsePatterns: one per line, trimmed, blanks and duplicates dropped', () => {
  assert.deepEqual(parsePatterns('CANALV2/\n  *.tmp  \n\r\n\nCANALV2/\n'), ['CANALV2/', '*.tmp']); assert.deepEqual(parsePatterns(''), []); assert.deepEqual(parsePatterns(undefined), [])
})
test('listProblem: the first bad pattern, or too many', () => {
  assert.equal(listProblem(['a/', 'b/']), null); assert.deepEqual(listProblem(['a/', '../b']), { pattern: '../b', problem: 'excludeBad' })
  assert.deepEqual(listProblem(Array.from({ length: MAX_PATTERNS + 1 }, (_, i) => `p${i}/`)), { pattern: '', problem: 'excludeMany' }); assert.equal(listProblem(Array.from({ length: MAX_PATTERNS }, (_, i) => `p${i}/`)), null)
})
test('folderPattern anchors a folder to the root; isCanalV2 ignores case', () => {
  assert.equal(folderPattern('CANALV2'), '/CANALV2/'); assert.equal(isCanalV2('canalv2'), true); assert.equal(isCanalV2('CanalV2'), true); assert.equal(isCanalV2('CANALV2_r3'), false)
})
