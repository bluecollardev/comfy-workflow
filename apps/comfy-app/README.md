# apps/comfy-app

The local ComfyUI server for this Mac. Everything that runs the AI lives here;
the `comfy` CLI, the blueprints in the repo root and the project trees under
`projects/` are clients of it.

The install itself (`ComfyUI/`, `standalone-env/`, about 5 GB and 70k files)
is **ignored by git**. Only the scripts, the pins and this README are tracked.

```
apps/comfy-app/
├── README.md
├── setup.sh                 # rebuild the venv from the pins (run once per machine)
├── launch.sh                # start the server on http://127.0.0.1:8188
├── stop.sh                  # stop a --background server
├── extra_model_paths.yaml   # extra model folders (projects/desktop/ComfyUI-Shared/models)
├── manifest.json            # the standalone build's pins
├── requirements-mac.txt     # torch / torchvision / torchaudio pins (MPS)
├── Dockerfile               # the same server for CUDA: RunPod pods, Linux, Windows via WSL2
├── build.sh                 # stages the node packs into .build/ and builds linux/amd64
├── requirements-packs.txt   # Python deps of the node packs (same list as CANALV2's requirements-bh.txt)
├── docker/
│   ├── entrypoint.sh        # container twin of launch.sh
│   └── extra_model_paths.yaml  # points at /workspace/ComfyUI-Shared/models
├── ComfyUI/                 # ignored: the app (reports 0.39.2) with .venv/, custom_nodes/, models/, user/
├── standalone-env/          # ignored: python-build-standalone 3.13 that .venv is built on
├── logs/                    # ignored: comfyui.log, comfyui.pid
├── snapshots/               # ignored: boot snapshots from the desktop launcher it came from
└── archive/                 # ignored: leftovers (BincStereo zip, an example workflow)
```

## Where it came from

`ComfyUI/` and `standalone-env/` are a copy of a ComfyUI Desktop standalone
(`mac-mps`, `v0.34.0-env1`, see `manifest.json`) built on Brynley's Mac, where
the desktop launcher kept it in a wrapper folder named `CanalV2_mac`. That
wrapper was the launcher's "one folder per install" convention and is gone
here. The `standalone-env/` Python is relocatable, but the venv it created
under `ComfyUI/.venv` hardcodes the old home directory, so a fresh copy cannot
start until `setup.sh` has recreated the venv. The pins are the ones the
launcher used; `snapshots/` records what was installed at each boot.

## Run it

```bash
cd apps/comfy-app
./setup.sh                 # once: recreates ComfyUI/.venv with uv, installs pins
./launch.sh                # foreground; Ctrl-C stops it
./launch.sh --background   # detached; ./stop.sh ends it
curl -s http://127.0.0.1:8188/system_stats | jq .system
```

`launch.sh` points `input/` and `output/` at `projects/desktop/ComfyUI-Shared`,
the folders shared with binc-PC, and adds the `ComfyUI-Shared/models` layout
through `extra_model_paths.yaml`. Override with `COMFY_INPUT`, `COMFY_OUTPUT`,
`COMFY_PORT`, `COMFY_INSTALL`. Anything after `--` goes to `main.py`.

## What is installed

| Piece | State |
|---|---|
| ComfyUI (reports `0.39.2`; the standalone bundle tag is `v0.34.0-env1`), Manager `4.2.2` | `setup.sh` installs what `ComfyUI/requirements.txt` asks for, on the torch pins in `requirements-mac.txt`. |
| `custom_nodes/ComfyUI-BincStereo` | Installed. Stereo and depth nodes used by the QC workflows. |
| `ComfyUI-BH-ShotPipe` | **Not** installed. Versions live in `projects/desktop/CANALV2/02_SCRIPTS/nodes/`; symlink one into `ComfyUI/custom_nodes/` (see `NEXT-STEPS.md`). |
| Models | Only `depth_anything/Depth-Anything-V2-Large-hf` (1.2 GB) in the install. `ComfyUI-Shared/models` has the folder layout and no weights; the weights are on binc-PC. |
| Saved workflows | Nine in `ComfyUI/user/default/workflows/` (stereo QC, cgi-042). |

## Run it in Docker (RunPod, Linux, Windows)

```bash
cd apps/comfy-app
./build.sh                         # comfy-app:v26: ComfyUI v0.39.2, torch 2.12.1 CUDA 12.6, BincStereo + ShotPipe v26
./build.sh --shotpipe v26,v21      # more than one ShotPipe version side by side
./build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime   # Blackwell (RTX 5090 / B200)

# Local GPU box (Linux, or Windows with Docker Desktop + WSL2 + NVIDIA driver):
docker run --rm --gpus all -p 8188:8188 \
  -v /path/to/ComfyUI-Shared:/workspace/ComfyUI-Shared \
  -v /path/to/CANALV2:/workspace/CANALV2 \
  comfy-app:v26
```

Inside the container ComfyUI is `/opt/ComfyUI`, the shared tree is
`/workspace/ComfyUI-Shared/{input,output,models}` (same layout as the Mac and
binc-PC) and `/home/binc/CANALV2_r3/CANALV2` links to `/workspace/CANALV2`, so
graphs run with their binc-PC paths unchanged. `COMFY_PORT`, `COMFY_SHARED` and
`COMFY_ARGS` override the defaults; arguments after the image name go to
`main.py`.

On RunPod: push the image to a registry (needs Binc's yes), attach a network
volume at `/workspace` holding `ComfyUI-Shared/` and `CANALV2/`, and start the
pod with `infra/scripts/create_pod.py create --image <registry>/comfy-app:v26`.
The pod manager's "Load defaults" reads the `ENV`/`ARG` lines from this
Dockerfile.

The image never contains models or plates. `build.sh` stages the node packs
from outside git (`.build/`, ignored), so it only builds on a machine that has
the Mac install's `ComfyUI/custom_nodes/ComfyUI-BincStereo` and
`projects/desktop/CANALV2/02_SCRIPTS/nodes/` on disk; `COMFY_BINCSTEREO` and
`COMFY_SHOTPIPE_DIR` point it elsewhere. Builds on Apple Silicon run under
amd64 emulation and take a while.

## Pointing the `comfy` CLI at it

The CLI's remembered workspace is `~/Documents/comfy/ComfyUI`, a separate
install. To drive this one instead, start it with `launch.sh` and tell the CLI
where it is:

```bash
export COMFY_LOCAL_URL=http://127.0.0.1:8188
comfy --json nodes search "binc"     # should list the BincStereo nodes
```

A project under `projects/` with `defaults.where: local` in its `comfy.yaml`
then routes to this server.

## Plan: one server project, two targets

Decided 2026-10-19.

`apps/comfy-app` owns every way the ComfyUI server runs. The Mac install is
one target; a Docker image for RunPod, Linux and Windows is the second. Both run the same custom
node packs against the same input / output / models layout, so a graph that
works here runs unchanged on a pod.

| Target | What it is | State |
|---|---|---|
| `mac` | This install: `setup.sh` rebuilds the venv on the bundled macOS Python with the MPS torch pins; `launch.sh` starts it. | Working. |
| `docker` | A `Dockerfile` in this folder starting from RunPod's official ComfyUI image (Linux, CUDA torch), copying in BincStereo and one ShotPipe version, installing the packs' Python deps (`requirements-bh.txt` in `CANALV2/02_SCRIPTS/containers/runpod/`), and linking `/home/binc/CANALV2_r3/CANALV2` to the network volume so graphs keep their binc-PC paths. `build.sh` builds it locally. The same image runs on RunPod, on Linux (binc-PC) and on Windows through Docker Desktop with WSL2 GPU passthrough. | Written 2026-10-19; see "Run it in Docker". Base image is `pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime`, not RunPod's, so the torch version matches the Mac exactly. |
| `windows-native` | Only if a Windows machine needs ComfyUI outside Docker: a `requirements-win.txt` with CUDA torch pins from PyTorch's index, a plain Python 3.13, and `.ps1` versions of the three scripts. The CANALV2 graphs hardcode Linux paths (`/home/binc/CANALV2_r3/CANALV2`), which Docker and WSL can link but native Windows cannot, so prefer `docker` on Windows. | Not planned until needed. |

The Mac install cannot run on RunPod or Windows as-is: `standalone-env/` is
a macOS Python bundle, the torch build is MPS-only and the scripts are bash. What carries over is the node
packs, the saved workflows, the model list and the folder layout; the Python
environment is rebuilt from Linux pins inside the image.

### What is in git and what is not

| In the repo | Ignored, on disk only |
|---|---|
| `README.md`, `setup.sh`, `launch.sh`, `stop.sh` | `ComfyUI/`, `standalone-env/` (about 5 GB; recreate by cloning ComfyUI at the pinned ref and running `setup.sh`) |
| `extra_model_paths.yaml` | `logs/`, `snapshots/`, `archive/` |
| `manifest.json`, `requirements-mac.txt` (the pins) | model weights (Depth Anything, 1.2 GB) |
| `Dockerfile`, `build.sh` (once written) | client plates |

### Steps

1. ~~Write `Dockerfile` and `build.sh` here.~~ Done 2026-10-19. The placeholder
   `infra/docker/Dockerfile` is gone; the pod manager reads this one.
2. Decide where the node packs live for the Docker build context.
   `ComfyUI-BincStereo` sits inside the ignored `ComfyUI/custom_nodes/` and is
   marked proprietary to Bincos. Options: track it under
   `apps/comfy-app/custom_nodes/` with `setup.sh` symlinking it into the
   install (needs Binc's yes, repo must stay private), or keep it out of git
   and build only from this Mac. Default until Binc answers: keep it out.
   ShotPipe versions stay in `projects/desktop/CANALV2/02_SCRIPTS/nodes/`.
3. Models and plates go on a RunPod network volume, never in the image:
   `/runpod-volume/models/<type>/` for weights, `/workspace/CANALV2` for the
   tree. Nothing is uploaded until Binc has agreed (third-party service rule
   in `CANALV2/00_POLICY/`).
4. Run it through the existing pod manager: `infra/scripts/create_pod.py`
   already accepts a custom image name. Pushing the image to a registry also
   needs Binc's yes on the name and account.
5. Spend stays inside the USD 100 cap from the 2026-10-09 decisions; a pod is
   stopped when its job ends.

Serverless (`CANALV2/02_SCRIPTS/containers/runpod/comfy-serverless/`) stays as
the project's own route for single graphs; this image is the pod route for
plate-sized batches.

## Other backends

This install is the Mac route. RunPod (`infra/`, and the project's own
`projects/desktop/CANALV2/02_SCRIPTS/containers/runpod/`) is a ComfyUI server
on a rented GPU for CUDA-only packs and plate-sized batches. Comfy Cloud
(`comfy cloud login`) runs stock templates and partner models but cannot load
the BH custom packs.
