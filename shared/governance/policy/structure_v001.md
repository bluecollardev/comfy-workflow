# CANALV2 structure

Root: `/home/binc/CANALV2_r3/CANALV2/`. All paths below are relative to the root unless they start with `/` or `~`.

## 1. Directory tree

```
CANALV2/
├── 00_POLICY/            policy pages, one page each
├── 01_GOVERNANCE/        change-log.csv, delivery-schedule.csv, hitl-signoff.md, workflow-rules.md
├── 02_SCRIPTS/
│   ├── collector/        collector.md
│   ├── conform/
│   ├── delivery/
│   ├── drive-sync/
│   ├── gen-paint-assets/
│   ├── graph-builder/    build_master_v###.py
│   ├── linter/           lint_graph.py
│   ├── nodes/            ComfyUI-BH-ShotPipe-v##/
│   ├── queue-graphs/
│   ├── slug-builder/     build_slug_r#.py, slugkit.py
│   ├── solve/
│   ├── solve-blender/
│   ├── solve-offline/
│   └── sysmon/
├── 03_INBOX/
│   ├── <shot>/                    ENTRY.md, ASSETS.csv
│   └── <yyyy-mm-dd>_<topic>/      ENTRY.md (requests, questions)
├── 04_TRACKER/           shots.csv, deliverables.csv, schedule.csv, attention-list.csv, README.md
├── 10_CORROSION/
│   ├── _template/
│   ├── Gen_Paint_assets/
│   │   ├── <served-name>_Geo.png, _Geo.json, <served-name>.dpx
│   │   ├── Gen_Paint_Output/<served-name>_Gen/
│   │   └── INDEX.csv
│   └── <shot>/           (shot folder, below)
├── 20_STEREO/
│   ├── _template/
│   └── <shot>/
├── 30_CREATIVE/
├── 40_TITLES/
├── 50_RND/
├── 80_TEST-BUCKET/       <type>_<topic>_<yyyy-mm-dd>/
├── 90_DELIVERIES/        <type>_<topic>_<yyyy-mm-dd>/
├── 99_ARCHIVE/
├── LEGACY_MAP.csv
└── README.md
```

### Shot folder (every shot, every type)

```
<shot>/
├── 00_READ_ME.md
├── 01_ASK/          ENTRY.md, ASSETS.csv (copies of the inbox entry)
├── 02_SOURCE/       SOURCES.csv (links to the served plates)
├── 03_WORK/
├── 04_GRAPH/
├── 05_TEMPS/
├── 06_REVIEW/
└── 07_DELIVER/
```

### Outside the root

| What | Path |
|---|---|
| Served plates | `/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/<served-folder>/<served-folder>.LEFT` and `.RIGHT` |
| ComfyUI in use | `/home/binc/ComfyUI-Installs/CanalV2/ComfyUI` |
| ComfyUI input, output, models | `~/ComfyUI-Shared/input`, `~/ComfyUI-Shared/output`, `~/ComfyUI-Shared/models` |
| Legacy locations | `LEGACY_MAP.csv` |

## 2. Naming rules

Source: `00_POLICY/naming.md`, `00_POLICY/versioning.md`, `00_POLICY/served-names.md`.

| Item | Rule | Example |
|---|---|---|
| Shot folder | the client's shot name, lowercase, hyphen | `corrosion-051`, `enhance-141`, `archival-080a` |
| Folders | lowercase, hyphens, no spaces, no punctuation | `gen-paint-assets` |
| Working file | `<shot>_<what>_<detail>_v###.<ext>` | `corrosion-051_hull-matte_lead-a_v003.png` |
| Eye | spelled out: `left`, `right` | `lead-a-left` |
| Frame number | padded as served | `093999` |
| Version | `v001`, `v002` … up only | `_v004` |
| Date | only in reports, logs and request folders: `yyyy-mm-dd` | `2026-10-09_stereo-throughput` |
| Request / question folder | `<yyyy-mm-dd>_<topic>` | `2026-10-09_cgi-042-stereo-standard` |
| Sidecar | `<filename>.meta.json` beside the file: seed, model, prompt, checksum, source link, who, when | `corrosion-110_gen-aligned_lead-a-left_108364_v001.png.meta.json` |
| Not in any file name | UUIDs, hashes, seeds, prompt ids, tracker numbers | |
| Served frames | keep their names and frame numbers exactly, in and out | `corrosion-059_3D.LEFT.093999.dpx` |
| Clerical fix of a served name | only with a row in `01_GOVERNANCE/change-log.csv` (original, new, who, why) | |

### Names in use (as on disk)

| Item | Pattern | Example path |
|---|---|---|
| Graph | `<shot>_graph_v###.json` | `10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v015.json` |
| Graph, API format | `<shot>_graph_v###_api.json` | `10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v015_api.json` |
| Review job | `<shot>_job_<yyyymmdd-hhmm>_graph-v###/` | `10_CORROSION/corrosion-110/06_REVIEW/corrosion-110_job_20261014-2150_graph-v015/` |
| Review fork | `<shot>_review-fork_v###/` | `10_CORROSION/corrosion-110/07_DELIVER/corrosion-110_review-fork_v001/` |
| Solve | `solve_S_v###.npz` (one lead), `solve_SA_` / `solve_SB_` (leads a, b) | `10_CORROSION/corrosion-118/03_WORK/solve_SA_v006.npz` |
| Lead part | `lead-a`, `lead-b` + eye | `corrosion-122_gen-aligned_lead-b-left_109110_v001.png` |
| Geo matte | `<served-name>_Geo.png` + `_Geo.json` | `10_CORROSION/Gen_Paint_assets/corrosion-110_3D.LEFT.108364_Geo.png` |
| Gen paint folder | `<served-name>_Gen/` | `10_CORROSION/Gen_Paint_assets/Gen_Paint_Output/corrosion-110_3D.LEFT.108364_Gen/` |
| Queue run log | `corrosion-queue-run_<yyyymmdd-hhmmss>.csv` | `04_TRACKER/corrosion-queue-run_20261014-223856.csv` |
| Test bucket / delivery folder | `<type>_<topic>_<yyyy-mm-dd>/` | `80_TEST-BUCKET/corrosion_blender-solve_2026-10-15/` |

## 3. Where each type goes

| Type | Goes in |
|---|---|
| Policy page | `00_POLICY/` |
| Change log, sign-off, delivery schedule | `01_GOVERNANCE/` |
| Script or tool | `02_SCRIPTS/<tool>/` |
| Node pack | `02_SCRIPTS/nodes/ComfyUI-BH-ShotPipe-v##/` |
| New shot or request | `03_INBOX/<shot>/` or `03_INBOX/<yyyy-mm-dd>_<topic>/` |
| Tracker CSVs, queue run logs, sysmon logs | `04_TRACKER/` |
| Shot folder | `10_CORROSION/`, `20_STEREO/`, `30_CREATIVE/`, `40_TITLES/`, `50_RND/` by type |
| Copy of the inbox entry | `<shot>/01_ASK/` |
| Links to served plates | `<shot>/02_SOURCE/SOURCES.csv` (plates are never copied or moved) |
| Masks, fills, aligned Gen, solves, notes | `<shot>/03_WORK/` |
| Graphs (UI and API) | `<shot>/04_GRAPH/` |
| Intermediate caches | `<shot>/05_TEMPS/` |
| Review renders, one subfolder per job | `<shot>/06_REVIEW/<shot>_job_<yyyymmdd-hhmm>_graph-v###/` |
| Review forks and packages for the shot | `<shot>/07_DELIVER/` |
| Lead source frame and geo matte for painting | `10_CORROSION/Gen_Paint_assets/` |
| Painted Gen, matte, meta | `10_CORROSION/Gen_Paint_assets/Gen_Paint_Output/<served-name>_Gen/` |
| Quick tests, flat, for timeline loading | `80_TEST-BUCKET/<type>_<topic>_<yyyy-mm-dd>/` |
| Anything that has gone out | `90_DELIVERIES/<type>_<topic>_<yyyy-mm-dd>/` |
| Superseded work (copied, original left in place) | `99_ARCHIVE/` |
| Sidecar | beside its file |

## 4. Tracker fields

Source: the headers of the files named.

**`04_TRACKER/shots.csv`**
`shot, type, assigned_by, received, due, state, hero_eye, locked, next_action, folder`

**`04_TRACKER/deliverables.csv`**
`shot, deliverable, format, spec, due, state, version, delivered_on`

**`04_TRACKER/schedule.csv`**
`date, milestone, source, note`

**`04_TRACKER/attention-list.csv`**
`item, kind, from, received, due, status, inbox entry, next action`

**State words** (`04_TRACKER/README.md`): `waiting, ready, live, hold, open, in review, approved, delivered, closed`.
**Status words** (attention list): `needs me, waiting on them, in progress, done`.
**`locked`**: `yes` when the client approves a shot.

**`03_INBOX/<entry>/ENTRY.md`**, header lines:
`shot, kind, type, state, owner, asked_by, received, source, due, eyes, hero_eye, first, last, frames, tc, their_folders, format, ref_frame, summary, build_slug`
Sections: `## Deliverables`, `## Flags`.
`kind`: `shot`, `request`, `question`.

**`03_INBOX/<entry>/ASSETS.csv`**
`name, role, eye, part, location, pattern, required, found, checked, note`

**`<shot>/02_SOURCE/SOURCES.csv`**
`role, eye, part, location, pattern, found, checked, proxy`

**`04_TRACKER/corrosion-queue-run_<yyyymmdd-hhmmss>.csv`**
`shot, graph, prompt_id, result, track_state`
