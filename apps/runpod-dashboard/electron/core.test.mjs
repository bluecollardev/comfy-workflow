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
  pods: ['dashboard', 'list', 'get', 'create', 'stop', 'resume', 'remove', 'gpus', 'volume', 'datacenters', 'setIdle', 'rename', 'credits', 'details', 'recreate', 'config', 'setConfig'],
  history: ['list', 'spend', 'runs', 'export', 'logs'],
  volumes: ['list', 'create', 'resize', 'remove', 'useAsDefault'],
  governance: ['summary'],
  settings: ['get', 'set', 'checkAnthropic'],
  git: ['accounts', 'disconnect', 'repos', 'connect'],
  repositories: ['list', 'add', 'remove', 'search', 'branches', 'folders'],
  images: ['env', 'dockerfile'],
  remote: ['status', 'check', 'setKey'],
  ratelimit: ['status'],
  configio: ['export', 'suggestedName', 'plan', 'apply', 'undo', 'backups'],
  panama: ['status', 'rounds', 'size', 'files', 'pull', 'job', 'cancel', 'remove', 'podRounds', 'podPlan', 'podPull', 'podJob', 'podCancel', 'podRemove'],
  imports: ['list', 'detect', 'plan', 'apply', 'source', 'save', 'spec', 'draftPreview', 'draft', 'validateSource', 'describe', 'syncAfter', 'remove', 'template', 'duplicate', 'getPrompt', 'savePrompt', 'rename', 'history'],
  studio: ['step', 'saveChecked', 'document', 'tree', 'file', 'problems', 'context'],
  mcp: ['endpoints', 'targets', 'probe', 'serve'],
  autosync: ['get', 'set', 'status', 'pause', 'syncNow', 'approve', 'dismiss'],
  syncs: ['active', 'recent', 'log', 'watch'],   // docs/ADR-046
}
for (const [ns, fns] of Object.entries(EXPECTED)) {
  test(`core.${ns} answers ${fns.join(', ')}`, () => {
    assert.ok(TABLE[ns], `namespace ${ns}`)
    for (const fn of fns) assert.equal(typeof TABLE[ns][fn], 'function', `${ns}.${fn}`)
  })
}

// Auto sync's dispatch entries answer plain JSON over the real (built) core, with a scratch configuration (docs/ADR-046)
test('autosync.get/set/status/pause/dismiss: defaults, the named yes (400), plain JSON', async () => {
  const { mkdtempSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path'), { pathToFileURL } = await import('node:url')
  const dir = mkdtempSync(join(tmpdir(), 'ipc-autosync-'))
  Object.assign(process.env, { POD_MANAGER_CONFIG_DIR: dir, AUTOSYNC_FILE: join(dir, 'a.json'), AUTOSYNC_STATE_FILE: join(dir, 's.json'), HISTORY_FILE: join(dir, 'h.jsonl') })
  const core = await import(pathToFileURL(join(import.meta.dirname, '..', 'libs', 'core', 'dist', 'index.js')).href)
  const T = TABLE.autosync
  assert.deepEqual(T.get(core, 'p1'), { enabled: false, pull: true, push: false, approved_by: '' })
  assert.throws(() => T.set(core, 'p1', { enabled: true }), (e) => e.status === 400 && /name of who says yes/.test(e.message))
  assert.equal(T.set(core, 'p1', { enabled: false }).enabled, false)
  const st = T.status(core); assert.deepEqual(Object.keys(st).sort(), ['items', 'paused']); assert.equal(st.paused, false)
  assert.equal(T.pause(core, true).paused, true); assert.equal(T.pause(core, false).paused, false)
  assert.equal(T.dismiss(core, 'p1').state, 'idle')
  JSON.stringify(st)
  core.autosync.stop()
})
