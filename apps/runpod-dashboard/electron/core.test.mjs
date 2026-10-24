// The IPC dispatch table: every call the page makes has to exist in the right namespace.
// (A volumes namespace once landed inside the pods table and took setIdle, details, recreate and the
// per-pod configuration with it; the page said "no core call pods.recreate".)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
const require = createRequire(import.meta.url)
const { TABLE } = require('./core.cjs')

const EXPECTED = {
  mounts: ['get', 'put', 'reset', 'preview', 'dirs'],
  pods: ['dashboard', 'list', 'get', 'create', 'stop', 'resume', 'remove', 'gpus', 'volume', 'datacenters', 'setIdle', 'details', 'recreate', 'config', 'setConfig'],
  volumes: ['list', 'create', 'resize', 'remove', 'useAsDefault'],
  governance: ['summary'],
  settings: ['get', 'set'],
  git: ['accounts', 'disconnect', 'repos', 'connect'],
  repositories: ['list', 'add', 'remove', 'search', 'branches', 'folders'],
  images: ['env', 'dockerfile'],
  imports: ['list', 'detect', 'plan', 'apply', 'approve', 'source', 'save', 'spec'],
  mcp: ['endpoints', 'targets', 'probe', 'serve'],
}
for (const [ns, fns] of Object.entries(EXPECTED)) {
  test(`core.${ns} answers ${fns.join(', ')}`, () => {
    assert.ok(TABLE[ns], `namespace ${ns}`)
    for (const fn of fns) assert.equal(typeof TABLE[ns][fn], 'function', `${ns}.${fn}`)
  })
}
