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
| **Project tree**: scripts, graphs, shot folders, tracker, policies | `/home/binc/CANALV2_r3/CANALV2` | `~/CANALV2_r3/CANALV2`, `~/CANALV2` | 8,541 | mount at `/workspace/project`; link the path the tree declares for itself to it; `PROJECT_ROOT` env |
| **Served plates**: DPX, one folder per served shot, `.LEFT` and `.RIGHT` | `/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/` | | 1,582 | mount read-only at `/workspace/plates`; link the path above to it; `PLATES_ROOT` env |
| **ComfyUI-Shared**: input, output, models, workflows for every install | `/home/binc/ComfyUI-Shared` | `~/ComfyUI-Shared` | 39 | mount at `/workspace/comfy-shared`; link `/home/binc/ComfyUI-Shared` and `/root/ComfyUI-Shared`; `COMFY_SHARED` env |

The node packs no longer need the links for their own defaults: since
`packs-2026-10-19h` they read `PROJECT_ROOT`, `PLATES_ROOT` and
`COMFY_SHARED`, which the mount configuration sets on a pod and `launch.sh`
sets on the Mac. The links remain for the graphs, which carry the literal
paths (7,599 mentions of the root across 340 graphs). The binc-PC column is
what the mirror declared on 2026-10-19, for reference: nothing reads it at run
time, see "Mapping the folders" below. Binc's policy adds two facts: the
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

## Mapping the folders on this PC

The pod manager runs on one PC, and on each PC the user maps the three
folders, wherever they are on its disks: the dashboard's Configuration panel
(gear icon) has a row per folder with a Browse widget that lists this PC's
folders through the API (`GET /api/fs/dirs`), so it works the same in the
browser and in the Electron app. The mapping is the whole configuration
(`PUT /api/mounts`, stored in `~/.config/runpod-pod-manager/mounts.json`);
nothing about a machine is typed. Everything a runtime receives is derived:

| For | The API derives | From |
|---|---|---|
| a runtime on this PC (`launch.sh`, `compose.yml`) | `PROJECT_ROOT`, `PLATES_ROOT`, `COMFY_SHARED` set to the mapped folders (`GET /api/mounts/env`) | the mapping |
| a pod | the same variables set to `/workspace/project`, `/workspace/plates`, `/workspace/comfy-shared`, plus one `COMFY_LINKS` entry per folder from the path the project's files name onto that place | the mapped project tree: the job files' `root:` line in `04_TRACKER/queue` (else the structure master's `Root:`), each shot's `02_SOURCE/SOURCES.csv` two levels above the eye folders, and `~/ComfyUI-Shared` beside the tree's home |

Which folders are required is a mode question. `COMFY_MODE=prod` requires all
three. In `dev`, the default, the panel's per-folder switches decide (none by
default: a dev machine has no plates yet), `COMFY_REQUIRE` overrides them
(`project,plates,comfy-shared`, `all`, `none`), and a ComfyUI-Shared mapped
into the mirror is replaced by `~/ComfyUI-Shared` at launch instead of refused.
Pod creation and `launch.sh` refuse to run without a required folder.

The panel shows what the tree declares under each folder. A tree that declares
nothing gets no link, and the panel says so. Below the three required folders
the user adds custom ones (Add folder): a name, the local folder, its place on
the pod (`<mount path>/<name>` unless set) and, optionally, a path the code
names, which a pod links onto that place. The legacy material is one such
folder; `create_pod.py --link` is the same thing from the command line.

```bash
eval "$(curl -s localhost:8000/api/mounts/env | jq -r .sh)"   # this PC's folders into the shell
```

## Per runtime

| Runtime | How the paths resolve |
|---|---|
| binc-PC | they are real |
| this Mac | map the three folders in the Configuration panel; `apps/comfy-app/mounts-env.sh` reads the saved mapping (or `PROJECT_ROOT`, `PLATES_ROOT`, `COMFY_SHARED` from the environment) for `launch.sh` and `fetch-models.sh`, and `launch.sh` writes the model paths file from it at every start. ComfyUI-Shared may not be the mirror, which is read-only by rule; the default is `~/ComfyUI-Shared`. The mirror has the tree without plates |
| Docker on a Linux box, Compose or Swarm | [`apps/comfy-app/docker/compose.yml`](../apps/comfy-app/docker/compose.yml) binds the three folders from the same three variables at the paths the project declares, plates read-only |
| RunPod pod | a network volume at `/workspace` carrying `project/`, `plates/` and `comfy-shared/` (input, output, models, and `workflows/`, which the image links ComfyUI's Workflows panel to and seeds from the repo's `apps/comfy-app/workflows/` only while empty), filled by `./start.sh sync --pod <id>` (rsync, never deletes, plates only with a named yes; the repo's workflows go to `comfy-shared/workflows/`); the image's entrypoint makes the links from `COMFY_LINKS`. Configured once in the Configuration panel and applied to every new pod by the API and by `create_pod.py` (`--network-volume`, `--link`, `--no-mounts`); a pod with nothing queued for the configured minutes is stopped by the idle watch |

Where the pack defaults come from, line by line:
[`shared/nodes/bound/README.md`](../shared/nodes/bound/README.md). What the
packs are: [`docs/NODE-PACKS.md`](NODE-PACKS.md). The structure the paths
belong to: [`docs/CANALV2-STRUCTURE.md`](CANALV2-STRUCTURE.md).
