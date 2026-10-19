# MCP Server: ComfyUI Agent Pool Control

**Model Context Protocol (MCP) server** that exposes ComfyUI agent pool management as tools to Claude Code.

Claude Code ↔ MCP Server ↔ Pool Manager ↔ RunPod API

## Quick Start

### 1. Install Dependencies

```bash
cd ~/workspaces/comfy_workflow
pip install -r apps/runpod-api/requirements.txt
```

### 2. Set Environment

```bash
export RUNPOD_API_KEY="rpa_..."
```

### 3. Start MCP Server

```bash
cd apps/runpod-api
python3 mcp_server.py
```

Server listens on stdio (Claude Code connects directly).

### 4. Register with Claude Code

In `~/.claude/codes/claude-code-config.json` (or via Claude Code settings):

```json
{
  "mcp_servers": {
    "comfy-moe": {
      "command": "python3",
      "args": [
        "/Users/lucas/workspaces/comfy_workflow/apps/runpod-api/mcp_server.py"
      ],
      "env": {
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
- `gpu_type` (string, required) - GPU type: `rtx4090`, `a100`, `h100`, `l40s`, `rtx6000`
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
API: http://abc123.proxy.runpod.io:8000/api/prompt
Status: http://abc123.proxy.runpod.io:8000/history/job-uuid-123
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
- 1 video generation pod (A100)
- Both 100GB storage
```

Claude will:
1. Call `create_agent` for image-gen (RTX 4090)
2. Call `create_agent` for video-gen (A100)
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
    └─→ MCP Server (mcp_server.py)
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

**GPU costs (hourly):**
- RTX 4090: ~$0.42/hr
- A100: ~$1.00/hr
- H100: ~$1.50/hr
- L40S: ~$0.60/hr
- RTX 6000: ~$0.50/hr

**Storage:**
- $0.10 per GB-month

**Tip:** Use `stop_agent` between work sessions to pause billing.

---

## Testing

### Manual Test

```bash
# Terminal 1: Start MCP server
cd apps/runpod-api
export RUNPOD_API_KEY="rpa_..."
python3 mcp_server.py

# Terminal 2: Test in Claude Code
# Attach MCP server and ask:
# "List all agents in the pool"
```

### Automated Tests (future)

```bash
pytest apps/runpod-api/tests/test_mcp_server.py
```

---

## Troubleshooting

### MCP Server Won't Start

```
ModuleNotFoundError: No module named 'mcp'
```

Install dependencies:
```bash
pip install -r apps/runpod-api/requirements.txt
```

### Claude Code Can't Connect

Check `~/.claude/codes/claude-code-config.json`:
- Path to script is correct
- `RUNPOD_API_KEY` is set
- Script is executable: `chmod +x apps/runpod-api/mcp_server.py`

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
