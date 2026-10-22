/**
 * The two MCP endpoints (docs/MCP-ENDPOINTS.md) as the Connect › MCP tab shows them: the pod manager
 * (`mcp/server.mjs`) and the ComfyUI bridge (`mcp/comfy-bridge.mjs`), each with its program path, the
 * stdio command, and a ready-made setup per client (Claude Code, Claude Desktop, Codex CLI, ChatGPT
 * over Streamable HTTP). The bridge takes a target ComfyUI URL (`--comfy <url>`) that flows into every
 * snippet; `targets()` lists what it can point at. `probe()` is the tab's Check: the app spawns the
 * server over stdio the way a client would, performs initialize and tools/list, and reports the tools.
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
export interface ClientConfigs { claude_code: string; claude_desktop: string; codex: string; chatgpt: string }
export interface Endpoint {
  id: EndpointId
  name: string              // the server's name at the client: `claude mcp add <name>`, the JSON / TOML key
  title: string             // the card's heading
  purpose: string
  program: string           // absolute path of the .mjs
  exists: boolean           // the program is on disk (the bridge is still to build)
  args: string[]            // what follows `node <program>` over stdio
  command: string[]         // ['node', program, ...args]
  command_line: string      // the same, one shell line
  target: string | null     // the bridge's ComfyUI URL, or null (it picks the first running pod at launch)
  http_port: number
  http_url: string          // http://127.0.0.1:<port>/mcp
  clients: ClientConfigs
}
export interface Target { pod_id: string | null; name: string; url: string }
export interface ToolDefinition { name: string; description: string; inputSchema: Record<string, unknown> }
export interface ProbeResult { ok: boolean; tools: string[]; definitions: ToolDefinition[]; error: string | null; ms: number }

export const LOCAL_COMFY = 'http://127.0.0.1:8188'   // the Mac's own install (apps/comfy-app)
export const HTTP_PORTS: Record<EndpointId, number> = { 'pod-manager': 8765, 'comfy-bridge': 8766 }
export const PROBE_TIMEOUT_MS = 15_000

/** Where the two programs live: the app's mcp/ folder, or MCP_DIR for tests. */
export const mcpDir = () => process.env.MCP_DIR || join(APP_DIR, 'mcp')

const DEFINITIONS: Record<EndpointId, { name: string; title: string; file: string; purpose: string }> = {
  'pod-manager': {
    name: 'pod-manager', title: 'Pod manager', file: 'server.mjs',
    purpose: 'An agent orchestrates RunPod the way the app does: the pool, the pods, volumes, configuration, sync and cost, under the governance pages. Needs the RunPod key from Default Configuration, or no-spend mode.',
  },
  'comfy-bridge': {
    name: 'comfy-bridge', title: 'ComfyUI bridge', file: 'comfy-bridge.mjs',
    purpose: 'An agent works inside one ComfyUI: workflows, nodes, the queue, history and outputs, through the pod\'s proxy URL or any ComfyUI URL. It never creates, stops or bills a pod.',
  },
}

/** A shell word: quoted only when it needs to be. */
const shellWord = (s: string) => (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`)
const tomlList = (items: string[]) => `[${items.map((s) => JSON.stringify(s)).join(', ')}]`

function clientConfigs(name: string, program: string, args: string[], port: number): ClientConfigs {
  const stdio = [program, ...args]
  return {
    claude_code: `claude mcp add ${name} -- node ${stdio.map(shellWord).join(' ')}`,
    claude_desktop: JSON.stringify({ mcpServers: { [name]: { command: 'node', args: stdio } } }, null, 2),
    codex: `[mcp_servers.${name}]\ncommand = "node"\nargs = ${tomlList(stdio)}`,
    chatgpt: `# 1. Start the server over HTTP on this Mac:\nnode ${[...stdio, '--http', String(port)].map(shellWord).join(' ')}\n# 2. The MCP URL (ChatGPT needs it public: tunnel this port from this Mac first):\nhttp://127.0.0.1:${port}/mcp`,
  }
}

function endpoint(id: EndpointId, target?: string | null): Endpoint {
  const d = DEFINITIONS[id]
  const program = join(mcpDir(), d.file)
  const comfy = id === 'comfy-bridge' && target?.trim() ? target.trim() : null
  const args = comfy ? ['--comfy', comfy] : []
  const port = HTTP_PORTS[id]
  const command = ['node', program, ...args]
  return {
    id, name: d.name, title: d.title, purpose: d.purpose, program, exists: existsSync(program), args, command,
    command_line: command.map(shellWord).join(' '), target: comfy, http_port: port, http_url: `http://127.0.0.1:${port}/mcp`,
    clients: clientConfigs(d.name, program, args, port),
  }
}

/** The two endpoints; `comfy` is the bridge's target URL, which every one of its snippets carries. */
export const endpoints = (opts: { comfy?: string | null } = {}): Endpoint[] => [endpoint('pod-manager'), endpoint('comfy-bridge', opts.comfy)]

/** What the bridge can point at: the running pods whose ComfyUI answers, and the Mac's own install when it does. */
export async function targets(client?: RunPodClient, local = LOCAL_COMFY): Promise<Target[]> {
  const fetchFn = client?.fetchFn || fetch
  const [list, localReady] = await Promise.all([pods.list(client).catch(() => [] as pods.PodStatus[]), pods.comfyReady(local, fetchFn)])
  const out: Target[] = list.filter((p) => p.status === 'running' && p.web_ui_url && p.comfy_ready).map((p) => ({ pod_id: p.id, name: p.name, url: p.web_ui_url! }))
  if (localReady) out.push({ pod_id: null, name: 'This Mac', url: local })
  return out
}

/**
 * Check: spawn the endpoint over stdio as a client would (this process's node, so the packaged app needs no
 * node on the PATH), initialize, tools/list, and report the tool names and their full definitions (description, input schema). No key is needed in no-spend mode:
 * the configuration's dry_run is passed down as RUNPOD_DRY_RUN=1.
 */
export async function probe(id: EndpointId, opts: { comfy?: string | null; timeoutMs?: number } = {}): Promise<ProbeResult> {
  if (!DEFINITIONS[id]) throw bad(`No MCP endpoint ${id}`)
  const ep = endpoint(id, opts.comfy)
  if (!ep.exists) return { ok: false, tools: [], definitions: [], error: `Not built yet: ${ep.program}`, ms: 0 }
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  if (mounts.dryRun(mounts.load())) env.RUNPOD_DRY_RUN = '1'
  return probeCommand([ep.program, ...ep.args], env, opts.timeoutMs ?? PROBE_TIMEOUT_MS)
}

/** The stdio round-trip itself, against any program: initialize, notifications/initialized, tools/list. */
export function probeCommand(args: string[], env: NodeJS.ProcessEnv = process.env, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
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
      child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
