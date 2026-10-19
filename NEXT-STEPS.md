# Next steps: importing the CANALV2 graphs

Status as of 2026-10-17; paths updated 2026-10-19 when the trees moved under `projects/desktop/` and the ComfyUI install became `apps/comfy-app/`. The inventory behind this is in
[`projects/README.md`](./projects/README.md), section "Where the ComfyUI prompts
and graphs are".

**2026-10-19, what was measured:** the BincStereo smoke test runs on this Mac
on MPS (all 12 nodes, about a second), so the stereo workflows run here. The
corrosion graphs do not: the plates are not on this machine (the packs were
not linked either that morning; the `contract-v26` set is, from the `shared/nodes` submodule, since the afternoon), and the graphs hardcode binc-PC's path. Blender is the solve
step before a graph, not a requirement to run one. Decision record:
`docs/ADR-004-where-the-workflows-run.md`.

## The main thing to solve next: run the graphs from any machine

The GPU is the easy part. In order:

- [ ] **Shared storage.** Get the plates visible at `/home/binc/CANALV2_r3/CANALV2` on the Mac (SMB from binc-PC or the NAS; Binc's note has a Mac Studio on SMB already). Until then the Mac can open the corrosion graphs but not render them.
- [x] **The packs are in the repo** (2026-10-19): `shared/nodes` is the `comfy-node-packs` submodule with ShotPipe v6–v26 and BincStereo; `docs/NODE-PACKS.md` has the versioning. Link what a graph needs: `COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh`.
- [ ] **binc-PC as the first container node.** Build `comfy-app:v26` on a Linux box (`apps/comfy-app/build.sh`; the Mac would emulate amd64), then `apps/comfy-app/docker/swarm.sh up` for one box or `init` + `deploy` for a Swarm. The Mac's browser then uses `http://binc-pc:8188` like the local one.
- [ ] **Drive it from the Mac.** `comfy` CLI and the queue scripts take `--comfy <url>`; the stereo work stays local on MPS.
- [ ] **RunPod as overflow**, after Binc's four yeses (section below). Same image or RunPod's template, network volume at the project path.
- [ ] **Binc's goal, the skill crew.** Not started; a design, not code, is the next step. Separate from ADR-002's GPU pool. See `README.md`, "Goal".
  - [ ] First piece: a dispatcher over `queue/<project>/`. Watch `in/`, claim a job by moving it to `running/`, start a Claude Code session with the brief as its first message, collect `REPORT.md`, move to `done/`. The folders stay the interface, so the manual and automated paths are the same.
  - [ ] **Abstract shapes and concrete shapes** (Lucas, 2026-10-19). `shared/shapes/` today is CANALV2's shapes verbatim. Split them: abstract shapes any restoration project has (a project tree, a shot folder, a job, a report, a graph with ordered boxes, naming rules) and concrete bindings per project (CANALV2's `10_CORROSION`, `BH26_` nodes, `/home/binc/...` root, its state words). The dispatcher and the checker then run against the abstract shape plus a binding.
  - [ ] What `check.py` found on 2026-10-19, to raise with Binc rather than fix: `corrosion-111` and `corrosion-159` have no `05_TEMPS/` or `07_DELIVER/`; the 17 real job files carry `job`, `shot`, `tool`, `machine`, `root` and STEP blocks but not the brief's `inputs`, `params`, `output` fields. Either the brief's template or the files should move.

## What there is to import

ComfyUI calls a submitted graph a "prompt". The project has no text prompts;
it has 393 shot graphs plus a few saved workflows.

| Source | Count | Format |
|---|---|---|
| `projects/desktop/CANALV2/10_CORROSION/<shot>/04_GRAPH/<shot>_graph_v###.json` | 260 | UI canvas |
| `projects/desktop/CANALV2/20_STEREO/<shot>/04_GRAPH/` | 6 | UI canvas |
| the `*_api.json` twins beside them | 127 | API |
| `projects/desktop/CANALV2/80_TEST-BUCKET/*/` | 21 | API |
| `projects/desktop/CANALV2/04_TRACKER/queue/in/v20_graphs_2026-10-17/*.zip` | 22 | API |
| `apps/comfy-app/workflows/` | 9 | UI canvas |

The highest `_v###` in each shot's `04_GRAPH/` is the current graph. Only the
current graph per shot needs importing; older versions stay where they are.

## Step 0: install the node pack (done 2026-10-19 for v26)

The graphs are built from the `BH_*` nodes in ComfyUI-BH-ShotPipe, and the v26
graphs need `BH26_*` nodes. All versions, v6–v26, plus BincStereo are in the
`shared/nodes` submodule (`bluecollardev/comfy-node-packs`); nothing is read
from Binc's mirror at install time any more. `docs/NODE-PACKS.md` has the
versioning and release steps.

- [x] Decide which ShotPipe versions to install. Not one: ShotPipe stacks, and the 14 current graphs use nodes from v7, v10, v11, v12, v13, v14 and v26 together. That is the `contract-v26` set in the packs repo's `sets.json` (`shared/nodes/docs/SHOTPIPE.md` explains the family). Never v6 beside v7 or v9 beside v10, same names.
- [x] Link it from the submodule, do not copy:
  ```bash
  COMFY_SHOTPIPE=contract-v26 apps/comfy-app/setup.sh   # symlinks the seven packs from shared/nodes/{portable,bound}/ into ComfyUI/custom_nodes/
  ```
  Verified 2026-10-19: the set links, every pack imports, and every `BH_*`/`BH26_*` node type the 14 graphs use resolves (24 types, 0 missing).
- [ ] Restart the Mac ComfyUI and confirm the nodes show in the UI:
  ```bash
  export COMFY_LOCAL_URL=http://127.0.0.1:8188
  comfy --json nodes search "BH26_ObjectSolve"
  ```
- [ ] Check the pack's own requirements against the venv. `shared/nodes/README.md` lists them; the project's `containers/runpod/requirements-bh.txt` is the full Linux list.

The nine stereo workflows already saved in the install use BincStereo, which is
always linked. They need none of this and open today.

## Route A: load graphs into the ComfyUI Workflows panel

Use the project's own loader. It posts the newest UI graph per shot to
ComfyUI's user-data store under a `CANALV2_corrosion` folder and never queues
anything.

- [ ] The script hardcodes the Linux root. Run it with the Mac path, either by editing `ROOT` in a copy or by passing the root if a later version accepts one:
  `projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_load-graphs_v002.py`, `ROOT = "/home/binc/CANALV2_r3/CANALV2"`
- [ ] Dry run first. `--list` sends nothing:
  ```bash
  python3 projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_load-graphs_v002.py --list --comfy http://127.0.0.1:8188
  ```
- [ ] Then the real load, optionally one shot at a time with `--shots 058,110`, and `--forks` to include review forks.
- [ ] Manual fallback: copy the UI JSONs into `apps/comfy-app/workflows/CANALV2_corrosion/` (served to the UI through the symlink), or drag one onto the canvas.

## Route B: queue graphs for rendering

Only after Route A shows the graphs open cleanly. This renders, which takes
GPU time and writes into each shot's `06_REVIEW/`.

- [ ] Dry run with the list-file form. It checks every graph file exists and sends nothing:
  ```bash
  python3 projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_queue-api_v005.py --list-file <list.txt> --dry-run --comfy http://127.0.0.1:8188
  ```
  The list file has one `shot:version` per line, for example `058:v021`.
- [ ] Confirm the Mac can actually read the plates. `02_SOURCE/SOURCES.csv` in each shot points at `/mnt/storage/Panama_Redux/...`, a binc-PC path. Without the plates mounted at the same path, rendering here is not possible and this route belongs on binc-PC or a RunPod pod.
- [ ] Respect the project rules in `projects/desktop/CANALV2/00_POLICY/agent-permissions.md`: open shots only, proxy first, locked shots are never run.

## Route C: bring graphs into this repo's comfy CLI format

For reuse through the `comfy` CLI. Both commands validate against the running
server's node catalog, so Step 0 must be done first.

- [ ] Inspect the addressable widgets of a graph:
  ```bash
  export COMFY_LOCAL_URL=http://127.0.0.1:8188
  comfy --json workflow slots projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json
  ```
- [ ] Capture it as a recipe, the CLI's preferred reusable form. Lift the per-shot fields (plate folder, prefix, frame range) to params with `--param <node>.<widget>=<name>` once `slots` has shown their addresses:
  ```bash
  mkdir -p recipes
  comfy --json workflow capture projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json \
        --name corrosion-058 -o recipes/corrosion-058.recipe.json
  ```
- [ ] Or, for the legacy fragment and blueprint path this repo's `comfy.yaml` was set up for:
  ```bash
  comfy workflow decompose projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json --name corrosion-058
  ```
  That writes `fragments/corrosion-058.json`; a blueprint in `blueprints/` then composes it.
- [ ] Start with one shot. The fourteen corrosion graphs share a pipeline from the same builder, so one good recipe with shot fields as params should cover them. Check that against `projects/desktop/CANALV2/02_SCRIPTS/graph-builder/build_v25_shot_graphs_v001.py` before capturing all fourteen.
- [ ] Do not hand-edit the captured JSON. Edit source and recapture.

## RunPod: the plan, and that none of it has run

Status 2026-10-19: **not started.** The RunPod account has no pods
(`./start.sh pod list`), no image has been pushed, no plate has left binc-PC.
Everything under `docs/SETUP.md`, `docs/ADR-001` and `apps/runpod-*` is
tooling for a step that has not been taken.

The plan is Binc's, not ours, and lives in the ignored tree at
`projects/desktop/CANALV2/02_SCRIPTS/containers/runpod/README.md`. In short:

- **GPU pod for batch rendering.** A pod from RunPod's ComfyUI template with a
  network volume mounted so `/home/binc/CANALV2_r3/CANALV2` resolves inside the
  container. Node packs copied on once (`comfy-pod/setup_on_volume.sh`), then
  the existing queue script pointed at the pod URL. Graphs read DPX plates and
  write review folders exactly as on binc-PC.
- **CPU pod for camera solves.** Blender's libmv solver needs no GPU; the
  `solve/` image runs on a cheap CPU pod with the same volume.
- **Serverless ruled out for now.** It returns images per request, which suits
  single graphs, not 500-frame sequences.
- **Pod management through RunPod's hosted MCP** (`claude mcp add … https://mcp.getrunpod.io/`),
  not through anything in this repo.

Where this repo differs: `apps/comfy-app/Dockerfile` is a custom image with
the same pins as the Mac, where the plan uses RunPod's stock image plus a
setup script on the volume. Either works; the custom image is the one that
reproduces the Mac. Our pool manager, MCP server and pod-manager API are
redundant with the hosted MCP for this job.

Gates, each needing Binc's named yes (also in `~/Workspaces/TODO.md`, item 5):
installing the RunPod MCP, uploading client plates to a network volume, pushing
an image with the packs to a registry (name and account), and any spend, inside
the USD 100 cap from the 2026-10-09 decisions, with the pod stopped when its
job ends.

## Open decisions

- Which ShotPipe version, or several side by side, in the Mac install.
- Whether rendering happens here at all, given the plates live on binc-PC. RunPod is the planned overflow; see the section above.
- Whether the captured recipes belong in this repo or in `CANALV2/02_SCRIPTS/` beside the graph builders. The project's policy says the tree is "one place for everything".

## Also pending in this repo

- ~~Ask Binc whether `ComfyUI-BincStereo` may stay tracked in this repo.~~ Lucas, 2026-10-19: Binc's material may be used and copied in this private repo; it stays. It now lives in the `shared/nodes` submodule (`comfy-node-packs`) with the ShotPipe versions; its `pyproject.toml` marks it proprietary to Cinematic Immunity / Bincos.
- Push the RunPod image once Binc has agreed (registry name and account). Dockerfile and build are in `apps/comfy-app/`; see its README, "Targets and what is still open".
- Rebuild the Electron app under `apps/runpod-dashboard/` so its bundled copy of `mcp_server.py` picks up the mcp 2.x port.
- Run the review on `feature/desktop-app-and-mcp-fixes` against develop, then delete that branch.
