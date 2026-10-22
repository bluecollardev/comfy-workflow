# MCP Server: ComfyUI Agent Pool Control

> **2026-10-21.** Two servers now: this pod manager (the pool tools below plus 18 pod, volume, configuration, sync and cost tools) and the ComfyUI bridge (`mcp/comfy-bridge.mjs`), which lets a local agent work inside the ComfyUI running in a pod. Tool by tool: [`docs/MCP-ENDPOINTS.md`](MCP-ENDPOINTS.md). Client setup for Claude Code, Claude Desktop, Codex CLI and ChatGPT: the app's Connect › MCP tab. Both take `--http <port>` to serve over HTTP instead of stdio.

**Model Context Protocol (MCP) server** that exposes ComfyUI agent pool management as tools to Claude Code.

Claude Code ↔ MCP Server ↔ Pool Manager ↔ RunPod API

## Quick Start

### 1. Install

```bash
cd ~/workspaces/comfy_workflow
./start.sh mcp   # installs the app's dependencies on the first run; the server is Node, over the app's TypeScript core
```

### 2. Set Environment

```bash
export RUNPOD_API_KEY="rpa_..."
```

### 3. Start MCP Server

```bash
./start.sh mcp          # developer path from a checkout: apps/runpod-dashboard/mcp/server.mjs
```

Server listens on stdio (Claude Code connects directly). End users do not run this by hand:
the app's Connect › MCP tab gives each client a setup that launches the app's own executable
as the server (`docs/MCP-ENDPOINTS.md`, "Running"). `node mcp/server.mjs` still works from a checkout.

### 4. Register with Claude Code

In `~/.claude/codes/claude-code-config.json` (or via Claude Code settings):

```json
{
  "mcp_servers": {
    "comfy-moe": {
      "command": "/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager",
      "args": [
        "/Applications/RunPod Manager.app/Contents/Resources/mcp/server.cjs"
      ],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "RUNPOD_API_KEY": "rpa_..."
      }
    }
  }
}
```

### 5. Use in Claude Code

```
@claude.code
Claude, list the agents in our pool
```

Claude now has access to:
- `list_agents` — see all running agents
- `get_pool_status` — total cost, health
- `create_agent` — spin up a new GPU pod
- `stop_agent` — pause billing
- And 6 more...

---

## Tools Reference

### Monitoring

#### `list_agents`
List all agents in the pool with their status.

**Response:**
```json
[
  {
    "agent_id": "image-gen-abc123",
    "pod_id": "abc123def456",
    "agent_name": "image-gen",
    "gpu_type": "rtx4090",
    "status": "running",
    "comfyui_url": "http://abc123.proxy.runpod.io:8188",
    "api_url": "http://abc123.proxy.runpod.io:8000",
    "ssh_command": "ssh root@abc123.proxy.runpod.io",
    "health": {
      "status": 200,
      "timestamp": "2026-10-17T14:30:00"
    }
  }
]
```

#### `get_pool_status`
Detailed pool status: running agents, cost, health.

**Response:**
```json
{
  "total_agents": 2,
  "running_agents": 1,
  "stopped_agents": 1,
  "agents": [...],
  "total_cost_per_hour": 0.85,
  "created_at": "2026-10-17T14:00:00"
}
```

#### `get_agent_info`
Full details about one agent.

**Arguments:**
- `agent_id` (string, required) - Agent ID to query

**Response:**
```json
{
  "agent_id": "image-gen-abc123",
  "pod_id": "abc123",
  "status": "RUNNING",
  "gpu_type": "rtx4090",
  "storage_gb": 100,
  "memory_gb": 16,
  "cost_per_hour": 0.42,
  "comfyui_url": "http://abc123.proxy.runpod.io:8188"
}
```

#### `health_check_agent`
Check if an agent is responsive.

**Arguments:**
- `agent_id` (string, required) - Agent ID to check

**Response:**
```
✓ Healthy

{
  "status": 200,
  "timestamp": "2026-10-17T14:30:15"
}
```

---

### Pod Lifecycle

#### `create_agent`
Spin up a new GPU pod for an agent type.

**Arguments:**
- `agent_name` (string, required) - Type of agent (e.g., "image-gen", "video-gen")
- `gpu_type` (string, required) - a card from the core's table or `auto` (cheapest in stock where the volume lives): `auto`, `a4000`, `rtx4000ada`, `a5000`, `rtx3090`, `rtx4090`, `a6000`, `a40`. Bigger cards are left out on purpose (`libs/core/src/gpus.ts`).
- `storage_gb` (integer, optional) - Storage size. Default: 100. Range: 50-500

**Example:**
```
Create an image generation agent with RTX 4090 and 100GB storage
```

**Response:**
```
✓ Agent created: image-gen-abc123

ComfyUI: http://abc123.proxy.runpod.io:8188
SSH: ssh root@abc123.proxy.runpod.io
```

**Cost:** ~$0.42/hour (RTX 4090)

#### `stop_agent`
Pause a running agent (stops billing).

**Arguments:**
- `agent_id` (string, required) - Agent ID to stop

**Response:**
```
✓ Agent stopped: image-gen-abc123
```

**Cost:** $0/hour while stopped

#### `resume_agent`
Restart a stopped agent.

**Arguments:**
- `agent_id` (string, required) - Agent ID to resume

**Response:**
```
✓ Agent resumed: image-gen-abc123
```

#### `delete_agent`
Permanently destroy a pod (irreversible).

**Arguments:**
- `agent_id` (string, required) - Agent ID to delete

**Response:**
```
✓ Agent deleted: image-gen-abc123
```

---

### Job Management

#### `submit_job`
Submit a ComfyUI workflow to an agent.

**Arguments:**
- `agent_id` (string, required) - Agent to run the job
- `workflow_json` (string, required) - API-format ComfyUI workflow
- `prompt_name` (string, optional) - Job description

**Example:**
```
Submit text-to-image workflow to image-gen-abc123
```

**Response:**
```
✓ Job submitted: job-uuid-123

Agent: image-gen-abc123
API: https://abc123-8188.proxy.runpod.net/prompt
Status: https://abc123-8188.proxy.runpod.net/history/job-uuid-123
```

#### `get_job_status`
Check status of a running/completed job.

**Arguments:**
- `agent_id` (string, required) - Agent running the job
- `job_id` (string, required) - Job ID from submission

**Response:**
```json
{
  "status": "COMPLETED",
  "progress": 100,
  "outputs": [
    {
      "node_id": 8,
      "type": "IMAGE",
      "filename": "output_001.png",
      "url": "..."
    }
  ]
}
```

---

## Typical Workflows

### Spin Up a Development Pool

```
Claude, create a development agent pool:
- 1 image generation pod (RTX 4090)
- 1 video generation pod (A40, 48 GB)
- Both 100GB storage
```

Claude will:
1. Call `create_agent` for image-gen (RTX 4090)
2. Call `create_agent` for video-gen (A40)
3. Return pool status with URLs

### Monitor Cost

```
Claude, what's the current pool status and hourly cost?
```

Claude calls `get_pool_status` → you see running agents and `total_cost_per_hour`.

### Pause Between Work Sessions

```
Stop all agents to save money
```

Claude calls `stop_agent` for each running agent.

### Generate an Image

```
Submit this workflow to the image-gen agent:
{workflow JSON}
```

Claude:
1. Finds `image-gen-*` agent
2. Calls `submit_job` with workflow
3. Returns job ID and status URL

### Check Job Progress

```
Is the image generation job done?
```

Claude calls `get_job_status` → shows progress, outputs, errors.

---

## Architecture

```
Claude Code
    ↓
    └─→ MCP Server (apps/runpod-dashboard/mcp/server.mjs, over libs/core)
        ├─ Tool definitions (9 tools)
        └─ Tool handlers
            ↓
            └─→ Pool Manager (pool_manager.py)
                ├─ Async HTTP client
                └─ RunPod API calls
                    ↓
                    └─→ RunPod API
                        ├─ Pod lifecycle
                        ├─ Status queries
                        └─ Pod telemetry
```

## Configuration

### Environment Variables

```bash
RUNPOD_API_KEY=rpa_...          # Required: RunPod API key
```

### Pool State

Pool manager keeps agent state in memory:
```python
pool_manager.agents = {
    "image-gen-abc123": PoolAgent(...),
    "video-gen-def456": PoolAgent(...)
}
```

**Note:** State is lost on server restart. For persistence, add a database backend (future).

---

## Error Handling

### Agent Not Found
```
Agent not found: image-gen-xyz
```
Check `list_agents` to verify the agent exists.

### Pod Creation Failed
```
Error: RunPod API error: [...]
```
Check RunPod dashboard for account status, quota limits, or API key validity.

### Health Check Failed
```
✗ Unhealthy

{
  "error": "Connection refused",
  "timestamp": "2026-10-17T14:30:00"
}
```
Agent pod may be starting up. SSH in and check ComfyUI logs:
```bash
ssh root@pod-id.proxy.runpod.io
tail -f /root/logs/comfyui.log
```

---

## Advanced: Custom Job Submission

The `submit_job` tool accepts raw ComfyUI API-format workflows.

**Build workflow locally:**
```bash
comfy workflow compose blueprints/my_workflow.yaml
cat blueprints/my_workflow.compiled.json  # Copy this
```

**Submit to agent:**
```
Submit to image-gen-abc123:
{paste compiled JSON}
```

Claude submits it and returns the job URL to check progress.

---

## Costs & Budgeting

**GPU costs (hourly):** what the app's card menu shows, read from RunPod when it opens: the
secure-cloud price where the network volume lives (2026-10-21: A40 USD 0.35 in Montreal,
4090 USD 0.89 in Romania, RTX 4000 Ada USD 0.28 there). `get_pool_status` sums the running
agents' `cost_per_hr` from RunPod.

**Storage:**
- $0.10 per GB-month

**Tip:** Use `stop_agent` between work sessions to pause billing.

---

## Connect › MCP: setting up a client from the app

The app's Connect modal has an **MCP** tab (`apps/runpod-dashboard/src/components/McpPane.vue`) that
does the registration above for you. Per endpoint (this pod manager, and the ComfyUI bridge of
`docs/MCP-ENDPOINTS.md`) it shows the absolute command and a ready setup per client, each with Copy:

| Client | What you copy |
|---|---|
| Claude Code | `claude mcp add pod-manager -e ELECTRON_RUN_AS_NODE=1 -- <app executable> <app>/mcp/server.cjs` |
| Claude Desktop | the `mcpServers` JSON block for `claude_desktop_config.json` |
| Codex CLI | the `[mcp_servers.pod-manager]` TOML block for `~/.codex/config.toml` |
| ChatGPT | `http://127.0.0.1:8765/mcp`, served by the app once **Serve from the app** is on; ChatGPT only takes a public URL, so tunnel the port from this Mac |
| Remote (HTTP) | the same URL, for any client that takes a remote MCP URL |

The bridge card's Target menu (a running pod with ComfyUI, the Mac's own, or a typed URL) puts
`--comfy <url>` into every snippet. Each card has a connection badge (Connected, Not connected, Not checked; the bridge shows No target
until it has one): the app spawns each server over stdio, performs initialize and tools/list when the tab
is first shown, and **Check** repeats it, showing the tool count and time or the error; in no-spend mode it
needs no key. **Docs** opens a modal with every tool of the server, grouped (the `[group]` tag of the
description, or by name for the pod manager), searchable, each with its description, its ComfyUI call
(bridge) and a table of its parameters: type, required, default, options and description. The key the panel saved serves the server either way (`settings.applyToEnv()`), so the `env`
block in the JSON above is only needed when the app has no key stored.

## Testing

### Manual Test

```bash
# Terminal 1: Start MCP server
export RUNPOD_API_KEY="rpa_..."   # or the key entered in the app's Default Configuration
./start.sh mcp

# Terminal 2: Test in Claude Code
# Attach MCP server and ask:
# "List all agents in the pool"
```

### Automated Tests

```bash
cd apps/runpod-dashboard && npm run mcp:test   # spawns the server in no-spend mode: initialize, tools/list, one call
```

---

## Troubleshooting

### MCP Server Won't Start

```
Cannot find module '@modelcontextprotocol/sdk'
```

Install the app's dependencies:
```bash
cd apps/runpod-dashboard && npm install && npm run core:build
```

### Claude Code Can't Connect

Check `~/.claude/codes/claude-code-config.json`:
- Path to `mcp/server.cjs` (the bundle in the app's resources) is correct and the command is the app's own executable with `ELECTRON_RUN_AS_NODE=1`
- `RUNPOD_API_KEY` is set, or entered in the app's Default Configuration
- The core is built (`npm run core:build` in `apps/runpod-dashboard`)

### API Key Invalid

```
Error: Failed to load plugin schemas / Unauthorized
```

Verify API key:
```bash
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.io/graphql \
  -d '{"query":"{ myself { id } }"}'
```

Should return your user ID. If error, regenerate key at https://www.runpod.io/console/api-keys.

---

## Next Steps

1. **Job Submission** — Fully implement `submit_job` and `get_job_status` with websocket monitoring
2. **Database** — Persist pool state across restarts
3. **Scaling** — Auto-scale agents based on job queue depth
4. **Cost Tracking** — Dashboard showing spend over time
5. **Multi-Tenant** — Support multiple teams with separate quotas

---

**Questions?** See `CLAUDE.md` for project conventions.
