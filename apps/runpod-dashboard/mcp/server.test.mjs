// The MCP server end to end: spawned as Claude Code spawns it, driven over stdio with raw JSON-RPC, in
// no-spend mode under a scratch config dir, so nothing reaches RunPod and no key is needed.
// Run: npm run mcp:test (builds the core first) or node --test mcp/server.test.mjs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), 'server.mjs')
const dir = mkdtempSync(join(tmpdir(), 'runpod-mcp-'))
let child, nextId = 1
const pending = new Map()
const stderr = []

before(() => {
  child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line))
})
after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }) })

/** One JSON-RPC request, the whole answer back (result or error). */
const rpc = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++
  pending.set(id, resolve)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args })
const textOf = (r) => r.result.content.map((c) => c.text).join('\n')

test('initialize hands every client the governance instructions', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  assert.equal(r.jsonrpc, '2.0'); assert.equal(r.error, undefined)
  assert.equal(r.result.serverInfo.name, 'comfy-moe-server')
  assert.ok(r.result.capabilities.tools); assert.ok(r.result.capabilities.resources)
  assert.match(r.result.instructions, /^# Governance \(applied to this session\)/)
  assert.match(r.result.instructions, /## policy\/agent-permissions\.md/)
  assert.match(r.result.instructions, /## operator-brief\.md/)
  assert.match(r.result.instructions, /approved_by.*USD 100/)
  notify('notifications/initialized')
})

test('tools/list is the documented set', async () => {
  const r = await rpc('tools/list')
  assert.deepEqual(r.result.tools.map((t) => t.name), [
    'list_agents', 'get_pool_status', 'governance', 'create_agent', 'stop_agent', 'resume_agent', 'delete_agent',
    'health_check_agent', 'get_agent_info', 'submit_job', 'get_job_status',
  ])
  const create = r.result.tools.find((t) => t.name === 'create_agent')
  assert.deepEqual(create.inputSchema.required, ['agent_name', 'gpu_type'])
  assert.ok(create.inputSchema.properties.approved_by)
  assert.match(create.description, /approved_by/)
})

test('list_agents answers an empty pool, and says it is no-spend mode', async () => {
  const r = await call('list_agents')
  assert.equal(r.error, undefined); assert.notEqual(r.result.isError, true)
  assert.equal(r.result.content[0].type, 'text')
  assert.match(textOf(r), /^\[\]/); assert.match(textOf(r), /no-spend mode/)
})

test('create_agent without approved_by is refused and makes no pod', async () => {
  const r = await call('create_agent', { agent_name: 'image-gen', gpu_type: 'rtx4090' })
  assert.equal(r.result.isError, true)
  assert.match(textOf(r), /^Refused: create_agent spends money/)
  assert.match(textOf(r), /approved_by/)
  assert.match(textOf(await call('list_agents')), /^\[\]/)
  assert.match(textOf(await call('create_agent', { agent_name: 'image-gen', gpu_type: 'rtx4090', approved_by: '  ' })), /^Refused/)
})

test('with a named yes the pool gets a (simulated) agent that the other tools see', async () => {
  const created = await call('create_agent', { agent_name: 'image-gen', gpu_type: 'rtx4090', approved_by: 'Lucas' })
  assert.notEqual(created.result.isError, true)
  const id = /✓ Agent created: (\S+)/.exec(textOf(created))[1]
  assert.ok(id.startsWith('image-gen-dry-'))
  assert.match(textOf(created), /ComfyUI: https:\/\/dry-/); assert.match(textOf(created), /SSH: ssh root@dry-/); assert.match(textOf(created), /no-spend mode/)

  const list = JSON.parse(textOf(await call('list_agents')).split('\n\n(no-spend')[0])
  assert.equal(list.length, 1); assert.equal(list[0].agent_id, id); assert.equal(list[0].gpu_type, 'rtx4090')

  const status = JSON.parse(textOf(await call('get_pool_status')).split('\n\n(no-spend')[0])
  assert.equal(status.total_agents, 1); assert.equal(status.running_agents, 1); assert.equal(status.total_cost_per_hour, 0); assert.equal(status.dry_run, true)

  assert.match(textOf(await call('stop_agent', { agent_id: id })), new RegExp(`^✓ Agent stopped: ${id}`))
  assert.match(textOf(await call('resume_agent', { agent_id: id })), new RegExp(`^✓ Agent resumed: ${id}`))
  assert.match(textOf(await call('health_check_agent', { agent_id: id })), /^✗ Unhealthy\n\n\{/)   // still booting
  const info = JSON.parse(textOf(await call('get_agent_info', { agent_id: id })).split('\n\n(no-spend')[0])
  assert.equal(info.agent_id, id); assert.equal(info.status, 'starting')

  const job = await call('submit_job', { agent_id: id, workflow_json: '{"1": {}}', prompt_name: 't' })
  const jobId = /✓ Job submitted: (\S+)/.exec(textOf(job))[1]
  assert.match(textOf(await call('get_job_status', { agent_id: id, job_id: jobId })), /"status": "COMPLETED"/)

  assert.match(textOf(await call('delete_agent', { agent_id: id })), new RegExp(`^✓ Agent deleted: ${id}`))
  assert.match(textOf(await call('list_agents')), /^\[\]/)
  const gone = await call('stop_agent', { agent_id: id })
  assert.equal(gone.result.isError, true); assert.match(textOf(gone), new RegExp(`^Agent not found: ${id}`))
})

test('the governance pages are resources and a tool', async () => {
  const list = await rpc('resources/list')
  const uris = list.result.resources.map((r) => r.uri)
  assert.ok(uris.includes('governance://README.md')); assert.ok(uris.includes('governance://policy/agent-permissions.md'))
  assert.ok(!uris.includes('governance://MANIFEST.md'))
  const page = await rpc('resources/read', { uri: 'governance://operator-brief.md' })
  assert.equal(page.result.contents[0].mimeType, 'text/markdown'); assert.match(page.result.contents[0].text, /operator/)
  const missing = await rpc('resources/read', { uri: 'governance://nope.md' })
  assert.ok(missing.error); assert.match(missing.error.message, /No such governance page/)

  assert.match(textOf(await call('governance', { page: 'README.md' })), /# Governance/)
  const bad = await call('governance', { page: 'nope.md' })
  assert.equal(bad.result.isError, true); assert.match(textOf(bad), /^No such page: nope\.md\. Pages: /)
  const unknown = await call('nothing')
  assert.equal(unknown.result.isError, true); assert.match(textOf(unknown), /^Unknown tool: nothing/)
})

test('nothing but JSON-RPC went to stdout; the banner went to stderr', () => {
  assert.ok(stderr.some((l) => /comfy-moe-server .* no-spend mode/.test(l)), stderr.join('\n'))
})
