# ComfyUI MOE Architecture

**Complete system architecture for distributed ComfyUI agent pool orchestration.**

> **Status 2026-10-21.** The FastAPI backend, the Python MCP server and the Python
> pool manager this document describes are gone: the pod manager is one Electron app
> with a TypeScript core, and the MCP server and the CLI are Node programs over that
> core (`docs/ADR-005`). The layers and flows below still describe what the system
> does; where a file is named, the module now lives under
> `apps/runpod-dashboard/libs/core/src/` (pool: `pool.ts`; pods: `pods.ts`) or
> `apps/runpod-dashboard/mcp/server.mjs`. The OAuth login for a shared, deployed
> backend was dropped: the app runs on one PC per user. The "multi-user" sections are
> the ADR-002 plan, not what runs.

---

## Three-Layer Stack

```
Layer 1: Claude Code (User Interface)
         ↓ (asks Claude to manage infrastructure)
Layer 2: MCP Server (Tool Interface)
         ├─ Pool Management Tools
         ├─ Job Submission Tools
         └─ Health/Monitoring Tools
         ↓ (Claude calls tools)
Layer 3: Backend Services (Business Logic)
         ├─ Pool Manager (Python)
         ├─ FastAPI (REST API)
         ├─ OAuth Handler (Auth)
         └─ RunPod SDK (Infrastructure)
         ↓ (Python calls RunPod API)
Layer 4: Cloud Platform (Execution)
         └─ RunPod GPU Pods
```

---

## Component Breakdown

### Layer 1: Claude Code Interface
**File:** None (user-facing only)

Claude Code is the primary user interface. Users ask Claude to:
- "Create 2 image generation agents"
- "What's our hourly cost?"
- "Submit this workflow to video-gen-1"

### Layer 2: MCP Server
**File:** `apps/runpod-api/mcp_server.py`

Model Context Protocol server that exposes 9 tools to Claude:

**Monitoring Tools:**
- `list_agents` → see all agents
- `get_pool_status` → overall metrics
- `get_agent_info` → details of one agent
- `health_check_agent` → is it responsive?

**Lifecycle Tools:**
- `create_agent` → spin up a GPU pod
- `stop_agent` → pause (saves cost)
- `resume_agent` → turn back on
- `delete_agent` → destroy permanently

**Job Tools:**
- `submit_job` → run a ComfyUI workflow
- `get_job_status` → check progress

### Layer 3: Backend Services

#### Pool Manager
**File:** `apps/runpod-api/pool_manager.py`

Orchestrates pod lifecycle via RunPod GraphQL API.

**Core classes:**
```python
PoolManager          # Main orchestrator
  ├─ create_pod()   # Launch GPU pod
  ├─ get_pod_status()
  ├─ stop_pod()
  ├─ resume_pod()
  ├─ delete_pod()
  ├─ health_check_agent()
  └─ get_pool_status()

PoolAgent           # Represents one GPU pod
  ├─ agent_id
  ├─ pod_id
  ├─ gpu_type
  ├─ status
  └─ health

PodConfig           # Config for creating pods
  ├─ agent_name
  ├─ gpu_type
  └─ storage_gb
```

#### FastAPI Backend
**File:** `apps/runpod-api/pod_manager_api.py`

REST API for pod management + WebSocket live updates.

**Endpoints:**
```
GET    /api/dashboard      → Current pool state
GET    /api/pods           → List all pods
POST   /api/stop           → Stop a pod
POST   /api/resume         → Resume a pod
DELETE /api/pods/{id}      → Delete a pod
WS     /ws/pods            → Real-time updates
```

#### OAuth Handler
**File:** `apps/runpod-api/oauth_handler.py`

Authentication layer for team coordination.

**Functions:**
- `get_authorization_url()` → RunPod OAuth login
- `exchange_code_for_token()` → Get JWT tokens
- `verify_token()` → Validate requests
- `get_current_user()` → FastAPI dependency

#### Frontend Dashboard
**Files:** `apps/runpod-dashboard/src/`

Vue 3 SPA showing:
- Pod grid (status, controls)
- Real-time cost tracking
- Job submission form
- Health status

### Layer 4: Cloud Platform
**Provider:** RunPod

- **GPU Pods** → Compute (RTX 4090, A100, H100, etc.)
- **Persistent Volumes** → Storage for models
- **API** → GraphQL for pod management
- **Proxy URLs** → Web access to pods

---

## Data Flow Examples

### Example 1: Create an Agent

```
User (Claude Code)
  │
  ├─→ "Create an image-gen agent with RTX 4090"
  │
Claude interprets request
  │
  ├─→ Calls MCP tool: create_agent(
        agent_name="image-gen",
        gpu_type="rtx4090",
        storage_gb=100
      )
  │
MCP Server
  │
  ├─→ Calls Pool Manager: create_pod(config)
  │
Pool Manager
  │
  ├─→ HTTP POST to RunPod GraphQL API:
      mutation {
        podFindAndDeployOnDemand(...) {
          id, name, status, costPerHr
        }
      }
  │
RunPod API
  │
  ├─→ Allocates GPU pod (2-3 minutes)
  │
RunPod returns: pod_id = "abc123"
  │
Pool Manager
  │
  ├─→ Creates PoolAgent record
  ├─→ Adds to self.agents["image-gen-abc123"]
  │
MCP Server
  │
  ├─→ Returns to Claude:
      "✓ Agent created: image-gen-abc123
       ComfyUI: http://abc123.proxy.runpod.io:8188
       SSH: ssh root@abc123.proxy.runpod.io"
  │
Claude presents to user
```

### Example 2: Submit a Job

```
User: "Submit this workflow to image-gen-abc123"
[copies ComfyUI workflow JSON]
  │
Claude
  │
  ├─→ MCP tool: submit_job(
        agent_id="image-gen-abc123",
        workflow_json="{...}",
        prompt_name="portrait"
      )
  │
MCP Server
  │
  ├─→ Find agent in Pool Manager
  ├─→ HTTP POST to agent's API:
      POST https://abc123-8188.proxy.runpod.net/prompt
      Body: {workflow JSON}
  │
Agent (ComfyUI on pod)
  │
  ├─→ Receives workflow
  ├─→ Queues job
  ├─→ Returns: job_id = "uuid-123"
  │
MCP Server
  │
  ├─→ Returns job_id to Claude
  │
Claude
  │
  ├─→ "Job submitted! Check status at:
       https://abc123-8188.proxy.runpod.net/history/uuid-123"
```

### Example 3: Monitor Cost

```
User: "What's our hourly cost?"
  │
Claude
  │
  ├─→ MCP tool: get_pool_status()
  │
Pool Manager
  │
  ├─→ For each agent, query RunPod:
      GET pod status → costPerHr
  │
  ├─→ Sum all costs
  │
  ├─→ Return PoolStatus {
        total_agents: 2,
        running_agents: 1,
        stopped_agents: 1,
        total_cost_per_hour: 0.85,
        agents: [...]
      }
  │
Claude
  │
  ├─→ "You have 2 agents. 1 running ($0.42/hr RTX 4090),
       1 stopped. Total: $0.42/hr"
```

---

## Authentication & Authorization

### OAuth Flow
1. User visits dashboard
2. Clicks "Login with RunPod"
3. Redirected to RunPod OAuth
4. User approves
5. Redirected back with code
6. FastAPI exchanges code for JWT tokens
7. JWT stored in browser localStorage
8. All subsequent requests carry JWT in header

### JWT Structure
```
Access Token (30 min expiry):
  {
    sub: "user-id",
    scopes: ["read", "write"],
    exp: 1234567890
  }

Refresh Token (7 day expiry):
  {
    sub: "user-id",
    type: "refresh",
    exp: 1234567890
  }
```

### Scopes
- `read` — View pods, status, costs
- `write` — Create/stop/delete pods
- `admin` — (future) Manage quotas, billing

---

## Deployment Scenarios

### Local Development
```
Your Machine:
  ├─ FastAPI backend (localhost:8000)
  ├─ Vue frontend (localhost:5173)
  ├─ MCP server (stdio to Claude Code)
  └─ RunPod pods (on cloud, accessible via proxy)
```

**Setup:**
```bash
./infra/setup-team.sh
# Start backend
python3 apps/runpod-api/pod_manager_api.py --reload

# Start frontend (new terminal)
cd apps/runpod-dashboard && npm run dev

# MCP server (in Claude Code)
@mcp attach comfy-moe
```

### Team Coordination
```
Multiple developers:
  ├─ Shared FastAPI backend (deployed)
  ├─ Shared MCP server (deployed)
  └─ Shared pool of GPU agents
```

All team members see same agent pool, can coordinate work.

### Production
```
Prod infrastructure:
  ├─ FastAPI on managed platform (Docker + load balancer)
  ├─ PostgreSQL for state persistence
  ├─ Large pool of GPU agents
  ├─ Cost tracking & alerting
  └─ API rate limiting & quotas per team
```

---

## Technology Choices

| Component | Tech | Why |
|-----------|------|-----|
| Pod Orchestration | Python + RunPod SDK | Official, stable, production-grade |
| MCP Server | Python mcp library | Claude native integration |
| API Backend | FastAPI | Async, fast, auto-docs, WebSocket |
| Frontend | Vue 3 + Vite | Reactive, hot reload, lightweight |
| Authentication | OAuth + JWT | Industry standard, secure |
| Database | (future) PostgreSQL | ACID compliance, team state |

**Terraform IaC?** Separate branch (`feature/terraform-iac`). RunPod provider unstable; Python SDK is production-grade alternative.

---

## Scaling Considerations

### Horizontal Scaling
- Pool Manager can handle 1000s of pods
- Each pod = independent compute
- Cost scales linearly: 10 pods = 10× cost

### Vertical Scaling
- FastAPI handles 1000s of concurrent users
- WebSocket broadcasts to all connected clients
- Database (future) handles team coordination

### Cost Optimization
1. **Idle shutdown** — Stop agents when queue empty
2. **Batch jobs** — Group small jobs together
3. **Model caching** — Shared volume across agents
4. **Right-sizing** — Use cheapest GPU that fits workload

---

## Future Enhancements

### Phase 2
- [ ] Database persistence (PostgreSQL)
- [ ] Job queue with scheduling
- [ ] WebSocket job progress streaming
- [ ] Cost dashboard & budgets

### Phase 3
- [ ] Kubernetes orchestration (instead of RunPod)
- [ ] Multi-cloud support (AWS, Azure)
- [ ] CI/CD integration (GitHub Actions trigger jobs)

### Phase 4
- [ ] Advanced scheduling (fairness, priorities)
- [ ] Model versioning & rollback
- [ ] Team quotas & billing

---

## Related Docs

- **MCP-SERVER.md** — Tool reference & usage
- **SETUP.md** (terraform) — IaC for agents (alternative)
- **CLAUDE.md** — Project conventions
- **ADR-002-moe-agent-pool.md** — Architecture decisions

---

**Questions?** See inline code comments or open an issue.
