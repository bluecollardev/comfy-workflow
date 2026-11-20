import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buttonKeys, titleCase } from './btncase.mjs'

test('titleCase: words capitalised, small words kept lower, tokens and acronyms left alone', () => {
  assert.equal(titleCase('Dismiss all ({n})'), 'Dismiss All ({n})'); assert.equal(titleCase('Save key and continue'), 'Save Key and Continue'); assert.equal(titleCase('Run {n} workflow(s)'), 'Run {n} Workflow(s)'); assert.equal(titleCase('DPX viewer'), 'DPX Viewer')
})
test('every button label in the app is Title Case', () => {
  const bad = [...buttonKeys('.')].map(([k, [v, want, f]]) => `${k} (${f}): "${v}" should be "${want}"`)
  assert.deepEqual(bad, [], 'button labels must be Title Case: fix them in src/locales/en.json')
})
