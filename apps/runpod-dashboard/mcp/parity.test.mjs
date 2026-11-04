// Parity (docs/ADR-028): every call the app's page can make has an MCP tool, or a stated reason it needs a window. Spawns the server as parity of the other MCP tests does
// (no-spend, scratch config) and compares its tool list with electron/core.cjs's dispatch table.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { PARITY, STREAMS } from './parity.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { TABLE } = require('../electron/core.cjs')
const dir = mkdtempSync(join(tmpdir(), 'runpod-parity-'))
let child, nextId = 1
const pending = new Map()
let tools = []

before(async () => {
  child = spawn(process.execPath, [resolve(HERE, 'server.mjs')], { env: { ...process.env, RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '' }, stdio: ['pipe', 'pipe', 'pipe'] })
  createInterface({ input: child.stdout }).on('line', (line) => { const m = JSON.parse(line); if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
  const rpc = (method, params = {}) => new Promise((ok) => { const id = nextId++; pending.set(id, ok); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'parity', version: '1' } })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  tools = (await rpc('tools/list')).result.tools.map((t) => t.name)
})
after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }) })

test('every call in the app\'s dispatch table has an MCP tool or a stated reason', () => {
  const missing = []
  for (const [ns, fns] of Object.entries(TABLE)) for (const fn of Object.keys(fns)) if (!(`${ns}.${fn}` in PARITY)) missing.push(`${ns}.${fn}`)
  assert.deepEqual(missing, [], `these calls of the app have no entry in mcp/parity.mjs (give each a tool, or "window: <why>"): ${missing.join(', ')}`)
})

test('every mapped tool exists, and a window-only entry says why', () => {
  const wrong = []
  for (const [call, tool] of Object.entries({ ...Object.fromEntries(Object.entries(PARITY)), ...Object.fromEntries(Object.entries(STREAMS).map(([k, v]) => [`stream.${k}`, v])) })) {
    if (tool.startsWith('window:')) { if (tool.length < 24) wrong.push(`${call}: window-only without a reason`) } else if (!tools.includes(tool)) wrong.push(`${call} -> ${tool} (no such tool)`)
  }
  assert.deepEqual(wrong, [])
})

test('the map names no call the app no longer has', () => {
  const stale = Object.keys(PARITY).filter((k) => { const [ns, fn] = k.split('.'); return !TABLE[ns] || !(fn in TABLE[ns]) })
  assert.deepEqual(stale, [])
})

test('the documents are served: README and the ADRs, not the client job', async () => {
  const rpc = (method, params = {}) => new Promise((ok) => { const id = nextId++; pending.set(id, ok); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result
  const list = JSON.parse((await call('docs')).content[0].text)
  assert.ok(list.some((p) => p.name === 'README.md'))
  assert.ok(list.some((p) => /ADR-028/.test(p.name)))
  assert.ok(!list.some((p) => /ADR-004|CANALV2|NODE-PACKS/.test(p.name)), 'the public site leaves these out, so does the MCP')
  assert.match((await call('docs', { page: 'README.md' })).content[0].text, /ComfyUI/)
  assert.equal((await call('docs', { page: 'docs/ADR-004-where-the-workflows-run.md' })).isError, true)
  const res = (await rpc('resources/list')).result.resources
  assert.ok(res.some((r) => r.uri === 'docs://README.md'))
})
