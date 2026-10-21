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
// Governance (shared/governance) is handed to every client at initialize, with one line naming the
// target and that the bridge cannot spend; the pages are governance:// resources as on the pod manager.
// stdout is the protocol: anything we have to say goes to stderr.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
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
const TOOLS = [
  { name: 'comfy_status', description: 'The target ComfyUI: URL, versions, devices and VRAM from /system_stats, whether /object_info answers (nodes loaded), and which tracker decides locked shots', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_workflows', description: "The Workflows panel's files (the pod's comfy-shared/workflows, or the Mac's apps/comfy-app/workflows)", inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Only this folder of the panel, e.g. CANALV2_corrosion' } } } },
  { name: 'get_workflow', description: 'One workflow from the panel, as the UI graph it holds', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Panel path, e.g. CANALV2_corrosion/corrosion-051_graph_v015.json' } }, required: ['path'] } },
  {
    name: 'save_workflow',
    description: 'Save a UI graph into the panel; refused when the path exists unless overwrite is true (versions only go up: prefer a new _v### name)',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Panel path to write' }, workflow: { description: 'The UI graph (JSON object, or its text)' }, overwrite: { type: 'boolean', default: false } }, required: ['path', 'workflow'] },
  },
  { name: 'search_nodes', description: 'Node classes whose name, display name or category matches, with their inputs and outputs, from /object_info', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', default: 20 } }, required: ['query'] } },
  {
    name: 'queue_prompt',
    description: 'Queue an API-format graph (node id -> class_type and inputs; what Export (API) writes). Refused when the graph names a locked shot (04_TRACKER/shots.csv, locked = yes). A 400 from ComfyUI names the invalid node',
    inputSchema: { type: 'object', properties: { prompt: { description: 'The API graph (JSON object, or its text)' }, client_id: { type: 'string', description: `Client id for the run; default ${CLIENT_ID}` } }, required: ['prompt'] },
  },
  { name: 'get_queue', description: 'The running and pending prompts', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_history', description: 'Finished runs with their outputs (filenames, subfolders, types): one prompt, or the newest', inputSchema: { type: 'object', properties: { prompt_id: { type: 'string' }, max_items: { type: 'integer', default: 10 } } } },
  { name: 'interrupt', description: 'Stop the running prompt', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'get_output',
    description: 'A produced file: small text inline; otherwise its /view URL, size and type',
    inputSchema: { type: 'object', properties: { filename: { type: 'string' }, subfolder: { type: 'string', default: '' }, type: { type: 'string', enum: ['output', 'input', 'temp'], default: 'output' } }, required: ['filename'] },
  },
  { name: 'wait_for_prompt', description: 'Poll history until the prompt finishes; its outputs, or a timeout', inputSchema: { type: 'object', properties: { prompt_id: { type: 'string' }, timeout_s: { type: 'integer', default: 600 } }, required: ['prompt_id'] } },
]

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError })
const json = (v) => text(JSON.stringify(v, null, 2))

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
  queue_prompt: async ({ prompt, client_id }) => {
    let graph = prompt
    if (typeof graph === 'string') { try { graph = JSON.parse(graph) } catch { return text('prompt is not valid JSON (an API-format graph: node id -> class_type and inputs)', true) } }
    if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return text('prompt must be an API-format graph: an object of node id -> { class_type, inputs }', true)
    if (Array.isArray(graph.nodes)) return text('This is a UI graph (the panel\'s format, with nodes and links). /prompt takes the API graph: Export (API) in the UI, or the shot\'s _api.json twin.', true)
    const gate = shots.lockedIn(graph, projectRoot())
    if (gate.locked.length) {
      const s = gate.locked.length === 1 ? '' : 's'
      return text(`Refused: the graph names locked shot${s} ${gate.locked.join(', ')}, and locked (client-approved) shots are never run by us (shared/governance/policy/agent-permissions.md; locked = yes in ${gate.tracker.file}). Nothing was queued.`, true)
    }
    const r = await postJson('/prompt', { prompt: graph, client_id: client_id || CLIENT_ID })
    const body = await bodyJson(r, '/prompt')
    if (r.status === 400) return text(`ComfyUI refused the graph (HTTP 400): ${body?.error?.message || body?.error || ''}\n${JSON.stringify(body?.node_errors || body, null, 2)}`, true)
    if (r.status !== 200) fail(`/prompt answered HTTP ${r.status}: ${JSON.stringify(body).slice(0, 300)}`)
    return json({ prompt_id: body.prompt_id, number: body.number, client_id: client_id || CLIENT_ID, shots_named: gate.named, status_url: `${target}/history/${body.prompt_id}`, follow: 'wait_for_prompt' })
  },
  get_queue: async () => {
    const q = await getJson('/queue')
    const running = (q.queue_running || []).map(queueEntry), pending = (q.queue_pending || []).map(queueEntry)
    return json({ busy: !!(running.length || pending.length), running, pending })
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
  interrupt: async () => {
    const r = await api('/interrupt', { method: 'POST' })
    if (r.status !== 200) fail(`/interrupt answered HTTP ${r.status}`)
    return text('✓ Interrupt sent: the running prompt stops; the pending ones stay queued')
  },
  get_output: async ({ filename, subfolder, type }) => {
    const name = String(filename || '').trim()
    if (!name) return text('filename: the file as history names it', true)
    const qs = new URLSearchParams({ filename: name, subfolder: String(subfolder || ''), type: String(type || 'output') })
    const path = `/view?${qs}`
    const r = await api(path)
    if (r.status === 404) return text(`No ${type || 'output'} file ${subfolder ? subfolder + '/' : ''}${name} (get_history names what exists)`, true)
    if (r.status !== 200) fail(`${path} answered HTTP ${r.status}`)
    const contentType = r.headers.get('content-type') || ''
    const length = Number(r.headers.get('content-length')) || null
    const url = `${target}${path}`
    if (/^(text\/|application\/json)/.test(contentType) && (length == null || length <= INLINE_MAX)) {
      const body = await r.text()
      if (body.length <= INLINE_MAX) return json({ url, content_type: contentType, size: body.length, text: body })
      return json({ url, content_type: contentType, size: body.length, note: `larger than ${INLINE_MAX} bytes: fetch the URL` })
    }
    await r.body?.cancel().catch(() => {})
    return json({ url, content_type: contentType, size: length, note: 'binary: fetch the URL, or pull the volume (ADR-007)' })
  },
  wait_for_prompt: async ({ prompt_id, timeout_s }) => {
    const id = String(prompt_id || '').trim()
    if (!id) return text('prompt_id: the id queue_prompt answered', true)
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
