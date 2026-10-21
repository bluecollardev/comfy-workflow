#!/usr/bin/env node
// The MCP server Claude Code launches over stdio (`./start.sh mcp`, `npm run mcp`): the agent pool
// (docs/ADR-002) and the governance pages, over the core (libs/core, docs/ADR-005) and nothing else:
// no Python, no HTTP server, no port. The port of apps/runpod-api/mcp_server.py, tool for tool, so
// docs/MCP-SERVER.md stays true.
//
// Governance (shared/governance, Binc's policies) is applied to every connecting client: handed over
// at initialize as the server's instructions, served as governance:// resources and through the
// `governance` tool, and enforced on the tools that spend: create_agent without approved_by makes no
// pod. Nothing is cached; a re-sync of the pages is applied on the next launch.
//
// No-spend mode (the configuration's dry_run, or RUNPOD_DRY_RUN=1) acts on simulated pods, as the app
// does, and every answer says so. stdout is the protocol: anything we have to say goes to stderr.
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORE = resolve(HERE, '..', 'libs', 'core', 'dist', 'index.js')
if (!existsSync(CORE)) {
  console.error(`The core is not built (${CORE}). Run: cd apps/runpod-dashboard && npm run core:build`)
  process.exit(2)
}
const { governance, pool, settings } = await import(pathToFileURL(CORE).href)
const { version } = createRequire(import.meta.url)('../package.json')

settings.applyToEnv()   // the key the panel saved, when the shell exported none; no key is fine in no-spend mode

const agentId = { type: 'string', description: 'Agent ID' }
/** The Python's tool list, verbatim where the core allows; the GPU menu is the core's card table, not a guess. */
const TOOLS = [
  { name: 'list_agents', description: 'List all agents in the MOE pool with their status', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_pool_status', description: 'Get detailed status of the entire agent pool (running pods, cost, health)', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'governance',
    description: "The rules this session runs under (shared/governance, Binc's policies): list the pages, or read one by name, e.g. policy/agent-permissions.md",
    inputSchema: { type: 'object', properties: { page: { type: 'string', description: 'Page name to read; omit to list every page' } } },
  },
  {
    name: 'create_agent',
    description: `Create a new GPU pod agent for the pool. Spends money: needs approved_by, the person behind the named yes (policy/agent-permissions.md, cap USD ${governance.SPEND_CAP_USD})`,
    inputSchema: {
      type: 'object',
      properties: {
        approved_by: { type: 'string', description: 'Who said yes to this spend. Required; never guessed.' },
        agent_name: { type: 'string', description: "Agent type (e.g., 'image-gen', 'video-gen', 'upscale')" },
        gpu_type: { type: 'string', enum: pool.GPU_TYPES, description: 'GPU type for this agent: a card from the pod manager\'s table, or auto for the cheapest one in stock' },
        storage_gb: { type: 'integer', description: 'Storage size in GB (50-500); 0 beside a network volume', default: 100 },
      },
      required: ['agent_name', 'gpu_type'],
    },
  },
  { name: 'stop_agent', description: 'Stop a running agent pod (pauses billing)', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to stop' } }, required: ['agent_id'] } },
  { name: 'resume_agent', description: 'Resume a stopped agent pod', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to resume' } }, required: ['agent_id'] } },
  { name: 'delete_agent', description: 'Permanently delete an agent pod', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to delete' } }, required: ['agent_id'] } },
  { name: 'health_check_agent', description: 'Check if an agent is healthy and responding', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to check' } }, required: ['agent_id'] } },
  { name: 'get_agent_info', description: 'Get detailed information about an agent', inputSchema: { type: 'object', properties: { agent_id: { ...agentId, description: 'Agent ID to get info for' } }, required: ['agent_id'] } },
  {
    name: 'submit_job',
    description: 'Submit a ComfyUI workflow to an agent for execution',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { ...agentId, description: 'Agent ID to submit job to' },
        workflow_json: { type: 'string', description: 'ComfyUI workflow JSON (API format)' },
        prompt_name: { type: 'string', description: 'Name/description of this job' },
      },
      required: ['agent_id', 'workflow_json'],
    },
  },
  {
    name: 'get_job_status',
    description: 'Get status of a submitted job',
    inputSchema: {
      type: 'object',
      properties: { agent_id: { ...agentId, description: "Agent that's running the job" }, job_id: { type: 'string', description: 'Job ID from submission' } },
      required: ['agent_id', 'job_id'],
    },
  },
]

const NO_SPEND = '(no-spend mode: simulated pod; nothing reached RunPod, nothing is billed)'
const text = (t, isError = false) => ({ content: [{ type: 'text', text: pool.dryRun() ? `${t}\n\n${NO_SPEND}` : t }], isError })
const json = (v) => text(JSON.stringify(pool.dryRun() && v && !Array.isArray(v) && typeof v === 'object' ? { ...v, dry_run: true } : v, null, 2))

/** tool name -> what it answers. Each returns a CallToolResult; the dispatcher below turns throws into one. */
const HANDLERS = {
  governance: async ({ page }) => {
    if (!page) return json(governance.listing())
    const t = governance.read(page)
    return t == null ? text(`No such page: ${page}. Pages: ${governance.listing().map((p) => p.name).join(', ')}`, true) : text(t)
  },
  list_agents: async () => json(pool.agents()),
  get_pool_status: async () => json(await pool.status()),
  create_agent: async (args) => {
    const refusal = governance.namedYes(args, 'create_agent')   // the gate: no named yes, no pod
    if (refusal) return text(refusal, true)
    const a = await pool.create({ agent_name: args.agent_name, gpu_type: args.gpu_type, storage_gb: args.storage_gb ?? 100 })
    console.error(`create_agent ${a.agent_id} (pod ${a.pod_id}) approved by ${String(args.approved_by).trim()}`)
    return text(`✓ Agent created: ${a.agent_id}\n\nComfyUI: ${a.comfyui_url}\nSSH: ${a.ssh_command}`)
  },
  stop_agent: async ({ agent_id }) => { await pool.stop(agent_id); return text(`✓ Agent stopped: ${agent_id}`) },
  resume_agent: async ({ agent_id }) => { await pool.resume(agent_id); return text(`✓ Agent resumed: ${agent_id}`) },
  delete_agent: async ({ agent_id }) => { await pool.remove(agent_id); return text(`✓ Agent deleted: ${agent_id}`) },
  health_check_agent: async ({ agent_id }) => {
    const { healthy, agent } = await pool.healthCheck(agent_id)
    return text(`${healthy ? '✓ Healthy' : '✗ Unhealthy'}\n\n${JSON.stringify(agent.health, null, 2)}`)
  },
  get_agent_info: async ({ agent_id }) => json(await pool.info(agent_id)),
  submit_job: async ({ agent_id, workflow_json, prompt_name }) => {
    const job = await pool.submitJob(agent_id, workflow_json, prompt_name)
    return text(`✓ Job submitted: ${job.job_id}\n\nAgent: ${job.agent_id}\nAPI: ${job.api_url}\nStatus: ${job.status_url}`)
  },
  get_job_status: async ({ agent_id, job_id }) => json(await pool.jobStatus(agent_id, job_id)),
}

const server = new Server({ name: 'comfy-moe-server', version }, {
  capabilities: { tools: {}, resources: {} },
  instructions: governance.instructions(),   // applied to every client at initialize
})

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const handler = HANDLERS[params.name]
  if (!handler) return text(`Unknown tool: ${params.name}`, true)
  try {
    return await handler(params.arguments || {})
  } catch (e) {
    const message = e?.message || String(e)
    if (e?.status === 404) return text(message, true)   // "Agent not found: x", as the Python answered
    console.error(`Tool error: ${params.name}: ${message}`)
    return text(`Error executing ${params.name}: ${message}`, true)
  }
})

// Every governance page, as governance://<page>.
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: governance.listing().map((p) => ({ uri: p.uri, name: p.name, mimeType: 'text/markdown', description: "shared/governance: Binc's policies, copied from the CANALV2 tree" })),
}))
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const name = governance.uriToName(String(params.uri))
  const t = governance.read(name)
  if (t == null) throw new Error(`No such governance page: ${name}`)
  return { contents: [{ uri: params.uri, mimeType: 'text/markdown', text: t }] }
})

await server.connect(new StdioServerTransport())
console.error(`comfy-moe-server ${version} on stdio; governance from ${governance.folder() || 'nowhere'}; ${pool.dryRun() ? 'no-spend mode' : process.env.RUNPOD_API_KEY ? 'live' : 'no RUNPOD_API_KEY: pod tools will refuse until one is set'}`)
