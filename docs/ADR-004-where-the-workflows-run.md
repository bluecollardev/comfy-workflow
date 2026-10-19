# ADR-004: Where the workflows run

**Date:** 2026-10-19
**Status:** Accepted
**Owner:** Lucas (Blue Collar Dev), with Binc's input (see README, "Goal")

## Context

The work is ComfyUI graphs, mostly custom nodes (ShotPipe, BincStereo), over
film plates: 4K video for the stereo conversions, DPX sequences for the
corrosion restoration. Four kinds of machine are in play:

| Machine | Has | Lacks |
|---|---|---|
| binc-PC (Linux, NVIDIA) | the plates at `/home/binc/CANALV2_r3/CANALV2` and `/mnt/storage/…`, CUDA, Blender, the node packs | spare capacity; it is one box |
| this Mac (Apple Silicon) | ComfyUI on MPS, the repo, a mirror of the project tree without plates | CUDA, any GPU inside Docker, the plates |
| a Mac Studio, a NAS (Binc's setup) | shared storage over SMB | nothing of ours runs there yet |
| RunPod | rented NVIDIA GPUs by the hour | the plates, until uploaded to a network volume; Binc's yes |

Measured on 2026-10-19: the BincStereo smoke test runs on the Mac on MPS in
about a second. The corrosion graphs do not run on the Mac: the packs are not
linked, the plates are not here (every shot's `02_SOURCE/` holds only a CSV
pointing at binc-PC), and the graphs hardcode binc-PC's path. Blender is not
needed to run a graph; it is the camera track and solve step before it.

## Decision

1. **The graphs run where the plates are, over one path.** Every runtime
   mounts the project so `/home/binc/CANALV2_r3/CANALV2` resolves, and the
   served plates so `/mnt/storage/Panama_Redux/…` resolves (the shot folders
   only link to them; the current graphs reference that root 68 times). The
   full list of paths and links per runtime is `docs/MOUNT-POINTS.md`: natively on
   binc-PC, as a bind mount in a container, as a network volume on RunPod, and
   on the Mac only once the tree is mounted over SMB or synced. Graphs are not
   edited per machine.
2. **Containers are the unit of deployment on Linux.** `apps/comfy-app/`
   builds one image with ComfyUI at the Mac's pin, the node packs and the CUDA
   torch build. `apps/comfy-app/docker/compose.yml` runs it on any Linux NVIDIA
   box with plain Compose, and the same file deploys as a Swarm stack when
   there is more than one box. Blender solves stay one-off `docker run`s of
   the project's own `solve/` image, not a service.
3. **Docker Swarm is the orchestrator for the Linux machines, nothing else.**
   binc-PC is the first node. A Mac can be a manager but not a GPU worker:
   Docker on macOS has no GPU, so the Mac runs ComfyUI natively for MPS work
   (`./start.sh comfy`) and otherwise uses a remote server from its browser.
   RunPod pods cannot join a Swarm; they are reached through RunPod's own API.
4. **RunPod is overflow, built on RunPod's own tools and images.** When a batch
   outgrows binc-PC: a GPU pod from RunPod's ComfyUI template or our image, a
   network volume mounted at the project path, our packs copied on once, the
   queue script pointed at the pod URL. A CPU pod runs solves. Serverless is
   out for now: it returns images per request, which does not suit 500-frame
   sequences. Pods are managed with `infra/scripts/create_pod.py` or RunPod's
   hosted MCP. Nothing goes to RunPod before Binc's yes on plates leaving
   binc-PC, the registry, the MCP and spend inside the USD 100 cap.
5. **Running a graph from a machine without a GPU means pointing at a server
   that has one.** The ComfyUI UI is a web page; `comfy` CLI and the queue
   scripts take a `--comfy <url>`. The Mac's job is editing, review and light
   MPS runs, and driving binc-PC or a pod for the rest.

## Consequences

- The next thing to solve is shared storage, not GPU: a mount or sync that
  gives the Mac (and later a pod) the plates at the project path. Until then
  the Mac can run the stereo workflows and open, but not render, the corrosion
  graphs.
- The packs live in the `shared/nodes` submodule (`comfy-node-packs`, v6–v26 and
  BincStereo); `COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh` links the version a
  graph needs. Done on this Mac 2026-10-19. Versioning: `docs/NODE-PACKS.md`.
- Swarm's GPU scheduling needs each GPU node to advertise the card
  (`node-generic-resources` in `daemon.json`); `docker/swarm.sh init` prints
  the exact lines for the node it runs on.
- Binc's goal of a crew of skill agents over this pipeline (README, "Goal")
  sits above all of this. ADR-002's "agent pool" is GPU pods and is a
  different thing; the skill crew does not exist yet and is tracked as a goal,
  not a decision.

## Alternatives considered

- **Kubernetes.** More than one person and three machines need. Swarm ships
  with Docker and the stack file is plain Compose.
- **Everything on RunPod.** Moves client plates off-site by default, which the
  project's policy forbids without a named yes, and pays for idle GPUs.
- **Editing graph paths per machine.** Breaks the project's "one place for
  everything" policy and every saved graph.
