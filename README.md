# ComfyUI Workflow Monorepo

ComfyUI workflows and the infrastructure to run them: a local ComfyUI server
for the Mac, a Docker image for RunPod / Linux / Windows, a pod manager with
an MCP server and desktop dashboard, and the project trees the work is done
in. Owner: Lucas (Blue Collar Dev).

## Goal

From Binc, 2026-10-19, the brief this repo serves:

The pipeline is restoration for IMAX: generative and post-VFX tools inside
ComfyUI graphs that are mostly custom nodes. It runs across a Linux PC, a Mac
Studio reached over SMB, a shared container on a NAS or in the cloud, and a
RunPod stack for GPUs. The hard part is not compute. It is an orchestration
layer of agents that handles the details of production: what has to be
tracked, what can be ignored, and what must be kept from the client. The goal
is a crew, a mixture of experts, each managing a specific skill, so that
Claude Code and Cowork can build the core framework and do production
directly with Binc.

> As written: "I might need a bit of help with some localized agentic workflows
> that live on a linux pc a direct smb to a mac studio and shared container on
> a nas or cloud that parks on a runpod for gpu stack, the challenge i have is
> getting my orchestration layer running agents to deal with all the details,
> that need to be tracked ignored or obfuscated from a clients. The pipeline is
> retoration for imax using gen and post vfx tools. In a comfui graph. Which is
> mostly custom nodes. so the main goal is to build an moe or Crew. To manage
> specific skills, so code and cowork can do the core framework and production
> directly with me."

What that means here: the skill crew does not exist yet and is the goal above
everything in this repo. The "agent pool" in `docs/ADR-002` is GPU pods, a
different thing. Where graphs run on which machine is `docs/ADR-004`; shared
storage across those machines is the first gap to close (`NEXT-STEPS.md`).

## Layout

```
├── apps/
│   ├── comfy-app/          # The ComfyUI server: setup/launch on the Mac, Dockerfile for CUDA, tracked node packs + workflows
│   ├── runpod-api/         # FastAPI pod manager API, pool manager, MCP server for Claude Code, tests (Python)
│   └── runpod-dashboard/   # Vue + Electron dashboard for the pod manager API
├── infra/                  # Pod lifecycle CLI (create_pod.py), pod-config.yaml, Terraform placeholder
├── projects/               # Client/creative work; ignored by git except projects/README.md
├── docs/                   # Architecture decisions, setup, testing (index below)
├── governance/             # Rules for agents: Binc's policies copied in (sync.sh), precedence, what Claude Code loads
├── AGENTS.md               # Cross-tool entry point for agents; CLAUDE.md imports it
├── comfy.yaml              # comfy CLI project config (empty so far)
├── assets/ fragments/ blueprints/ outputs/   # comfy CLI project convention (empty so far)
├── CLAUDE.md               # Collaboration guide: branches, commits, conventions
└── NEXT-STEPS.md           # The CANALV2 graph-import plan and open items
```

## Quick start

`./start.sh <target>` is the one-command way in; the manual steps under each
section are what it does. Targets install what they need on the first run
(`.venv/` for Python, `npm install` and a UI build for the dashboard) and
reuse it after. `RUNPOD_API_KEY` goes in `.env` at the repo root or in the
environment. `./start.sh` with no argument lists every target.

The same targets are run configurations for IntelliJ/PyCharm (`.run/`) and
VS Code (`.vscode/`: Terminal > Run Task, plus debug launchers for the API,
the MCP server, the tests and the Electron main process).

### ComfyUI

```bash
./start.sh comfy                    # ComfyUI on this Mac, http://127.0.0.1:8188
```

By hand, and the CUDA image for RunPod / Linux / Windows via WSL2:

```bash
cd apps/comfy-app
./setup.sh && ./fetch-models.sh && ./launch.sh   # first run; later just ./launch.sh
./build.sh                                       # comfy-app:v26 Docker image
```

Details: [`apps/comfy-app/README.md`](apps/comfy-app/README.md).

### RunPod pod manager API

```bash
./start.sh pods                     # FastAPI on http://localhost:8000, dashboard at /, docs at /docs
./start.sh pod list                 # pod lifecycle CLI: create, list, status, stop, resume, delete
./start.sh mcp                      # the MCP server for Claude Code, over stdio
./start.sh test                     # the merge gate: pytest without the integration tests
```

By hand:

```bash
export RUNPOD_API_KEY=...
pip install -r apps/runpod-api/requirements.txt
python apps/runpod-api/pod_manager_api.py

pip install -r infra/scripts/requirements.txt    # the CLI alone needs only these
python infra/scripts/create_pod.py create --name ComfyUI-Dev --gpu rtx4090

pytest apps/runpod-api/tests/ -m "not integration"
```

Details: [`apps/runpod-api/README.md`](apps/runpod-api/README.md),
[`docs/MCP-SERVER.md`](docs/MCP-SERVER.md).

### RunPod dashboard app

```bash
./start.sh desktop                  # the Electron app; starts the API itself
./start.sh dashboard                # Vite with hot reload on http://localhost:5173, needs `pods` running
```

By hand:

```bash
cd apps/runpod-dashboard
npm install
npm run build                       # dist/, which the API serves at /
npm run dev                         # hot reload against the API on :8000
npx electron .                      # desktop app against the built dist/
npm run electron:build              # installable .dmg / .exe / AppImage
```

Details: [`apps/runpod-dashboard/README.md`](apps/runpod-dashboard/README.md).

Branches: `develop` is the integration branch and GitHub's default; feature
branches come off it; `master` only moves on releases. Details in `CLAUDE.md`.

## External requirements

Everything the pipeline depends on that is not in this repo. Proprietary items
belong to BH / Binc and need a named yes before they go anywhere new.

| Requirement | Needed for | Where it comes from |
|---|---|---|
| ComfyUI at the pinned commit (0.39.2) | everything | `apps/comfy-app/setup.sh` clones it; the Dockerfile builds it in |
| ComfyUI-BH-ShotPipe packs v10–v26 (proprietary) | the corrosion shot graphs (`BH_*`, `BH26_*` nodes); each shot needs the version it was built with | Binc's tree, `projects/desktop/CANALV2/02_SCRIPTS/nodes/`; link with `COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh` |
| ComfyUI-BincStereo (proprietary) | the stereo workflows | tracked in `apps/comfy-app/custom_nodes/`, pending Binc's yes |
| Python: torch (MPS on the Mac, CUDA 12.6 on Linux), numpy, scipy, opencv-python-headless, av, Pillow, matplotlib; PyOpenColorIO for the v2/v3 ACEScg graphs only | the node packs | `apps/comfy-app/requirements-*.txt`; the project's `containers/runpod/requirements-bh.txt` |
| Depth Anything V2 Large weights | BincStereo depth | Hugging Face via `fetch-models.sh` (`HF_TOKEN` for gated repos) |
| Blender as `bpy` 5.0.1, COLMAP | camera track and solve, before a graph runs; CPU only | the project's `solve/`, `solve-blender/` scripts and `containers/runpod/solve/` image |
| ffmpeg, ffprobe | proxies, review movies, mp4 in and out | system package |
| Gemini 3 Pro Image ("Nano Banana") | generated paint patches in `10_CORROSION/Gen_Paint_assets`, composited by a Comfy fusion graph | Google API key; client frames go to a third party, so the project's named-yes rule applies |
| rclone + Google Drive | syncing `90_DELIVERIES/` | `02_SCRIPTS/drive-sync/` |
| Shared storage: the plates at `/home/binc/CANALV2_r3/CANALV2` and `/mnt/storage/…` | rendering anything | binc-PC's disks, over SMB or a NAS; not mounted on this Mac yet |
| NVIDIA driver, CUDA 12.6, nvidia-container-toolkit | GPU rendering on Linux, in or out of Docker | per machine; `apps/comfy-app/docker/swarm.sh init` says what Swarm needs on top |
| Docker, Docker Swarm | running the image on Linux boxes; no GPU under Docker on macOS | `apps/comfy-app/docker/` |
| uv, Python 3.13 (ComfyUI venv), Python 3.12 (API and CLI) | the Mac install, the pod manager | `brew install uv`; `start.sh` makes `.venv` |
| Node 22, npm | the dashboard and Electron app | nvm |
| RunPod account and API key | overflow GPUs, once approved | `.env`; nothing deployed yet |

## Documentation

All of `docs/`: <https://github.com/bluecollardev/comfy-workflow/tree/develop/docs>

### Start here

| Doc | What it covers |
|---|---|
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | Three ways to see ComfyUI working in minutes: the RunPod dashboard, a local install, or a real RunPod pod. Comparison and recommended path. |
| [`docs/SETUP.md`](docs/SETUP.md) | Deploying an on-demand RunPod pod: prerequisites, GPU choice, deployment steps, wiring the `comfy` CLI to it, cost tracking, pod management. Not done yet; status and the CANALV2 plan are in `NEXT-STEPS.md`. |
| [`docs/LOCAL-SETUP.md`](docs/LOCAL-SETUP.md) | Running ComfyUI on your own machine instead of RunPod: options, hardware, speed comparison, model handling, switching between local and cloud. The current local install is `apps/comfy-app`. |
| [`docs/WORKFLOWS.md`](docs/WORKFLOWS.md) | How workflows are organised in the `comfy` CLI project format: fragments, blueprints, composing, versioning, testing, best practices. |

### Architecture and decisions

| Doc | What it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The full picture of the pod orchestration stack: the three-layer design (Claude Code → MCP server → pool manager → RunPod), components, data flows, auth, deployment scenarios, scaling. |
| [`docs/ADR-001-runpod-strategy.md`](docs/ADR-001-runpod-strategy.md) | Why a hybrid of on-demand pods (development now) and serverless endpoints (batch rendering later), with trade-offs and migration path. |
| [`docs/ADR-002-moe-agent-pool.md`](docs/ADR-002-moe-agent-pool.md) | The "mixture of experts" agent pool: a pool of RunPod pods shared by several users and agents, with implementation plan, costs, quotas, credentials and rollout. |
| [`docs/ADR-004-where-the-workflows-run.md`](docs/ADR-004-where-the-workflows-run.md) | Which machine runs which graphs: plates and one path first, containers on Linux under Compose or Swarm, RunPod as overflow on its own tools, the Mac as client and MPS worker. What was measured on 2026-10-19 and the gaps. |
| [`docs/ADR-003-python-mcp-vs-terraform.md`](docs/ADR-003-python-mcp-vs-terraform.md) | Why pod orchestration is Python plus an MCP server rather than Terraform, alternatives considered, and when to revisit. |
| [`docs/DOCKERFILE-DEVIATIONS.md`](docs/DOCKERFILE-DEVIATIONS.md) | Review of the original placeholder image (community `ashleykza/comfyui` base) against RunPod's official one. That placeholder is retired; the current image is `apps/comfy-app/Dockerfile`, built on `pytorch/pytorch` with the same pins as the Mac. |

### Running and operating

| Doc | What it covers |
|---|---|
| [`infra/README.md`](infra/README.md) | The infrastructure folder: the pod lifecycle CLI, pod config, where the Docker image and the API live, cost management, monitoring, troubleshooting. |
| [`apps/runpod-api/README.md`](apps/runpod-api/README.md) | The pod manager service: the FastAPI API and its routers, the pool manager, the MCP server, environment variables, running it, tests, and what the Electron app packages from it. |
| [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) | The MCP server that exposes agent pool management to Claude Code: quick start, every tool, typical sessions, configuration, errors, budgeting. |
| [`apps/comfy-app/README.md`](apps/comfy-app/README.md) | The ComfyUI server project: what is upstream and what is ours (`check.sh`), running from a fresh clone, the Docker image, pointing the `comfy` CLI at it, targets and open approvals. |
| [`apps/runpod-dashboard/README.md`](apps/runpod-dashboard/README.md) | The Vue dashboard for the pod manager: features, architecture, API integration, dev and production builds, the Electron desktop app. |
| [`apps/runpod-dashboard/COMPONENTS.md`](apps/runpod-dashboard/COMPONENTS.md) | Component-by-component reference for the dashboard UI, styling conventions and the Electron packaging. |

### Testing

| Doc | What it covers |
|---|---|
| [`docs/TESTING.md`](docs/TESTING.md) | The Python test suite for the pod manager: structure, categories, mocking, coverage, async tests, fixtures, CI, debugging. Run `pytest apps/runpod-api/tests/ -m "not integration"` before any merge. |
| [`docs/TEST-RESULTS.md`](docs/TEST-RESULTS.md) | Record of the 2026-10-17 verification of the RunPod setup: what was tested, coverage, known limitations. |

### Projects and planning

| Doc | What it covers |
|---|---|
| [`governance/README.md`](governance/README.md) | Governance for agents: Binc's 33 policy pages, workflow rules and operator brief copied in by `sync.sh` with a manifest, precedence between their rules and ours, what Claude Code loads automatically, and the hook that blocks writes into the mirror. |
| [`docs/CANALV2-STRUCTURE.md`](docs/CANALV2-STRUCTURE.md) | Binc's CANALV2 tree explained: the numbered top level, the fixed shot-folder shape, how a shot moves from inbox to delivery, naming and versioning in short, what lives outside the root on binc-PC, and why the tree is read-only for us. |
| [`docs/PROMPTS.md`](docs/PROMPTS.md) | Where every kind of prompt is: the ComfyUI graphs (what ComfyUI calls a prompt) by location, count and format; the Gemini 3 Pro Image text prompts beside each generated paint patch; and the agent briefs, policies and job queue in Binc's tree. |
| [`projects/README.md`](projects/README.md) | Inventory of the ignored client trees under `projects/desktop/`: the CANALV2 VFX job (shots, scripts, node packs, tracker) and the ComfyUI-Shared input/output/models folders. |
| [`NEXT-STEPS.md`](NEXT-STEPS.md) | Plan for importing the CANALV2 shot graphs into this repo, plus open items including what still needs Binc's approval. |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repo: branch model, commit format, pod and asset conventions, gotchas. |
