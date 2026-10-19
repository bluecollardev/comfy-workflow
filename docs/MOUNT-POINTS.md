# Mount points

Everything in the CANALV2 work names binc-PC's filesystem: the scripts
hardcode the project root, every graph references it hundreds of times,
each shot's `SOURCES.csv` points at the plates disk, and the older node packs
carry those paths as defaults. The rule from ADR-004 follows: no runtime
edits a path; every runtime makes binc-PC's paths resolve. This page is the
complete list, from a scan of every text file in the project mirror on
2026-10-19 (10,473 path mentions), Binc's storage policy and the legacy map.
The same list as data: [`shared/shapes/mount-points.json`](../shared/shapes/mount-points.json),
which the pod manager reads for its defaults.

## The three real mounts

| What | Path on binc-PC | Also written as | Mentions | In a container or pod |
|---|---|---|---|---|
| **Project tree**: scripts, graphs, shot folders, tracker, policies | `/home/binc/CANALV2_r3/CANALV2` | `~/CANALV2_r3/CANALV2`, `~/CANALV2` | 8,541 | mount at `/workspace/CANALV2`; link `/home/binc/CANALV2_r3/CANALV2`, `/root/CANALV2_r3/CANALV2`, `/root/CANALV2` to it |
| **Served plates**: DPX, one folder per served shot, `.LEFT` and `.RIGHT` | `/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/` | | 1,582 | mount read-only at `/workspace/plates/Panama_Redux/…`; link `/mnt/storage/Panama_Redux` to it |
| **ComfyUI-Shared**: input, output, models, workflows for every install | `/home/binc/ComfyUI-Shared` | `~/ComfyUI-Shared` | 39 | mount at `/workspace/ComfyUI-Shared`; link `/home/binc/ComfyUI-Shared` and `/root/ComfyUI-Shared`; `COMFY_SHARED` env |

`~` is `/home/binc` on binc-PC and `/root` in a container, which is why each
home-relative spelling needs its own link. Binc's policy adds two facts: the
plates stay where they were delivered and are linked, never copied, and the
disk they sit on is for parking and mirroring only, so run output goes
elsewhere. Copying plates to a pod's volume is the one step that moves client
material off binc-PC and needs Binc's named yes.

## Present on binc-PC, not mounted elsewhere

| What | Path | Mentions | Why not |
|---|---|---|---|
| The ComfyUI install in use, port 8189 | `/home/binc/ComfyUI-Installs/CanalV2/ComfyUI` | 14 | the image has its own ComfyUI; the queue scripts default to `http://127.0.0.1:8189`, so pass `--comfy <url>` |
| Legacy material linked from shot folders (`LEGACY_MAP.csv`): v5 lock graphs and masks, earlier 051 work, the painted-hull training set | `~/Documents/CORROSION RIGHTEYE PAINTS`, `~/Desktop/corrosion-051`, `~/Desktop/Hull_Painted_4Training`, `~/ComfyUI-Shared/workflows/corrosion-051-v6-stereo` | 44 | only corrosion-051's v001 graph and its audit forks reach for it; mount at `/workspace/legacy` if that graph must open |
| Kyle's repo, the operating manual and official record | `~/panama-console` | 62 | referenced by policy pages, never at render time |

## Not mounts at all

51 mentions of `/home/claude/…`, `/mnt/user-data/uploads/…` and
`/mnt/attach/outputs/…` are paths from an agent sandbox, left in tool scripts
under `80_TEST-BUCKET/`. They exist on no machine. A tool that still uses
them is rerun with explicit paths. Four mentions of
`/workspace/runpod-slim/ComfyUI` are RunPod's stock template, used by Binc's
`comfy-pod/setup_on_volume.sh`, and apply only when a pod runs that template
instead of our image.

## Per runtime

| Runtime | How the paths resolve |
|---|---|
| binc-PC | they are real |
| this Mac | the mirror has the tree without plates; nothing resolves at binc-PC's paths until the tree is mounted over SMB or linked. First item in `NEXT-STEPS.md` |
| Docker on a Linux box, Compose or Swarm | [`apps/comfy-app/docker/compose.yml`](../apps/comfy-app/docker/compose.yml) binds the three mounts from the host at binc-PC's paths, plates read-only |
| RunPod pod | a network volume at `/workspace` carrying `CANALV2/`, `ComfyUI-Shared/` and `plates/`; the image's entrypoint makes the links from `COMFY_LINKS`; the dashboard's Configuration panel and `create_pod.py --network-volume` set it up |

Where the pack defaults come from, line by line:
[`shared/nodes/bound/README.md`](../shared/nodes/bound/README.md). What the
packs are: [`docs/NODE-PACKS.md`](NODE-PACKS.md). The structure the paths
belong to: [`docs/CANALV2-STRUCTURE.md`](CANALV2-STRUCTURE.md).
