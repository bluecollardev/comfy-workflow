# apps/comfy-app

The ComfyUI server. Everything that runs the AI lives here; the `comfy` CLI,
the blueprints in the repo root and the project trees under `projects/` are
clients of it. It runs on this Mac (`setup.sh` + `launch.sh`) and as a Docker
image for RunPod, Linux and Windows (`build.sh`).

## What is ours and what is upstream

`check.sh` answers this from the clone itself. Run on 2026-10-19 against the
install copied from Brynley's Mac, it found the ComfyUI core **byte-identical
to upstream v0.39.2** (every file showed as modified only because the copy
changed file modes) with exactly five things layered on top:

| Layer | What | Now |
|---|---|---|
| `ComfyUI-BincStereo` | The stereo / depth node pack (pure torch, proprietary to Cinematic Immunity / Bincos) | In the `shared/nodes` submodule (`comfy-node-packs`), symlinked into the clone by `setup.sh` |
| `user/default/workflows/*.json` | Nine saved workflows (stereo QC, cgi-042) | **Tracked** in `workflows/`, symlinked, so saving in the UI writes to the repo. In the image the same link points at the mount, `/workspace/comfy-shared/workflows`, seeded from `workflows/` only while empty, so a pod's workflows change without a rebuild |
| `models/depth_anything/Depth-Anything-V2-Large-hf` | 1.2 GB of weights | Not in git; `models.txt` + `fetch-models.sh` |
| `input/binc-stereo-test`, `input/cgi-042-render-mono` | 129 MB of local test frames | Not in git; left on disk |
| `.venv`, `user/` settings and db | Machine-specific | Rebuilt by `setup.sh`; settings ignored |

Nothing else differs from upstream. That is why the core is a plain clone at a
pinned commit and not a vendored copy.

```
apps/comfy-app/
├── README.md
├── pins.env                 # COMFYUI_REPO, COMFYUI_REF (v0.39.2), PYTHON_VERSION; read by every script
├── setup.sh                 # clone core at the pin, build the venv, link packs + workflows (idempotent)
├── launch.sh / stop.sh      # run the server on http://127.0.0.1:8188
├── check.sh                 # how ComfyUI/ differs from upstream, and what we layer on top
├── fetch-models.sh          # download the weights in models.txt
├── models.txt               # <models subfolder>  <Hugging Face repo id>
│   └── ComfyUI-BincStereo/
├── workflows/               # saved workflows (tracked; the UI saves here through the symlink)
├── mounts-env.sh            # the three folders: env, else the dashboard's mapping, else defaults
├── requirements-mac.txt     # torch pins, MPS build (Apple Silicon)
├── requirements-cuda.txt    # torch pins, CUDA 12.6 build (Linux / Windows NVIDIA)
├── requirements-packs.txt   # Python deps of the node packs
├── manifest.json            # the desktop standalone bundle this came from (reference)
├── Dockerfile, build.sh, .dockerignore, docker/   # the image (see below)
│
├── ComfyUI/                 # ignored: upstream clone at the pin, unmodified
│   ├── .venv/               #   built by setup.sh
│   ├── custom_nodes/<pack>  #   -> shared/nodes/<pack> (the comfy-node-packs submodule)
│   ├── user/default/workflows  # -> ../../../workflows
│   └── extra_model_paths.local.yaml  # written by launch.sh: COMFY_SHARED/models
├── standalone-env/          # ignored: the bundle's Python 3.13; used if present, else uv fetches one
├── logs/, snapshots/, archive/   # ignored
└── .build/                  # ignored: build.sh staging
```

## Run it from a fresh clone

Needs `git` and [`uv`](https://docs.astral.sh/uv/) (`brew install uv`).

```bash
cd apps/comfy-app
./setup.sh            # clones ComfyUI at the pin, builds .venv, links packs from shared/nodes and workflows/
./fetch-models.sh     # 1.2 GB Depth Anything V2 from Hugging Face
./launch.sh           # http://127.0.0.1:8188   (--background to detach; ./stop.sh ends it)
./check.sh            # confirm the core is at the pin with no edits
```

`setup.sh` picks `requirements-mac.txt` on macOS and `requirements-cuda.txt`
elsewhere. With `COMFY_SHOTPIPE=v26` it also links that ShotPipe version from
`projects/desktop/CANALV2/02_SCRIPTS/nodes/` (client tree, not in git).

`launch.sh` takes the three folders from `mounts-env.sh`: the environment,
else the mapping saved by the dashboard's Configuration panel, else
`~/ComfyUI-Shared` for the shared folder and the mirror for the tree. ComfyUI
gets `COMFY_SHARED/input` and `output` as its input and output directories and
`COMFY_SHARED/models` through a model paths file written at every start, so
weights live with input and output, the same layout as binc-PC and the pod.
The mirror under `projects/desktop` is read-only by rule, so ComfyUI-Shared may
not point into it. Override with `COMFY_INPUT`, `COMFY_OUTPUT`, `COMFY_PORT`,
`COMFY_INSTALL`. Anything after `--` goes to `main.py`.

To move the pin: edit `pins.env`, run `setup.sh`, then `check.sh`.

## Where the install came from

A ComfyUI Desktop standalone (`mac-mps`, bundle `v0.34.0-env1`, see
`manifest.json`) built on Brynley's Mac, which the desktop launcher kept in a
wrapper folder named `CanalV2_mac`. The wrapper is gone; `snapshots/` keeps the
launcher's boot records of what it had installed. Its venv hardcoded the old
home directory, which is why `setup.sh` rebuilds it.

## What is installed

| Piece | State |
|---|---|
| ComfyUI `v0.39.2` at `3c1b7a17`, Manager `4.2.2` | From `pins.env`; `setup.sh` installs `ComfyUI/requirements.txt` on the torch pins. |
| `ComfyUI-BincStereo` | Tracked and linked. Nodes: `BincDepthAnythingV2`, `BincDepthTemporalFilter`, `BincLoadImageSequence`, `BincStereoFromDepth`, `BincStereoPack`, `BincStereoReport`. |
| `ComfyUI-BH-ShotPipe` | Not tracked. Versions live in `projects/desktop/CANALV2/02_SCRIPTS/nodes/`; link one with `COMFY_SHOTPIPE=<ver> ./setup.sh`. |
| Models | `models.txt` lists Depth Anything V2 Large; `fetch-models.sh` downloads into `COMFY_SHARED/models` and moves weights an earlier run left inside the install. The mirror's `ComfyUI-Shared/models` has the layout and no weights; the rest are on binc-PC. |
| Workflows | Nine in `workflows/`, served to the UI through the symlink. |

## Run it in Docker (RunPod, Linux, Windows)

```bash
cd apps/comfy-app
./build.sh                         # comfy-app:v26: ComfyUI at the pin, torch 2.12.1 CUDA 12.6, BincStereo + ShotPipe v26 from shared/nodes
./build.sh --shotpipe v26,v21      # more than one ShotPipe version side by side
./build.sh --no-shotpipe           # only the tracked packs
./build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime   # Blackwell (RTX 5090 / B200)

# Local GPU box (Linux, or Windows with Docker Desktop + WSL2 + NVIDIA driver):
docker run --rm --gpus all -p 8188:8188 \
  -v /path/to/ComfyUI-Shared:/workspace/comfy-shared \
  -v /path/to/CANALV2:/workspace/project \
  comfy-app:v26
```

As a service on a Linux NVIDIA box, or several of them as a Docker Swarm,
`docker/compose.yml` runs the same image with the project tree mounted at
binc-PC's path and ComfyUI-Shared at `/workspace/comfy-shared`:

```bash
docker/swarm.sh up                 # one box: Compose, GPU via compose.gpu.yml
docker/swarm.sh init               # first Swarm manager + GPU node; prints the daemon.json lines Swarm needs
docker/swarm.sh deploy             # docker stack deploy comfy
```

Paths come from `PROJECT_ROOT`, `COMFY_SHARED`, `PLATES_ROOT` (the served plates, mounted read-only), `COMFY_IMAGE`, `COMFY_PORT`.
Not for macOS: Docker there has no GPU, use `launch.sh`. Why this shape:
`docs/ADR-004-where-the-workflows-run.md`.

Base image is `pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime`, so the torch
version matches the Mac exactly. `build.sh` passes `pins.env` as build args,
stages the packs from `shared/nodes` (BincStereo always, ShotPipe as asked) and copies `workflows/` into
`.build/` (ignored) because it is the client's. Inside the container ComfyUI is
`/opt/ComfyUI`, the shared tree is `/workspace/comfy-shared/{input,output,models}`
and `/home/binc/CANALV2_r3/CANALV2` links to `/workspace/project`, so graphs run
with their binc-PC paths unchanged. `COMFY_PORT`, `COMFY_SHARED` and
`COMFY_ARGS` override the defaults; arguments after the image name go to
`main.py`. The image never contains models or plates.

On RunPod: the image is pushed to `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`
(private; `./build.sh --remote --wait` builds and pushes it on GitLab CI next to the registry, so
the 3 GB torch layer never leaves this Mac; `--push <reference>` after `docker login` is the slow
local way; the
pod pulls with the credential saved on RunPod, whose id is in the Configuration panel). The
network volume at `/workspace` holds `project/`, `plates/` and `comfy-shared/`; the app's
Configuration panel carries the volume, datacenter, image and credential, so a pod created
there boots our image on the volume.
The pod manager's "Load defaults" reads the `ENV`/`ARG` lines from this
Dockerfile. Builds on Apple Silicon run under amd64 emulation and take a while.

## Pointing the `comfy` CLI at it

The CLI's remembered workspace is `~/Documents/comfy/ComfyUI`, a separate
install. To drive this one, start it with `launch.sh` and set:

```bash
export COMFY_LOCAL_URL=http://127.0.0.1:8188
comfy --json nodes search "BincStereo"
```

A project under `projects/` with `defaults.where: local` in its `comfy.yaml`
then routes to this server.

## Targets and what is still open

| Target | State |
|---|---|
| `mac` | Working. `setup.sh`, `launch.sh`, verified 2026-10-19. |
| `docker` | Dockerfile written 2026-10-19; runs on RunPod, Linux and Windows via Docker Desktop + WSL2. |
| `windows-native` | Not planned until a Windows machine needs ComfyUI outside Docker. `requirements-cuda.txt` already covers torch; the scripts are bash and would need `.ps1` twins. The CANALV2 graphs hardcode `/home/binc/CANALV2_r3/CANALV2`, which Docker and WSL can link but native Windows cannot, so prefer `docker` on Windows. |

Open, all tracked in `NEXT-STEPS.md` and `~/Workspaces/TODO.md`:

- Binc's yes for keeping `ComfyUI-BincStereo` in this (private) repo. It is
  tracked now; if the answer is no it moves back out and `setup.sh` copies it
  from `archive/ComfyUI-BincStereo.zip` instead.
- Binc's yes before client plates go to a RunPod network volume, before an
  image with the packs is pushed to a registry, and on the registry name and
  account. Spend stays inside the USD 100 cap from the 2026-10-09 decisions;
  a pod is stopped when its job ends.

Serverless (`CANALV2/02_SCRIPTS/containers/runpod/comfy-serverless/`) stays as
the project's own route for single graphs; this image is the pod route for
plate-sized batches. Comfy Cloud (`comfy cloud login`) runs stock templates and
partner models but cannot load these packs.


## Pushing the image (2026-10-19)

A pod cannot pull a bare local tag like `comfy-app:contract-v26`; pod creation refuses it on
purpose. The image carries Binc's ShotPipe packs, so pushing it to a registry needs Binc's named
yes (registry name and account). With that in hand:

```bash
docker login ghcr.io                                         # a token with write:packages
./start.sh comfy-image --push ghcr.io/<org>/comfy-app:contract-v26
```

The script builds for linux/amd64 (emulated on Apple Silicon: slow, but it works), tags, pushes,
and prints the reference to enter as the image in the dashboard's Configuration, or to bake into
a packaged app with `./start.sh package mac --comfy contract-v26 --image <reference>`.
