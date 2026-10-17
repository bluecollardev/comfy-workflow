# ADR-002: Mixture of Experts (MOE) Agent Pool Infrastructure

**Date:** 2026-10-17  
**Status:** Accepted  
**Owner:** Lucas (Blue Collar Dev)  
**Stakeholders:** Multiple coordinating users/agents

## Context

We have multiple users and autonomous agents coordinating work across a shared ComfyUI infrastructure on RunPod. A single on-demand pod is insufficient for:

- **Concurrent jobs** — multiple users/agents submitting simultaneously
- **Fault isolation** — one failing job shouldn't block others
- **Resource efficiency** — different workloads (text-to-image vs. video) need different GPUs
- **Reproducibility** — new team members should spin up identical environments
- **Auditability** — track who did what, when, and with what resources

## Decision

**Use Terraform to manage the MOE agent pool infrastructure.**

### What is MOE in this context?

A pool of specialized, autonomous agents that:
- Operate independently (each has own pod/compute)
- Share orchestration (central control plane via FastAPI)
- Coordinate work (MCP server exposes tools)
- Use Flash SDK for serverless (batch + cost optimization)

Example pool:
```
Agent 1 (Image generation)  → RTX 4090 pod
Agent 2 (Video generation) → A100 pod
Agent 3 (Upscaling)        → L40S pod
  ↓
FastAPI + OAuth (orchestrator)
  ↓
MCP Server (tool registry)
  ↓
Claude Code + other clients
```

## Architecture

### Three-Tier Infrastructure

```
┌─────────────────────────────────────────────┐
│         Control Plane (FastAPI + OAuth)     │
│  • Pod lifecycle management                 │
│  • Job queuing & routing                    │
│  • Agent authentication                     │
│  • WebSocket real-time updates              │
└─────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────┐
│      Agent Pool (Terraform-managed)         │
│  ┌─────────────┐  ┌──────────────┐         │
│  │  Agent Pod  │  │  Agent Pod   │         │
│  │  (RTX 4090) │  │  (A100)      │         │
│  └─────────────┘  └──────────────┘         │
│  ┌─────────────────────────────────┐       │
│  │    Shared Volume / Storage      │       │
│  │  (models, checksums, outputs)   │       │
│  └─────────────────────────────────┘       │
└─────────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────────┐
│    Flash SDK Serverless (cost optimization) │
│  • Batch rendering (idle pods scale → 0)    │
│  • Pay-per-job for burst workloads          │
└─────────────────────────────────────────────┘
```

### Why Terraform for Agent Pool

| Requirement | Terraform | Python CLI |
|---|---|---|
| **Team reproducibility** | ✅ IaC tracked in git | ❌ Manual per-user |
| **Multi-pod coordination** | ✅ All pods in one graph | ❌ Separate scripts |
| **State locking** | ✅ Prevents concurrent edits | ❌ Race conditions |
| **Resource quotas** | ✅ Enforce limits | ❌ No guardrails |
| **Destruction** | ✅ `terraform destroy` | ❌ Manual teardown |
| **Drift detection** | ✅ `terraform plan` | ❌ Unknown |
| **Cost forecasting** | ✅ All resources visible | ❌ Scattered |

## Implementation Plan

### Phase 1: Core Terraform (This week)

**Modules:**

1. **`runpod_pod`** — Spawn a single GPU pod
   - Inputs: GPU type, storage size, name, environment vars
   - Outputs: pod_id, pod_url, ssh_command
   - Supports all RunPod GPU types (RTX 4090, A100, H100, L40S, etc.)

2. **`runpod_agent`** — Configure pod as an agent
   - Installs: ComfyUI, FastAPI client, MCP SDK
   - Configures: Control plane URL, agent ID, credentials
   - Health checks: /health endpoint

3. **`moe_pool`** — Orchestrate N agents
   - Takes: `agents = [{name: "...", gpu: "...", count: 1}]`
   - Creates: All pods, configures them, outputs pool status
   - Manages: Scaling rules (min/max per agent type)

### Phase 2: FastAPI Integration (Next)

- Terraform outputs → FastAPI reads pod_ids
- FastAPI → agent health checks
- Auto-register agents in MCP server

### Phase 3: Flash SDK (Later)

- Terraform manages serverless endpoints
- FastAPI routes batch jobs → serverless
- Auto-scale based on queue depth

## Terraform File Structure

```
infra/terraform/
├── main.tf                 # Root module
├── variables.tf            # Input variables
├── outputs.tf              # Pool state outputs
├── versions.tf             # Provider versions
├── terraform.tfvars        # Team configuration
├── terraform.tfvars.example
│
├── modules/
│   ├── runpod_pod/         # Single pod
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── runpod_agent/       # Pod as agent
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   ├── outputs.tf
│   │   └── scripts/        # Cloud-init / setup
│   │       └── agent_init.sh
│   │
│   └── moe_pool/           # Agent pool orchestrator
│       ├── main.tf
│       ├── variables.tf
│       ├── outputs.tf
│       └── locals.tf
│
└── environments/           # Team/env configs
    ├── dev.tfvars
    ├── staging.tfvars
    └── prod.tfvars
```

## Usage

### Team member spins up agent pool

```bash
cd infra/terraform

# Initialize (first time)
terraform init

# Check what will be created
terraform plan -var-file=environments/dev.tfvars

# Create the pool
terraform apply -var-file=environments/dev.tfvars

# Get agent connection details
terraform output -json > agent_pool.json
```

### Python CLI becomes a wrapper

```bash
# Old: python scripts/create_pod.py create --gpu rtx4090
# New: terraform apply + auto-register in FastAPI
```

### Scale the pool

```bash
# Edit environments/dev.tfvars
# agents = [
#   { name = "image-gen", gpu = "rtx4090", count = 2 },  # was 1
#   { name = "video-gen", gpu = "a100", count = 1 }
# ]

terraform plan
terraform apply
```

## Cost & Quotas

Terraform will enforce:

```hcl
# max_concurrent_pods = 5
# max_storage_per_agent = 100 # GB
# max_monthly_spend = 10000   # dollars
# shutdown_after = "6h"       # idle timeout
```

Team approves changes before they affect billing.

## Security & Credentials

- **RunPod API Key:** `RUNPOD_API_KEY` env var (not in terraform.tfvars)
- **Agent credentials:** Auto-generated, stored in RunPod volume (not committed)
- **State file:** Shared team storage (S3/Azure/local git-ignored)

```bash
# .gitignore
terraform.tfstate*
*.tfvars         # Except terraform.tfvars.example
.terraform/
```

## Rollout

1. **Week 1:** Terraform modules (Phase 1)
2. **Week 2:** FastAPI integration
3. **Week 3:** Flash SDK + serverless
4. **Week 4:** Team onboarding + runbooks

## Success Criteria

- ✅ New team member runs `terraform apply` → pool is live
- ✅ Pod failure → `terraform plan` detects drift
- ✅ Cost forecasting: `terraform` shows all resources + spend
- ✅ Git history: Every infrastructure change is auditable
- ✅ Safety: Destructive changes require approval

## Open Questions

- Should we use Terraform Cloud for state locking? (Yes, recommend)
- RunPod API rate limits? (Check docs)
- Auto-shutdown policy? (Configurable per agent)
- Disaster recovery? (Terraform snapshots)

## References

- RunPod Terraform provider: https://github.com/runpod/terraform-provider-runpod
- Terraform modules: https://registry.terraform.io
- FastAPI webhook integration: Our oauth_routes.py
- MCP Server registration: TBD (Phase 2)

---

**Next:** Build Phase 1 Terraform modules.
