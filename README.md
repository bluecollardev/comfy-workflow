# ComfyUI Workflow Monorepo

ComfyUI workflows and the infrastructure to run them: a local ComfyUI server
for the Mac, a Docker image for RunPod / Linux / Windows, a pod manager with
an MCP server and desktop dashboard, and the project trees the work is done
in. Owner: Lucas (Blue Collar Dev).

## Layout

```
├── apps/
│   ├── comfy-app/          # The ComfyUI server: setup/launch on the Mac, Dockerfile for CUDA, tracked node packs + workflows
│   └── runpod-dashboard/   # Vue + Electron dashboard for the pod manager
├── infra/                  # Pod manager API, pool manager, MCP server, pod lifecycle scripts (Python)
├── projects/               # Client/creative work; ignored by git except projects/README.md
├── docs/                   # Architecture decisions, setup, testing (index below)
├── comfy.yaml              # comfy CLI project config (empty so far)
├── assets/ fragments/ blueprints/ outputs/   # comfy CLI project convention (empty so far)
├── CLAUDE.md               # Collaboration guide: branches, commits, conventions
└── NEXT-STEPS.md           # The CANALV2 graph-import plan and open items
```

## Quick start

```bash
# ComfyUI on this Mac
cd apps/comfy-app && ./setup.sh && ./fetch-models.sh && ./launch.sh   # http://127.0.0.1:8188

# The same server as a CUDA image (RunPod, Linux, Windows via WSL2)
cd apps/comfy-app && ./build.sh                                       # comfy-app:v26

# RunPod pods, dashboard and MCP server
pip install -r infra/scripts/requirements.txt
export RUNPOD_API_KEY=...
python infra/scripts/create_pod.py create --name ComfyUI-Dev --gpu rtx4090
```

Branches: `develop` is the integration branch and GitHub's default; feature
branches come off it; `master` only moves on releases. Details in `CLAUDE.md`.

## Documentation

All of `docs/`: <https://github.com/bluecollardev/comfy-workflow/tree/develop/docs>

### Start here

| Doc | What it covers |
|---|---|
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | Three ways to see ComfyUI working in minutes: the RunPod dashboard, a local install, or a real RunPod pod. Comparison and recommended path. |
| [`docs/SETUP.md`](docs/SETUP.md) | Deploying an on-demand RunPod pod: prerequisites, GPU choice, deployment steps, wiring the `comfy` CLI to it, cost tracking, pod management. |
| [`docs/LOCAL-SETUP.md`](docs/LOCAL-SETUP.md) | Running ComfyUI on your own machine instead of RunPod: options, hardware, speed comparison, model handling, switching between local and cloud. The current local install is `apps/comfy-app`. |
| [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) | How workflows are organised in the `comfy` CLI project format: fragments, blueprints, composing, versioning, testing, best practices. |

### Architecture and decisions

| Doc | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full picture of the pod orchestration stack: the three-layer design (Claude Code → MCP server → pool manager → RunPod), components, data flows, auth, deployment scenarios, scaling. |
| [`docs/ADR-001-runpod-strategy.md`](docs/ADR-001-runpod-strategy.md) | Why a hybrid of on-demand pods (development now) and serverless endpoints (batch rendering later), with trade-offs and migration path. |
| [`docs/ADR-002-moe-agent-pool.md`](docs/ADR-002-moe-agent-pool.md) | The "mixture of experts" agent pool: a pool of RunPod pods shared by several users and agents, with implementation plan, costs, quotas, credentials and rollout. |
| [`docs/ADR-003-python-mcp-vs-terraform.md`](docs/ADR-003-python-mcp-vs-terraform.md) | Why pod orchestration is Python plus an MCP server rather than Terraform, alternatives considered, and when to revisit. |
| [`docs/DOCKERFILE-DEVIATIONS.md`](docs/DOCKERFILE-DEVIATIONS.md) | Review of the original placeholder image (community `ashleykza/comfyui` base) against RunPod's official one. That placeholder is retired; the current image is `apps/comfy-app/Dockerfile`, built on `pytorch/pytorch` with the same pins as the Mac. |

### Running and operating

| Doc | What it covers |
|---|---|
| [`infra/README.md`](infra/README.md) | The infrastructure folder: scripts, pod manager API, Docker image location, cost management, monitoring, troubleshooting. |
| [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) | The MCP server that exposes agent pool management to Claude Code: quick start, every tool, typical sessions, configuration, errors, budgeting. |
| [`apps/comfy-app/README.md`](apps/comfy-app/README.md) | The ComfyUI server project: what is upstream and what is ours (`check.sh`), running from a fresh clone, the Docker image, pointing the `comfy` CLI at it, targets and open approvals. |
| [`apps/runpod-dashboard/README.md`](apps/runpod-dashboard/README.md) | The Vue dashboard for the pod manager: features, architecture, API integration, dev and production builds, the Electron desktop app. |
| [`apps/runpod-dashboard/COMPONENTS.md`](apps/runpod-dashboard/COMPONENTS.md) | Component-by-component reference for the dashboard UI, styling conventions and the Electron packaging. |

### Testing

| Doc | What it covers |
|---|---|
| [`docs/TESTING.md`](docs/TESTING.md) | The Python test suite for the pod manager: structure, categories, mocking, coverage, async tests, fixtures, CI, debugging. Run `pytest infra/scripts/tests/ -m "not integration"` before any merge. |
| [`docs/TEST-RESULTS.md`](docs/TEST-RESULTS.md) | Record of the 2026-10-17 verification of the RunPod setup: what was tested, coverage, known limitations. |

### Projects and planning

| Doc | What it covers |
|---|---|
| [`projects/README.md`](projects/README.md) | Inventory of the ignored client trees under `projects/desktop/`: the CANALV2 VFX job (shots, scripts, node packs, tracker) and the ComfyUI-Shared input/output/models folders. |
| [`NEXT-STEPS.md`](NEXT-STEPS.md) | Plan for importing the CANALV2 shot graphs into this repo, plus open items including what still needs Binc's approval. |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repo: branch model, commit format, pod and asset conventions, gotchas. |
