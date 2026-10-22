#!/usr/bin/env node
// The ComfyUI bridge (docs/MCP-ENDPOINTS.md §2, `npm run mcp:bridge`): a local agent works inside the
// ComfyUI running in a pod, or any ComfyUI, through the HTTP calls in docs/COMFY-API.md. It never creates,
// stops or bills a pod: that stays with the pod manager (server.mjs). stdio by default; `--http <port>` or
// MCP_HTTP_PORT serves the same tools over Streamable HTTP on 127.0.0.1 at /mcp (transport.mjs).
//
// Target: `--comfy <url>` or COMFY_URL (the Mac's own install is http://127.0.0.1:8188; a pod's is
// https://<pod id>-8188.proxy.runpod.net); without one, the first running pod whose ComfyUI answers,
// asked of the core (pods.list probes /system_stats); else a clear error, and every tool says so.
//
// Locked-shot rule (queue_prompt): a graph that names a locked shot is refused and nothing is queued.
// What "locked" is comes from the project tracker, `<project>/04_TRACKER/shots.csv`, column `locked` =
// `yes` when the client approves a shot (shared/shapes/tracker-rows.json, structure_v003.md §4; locked
// shots are read-only and never run by us: policy/agent-permissions.md, shot-folder.json rule 3). The
// project tree is `--project <dir>`, PROJECT_ROOT, or the Default Configuration's mapped project folder;
// a shot is "named" wherever its name appears in the graph (file names, served frames, solve paths,
// notes: libs/core/src/shots.ts). No tree or no tracker: nothing is locked, and comfy_status says so.
//
// Tools are grouped by a leading tag in the description ([server] [nodes] [queue] [files] [workflows] [manager]) and
// each ends with a line `ComfyUI: <METHOD> <path>`, which the app's Docs modal parses. Destructive ones need confirm: true.
//
// Governance (shared/governance) is handed to every client at initialize, with one line naming the
// target and that the bridge cannot spend; the pages are governance:// resources as on the pod manager.
// stdout is the protocol: anything we have to say goes to stderr.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { serve } from './transport.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = resolve(HERE, '..', 'libs', 'core', 'dist', 'index.js')
if (!existsSync(CORE)) {
  console.error(`The core is not built (${CORE}). Run: cd apps/runpod-dashboard && npm run core:build`)
  process.exit(2)
}
const { governance, mounts, pods, settings, shots } = await import(pathToFileURL(CORE).href)
const { version } = createRequire(import.meta.url)('../package.json')

settings.applyToEnv()   // the RunPod key the panel saved, so the bridge can find a running pod

const argv = process.argv.slice(2)
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const EXPLICIT = (argOf('--comfy') || process.env.COMFY_URL || '').trim().replace(/\/+$/, '')
const PROJECT = (argOf('--project') || process.env.PROJECT_ROOT || '').trim() || null
const CLIENT_ID = 'runpod-pod-manager-bridge'
const POLL_MS = Number(process.env.COMFY_POLL_MS) || 2000          // wait_for_prompt's history poll
const TIMEOUT_MS = Number(process.env.COMFY_TIMEOUT_MS) || 15_000  // one HTTP call
const IMAGE_MAX = 1024 * 1024                                       // get_output: an image up to this size also comes back as an image block
const INLINE_MAX = 64 * 1024                                        // get_output: text up to this size comes back inline

const projectRoot = () => PROJECT || mounts.load().folders.project || null
const projectFrom = () => (PROJECT ? (argOf('--project') ? '--project' : 'PROJECT_ROOT') : 'the Default Configuration')

// ----- the target -----
let target = EXPLICIT || null
let targetFrom = EXPLICIT ? (argOf('--comfy') ? '--comfy' : 'COMFY_URL') : null
let noTarget = null   // why discovery found nothing, for the instructions and every answer until it does

class BridgeError extends Error {}
const fail = (m) => { throw new BridgeError(m) }

/** The first running pod whose ComfyUI answers, through the core. */
async function discover() {
  if (mounts.dryRun(mounts.load())) fail('No ComfyUI target: in no-spend mode the pods are simulated and run no ComfyUI. Give --comfy <url> or COMFY_URL (the Mac install is http://127.0.0.1:8188).')
  if (!process.env.RUNPOD_API_KEY) fail("No ComfyUI target: give --comfy <url> or COMFY_URL, or set the RunPod key (the app's Default Configuration) so the bridge can find a running pod.")
  const list = await pods.list()   // probes each running pod's /system_stats
  const ready = list.find((p) => p.status === 'running' && p.web_ui_url && p.comfy_ready)
  if (ready) return { url: ready.web_ui_url.replace(/\/+$/, ''), from: `pod ${ready.name} (${ready.id})` }
  const running = list.filter((p) => p.status === 'running' || p.status === 'starting')
  fail(running.length
    ? `No running pod answers on ComfyUI yet (${running.map((p) => `${p.name} ${p.id}: ${p.status}`).join(', ')}; still starting?). Try again in a minute, or give --comfy <url>.`
    : 'No running pod: start one with the pod manager (resume_pod or create_pod), or give --comfy <url>.')
}
async function resolveTarget() {
  if (target) return target
  try { const t = await discover(); target = t.url; targetFrom = t.from; noTarget = null; return target }
  catch (e) { noTarget = e.message; throw e }
}

// ----- HTTP to ComfyUI -----
async function api(path, init = {}) {
  const base = await resolveTarget()
  let r
  try { r = await fetch(base + path, { ...init, signal: AbortSignal.timeout(init.timeoutMs || TIMEOUT_MS) }) }
  catch (e) { fail(`ComfyUI at ${base} did not answer ${path}: ${e?.cause?.message || e?.message || e}`) }
  if (r.status === 502) fail(`ComfyUI at ${base} is still starting: ${path} answered 502 (RunPod's proxy answers 502 until the pod's process listens). Try again in a minute.`)
  return r
}
async function bodyJson(r, path) {
  const t = await r.text()
  try { return JSON.parse(t) } catch { fail(`${path} answered HTTP ${r.status} with no JSON: ${t.slice(0, 300)}`) }
}
async function getJson(path) {
  const r = await api(path)
  if (r.status !== 200) fail(`${path} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
  return bodyJson(r, path)
}
const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The panel path for a workflow: relative to the Workflows folder, one URL-encoded segment (COMFY-API.md). */
function workflowPath(p) {
  let rel = String(p || '').trim().replace(/^\/+/, '').replace(/^workflows\//, '')
  if (!rel) fail('path: a workflow path relative to the Workflows panel, e.g. CANALV2_corrosion/corrosion-051_graph_v015.json')
  if (!rel.endsWith('.json')) rel += '.json'
  return { rel, url: `/api/userdata/${encodeURIComponent('workflows/' + rel)}` }
}

/** Every output file in a history entry's outputs, whatever the node called them (images, gifs, audio...). */
function outputsOf(entry) {
  const out = []
  for (const [node, o] of Object.entries(entry?.outputs || {})) {
    for (const [kind, v] of Object.entries(o || {})) {
      if (Array.isArray(v)) for (const f of v) if (f && typeof f === 'object' && f.filename) out.push({ node, kind, filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' })
    }
  }
  return out
}
const historyEntry = (id, e) => ({ prompt_id: id, status: e?.status?.status_str || (e?.status?.completed ? 'success' : 'unknown'), completed: !!e?.status?.completed, outputs: outputsOf(e), messages: (e?.status?.messages || []).filter((m) => Array.isArray(m) && /error|interrupt/i.test(m[0])).map((m) => m[0]) })
const queueEntry = (q) => ({ number: q?.[0], prompt_id: q?.[1], nodes: q?.[2] && typeof q[2] === 'object' ? Object.keys(q[2]).length : 0 })
const inputType = (spec) => (Array.isArray(spec) ? (Array.isArray(spec[0]) ? `choice[${spec[0].length}]` : String(spec[0])) : String(spec))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ----- tools -----
const S = (description, extra = {}) => ({ type: 'string', description, ...extra })
const B = (description, def) => ({ type: 'boolean', description, ...(def === undefined ? {} : { default: def }) })
const I = (description, def, min, max) => ({ type: 'integer', description, ...(def === undefined ? {} : { default: def }), ...(min === undefined ? {} : { minimum: min }), ...(max === undefined ? {} : { maximum: max }) })
const CONFIRM = (what) => ({ type: 'boolean', enum: [true], description: `Must be true: ${what}. Without it the call is refused and nothing is changed` })
const GRAPH = { type: ['object', 'string'] }
const schema = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) })
/** [tag] text, then the final line the UI's Docs modal parses: `ComfyUI: <METHOD> <path>[, ...]`. */
const tool = (name, tag, text, calls, properties, required) => ({ name, description: `[${tag}] ${text}\nComfyUI: ${calls}`, inputSchema: schema(properties, required) })

const TOOLS = [
  // --- server ---
  tool('comfy_status', 'server', 'The target ComfyUI: URL, versions, devices and VRAM from /system_stats, whether /object_info answers (nodes loaded), and which tracker decides locked shots', 'GET /system_stats, GET /api/object_info'),
  tool('get_features', 'server', "The server's feature flags (what the frontend and API negotiate)", 'GET /features'),
  tool('get_settings', 'server', "All of the user's ComfyUI settings (comfy.settings.json)", 'GET /settings'),
  tool('get_setting', 'server', 'One ComfyUI setting by id', 'GET /settings/{id}', { id: S('Setting id, e.g. Comfy.Locale') }, ['id']),
  tool('get_logs', 'server', "The tail of the server's log (the same buffer the UI's log panel shows)", 'GET /internal/logs/raw', { lines: I('How many of the newest lines to return', 200, 1, 5000) }),
  tool('get_users', 'server', 'The users ComfyUI knows (storage mode and, when multi-user, the user ids)', 'GET /users'),
  // --- nodes and models ---
  tool('search_nodes', 'nodes', 'Node classes whose name, display name or category matches, with their inputs and outputs, from /object_info', 'GET /api/object_info', { query: S('A word from the node name, display name or category'), limit: I('At most this many nodes', 20, 1, 200) }, ['query']),
  tool('get_node_info', 'nodes', 'One node class in full: every input with its type, default and range, outputs, category, description', 'GET /object_info/{class}', { class_type: S('The exact node class, e.g. KSampler') }, ['class_type']),
  tool('list_model_folders', 'nodes', 'The model folder types ComfyUI knows (checkpoints, loras, vae, controlnet, ...)', 'GET /models'),
  tool('list_models', 'nodes', 'The model files in one folder type', 'GET /models/{folder}', { folder: S('Folder type from list_model_folders, e.g. checkpoints') }, ['folder']),
  tool('get_model_metadata', 'nodes', "A safetensors model's embedded metadata (training info, base model, trigger words)", 'GET /view_metadata/{folder}?filename=', { folder: S('Folder type, e.g. loras'), filename: S('The model file as list_models names it, e.g. style/foo.safetensors') }, ['folder', 'filename']),
  tool('list_embeddings', 'nodes', 'The textual-inversion embeddings available', 'GET /embeddings'),
  tool('list_extensions', 'nodes', 'The frontend extension scripts that custom nodes register', 'GET /extensions'),
  tool('get_folder_paths', 'nodes', 'Where ComfyUI looks for each kind of file: the folder paths per type', 'GET /internal/folder_paths'),
  // --- queue ---
  tool(
    'queue_prompt', 'queue',
    'Queue an API-format graph (node id -> class_type and inputs; what Export (API) writes). Refused when the graph names a locked shot (04_TRACKER/shots.csv, locked = yes). A 400 from ComfyUI names the invalid node',
    'POST /prompt',
    { prompt: { ...GRAPH, description: 'The API graph (JSON object, or its text)' }, client_id: S('Client id for the run', { default: CLIENT_ID }) }, ['prompt'],
  ),
  tool(
    'run_workflow', 'queue',
    'queue_prompt, wait for it to finish and return its outputs in one call; the same locked-shot refusal as queue_prompt. On a timeout the prompt keeps running: wait_for_prompt follows it',
    'POST /prompt, GET /history/{prompt_id}',
    { prompt: { ...GRAPH, description: 'The API graph (JSON object, or its text)' }, client_id: S('Client id for the run', { default: CLIENT_ID }), timeout_s: I('Give up waiting after this many seconds', 600, 1, 86400) }, ['prompt'],
  ),
  tool('get_queue', 'queue', 'The running and pending prompts', 'GET /queue'),
  tool('get_prompt_info', 'queue', 'How many prompts remain in the queue (the light check, no graphs)', 'GET /prompt'),
  tool('get_history', 'queue', 'Finished runs with their outputs (filenames, subfolders, types): one prompt, or the newest', 'GET /history/{prompt_id}, GET /history?max_items=', { prompt_id: S('One run; omit for the newest ones'), max_items: I('How many of the newest runs', 10, 1, 200) }),
  tool('wait_for_prompt', 'queue', 'Poll history until the prompt finishes; its outputs, or a timeout', 'GET /history/{prompt_id}', { prompt_id: S('The id queue_prompt answered'), timeout_s: I('Give up after this many seconds', 600, 1, 86400) }, ['prompt_id']),
  tool('interrupt', 'queue', 'Stop the running prompt', 'POST /interrupt'),
  tool('clear_queue', 'queue', 'DESTRUCTIVE: remove every pending prompt from the queue (the running one is not stopped: interrupt does that)', 'POST /queue', { confirm: CONFIRM('you accept dropping every pending prompt') }, ['confirm']),
  tool('delete_queue_items', 'queue', 'DESTRUCTIVE: remove these pending prompts from the queue', 'POST /queue', { prompt_ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Ids of pending prompts, from get_queue' }, confirm: CONFIRM('you accept dropping these pending prompts') }, ['prompt_ids', 'confirm']),
  tool('clear_history', 'queue', 'DESTRUCTIVE: erase the whole run history (outputs on disk stay)', 'POST /history', { confirm: CONFIRM('you accept erasing the whole run history') }, ['confirm']),
  tool('delete_history_items', 'queue', 'DESTRUCTIVE: erase these runs from the history (outputs on disk stay)', 'POST /history', { prompt_ids: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Ids of finished runs, from get_history' }, confirm: CONFIRM('you accept erasing these runs from the history') }, ['prompt_ids', 'confirm']),
  tool('free_memory', 'queue', 'DESTRUCTIVE: unload models and/or free cached memory on the GPU and host; the next run reloads what it needs', 'POST /free', { unload_models: B('Unload the loaded models', true), free_memory: B('Free cached memory', true), confirm: CONFIRM('you accept unloading models and dropping caches') }, ['confirm']),
  // --- files ---
  tool(
    'get_output', 'files',
    'A produced file: small text inline; otherwise its /view URL, size and type. An image up to 1 MB also comes back as an image content block',
    'GET /view',
    {
      filename: S('The file as history names it'), subfolder: S('Subfolder of the folder type', { default: '' }), type: S('Which folder: output, input or temp', { enum: ['output', 'input', 'temp'], default: 'output' }),
      preview: S('Ask ComfyUI for a re-encoded preview, format;quality, e.g. webp;90'), channel: S('Return one channel of the image', { enum: ['rgb', 'a', 'rgba'] }), format: S('Re-encode format, passed through to /view, e.g. webp'),
    }, ['filename'],
  ),
  tool(
    'upload_image', 'files',
    'Upload an image into ComfyUI (the input folder by default) from a local file path or base64 data',
    'POST /upload/image',
    {
      file_path: S('Local path of the image to upload (or give data_base64)'), data_base64: S('The image bytes, base64 (or give file_path)'), filename: S('Name to store it under; default the file_path basename (required with data_base64)'),
      subfolder: S('Subfolder to put it in', { default: '' }), type: S('Which folder: input, temp or output', { enum: ['input', 'temp', 'output'], default: 'input' }), overwrite: B('Replace a file of the same name; otherwise ComfyUI renames the upload', false),
    },
  ),
  tool(
    'upload_mask', 'files',
    "Upload a mask that is applied to an already uploaded image (the mask becomes the image's alpha channel)",
    'POST /upload/mask',
    {
      file_path: S('Local path of the mask image (or give data_base64)'), data_base64: S('The mask bytes, base64 (or give file_path)'), filename: S('Name to store it under; default the file_path basename (required with data_base64)'),
      original_filename: S('The image the mask belongs to (original_ref.filename)'), original_subfolder: S('Its subfolder', { default: '' }), original_type: S('Its folder: input, temp or output', { enum: ['input', 'temp', 'output'], default: 'input' }),
      subfolder: S('Subfolder to put the result in', { default: '' }), type: S('Which folder to put it in', { enum: ['input', 'temp', 'output'], default: 'input' }), overwrite: B('Replace a file of the same name', false),
    }, ['original_filename'],
  ),
  // --- workflows ---
  tool('list_workflows', 'workflows', "The Workflows panel's files (the pod's comfy-shared/workflows, or the Mac's apps/comfy-app/workflows)", 'GET /api/userdata?dir=workflows&recurse=true', { folder: S('Only this folder of the panel, e.g. CANALV2_corrosion') }),
  tool('get_workflow', 'workflows', 'One workflow from the panel, as the UI graph it holds', 'GET /api/userdata/{file}', { path: S('Panel path, e.g. CANALV2_corrosion/corrosion-051_graph_v015.json') }, ['path']),
  tool(
    'save_workflow', 'workflows',
    'Save a UI graph into the panel; refused when the path exists unless overwrite is true (versions only go up: prefer a new _v### name)',
    'POST /api/userdata/{file}?overwrite=',
    { path: S('Panel path to write'), workflow: { ...GRAPH, description: 'The UI graph (JSON object, or its text)' }, overwrite: B('Replace the file if it exists', false) }, ['path', 'workflow'],
  ),
  tool(
    'list_userdata', 'workflows', "List files in any folder of ComfyUI's user data (workflows, subgraphs, ...), not only the panel",
    'GET /api/userdata?dir=&recurse=',
    { dir: S('Folder under the user data, e.g. workflows or subgraphs'), recurse: B('Include subfolders', true), full_info: B('Return size and mtime per file instead of names', false) }, ['dir'],
  ),
  tool('delete_workflow', 'workflows', 'DESTRUCTIVE: delete a workflow from the panel (not undoable)', 'DELETE /api/userdata/{file}', { path: S('Panel path, e.g. scratch/test.json'), confirm: CONFIRM('you accept deleting this workflow for good') }, ['path', 'confirm']),
  tool('move_workflow', 'workflows', 'Move or rename a workflow inside the panel; refused when the destination exists', 'POST /api/userdata/{file}/move/{dest}', { path: S('Current panel path'), destination: S('New panel path') }, ['path', 'destination']),
  // --- manager ---
  tool('manager_status', 'manager', 'Whether ComfyUI-Manager is installed, its version and its task queue. Read-only: this bridge never installs, updates or removes anything', 'GET /manager/version, GET /manager/queue/status'),
  tool('list_installed_nodes', 'manager', 'The custom node packs ComfyUI-Manager reports as installed, with version and enabled state. Read-only', 'GET /customnode/installed'),
]

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
const json = (v) => text(JSON.stringify(v, null, 2))
const refuse = (what) => text(`Refused: ${what} Nothing was changed. Call again with confirm: true to go ahead.`, true)

/** Queue an API graph past the locked-shot gate: { error } is a finished refusal, else { body, gate, client }. */
async function queueGraph(prompt, client_id) {
  let graph = prompt
  if (typeof graph === 'string') { try { graph = JSON.parse(graph) } catch { return { error: text('prompt is not valid JSON (an API-format graph: node id -> class_type and inputs)', true) } } }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return { error: text('prompt must be an API-format graph: an object of node id -> { class_type, inputs }', true) }
  if (Array.isArray(graph.nodes)) return { error: text('This is a UI graph (the panel\'s format, with nodes and links). /prompt takes the API graph: Export (API) in the UI, or the shot\'s _api.json twin.', true) }
  const gate = shots.lockedIn(graph, projectRoot())
  if (gate.locked.length) {
    const s = gate.locked.length === 1 ? '' : 's'
    return { error: text(`Refused: the graph names locked shot${s} ${gate.locked.join(', ')}, and locked (client-approved) shots are never run by us (shared/governance/policy/agent-permissions.md; locked = yes in ${gate.tracker.file}). Nothing was queued.`, true) }
  }
  const client = client_id || CLIENT_ID
  const r = await postJson('/prompt', { prompt: graph, client_id: client })
  const body = await bodyJson(r, '/prompt')
  if (r.status === 400) return { error: text(`ComfyUI refused the graph (HTTP 400): ${body?.error?.message || body?.error || ''}\n${JSON.stringify(body?.node_errors || body, null, 2)}`, true) }
  if (r.status !== 200) fail(`/prompt answered HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return { body, gate, client }
}

/** Poll history until the prompt finishes (a tool answer either way). */
async function waitFor(id, timeout_s) {
  const limit = Math.max(1, Number(timeout_s) || 600) * 1000
  const until = Date.now() + limit
  for (;;) {
    const h = await getJson(`/history/${encodeURIComponent(id)}`)
    const e = h?.[id]
    if (e) {
      const entry = historyEntry(id, e)
      if (entry.status === 'error') return text(`Prompt ${id} failed: ${entry.messages.join(', ') || 'see get_history'}\n${JSON.stringify(entry, null, 2)}`, true)
      return json(entry)
    }
    if (Date.now() >= until) return text(`Timed out after ${limit / 1000} s: prompt ${id} is not in history yet. get_queue shows whether it is still running or pending; wait_for_prompt again to keep waiting.`, true)
    await sleep(Math.min(POLL_MS, Math.max(until - Date.now(), 1)))
  }
}

const seg = encodeURIComponent
/** The first of these paths that does not 404 (ComfyUI-Manager moved its routes between versions); null when none. */
async function firstRoute(paths) {
  for (const p of paths) {
    const r = await api(p)
    if (r.status === 404) { await r.body?.cancel().catch(() => {}); continue }
    if (r.status !== 200) fail(`${p} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return { path: p, r }
  }
  return null
}
const NO_MANAGER = 'ComfyUI-Manager does not answer on this ComfyUI (its routes returned 404): it is not installed, or runs without its server routes.'
const parseMaybe = (t) => { try { return JSON.parse(t) } catch { return t.trim() } }

/** A multipart upload to /upload/image or /upload/mask from a local path or base64. */
async function upload(route, a, extraFields = {}) {
  let bytes, name = String(a.filename || '').trim()
  if (a.file_path) {
    const p = resolve(String(a.file_path))
    if (!existsSync(p)) return text(`No such file: ${p}`, true)
    bytes = readFileSync(p); name = name || basename(p)
  } else if (a.data_base64) {
    if (!name) return text('filename: required with data_base64 (the name to store the image under)', true)
    bytes = Buffer.from(String(a.data_base64).replace(/^data:[^,]*,/, ''), 'base64')
  } else return text('Give file_path (a local file) or data_base64 (the bytes)', true)
  if (!bytes.length) return text('The image is empty', true)
  const form = new FormData()
  form.append('image', new Blob([bytes], { type: 'application/octet-stream' }), name)
  form.append('type', String(a.type || 'input'))
  form.append('subfolder', String(a.subfolder || ''))
  form.append('overwrite', a.overwrite ? 'true' : 'false')
  for (const [k, v] of Object.entries(extraFields)) form.append(k, v)
  const r = await api(route, { method: 'POST', body: form, timeoutMs: 120_000 })
  const body = await bodyJson(r, route)
  if (r.status !== 200) return text(`${route} answered HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`, true)
  const ref = { name: body.name, subfolder: body.subfolder || '', type: body.type || a.type || 'input' }
  return json({ ...ref, bytes: bytes.length, load_image_value: ref.subfolder ? `${ref.subfolder}/${ref.name}` : ref.name })
}

const HANDLERS = {
  comfy_status: async () => {
    const stats = await getJson('/system_stats')
    let nodes = { loaded: false, count: 0, note: null }
    try {
      const r = await api('/api/object_info')
      if (r.status === 200) nodes = { loaded: true, count: Object.keys(await bodyJson(r, '/api/object_info')).length, note: null }
      else nodes.note = `/api/object_info answered HTTP ${r.status}`
    } catch (e) { nodes.note = e.message }
    const lock = shots.lockedShots(projectRoot())
    return json({
      target, target_from: targetFrom, system: stats.system, devices: stats.devices,
      nodes_loaded: nodes.loaded, node_count: nodes.count, note: nodes.note,
      locked_shots: { tracker: lock.file, found: lock.found, count: lock.shots.size, shots: [...lock.shots].sort(), project_from: projectFrom() },
    })
  },
  get_features: async () => json(await getJson('/features')),
  get_settings: async () => json(await getJson('/settings')),
  get_setting: async ({ id }) => {
    const k = String(id || '').trim()
    if (!k) return text('id: a setting id, e.g. Comfy.Locale (get_settings lists them)', true)
    return json({ id: k, value: await getJson(`/settings/${seg(k)}`) })
  },
  get_logs: async ({ lines }) => {
    const n = Math.max(1, Math.min(Number(lines) || 200, 5000))
    const l = await getJson('/internal/logs/raw')
    const all = (Array.isArray(l?.entries) ? l.entries : []).map((e) => String(e?.m ?? '')).join('').split('\n')
    if (all.length && all[all.length - 1] === '') all.pop()
    return json({ total_lines: all.length, returned: Math.min(n, all.length), log: all.slice(-n).join('\n') })
  },
  get_users: async () => json(await getJson('/users')),

  search_nodes: async ({ query, limit }) => {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return text('query: a word from the node name, display name or category', true)
    const n = Math.max(1, Math.min(Number(limit) || 20, 200))
    const info = await getJson('/api/object_info')
    const hit = (s) => String(s || '').toLowerCase().includes(q)
    const matches = Object.entries(info).filter(([name, d]) => hit(name) || hit(d?.display_name) || hit(d?.category))
      .sort(([a], [b]) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) || a.localeCompare(b))
    const nodes = matches.slice(0, n).map(([name, d]) => ({
      name, display_name: d?.display_name || name, category: d?.category || '', description: d?.description || undefined,
      inputs: {
        required: Object.fromEntries(Object.entries(d?.input?.required || {}).map(([k, v]) => [k, inputType(v)])),
        optional: Object.fromEntries(Object.entries(d?.input?.optional || {}).map(([k, v]) => [k, inputType(v)])),
      },
      outputs: (d?.output_name || d?.output || []).map(String),
    }))
    return json({ query: q, matches: matches.length, shown: nodes.length, nodes })
  },
  get_node_info: async ({ class_type }) => {
    const c = String(class_type || '').trim()
    if (!c) return text('class_type: the exact node class, e.g. KSampler (search_nodes finds it)', true)
    const info = await getJson(`/object_info/${seg(c)}`)
    return info?.[c] ? json(info[c]) : text(`No node class ${c} (search_nodes finds names; custom nodes may still be loading)`, true)
  },
  list_model_folders: async () => json(await getJson('/models')),
  list_models: async ({ folder }) => {
    const f = String(folder || '').trim()
    if (!f) return text('folder: a model folder type from list_model_folders, e.g. checkpoints', true)
    const r = await api(`/models/${seg(f)}`)
    if (r.status === 404) { await r.body?.cancel().catch(() => {}); return text(`No model folder ${f} (list_model_folders shows the types)`, true) }
    if (r.status !== 200) fail(`/models/${f} answered HTTP ${r.status}`)
    const files = await bodyJson(r, `/models/${f}`)
    return json({ folder: f, count: files.length, files })
  },
  get_model_metadata: async ({ folder, filename }) => {
    const f = String(folder || '').trim(), n = String(filename || '').trim()
    if (!f || !n) return text('folder and filename: e.g. loras and style/foo.safetensors (list_models names them)', true)
    const path = `/view_metadata/${seg(f)}?${new URLSearchParams({ filename: n })}`
    const r = await api(path)
    if (r.status === 404) { await r.body?.cancel().catch(() => {}); return text(`No metadata for ${f}/${n}: the file is missing or is not a safetensors file`, true) }
    if (r.status !== 200) fail(`${path} answered HTTP ${r.status}`)
    return json(await bodyJson(r, path))
  },
  list_embeddings: async () => { const e = await getJson('/embeddings'); return json({ count: e.length, embeddings: e }) },
  list_extensions: async () => { const e = await getJson('/extensions'); return json({ count: e.length, extensions: e }) },
  get_folder_paths: async () => json(await getJson('/internal/folder_paths')),

  queue_prompt: async ({ prompt, client_id }) => {
    const q = await queueGraph(prompt, client_id)
    if (q.error) return q.error
    return json({ prompt_id: q.body.prompt_id, number: q.body.number, client_id: q.client, shots_named: q.gate.named, status_url: `${target}/history/${q.body.prompt_id}`, follow: 'wait_for_prompt' })
  },
  run_workflow: async ({ prompt, client_id, timeout_s }) => {
    const q = await queueGraph(prompt, client_id)
    if (q.error) return q.error
    const w = await waitFor(q.body.prompt_id, timeout_s)
    if (w.isError) w.content[0].text = `Queued as ${q.body.prompt_id} (number ${q.body.number}), then: ${w.content[0].text}`
    else { const e = JSON.parse(w.content[0].text); w.content[0].text = JSON.stringify({ ...e, number: q.body.number, shots_named: q.gate.named }, null, 2) }
    return w
  },
  get_queue: async () => {
    const q = await getJson('/queue')
    const running = (q.queue_running || []).map(queueEntry), pending = (q.queue_pending || []).map(queueEntry)
    return json({ busy: !!(running.length || pending.length), running, pending })
  },
  get_prompt_info: async () => {
    const p = await getJson('/prompt')
    return json({ queue_remaining: p?.exec_info?.queue_remaining ?? null, raw: p })
  },
  get_history: async ({ prompt_id, max_items }) => {
    if (prompt_id) {
      const h = await getJson(`/history/${encodeURIComponent(prompt_id)}`)
      const e = h?.[prompt_id]
      return e ? json(historyEntry(prompt_id, e)) : json({ prompt_id, status: 'pending', completed: false, outputs: [], note: 'not in history yet: still queued or running (get_queue), or never queued' })
    }
    const n = Math.max(1, Math.min(Number(max_items) || 10, 200))
    const h = await getJson(`/history?max_items=${n}`)
    return json({ count: Object.keys(h || {}).length, runs: Object.entries(h || {}).map(([id, e]) => historyEntry(id, e)) })
  },
  wait_for_prompt: async ({ prompt_id, timeout_s }) => {
    const id = String(prompt_id || '').trim()
    if (!id) return text('prompt_id: the id queue_prompt answered', true)
    return waitFor(id, timeout_s)
  },
  interrupt: async () => {
    const r = await api('/interrupt', { method: 'POST' })
    if (r.status !== 200) fail(`/interrupt answered HTTP ${r.status}`)
    return text('✓ Interrupt sent: the running prompt stops; the pending ones stay queued')
  },
  clear_queue: async ({ confirm }) => {
    if (confirm !== true) return refuse('clear_queue would remove every pending prompt from the queue (POST /queue {"clear": true}).')
    const r = await postJson('/queue', { clear: true })
    if (r.status !== 200) fail(`/queue answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text('✓ Queue cleared: every pending prompt is gone; the running one continues (interrupt stops it)')
  },
  delete_queue_items: async ({ prompt_ids, confirm }) => {
    const ids = Array.isArray(prompt_ids) ? prompt_ids.map(String) : []
    if (confirm !== true) return refuse(`delete_queue_items would remove ${ids.length ? ids.join(', ') : 'the given prompts'} from the queue (POST /queue {"delete": [...]}).`)
    if (!ids.length) return text('prompt_ids: the pending prompt ids to remove (get_queue)', true)
    const r = await postJson('/queue', { delete: ids })
    if (r.status !== 200) fail(`/queue answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Removed from the queue: ${ids.join(', ')}`)
  },
  clear_history: async ({ confirm }) => {
    if (confirm !== true) return refuse('clear_history would erase the whole run history (POST /history {"clear": true}); output files stay on disk.')
    const r = await postJson('/history', { clear: true })
    if (r.status !== 200) fail(`/history answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text('✓ History cleared (output files are untouched)')
  },
  delete_history_items: async ({ prompt_ids, confirm }) => {
    const ids = Array.isArray(prompt_ids) ? prompt_ids.map(String) : []
    if (confirm !== true) return refuse(`delete_history_items would erase ${ids.length ? ids.join(', ') : 'the given runs'} from the history (POST /history {"delete": [...]}); output files stay on disk.`)
    if (!ids.length) return text('prompt_ids: the finished run ids to erase (get_history)', true)
    const r = await postJson('/history', { delete: ids })
    if (r.status !== 200) fail(`/history answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Removed from the history: ${ids.join(', ')}`)
  },
  free_memory: async ({ unload_models, free_memory, confirm }) => {
    const body = { unload_models: unload_models !== false, free_memory: free_memory !== false }
    if (confirm !== true) return refuse(`free_memory would ${[body.unload_models && 'unload the loaded models', body.free_memory && 'free cached memory'].filter(Boolean).join(' and ') || 'do nothing'} (POST /free ${JSON.stringify(body)}); the next run reloads what it needs.`)
    const r = await postJson('/free', body)
    if (r.status !== 200) fail(`/free answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Memory release requested: ${JSON.stringify(body)} (ComfyUI does it before the next prompt)`)
  },

  get_output: async ({ filename, subfolder, type, preview, channel, format }) => {
    const name = String(filename || '').trim()
    if (!name) return text('filename: the file as history names it', true)
    const qs = new URLSearchParams({ filename: name, subfolder: String(subfolder || ''), type: String(type || 'output') })
    if (preview) qs.set('preview', String(preview))
    if (channel) qs.set('channel', String(channel))
    if (format) qs.set('format', String(format))
    const path = `/view?${qs}`
    const r = await api(path)
    if (r.status === 404) return text(`No ${type || 'output'} file ${subfolder ? subfolder + '/' : ''}${name} (get_history names what exists)`, true)
    if (r.status !== 200) fail(`${path} answered HTTP ${r.status}`)
    const full = r.headers.get('content-type') || ''
    const contentType = full.split(';')[0].trim()
    const length = Number(r.headers.get('content-length')) || null
    const url = `${target}${path}`
    if (/^(text\/|application\/json)/.test(full) && (length == null || length <= INLINE_MAX)) {
      const body = await r.text()
      if (body.length <= INLINE_MAX) return json({ url, content_type: full, size: body.length, text: body })
      return json({ url, content_type: full, size: body.length, note: `larger than ${INLINE_MAX} bytes: fetch the URL` })
    }
    if (/^image\//.test(contentType) && (length == null || length <= IMAGE_MAX)) {
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length <= IMAGE_MAX) return { content: [{ type: 'text', text: JSON.stringify({ url, content_type: contentType, size: buf.length, note: 'the image is attached' }, null, 2) }, { type: 'image', data: buf.toString('base64'), mimeType: contentType }], isError: false }
      return json({ url, content_type: contentType, size: buf.length, note: `image larger than ${IMAGE_MAX} bytes: fetch the URL` })
    }
    await r.body?.cancel().catch(() => {})
    return json({ url, content_type: full, size: length, note: 'binary: fetch the URL, or pull the volume (ADR-007)' })
  },
  upload_image: async (a) => upload('/upload/image', a),
  upload_mask: async (a) => {
    const f = String(a.original_filename || '').trim()
    if (!f) return text('original_filename: the uploaded image the mask belongs to', true)
    return upload('/upload/mask', a, { original_ref: JSON.stringify({ filename: f, subfolder: String(a.original_subfolder || ''), type: String(a.original_type || 'input') }) })
  },

  list_workflows: async ({ folder }) => {
    const all = await getJson('/api/userdata?dir=workflows&recurse=true')
    const files = (Array.isArray(all) ? all : []).map(String).sort()
    const f = String(folder || '').trim().replace(/^\/+|\/+$/g, '')
    const kept = f ? files.filter((p) => p.startsWith(f + '/')) : files
    return json({ target, folder: f || null, count: kept.length, files: kept })
  },
  get_workflow: async ({ path }) => {
    const { rel, url } = workflowPath(path)
    const r = await api(url)
    if (r.status === 404) return text(`No workflow ${rel} in the panel (list_workflows shows what is there)`, true)
    if (r.status !== 200) fail(`${url} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(await r.text())
  },
  save_workflow: async ({ path, workflow, overwrite }) => {
    const { rel, url } = workflowPath(path)
    let graph = workflow
    if (typeof graph === 'string') { try { graph = JSON.parse(graph) } catch { return text('workflow is not valid JSON', true) } }
    if (!graph || typeof graph !== 'object') return text('workflow must be a UI graph (JSON object)', true)
    const r = await api(`${url}?overwrite=${overwrite ? 'true' : 'false'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(graph) })
    if (r.status === 409) return text(`Refused: ${rel} exists in the panel. Versions only go up: save it under the next _v### name, or call again with overwrite=true to replace it.`, true)
    if (r.status !== 200) fail(`${url} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Saved workflows/${rel}${overwrite ? ' (replaced)' : ''}`)
  },
  list_userdata: async ({ dir, recurse, full_info }) => {
    const d = String(dir || '').trim().replace(/^\/+|\/+$/g, '')
    if (!d) return text('dir: a folder under the user data, e.g. workflows', true)
    const qs = new URLSearchParams({ dir: d, recurse: recurse === false ? 'false' : 'true' })
    if (full_info) qs.set('full_info', 'true')
    const r = await api(`/api/userdata?${qs}`)
    if (r.status === 404) { await r.body?.cancel().catch(() => {}); return text(`No user data folder ${d}`, true) }
    if (r.status !== 200) fail(`/api/userdata answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    const files = await bodyJson(r, '/api/userdata')
    return json({ dir: d, count: files.length, files })
  },
  delete_workflow: async ({ path, confirm }) => {
    const { rel, url } = workflowPath(path)
    if (confirm !== true) return refuse(`delete_workflow would delete workflows/${rel} from the panel for good (DELETE ${url}).`)
    const r = await api(url, { method: 'DELETE' })
    if (r.status === 404) return text(`No workflow ${rel} in the panel (list_workflows shows what is there)`, true)
    if (r.status !== 200 && r.status !== 204) fail(`${url} answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Deleted workflows/${rel}`)
  },
  move_workflow: async ({ path, destination }) => {
    const from = workflowPath(path), to = workflowPath(destination)
    const r = await api(`${from.url}/move/${seg('workflows/' + to.rel)}`, { method: 'POST' })
    if (r.status === 404) return text(`No workflow ${from.rel} in the panel (list_workflows shows what is there)`, true)
    if (r.status === 409) return text(`Refused: ${to.rel} already exists in the panel. Nothing was moved; pick another destination.`, true)
    if (r.status !== 200) fail(`${from.url}/move answered HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`)
    return text(`✓ Moved workflows/${from.rel} to workflows/${to.rel}`)
  },

  manager_status: async () => {
    const v = await firstRoute(['/manager/version', '/v2/manager/version'])
    if (!v) return text(NO_MANAGER, true)
    const version = parseMaybe(await v.r.text())
    let queue = null
    const qr = await firstRoute(['/manager/queue/status', '/v2/manager/queue/status'])
    if (qr) queue = parseMaybe(await qr.r.text())
    return json({ installed: true, version, route: v.path, queue })
  },
  list_installed_nodes: async () => {
    const f = await firstRoute(['/customnode/installed', '/v2/customnode/installed'])
    if (!f) return text(NO_MANAGER, true)
    const raw = parseMaybe(await f.r.text())
    const packs = Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([name, d]) => ({ name, ...(d && typeof d === 'object' ? d : { value: d }) }))
    return json({ route: f.path, count: packs.length, packs })
  },
}

// ----- the server -----
function targetLine() {
  return target
    ? `Target ComfyUI: ${target} (${targetFrom}). This bridge cannot spend: it never creates, stops, resumes or bills a pod; that is the pod manager (mcp/server.mjs).`
    : `No ComfyUI target yet: ${noTarget || 'none given'} This bridge cannot spend: it never creates, stops, resumes or bills a pod; that is the pod manager (mcp/server.mjs).`
}
function makeServer() {
  const server = new Server({ name: 'comfy-bridge', version }, {
    capabilities: { tools: {}, resources: {} },
    instructions: `${governance.instructions()}\n\n---\n${targetLine()}`,
  })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const handler = HANDLERS[params.name]
    if (!handler) return text(`Unknown tool: ${params.name}`, true)
    try {
      return await handler(params.arguments || {})
    } catch (e) {
      const message = e?.message || String(e)
      if (e instanceof BridgeError || typeof e?.status === 'number') return text(message, true)
      console.error(`Tool error: ${params.name}: ${message}`)
      return text(`Error executing ${params.name}: ${message}`, true)
    }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: governance.listing().map((p) => ({ uri: p.uri, name: p.name, mimeType: 'text/markdown', description: "shared/governance: Binc's policies, copied from the CANALV2 tree" })),
  }))
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const name = governance.uriToName(String(params.uri))
    const t = governance.read(name)
    if (t == null) throw new Error(`No such governance page: ${name}`)
    return { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: t }] }
  })
  return server
}

if (!target) { try { await resolveTarget() } catch { /* noTarget says why; the tools answer it and try again */ } }
const served = await serve(makeServer)
console.error(`comfy-bridge ${version} on ${served.text}; target ${target ? `${target} (${targetFrom})` : `none: ${noTarget}`}; locked shots from ${shots.lockedShots(projectRoot()).file || 'no project tree mapped'}; governance from ${governance.folder() || 'nowhere'}`)
