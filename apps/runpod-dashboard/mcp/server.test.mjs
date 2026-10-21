// The MCP server end to end: spawned as Claude Code spawns it, driven over stdio with raw JSON-RPC, in
// no-spend mode under a scratch config dir, so nothing reaches RunPod and no key is needed.
// Run: npm run mcp:test (builds the core first) or node --test mcp/server.test.mjs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  // Two of the three folders mapped on this PC (project and ComfyUI-Shared), so a sync has something to plan.
  for (const f of ['project', 'shared']) mkdirSync(join(dir, f), { recursive: true })
  writeFileSync(join(dir, 'mounts.json'), JSON.stringify({ folders: { project: join(dir, 'project'), 'comfy-shared': join(dir, 'shared') } }))
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

const POOL = ['list_agents', 'get_pool_status', 'governance', 'create_agent', 'stop_agent', 'resume_agent', 'delete_agent', 'health_check_agent', 'get_agent_info', 'submit_job', 'get_job_status']
const PODS = ['list_pods', 'get_pod', 'create_pod', 'stop_pod', 'resume_pod', 'delete_pod', 'recreate_pod', 'set_idle_stop', 'get_logs', 'list_datacenters', 'list_volumes', 'create_volume', 'delete_volume', 'set_default_volume', 'get_configuration', 'sync', 'sync_status', 'cost_now']

test('tools/list is the documented set: the pool, then the pods and the rest of the app', async () => {
  const r = await rpc('tools/list')
  assert.deepEqual(r.result.tools.map((t) => t.name), [...POOL, ...PODS])
  const create = r.result.tools.find((t) => t.name === 'create_agent')
  assert.deepEqual(create.inputSchema.required, ['agent_name', 'gpu_type'])
  assert.ok(create.inputSchema.properties.approved_by)
  assert.match(create.description, /approved_by/)
  for (const name of ['create_pod', 'create_volume']) {
    const t = r.result.tools.find((x) => x.name === name)
    assert.ok(t.inputSchema.properties.approved_by, name); assert.match(t.description, /approved_by/)
  }
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

// ----- the pods and the rest of the app, in no-spend mode -----
const jsonOf = (r) => JSON.parse(textOf(r).split('\n\n(no-spend')[0])
const ok = (r) => { assert.equal(r.error, undefined, JSON.stringify(r.error)); assert.notEqual(r.result.isError, true, textOf(r)); assert.match(textOf(r), /no-spend mode/); return r }
const refused = (r) => { assert.equal(r.error, undefined); assert.equal(r.result.isError, true, textOf(r)); return r }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pod

test('create_pod without approved_by is refused and makes no pod', async () => {
  assert.deepEqual(jsonOf(ok(await call('list_pods'))), [])
  const r = refused(await call('create_pod', { name: 'ComfyUI-Test', gpu: 'a40' }))
  assert.match(textOf(r), /^Refused: create_pod spends money/); assert.match(textOf(r), /approved_by/)
  refused(await call('create_pod', { name: 'ComfyUI-Test', gpu: 'a40', approved_by: ' ' }))
  assert.deepEqual(jsonOf(await call('list_pods')), [])
})

test('with a named yes: create, list, get, idle stop, logs, stop, resume, recreate, delete', async () => {
  pod = jsonOf(ok(await call('create_pod', { name: 'ComfyUI-Test', gpu: 'a40', idle_stop_minutes: 15, approved_by: 'Lucas' })))
  assert.ok(pod.id.startsWith('dry-')); assert.equal(pod.name, 'ComfyUI-Test'); assert.match(pod.gpu, /^A40/); assert.equal(pod.idle_stop_minutes, 15); assert.equal(pod.approved_by, 'Lucas'); assert.equal(pod.config, null); assert.equal(pod.dry_run, true)

  const list = jsonOf(ok(await call('list_pods')))
  assert.equal(list.length, 1); assert.equal(list[0].id, pod.id); assert.equal(list[0].status, 'starting'); assert.ok('config' in list[0])

  const got = jsonOf(ok(await call('get_pod', { pod_id: pod.id })))
  assert.equal(got.id, pod.id); assert.equal(got.cost_per_hr, 0); assert.equal(got.runpod_status, 'RUNNING'); assert.match(got.status_text, /Simulated/); assert.equal(got.datacenter, 'local'); assert.ok(got.console_url.includes(pod.id))
  assert.match(textOf(refused(await call('get_pod', { pod_id: 'dry-nope' }))), /^Pod dry-nope not found/)

  const idle = jsonOf(ok(await call('set_idle_stop', { pod_id: pod.id, minutes: 45 })))
  assert.equal(idle.idle_stop_minutes, 45); assert.equal(jsonOf(await call('get_pod', { pod_id: pod.id })).idle_stop_minutes, 45)
  assert.equal(jsonOf(ok(await call('set_idle_stop', { pod_id: pod.id, minutes: 0 }))).idle_stop_minutes, 0)
  refused(await call('set_idle_stop', { pod_id: pod.id, minutes: -1 }))

  const logs = textOf(ok(await call('get_logs', { pod_id: pod.id, lines: 2 })))
  assert.match(logs, /^Last 2 lines of dry-/); assert.match(logs, /ComfyUI listening on 0\.0\.0\.0:8188 \(simulated\)/); assert.ok(!/create container/.test(logs))

  assert.match(textOf(ok(await call('stop_pod', { pod_id: pod.id }))), new RegExp(`^✓ Pod stopped: ${pod.id}`))
  assert.equal(jsonOf(await call('get_pod', { pod_id: pod.id })).status, 'stopped')
  assert.match(textOf(ok(await call('resume_pod', { pod_id: pod.id }))), new RegExp(`^✓ Pod resumed: ${pod.id}`))
  assert.match(textOf(refused(await call('resume_pod', { pod_id: 'dry-nope' }))), /^Pod dry-nope not found/)

  const fresh = jsonOf(ok(await call('recreate_pod', { pod_id: pod.id })))
  assert.notEqual(fresh.id, pod.id); assert.equal(fresh.replaced, pod.id); assert.equal(fresh.name, 'ComfyUI-Test'); assert.match(fresh.gpu, /^A40/)
  assert.deepEqual(jsonOf(await call('list_pods')).map((p) => p.id), [fresh.id])
  pod = fresh

  const r = refused(await call('recreate_pod', { pod_id: 'dry-nope' }))
  assert.match(textOf(r), /^Pod dry-nope not found/)
})

test('datacenters and volumes: list, create with a named yes, default, refused delete while attached, delete', async () => {
  const dcs = jsonOf(ok(await call('list_datacenters')))
  assert.ok(dcs.datacenters.some((d) => d.value === 'EU-RO-1' && d.s3 === true)); assert.equal(dcs.live, false)

  assert.deepEqual(jsonOf(ok(await call('list_volumes'))), [])
  const r = refused(await call('create_volume', { name: 'canalv2', size_gb: 200, datacenter: 'EU-RO-1' }))
  assert.match(textOf(r), /^Refused: create_volume spends money/)
  assert.deepEqual(jsonOf(await call('list_volumes')), [])
  assert.match(textOf(refused(await call('create_volume', { name: 'canalv2', size_gb: 5, datacenter: 'EU-RO-1', approved_by: 'Lucas' }))), /^Size is a whole number of GB, 10 to 4000/)

  const vol = jsonOf(ok(await call('create_volume', { name: 'canalv2', size_gb: 200, datacenter: 'EU-RO-1', approved_by: 'Lucas' })))
  assert.ok(vol.id.startsWith('dry-vol-')); assert.equal(vol.cost_per_month, 14); assert.equal(vol.s3, true); assert.equal(vol.is_default, false); assert.equal(vol.approved_by, 'Lucas')

  const def = jsonOf(ok(await call('set_default_volume', { volume_id: vol.id })))
  assert.equal(def.volume.is_default, true); assert.deepEqual(def.configuration, { network_volume_id: vol.id, data_center_id: 'EU-RO-1' })
  const cfg = jsonOf(ok(await call('get_configuration')))
  assert.equal(cfg.volume, vol.id); assert.equal(cfg.datacenter, 'EU-RO-1'); assert.equal(cfg.dry_run, true); assert.equal(cfg.mode, 'dev'); assert.equal(cfg.mount_path, '/workspace')
  assert.deepEqual(cfg.folders.map((f) => f.key), ['project', 'plates', 'comfy-shared']); assert.equal(cfg.folders[0].local, join(dir, 'project')); assert.equal(cfg.folders[0].exists, true); assert.equal(cfg.folders[1].local, null); assert.equal(cfg.folders[0].on_pod, '/workspace/project')
  assert.equal(typeof cfg.idle_stop_minutes, 'number'); assert.ok(cfg.image)

  // the simulated pod now sits on the default volume, so the volume cannot go
  const listed = jsonOf(ok(await call('list_volumes')))
  assert.equal(listed[0].id, vol.id); assert.equal(listed[0].is_default, true); assert.deepEqual(listed[0].pods.map((p) => p.id), [pod.id])
  assert.match(textOf(refused(await call('delete_volume', { volume_id: vol.id }))), /is attached to ComfyUI-Test: delete or recreate those pods first/)
  assert.match(textOf(refused(await call('delete_volume', { volume_id: 'dry-vol-nope' }))), /^No network volume dry-vol-nope/)

  const cost = jsonOf(ok(await call('cost_now')))
  assert.equal(cost.currency, 'USD'); assert.equal(cost.pods_per_hour, 0); assert.deepEqual(cost.running_pods.map((p) => p.id), [pod.id]); assert.equal(cost.volumes_per_month, 14); assert.equal(cost.spend_cap_usd, 100)

  assert.match(textOf(ok(await call('delete_pod', { pod_id: pod.id }))), new RegExp(`^✓ Pod deleted: ${pod.id}`))
  assert.deepEqual(jsonOf(await call('list_pods')), [])
  assert.match(textOf(ok(await call('delete_volume', { volume_id: vol.id }))), new RegExp(`^✓ Volume deleted: ${vol.id}\\nIt was the Default Configuration's volume`))
  assert.equal(jsonOf(await call('get_configuration')).volume, null)
  assert.deepEqual(jsonOf(await call('list_volumes')), [])
})

test('sync starts the (simulated) copy in this process and sync_status follows it to done', async () => {
  const p = jsonOf(ok(await call('create_pod', { name: 'ComfyUI-Sync', approved_by: 'Lucas' })))
  assert.match(textOf(ok(await call('sync_status', { pod_id: p.id }))), /No sync started/)
  // plates leaving this PC need the named yes, in the policy's words
  assert.match(textOf(refused(await call('sync', { pod_id: p.id, plates: true }))), /^Plates leaving this PC need a named yes/)

  const s = jsonOf(ok(await call('sync', { pod_id: p.id, direction: 'push' })))
  assert.equal(s.pod_id, p.id); assert.equal(s.direction, 'push'); assert.equal(s.transport.kind, 'ssh'); assert.match(s.transport.reason, /no-spend mode/)
  // the two mapped folders, no plates, and the repo's workflows riding to comfy-shared's place on the volume
  assert.deepEqual(s.steps.map((x) => x.key), ['project', 'comfy-shared', 'workflows']); assert.equal(s.steps[0].local, join(dir, 'project') + '/'); assert.equal(s.steps[0].remote, '/workspace/project/'); assert.equal(s.follow, 'sync_status')
  // (a second sync while one runs is refused; the simulated copy is over before a second call lands, so that is not asserted here)

  let st
  for (let i = 0; i < 100; i++) { st = jsonOf(ok(await call('sync_status', { pod_id: p.id }))); if (st.done) break; await sleep(20) }
  assert.equal(st.done, true); assert.equal(st.running, false); assert.equal(st.percent, 100); assert.equal(st.folder, 3); assert.equal(st.of, 3); assert.equal(st.current, null); assert.equal(st.transport, 'ssh')
  assert.deepEqual(st.result, { steps: 3, failed: 0, cancelled: false }); assert.deepEqual(st.errors, []); assert.deepEqual(st.failed_folders, []); assert.equal(st.files_count, 9); assert.ok(st.files.includes('input/frame_0001.png'))
  assert.equal(st.summary, '3 folders in step')

  const pull = jsonOf(ok(await call('sync', { pod_id: p.id, direction: 'pull', only: ['output'] })))
  assert.equal(pull.direction, 'pull'); assert.deepEqual(pull.steps.map((x) => x.key), ['output']); assert.equal(pull.steps[0].local, join(dir, 'shared') + '/output/')
  for (let i = 0; i < 100; i++) { st = jsonOf(await call('sync_status', { pod_id: p.id })); if (st.done) break; await sleep(20) }
  assert.equal(st.direction, 'pull'); assert.equal(st.of, 1)
  assert.match(textOf(refused(await call('sync', { pod_id: p.id, direction: 'pull', only: ['review'] }))), /^Nothing to copy for review/)   // no shots in the scratch project tree
  assert.match(textOf(refused(await call('sync', { pod_id: 'dry-nope' }))), /^Pod dry-nope not found/)
  ok(await call('delete_pod', { pod_id: p.id }))
})

test('nothing but JSON-RPC went to stdout; the banner went to stderr', () => {
  assert.ok(stderr.some((l) => /comfy-moe-server .* on stdio; .* no-spend mode/.test(l)), stderr.join('\n'))
})

test('over HTTP (--http 0): initialize and tools/list answer the same server at /mcp', async () => {
  const http = spawn(process.execPath, [SERVER, '--http', '0'], { env: { ...process.env, RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise((resolve, reject) => {
      createInterface({ input: http.stderr }).on('line', (l) => { const m = /on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(l); if (m) resolve(m[1]) })
      http.on('exit', (code) => reject(new Error(`server exited ${code}`)))
    })
    const post = async (body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) })
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`)
      return r.json()
    }
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } } })
    assert.equal(init.result.serverInfo.name, 'comfy-moe-server'); assert.match(init.result.instructions, /^# Governance/)
    const tools = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    assert.deepEqual(tools.result.tools.map((t) => t.name), [...POOL, ...PODS])
    const pods = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_pods', arguments: {} } })
    assert.match(pods.result.content[0].text, /no-spend mode/)
  } finally { http.kill() }
})
