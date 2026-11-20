// The MCP server end to end: spawned as Claude Code spawns it, driven over stdio with raw JSON-RPC, in
// no-spend mode under a scratch config dir, so nothing reaches RunPod and no key is needed.
// Run: npm run mcp:test (builds the core first) or node --test mcp/server.test.mjs.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
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
    env: { ...process.env, SYNC_SIM_MS: '1', RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '', AGENT_REQUIRE_NAMED_YES: '1' },
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
const first = (r) => r.result.content.map((c) => c.text).join('\n').split('\n\n(no-spend')[0]
const textOf = (r) => r.result.content.map((c) => c.text).join('\n')

test('initialize hands every client the governance instructions', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  assert.equal(r.jsonrpc, '2.0'); assert.equal(r.error, undefined)
  assert.equal(r.result.serverInfo.name, 'comfy-moe-server')
  assert.ok(r.result.capabilities.tools); assert.ok(r.result.capabilities.resources)
  assert.match(r.result.instructions, /^# Governance \(applied to this session\)/)
  assert.match(r.result.instructions, /## policy\/agent-permissions\.md/)
  assert.match(r.result.instructions, /## operator-brief\.md/)
  assert.match(r.result.instructions, /tools that spend need `approved_by`/)   // the test server runs with the named yes switched on (AGENT_REQUIRE_NAMED_YES)
  notify('notifications/initialized')
})

const POOL = ['list_agents', 'get_pool_status', 'governance', 'create_agent', 'stop_agent', 'resume_agent', 'delete_agent', 'health_check_agent', 'get_agent_info', 'submit_job', 'get_job_status']
const PODS = ['list_pods', 'get_pod', 'create_pod', 'stop_pod', 'resume_pod', 'delete_pod', 'recreate_pod', 'get_history', 'get_spend_history', 'get_comfy_runs', 'list_outputs', 'get_comfy_logs', 'export_history', 'rename_pod', 'set_pod_round', 'set_pod_shot', 'delete_round', 'rename_round', 'set_idle_stop', 'get_logs', 'list_datacenters', 'list_volumes', 'create_volume', 'delete_volume', 'set_default_volume', 'get_configuration', 'sync', 'sync_status', 'adapter_spec', 'adapters_list', 'adapter_save', 'import_plan', 'import_apply', 'get_credits', 'cost_now']
// The tools the app's other windows added (docs/ADR-028), in the order app-tools.mjs defines them.
const APP = ['list_gpus', 'get_volume_info', 'get_pod_config', 'set_pod_config', 'set_configuration', 'preview_configuration', 'reset_configuration', 'get_local_env', 'list_dirs', 'get_settings', 'set_settings', 'check_anthropic_key', 'config_export', 'config_import_plan', 'config_import_apply', 'config_undo', 'config_backups', 'resize_volume', 'volume_files', 'volume_erase', 'volume_clone', 'volume_job', 'volume_jobs', 'rate_limit_status', 'agent_guard_status', 'models_search', 'models_files', 'models_fetch', 'models_status', 'models_delete', 'models_wanted', 'models_wanted_add', 'models_wanted_remove', 'models_load_wanted', 'set_shared_volume', 'panama_status', 'list_rounds', 'round_info', 'panama_rounds', 'panama_round_files', 'panama_bucket_list', 'panama_stage', 'panama_round_size', 'panama_pod_plan', 'panama_pull', 'panama_job', 'panama_cancel', 'panama_remove', 'plan_round_import', 'import_rounds', 'import_round', 'queue_list', 'queue_task', 'list_pod_workflows', 'run_pod_workflows', 'pod_models', 'run_workflows_job', 'panama_place', 'panama_import', 'import_detect', 'package_summary', 'package_tree', 'package_file', 'package_describe', 'adapter_draft', 'adapter_document', 'adapter_problems', 'adapter_manage', 'sync_after', 'image_env', 'image_dockerfile', 'git_accounts', 'repositories', 'remote_mcp', 'mcp_endpoints', 'docs', 'chunk_plan', 'run_shot_chunked', 'chunked_job', 'pod_ram', 'pod_watch', 'pod_retry_options', 'volume_changes', 'auto_sync', 'sync_runs', 'render_sequences', 'publish', 'running_jobs', 'failures', 'generate_existing', 'edl', 'autopublish', 'sync_folders']

test('an agent writes an adapter and tests it on a real folder; the code stays open to read', async () => {
  const spec = textOf(ok(await call('adapter_spec')))
  assert.match(spec, /^# Import adapters/); assert.match(spec, /ComfyUI-Shared structure/)
  assert.match(textOf(ok(await call('adapters_list'))), /panama-imax-redux/)
  const src = join(dir, 'pkg'); mkdirSync(join(src, 'input'), { recursive: true }); writeFileSync(join(src, 'input', 'a.png'), 'png')
  const mod = "/**\n * Agent made: a test adapter. What it does: copies everything under input/. Detects: an input folder. Maps: input/* to input/*.\n * Leaves in place: the rest. Needs / assumes: nothing. Limits: a test.\n */\nexport default { id: 'agent-made', name: 'Agent made', version: 1, async detect(root, ctx) { return { match: (await ctx.exists('input')) ? 1 : 0, evidence: ['input/'] } }, async plan(root, ctx) { const fs = await ctx.list('input', { recursive: true }); return { ops: fs.map((f) => ({ op: 'copy', kind: 'input', from: f.path, to: f.path, bytes: f.bytes })), findings: [] } } }"
  const saved = textOf(ok(await call('adapter_save', { id: 'agent-made', source: mod })))
  assert.match(saved, /Structure ok/); assert.match(saved, /Nothing was run/); assert.match(saved, /Default Configuration/)
  const bad = textOf(ok(await call('adapter_save', { id: 'half-made', source: "export default { id: 'half-made' }" })))
  assert.match(bad, /Structure problems/); assert.match(bad, /no detect\(root, ctx\) function/); assert.match(bad, /no documentation header/)
  const broken = await call('adapter_save', { id: 'broken', source: 'export default {' })
  assert.equal(broken.result.isError, true); assert.match(textOf(broken), /does not parse/)
  assert.ok(!(await rpc('tools/list')).result.tools.some((t) => /approve/.test(t.name)))   // there is no approval step
  const plan = JSON.parse(textOf(ok(await call('import_plan', { source: src, adapter: 'agent-made' }))).split('\n\n(no-spend')[0])
  assert.equal(plan.adapter.id, 'agent-made'); assert.equal(plan.summary.copies, 1); assert.equal(plan.fenced, true)
  const applied = JSON.parse(textOf(ok(await call('import_apply', { source: src, adapter: 'agent-made' }))).split('\n\n(no-spend')[0])
  assert.equal(applied.dry_run, true); assert.equal(applied.counts['would-copy'], 1)
})

test('tools/list is the documented set: the pool, then the pods and the rest of the app', async () => {
  const r = await rpc('tools/list')
  assert.deepEqual(r.result.tools.map((t) => t.name), [...POOL, ...PODS, ...APP])
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

test('history: pod and job events, spend with its note, and a pod\'s ComfyUI runs (refused while the pod is not running)', async () => {
  await sleep(100)
  const all = jsonOf(ok(await call('get_history')))
  assert.ok(Array.isArray(all) && all.length > 0); assert.ok(all.every((e) => e.kind === 'pod' || e.kind === 'job' || e.kind === 'change'))
  assert.ok(all.some((e) => e.kind === 'pod' && e.action === 'created'))
  const podsOnly = jsonOf(ok(await call('get_history', { kind: 'pod', limit: 2 })))
  assert.equal(podsOnly.length, 2); assert.ok(podsOnly.every((e) => e.kind === 'pod'))
  assert.deepEqual(jsonOf(ok(await call('get_history', { kind: 'job' }))), [])
  refused(await call('get_history', { kind: 'nope' }))
  const spend = jsonOf(ok(await call('get_spend_history')))
  assert.ok(Array.isArray(spend.sessions)); assert.equal(typeof spend.total, 'number'); assert.ok(spend.note)
  const fresh = jsonOf(ok(await call('create_pod', { name: 'ComfyUI-Runs', gpu: 'a40', approved_by: 'Lucas' })))
  assert.match(textOf(refused(await call('get_comfy_runs', { pod_id: fresh.id }))), /is not running: start it to read its ComfyUI history/)
  assert.match(textOf(refused(await call('get_comfy_runs', { pod_id: 'dry-nope' }))), /^Pod dry-nope not found/)
  assert.match(textOf(refused(await call('get_comfy_logs', { pod_id: fresh.id }))), /is not running: start it to read its ComfyUI history/)
  assert.match(textOf(refused(await call('get_comfy_logs', { pod_id: 'dry-nope' }))), /^Pod dry-nope not found/)
  refused(await call('get_comfy_logs', { pod_id: fresh.id, level: 'loud' }))
  // saved: true answers from the app's record of runs' files, with no pod running (ADR-037, 2026-11-17)
  const mk = (id, pod, vol) => ({ prompt_id: id, workflow: 'w.json', started_at: '2026-11-17T10:00:00Z', duration_s: 1, pod_id: pod, pod_name: pod, volume_id: vol, datacenter: null, recorded_at: '2026-11-17T10:01:00Z', files: [{ filename: `${id}.png`, subfolder: '', type: 'output' }] })
  writeFileSync(join(dir, 'output-runs.json'), JSON.stringify({ runs: [mk('p1', 'podA', 'volA'), mk('p2', 'podB', 'volB')] }))
  assert.deepEqual(jsonOf(ok(await call('get_comfy_runs', { saved: true }))).map((r) => r.prompt_id).sort(), ['p1', 'p2'])
  assert.deepEqual(jsonOf(ok(await call('get_comfy_runs', { saved: true, pod_id: 'podX', volume_id: 'volB' }))).map((r) => r.prompt_id), ['p2'])
  refused(await call('get_comfy_runs', {}))
  // list_outputs (ADR-045): every source or one, each failing source reported with its reason; the volume source needs the S3 keys and says so, nothing is started
  const lo = jsonOf(ok(await call('list_outputs', { volume_id: 'volB' })))
  assert.deepEqual(lo.runs.map((r) => [r.prompt_id, r.source]), [['p2', 'saved']])
  assert.ok(lo.sources.find((x) => x.id === 'volume-s3'))   // in no-spend mode the volume lists nothing (no S3 call is made)
  assert.deepEqual(jsonOf(ok(await call('list_outputs', { source: 'saved' }))).runs.map((r) => r.prompt_id).sort(), ['p1', 'p2'])
  refused(await call('list_outputs', { source: 'nope' }))
  await call('delete_pod', { pod_id: fresh.id })
  const csv = textOf(ok(await call('export_history', { format: 'csv' }))); assert.match(csv, /\.csv/); assert.match(csv, /created/)
  const js = textOf(ok(await call('export_history', { format: 'json', what: 'spend' }))); assert.match(js, /\.json/); assert.match(js, /sessions/)
  refused(await call('export_history', { format: 'xml' }))
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
  assert.equal(cost.currency, 'USD'); assert.equal(cost.pods_per_hour, 0); assert.deepEqual(cost.running_pods.map((p) => p.id), [pod.id]); assert.equal(cost.volumes_per_month, 14); assert.equal(cost.spend_cap_usd, null)

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
  assert.deepEqual(st.result, { steps: 3, failed: 0, warned: 0, cancelled: false }); assert.deepEqual(st.errors, []); assert.deepEqual(st.failed_folders, []); assert.equal(st.files_count, 6); assert.ok(st.files.some((f) => f.endsWith('input/frame_0003.png')))
  assert.ok(!st.files.some((f) => /(^|\/)output\//.test(f)))   // the default push leaves ComfyUI-Shared/output behind (docs/ADR-011)
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
  const http = spawn(process.execPath, [SERVER, '--http', '0'], { env: { ...process.env, SYNC_SIM_MS: '1', RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '', AGENT_REQUIRE_NAMED_YES: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
    assert.deepEqual(tools.result.tools.map((t) => t.name), [...POOL, ...PODS, ...APP])
    const pods = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_pods', arguments: {} } })
    assert.match(pods.result.content[0].text, /no-spend mode/)
  } finally { http.kill() }
})

// ----- docs/ADR-028: what the window does, the MCP does -----
const zipOf = (file, entries) => { const py = 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1],"w")\nfor n,t in json.loads(sys.argv[2]).items(): z.writestr(n,t)\nz.close()'; const r = spawnSync('python3', ['-c', py, file, JSON.stringify(entries)]); assert.equal(r.status, 0, String(r.stderr)) }

test('a .zip is a source: unpacked once, planned through an adapter, dry-run applied; an entry that leaves the folder is refused', async () => {
  const z = join(dir, 'pack.zip'); zipOf(z, { 'pack/input/a.png': 'png', 'pack/input/b.png': 'png2' })
  const plan = jsonOf(ok(await call('import_plan', { source: z, adapter: 'agent-made' })))
  assert.equal(plan.summary.copies, 2); assert.match(plan.source, /import-zips/)
  const applied = jsonOf(ok(await call('import_apply', { source: z, adapter: 'agent-made' })))
  assert.equal(applied.dry_run, true); assert.equal(applied.counts['would-copy'], 2)
  const evil = join(dir, 'evil.zip'); zipOf(evil, { '../outside.txt': 'x', 'input/a.png': 'png' })
  const refused = await call('import_plan', { source: evil, adapter: 'agent-made' })
  assert.equal(refused.result.isError, true); assert.match(textOf(refused), /outside its folder/)
  const notZip = join(dir, 'notes.txt'); writeFileSync(notZip, 'x')
  assert.equal((await call('import_plan', { source: notZip })).result.isError, true)
})

test('configuration: a patch is validated and saved; the no-spend switch is not settable; a pod\'s own configuration can be read, changed and reset', async () => {
  const refused = await call('set_configuration', { patch: { dry_run: false } })
  assert.equal(refused.result.isError, true); assert.match(textOf(refused), /no-spend switch/)
  const saved = jsonOf(ok(await call('set_configuration', { patch: { idle_stop_minutes: 12, env: { EXTRA: '1' } } })))
  assert.equal(saved.saved, true); assert.equal(saved.configuration.idle_stop_minutes, 12)
  assert.equal(jsonOf(ok(await call('get_configuration'))).idle_stop_minutes, 12)
  assert.equal(jsonOf(ok(await call('preview_configuration', { patch: { env: { MORE: '2' } } }))).preview.env.MORE, '2')
  const made = jsonOf(ok(await call('create_pod', { approved_by: 'Lucas', name: 'cfg-pod', gpu: 'auto', disk_gb: 40, instance_type: 'on-demand', env_vars: { A: 'b' } })))
  const set = jsonOf(ok(await call('set_pod_config', { pod_id: made.id, patch: { idle_stop_minutes: 3 } })))
  assert.equal(set.custom_config, true); assert.equal(set.config.idle_stop_minutes, 3)
  assert.equal(jsonOf(ok(await call('get_pod_config', { pod_id: made.id }))).custom_config, true)
  const noYes = await call('set_pod_config', { pod_id: made.id, patch: {}, recreate: true })
  assert.equal(noYes.result.isError, true); assert.match(textOf(noYes), /approved_by/)   // a recreate spends
  assert.equal(jsonOf(ok(await call('set_pod_config', { pod_id: made.id, reset: true }))).custom_config, false)
  const reset = jsonOf(ok(await call('reset_configuration')))
  assert.equal(reset.reset, true)
})

test('keys and settings are changed without a named yes and are never returned; an unknown setting is refused', async () => {
  const bad = await call('set_settings', { values: { not_a_setting: 'x' } })
  assert.equal(bad.result.isError, true); assert.match(textOf(bad), /Not a setting/)
  const set = jsonOf(ok(await call('set_settings', { values: { panama_bucket: 'my-test-bucket', panama_aws_access_key: 'AKIAABCDEFGHIJKLMNOP', panama_aws_secret_key: 'secretsecretsecretsecret1234' } })))
  assert.deepEqual(set.changed, ['panama_bucket', 'panama_aws_access_key', 'panama_aws_secret_key'])
  const shown = textOf(ok(await call('get_settings')))
  assert.match(shown, /my-test-bucket/); assert.match(shown, /••••MNOP/)
  assert.ok(!shown.includes('AKIAABCDEFGHIJKLMNOP') && !shown.includes('secretsecretsecret'), 'a key is never returned')
  await call('set_settings', { values: { panama_bucket: null, panama_aws_access_key: null, panama_aws_secret_key: null } })
})

test('the Hugging Face token is a setting: set without a named yes, validated, shown as a hint only, removed with null', async () => {
  const short = await call('set_settings', { values: { hf_token: 'short' } })
  assert.equal(short.result.isError, true); assert.match(textOf(short), /does not look like a Hugging Face token/)
  const set = jsonOf(ok(await call('set_settings', { values: { hf_token: 'hf_ABCDEFGHIJKLMNOP9876' } })))
  assert.deepEqual(set.changed, ['hf_token'])
  const shown = textOf(ok(await call('get_settings')))
  assert.match(shown, /hf_token_set"?: ?true/); assert.match(shown, /••••9876/); assert.ok(!shown.includes('ABCDEFGHIJKLMNOP'), 'the token is never returned')
  await call('set_settings', { values: { hf_token: null } })
  assert.match(textOf(ok(await call('get_settings'))), /hf_token_set"?: ?false/)
})

test('spend is gated on the new tools: resize_volume and a pod download need approved_by', async () => {
  for (const [name, args] of [['resize_volume', { volume_id: 'v', size_gb: 500 }], ['panama_pull', { round: 'r1', target: 'pod' }], ['panama_remove', { round: 'r1', target: 'pod' }]]) {
    const r = await call(name, args)
    assert.equal(r.result.isError, true, name); assert.match(textOf(r), /approved_by/, name)
  }
})

test('Panama: the status, the rounds and a round\'s files answer through the same core as the window (no bucket here: a clear refusal, not a crash)', async () => {
  const st = jsonOf(ok(await call('panama_status')))
  assert.ok('bucket' in st && 'configured' in st)
  const bad = await call('panama_round_size', { round: '../etc' })
  assert.equal(bad.result.isError, true); assert.match(textOf(bad), /Not a round name/)
  const gone = await call('panama_job', { id: 'nope-1' })
  assert.equal(gone.result.isError, true)
})

test('import tools take a shot\'s cards as a string or an ordered list (docs/ADR-038): the schema says so and every key is validated', async () => {
  const tools = (await rpc('tools/list')).result.tools
  for (const name of ['plan_round_import', 'import_round']) {
    const t = tools.find((x) => x.name === name), c = t.inputSchema.properties.cards
    assert.deepEqual(c.additionalProperties.anyOf.map((x) => x.type), ['string', 'array'], name); assert.match(c.description, /first with a card free/); assert.match(c.description, /most expensive/)
    assert.match(t.inputSchema.properties.max_pods.description, /Number of pods/)
  }
  const many = tools.find((x) => x.name === 'import_rounds').inputSchema.properties.rounds.items.properties.cards
  assert.deepEqual(many.additionalProperties.anyOf.map((x) => x.type), ['string', 'array'])
  const base = { round: 'proxy_v005', source: 'volume', volume_id: 'vol1' }
  const list = await call('plan_round_import', { ...base, cards: { 'archival-080': ['rtx4090', 'nope'] } })
  assert.equal(list.result.isError, true); assert.match(textOf(list), /Unknown card "nope" for archival-080/)
  const str = await call('plan_round_import', { ...base, cards: { 'archival-080': 'nope' } })
  assert.equal(str.result.isError, true); assert.match(textOf(str), /Unknown card "nope"/)
  const empty = await call('plan_round_import', { ...base, cards: { 'archival-080': [] } })
  assert.equal(empty.result.isError, true); assert.match(textOf(empty), /empty list/)
  const ok = await call('plan_round_import', { ...base, cards: { 'archival-080': ['rtx4090', 'a40'] } })   // valid keys pass validation (the no-spend volume holds no shot: a different, later error)
  assert.doesNotMatch(textOf(ok), /Unknown card|empty list/)
})

test('volume rounds (ADR-044): list_rounds offers the volume source, round_info reads a prefix listing, and the import tools refuse Replace with no pod started', async () => {
  const src = JSON.parse(first(await call('list_rounds', { sources: true })))
  assert.deepEqual(src.map((s) => s.id), ['panama-s3', 'volume']); assert.equal(src[1].needs, 'volume')
  const st = JSON.parse(first(await call('list_rounds', { source: 'volume', status: true, volume_id: 'vol1' })))
  assert.equal(st.available, true)   // no-spend mode answers from the simulation: nothing reaches RunPod
  assert.deepEqual(JSON.parse(first(await call('list_rounds', { source: 'volume', volume_id: 'vol1' }))), [])
  const info = JSON.parse(first(await call('round_info', { round: 'proxy_v005', volume_id: 'vol1' })))
  assert.equal(info.kind, 'round'); assert.equal(info.round, 'proxy_v005'); assert.deepEqual(info.shots, [])
  const bad = await call('round_info', { round: '../models', volume_id: 'vol1' })
  assert.equal(bad.result.isError, true); assert.match(textOf(bad), /Not a round folder/)
  const replace = await call('import_round', { round: 'proxy_v005', source: 'volume', volume_id: 'vol1', replace: true, approved_by: 'Lucas' })
  assert.equal(replace.result.isError, true); assert.match(textOf(replace), /never overwritten/)
  const plan = await call('plan_round_import', { round: 'proxy_v005', source: 'volume', volume_id: 'vol1', replace: true })
  assert.equal(plan.result.isError, true); assert.match(textOf(plan), /never overwritten/)
  const q = JSON.parse(first(await call('queue_list')))
  assert.equal(q.tasks.length, 0)
})

test('docs: the list, a page, a search; a page the public site leaves out is refused', async () => {
  const list = JSON.parse(textOf(await call('docs')))
  assert.ok(list.some((p) => p.name === 'README.md') && list.some((p) => /ADR-028/.test(p.name)))
  assert.ok(!list.some((p) => /CANALV2|ADR-004/.test(p.name)))
  assert.match(textOf(await call('docs', { page: 'docs/ADR-028-mcp-can-do-everything-the-app-does.md' })), /Anything the app can do, the MCP can do/)
  assert.ok(JSON.parse(textOf(await call('docs', { search: 'zip' }))).matches.length > 0)
  assert.equal((await call('docs', { page: 'docs/ADR-004-where-the-workflows-run.md' })).result.isError, true)
})

test('models_delete: needs the named yes (on here) and confirmed: true; refuses paths outside models/ and the bookkeeping folder, before any pod', async () => {
  const items = [{ folder: 'vae', name: 'a.safetensors' }]
  const noName = await call('models_delete', { volume_id: 'vol1', items, confirmed: true })
  assert.equal(noName.result.isError, true); assert.match(textOf(noName), /approved_by/)
  const noConfirm = await call('models_delete', { volume_id: 'vol1', items, approved_by: 'Lucas' })
  assert.equal(noConfirm.result.isError, true); assert.match(textOf(noConfirm), /confirm/i)
  const falsy = await call('models_delete', { volume_id: 'vol1', items, approved_by: 'Lucas', confirmed: false })
  assert.equal(falsy.result.isError, true); assert.match(textOf(falsy), /confirm/i)
  const up = await call('models_delete', { volume_id: 'vol1', items: [{ folder: 'vae', name: '../../input/x.png' }], approved_by: 'Lucas', confirmed: true })
  assert.equal(up.result.isError, true); assert.match(textOf(up), /Not a file name/)
  const star = await call('models_delete', { volume_id: 'vol1', items: [{ folder: 'vae', name: '*' }], approved_by: 'Lucas', confirmed: true })
  assert.equal(star.result.isError, true); assert.match(textOf(star), /Not a file name/)
  const book = await call('models_delete', { volume_id: 'vol1', items: [{ folder: '_canalv2_pull', name: 'MODELS_PULL_v003.csv' }], approved_by: 'Lucas', confirmed: true })
  assert.equal(book.result.isError, true); assert.match(textOf(book), /bookkeeping/)
  const none = await call('models_delete', { volume_id: 'vol1', items: [], approved_by: 'Lucas', confirmed: true })
  assert.equal(none.result.isError, true); assert.match(textOf(none), /at least one/)
})

test('volume_jobs: lists the volume jobs (progress) and the interrupted pods; drop refuses a name that is not an interrupted volume-job pod', async () => {
  const r = await call('volume_jobs', {})
  assert.ok(!r.result.isError); const v = JSON.parse(first(r)); assert.ok(Array.isArray(v.jobs)); assert.ok(Array.isArray(v.interrupted)); assert.equal(typeof v.running, 'number')
  const nope = await call('volume_jobs', { action: 'drop', name: 'ComfyUI-Pull-vol-nope' })
  assert.equal(nope.result.isError, true); assert.match(textOf(nope), /No interrupted volume job pod/)
  const noName = await call('volume_jobs', { action: 'drop' })
  assert.equal(noName.result.isError, true); assert.match(textOf(noName), /name/)
})

test('rate_limit_status: local state (no request to RunPod): not limited, with the fields the banner reads; object answers carry no rate_limited while it is not limited', async () => {
  const r = await call('rate_limit_status', {})
  assert.ok(!r.result.isError); const s = JSON.parse(first(r))
  assert.equal(s.limited, false); assert.ok('window' in s && 'retry_at' in s && 'stale_age_s' in s)
  const g = await call('agent_guard_status', {})   // an object answer: no rate_limited field while RunPod does not limit
  if (!g.result.isError) assert.ok(!('rate_limited' in JSON.parse(first(g))))
})

test('the wanted-models list: add by entries and by CSV, list, remove; loading spends and needs the named yes', async () => {
  const add = await call('models_wanted_add', { items: [{ folder: 'vae', repo: 'a/b', path: 'x.safetensors', bytes: 5 }, { folder: 'loras/ltx2', repo: 'a/b', path: 'l/y.safetensors', bytes: 7 }] })
  assert.ok(!add.result.isError); assert.equal(JSON.parse(first(add)).added, 2)
  const bad = await call('models_wanted_add', { items: [{ folder: 'custom_nodes', repo: 'a/b', path: 'z.safetensors' }] })
  assert.equal(bad.result.isError, true); assert.match(textOf(bad), /Not a models folder/)
  const csv = await call('models_wanted_add', { csv: 'pipeline,install_to,file,hf_repo,hf_path,bytes,notes\nltx,unet/,q.gguf,c/d,q.gguf,9,' })
  assert.equal(JSON.parse(first(csv)).added, 1)
  const plain = JSON.parse(first(await call('models_wanted', { plain: true }))).models
  assert.deepEqual(plain.map((m) => `${m.folder}/${m.name}`).sort(), ['loras/ltx2/y.safetensors', 'unet/q.gguf', 'vae/x.safetensors'])
  const key = 'a/b|x.safetensors|vae'
  assert.equal(JSON.parse(first(await call('models_wanted_remove', { keys: [key] }))).removed, 1)
  const loaded = await call('models_load_wanted', { volume_id: 'vol1' })
  assert.equal(loaded.result.isError, true); assert.match(textOf(loaded), /approved_by/)   // spends: the named yes is on in this server
  assert.equal(JSON.parse(first(await call('models_wanted_remove', { all: true }))).models.length, 0)
})

test('pod_retry_options: what the Retry Later popup offers, in one read-only answer, with the waits already on the pod', async () => {
  const tool = (await rpc('tools/list')).result.tools.find((t) => t.name === 'pod_retry_options')
  assert.ok(tool, 'pod_retry_options is served'); assert.deepEqual(tool.inputSchema.required, ['pod_id'])
  assert.match(tool.description, /NOT stopped or deleted/); assert.match(tool.description, /create_pod \{ like_pod_id, gpu, approved_by, retry_until_free: true \}/)
  const made = jsonOf(ok(await call('create_pod', { name: 'Opts-Pod', gpu: 'a40', approved_by: 'Lucas' })))
  const o = jsonOf(await call('pod_retry_options', { pod_id: made.id }))
  assert.equal(o.pod.id, made.id); assert.equal(o.pod.name, 'Opts-Pod')
  assert.match(o.same_gpu.how, /resume_pod/); assert.match(o.another_gpu.how, /create_pod \{ like_pod_id/); assert.match(o.another_gpu.how, /not stopped or deleted/)
  assert.ok(Array.isArray(o.another_gpu.cards)); assert.deepEqual(o.waiting, [])
  assert.match(textOf(refused(await call('pod_retry_options', { pod_id: 'no-such-pod' }))), /./)
})

test('Retry Later: resume_pod and create_pod take retry_until_free; pod_watch lists and cancels the watches (kept in a file)', async () => {
  const tools = (await rpc('tools/list')).result.tools
  for (const name of ['resume_pod', 'create_pod']) {
    const props = tools.find((t) => t.name === name).inputSchema.properties
    for (const k of ['retry_until_free', 'every_minutes', 'give_up_hours']) assert.ok(props[k], `${name} has ${k}`)
  }
  assert.match(tools.find((t) => t.name === 'resume_pod').description, /retry_until_free: true keeps trying/)
  assert.match(tools.find((t) => t.name === 'create_pod').inputSchema.properties.like_pod_id.description, /old pod is NOT stopped or deleted/)   // Retry Later: another GPU (ADR-042 section 19)
  assert.match(tools.find((t) => t.name === 'recreate_pod').description, /TERMINATED with its container disk/)

  const none = jsonOf(await call('pod_watch')); assert.equal(none.waiting, 0); assert.deepEqual(none.watches, [])
  // a watch as the app or an earlier session left it in the file
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString()
  const watch = (id, kind, extra) => ({ id, kind, state: 'waiting', name: `n-${id}`, label: 'Waiting for a free A100 SXM in EU-RO-1', every_s: 120, created_at: iso(now), next_at: iso(now + 600000), give_up_at: iso(now + 43200000), attempts: 2, ...extra })
  writeFileSync(join(dir, 'pod-watches.json'), JSON.stringify({ watches: [watch('w-resume', 'resume', { pod_id: 'pod-x' }), watch('w-create', 'create', { request: { name: 'n-w-create' } })] }))
  const listed = jsonOf(await call('pod_watch', { action: 'list' }))
  assert.equal(listed.waiting, 2); assert.deepEqual(listed.watches.map((w) => [w.id, w.kind, w.state]), [['w-resume', 'resume', 'waiting'], ['w-create', 'create', 'waiting']])

  // the waits on one pod's card: its resume watch and the creates made like it (by from_pod_id, or by the name a watch saved before that carries)
  writeFileSync(join(dir, 'pod-watches.json'), JSON.stringify({ watches: [watch('w-resume', 'resume', { pod_id: 'pod-x', name: 'Pod-X' }), watch('w-like', 'create', { name: 'Pod-X-RTX-4090', from_pod_id: 'pod-x' }), watch('w-old', 'create', { name: 'Pod-X-A100-PCIe' }), watch('w-other', 'create', { name: 'Elsewhere-RTX', from_pod_id: 'pod-y' })] }))
  const mine = jsonOf(await call('pod_watch', { action: 'list', pod_id: 'pod-x' }))
  assert.deepEqual(mine.watches.map((w) => w.id).sort(), ['w-like', 'w-resume'])   // pod-x is not a pod the app knows here, so only the id rule applies: the one saved without from_pod_id needs its name
  assert.equal(mine.watches.find((w) => w.id === 'w-like').from_pod_id, 'pod-x')
  writeFileSync(join(dir, 'pod-watches.json'), JSON.stringify({ watches: [watch('w-resume', 'resume', { pod_id: 'pod-x' }), watch('w-create', 'create', { request: { name: 'n-w-create' } })] }))
  assert.equal(jsonOf(await call('pod_watch', { action: 'cancel', pod_id: 'pod-x' })).watch.state, 'cancelled')   // a resume watch, by its pod
  const c = jsonOf(await call('pod_watch', { action: 'cancel', id: 'w-create' }))
  assert.equal(c.cancelled, 'w-create')
  assert.equal(jsonOf(await call('pod_watch')).waiting, 0)
  assert.match(textOf(refused(await call('pod_watch', { action: 'cancel', id: 'nope' }))), /No such watch/)
  assert.match(textOf(refused(await call('pod_watch', { action: 'delete' }))), /action must be/)
})

test('auto_sync: get, set needs the named yes, status, pause; create_pod takes auto_sync (ADR-046)', async () => {
  const tools = (await rpc('tools/list')).result.tools
  assert.ok(tools.find((t) => t.name === 'volume_changes').inputSchema.properties.since); assert.ok(tools.find((t) => t.name === 'auto_sync').inputSchema.properties.approved_by)
  for (const n of ['create_pod', 'import_round', 'import_rounds', 'plan_round_import']) assert.ok(tools.find((t) => t.name === n).inputSchema.properties.auto_sync || tools.find((t) => t.name === n).inputSchema.properties.rounds, n)
  for (const n of ['get_configuration', 'set_configuration', 'preview_configuration', 'get_pod_config', 'set_pod_config']) assert.match(tools.find((t) => t.name === n).description, /auto_sync/, n)
  const g0 = jsonOf(await call('auto_sync', { action: 'get', pod_id: 'pod-as' })); delete g0.dry_run; assert.deepEqual(g0, { enabled: false, pull: true, push: false, approved_by: '' })
  assert.match(textOf(refused(await call('auto_sync', { action: 'set', pod_id: 'pod-as', enabled: true }))), /name of who says yes/)
  assert.match(textOf(refused(await call('auto_sync', { action: 'get' }))), /pod_id is needed/)
  assert.match(textOf(refused(await call('auto_sync', { action: 'nope' }))), /action must be/)
  const on = jsonOf(await call('auto_sync', { action: 'set', pod_id: 'pod-as', enabled: true, push: false, approved_by: 'Lucas' }))
  assert.equal(on.enabled, true); assert.equal(on.approved_by, 'Lucas')
  const st = jsonOf(await call('auto_sync', { action: 'status' })); assert.equal(st.paused, false); assert.ok(st.items.some((i) => i.pod_id === 'pod-as'))
  assert.equal(jsonOf(await call('auto_sync', { action: 'pause', on: true })).paused, true); assert.equal(jsonOf(await call('auto_sync', { action: 'pause', on: false })).paused, false)
  jsonOf(await call('auto_sync', { action: 'set', pod_id: 'pod-as', enabled: false }))
  // a pod made with auto_sync: the named yes is approved_by
  const made = jsonOf(ok(await call('create_pod', { name: 'AS-Pod', approved_by: 'Lucas', auto_sync: true })))
  assert.equal(made.auto_sync.enabled, true); assert.equal(made.auto_sync.pull, true); assert.equal(made.auto_sync.push, false); assert.equal(made.auto_sync.approved_by, 'Lucas')
  assert.equal(jsonOf(await call('auto_sync', { action: 'get', pod_id: made.id })).enabled, true)
})

test('sync_runs: active, recent, log, watch (ADR-046)', async () => {
  assert.deepEqual(jsonOf(await call('sync_runs', {})).items.filter((i) => i.pod_id === 'no-pod'), [])
  assert.ok(Array.isArray(jsonOf(await call('sync_runs', { action: 'recent', limit: 5 })).runs))
  const w = jsonOf(await call('sync_runs', { action: 'watch' })); assert.deepEqual(Object.keys(w).filter((k) => k !== 'dry_run').sort(), ['events', 'paused', 'pull', 'push'])
  assert.match(textOf(refused(await call('sync_runs', { action: 'log' }))), /run_id is needed/)
  assert.match(textOf(refused(await call('sync_runs', { action: 'log', run_id: 'sr-none' }))), /No such sync run/)
  assert.match(textOf(refused(await call('sync_runs', { action: 'bogus' }))), /action must be/)
})

test('render_sequences: plan, errors and status (ADR-048)', async () => {
  const seq = { dir: 'proxy_v004/shotA', name: "A B's;x_23.976_", first: 0, last: 9, frames: 10, pad: 4 }
  assert.match(textOf(refused(await call('render_sequences', { action: 'bogus' }))), /action must be/)
  assert.match(textOf(refused(await call('render_sequences', { action: 'plan', pod_id: 'p', sequences: [seq], width: 800 }))), /width is source or one of/)
  assert.match(textOf(refused(await call('render_sequences', { action: 'start', pod_id: 'p', sequences: [seq], kind: 'review' }))), /needs the name of who says yes/)
  assert.match(textOf(refused(await call('render_sequences', { action: 'start', pod_id: 'p', sequences: [seq], kind: 'review', approved_by: 'L', allow_partial: true }))), /allow_partial is not available/)
  const tl = (await rpc('tools/list')).result.tools; assert.ok(tl.find((x) => x.name === 'render_sequences').inputSchema.properties.codecs); for (const n of ['get_configuration', 'set_configuration', 'preview_configuration', 'get_pod_config', 'set_pod_config']) assert.match(tl.find((x) => x.name === n).description, /render \{ where, kind/, n)
  assert.match(textOf(refused(await call('render_sequences', { action: 'plan', pod_id: 'p', sequences: [{ ...seq, dir: '../x' }], width: 960 }))), /Not a folder/)
  const p = jsonOf(await call('render_sequences', { action: 'plan', pod_id: 'pod-none', sequences: [seq], kind: 'proxy', width: 960, where: 'auto' }))   // the shipped default kind is review; this test is of the quick proxy
  assert.ok(Array.isArray(p.adapters) && p.adapters.length === 2); assert.equal(p.sequences[0].out, "output/.proxies/proxy_v004/shotA/A B's;x_23.976__960.mp4"); assert.equal(p.settings.proxy_width, 'source')
  assert.deepEqual(jsonOf(await call('render_sequences', { action: 'status' })).jobs.filter((j) => j.pod_id === 'zzz'), [])
  assert.match(textOf(refused(await call('render_sequences', { action: 'cancel' }))), /job_id is needed/)
})

test('sync takes exclude; sync_folders lists and measures; the configuration tools mention sync_exclude (ADR-011)', async () => {
  const tl = (await rpc('tools/list')).result.tools
  assert.equal(tl.find((t) => t.name === 'sync').inputSchema.properties.exclude.type, 'array'); assert.equal(tl.find((t) => t.name === 'sync').inputSchema.properties.delete_excluded.type, 'boolean'); for (const n of ['get_configuration', 'set_configuration', 'preview_configuration', 'get_pod_config', 'set_pod_config']) assert.match(tl.find((x) => x.name === n).description, /folder_excludes.*sync_exclude_delete/, n); assert.ok(tl.find((t) => t.name === 'sync_folders').inputSchema.properties.measure)
  for (const n of ['get_configuration', 'set_configuration', 'preview_configuration', 'get_pod_config', 'set_pod_config']) assert.match(tl.find((t) => t.name === n).description, /sync_exclude/, n)
  const ex = jsonOf(ok(await call('create_pod', { name: 'EX-Pod', approved_by: 'Lucas' })))
  assert.match(textOf(refused(await call('sync', { pod_id: ex.id, exclude: ['../x'] }))), /exclude: a pattern has no \.\. segment/)
  const sf = jsonOf(await call('sync_folders', { pod_id: 'pod-x' })); assert.ok(Array.isArray(sf.steps)); assert.deepEqual(sf.supports, { exclude: true, delete_excluded: true, folder_excludes: true, measure: true })
  assert.match(textOf(refused(await call('sync_folders', { pod_id: 'pod-x', measure: { step: 'project', name: '..' } }))), /Not a folder name/)
})

test('list_dirs: logical paths, links, volumes (ADR-011)', async () => {
  const tl = (await rpc('tools/list')).result.tools; assert.equal(tl.find((t) => t.name === 'list_dirs').inputSchema.properties.volumes.type, 'boolean')
  const home = jsonOf(await call('list_dirs', {})); assert.ok(Array.isArray(home.dirs)); assert.ok(home.dirs.every((d) => typeof d.link === 'boolean'))
  const v = jsonOf(await call('list_dirs', { volumes: true })); assert.ok(Array.isArray(v.volumes))
  assert.match(textOf(refused(await call('list_dirs', { path: '/no/such/folder/anywhere' }))), /cannot resolve|not a folder/)
})

test('list_dirs takes a filter and returns total (async, capped)', async () => {
  const tl = (await rpc('tools/list')).result.tools; assert.equal(tl.find((t) => t.name === 'list_dirs').inputSchema.properties.filter.type, 'string')
  const r = jsonOf(await call('list_dirs', { filter: 'zzzz-no-such-folder-name' })); assert.deepEqual(r.dirs, []); assert.equal(r.total, 0)
})

test('publish: the masked settings, plan and the confirm rule (ADR-050)', async () => {
  const st = jsonOf(ok(await call('publish', { action: 'settings' })))
  assert.equal(st.s3.ready, false); assert.equal(st.slack.ready, false); assert.equal(st.slack.workspace_name, 'Beinghuman'); assert.match(st.slack.problem, /Incoming Webhook URL for Beinghuman/)
  assert.ok(!JSON.stringify(st).includes('hooks.slack.com/services'))
  assert.deepEqual([st.slack.file_links, st.slack.file_link_count, st.slack.folder_link, st.slack.preview_frame, st.slack.volume_source], [true, 10, true, true, true])
  assert.match(textOf(refused(await call('publish', { action: 'bogus' }))), /action must be/)
  assert.match(textOf(refused(await call('publish', { action: 'plan', items: ['a.mov'], targets: ['ftp'] }))), /targets is a list/)
  // run without approved_by or confirm: a plan-only answer, nothing sent (here the plan itself refuses: nothing is configured)
  const r = await call('publish', { action: 'run', items: ['a.mov'], targets: ['s3'] })
  assert.ok(/Nothing was sent|not mapped|not configured/.test(textOf(r)))
  assert.match(textOf(refused(await call('publish', { action: 'cancel' }))), /job_id is needed/)
  assert.deepEqual(jsonOf(ok(await call('publish', { action: 'status' }))).jobs, [])
})

test('publish backfill: scan needs valid sources, run needs approved_by and confirm (ADR-050)', async () => {
  assert.match(textOf(refused(await call('publish', { action: 'backfill', step: 'scan', sources: ['nope'] }))), /sources is a list/)
  assert.match(textOf(refused(await call('publish', { action: 'backfill', step: 'bogus' }))), /step must be/)
  assert.match(textOf(refused(await call('publish', { action: 'backfill', step: 'inventory' }))), /No scan has run yet/)
})

test('render_sequences: skip_existing is accepted and the plan reports the totals (ADR-048)', async () => {
  const tl = (await rpc('tools/list')).result.tools; assert.ok(tl.find((x) => x.name === 'render_sequences').inputSchema.properties.skip_existing)
  const seq = { dir: 'a/b', name: 'S_24_x', first: 0, last: 9, frames: 10, pad: 4 }
  const p = jsonOf(await call('render_sequences', { action: 'plan', pod_id: 'pod-none', sequences: [seq], width: 960, where: 'auto', skip_existing: false }))
  assert.equal(p.skip_existing, false); assert.deepEqual(p.totals, { to_render: 1, skipped: 0 })
})

test('publish: items may be a string or { where: "volume", path }; volume and volume_size are actions (ADR-050)', async () => {
  const tl = (await rpc('tools/list')).result.tools.find((x) => x.name === 'publish')
  assert.ok(tl.inputSchema.properties.items.items.anyOf.some((a) => a.type === 'object' && a.properties.where)); assert.ok(tl.inputSchema.properties.path)
  const p = jsonOf(await call('publish', { action: 'plan', items: [{ where: 'volume', path: '../x' }, { where: 'disk', path: 'a' }, 5], targets: ['s3'] }))
  assert.equal(p.refused.length, 3); assert.match(p.refused[0].reason, /Not a path inside the volume/)
  assert.match(textOf(refused(await call('publish', { action: 'volume', dir: '../x' }))), /dir is a folder inside the volume/)
  assert.match(textOf(refused(await call('publish', { action: 'volume_size', path: '' }))), /path is a folder/)
})

test('autopublish: read, cancel and off only; everything that turns it on or sends is a person\'s act (ADR-050)', async () => {
  const st = jsonOf(ok(await call('autopublish', { action: 'status' })))
  assert.equal(st.enabled, false); assert.equal(st.daily_cap, null); assert.deepEqual(st.today, { count: 0, left: null }); assert.deepEqual(st.targets, { s3: true, slack: false, tunnel: false }); assert.deepEqual(st.pending, [])
  const se = jsonOf(ok(await call('autopublish', { action: 'settings' }))); assert.equal(se.target_state.tunnel.ready, false); assert.match(se.target_state.tunnel.problem, /Tunnel is not available yet/)
  assert.deepEqual(jsonOf(ok(await call('autopublish', { action: 'approvals' }))), []); assert.deepEqual(jsonOf(ok(await call('autopublish', { action: 'reviews' }))).reviews, []); assert.equal(jsonOf(ok(await call('autopublish', { action: 'off' }))).cancelled, 0)
  for (const [a, re] of [['approve', /Approval is a person's act: use the window/], ['revoke', /Approval is a person's act/], ['enable', /person's act with a name/], ['go_live', /person's act with a name/], ['publish_now', /Publish now is a person's explicit, named click/], ['targets', /Where Auto-publish sends is chosen in the window, by a person/]]) assert.match(textOf(refused(await call('autopublish', { action: a }))), re)
  assert.match(textOf(refused(await call('autopublish', { action: 'cancel' }))), /id is needed/); assert.match(textOf(refused(await call('autopublish', { action: 'bogus' }))), /action must be/)
  const r = await call('set_configuration', { patch: { auto_publish: { enabled: true } } }); assert.equal(r.result.isError, true); assert.match(textOf(r), /turned on in the window, by a person/)
  const t = await call('set_configuration', { patch: { auto_publish: { targets: { slack: true } } } }); assert.match(textOf(t), /Where Auto-publish sends is chosen in the window/)
  assert.match(textOf(await call('set_configuration', { patch: { auto_publish: { dry_run_first: false } } })), /turned on in the window, by a person/)
  assert.match(textOf(await call('set_configuration', { patch: { auto_publish: { dry_run: false } } })), /turned on in the window, by a person/)
  assert.equal(jsonOf(ok(await call('set_configuration', { patch: { auto_publish: { window_minutes: 20, daily_cap: 4 } } }))).saved, true)
})

test('list_outputs: the All outputs mode is a parameter, and a job can be asked about (ADR-045)', async () => {
  const props = (await rpc('tools/list')).result.tools.find((x) => x.name === 'list_outputs').inputSchema.properties
  for (const k of ['all', 'job', 'job_id', 'cancel_job']) assert.ok(props[k], k)
  assert.match(textOf(refused(await call('list_outputs', { job_id: 'nope' }))), /No such outputs listing/)
})

test('configuration: render.pull/skip_existing/publish and outputs.hide_empty_folders are plain preferences an agent may change (ADR-048)', async () => {
  const c = jsonOf(ok(await call('get_configuration', {}))); const cfg = c.configuration ?? c
  const saved = jsonOf(ok(await call('set_configuration', { patch: { render: { where: 'local', pull: true, skip_existing: false, publish: { s3: true, slack: false } }, outputs: { hide_empty_folders: false } } })))
  assert.equal(saved.saved, true)
  const after = jsonOf(ok(await call('preview_configuration', { patch: {} }))); assert.deepEqual(after.config.render.publish, { s3: true, slack: false }); assert.equal(after.config.render.skip_existing, false); assert.equal(after.config.outputs.hide_empty_folders, false)
  assert.match(textOf(refused(await call('set_configuration', { patch: { render: { publish: { s3: false, slack: true } } } }))), /Slack announces an upload: turn S3 on/)
  assert.equal(typeof cfg, 'object')
  await call('reset_configuration', {})
})

test('import tools take generate_outputs and publish (Import Round options): documented, validated like the window, never without a named person; an agent can publish through an import', async () => {
  const tools = (await rpc('tools/list')).result.tools
  for (const n of ['plan_round_import', 'import_round', 'import_rounds']) {
    const p = tools.find((x) => x.name === n).inputSchema.properties
    assert.ok(p.generate_outputs, n); assert.ok(p.publish, n); assert.match(p.publish.description, /needs generate_outputs/); assert.match(p.publish.description, /locked shot/)
  }
  const per = tools.find((x) => x.name === 'import_rounds').inputSchema.properties.rounds.items.properties
  assert.ok(per.generate_outputs && per.publish)
  const base = { round: 'proxy_v005', source: 'volume', volume_id: 'vol1' }
  // the same plain 400s as the window
  const noGen = await call('plan_round_import', { ...base, publish: true })
  assert.equal(noGen.result.isError, true); assert.match(textOf(noGen), /Publish needs Generate Outputs/)
  const noRun = await call('plan_round_import', { ...base, run_workflows: false, generate_outputs: true })
  assert.equal(noRun.result.isError, true); assert.match(textOf(noRun), /Generate Outputs needs Run Workflows/)
  const slack = await call('plan_round_import', { ...base, generate_outputs: true, publish: { s3: false, slack: true } })
  assert.equal(slack.result.isError, true); assert.match(textOf(slack), /Slack only follows an S3 upload/)
  // a name is needed for the new options (even when the named-yes setting is off); publish itself is not refused (no 403)
  const noName = await call('import_round', { ...base, generate_outputs: true })
  assert.equal(noName.result.isError, true); assert.match(textOf(noName), /approved_by/)
  const noNameMany = await call('import_rounds', { ...base, rounds: [{ round: 'proxy_v005', publish: true }] })
  assert.equal(noNameMany.result.isError, true); assert.match(textOf(noNameMany), /approved_by/)
  const dep = await call('import_round', { ...base, publish: true, approved_by: 'Lucas' })
  assert.equal(dep.result.isError, true); assert.match(textOf(dep), /Publish needs Generate Outputs/); assert.doesNotMatch(textOf(dep), /403|person's act/)
  // all valid: it gets past the options; the destination is not set up in this test world, so it is a 400 with the reason, and nothing is queued
  const notReady = await call('import_round', { ...base, generate_outputs: true, publish: true, approved_by: 'Lucas' })
  assert.equal(notReady.result.isError, true); assert.doesNotMatch(textOf(notReady), /Publish needs|Generate Outputs needs|give approved_by|person's act/)
  // the plan carries what would be generated and published
  const ok = await call('plan_round_import', { ...base, generate_outputs: true, publish: true })
  if (!ok.result.isError) { const pl = JSON.parse(first(ok)); assert.equal(pl.generate_outputs, true); assert.deepEqual(pl.publish, { s3: true, slack: false }) }
})
