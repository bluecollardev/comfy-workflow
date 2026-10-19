# The CANALV2 project tree, explained

CANALV2 is Binc's (BH's) working tree for the Canal V2 restoration job:
corrosion clean-up and stereo conversion of IMAX plates, done in ComfyUI
graphs built from their own node pack. The master lives on binc-PC at
`/home/binc/CANALV2_r3/CANALV2`. This repo holds a mirror at
`projects/desktop/CANALV2/`, ignored by git and **read-only for us** (see
`.claude/rules/`). This page explains the shape in our words; the
authoritative version is Binc's own `00_POLICY/structure_v003.md`, and the
per-folder inventory with sizes is `projects/README.md`.

## The idea

"One place for everything, one place to find everything." Numbered top-level
folders fix the order of reading; every shot folder has the same shape;
nothing is ever deleted or overwritten; the official record of what was
delivered lives outside the tree (the BH console, Slack, the panama-console
repo) and the tree follows it.

## Top level

| Folder | Role |
|---|---|
| `00_POLICY/` | The rules, one page each. `00_READ_ME.md` is the index; `structure_v###.md` the master structure; `agent-permissions.md` what an agent may do. |
| `01_GOVERNANCE/` | How work is run: `workflow-rules.md`, `hitl-signoff.md`, decisions, change log and delivery schedule CSVs. |
| `02_SCRIPTS/` | All tooling: the node pack (`nodes/`), graph builders, slug builder, linter, conform, solves, queue scripts, delivery, drive sync, containers. Every script hardcodes the binc-PC root. |
| `03_INBOX/` | One folder per shot or request. **Nothing starts without an entry here** (`ENTRY.md`, `ASSETS.csv`). |
| `04_TRACKER/` | Plain-CSV tracker (`shots.csv`, `deliverables.csv`, `schedule.csv`, `attention-list.csv`), queue run logs, and `queue/{in,running,done}/` with one-job briefs for agents. |
| `10_CORROSION/`, `20_STEREO/`, `30_CREATIVE/`, `40_TITLES/`, `50_RND/` | The shots, by type. `10_CORROSION/` also holds `_template/` and `Gen_Paint_assets/` (geo mattes and Gemini-generated paint per served frame). |
| `80_TEST-BUCKET/` | Dated experiments, `<type>_<topic>_<yyyy-mm-dd>/`. Flat, for quick timeline loading. |
| `90_DELIVERIES/` | Only what has gone out, versioned. Synced to the client's Google Drive. |
| `99_ARCHIVE/` | Superseded work, copied in; the original stays where it was. |
| `LEGACY_MAP.csv` | Where pre-CANALV2 material lives on binc-PC and which shot links to it. Linked, not moved. |
| `CLAUDE.md`, `README.md` | The operator brief for agents, and the one-screen index. |

## A shot folder

Every shot, every type, the same shape: one file and seven folders.

| Entry | Holds |
|---|---|
| `00_READ_ME.md` | What the shot is, status, owner, frame range, hero eye, which graph is current. The current version is *stated here*, never implied by renaming. |
| `01_ASK/` | Copy of the inbox entry and its asset list. |
| `02_SOURCE/` | `SOURCES.csv` only: links to the served plates. Plates are never copied or moved into the tree. On binc-PC they sit under `/mnt/storage/Panama_Redux/…`. |
| `03_WORK/` | Masks, fills, aligned generated paint, solves (`solve_S_v###.npz`), notes. |
| `04_GRAPH/` | The ComfyUI graphs, `<shot>_graph_v###.json` and the `_api.json` twin. Highest version is current. |
| `05_TEMPS/` | Intermediate caches. |
| `06_REVIEW/` | Review renders, one subfolder per job: `<shot>_job_<yyyymmdd-hhmm>_graph-v###/`. |
| `07_DELIVER/` | Review forks and packages for the shot. |

## How a shot moves through it

1. A request arrives and gets an inbox entry and an attention-list row.
2. The entry goes **live** only when every required asset is found; otherwise it waits, with the missing list. Nothing is guessed or substituted.
3. Live builds the shot folder and the V1 "slug" graph, inputs only (`02_SCRIPTS/slug-builder/`).
4. Processing is added from the type's template, by the graph builders, as new graph versions. Every graph has the same lettered boxes in the same order, a note on every box, a preview after every stage.
5. Hero eye generates; the second eye follows by measured disparity. Proxy first.
6. Renders land in `06_REVIEW/`, per job. Forks and packages in `07_DELIVER/`. What goes out is copied to `90_DELIVERIES/`.
7. Approved graphs are locked; the client runs them in their own stack. Locked shots are read-only for everyone, agents included.

Agents run work through `04_TRACKER/queue/`: one job file, one tool, one run,
one new output folder, a report, stop.

## Names and versions, the short form

- Shot folder is the client's name, lowercase with a hyphen: `corrosion-051`.
- Working files: `<shot>_<what>_<detail>_v###.<ext>`. Eyes spelled out. Frame numbers padded as served. Dates only in reports, logs and request folders.
- Versions only go up. Nothing is overwritten; a last known good is never replaced.
- No UUIDs, hashes, seeds or prompt ids in file names. Machine identifiers go in a `.meta.json` sidecar beside the file.
- Served frames keep their names and numbers exactly, in and out.
- Known exceptions on disk are listed in `structure_v003.md`, not fixed by renaming.

## Outside the root, on binc-PC

How each of these is mounted or linked on other machines: [`MOUNT-POINTS.md`](MOUNT-POINTS.md).

| What | Where |
|---|---|
| Served plates | `/mnt/storage/Panama_Redux/source/…/<served-folder>.LEFT` and `.RIGHT` |
| ComfyUI in use | `/home/binc/ComfyUI-Installs/CanalV2/ComfyUI`, served on port 8189 |
| ComfyUI input, output, models | `~/ComfyUI-Shared/` (mirrored here as `projects/desktop/ComfyUI-Shared/`, without the weights) |

## What it means for this repo

- We read the tree and copy or link out of it: the node packs into the `shared/nodes` submodule (`shared/sync-nodes.sh`), the policies into `shared/governance/` (`sync.sh`), graphs via the queue scripts. We do not write into it, rename in it, or commit it. If something of Binc's has to change, it is a request to Binc, recorded in their inbox or change log, not an edit by us.
- Every machine that runs a graph mounts the tree at binc-PC's path, because the scripts and graphs hardcode it (`docs/ADR-004-where-the-workflows-run.md`).
- `agent-permissions.md` binds any agent we run against this tree: read-only on locked shots, named yes for installs, spend and anything leaving the machine, USD 100 cap, stop and report on ambiguity.

Related: `docs/PROMPTS.md` (where the graphs, generative prompts and agent briefs are), `projects/README.md` (inventory with sizes and counts).
