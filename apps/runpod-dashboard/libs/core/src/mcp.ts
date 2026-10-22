/**
 * The two MCP endpoints (docs/MCP-ENDPOINTS.md) as the Connect › MCP tab shows them: the pod manager
 * (`mcp/dist/server.cjs`) and the ComfyUI bridge (`mcp/dist/comfy-bridge.cjs`), each bundled into one file
 * (`npm run mcp:bundle`), with its program path, the stdio command, and a ready-made setup per client
 * (Claude Code, Claude Desktop, Codex CLI, ChatGPT, and Remote over HTTP). The command is the APP'S OWN
 * executable run as Node (`ELECTRON_RUN_AS_NODE=1 <exe> <bundle>`), so a client needs no Node install: the
 * packaged app's executable, or the Electron binary in development (MCP_EXEC, else process.execPath).
 * The bridge takes a target ComfyUI URL (`--comfy <url>`) that flows into every snippet; `targets()` lists
 * what it can point at. Each endpoint can also be served from inside the running app over HTTP
 * (mcp_http in the Default Configuration; electron/mcp-host.cjs), and then Remote and ChatGPT show its URL.
 * `probe()` is the tab's Check: the app spawns the server over stdio the way a client would (or, when it
 * serves the endpoint itself, asks it over HTTP), performs initialize and tools/list, and reports the tools.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { bad } from './errors.js'
import * as mounts from './mounts.js'
import { APP_DIR } from './paths.js'
import * as pods from './pods.js'
import type { RunPodClient } from './runpod.js'

export type EndpointId = 'pod-manager' | 'comfy-bridge'
export interface ClientConfigs { claude_code: string; claude_desktop: string; codex: string; chatgpt: string; remote: string }
/** The endpoint served from the app: the configuration's switch and port, and (from the app's host) whether it listens. */
export interface HttpState { enabled: boolean; port: number; running: boolean; error: string | null; url: string }
export type Served = Partial<Record<EndpointId, { running?: boolean; error?: string | null }>>
export interface Endpoint {
  id: EndpointId
  name: string              // the server's name at the client: `claude mcp add <name>`, the JSON / TOML key
  title: string             // the card's heading
  purpose: string
  program: string           // absolute path of the bundled .cjs
  exists: boolean           // the bundle is on disk (`npm run mcp:bundle` makes it)
  bundle_command: string    // what builds it
  executable: string        // the app's own executable, run as Node
  args: string[]            // what follows `<executable> <program>` over stdio
  command: string[]         // [executable, program, ...args]
  env: Record<string, string>   // ELECTRON_RUN_AS_NODE=1
  command_line: string      // the same, one shell line, env first
  target: string | null     // the bridge's ComfyUI URL, or null (it picks the first running pod at launch)
  http_port: number         // the configured port (mcp_http)
  http_url: string          // http://127.0.0.1:<port>/mcp
  http: HttpState
  clients: ClientConfigs
}
export interface Target { pod_id: string | null; name: string; url: string }
export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ProbeResult { ok: boolean; tools: string[]; definitions: ToolDefinition[]; error: string | null; ms: number }

export const LOCAL_COMFY = 'http://127.0.0.1:8188'   // the Mac's own install (apps/comfy-app)
export const HTTP_PORTS: Record<EndpointId, number> = { ...mounts.MCP_HTTP_PORTS }
export const BUNDLE_COMMAND = 'npm run mcp:bundle'
export const RUN_AS_NODE = { ELECTRON_RUN_AS_NODE: '1' }
export const PROBE_TIMEOUT_MS = 15_000

/** Where the two bundles live: the app's mcp/dist folder (packaged: resources/mcp, which the app sets as MCP_DIR). */
export const mcpDir = () => process.env.MCP_DIR || join(APP_DIR, 'mcp', 'dist')
/** The program a client launches as Node: the app's executable (the app sets MCP_EXEC), else this process's. */
export const mcpExec = () => process.env.MCP_EXEC || process.execPath

const DEFINITIONS: Record<EndpointId, { name: string; title: string; file: string; purpose: string }> = {
  'pod-manager': {
    name: 'pod-manager', title: 'Pod manager', file: 'server.cjs',
    purpose: 'An agent orchestrates RunPod the way the app does: the pool, the pods, volumes, configuration, sync and cost, under the governance pages. Needs the RunPod key from Default Configuration, or no-spend mode.',
  },
  'comfy-bridge': {
    name: 'comfy-bridge', title: 'ComfyUI bridge', file: 'comfy-bridge.cjs',
    purpose: 'An agent works inside one ComfyUI: workflows, nodes, the queue, history and outputs, through the pod\'s proxy URL or any ComfyUI URL. It never creates, stops or bills a pod.',
  },
}

/** A shell word: quoted only when it needs to be. */
const shellWord = (s: string) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
const tomlList = (items: string[]) => `[${items.map((s) => JSON.stringify(s)).join(', ')}]`

const envWords = (env: Record<string, string>) => Object.entries(env).map(([k, v]) => `${k}=${shellWord(v)}`)

function clientConfigs(name: string, exe: string, stdio: string[], url: string | null): ClientConfigs {
  const envFlags = Object.entries(RUN_AS_NODE).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  return {
    claude_code: `claude mcp add ${name} ${envFlags.join(' ')} -- ${[exe, ...stdio].map(shellWord).join(' ')}`,
    claude_desktop: JSON.stringify({ mcpServers: { [name]: { command: exe, args: stdio, env: RUN_AS_NODE } } }, null, 2),
    codex: `[mcp_servers.${name}]\ncommand = ${JSON.stringify(exe)}\nargs = ${tomlList(stdio)}\n\n[mcp_servers.${name}.env]\n${Object.entries(RUN_AS_NODE).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n')}`,
    chatgpt: url ?? '',
    remote: url ?? '',
  }
}

function endpoint(id: EndpointId, target?: string | null, served: Served = {}): Endpoint {
  const d = DEFINITIONS[id]
  const program = join(mcpDir(), d.file)
  const comfy = id === 'comfy-bridge' && target?.trim() ? target.trim() : null
  const args = comfy ? ['--comfy', comfy] : []
  const cfg = mounts.load().mcp_http[id]
  const url = `http://127.0.0.1:${cfg.port}/mcp`
  const exe = mcpExec()
  const command = [exe, program, ...args]
  const live = served[id] || {}
  return {
    id, name: d.name, title: d.title, purpose: d.purpose, program, exists: existsSync(program), bundle_command: BUNDLE_COMMAND, executable: exe, args, command, env: { ...RUN_AS_NODE },
    command_line: [...envWords(RUN_AS_NODE), ...command.map(shellWord)].join(' '), target: comfy, http_port: cfg.port, http_url: url,
    http: { enabled: cfg.enabled, port: cfg.port, running: !!live.running, error: live.error ?? null, url },
    clients: clientConfigs(d.name, exe, [program, ...args], cfg.enabled ? url : null),
  }
}

/** The two endpoints; `comfy` is the bridge's target URL, which every one of its snippets carries. */
export const endpoints = (opts: { comfy?: string | null; served?: Served } = {}): Endpoint[] => [endpoint('pod-manager', null, opts.served), endpoint('comfy-bridge', opts.comfy, opts.served)]

/** Switch an endpoint's HTTP serving in the Default Configuration (validated and saved); the app's host then follows it. */
export function setServe(id: EndpointId, enabled: boolean, port?: number) {
  if (!DEFINITIONS[id]) throw bad(`No MCP endpoint ${id}`)
  const cfg = mounts.load()
  cfg.mcp_http = { ...cfg.mcp_http, [id]: { enabled: !!enabled, port: port === undefined || port === null ? cfg.mcp_http[id].port : Number(port) } }
  mounts.put(cfg)
  return cfg.mcp_http
}

/** What the bridge can point at: the running pods whose ComfyUI answers, and the Mac's own install when it does. */
export async function targets(client?: RunPodClient, local = LOCAL_COMFY): Promise<Target[]> {
  const fetchFn = client?.fetchFn || fetch
  const [list, localReady] = await Promise.all([pods.list(client).catch(() => [] as pods.PodStatus[]), pods.comfyReady(local, fetchFn)])
  const out: Target[] = list.filter((p) => p.status === 'running' && p.web_ui_url && p.comfy_ready).map((p) => ({ pod_id: p.id, name: p.name, url: p.web_ui_url! }))
  if (localReady) out.push({ pod_id: null, name: 'This Mac', url: local })
  return out
}

/**
 * Check: spawn the endpoint over stdio as a client would (the app's executable run as Node, so no node is needed on the PATH), initialize, tools/list, and report the tool names and their full definitions (description, input schema). No key is needed in no-spend mode:
 * the configuration's dry_run is passed down as RUNPOD_DRY_RUN=1.
 */
export async function probe(id: EndpointId, opts: { comfy?: string | null; timeoutMs?: number; http?: string | null } = {}): Promise<ProbeResult> {
  if (!DEFINITIONS[id]) throw bad(`No MCP endpoint ${id}`)
  const ep = endpoint(id, opts.comfy)
  if (opts.http) return probeHttp(opts.http, opts.timeoutMs ?? PROBE_TIMEOUT_MS)   // the app serves it: ask it where it listens
  if (!ep.exists) return { ok: false, tools: [], definitions: [], error: `Not built yet: ${ep.program} (${BUNDLE_COMMAND})`, ms: 0 }
  const env: NodeJS.ProcessEnv = { ...process.env, ...RUN_AS_NODE }
  if (mounts.dryRun(mounts.load())) env.RUNPOD_DRY_RUN = '1'
  return probeCommand(ep.command.slice(1), env, opts.timeoutMs ?? PROBE_TIMEOUT_MS, ep.executable)
}

/** The stdio round-trip itself, against any program: initialize, notifications/initialized, tools/list. */
export function probeCommand(args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs = PROBE_TIMEOUT_MS, exe: string = process.execPath): Promise<ProbeResult> {
  const started = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const stderr: string[] = []
    const pending = new Map<number, (msg: { result?: unknown; error?: { message?: string } }) => void>()
    let child: ReturnType<typeof spawn>
    const finish = (r: Omit<ProbeResult, 'ms'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* already gone */ }
      resolve({ ...r, ms: Date.now() - started })
    }
    const fail = (error: string) => finish({ ok: false, tools: [], definitions: [], error: stderr.length ? `${error}\n${stderr.slice(-5).join('\n')}` : error })
    const timer = setTimeout(() => fail(`No answer in ${Math.round(timeoutMs / 1000)} s`), timeoutMs)
    try {
      child = spawn(exe, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) { return fail((e as Error).message) }
    child.on('error', (e) => fail(e.message))
    child.on('exit', (code, signal) => { if (!settled) fail(`The server exited (${signal || `code ${code}`}) before answering`) })
    createInterface({ input: child.stderr! }).on('line', (l) => stderr.push(l))
    createInterface({ input: child.stdout! }).on('line', (line) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } }
      try { msg = JSON.parse(line) } catch { return }   // not ours
      if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id) }
    })
    let nextId = 1
    const rpc = (method: string, params: unknown) => new Promise<{ result?: unknown; error?: { message?: string } }>((res) => {
      const id = nextId++
      pending.set(id, res)
      child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
    const notify = (method: string) => child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params: {} }) + '\n')
    ;(async () => {
      const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'runpod-manager', version: '1' } })
      if (init.error) return fail(`initialize: ${init.error.message || 'refused'}`)
      notify('notifications/initialized')
      const list = await rpc('tools/list', {})
      if (list.error) return fail(`tools/list: ${list.error.message || 'refused'}`)
      const raw = (list.result as { tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] })?.tools || []
      const definitions = raw.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} }))
      finish({ ok: true, tools: definitions.map((t) => t.name), definitions, error: null })
    })().catch((e) => fail((e as Error).message))
  })
}

/** Check against an endpoint the app serves itself: initialize + tools/list over Streamable HTTP, as a remote client would. */
export async function probeHttp(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  const started = Date.now()
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const rpc = async (id: number, method: string, params: unknown) => {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(timeoutMs) })
    const body = await r.text()
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`)
    // enableJsonResponse answers JSON; a server that streams answers one SSE `data:` line
    const json = body.trimStart().startsWith('{') ? body : (body.split('\n').find((l) => l.startsWith('data:')) || '').slice(5)
    return JSON.parse(json) as { result?: unknown; error?: { message?: string } }
  }
  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'runpod-manager', version: '1' } })
    if (init.error) throw new Error(`initialize: ${init.error.message || 'refused'}`)
    const list = await rpc(2, 'tools/list', {})
    if (list.error) throw new Error(`tools/list: ${list.error.message || 'refused'}`)
    const raw = (list.result as { tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] })?.tools || []
    const definitions = raw.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || {} }))
    return { ok: true, tools: definitions.map((t) => t.name), definitions, error: null, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, tools: [], definitions: [], error: (e as Error).message, ms: Date.now() - started }
  }
}
