# Next steps and goals

## Goals, in order

1. **Run Binc's graphs where the compute is**, the same way everywhere: binc-PC
   first, the Mac for stereo, a Linux box under Docker, RunPod as overflow
   (`README.md`, "What this repo is for"; `docs/ADR-004`). Measure: a corrosion
   graph renders unchanged on each of those.
2. **RunPod as a disposable worker, never a bill nobody planned**: one app per
   PC, our image, a network volume with the three folders, the cheapest card
   in stock, idle stop, recreate instead of wait. Proven on 2026-10-19 with the
   stock image; the remaining steps are below.
3. **The crew of skills**, Binc's goal: a dispatcher over `queue/<project>/`
   that runs one job per session as the operator brief says, reports, and
   stops. Not started.
4. **One codebase, no second runtime**: the Python API retired, the core in
   TypeScript, the merge gate green (`docs/ADR-005`).

## Next steps: importing the CANALV2 graphs

Open work only, as of the evening of 2026-10-19. Done items are in
[`CHANGELOG.md`](./CHANGELOG.md). The inventory behind this is in
[`projects/README.md`](./projects/README.md), section "Where the ComfyUI prompts
and graphs are".

**Where things stand:** the stereo workflows run on this Mac on MPS. The
corrosion graphs do not, because the plates are not on this machine; the packs
are linked and the paths are mapped. Blender is the solve step before a graph,
not a requirement to run one. Decision record:
`docs/ADR-004-where-the-workflows-run.md`.

## The main thing to solve next: run the graphs from any machine

The GPU is the easy part. In order:

- [ ] **Plates on this Mac.** The three folders are mapped in the dashboard's Configuration panel and every runtime follows the mapping (`docs/MOUNT-POINTS.md`); what is missing is the plates folder itself, over SMB from binc-PC or the NAS (Binc's note has a Mac Studio on SMB already). Until then the Mac can open the corrosion graphs but not render them.
- [ ] **A ComfyUI-Shared of our own on this Mac.** The saved mapping still points ComfyUI-Shared at the mirror; in dev mode the launcher substitutes `~/ComfyUI-Shared` (it did on 2026-10-19 and ComfyUI ran). Map that folder in the panel so the substitution is not needed.
- [ ] **binc-PC as the first container node.** Build `comfy-app:v26` on a Linux box (`apps/comfy-app/build.sh`; the Mac would emulate amd64), then `apps/comfy-app/docker/swarm.sh up` for one box or `init` + `deploy` for a Swarm. The Mac's browser then uses `http://binc-pc:8188` like the local one.
- [ ] **Drive it from the Mac.** `comfy` CLI and the queue scripts take `--comfy <url>`; the stereo work stays local on MPS.
- [ ] **RunPod as overflow.** The tooling is ready; the steps left are in "RunPod: what is left" below.
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

## Step 0: the node pack, what is still open

The graphs are built from the `BH_*` nodes in ComfyUI-BH-ShotPipe, and the v26
graphs need `BH26_*` nodes. All versions, v6–v26, plus BincStereo are in the
`shared/nodes` submodule (`bluecollardev/comfy-node-packs`); nothing is read
from Binc's mirror at install time any more. `docs/NODE-PACKS.md` has the
versioning and release steps.

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

## RunPod: what is left

Status 2026-10-20 morning: the image is pushed, the volume exists, the
Configuration panel points at both; no plate has left binc-PC. The tooling for all of it is
in the repo and tested; what remains is a sequence of real steps, each of
which spends or moves client material and so waits on a named yes.

Binc's plan is the reference (`projects/desktop/CANALV2/02_SCRIPTS/containers/runpod/README.md`):
a GPU pod with a network volume for batch rendering, a CPU pod for Blender
solves, serverless ruled out for frame sequences, pods stopped when a job ends.

In order:

1. [x] **RunPod proven** (2026-10-19 evening, USD 35 of credit): `./start.sh e2e-live` created a stock-image pod on the cheapest card in stock, saw it running, stopped and deleted it in 3.6 minutes. Rerun it any time; it leaves nothing behind.
2. [ ] **Binc's yeses**, named, before anything below runs (`shared/governance/policy/agent-permissions.md`; `~/Workspaces/TODO.md` item 5): plates copied to a network volume; an image with the packs pushed to a registry (name and account); the spend, inside the USD 100 cap. The MCP server already refuses `create_agent` without `approved_by`.
3. [x] **Push the image** (2026-10-20 morning). `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`, a private GitLab project of Lucas's holding only the registry; RunPod pulls with a read-only deploy token saved on the account as credential `gitlab-comfy-workflow`, whose id is in the Configuration panel under the image. Rebuild and push: `./start.sh comfy-image --push registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`.
4. [x] **The network volume** `comfy-workspace` (`q8lf6riygr`), 120 GB in `CA-MTL-1` (the datacenter with the cheapest 24 GB card, the A5000 at USD 0.16/h, and the A40 in high stock behind it), about USD 8.40 a month. Entered in the Configuration panel; a volume can grow later, never shrink.
5. [ ] **Put the data on the volume**: three rsync attempts into a running pod died with the pod on 2026-10-20 (22 files landed); the decision in `docs/ADR-007` (likely a volume in Romania pushed over RunPod's S3 API, `./start.sh sync --s3`, no pod needed) comes first: `./start.sh sync --pod <id>` into a pod with the volume attached (needs the image with sshd, built 2026-10-20 afternoon; recreate the pod from it first) (the project tree is 81 GB, 66 of it corrosion shot renders; ComfyUI-Shared 17 GB); `--plates --approved-by <name>` for the plates, which are still unmapped on this Mac. Set `COMFY_MODE=prod` on the machine that drives real pods so every folder is required.
6. [~] **Boot one pod** with mounts applied: done 2026-10-20 (`ComfyUI-Dev`, A40, Montreal; nine workflows listed from the volume). Still to do on it: read the entrypoint's `linked …` lines after the sync, open a corrosion graph in its UI, queue one open shot at proxy with the queue script and `--comfy <pod url>`. Locked shots are never run; proxy first.
7. [ ] **CPU solve pod**, after the GPU pod works: `solve/` image from Binc's plan, same volume.

## Open decisions

- Importing delivery packages (the Brynley/Binc round in `projects/test`) onto a pod without changing their layout: what "run" means (open and inspect, or real provider calls with spend and Kyle's go-ahead), and whether it is one package or many (layouts versus a one-off). Read, layout and design in `docs/DELIVERY-PACKAGES.md`; the fal node pack the graphs need is missing from the package and from our image. Designed 2026-10-24 as import adapters (hot-loaded `.mjs` that plan a mapping onto ComfyUI-Shared, an Anthropic-key setting for in-app writing): `docs/ADR-008-import-adapters.md`, spec `docs/IMPORT-ADAPTERS.md`; nothing built, open points in the ADR.
- How local state and the pod's volume stay in line: Pull, the sync in the app, pushing less, a CPU sync pod, a bucket as the hub, or RunPod's S3 API onto a volume in a supported datacenter (no pod needed; Montreal is not supported, Romania is the safe pick). Options and a recommendation in `docs/ADR-007`; no decision yet (2026-10-21).
- Which ShotPipe version, or several side by side, in the Mac install.
- Whether rendering happens here at all, given the plates live on binc-PC. RunPod is the planned overflow; see the section above.
- Whether the captured recipes belong in this repo or in `CANALV2/02_SCRIPTS/` beside the graph builders. The project's policy says the tree is "one place for everything".

## Also pending in this repo

- ComfyUI's own log on the stock image goes to `/workspace/logs/comfyui.log`, not the container's stdout, so the app's Logs modal shows the host's lines but not ComfyUI's there. Our image logs to stdout. A tail of that file over SSH would close the gap for the stock image.
- Rebuild the installers (`./start.sh package`) now that the port is complete; the Windows build on the Windows machine.
- The Bash-side governance hooks listed as open in `shared/governance/README.md`: installs, `./start.sh pod create`, pushes to other remotes.
- Abstract versus concrete shapes, and the two findings from `check.py` to raise with Binc (above).
- Run the review on `feature/desktop-app-and-mcp-fixes` against develop, then delete that branch.
