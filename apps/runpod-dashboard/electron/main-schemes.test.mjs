// Electron keeps only the LAST protocol.registerSchemesAsPrivileged call: registering podfile, s3file and localfile in three calls made s3file:// requests fail in the real app
// (v1.5.0 gate, e2e-electron/s3file.spec.js). Every custom scheme the app handles must be in ONE call, and every `protocol.handle` scheme must be in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./main.cjs', import.meta.url), 'utf8')
const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

test('custom schemes are registered in exactly one registerSchemesAsPrivileged call', () => {
  const calls = code.match(/protocol\.registerSchemesAsPrivileged\(/g) || []
  assert.equal(calls.length, 1, `found ${calls.length} calls; merge them into one`)
})

test('every protocol.handle scheme is in that one registration', () => {
  const handled = [...code.matchAll(/protocol\.handle\('([a-z0-9]+)'/g)].map((m) => m[1])
  assert.ok(handled.length >= 3, `expected podfile, s3file and localfile handlers, found ${handled.join(', ')}`)
  const reg = /registerSchemesAsPrivileged\(\[([^\]]*)\]/.exec(code)
  assert.ok(reg, 'the registration list was not found')
  for (const scheme of handled) assert.ok(reg[1].includes(`'${scheme}'`), `${scheme} is handled but not registered in the single call`)
})
