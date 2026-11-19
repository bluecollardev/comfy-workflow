// The page and the core agree (NEXT-STEPS, v1.3.1 follow-up): every `core.invoke('<namespace>', '<call>'` written anywhere in src/ must be a key of the core's IPC table.
// The browser suite runs against a fake HTTP API, so a call the real core does not have (v1.3.1: library.status; v1.5.x: publish.backfillScan) is invisible to it
// and shows only in the real app as "no core call <ns>.<call>". This test makes it a failure here.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const { TABLE } = require('./core.cjs')
const SRC = join(fileURLToPath(new URL('..', import.meta.url)), 'src')

const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? files(p) : /\.(js|vue|mjs)$/.test(n) && !/\.test\.mjs$/.test(n) ? [p] : [] })
const CALL = /invoke\(\s*'([A-Za-z]+)'\s*,\s*'([A-Za-z]+)'/g

test('every core.invoke(namespace, call) in the page exists in the core IPC table', () => {
  const missing = []; let seen = 0
  for (const f of files(SRC)) {
    const text = readFileSync(f, 'utf8')
    for (const m of text.matchAll(CALL)) {
      seen++
      const [, ns, fn] = m
      if (typeof TABLE[ns]?.[fn] !== 'function') missing.push(`${f.slice(SRC.length + 1)}: ${ns}.${fn}`)
    }
  }
  assert.ok(seen > 40, `expected to find the page's calls, found ${seen}`)
  assert.deepEqual(missing, [], `the page calls these but the core table has no such call:\n  ${missing.join('\n  ')}`)
})
