# Changelog

What is done, by day, newest first. Open work is in [`NEXT-STEPS.md`](./NEXT-STEPS.md);
completed items move here. Commit hashes are on `develop`.

## 2026-10-19

### The app boots on its own; the Python API deprecated; feature tests; packaging for three platforms (branch `feature/deprecate-python-api-and-feature-tests`)
- The Electron app loads the page from its own files (Vite base `./`) and runs the core in-process, so it starts without Python: proven by a smoke boot with the backend stopped and `RUNPOD_MANAGER_NO_BACKEND=1` (`url=file://…`, `backend=none`, the core answered over IPC). When a Python is found, the deprecated backend is still started for git accounts, repositories, image env and OAuth and the page is served from it so the OAuth round-trip lands home.
- `apps/runpod-api` is marked deprecated in its README and the project guide: nothing new goes there; it is deleted when those four parts are ported.
- Eleven Playwright specs for the day's features: the Configuration panel (pod volume first, the three folders with pod paths and variables, the required switches in dev, the folder picker browsing a fake disk, save with its toast and close and the PUT body, what a tree declares shown without a machine path, custom folders, a failed save, clear), the GPU menu and image choices in the form, the idle stop on a running card, and a toast per pod action. 46 pass. The fake API now answers PUT and DELETE for the configuration and the folder browser.
- Packaging: `./start.sh package [mac|win|linux|all] [--comfy <variant>] [--image <ref>]` builds installers (dmg and zip; nsis and portable, a stub to run on the Windows machine; AppImage and deb) into `dist-electron/<variant>/`, with `build-info.json` baked in naming the comfy-app variant and the image a new pod boots by default; the main process applies it. Unpacked mac build verified to carry the core, the shape and the governance copy.
- `start.sh` gained `e2e`, `core-test`, `smoke`, `comfy-image` and `package`; 14 IntelliJ run configurations in `.run/` cover the gate, the core suite, e2e headless and headed, the smoke boot, packaging per platform and per variant, the MCP server, a dry-run sync, the image build and stop.

### Pinia state management, e2e green, ADR-005 (branch `feature/ts-core`)
- The dashboard's state is in Pinia stores: `pods` (the list, the stats, every action, the auto-refresh), `mounts` (the configuration as the API reports it, the summary, the configured image and idle default), `ui` (which modal is open) and `toast`. Components stopped passing the list down as props and refetching it themselves; Stats, Dashboard, PodForm and ConfigModal read and act through the stores. One place for the IPC bridge of ADR-005 to plug into.
- The Playwright suite was run before the port: it caught that `toast.run` read void actions as failures, so lists never refreshed after a delete, remove or create. Fixed; the specs follow the new pod defaults and the toasts; the fake API serves the mount configuration and the GPU menu. 35 pass.
- `docs/ADR-005-typescript-core-no-server.md` and `docs/reports/2026-10-19.md`.
- The TypeScript core lives in the app at `apps/runpod-dashboard/libs/core` (Lucas: one app, run locally, in Electron): mounts, gpus, governance, idle, the folder browser, and pods against RunPod's GraphQL API with the same mutations and fields the Python SDK used. Same file formats and derivations as the Python. 22 Vitest tests mirror the pytest ones, including reading the CANALV2 mirror and a faked RunPod. `./start.sh test` runs both suites.
- Electron exposes the core to the page over IPC (`electron/core.cjs`, `electron/preload.cjs`, one `core` channel, a dispatch table): mounts, pods, GPUs, governance, the idle watch running while the app is open. The renderer's `api/pods.js` and `api/mounts.js` route to the bridge when it exists and to HTTP otherwise, so the browser, hot reload and the Playwright suite are unchanged. The smoke boot (`RUNPOD_MANAGER_SMOKE=1`) now calls the core from the page and prints what came back. The Python backend is still started for what is not ported yet: git accounts, repositories, image env, OAuth, the MCP server.

### Pod defaults, idle stop, volume sync, dev mode (branch `feature/runpod-defaults-idle-stop-sync`)
- Pod defaults fixed: the image every pod boots is the one set in Configuration (ours, with the packs; a bare local name is refused until it is pushed), the GPU menu is the 16-24 GB cards from `apps/runpod-api/gpus.py` with RunPod's real ids (the old code passed `rtx4090`, which RunPod does not know), community cloud by default, per-pod volume 0 beside the network volume, no fixed bid. `infra/pod-config.yaml` is one profile.
- Idle stop: `apps/runpod-api/idle.py` probes each watched pod's ComfyUI through RunPod's proxy once a minute and stops it after N quiet minutes (default 30, set in Configuration or per pod). The proxy URLs are RunPod's real ones.
- `infra/scripts/sync_volume.py` (`./start.sh sync --pod <id>`) copies the mapped folders to a pod's network volume over rsync, never deletes, and copies plates only with `--plates --approved-by <name>`.
- Dev mode: `COMFY_MODE` (`dev`, the default, or `prod`). In prod every folder is required; in dev the panel's per-folder switches decide, `COMFY_REQUIRE` overrides, and a ComfyUI-Shared mapped into the mirror is replaced by `~/ComfyUI-Shared` instead of refused. Pod creation and the launcher refuse to run without a required folder.
- Root `CHANGELOG.md` and a `NEXT-STEPS.md` of open work only.

### The Mac launcher follows the folder mapping (`dcc25be`)
- `apps/comfy-app/mounts-env.sh` resolves the project tree, plates and ComfyUI-Shared for anything running ComfyUI on this PC: environment, else the mapping saved by the dashboard, else defaults (`~/ComfyUI-Shared`, created with the shared layout). It refuses a ComfyUI-Shared inside Binc's mirror.
- `launch.sh` writes the model paths file from the mapping at every start; weights live with input and output as on binc-PC and the pod. `fetch-models.sh` downloads into the shared folder and moves weights an earlier run left in the install. The tracked yaml that pointed at the mirror's empty models folder is gone.
- The panel warns when the project tree or ComfyUI-Shared is mapped into the mirror.

### Governance applied to MCP clients, toasts, folder memory (`aaad06a`)
- Every launch of the MCP server reads `shared/governance` and applies it to each client: precedence, agent-permissions and the operator brief as the server instructions at initialize; all 39 pages as `governance://` resources and through the `governance` tool; `create_agent` refuses to spend without `approved_by` and quotes the USD 100 cap. `GET /api/governance` serves the same; the Electron package carries the folder.
- Dashboard: one toast module, top right, that every action reports through (configuration save closes the modal; pod create, stop, resume, delete; repository attach, remove; account disconnect; OAuth return). The folder picker remembers the last folder per row.

### Three folders mapped on this PC, generic names, custom folders (`874f0ff`)
- The configuration holds only the three required folders on this PC (project tree, plates, ComfyUI-Shared), each with a Browse widget backed by `GET /api/fs/dirs`, plus custom folders. No per-machine paths are typed: the paths a project's own files declare (job files' root line, the shots' source lists, the structure page) are read from the mapped tree and linked on a pod.
- Pod paths `/workspace/project`, `/workspace/plates`, `/workspace/comfy-shared`; `CANALV2_ROOT` renamed `PROJECT_ROOT` in the packs (submodule `8b78695`), the launcher, Compose, Swarm and the entrypoint. The plates link that doubled the path is fixed; the Compose `PLATES_ROOT` default matches the packs.

### Mount configuration, applied to every pod (`30f75f8`, `4cb8069`)
- The pod manager and `create_pod.py` attach a network volume and pass `COMFY_LINKS`, which the image's entrypoint turns into symlinks. Defaults from `shared/shapes/mount-points.json`, the scan of the whole project tree (`docs/MOUNT-POINTS.md`, `4d3a86c`).
- Every ShotPipe version reads its machine paths from the environment through `bh_paths.py`; all 20 packs are portable (`packs-2026-10-19h`).

### Node packs in the repo (`2cb148b` … `e3c530c`)
- `shared/nodes` is the `comfy-node-packs` submodule: ShotPipe v6–v26 and BincStereo, split into `portable/` and `bound/`, each pack declaring its dependencies; `setup.sh` and `build.sh` resolve them. `docs/NODE-PACKS.md` has the versioning and release steps.
- ShotPipe sets: the 14 corrosion graphs need `contract-v26` (nodes from v7, v10–v14 and v26 together), not v26 alone. `COMFY_SHOTPIPE=contract-v26 apps/comfy-app/setup.sh` links the seven packs; verified every `BH_*`/`BH26_*` type the graphs use resolves (24 types, 0 missing).
- The node-pack shape is published in the packs repo and checked from here (`bf5bf23`).

### Earlier on 2026-10-19
- Trees moved under `projects/desktop/` and the ComfyUI install became `apps/comfy-app/`; `docs/ADR-004-where-the-workflows-run.md` decided which machine runs what.
- Governance copied into `shared/governance` by `sync.sh`, with the precedence page and the enforcement table.
- Lucas: Binc's material may be used and copied in this private repo; BincStereo stays, in the submodule.
- BincStereo smoke test runs on this Mac on MPS (12 nodes, about a second).
