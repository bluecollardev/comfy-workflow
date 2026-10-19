# projects/

Local working copies of client and creative work that run through ComfyUI.
Everything here is **ignored by git** except this README: the tree is about
98 GB of plates, renders and node packs. Nothing in it
is reproducible from this repo, so treat it as data, back it up separately
(see `desktop/CANALV2/00_POLICY/storage-and-backup.md`), and never `git add` it.

Since 2026-10-19 the two trees sit under `desktop/` (ignored like the rest of
`projects/`), and the ComfyUI install that used to be `ComfyUI-Installs/` is
its own project at [`apps/comfy-app/`](../apps/comfy-app/README.md). Paths
below are relative to `projects/desktop/` unless written in full from the repo
root.

| Folder | Size | Files | What it is |
|---|---|---|---|
| `desktop/CANALV2/` | 81 GB | ~23,500 | The Canal V2 VFX job (corrosion and stereo shots) for BH / Binc. A mirror of `/home/binc/CANALV2_r3/CANALV2` on the Linux render PC ("binc-PC"). |
| `desktop/ComfyUI-Shared/` | 17 GB | ~2,000 | ComfyUI's `input/`, `output/` and `models/` folders, shared by every install. Mirrors `~/ComfyUI-Shared` on binc-PC. |

Three folders that used to sit here (`huntress/`, `01-depth-105-redesigned/`,
`Universal AI Cinematic Automation…/`) were moved out on 2026-10-17 and are not
covered below.

---

## CANALV2/

A numbered, policy-driven project tree. The rules are short and live in the
tree itself: start with `CANALV2/README.md`, then `00_POLICY/00_READ_ME.md`
(the policy index) and `00_POLICY/structure_v003.md` (the master structure
note, which this section summarises). The standing rules that shape every
folder: nothing is renamed, moved, overwritten or deleted; versions only go up
(`_v001`, `_v002` …); every output is a new folder; served plate frames keep
their names and frame numbers exactly.

### Top level

| Folder | Holds | Notes |
|---|---|---|
| `00_POLICY/` | One page per rule: naming, versioning, colour, served names, storage, symmetry, agent permissions, the engineering contract, plus `project_v###.md` snapshots. | `agent-permissions.md` says what Claude may and may not do here. Read it before running anything. |
| `01_GOVERNANCE/` | How work is run: `workflow-rules.md`, `hitl-signoff.md`, `decisions_v###.md`, change log and delivery schedule CSVs. | Workflow rule 1: nothing starts without an inbox entry. |
| `02_SCRIPTS/` | All tooling (see the package table below). | Scripts hardcode `ROOT = /home/binc/CANALV2_r3/CANALV2`, the binc-PC path. |
| `03_INBOX/` | One folder per shot (`corrosion-110/`, `archival-080a/`) or per request (`2026-10-09_stereo-throughput/`), each with `ENTRY.md` and `ASSETS.csv`. | The record. The tracker and Slack list point back here. |
| `04_TRACKER/` | `shots.csv`, `deliverables.csv`, `schedule.csv`, `attention-list.csv`, per-run queue logs (`corrosion-queue-run_*.csv`), `shots-table_v###.md`, problem ledgers, and `queue/{in,running,done}/` job files for agents. | `queue/in/job_NNN_*.md` are one-job briefs; `CANALV2/CLAUDE.md` is the operator brief for running exactly one of them. |
| `10_CORROSION/` | 66 GB. Fourteen corrosion shots (`corrosion-051` … `corrosion-165`), `_template/`, and `Gen_Paint_assets/` (geo mattes and generated paint per served frame, indexed in `INDEX.csv`). | `corrosion-058` alone is 23 GB, `corrosion-064` 12 GB. |
| `20_STEREO/` | Twelve stereo shots (`archival-*`, `enhance-*`, two `corrosion-*`) at slug stage only. | 416 KB: graphs and entries, no renders yet. |
| `30_CREATIVE/`, `40_TITLES/`, `50_RND/` | Empty placeholders with a README each. | Same rules as everywhere. |
| `80_TEST-BUCKET/` | 14 GB. Dated experiment folders, `<type>_<topic>_<yyyy-mm-dd>/`: Blender solves and tracks, bow-carry proofs of concept, v24 and v25 batch runs, review builds. | Also holds `comfy_history_v26_2026-10-17.json`, a chat export keyed by shot (`shot`, `status`, `msgs`, `texts`), not a ComfyUI history. |
| `90_DELIVERIES/` | 556 MB. Only what has gone out, versioned: 1080p letterboxed review movies, side-by-sides, review forks. | Synced to Google Drive by `02_SCRIPTS/drive-sync/`. |
| `99_ARCHIVE/` | Superseded work. | Nothing is ever deleted. |
| `LEGACY_MAP.csv` | Where pre-CANALV2 material lives on binc-PC (Desktop, Documents, `~/ComfyUI-Shared/workflows/…`) and which shot folder links to it. | Linked, not moved. |

### Every shot folder has the same shape

```
<shot>/                       e.g. 10_CORROSION/corrosion-110/
├── 00_READ_ME.md             hero eye, status, pointers
├── 01_ASK/                   ENTRY.md, ASSETS.csv (copies of the inbox entry)
├── 02_SOURCE/                SOURCES.csv, links to the served plates (never copied here)
├── 03_WORK/                  solves (solve_SA_v006.npz), aligned mattes, fills, each with a .meta.json sidecar
├── 04_GRAPH/                 the ComfyUI graphs: <shot>_graph_v###.json and its _api.json twin
├── 05_TEMPS/                 scratch renders
├── 06_REVIEW/                one folder per queued job: <shot>_job_<yyyymmdd-hhmm>_graph-v###/ with mp4s, proxy DPX sequences, _job-info.json
└── 07_DELIVER/               review forks, <shot>_review-fork_v###/
```

Working files are named `<shot>_<what>_<detail>_v###.<ext>` and carry a
`<file>.meta.json` beside them with shot, part, lead frame, eye, source plate,
sha256 of inputs and the transform applied. `02_SCRIPTS/conform/bh_nameconf.py`
checks and places files by these rules.

### 02_SCRIPTS packages

| Package | What it does | Entry points |
|---|---|---|
| `nodes/` | **ComfyUI-BH-ShotPipe**, the project's custom node pack, every version kept side by side from `v6` to `v26`. Provides the `BH_*` nodes the graphs are built from (`BH_ReadSequence`, `BH_ReadMatte`, `BH_LoadSolve`, `BH_CarryLayerExact`, `BH_WriteProxySeq`, `BH15_PlateSource`, `BH26_ObjectSolve`, …). | Symlink or copy one version into a ComfyUI `custom_nodes/`. Not installed in `apps/comfy-app` by default; `COMFY_SHOTPIPE=<ver> apps/comfy-app/setup.sh` links one in. |
| `graph-builder/`, `graph-builders/` | Python that generates the shot graphs programmatically for each pipeline version (`build_master_v15.py`, `build_v25_shot_graphs_v001.py`, `fork_v26_tracking_v003.py`, `graphlib.py`). | Run once per version; output lands in each shot's `04_GRAPH/`. |
| `queue-graphs/` | Loads graphs into a running ComfyUI's Workflows panel (`corrosion_load-graphs_v002.py`) or queues their API twins for rendering (`corrosion_queue-graphs_v002.py`, `corrosion_queue-api_v005.py`). `.desktop` launchers for binc-PC. | `--list` and `--dry-run` send nothing. Default ComfyUI is `http://127.0.0.1:8189`, the CanalV2 install on binc-PC. |
| `slug-builder/` | Reads an inbox entry and builds the shot folder plus the V1 "slug" graph (inputs only). `seed.py` wrote the first entries. | `python3 build_slug.py ~/CANALV2 corrosion-110` |
| `linter/` | `lint_graph.py` checks a graph against the engineering contract. | |
| `conform/` | `bh_nameconf.py`: naming, versioning and placement checks. Writes the `.meta.json` sidecar on `place --apply`. | Dry run by default. |
| `solve/`, `solve-blender/`, `solve-offline/` | Camera and object solves: COLMAP mono solve, stabilisation checks, Blender libmv track and solve scripts, offline measured-chain solves and locked review builds. | Blender CLI scripts run on binc-PC or the RunPod CPU pod. |
| `gen-paint-assets/` | Collects geo mattes and generated paint into `10_CORROSION/Gen_Paint_assets/` and writes `INDEX.csv`. | |
| `delivery/` | Shell scripts that make the 1080p letterbox review movies, side-by-sides and test-bucket collections for `90_DELIVERIES/`. | |
| `drive-sync/` | rclone copy of a deliveries folder to the client's Google Drive review folder. Copies only, never deletes. | `./corrosion_drive-copy_v002.sh --dry-run` |
| `containers/runpod/` | Dockerfiles and setup for running the same graphs on RunPod: `comfy-pod/` (ComfyUI pod on a network volume), `comfy-serverless/`, `solve/` (Blender CPU pod). This is the bridge to the `infra/` tooling in this repo. | Spend needs a named yes; USD 100 cap. |
| `sysmon/` | Logs machine load to `04_TRACKER/sysmon_*.csv` during queue runs. | |
| `collector/` | Spec only (`collector.md`). Not built. | |

### Where the ComfyUI prompts and graphs are

ComfyUI calls a submitted graph a "prompt". The corrosion and stereo graphs
contain no text prompts (no `CLIPTextEncode`); they are image-processing
pipelines built from `BH_*` nodes, `PreviewImage`, `ImageScaleBy`, masks and
`MarkdownNote` boxes. The generated paint in `Gen_Paint_assets/` comes from a
separate paint app, and the `.meta.json` sidecars record sources and transforms
but no prompt text.

| Where | Count | Format | Purpose |
|---|---|---|---|
| `10_CORROSION/<shot>/04_GRAPH/<shot>_graph_v###.json` | 260 | UI (canvas) | Every version of every corrosion shot graph. Highest version is the current one. |
| `20_STEREO/<shot>/04_GRAPH/<shot>_graph_v001.json` | 6 | UI | Stereo slug graphs. |
| `…/04_GRAPH/<shot>_graph_v###_api.json` | 127 | API | The twin that the queue scripts POST to `/prompt`. |
| `<shot>/07_DELIVER/<shot>_review-fork_v###/*_graph_v###.json` | few | UI | Review and audit forks. |
| `80_TEST-BUCKET/*/…_api.json` | 21 | API | Proof-of-concept graphs. |
| `04_TRACKER/queue/in/v20_graphs_2026-10-17/graphs_v20_all_2026-10-17.zip` | 22 | API | The v20 solve-carry graphs bundled for the agent queue. |
| `apps/comfy-app/workflows/*.json` | 9 | UI | Stereo QC and `cgi-042` workflows, tracked in the repo and served to the Mac install through a symlink. |

Graphs built with ShotPipe `v26` need the `BH26_*` nodes; older graphs need the
matching older pack. A ComfyUI without the right pack opens them with missing
nodes.

---

## ComfyUI-Shared/

The three ComfyUI data folders, kept outside any install so every install can
point `extra_model_paths` at them. Mirrors `~/ComfyUI-Shared` on binc-PC.

| Folder | Size | Contents |
|---|---|---|
| `input/` | 15 GB | `frames/` (241 PNG frames, `f-00001.png` …), `shots/` (285 files), `binc-stereo-test/`, two `cgi-042-pullback-4k` MP4s, a depth and frame still, empty `3d/`. |
| `output/` | 2.1 GB | `binc-stereo-qc-quarter/` and `binc-stereo-qc-quarter-KYLEDEPTH/` (quarter-res stereo QC frame sequences), `video/`. |
| `models/` | 0 B | The full ComfyUI model folder layout (`checkpoints/`, `loras/`, `vae/`, `depth_anything/`, `geometry_estimation/` …) with no weights on this Mac. Weights live on binc-PC. |

---

## The ComfyUI install

Moved on 2026-10-19 to [`apps/comfy-app/`](../apps/comfy-app/README.md), which
documents the install, how to rebuild its venv and launch it,
and how it relates to RunPod and Comfy Cloud. On binc-PC the equivalent
install is `/home/binc/ComfyUI-Installs/CanalV2/ComfyUI`, served on port
`8189`; the Mac install uses the default `8188`.

---

## How this relates to the rest of the repo

- `apps/runpod-api/` (pod manager API, MCP server) and `infra/` (pod CLI) are the generic tooling; `desktop/CANALV2/02_SCRIPTS/containers/runpod/` is the project-specific way the same graphs run on RunPod.
- The monorepo's `comfy.yaml`, `fragments/` and `blueprints/` are empty. Nothing in `projects/` has been imported into the `comfy` CLI's project format yet.
- The ComfyUI used by the `comfy` CLI defaults to `127.0.0.1:8188`. Point it elsewhere with `COMFY_LOCAL_URL`.
