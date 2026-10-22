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

const TOOL_COUNT = 37
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
const fake = { log: [], prompts: [], history: new Map([['p-done', { polls: 9, outputs: { 9: { images: [{ filename: 'ComfyUI_00001_.png', subfolder: '', type: 'output' }] } } }]]), interrupts: 0 }
const COMPLETES_AFTER = 2   // GET /history/<id> answers empty this many times, then the finished entry
const entryOf = (id, e) => ({ prompt: [0, id, {}, {}, []], outputs: e.outputs, status: { status_str: 'success', completed: true, messages: [['execution_start', { prompt_id: id }]] } })
const readBody = (req) => new Promise((r) => { let b = ''; req.setEncoding('latin1'); req.on('data', (c) => { b += c }); req.on('end', () => r(b)) })
const reply = (res, status, body, type = 'application/json') => { const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body); res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }

const SETTINGS = { 'Comfy.Locale': 'en', 'Comfy.ColorPalette': 'dark' }
const MODELS = { checkpoints: ['sd15.safetensors', 'sub/xl.safetensors'], loras: ['style/foo.safetensors'] }
let managerInstalled = true
// Routes added for the wider bridge; true when answered.
async function extraRoutes(req, res, url, raw) {
  const p = url.pathname.replace(/^\/api(?=\/(?!userdata))/, '')
  const m = req.method
  if (p === '/object_info/KSampler') return reply(res, 200, { KSampler: OBJECT_INFO.KSampler }), true
  if (p.startsWith('/object_info/')) return reply(res, 200, {}), true
  if (p === '/models') return reply(res, 200, Object.keys(MODELS)), true
  if (p.startsWith('/models/')) { const f = MODELS[decodeURIComponent(p.slice(8))]; return (f ? reply(res, 200, f) : reply(res, 404, 'nope', 'text/plain')), true }
  if (p.startsWith('/view_metadata/')) return (url.searchParams.get('filename') === 'style/foo.safetensors' ? reply(res, 200, { ss_base_model: 'sdxl', modelspec: { title: 'foo' } }) : reply(res, 404, 'none', 'text/plain')), true
  if (p === '/embeddings') return reply(res, 200, ['easynegative', 'bad-hands']), true
  if (p === '/extensions') return reply(res, 200, ['/extensions/core/a.js', '/extensions/pack/b.js']), true
  if (p === '/internal/folder_paths') return reply(res, 200, { checkpoints: [['/models/checkpoints'], ['.safetensors']], output: [['/out']] }), true
  if (p === '/prompt' && m === 'GET') return reply(res, 200, { exec_info: { queue_remaining: 3 } }), true
  if (p === '/queue' && m === 'POST') return reply(res, 200, ''), true
  if (p === '/history' && m === 'POST') return reply(res, 200, ''), true
  if (p === '/free' && m === 'POST') return reply(res, 200, ''), true
  if (p === '/features') return reply(res, 200, { supports_preview_metadata: true, max_upload_size: 104857600 }), true
  if (p === '/settings') return reply(res, 200, SETTINGS), true
  if (p.startsWith('/settings/')) return reply(res, 200, JSON.stringify(SETTINGS[decodeURIComponent(p.slice(10))] ?? null)), true
  if (p === '/internal/logs/raw') return reply(res, 200, { entries: [{ t: 'a', m: 'line one\nline two\n' }, { t: 'b', m: 'line three\nline four\n' }], size: { cols: 80, rows: 20 } }), true
  if (p === '/users') return reply(res, 200, { storage: 'server', migrated: true }), true
  if (p === '/upload/image' || p === '/upload/mask') {
    const field = (n) => { const x = new RegExp(`name="${n}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(raw); return x ? x[1] : null }
    const fname = /name="image"; filename="([^"]*)"/.exec(raw)?.[1]
    fake.uploads.push({ route: p, filename: fname, type: field('type'), subfolder: field('subfolder'), overwrite: field('overwrite'), original_ref: field('original_ref'), bytes: /\r\n\r\n([\s\S]*?)\r\n--/.exec(raw.slice(raw.indexOf('filename=')))?.[1] })
    return reply(res, 200, { name: fname, subfolder: field('subfolder') || '', type: field('type') }), true
  }
  if (p === '/api/userdata' && url.searchParams.get('dir') === 'subgraphs') return reply(res, 200, ['sg/a.json']), true
  if (p.startsWith('/api/userdata/') && p.includes('/move/')) {
    const [src, dst] = p.slice('/api/userdata/'.length).split('/move/').map((x) => decodeURIComponent(x).replace(/^workflows\//, ''))
    if (!workflows.has(src)) return reply(res, 404, 'missing', 'text/plain'), true
    if (workflows.has(dst)) return reply(res, 409, 'exists', 'text/plain'), true
    workflows.set(dst, workflows.get(src)); workflows.delete(src)
    return reply(res, 200, JSON.stringify('workflows/' + dst)), true
  }
  if (p.startsWith('/api/userdata/') && m === 'DELETE') {
    const rel = decodeURIComponent(p.slice('/api/userdata/'.length)).replace(/^workflows\//, '')
    return (workflows.delete(rel) ? reply(res, 204, '') : reply(res, 404, 'missing', 'text/plain')), true
  }
  if (p === '/manager/version') return (managerInstalled ? reply(res, 200, 'V3.37', 'text/plain') : reply(res, 404, 'no', 'text/plain')), true
  if (p === '/manager/queue/status') return reply(res, 200, { total_count: 0, done_count: 0, in_progress_count: 0, is_processing: false }), true
  if (p === '/customnode/installed') return (managerInstalled ? reply(res, 200, { 'comfyui-impact-pack': { ver: '8.1', cnr_id: 'comfyui-impact-pack', active: true, enabled: true } }) : reply(res, 404, 'no', 'text/plain')), true
  return false
}
fake.uploads = []

const comfy = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  const raw = await readBody(req)
  fake.log.push({ method: req.method, url: req.url, body: raw })
  const extra = await extraRoutes(req, res, url, raw)
  if (extra) return
  if (p === '/system_stats') return reply(res, 200, { system: { os: 'posix', comfyui_version: '0.3.60', python_version: '3.12.3', pytorch_version: '2.5.1' }, devices: [{ name: 'cuda:0 NVIDIA RTX A4000', type: 'cuda', index: 0, vram_total: 17171480576, vram_free: 16000000000 }] })
  if (p === '/api/object_info' || p === '/object_info') return reply(res, 200, OBJECT_INFO)
  if (p === '/api/userdata' && req.method === 'GET') return url.searchParams.get('dir') === 'workflows' ? reply(res, 200, [...workflows.keys()]) : reply(res, 404, 'no such dir', 'text/plain')
  if (p.startsWith('/api/userdata/')) {
    const rel = decodeURIComponent(p.slice('/api/userdata/'.length)).replace(/^workflows\//, '')
    if (req.method === 'GET') return workflows.has(rel) ? reply(res, 200, workflows.get(rel)) : reply(res, 404, 'not found', 'text/plain')
    if (req.method === 'POST') {
      if (workflows.has(rel) && url.searchParams.get('overwrite') !== 'true') return reply(res, 409, 'File already exists', 'text/plain')
      workflows.set(rel, raw); return reply(res, 200, JSON.stringify('workflows/' + rel))
    }
  }
  if (p === '/prompt' && req.method === 'POST') {
    const { prompt, client_id } = JSON.parse(raw)
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
    if (f === 'huge.png') return reply(res, 200, Buffer.alloc(1024 * 1024 + 10, 1), 'image/png')
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
const textOf = (r) => r.result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n')
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
  const names = r.result.tools.map((t) => t.name)
  for (const old of ['comfy_status', 'list_workflows', 'get_workflow', 'save_workflow', 'search_nodes', 'queue_prompt', 'get_queue', 'get_history', 'interrupt', 'get_output', 'wait_for_prompt']) assert.ok(names.includes(old), old)
  assert.equal(names.length, new Set(names).size); assert.equal(names.length, TOOL_COUNT)
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
  const img = (await call('get_output', { filename: 'p-1_00001_.png', subfolder: 'runs' })).result.content.find((c) => c.type === 'image')
  assert.equal(img.mimeType, 'image/png'); assert.equal(Buffer.from(img.data, 'base64').length, 4096)
  refused(await call('get_output', { filename: 'missing.exr' }))
})

test('wait_for_prompt polls history until the prompt finishes, and times out otherwise', async () => {
  const w = jsonOf(ok(await call('wait_for_prompt', { prompt_id: 'p-1', timeout_s: 5 })))
  assert.equal(w.completed, true); assert.deepEqual(w.outputs, [{ node: '9', kind: 'images', filename: 'p-1_00001_.png', subfolder: 'runs', type: 'output' }])
  assert.ok(fake.history.get('p-1').polls > COMPLETES_AFTER)
  const t = refused(await call('wait_for_prompt', { prompt_id: 'p-never', timeout_s: 1 }))
  assert.match(textOf(t), /^Timed out after 1 s: prompt p-never is not in history yet/)
})

const lastCall = (method, startsWith) => [...fake.log].reverse().find((c) => c.method === method && c.url.startsWith(startsWith))
const confirmRefusal = async (name, args, wantUpstream, mention) => {
  const before = fake.log.length
  const r = refused(await call(name, args))
  assert.match(textOf(r), /^Refused: /); assert.match(textOf(r), mention); assert.match(textOf(r), /confirm: true/)
  assert.equal(fake.log.slice(before).filter((c) => c.method === wantUpstream.method && c.url.startsWith(wantUpstream.url)).length, 0, 'nothing reached ComfyUI')
  refused(await call(name, { ...args, confirm: false }))
}

test('server: get_features, get_settings, get_setting, get_users', async () => {
  assert.equal(jsonOf(ok(await call('get_features'))).supports_preview_metadata, true)
  assert.equal(jsonOf(ok(await call('get_settings')))['Comfy.Locale'], 'en')
  assert.deepEqual(jsonOf(ok(await call('get_setting', { id: 'Comfy.Locale' }))), { id: 'Comfy.Locale', value: 'en' })
  assert.equal(lastCall('GET', '/settings/').url, '/settings/Comfy.Locale')
  assert.equal(jsonOf(ok(await call('get_setting', { id: 'Not.There' }))).value, null)
  assert.equal(jsonOf(ok(await call('get_users'))).storage, 'server')
  refused(await call('get_setting', {}))
})

test('server: get_logs returns the last N lines', async () => {
  const l = jsonOf(ok(await call('get_logs', { lines: 3 })))
  assert.equal(l.total_lines, 4); assert.equal(l.returned, 3); assert.equal(l.log, 'line two\nline three\nline four')
  assert.equal(jsonOf(ok(await call('get_logs'))).returned, 4)
  assert.equal(lastCall('GET', '/internal/logs/raw').url, '/internal/logs/raw')
})

test('nodes: get_node_info asks /object_info/{class}', async () => {
  const n = jsonOf(ok(await call('get_node_info', { class_type: 'KSampler' })))
  assert.equal(n.category, 'sampling'); assert.deepEqual(n.output_name, ['LATENT'])
  assert.equal(lastCall('GET', '/object_info/').url, '/object_info/KSampler')
  assert.match(textOf(refused(await call('get_node_info', { class_type: 'Nope' }))), /^No node class Nope/)
})

test('nodes: model folders, models, metadata, embeddings, extensions, folder paths', async () => {
  assert.deepEqual(jsonOf(ok(await call('list_model_folders'))), ['checkpoints', 'loras'])
  const m = jsonOf(ok(await call('list_models', { folder: 'checkpoints' })))
  assert.deepEqual(m, { folder: 'checkpoints', count: 2, files: ['sd15.safetensors', 'sub/xl.safetensors'] }); assert.equal(lastCall('GET', '/models/').url, '/models/checkpoints')
  assert.match(textOf(refused(await call('list_models', { folder: 'nope' }))), /^No model folder nope/)
  const md = jsonOf(ok(await call('get_model_metadata', { folder: 'loras', filename: 'style/foo.safetensors' })))
  assert.equal(md.ss_base_model, 'sdxl'); assert.equal(lastCall('GET', '/view_metadata/').url, '/view_metadata/loras?filename=style%2Ffoo.safetensors')
  refused(await call('get_model_metadata', { folder: 'loras', filename: 'none.bin' }))
  assert.deepEqual(jsonOf(ok(await call('list_embeddings'))).embeddings, ['easynegative', 'bad-hands'])
  assert.equal(jsonOf(ok(await call('list_extensions'))).count, 2)
  assert.deepEqual(jsonOf(ok(await call('get_folder_paths'))).output, [['/out']])
})

test('queue: get_prompt_info reads the remaining count', async () => {
  const i = jsonOf(ok(await call('get_prompt_info')))
  assert.equal(i.queue_remaining, 3); assert.equal(lastCall('GET', '/prompt').url, '/prompt')
})

test('queue: clear_queue and delete_queue_items post the exact body, and refuse without confirm', async () => {
  await confirmRefusal('clear_queue', {}, { method: 'POST', url: '/queue' }, /every pending prompt/)
  assert.match(textOf(ok(await call('clear_queue', { confirm: true }))), /^✓ Queue cleared/)
  assert.deepEqual(JSON.parse(lastCall('POST', '/queue').body), { clear: true })
  await confirmRefusal('delete_queue_items', { prompt_ids: ['p-9'] }, { method: 'POST', url: '/queue' }, /p-9/)
  assert.match(textOf(ok(await call('delete_queue_items', { prompt_ids: ['p-9', 'p-10'], confirm: true }))), /p-9, p-10/)
  assert.deepEqual(JSON.parse(lastCall('POST', '/queue').body), { delete: ['p-9', 'p-10'] })
  refused(await call('delete_queue_items', { prompt_ids: [], confirm: true }))
})

test('queue: clear_history and delete_history_items post the exact body, and refuse without confirm', async () => {
  await confirmRefusal('clear_history', {}, { method: 'POST', url: '/history' }, /whole run history/)
  ok(await call('clear_history', { confirm: true }))
  assert.deepEqual(JSON.parse(lastCall('POST', '/history').body), { clear: true })
  await confirmRefusal('delete_history_items', { prompt_ids: ['p-3'] }, { method: 'POST', url: '/history' }, /p-3/)
  ok(await call('delete_history_items', { prompt_ids: ['p-3'], confirm: true }))
  assert.deepEqual(JSON.parse(lastCall('POST', '/history').body), { delete: ['p-3'] })
})

test('queue: free_memory posts unload_models and free_memory, and refuses without confirm', async () => {
  await confirmRefusal('free_memory', {}, { method: 'POST', url: '/free' }, /unload the loaded models and free cached memory/)
  ok(await call('free_memory', { confirm: true }))
  assert.deepEqual(JSON.parse(lastCall('POST', '/free').body), { unload_models: true, free_memory: true })
  ok(await call('free_memory', { unload_models: false, confirm: true }))
  assert.deepEqual(JSON.parse(lastCall('POST', '/free').body), { unload_models: false, free_memory: true })
})

test('queue: run_workflow queues, waits and returns the outputs; the locked-shot gate applies', async () => {
  const before = fake.prompts.length
  const r = jsonOf(ok(await call('run_workflow', { prompt: { 1: { class_type: 'LoadImage', inputs: { image: 'corrosion-051_3D.LEFT.000001.dpx' } } }, timeout_s: 5 })))
  const id = `p-${before + 1}`
  assert.equal(r.prompt_id, id); assert.equal(r.completed, true); assert.equal(r.number, before + 1); assert.deepEqual(r.shots_named, ['corrosion-051'])
  assert.deepEqual(r.outputs, [{ node: '9', kind: 'images', filename: `${id}_00001_.png`, subfolder: 'runs', type: 'output' }])
  assert.deepEqual(lastCall('POST', '/prompt').url, '/prompt')
  const locked = refused(await call('run_workflow', { prompt: { 1: { class_type: 'LoadImage', inputs: { image: 'cgi-042_3D.LEFT.000001.dpx' } } } }))
  assert.match(textOf(locked), /^Refused: the graph names locked shot cgi-042/); assert.equal(fake.prompts.length, before + 1)
  assert.match(textOf(refused(await call('run_workflow', { prompt: { 7: { class_type: 'Bogus', inputs: {} } } }))), /^ComfyUI refused the graph/)
})

test('files: get_output passes preview, channel and format through to /view', async () => {
  ok(await call('get_output', { filename: 'p-1_00001_.png', subfolder: 'runs', preview: 'webp;90', channel: 'rgb', format: 'webp' }))
  const u = new URL(lastCall('GET', '/view').url, 'http://x')
  assert.equal(u.searchParams.get('preview'), 'webp;90'); assert.equal(u.searchParams.get('channel'), 'rgb'); assert.equal(u.searchParams.get('format'), 'webp')
  assert.equal(u.searchParams.get('filename'), 'p-1_00001_.png')
})

test('files: get_output returns an image content block beside the text (up to 1 MB)', async () => {
  const r = ok(await call('get_output', { filename: 'ComfyUI_00001_.png' }))
  assert.deepEqual(r.result.content.map((c) => c.type), ['text', 'image'])
  const img = r.result.content[1]
  assert.equal(img.mimeType, 'image/png'); assert.ok(Buffer.from(img.data, 'base64').equals(Buffer.alloc(4096, 1)))
  assert.equal(JSON.parse(r.result.content[0].text).size, 4096)
  // over 1 MB: the URL only, no image block
  const big = ok(await call('get_output', { filename: 'huge.png' }))
  assert.deepEqual(big.result.content.map((c) => c.type), ['text']); assert.match(textOf(big), /fetch the URL/)
})

test('files: upload_image from a local path and from base64, multipart as /upload/image takes it', async () => {
  const local = join(dir, 'plate one.png'); writeFileSync(local, 'PNGDATA')
  const a = jsonOf(ok(await call('upload_image', { file_path: local, subfolder: 'plates', overwrite: true })))
  assert.deepEqual(a, { name: 'plate one.png', subfolder: 'plates', type: 'input', bytes: 7, load_image_value: 'plates/plate one.png' })
  const u = fake.uploads.at(-1)
  assert.equal(u.route, '/upload/image'); assert.equal(u.filename, 'plate one.png'); assert.equal(u.type, 'input'); assert.equal(u.subfolder, 'plates'); assert.equal(u.overwrite, 'true'); assert.equal(u.bytes, 'PNGDATA')
  const b = jsonOf(ok(await call('upload_image', { data_base64: Buffer.from('HELLO').toString('base64'), filename: 'h.png', type: 'temp' })))
  assert.equal(b.name, 'h.png'); assert.equal(b.type, 'temp'); assert.equal(fake.uploads.at(-1).bytes, 'HELLO'); assert.equal(fake.uploads.at(-1).overwrite, 'false')
  refused(await call('upload_image', { data_base64: 'AAAA' }))
  refused(await call('upload_image', {}))
  assert.match(textOf(refused(await call('upload_image', { file_path: join(dir, 'missing.png') }))), /^No such file/)
})

test('files: upload_mask sends original_ref', async () => {
  const m = jsonOf(ok(await call('upload_mask', { data_base64: Buffer.from('MASK').toString('base64'), filename: 'mask.png', original_filename: 'plate one.png', original_subfolder: 'plates' })))
  assert.equal(m.name, 'mask.png')
  const u = fake.uploads.at(-1)
  assert.equal(u.route, '/upload/mask'); assert.deepEqual(JSON.parse(u.original_ref), { filename: 'plate one.png', subfolder: 'plates', type: 'input' }); assert.equal(u.bytes, 'MASK')
  refused(await call('upload_mask', { data_base64: 'AAAA', filename: 'm.png' }))
})

test('workflows: list_userdata, move_workflow, delete_workflow (confirm)', async () => {
  const sg = jsonOf(ok(await call('list_userdata', { dir: 'subgraphs', recurse: false })))
  assert.deepEqual(sg, { dir: 'subgraphs', count: 1, files: ['sg/a.json'] }); assert.equal(lastCall('GET', '/api/userdata?dir=subgraphs').url, '/api/userdata?dir=subgraphs&recurse=false')
  refused(await call('list_userdata', { dir: 'nowhere' }))

  workflows.set('scratch/old.json', '{"nodes":[]}')
  assert.match(textOf(ok(await call('move_workflow', { path: 'scratch/old.json', destination: 'scratch/new' }))), /^✓ Moved workflows\/scratch\/old\.json to workflows\/scratch\/new\.json/)
  assert.equal(lastCall('POST', '/api/userdata/').url, '/api/userdata/workflows%2Fscratch%2Fold.json/move/workflows%2Fscratch%2Fnew.json')
  assert.ok(workflows.has('scratch/new.json') && !workflows.has('scratch/old.json'))
  assert.match(textOf(refused(await call('move_workflow', { path: 'scratch/new.json', destination: 'basic_t2i.json' }))), /already exists/)
  assert.match(textOf(refused(await call('move_workflow', { path: 'scratch/zip.json', destination: 'x.json' }))), /^No workflow/)

  await confirmRefusal('delete_workflow', { path: 'scratch/new.json' }, { method: 'DELETE', url: '/api/userdata/' }, /scratch\/new\.json/)
  assert.ok(workflows.has('scratch/new.json'))
  assert.match(textOf(ok(await call('delete_workflow', { path: 'scratch/new.json', confirm: true }))), /^✓ Deleted workflows\/scratch\/new\.json/)
  assert.equal(lastCall('DELETE', '/api/userdata/').url, '/api/userdata/workflows%2Fscratch%2Fnew.json')
  assert.ok(!workflows.has('scratch/new.json'))
  refused(await call('delete_workflow', { path: 'scratch/new.json', confirm: true }))
})

test('manager: manager_status and list_installed_nodes are read-only; both say so when Manager is absent', async () => {
  const s = jsonOf(ok(await call('manager_status')))
  assert.equal(s.installed, true); assert.equal(s.version, 'V3.37'); assert.equal(s.queue.is_processing, false)
  const l = jsonOf(ok(await call('list_installed_nodes')))
  assert.equal(l.count, 1); assert.equal(l.packs[0].name, 'comfyui-impact-pack'); assert.equal(l.packs[0].enabled, true)
  assert.ok(fake.log.every((c) => !/install|update|uninstall|reboot/.test(c.url.replace('/customnode/installed', ''))))
  managerInstalled = false
  try {
    assert.match(textOf(refused(await call('manager_status'))), /^ComfyUI-Manager does not answer/)
    assert.match(textOf(refused(await call('list_installed_nodes'))), /not installed/)
  } finally { managerInstalled = true }
})

test('every tool description ends in a `ComfyUI:` line, starts with a group tag, and every property is documented', async () => {
  const { tools } = (await rpc('tools/list')).result
  const tags = new Set(['server', 'nodes', 'queue', 'files', 'workflows', 'manager'])
  for (const t of tools) {
    const lines = t.description.split('\n')
    assert.match(lines.at(-1), /^ComfyUI: (GET|POST|DELETE|PUT) \/\S*( [^,]+)?(, (GET|POST|DELETE|PUT) \/\S*( [^,]+)?)*$/, `${t.name}: last line ${lines.at(-1)}`)
    const tag = /^\[(\w+)\] /.exec(t.description)
    assert.ok(tag && tags.has(tag[1]), `${t.name}: leading [group] tag`)
    assert.equal(t.inputSchema.type, 'object')
    for (const [k, v] of Object.entries(t.inputSchema.properties || {})) {
      assert.ok(typeof v.description === 'string' && v.description.length > 3, `${t.name}.${k}: description`)
      assert.ok(v.type, `${t.name}.${k}: type`)
    }
    for (const k of t.inputSchema.required || []) assert.ok(k in t.inputSchema.properties, `${t.name}: required ${k} is a property`)
  }
  // every destructive tool takes a required confirm
  for (const n of ['clear_queue', 'delete_queue_items', 'clear_history', 'delete_history_items', 'free_memory', 'delete_workflow']) {
    const t = tools.find((x) => x.name === n)
    assert.ok(t.inputSchema.required.includes('confirm'), n); assert.match(t.description, /DESTRUCTIVE/)
  }
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
    assert.equal(tools.result.tools.length, TOOL_COUNT); assert.equal(tools.result.tools[0].name, 'comfy_status')
    const status = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'comfy_status', arguments: {} } })
    assert.equal(JSON.parse(status.result.content[0].text).target, comfyUrl)
    const elsewhere = await fetch(url.replace('/mcp', '/'), { method: 'GET' })
    assert.equal(elsewhere.status, 404)
  } finally { http.kill() }
})
