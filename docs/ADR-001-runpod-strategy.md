# ADR-001: RunPod Deployment Strategy - Hybrid Serverless + On-Demand

**Status:** ACCEPTED  
**Date:** 2026-10-17  
**Author:** Lucas (Blue Collar Dev)

## Context

ComfyUI workload patterns vary significantly:
- **Development/Iteration**: Interactive tweaking, prompt testing, parameter adjustment
- **Production/Batch**: Large-scale rendering, multi-shot video production, high-volume requests

A single infrastructure choice optimizes for one use case at the expense of the other.

## Decision

**Use a hybrid approach with two separate deployment models:**

### 1. On-Demand Pod (Development/Interactive)
**Primary infrastructure for initial setup and development work**

- **When to use:**
  - Real-time prompt iteration and testing
  - Interactive ComfyUI web UI (localhost:8188)
  - Quick personal renders and experiments
  - One-off requests during active development

- **Characteristics:**
  - Always running (during work hours)
  - Instant responsiveness (no cold start)
  - Direct web UI access
  - Predictable hourly costs (~$1-2/hr for RTX 4090)

- **Initial Setup:** TBD
  - Pod specification (GPU type, VRAM, storage)
  - Network exposure (SSH, web UI access)
  - Custom Docker image or pre-built ComfyUI template
  - Model/node pre-installation

### 2. Serverless Endpoint (Production/Batch)
**Scaled for high-volume and cost-optimized rendering**

- **When to use:**
  - Batch rendering (20+ images in sequence)
  - Multi-shot video production
  - API-based job submission
  - Sporadic/unpredictable workloads

- **Characteristics:**
  - Auto-scaling (0 to N workers)
  - Pay-per-execution (~$0.002-0.005/min)
  - 30-60s cold start acceptable
  - No interactive UI needed

- **Implementation:** TBD
  - Endpoint configuration
  - Workflow API format
  - Asset management and model caching
  - Job submission and monitoring

## Trade-offs

| Factor | On-Demand | Serverless |
|--------|-----------|-----------|
| Cost (dev, 8 hrs/day) | ~$8-16/day | ~$0-2/day |
| Cost (batch, 100 images) | ~$1-2 | ~$0.30-0.50 |
| Setup complexity | Low | Medium |
| Responsiveness | Instant | 30-60s |
| UI access | Yes (localhost) | No (API only) |

## Migration Path

**Phase 1 (Current):** On-demand pod only
- Establish development workflow
- Test ComfyUI on RunPod infrastructure
- Document workflows and models

**Phase 2 (Later):** Add serverless endpoint
- Create reusable batch workflows
- Set up job submission pipeline
- Cost optimization for production loads

**Phase 3 (Future):** Optimization
- Model caching strategies
- Custom Docker images
- CI/CD for workflow deployments

## Open Questions

- [ ] Which GPU type for on-demand? (RTX 4090, L40S, H100)
- [ ] Storage size for models and assets?
- [ ] Pre-built image or custom Docker setup?
- [ ] Network security and authentication?
- [ ] Monitoring and cost tracking?
- [ ] Model versioning and sharing between pods?

## Next Steps

1. Determine on-demand pod specifications
2. Create RunPod account and API key setup
3. Deploy initial on-demand pod
4. Document pod access and workflow submission
5. Test with sample ComfyUI workflows
6. Establish baseline costs and performance metrics
