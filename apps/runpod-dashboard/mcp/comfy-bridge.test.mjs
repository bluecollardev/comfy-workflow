// The ComfyUI bridge end to end: a fake ComfyUI HTTP server in this process (the calls in docs/COMFY-API.md),
// the bridge spawned as Claude Code spawns it and driven over stdio with raw JSON-RPC through every tool,
// including the locked-shot refusal (a scratch project tree with 04_TRACKER/shots.csv) and wait_for_prompt
// completing; then one initialize + tools/list over the HTTP transport. No pod, no RunPod, no key.
// Run: npm run mcp:test (builds the core first) or node --test mcp/comfy-bridge.test.mjs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BRIDGE = resolve(dirname(fileURLToPath(import.meta.url)), 'comfy-bridge.mjs')
const dir = mkdtempSync(join(tmpdir(), 'comfy-bridge-'))
const tree = join(dir, 'CANALV2')

// ----- the fake ComfyUI -----
const OBJECT_INFO = {
  KSampler: { input: { required: { model: ['MODEL'], seed: ['INT', { default: 0 }], sampler_name: [['euler', 'dpmpp_2m']] }, optional: {} }, output: ['LATENT'], output_name: ['LATENT'], name: 'KSampler', display_name: 'KSampler', category: 'sampling' },
  LoadImage: { input: { required: { image: [['a.png']] } }, output: ['IMAGE', 'MASK'], output_name: ['IMAGE', 'MASK'], name: 'LoadImage', display_name: 'Load Image', category: 'image' },
}
const workflows = new Map([
  ['CANALV2_corrosion/corrosion-051_graph_v015.json', JSON.stringify({ nodes: [{ id: 1, type: 'LoadImage' }], links: [] })],
  ['basic_t2i.json', JSON.stringify({ nodes: [], links: [] })],
])
const fake = { prompts: [], history: new Map([['p-done', { polls: 9, outputs: { 9: { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] } } }]]), interrupts: 0 }
const COMPLETES_AFTER = 2   // GET /history/<id> answers empty this many times, then the finished entry
const entryOf = (id, e) => ({ prompt: [0, id, {}, {}, []], outputs: e.outputs, status: { status_str: 'success', completed: true, messages: [['execution_start', { prompt_id: id }]] } })
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })
const reply = (res, status, body, type = 'application/json') => { const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body); res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }

const comfy = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  if (p === '/system_stats') return reply(res, 200, { system: { os: 'posix', comfyui_version: '0.3.60', python_version: '3.12.3', pytorch_version: '2.5.1' }, devices: [{ name: 'cuda:0 NVIDIA RTX A4000', type: 'cuda', index: 0, vram_total: 17171480576, vram_free: 16000000000 }] })
  if (p === '/api/object_info' || p === '/object_info') return reply(res, 200, OBJECT_INFO)
  if (p === '/api/userdata' && req.method === 'GET') return url.searchParams.get('dir') === 'workflows' ? reply(res, 200, [...workflows.keys()]) : reply(res, 404, 'no such dir', 'text/plain')
  if (p.startsWith('/api/userdata/')) {
    const rel = decodeURIComponent(p.slice('/api/userdata/'.length)).replace(/^workflows\//, '')
    if (req.method === 'GET') return workflows.has(rel) ? reply(res, 200, workflows.get(rel)) : reply(res, 404, 'not found', 'text/plain')
    if (req.method === 'POST') {
      if (workflows.has(rel) && url.searchParams.get('overwrite') !== 'true') return reply(res, 409, 'File already exists', 'text/plain')
      workflows.set(rel, await readBody(req)); return reply(res, 200, JSON.stringify('workflows/' + rel))
    }
  }
  if (p === '/prompt' && req.method === 'POST') {
    const { prompt, client_id } = JSON.parse(await readBody(req))
    const badNode = Object.entries(prompt).find(([, n]) => !OBJECT_INFO[n.class_type])
    if (badNode) return reply(res, 400, { error: { type: 'invalid_prompt', message: 'Cannot execute because a node is missing the class_type property.' }, node_errors: { [badNode[0]]: { errors: [{ type: 'invalid_class_type', message: `Node ${badNode[0]} has class_type ${badNode[1].class_type}, which is not in object_info` }], class_type: badNode[1].class_type } } })
    const id = `p-${fake.prompts.length + 1}`
    fake.prompts.push({ id, prompt, client_id })
    fake.history.set(id, { polls: 0, outputs: { 9: { images: [{ filename: `${id}_00001_.png`, subfolder: 'runs', type: 'output' }] }, 10: { text: ['not a file'] } } })
    return reply(res, 200, { prompt_id: id, number: fake.prompts.length, node_errors: {} })
  }
  if (p === '/queue') return reply(res, 200, { queue_running: [[1, 'p-running', { 1: {}, 2: {} }, {}, []]], queue_pending: [[2, 'p-pending', { 1: {} }, {}, []]] })
  if (p === '/history') return reply(res, 200, Object.fromEntries([...fake.history].filter(([, e]) => e.polls >= COMPLETES_AFTER).map(([id, e]) => [id, entryOf(id, e)])))
  if (p.startsWith('/history/')) {
    const id = decodeURIComponent(p.slice('/history/'.length))
    const e = fake.history.get(id)
    if (!e) return reply(res, 200, {})
    e.polls++
    return reply(res, 200, e.polls > COMPLETES_AFTER ? { [id]: entryOf(id, e) } : {})
  }
  if (p === '/interrupt' && req.method === 'POST') { fake.interrupts++; return reply(res, 200, '') }
  if (p === '/view') {
    const f = url.searchParams.get('filename') || ''
    if (f.endsWith('.txt')) return reply(res, 200, `notes for ${url.searchParams.get('subfolder') || 'root'}: hello`, 'text/plain; charset=utf-8')
    if (f.endsWith('.png')) return reply(res, 200, Buffer.alloc(4096, 1), 'image/png')
    return reply(res, 404, 'not found', 'text/plain')
  }
  reply(res, 404, `fake ComfyUI: no route ${req.method} ${p}`, 'text/plain')
})

// ----- the bridge over stdio -----
let child, comfyUrl, nextId = 1
const pending = new Map()
const stderr = []
const env = () => ({ ...process.env, COMFY_URL: comfyUrl, RUNPOD_DRY_RUN: '1', POD_MANAGER_CONFIG_DIR: dir, RUNPOD_API_KEY: '', COMFY_POLL_MS: '30', MCP_HTTP_PORT: '' })

before(async () => {
  await new Promise((r) => comfy.listen(0, '127.0.0.1', r))
  comfyUrl = `http://127.0.0.1:${comfy.address().port}`
  // The project tree the Default Configuration maps, with the tracker: cgi-042 is client-approved and locked.
  mkdirSync(join(tree, '04_TRACKER'), { recursive: true })
  writeFileSync(join(tree, '04_TRACKER', 'shots.csv'), 'shot,type,assigned_by,received,due,state,hero_eye,locked,next_action,folder\ncgi-042,cgi,Kyle,2026-10-01,,approved,left,yes,,10_CORROSION/cgi-042\ncorrosion-051,corrosion,Binc,2026-10-05,,open,left,,,10_CORROSION/corrosion-051\n')
  writeFileSync(join(dir, 'mounts.json'), JSON.stringify({ folders: { project: tree } }))
  child = spawn(process.execPath, [BRIDGE], { env: env(), stdio: ['pipe', 'pipe', 'pipe'] })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line)
    if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  createInterface({ input: child.stderr }).on('line', (line) => stderr.push(line))
})
after(() => { child.kill(); comfy.close(); rmSync(dir, { recursive: true, force: true }) })

const rpc = (method, params = {}) => new Promise((resolve) => {
  const id = nextId++
  pending.set(id, resolve)
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
const notify = (method, params = {}) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args })
const textOf = (r) => r.result.content.map((c) => c.text).join('\n')
const jsonOf = (r) => JSON.parse(textOf(r))
const ok = (r) => { assert.equal(r.error, undefined, JSON.stringify(r.error)); assert.notEqual(r.result.isError, true, textOf(r)); return r }
const refused = (r) => { assert.equal(r.error, undefined); assert.equal(r.result.isError, true, textOf(r)); return r }

test('initialize hands over governance, names the target and says the bridge cannot spend', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
  assert.equal(r.error, undefined)
  assert.equal(r.result.serverInfo.name, 'comfy-bridge')
  assert.match(r.result.instructions, /^# Governance \(applied to this session\)/)
  assert.match(r.result.instructions, /## policy\/agent-permissions\.md/)
  assert.ok(r.result.instructions.includes(`Target ComfyUI: ${comfyUrl} (COMFY_URL)`), r.result.instructions.slice(-400))
  assert.match(r.result.instructions, /This bridge cannot spend/)
  notify('notifications/initialized')
})

test('tools/list is the spec\'s table', async () => {
  const r = await rpc('tools/list')
  assert.deepEqual(r.result.tools.map((t) => t.name), ['comfy_status', 'list_workflows', 'get_workflow', 'save_workflow', 'search_nodes', 'queue_prompt', 'get_queue', 'get_history', 'interrupt', 'get_output', 'wait_for_prompt'])
  assert.deepEqual(r.result.tools.find((t) => t.name === 'queue_prompt').inputSchema.required, ['prompt'])
})

test('comfy_status: the target, versions, devices, nodes loaded, and which tracker decides locked shots', async () => {
  const s = jsonOf(ok(await call('comfy_status')))
  assert.equal(s.target, comfyUrl); assert.equal(s.target_from, 'COMFY_URL')
  assert.equal(s.system.comfyui_version, '0.3.60'); assert.equal(s.devices[0].type, 'cuda'); assert.equal(s.devices[0].vram_total, 17171480576)
  assert.equal(s.nodes_loaded, true); assert.equal(s.node_count, 2)
  assert.equal(s.locked_shots.tracker, join(tree, '04_TRACKER', 'shots.csv')); assert.equal(s.locked_shots.found, true); assert.deepEqual(s.locked_shots.shots, ['cgi-042'])
  assert.equal(s.locked_shots.project_from, 'the Default Configuration')
})

test('workflows: list, list one folder, read, save, refused on an existing path, overwrite', async () => {
  const all = jsonOf(ok(await call('list_workflows')))
  assert.deepEqual(all.files, ['CANALV2_corrosion/corrosion-051_graph_v015.json', 'basic_t2i.json']); assert.equal(all.count, 2)
  const one = jsonOf(ok(await call('list_workflows', { folder: 'CANALV2_corrosion/' })))
  assert.deepEqual(one.files, ['CANALV2_corrosion/corrosion-051_graph_v015.json'])

  const g = JSON.parse(textOf(ok(await call('get_workflow', { path: 'CANALV2_corrosion/corrosion-051_graph_v015.json' }))))
  assert.equal(g.nodes[0].type, 'LoadImage')
  assert.match(textOf(refused(await call('get_workflow', { path: 'nope.json' }))), /^No workflow nope\.json/)

  assert.match(textOf(ok(await call('save_workflow', { path: 'CANALV2_corrosion/corrosion-051_graph_v016', workflow: { nodes: [], links: [] } }))), /^✓ Saved workflows\/CANALV2_corrosion\/corrosion-051_graph_v016\.json/)
  assert.ok(workflows.has('CANALV2_corrosion/corrosion-051_graph_v016.json'))
  assert.match(textOf(refused(await call('save_workflow', { path: 'basic_t2i.json', workflow: '{"nodes":[1]}' }))), /^Refused: basic_t2i\.json exists/)
  assert.equal(workflows.get('basic_t2i.json'), JSON.stringify({ nodes: [], links: [] }))
  assert.match(textOf(ok(await call('save_workflow', { path: 'basic_t2i.json', workflow: '{"nodes":[1]}', overwrite: true }))), /\(replaced\)$/)
  assert.equal(workflows.get('basic_t2i.json'), '{"nodes":[1]}')
  refused(await call('save_workflow', { path: 'x.json', workflow: 'not json' }))
})

test('search_nodes matches name, display name or category and shows the inputs', async () => {
  const s = jsonOf(ok(await call('search_nodes', { query: 'ksampler' })))
  assert.equal(s.matches, 1); assert.equal(s.nodes[0].name, 'KSampler'); assert.equal(s.nodes[0].inputs.required.seed, 'INT'); assert.equal(s.nodes[0].inputs.required.sampler_name, 'choice[2]'); assert.deepEqual(s.nodes[0].outputs, ['LATENT'])
  const byCat = jsonOf(ok(await call('search_nodes', { query: 'image', limit: 1 })))
  assert.equal(byCat.matches, 1); assert.equal(byCat.nodes[0].display_name, 'Load Image')
  assert.equal(jsonOf(ok(await call('search_nodes', { query: 'zzz' }))).matches, 0)
})

test('queue_prompt refuses a graph that names a locked shot and queues nothing', async () => {
  const before = fake.prompts.length
  const r = refused(await call('queue_prompt', { prompt: { 1: { class_type: 'LoadImage', inputs: { image: '/srv/plates/cgi-042_3D/cgi-042_3D.LEFT.000001.dpx' } } } }))
  assert.match(textOf(r), /^Refused: the graph names locked shot cgi-042, and locked \(client-approved\) shots are never run by us/)
  assert.match(textOf(r), /locked = yes in .*04_TRACKER\/shots\.csv/); assert.match(textOf(r), /Nothing was queued/)
  assert.equal(fake.prompts.length, before)
  // the same shot as text in a note, and as the graph's string form
  refused(await call('queue_prompt', { prompt: JSON.stringify({ 2: { class_type: 'KSampler', inputs: { note: 'from cgi-042_graph_v003_api.json' } } }) }))
  assert.equal(fake.prompts.length, before)
})

test('queue_prompt queues an open shot, reports a 400 with the invalid node, and rejects a UI graph', async () => {
  const q = jsonOf(ok(await call('queue_prompt', { prompt: { 1: { class_type: 'LoadImage', inputs: { image: 'corrosion-051_3D.LEFT.093999.dpx' } }, 2: { class_type: 'KSampler', inputs: { seed: 1 } } } })))
  assert.equal(q.prompt_id, 'p-1'); assert.equal(q.number, 1); assert.deepEqual(q.shots_named, ['corrosion-051']); assert.equal(q.status_url, `${comfyUrl}/history/p-1`)
  assert.equal(fake.prompts[0].client_id, 'runpod-pod-manager-bridge')
  const bad = refused(await call('queue_prompt', { prompt: { 7: { class_type: 'Bogus', inputs: {} } }, client_id: 'me' }))
  assert.match(textOf(bad), /^ComfyUI refused the graph \(HTTP 400\)/); assert.match(textOf(bad), /"7"/); assert.match(textOf(bad), /invalid_class_type/)
  assert.match(textOf(refused(await call('queue_prompt', { prompt: { nodes: [], links: [] } }))), /UI graph/)
  assert.match(textOf(refused(await call('queue_prompt', { prompt: '{nope' }))), /not valid JSON/)
})

test('get_queue, get_history (newest and one), interrupt', async () => {
  const q = jsonOf(ok(await call('get_queue')))
  assert.equal(q.busy, true); assert.deepEqual(q.running, [{ number: 1, prompt_id: 'p-running', nodes: 2 }]); assert.equal(q.pending[0].prompt_id, 'p-pending')
  const h = jsonOf(ok(await call('get_history', { max_items: 5 })))
  assert.equal(h.runs.find((r) => r.prompt_id === 'p-done').outputs[0].filename, 'ComfyUI_00001_.png')
  const one = jsonOf(ok(await call('get_history', { prompt_id: 'p-done' })))
  assert.equal(one.status, 'success'); assert.equal(one.completed, true); assert.deepEqual(one.outputs, [{ node: '9', kind: 'images', filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }])
  const none = jsonOf(ok(await call('get_history', { prompt_id: 'p-nowhere' })))
  assert.equal(none.status, 'pending'); assert.equal(none.completed, false)
  assert.match(textOf(ok(await call('interrupt'))), /^✓ Interrupt sent/); assert.equal(fake.interrupts, 1)
})

test('get_output: small text inline, a binary as its URL and size', async () => {
  const t = jsonOf(ok(await call('get_output', { filename: 'notes.txt', subfolder: 'runs' })))
  assert.equal(t.text, 'notes for runs: hello'); assert.equal(t.url, `${comfyUrl}/view?filename=notes.txt&subfolder=runs&type=output`)
  const b = jsonOf(ok(await call('get_output', { filename: 'p-1_00001_.png', subfolder: 'runs', type: 'output' })))
  assert.equal(b.size, 4096); assert.equal(b.content_type, 'image/png'); assert.equal(b.text, undefined); assert.match(b.url, /\/view\?filename=p-1_00001_\.png/)
  refused(await call('get_output', { filename: 'missing.exr' }))
})

test('wait_for_prompt polls history until the prompt finishes, and times out otherwise', async () => {
  const w = jsonOf(ok(await call('wait_for_prompt', { prompt_id: 'p-1', timeout_s: 5 })))
  assert.equal(w.completed, true); assert.deepEqual(w.outputs, [{ node: '9', kind: 'images', filename: 'p-1_00001_.png', subfolder: 'runs', type: 'output' }])
  assert.ok(fake.history.get('p-1').polls > COMPLETES_AFTER)
  const t = refused(await call('wait_for_prompt', { prompt_id: 'p-never', timeout_s: 1 }))
  assert.match(textOf(t), /^Timed out after 1 s: prompt p-never is not in history yet/)
})

test('the governance pages are resources; an unknown tool is an error', async () => {
  const list = await rpc('resources/list')
  assert.ok(list.result.resources.map((r) => r.uri).includes('governance://policy/agent-permissions.md'))
  assert.match(textOf(refused(await call('nothing'))), /^Unknown tool: nothing/)
})

test('nothing but JSON-RPC went to stdout; the banner went to stderr and names the target and the tracker', () => {
  assert.ok(stderr.some((l) => l.includes(`comfy-bridge `) && l.includes(`target ${comfyUrl} (COMFY_URL)`) && l.includes('shots.csv')), stderr.join('\n'))
})

test('over HTTP (--http 0): initialize and tools/list answer the same server at /mcp', async () => {
  const http = spawn(process.execPath, [BRIDGE, '--http', '0'], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const url = await new Promise((resolve, reject) => {
      createInterface({ input: http.stderr }).on('line', (l) => { const m = /on (http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(l); if (m) resolve(m[1]) })
      http.on('exit', (code) => reject(new Error(`bridge exited ${code}`)))
    })
    const post = async (body) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) })
      if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`)
      return r.json()
    }
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '0' } } })
    assert.equal(init.result.serverInfo.name, 'comfy-bridge'); assert.match(init.result.instructions, /This bridge cannot spend/)
    const tools = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    assert.equal(tools.result.tools.length, 11); assert.equal(tools.result.tools[0].name, 'comfy_status')
    const status = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'comfy_status', arguments: {} } })
    assert.equal(JSON.parse(status.result.content[0].text).target, comfyUrl)
    const elsewhere = await fetch(url.replace('/mcp', '/'), { method: 'GET' })
    assert.equal(elsewhere.status, 404)
  } finally { http.kill() }
})
