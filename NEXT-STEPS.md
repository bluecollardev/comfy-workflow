# Next steps: importing the CANALV2 graphs

Status as of 2026-10-17; paths updated 2026-10-19 when the trees moved under `projects/desktop/` and the ComfyUI install became `apps/comfy-app/`. The inventory behind this is in
[`projects/README.md`](./projects/README.md), section "Where the ComfyUI prompts
and graphs are". Nothing below has been run yet.

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

## Step 0: install the node pack (blocks everything else)

The graphs are built from the `BH_*` nodes in ComfyUI-BH-ShotPipe, and the v26
graphs need `BH26_*` nodes. The Mac install only has ComfyUI-BincStereo, so
every route below fails or opens with missing nodes until a pack is present.

- [ ] Decide which ShotPipe version to install. `v26` covers the newest graphs; older shot graphs need the matching older pack. Versions sit side by side in `projects/desktop/CANALV2/02_SCRIPTS/nodes/`.
- [ ] Symlink it, do not copy, so the master copy stays the one in `02_SCRIPTS/nodes/`:
  ```bash
  COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh   # links it into ComfyUI/custom_nodes/
  ```
- [ ] Restart the Mac ComfyUI and confirm the nodes load:
  ```bash
  export COMFY_LOCAL_URL=http://127.0.0.1:8188
  comfy --json nodes search "BH_ReadSequence"
  comfy --json nodes search "BH26_ObjectSolve"
  ```
- [ ] Check the pack's own requirements against the standalone env. `02_SCRIPTS/containers/runpod/requirements-bh.txt` lists what the pack needs on Linux.

The nine stereo workflows already saved in the install use BincStereo, which is
installed. They need none of this and open today.

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

## Open decisions

- Which ShotPipe version, or several side by side, in the Mac install.
- Whether rendering happens here at all, given the plates live on binc-PC. The RunPod route in `projects/desktop/CANALV2/02_SCRIPTS/containers/runpod/README.md` is the project's planned answer for compute beyond that machine, and it ties into `infra/` in this repo.
- Whether the captured recipes belong in this repo or in `CANALV2/02_SCRIPTS/` beside the graph builders. The project's policy says the tree is "one place for everything".

## Also pending in this repo

- Commit `projects/README.md`, `apps/comfy-app/`, `CLAUDE.md`, this file and the `.gitignore` changes.
- Ask Binc whether `ComfyUI-BincStereo` may stay tracked in this repo. Since 2026-10-19 it is in `apps/comfy-app/custom_nodes/` (the repo is private) because the app has to be runnable from a clone; its `pyproject.toml` marks it proprietary to Cinematic Immunity / Bincos. If Binc says no: move it back out of git, and have `setup.sh` unpack `apps/comfy-app/archive/ComfyUI-BincStereo.zip` instead.
- Push the RunPod image once Binc has agreed (registry name and account). Dockerfile and build are in `apps/comfy-app/`; see its README, "Targets and what is still open".
- Rebuild the Electron app under `apps/runpod-dashboard/` so its bundled copy of `mcp_server.py` picks up the mcp 2.x port.
- Run the review on `feature/desktop-app-and-mcp-fixes` against develop, then delete that branch.
