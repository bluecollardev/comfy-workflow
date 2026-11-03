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

## What this repo is for, and what RunPod is

Binc's job is the point: ComfyUI graphs that restore film, corrosion clean-up
and stereo conversion, over client plates, run the same way on whatever machine
has the compute. The order is set in
[`docs/ADR-004-where-the-workflows-run.md`](docs/ADR-004-where-the-workflows-run.md)
and in Binc's own systems page: binc-PC first, because the tree and the plates
live there; the Mac for the stereo work on its own GPU; a Linux box under
Docker when there is one; RunPod only when a batch outgrows binc-PC. Binc's
words: two machines, a NAS, and RunPod containers "when we need the compute".

RunPod is therefore the overflow, not the destination. It is the one place
that needed tooling, because it is rented by the hour and holds nothing of
ours by default. That tooling is the desktop app in `apps/runpod-dashboard`
(`docs/ADR-005-typescript-core-no-server.md`): on each PC it maps the three
folders every run needs, carries our image with Binc's packs, creates a pod on
the cheapest card in stock, mounts the data from a network volume, shows
RunPod's status and logs, stops anything idle, and leaves nothing billing. On
2026-10-19 that chain ran end to end for the first time: a pod created from
the app, watched through its pull, recreated when its host filled up, reached
at its ComfyUI URL, then stopped and deleted.

What this is not: a plan to move ComfyUI to RunPod and work there. The plates
are client material and leave binc-PC only with Binc's named yes
(`shared/governance/policy/agent-permissions.md`), every render hour there
costs money, and the tree on binc-PC is the record. The Mac launcher, the
Compose file and the folder mapping exist so the same graphs run at home for
free. The first real batch is still more likely to run on binc-PC than in the
cloud.

Beyond that sits Binc's larger goal above, the crew of skills: a dispatcher
over `queue/<project>/` that runs one job per session the way the operator
brief says. Not started; the next steps page says where it begins.

## Layout

```
├── apps/
│   ├── comfy-app/          # The ComfyUI server: setup/launch on the Mac, Dockerfile for CUDA, tracked workflows; packs come from shared/nodes
│   └── runpod-dashboard/   # Vue + Electron dashboard for the pod manager API
├── infra/                  # pod-config.yaml (read by ./start.sh pod), Terraform placeholder
├── projects/               # Client/creative work; ignored by git except projects/README.md
├── docs/                   # Architecture decisions, setup, testing (index below)
├── shared/                 # Material shared by every app and agent here
│   ├── governance/         #   rules for agents: Binc's policies copied in (sync.sh), precedence, what Claude Code loads
│   ├── shapes/             #   the project's fixed shapes as JSON (shot folder, graph, job, report, names) + check.py
│   └── nodes/              #   git submodule bluecollardev/comfy-node-packs: portable/ and bound/ packs (ShotPipe v6–v26, BincStereo); sync-nodes.sh refreshes it
├── queue/                  # Job files for agents, one folder per project (queue/canalv2/{in,running,done}), seeded by sync.sh
├── AGENTS.md               # Cross-tool entry point for agents; CLAUDE.md imports it
├── comfy.yaml              # comfy CLI project config (empty so far)
├── assets/ fragments/ blueprints/ outputs/   # comfy CLI project convention (empty so far)
├── CLAUDE.md               # Collaboration guide: branches, commits, conventions
└── NEXT-STEPS.md           # The CANALV2 graph-import plan and open items
```

## Download the app

Installers for the pod manager, built from this repo and published by version:

- **Download page:** https://bluecollardev.github.io/downloads/ (macOS, Windows, Linux; a platform with no build yet is greyed out)
- **Downloads repo and all versions:** https://github.com/bluecollardev/downloads · [releases](https://github.com/bluecollardev/downloads/releases) · latest Mac build: [`RunPod-Manager-mac-arm64.dmg`](https://github.com/bluecollardev/downloads/releases/latest/download/RunPod-Manager-mac-arm64.dmg)
- **The pod image** (private, ComfyUI with Binc's node packs): [`ghcr.io/bluecollardev/comfy-app`](https://github.com/orgs/bluecollardev/packages/container/package/comfy-app). Pulling it needs a `ghcr.io` login saved in the RunPod account and its registry-auth ID in Default Configuration (`docs/ADR-012`, `docs/RELEASING.md`).

### First time on a RunPod account (every new user does this once)

A new RunPod account has three things the app cannot create for itself. Without them a pod starts but
cannot pull the image, cannot be reached by Sync, or has nowhere to keep its files.

1. **Your API key.** RunPod → Settings → API Keys → create one (read/write). Enter it in the app's
   Default Configuration.
2. **An SSH public key** (Sync needs it). RunPod → Settings → SSH Public Keys → paste the contents of
   your public key, for example `cat ~/.ssh/id_ed25519.pub` (make one with `ssh-keygen -t ed25519` if you
   have none). RunPod passes it to every pod as `PUBLIC_KEY` and the image starts sshd from it. With no key
   on the account the pod boots and ComfyUI works, but Sync fails with `ssh: connect ... Connection refused`.
   The key is read when the container starts: add it first, then create the pod (or Stop and Start an
   existing one). The Sync uses the key your `ssh` picks by default (`~/.ssh/config`).
3. **A login for the private image** (`ghcr.io/bluecollardev/comfy-app`). Ask Lucas for access to the
   package, make a GitHub token with `read:packages`, then RunPod → Settings → Container Registry Auth →
   add `ghcr.io` with your GitHub username and that token. Copy the ID it gives you into Default
   Configuration → registry auth. Without it a pod exits within seconds with `denied: access forbidden`
   (the pod's Logs show it).
4. **A network volume** (optional but recommended) in the datacenter you want, then pick it in Default
   Configuration. A volume id from another account gives `Network volume "..." not found`.

Details: [`docs/RELEASING.md`](docs/RELEASING.md), [`ADR-006`](docs/ADR-006-image-registry-and-ci-build.md), [`ADR-012`](docs/ADR-012-versioned-releases.md).

Documentation site: https://bluecollardev.github.io/downloads/docs/ (`./start.sh release docs`, [`ADR-014`](docs/ADR-014-documentation-site.md)); start with [`docs/SETUP-WALKTHROUGH.md`](docs/SETUP-WALKTHROUGH.md).

Cutting a release: `./start.sh release patch` ([`docs/RELEASING.md`](docs/RELEASING.md), [`ADR-012`](docs/ADR-012-versioned-releases.md), [`ADR-013`](docs/ADR-013-delivery.md)).

## Quick start

`./start.sh <target>` is the one-command way in; the manual steps under each
section are what it does. Targets install what they need on the first run
(`npm install`, the core build and a UI build for the app) and
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

### The pod manager: one app

Electron with a TypeScript core (`apps/runpod-dashboard/libs/core`): mounts,
pods, GPUs and datacenters with prices, the network volume, governance, the
idle watch, git accounts, repositories, image env, the sync. The page talks to
the core over IPC; there is no server and no Python (`docs/ADR-005`). The MCP
server for Claude Code and the CLI are Node programs over the same core.

```bash
./start.sh desktop                  # the app (built page)
./start.sh dashboard                # the app with hot reload (Vite inside the window)
./start.sh pod list                 # the CLI: pod create|list|status|stop|resume|delete
./start.sh sync --pod <id>          # the mapped folders onto the volume; --s3 needs no pod (ADR-007)
./start.sh pull --pod <id>          # renders back down
./start.sh mcp                      # the MCP server over stdio
./start.sh test                     # the merge gate: core suite + browser suite
```

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
./start.sh dashboard                # hot reload inside the app, the core over IPC
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
| ComfyUI-BH-ShotPipe packs v6–v26 (proprietary) | the corrosion shot graphs (`BH_*`, `BH26_*` nodes); each shot needs the version it was built with | the `shared/nodes` submodule (`bluecollardev/comfy-node-packs`), imported from Binc's tree and all under `portable/` since every pack reads its machine paths from a `bh_paths.py` (`PROJECT_ROOT`, `PLATES_ROOT`, `COMFY_SHARED` from the environment, binc-PC's values as fallback); `bound/` is empty. Versions stack: the current graphs need the `contract-v26` set (v7, v10–v14, v26), `COMFY_SHOTPIPE=contract-v26 apps/comfy-app/setup.sh`. What a ShotPipe pack is: `shared/nodes/docs/SHOTPIPE.md`; versioning: `docs/NODE-PACKS.md` |
| ComfyUI-BincStereo (proprietary) | the stereo workflows | `shared/nodes/portable/`; always linked by `setup.sh` |
| Python: torch (MPS on the Mac, CUDA 12.6 on Linux), numpy, scipy, opencv-python-headless, av, Pillow, matplotlib; PyOpenColorIO for the v2/v3 ACEScg graphs only | the node packs | `apps/comfy-app/requirements-*.txt`; the project's `containers/runpod/requirements-bh.txt` |
| Depth Anything V2 Large weights | BincStereo depth | Hugging Face via `fetch-models.sh` (`HF_TOKEN` for gated repos) |
| Blender as `bpy` 5.0.1, COLMAP | camera track and solve, before a graph runs; CPU only | the project's `solve/`, `solve-blender/` scripts and `containers/runpod/solve/` image |
| ffmpeg, ffprobe | proxies, review movies, mp4 in and out | system package |
| Gemini 3 Pro Image ("Nano Banana") | generated paint patches in `10_CORROSION/Gen_Paint_assets`, composited by a Comfy fusion graph | Google API key; client frames go to a third party, so the project's named-yes rule applies |
| rclone + Google Drive | syncing `90_DELIVERIES/` | `02_SCRIPTS/drive-sync/` |
| Shared storage: the project tree at `/home/binc/CANALV2_r3/CANALV2`, the plates under `/mnt/storage/Panama_Redux/…`, `~/ComfyUI-Shared` | rendering anything | binc-PC's disks, over SMB, a NAS or a pod volume; not mounted on this Mac yet. Every path: `docs/MOUNT-POINTS.md` |
| NVIDIA driver, CUDA 12.6, nvidia-container-toolkit | GPU rendering on Linux, in or out of Docker | per machine; `apps/comfy-app/docker/swarm.sh init` says what Swarm needs on top |
| Docker, Docker Swarm | running the image on Linux boxes; no GPU under Docker on macOS | `apps/comfy-app/docker/` |
| uv, Python 3.13 (ComfyUI venv) | the Mac install only; the pod manager needs Node 22, no Python | `brew install uv`; `start.sh` makes `.venv` |
| Node 22, npm | the dashboard and Electron app | nvm |
| RunPod account and API key | overflow GPUs, once approved | `.env`; nothing deployed yet |

## Mount points

Everything names binc-PC's filesystem, so every other runtime mounts data
under `/workspace` and links binc-PC's paths onto it. Three mounts are real;
the rest is legacy or not a mount. Full list, per runtime:
[`docs/MOUNT-POINTS.md`](docs/MOUNT-POINTS.md); as data:
[`shared/shapes/mount-points.json`](shared/shapes/mount-points.json).

| What | binc-PC | Container / pod |
|---|---|---|
| Project tree | `/home/binc/CANALV2_r3/CANALV2` (also `~/CANALV2_r3/CANALV2`) | `/workspace/project`, linked from the path the tree's job files declare |
| Served plates, read-only | `/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/` | `/workspace/plates`, linked from the path the shots' `SOURCES.csv` declare |
| ComfyUI-Shared | `/home/binc/ComfyUI-Shared` (also `~/ComfyUI-Shared`) | `/workspace/comfy-shared`, `COMFY_SHARED` |

### How the data reaches a pod: the network volume

A RunPod network volume is a disk in RunPod's datacenter, not a mount of this
Mac. The Mac's folders never reach a pod live; the volume holds a copy, and the
pod reads that copy. Three places, one direction:

| Place | What is there | How it gets there |
|---|---|---|
| This Mac | the three folders mapped in the Configuration panel, wherever they live on disk | you |
| The volume (`comfy-workspace`, 120 GB, `CA-MTL-1`) | a copy at `/workspace/project`, `/workspace/plates`, `/workspace/comfy-shared` | `./start.sh sync --pod <id>`: rsync over SSH into a pod with the volume attached. Additive, never deletes. The first run sends everything (the tree is 81 GB, ComfyUI-Shared 17 GB); later runs send changes |
| A pod | the volume mounted at `/workspace`; ComfyUI's input, output, models and workflows under `comfy-shared/` | attached at creation from the volume id and datacenter in the Configuration panel |

What follows from that:

- **The Volumes button in the navbar** lists the account's volumes with their cost, datacenter, S3 support and the pods on each; create, grow, delete (refused while a pod is attached) and "use as default" live there.
- **Every pod uses the same volume.** The volume id and datacenter are set once in
  the panel and applied to each new pod, so there is one copy of the data and any
  number of pods over time. Deleting a pod loses nothing; outputs are on the
  volume in `comfy-shared/output` and come back to the Mac by rsync.
- **Pods live in one datacenter.** A volume belongs to its datacenter, so every pod
  is created there, and the automatic card choice picks the cheapest card in stock
  there, not across RunPod. A pod in another region needs a second volume with its
  own copy; the app handles one volume today.
- **Several pods at once are possible.** RunPod allows more than one running pod on a
  volume, so two ComfyUI instances can read the same plates and models. They share
  the output folder too: fine for different shots, a collision for the same file name.
- **Workflows are on the volume, not in the image.** The image links ComfyUI's
  Workflows panel to `comfy-shared/workflows` and seeds it from
  `apps/comfy-app/workflows/` only while it is empty. A workflow saved in one pod's
  UI shows in the next pod; changing them needs no rebuild.
- **The image is the only thing pulled, not copied.** Pods pull
  `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`, a private
  registry, with the credential saved on RunPod whose id is in the panel. Models
  and plates are never in the image.
- **Cost.** The volume bills about USD 0.07 per GB a month whether or not a pod
  runs (120 GB is about USD 8.40). A stopped pod on a network volume bills nothing.
- **Sync, from a pod's card.** A confirmation names what will be copied, then the copy runs
  in the app with a progress bar on the card and a live list of files and errors behind it.
  Push sends the folders mapped on this PC to the volume; Pull brings renders back. The
  transport is chosen for you: **over SSH into the pod while it runs; over RunPod's S3 API
  straight onto the volume when the pod is off**, if the volume's datacenter serves S3 and the
  S3 keys from the RunPod console are entered in Default Configuration; otherwise the
  confirmation says why neither works. Additive, never deletes, the idle stop held meanwhile.
- **Keeping the Mac and the volume in line is an open decision.** Today the copy
  goes one way, Mac to volume, by `./start.sh sync`, pressed by a person; nothing
  pulls a pod's renders back down yet. RunPod's S3 API can fill a volume with no
  pod running, but only in fifteen datacenters and Montreal is not one, so the
  likely move is a volume in Romania pushed over S3 (ADR-007, option G). The per-folder contract, the options and a
  recommendation are in [`docs/ADR-007`](docs/ADR-007-volume-as-hub-and-sync.md).
  The image side, registry and CI build, is decided in
  [`docs/ADR-006`](docs/ADR-006-image-registry-and-ci-build.md).

## Documentation

All of `docs/`: <https://github.com/bluecollardev/comfy-workflow/tree/develop/docs>

### Start here

| Doc | What it covers |
|---|---|
| [`docs/SETUP-WALKTHROUGH.md`](docs/SETUP-WALKTHROUGH.md) | Setting up from scratch with screenshots from the app's own test: the RunPod keys (API, SSH, registry login, S3), Default Configuration, a network volume, a pod, and what each failure means. |
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
| [`docs/ADR-006-image-registry-and-ci-build.md`](docs/ADR-006-image-registry-and-ci-build.md) | The ComfyUI image lives in a private GitLab registry and is built and pushed on GitLab CI next to it (the 3 GB torch layer never leaves the Mac); pods pull with a saved credential; workflows ride on the volume, seeded from the image only while empty; sshd in the image for the sync. Accepted 2026-10-20. |
| [`docs/ADR-007-volume-as-hub-and-sync.md`](docs/ADR-007-volume-as-hub-and-sync.md) | How local state and the pod's volume stay in line: the per-folder contract (who writes where), the options from "add Pull to the script" through "Push and Pull in the app" to "a bucket as the hub", a recommendation, and the decision left open. Proposed 2026-10-20, no decision yet. |
| [`docs/ADR-008-import-adapters.md`](docs/ADR-008-import-adapters.md) | Packages come in through adapters: a module per source format maps it onto the ComfyUI-Shared structure; the app applies the plan; user and AI-written adapters hot-load from a folder. Built on `feature/import-adapters` 2026-10-24. Spec: [`docs/IMPORT-ADAPTERS.md`](docs/IMPORT-ADAPTERS.md). |
| [`docs/ADR-009-adapter-studio.md`](docs/ADR-009-adapter-studio.md) | The Adapter Studio: one IDE-style modal for Edit, New adapter and Write an adapter with Claude: code and prompt tabs, Code / Preview / Split icon buttons, the package as a tree with a file viewer, Claude's chat that builds an editable prompt which builds the adapter, built-ins editable by override, naming, documentation as a rule on generation, agentic validation on save, no autosave. Built 2026-10-24. |
| [`docs/ADR-010-the-app-is-always-named.md`](docs/ADR-010-the-app-is-always-named.md) | A full-screen screen always carries the app's mark and name (and the no-spend badge) in its header. Accepted 2026-10-24. |
| [`docs/ADR-011-what-a-sync-carries.md`](docs/ADR-011-what-a-sync-carries.md) | What a sync carries: which ComfyUI-Shared folders go and come back, skipping renders and the test bucket, what to do with files already on the pod, the skipped counter. |
| [`docs/ADR-012-versioned-releases.md`](docs/ADR-012-versioned-releases.md) | The app is released by semantic version (patch unless Lucas names one), tagged `vX.Y.Z`, installers on the public downloads repo's Releases. Accepted 2026-10-27. |
| [`docs/ADR-014-documentation-site.md`](docs/ADR-014-documentation-site.md) | The documentation is a public Pages site built from this section: the README is the navigation, client-job docs are left out by a list, the setup walkthrough's screenshots come from a test. Accepted 2026-10-27. |
| [`docs/ADR-013-delivery.md`](docs/ADR-013-delivery.md) | How the app is delivered: one Pages site, a button per platform (dmg, exe, Linux), versioned files with stable aliases, unsigned for now. Accepted 2026-10-27. |
| [`docs/ADR-015-cloud-to-cloud-pull.md`](docs/ADR-015-cloud-to-cloud-pull.md) | A pod pulls from an S3 bucket straight onto the volume (rclone, `S3_PULL` in the image), cloud to cloud, instead of the Mac's uplink; the decisions taken while building it. Guide: [`docs/POD-PULLS-FROM-S3.md`](docs/POD-PULLS-FROM-S3.md). |
| [`docs/ADR-016-bh-library-in-import-shot-pack.md`](docs/ADR-016-bh-library-in-import-shot-pack.md) | How BH's export works (builder, round, S3, manifests) and the BH library in Import Shot Pack: a source picker, rounds and shot packs, manifest-verified before import. |
| [`docs/ADR-017-library-source-adapters.md`](docs/ADR-017-library-source-adapters.md) | The adapter pattern for the library: a source adapter fetches, a round adapter reads and verifies, the package adapter plans the import. |
| [`docs/ADR-018-bh-export-api.md`](docs/ADR-018-bh-export-api.md) | An API option on BH's export: read rounds through the console's MCP endpoint (list, manifest, short-lived URLs) instead of downloading. Proposed; needs BH. |
| [`docs/ADR-019-remote-mcp-connector.md`](docs/ADR-019-remote-mcp-connector.md) | The app as an MCP client: Remote servers in Connect > MCP, starting with BH's Panama console and a console key. |
| [`docs/ADR-020-image-registry-is-github.md`](docs/ADR-020-image-registry-is-github.md) | The pod image lives on `ghcr.io`, built by GitHub Actions with a read-only deploy key for the private node packs; GitLab retired as the registry. |
| [`docs/ADR-021-bh-library-staging-keys-and-mapping.md`](docs/ADR-021-bh-library-staging-keys-and-mapping.md) | Rounds stage in ComfyUI-Shared `temp/rounds`; Sync never carries `temp/`; ComfyUI-Shared mapped off the mirror; resumable download with Cancel; the app holds the bucket keys. |
| [`docs/ADR-022-rounds-stage-on-the-volume.md`](docs/ADR-022-rounds-stage-on-the-volume.md) | Proposed: a Pod / Local switch on the Panama source, so a round can stage on the network volume (pulled by a short-lived pod, verified there) as it does in `ComfyUI-Shared/temp/rounds` locally. |
| [`docs/IMPORT-SHOT-PACKS.md`](docs/IMPORT-SHOT-PACKS.md) | Importing a shot pack: setup once (ComfyUI-Shared, merged Drive parts, volume, the optional Anthropic key), use in the app, the terminal and by an agent, managing adapters, where things are, known limits. Spec: [`docs/IMPORT-ADAPTERS.md`](docs/IMPORT-ADAPTERS.md); plan and results: [`docs/PLAN-IMPORT-ADAPTERS.md`](docs/PLAN-IMPORT-ADAPTERS.md). |
| [`docs/DOCKERFILE-DEVIATIONS.md`](docs/DOCKERFILE-DEVIATIONS.md) | Review of the original placeholder image (community `ashleykza/comfyui` base) against RunPod's official one. That placeholder is retired; the current image is `apps/comfy-app/Dockerfile`, built on `pytorch/pytorch` with the same pins as the Mac. |

### Running and operating

| Doc | What it covers |
|---|---|
| [`docs/MCP-ENDPOINTS.md`](docs/MCP-ENDPOINTS.md) | The two MCP endpoints tool by tool: the pod manager (pool, pods, volumes, configuration, sync, cost; named yes where it spends) and the ComfyUI bridge (a local agent inside the ComfyUI of a pod: workflows, nodes, queue, history, outputs; refuses locked shots), the client connectors (Claude Code, Claude Desktop, Codex CLI, ChatGPT over HTTP) and the Connect › MCP tab. |
| [`docs/DELIVERY-PACKAGES.md`](docs/DELIVERY-PACKAGES.md) | The Brynley delivery packages (Panama Canal v2, built 2026-10-20): what they are for, the layout and what `final/`, `approved/`, `provenance/` and `comfy/` hold, how a graph finds its files, what they need that our image lacks, and the open design for importing them onto a pod. |
| [`docs/COMFY-API.md`](docs/COMFY-API.md) | The ComfyUI HTTP API as this repo uses it: health and readiness, the Workflows panel's userdata calls, queueing a graph, queue and history, the two graph formats, and which of our files call what. |
| [`docs/SCRIPTS.md`](docs/SCRIPTS.md) | Every script and command the repo runs or ships: `start.sh` targets, ComfyUI on the Mac, the image and its entrypoint, the pod-side pull and check, the app's CLI and MCP servers, release and docs builds, the sync scripts for Binc's material; where each runs and whether it spends. |
| [`infra/README.md`](infra/README.md) | The infrastructure folder: the pod lifecycle CLI, pod config, where the Docker image and the API live, cost management, monitoring, troubleshooting. |
| [`docs/MCP-SERVER.md`](docs/MCP-SERVER.md) | The MCP server that exposes agent pool management to Claude Code: quick start, every tool, typical sessions, configuration, errors, budgeting. |
| [`shared/nodes/docs/DEPENDENCIES.md`](shared/nodes/docs/DEPENDENCIES.md) | One row per ShotPipe version: what it needs beside it, what it supersedes, bundled modules, Python imports, node and baked-path counts, and which named set it belongs to. Generated in the packs submodule. |
| [`shared/nodes/docs/SHOTPIPE.md`](shared/nodes/docs/SHOTPIPE.md) | What a ShotPipe pack is: one layered family with v7 as the base, what each generation adds, why a graph needs a set and how the packs find each other. In the packs submodule. |
| [`shared/nodes/docs/BINCSTEREO.md`](shared/nodes/docs/BINCSTEREO.md) | What BincStereo is: a self-contained stereo-conversion pack by Cinematic Immunity / Bincos, its six nodes in pipeline order, requirements, where the stereo workflows use it, and how it differs from ShotPipe. In the packs submodule. |
| [`docs/NODE-PACKS.md`](docs/NODE-PACKS.md) | The node packs as a submodule at `shared/nodes`: the three layers of version (pack folder, packs-repo tag, submodule pin plus image label), the rules from Binc's versioning policy, the release steps, and how installs and images consume them. |
| [`apps/comfy-app/README.md`](apps/comfy-app/README.md) | The ComfyUI server project: what is upstream and what is ours (`check.sh`), running from a fresh clone, the Docker image, pointing the `comfy` CLI at it, targets and open approvals. |
| [`apps/runpod-dashboard/README.md`](apps/runpod-dashboard/README.md) | The Vue dashboard for the pod manager: features, architecture, API integration, dev and production builds, the Electron desktop app. |
| [`apps/runpod-dashboard/COMPONENTS.md`](apps/runpod-dashboard/COMPONENTS.md) | Component-by-component reference for the dashboard UI, styling conventions and the Electron packaging. |

### Testing

| Doc | What it covers |
|---|---|
| [`docs/TESTING.md`](docs/TESTING.md) | The app's tests: the core suite (Vitest), the browser suite against a fake API (Playwright), the Electron suite in no-spend mode, the live RunPod proof, the MCP and CLI tests; what each covers and how to run them. |
| [`docs/TEST-RESULTS.md`](docs/TEST-RESULTS.md) | Record of the 2026-10-17 verification of the RunPod setup: what was tested, coverage, known limitations. |

### Projects and planning

| Doc | What it covers |
|---|---|
| [`queue/README.md`](queue/README.md) | The agent job queue: one folder per project in Binc's in/running/done shape, how a job file reads, how `queue/canalv2/` is seeded from Binc's queue without ever writing back, and what moving a file here means. |
| [`shared/shapes/README.md`](shared/shapes/README.md) | The project's fixed shapes as JSON for software to read: project tree, shot folder, graph boxes, inbox entry, tracker columns, job file, report, sidecar, naming regexes. `check.py` validates real folders, jobs and names against them. |
| [`shared/governance/README.md`](shared/governance/README.md) | Governance for agents: Binc's 33 policy pages, workflow rules and operator brief copied in by `sync.sh` with a manifest, precedence between their rules and ours, what Claude Code loads automatically, and the hook that blocks writes into the mirror. |
| [`docs/MOUNT-POINTS.md`](docs/MOUNT-POINTS.md) | Every path the project assumes, from a scan of the whole tree: the three real mounts and how each runtime (binc-PC, Mac, Compose/Swarm, RunPod) makes them resolve; what is legacy, what is not a mount; the data version in `shared/shapes/mount-points.json`. |
| [`docs/CANALV2-STRUCTURE.md`](docs/CANALV2-STRUCTURE.md) | Binc's CANALV2 tree explained: the numbered top level, the fixed shot-folder shape, how a shot moves from inbox to delivery, naming and versioning in short, what lives outside the root on binc-PC, and why the tree is read-only for us. |
| [`docs/PROMPTS.md`](docs/PROMPTS.md) | Where every kind of prompt is: the ComfyUI graphs (what ComfyUI calls a prompt) by location, count and format; the Gemini 3 Pro Image text prompts beside each generated paint patch; and the agent briefs, policies and job queue in Binc's tree. |
| [`projects/README.md`](projects/README.md) | Inventory of the ignored client trees under `projects/desktop/`: the CANALV2 VFX job (shots, scripts, node packs, tracker) and the ComfyUI-Shared input/output/models folders. |
| [`NEXT-STEPS.md`](NEXT-STEPS.md) | Plan for importing the CANALV2 shot graphs into this repo, plus open items including what still needs Binc's approval. |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repo: branch model, commit format, pod and asset conventions, gotchas. |
