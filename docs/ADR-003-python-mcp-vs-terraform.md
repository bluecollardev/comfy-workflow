# ADR-003: Python + MCP vs. Terraform for POD Orchestration

**Date:** 2026-10-17  
**Status:** Accepted  
**Owner:** Lucas (Blue Collar Dev)

## Context

We need a way to manage ComfyUI agent pools on RunPod: create/stop/delete GPU pods, monitor health, submit jobs.

**Three options evaluated:**

1. **Terraform** (HashiCorp IaC)
2. **Python SDK** (RunPod official)
3. **Custom provider** (build our own)

## Decision

**Use Python SDK + MCP Server** (Option 2).

Keep Terraform code in `feature/terraform-iac` branch as reference, but don't use it for production orchestration.

## Rationale

### Why NOT Terraform

#### 1. Provider Instability
**Problem:** RunPod Terraform provider v1.0.9 has schema bugs.

```
Error: Failed to load plugin schemas
AttributeName("workers"): must have Required, Optional, or Computed set
```

- Blocks both local and Terraform Cloud workflows
- No stable older versions in registry
- Community-maintained (not official)
- Maintenance status: unclear

**Impact:** Can't use Terraform at all until provider is fixed (weeks/months unknown).

#### 2. Learning Curve
Terraform requires learning:
- HCL syntax (not Go, Python, or familiar language)
- State management
- Provider development
- Module composition

**Our team:** Python experts, no Terraform/Go expertise.

#### 3. Iteration Speed
Terraform workflow:
```
Edit config → terraform plan → debug → apply → observe → repeat
```

Problem: Plan step is slow when dealing with provider bugs (like the schema issue above).

Python workflow:
```
Edit code → import module → test → iterate
```

Faster debugging, faster iteration.

#### 4. Abstraction Layer
Terraform adds indirection:
- Write HCL
- Terraform parses HCL
- Terraform calls provider
- Provider wraps RunPod SDK
- SDK calls RunPod API

With Python:
- Write Python
- Python imports RunPod SDK
- SDK calls RunPod API

**Result:** Same functionality, simpler path.

#### 5. Not Building Infrastructure Tools
Core business: **ComfyUI workflows, not Terraform providers.**

Writing a Terraform provider ourselves (Option 3) would:
- Take 8-12 weeks
- Require Go expertise
- Become maintenance burden
- Not fit team specialization

### Why Python + MCP

#### 1. Official & Stable
RunPod maintains Python SDK:
```python
from runpod import Client
client = Client(api_key=...)
pod = client.create_pod(...)
```

- Production-grade
- Well-tested
- Official documentation
- Maintained by RunPod

#### 2. Fast Iteration
```python
pool_manager = PoolManager(api_key)
agent = await pool_manager.create_pod(config)
```

- Async/await for concurrent operations
- Clear error messages
- Pydantic for type safety
- Easy to test

#### 3. Claude Integration
MCP Server in Python naturally exposes tools to Claude Code:

```python
@server.call_tool()
async def call_tool(name: str, arguments: dict):
    if name == "create_agent":
        agent = await pool_manager.create_pod(...)
        return ToolResult(...)
```

- Claude sees 9 concrete tools
- No abstraction loss
- Direct control

#### 4. Team Fit
- Team knows Python
- FastAPI already chosen for backend
- Same language = coherent codebase
- Faster onboarding

#### 5. Same IaC Benefits
While not "Terraform IaC," Python + MCP still provides:

| Benefit | Terraform | Python + MCP |
|---------|-----------|------------|
| Version controlled | ✅ | ✅ (code in git) |
| Repeatable | ✅ | ✅ (exact same calls) |
| Documented | ❌ HCL is cryptic | ✅ Clear Python |
| Auditable | ✅ | ✅ (code review) |
| Testable | ❌ Hard to test HCL | ✅ Unit tests |
| Debuggable | ❌ Opaque provider | ✅ Print statements |

### Cost-Benefit

| Effort | Terraform | Python |
|--------|-----------|--------|
| **Initial setup** | ~4 weeks (provider issues) | ~1 week |
| **Iteration** | Slow (plan → debug cycle) | Fast |
| **Maintenance** | Medium (provider updates) | Low |
| **Learning curve** | Steep (HCL, provider model) | Gentle |
| **Debugging** | Hard (provider is black box) | Easy |

**Result:** Python wins on all axes.

## Alternatives Considered

### A. Fix the Terraform Provider
- **Effort:** 2-4 weeks
- **Blocker:** Requires Go expertise we don't have
- **Payoff:** Still not official from RunPod
- **Decision:** Not worth it

### B. Use Pulumi Instead of Terraform
- **Language:** Python (better fit!)
- **Problem:** Still needs RunPod provider
- **Status:** RunPod doesn't officially support Pulumi
- **Decision:** Adds same problems without solving them

### C. Write Custom Provider
- **Effort:** 8-12 weeks
- **Language:** Go (not our strength)
- **Maintenance:** Forever
- **Payoff:** Only useful if 50+ teams use it
- **Decision:** Not core business

### D. Use CloudFormation / ARM Templates
- **Problem:** AWS/Azure only, not RunPod
- **Decision:** Wrong platform

## Implementation

### Python + MCP Stack

```
Pool Manager (pool_manager.py)
  ├─ Async HTTP client
  ├─ RunPod GraphQL API calls
  └─ State management

MCP Server (mcp_server.py)
  ├─ 9 tools exposed to Claude
  ├─ Tool input validation
  └─ Error handling

FastAPI Backend (pod_manager_api.py)
  ├─ REST endpoints
  ├─ WebSocket updates
  └─ OAuth authentication

Vue Frontend
  ├─ Pod dashboard
  ├─ Job submission
  └─ Real-time status
```

### Terraform Branch

Kept in `feature/terraform-iac` as reference:
- Code is valid infrastructure-as-code thinking
- Could be useful if RunPod provider stabilizes
- Shows what IaC *would* look like
- Not blocking active development

## Consequences

### Positive
- ✅ Works immediately (no provider bugs)
- ✅ Fast iteration
- ✅ Team expertise match
- ✅ Claude integration is native
- ✅ Easier debugging
- ✅ Same infrastructure-as-code benefits

### Negative
- ❌ Not "Terraform certified" (industry standard?)
- ❌ More code to maintain (vs HCL templates)
- ❌ State must be managed manually (no remote locking *yet*)
- ❌ Can't reuse Terraform modules from other projects

### Mitigation
- Write unit tests for Pool Manager
- Document API thoroughly (MCP tools are self-documenting)
- Add database persistence layer later (PostgreSQL) for shared state
- Code review before major orchestration changes

## Decision Drivers

1. **Time to working system:** Python wins (days vs weeks)
2. **Team velocity:** Python wins (no learning Go)
3. **Maintainability:** Python wins (clear code vs HCL)
4. **Claude integration:** Python wins (native MCP)
5. **Industry standard:** Terraform wins (but doesn't work here)

**Conclusion:** Pragmatism > standards when standards don't work.

## Future Reconsideration

This decision can be revisited if:
1. RunPod releases an official, stable Terraform provider (v2.0+)
2. Team expands to require Terraform (multi-cloud, large ops team)
3. Multi-region/multi-cloud becomes requirement (IaC essential)

Until then: **Python + MCP is the right choice.**

## References

- **Terraform RunPod Provider:** https://github.com/runpod/terraform-provider-runpod
- **RunPod Python SDK:** https://github.com/runpod/runpod-python (official)
- **MCP Protocol:** https://modelcontextprotocol.io
- **Architecture:** See `docs/ARCHITECTURE.md`

---

## Sign-Off

**Decision:** Python + MCP for pod orchestration  
**Alternative:** Terraform (documented in feature/terraform-iac)  
**Rationale:** Provider instability + faster iteration + team fit  
**Status:** Accepted and implemented  
**Review date:** 2027-01-01 (reassess provider stability)
