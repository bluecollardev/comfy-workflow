# Every script we run

One page for every script and command this repo runs or ships: what it does, where it runs, what it reads and writes, and whether it spends money or touches anything outside this PC.
Each script also carries its own header comment; this page is the map. Add a row here when you add a script.

**Legend.** *Runs on:* Mac (this PC), pod (inside the ComfyUI container on RunPod), CI (GitHub Actions). *Spends:* RunPod money (pods, volume storage) or CI minutes.
*Leaves the PC:* sends files or keys to another machine. Anything that spends needs a named yes (`shared/governance/policy/agent-permissions.md`, USD 100 cap).

## 1. The one entry point: `./start.sh <target>`

`start.sh` installs what a target needs on its first run (`npm install`, the core build, the UI build) and then runs the thing below. `./start.sh` with no argument lists the targets. Every target is also an IntelliJ run configuration (`.run/`) and a VS Code task (`.vscode/`).

| Target | Runs | Runs on | Spends / leaves the PC |
|---|---|---|---|
| `comfy` | `apps/comfy-app/launch.sh` (after `setup.sh` on a first run): ComfyUI at http://127.0.0.1:8188 | Mac | no |
| `desktop` | the Electron pod manager with the built UI | Mac | only when you create or sync (below) |
| `dashboard` | the same with hot reload (Vite inside the window); also serves the two MCP endpoints on 127.0.0.1:8765 and :8766 | Mac | as above |
| `pod <args>` | `cli/index.mjs pod ...`: create, list, status, stop, resume, delete | Mac to RunPod | **create spends** |
| `sync --pod <id>` / `--s3` | the CLI's sync: the mapped folders onto the volume, never deleting; `--s3` through RunPod's S3 API with no pod | Mac to RunPod | **leaves the PC**; `--plates` needs a named yes |
| `pull --pod <id>` / `--s3` | renders back down (`comfy-shared/output`, the shots' review and deliver folders) | RunPod to Mac | no |
| `import <folder> [--adapter ID] [--dry-run]` | a package folder into ComfyUI-Shared through an adapter (ADR-008) | Mac | no; writes only into ComfyUI-Shared |
| `config export [file]` / `import <file> [--sections a,b] [--dry-run]` / `undo` | `cli/index.mjs config ...`: the Default Configuration as a JSON file with no keys in it; import previews every section and writes the ticked ones after a backup (ADR-023) | Mac | no; writes `mounts.json`, and the exchange-bucket fields in the settings file |
| `mcp` | `mcp/server.mjs` over stdio, the pod manager for Claude Code | Mac | tools that spend need `approved_by` |
| `test` | the merge gate: core suite, IPC table, browser suite, the app in no-spend mode | Mac | no |
| `core-test`, `e2e`, `e2e-app`, `smoke` | the parts of the gate on their own; `smoke` boots the app headless | Mac | no |
| `e2e-live` | the live RunPod proof: creates a stock-image pod, sees it run, stops and deletes it | Mac to RunPod | **spends** (about 4 minutes of a pod) |
| `comfy-image [--remote --wait] [--push <ref>]` | `apps/comfy-app/build.sh` | Mac or CI | `--remote` uses CI minutes; `--push` uploads the image |
| `package [mac|win|linux|all] [--comfy <variant>] [--image <ref>]` | electron-builder for the installers | Mac | no |
| `release patch|minor|major|X.Y.Z [--dry-run] [--no-publish]` | `scripts/release.sh` | Mac | **publishes** to the downloads repo |
| `stop` | stops ComfyUI wherever it was started (`apps/comfy-app/stop.sh`) | Mac | no |

## 2. ComfyUI on the Mac (`apps/comfy-app/`)

| Script | What it does |
|---|---|
| `setup.sh` | Idempotent. Clones ComfyUI at the pinned commit (`pins.env`), builds the `uv` venv on Python 3.13, links our node packs from `shared/nodes` (`COMFY_SHOTPIPE=contract-v26` picks the ShotPipe set) and the workflows folder. Re-run after a pull. |
| `launch.sh [--background] [-- <main.py args>]` | Starts the server. The three folders come from `mounts-env.sh`; ComfyUI gets `COMFY_SHARED`'s `input/` and `output/` and its `models/` through a model-paths file written at every start. Logs to `logs/comfyui.log` with `--background`. |
| `stop.sh` | Stops a server started with `--background`. |
| `mounts-env.sh` | Sourced, not run. Sets `PROJECT_ROOT`, `PLATES_ROOT`, `COMFY_SHARED` from the environment, else the app's saved mapping, else defaults. A mapping inside the read-only mirror is replaced by `~/ComfyUI-Shared` in dev mode and refused in prod (`COMFY_MODE`). |
| `fetch-models.sh` | Downloads the weights in `models.txt` into `COMFY_SHARED/models/`; skips what is there. `HF_TOKEN` for gated repos. **Leaves the PC** (downloads only). |
| `check.sh [--diff]` | Reports how `ComfyUI/` differs from upstream at the pin and what we added. Exit 1 when the core is not at the pin or has edits. |
| `build.sh` | Builds the ComfyUI image (CUDA, linux/amd64). Local by default; `--push <ref>` tags and pushes; `--remote [--wait]` pushes an `image/<variant>-<time>` branch and GitHub Actions builds and pushes to `ghcr.io` (ADR-020); `--shotpipe`, `--tag`, `--base`, `--no-shotpipe` as the header lists. The image carries Binc's packs: pushing it needs his named yes. |

## 3. Inside the container and the CI

| Script | Runs on | What it does |
|---|---|---|
| `apps/comfy-app/docker/entrypoint.sh` | pod | The image's entry point. Makes the shared folders, seeds `workflows/` while empty, links binc-PC's paths onto the volume (`COMFY_LINKS`), starts `sshd` from `PUBLIC_KEY`, starts `s3pull.sh` in the background when `S3_PULL` is set, then starts ComfyUI. |
| `apps/comfy-app/docker/s3pull.sh` | pod | Pulls `bucket/prefix=/workspace/dir` pairs from S3 onto the volume with `rclone copy --checksum` (additive; destinations only under `/workspace`), then runs `verify_round.py` and leaves `.s3-pull.done`, `.s3-pull.failed` or `.s3-pull.unverified` in the folder. Env: `S3_PULL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_ENDPOINT`, `S3_PROVIDER`. Also run over SSH on a pod that is already up (ADR-022). **Leaves the PC's control**: copies bucket data onto RunPod's volume. See `POD-PULLS-FROM-S3.md`. |
| `apps/comfy-app/docker/verify_round.py` | pod | Checks a pulled round against its `MANIFEST.json` files (size and sha256). Exit 0 match, 1 mismatch, 2 no file list. The pod-side twin of the app's check (`libs/core/src/panama.ts`) and of BH's own. |
| `apps/comfy-app/docker/swarm.sh up|init|join|deploy|status|logs|down` | Linux box | Runs the image with Compose on one NVIDIA box or as a Swarm (`compose.yml`, `compose.gpu.yml`). Not for macOS. |
| `.github/workflows/comfy-image.yml` | CI | Builds the image with `build.sh --push` on an amd64 runner and pushes to `ghcr.io/bluecollardev/comfy-app:<variant>`. Reads the private `shared/nodes` submodule with the read-only deploy key `NODES_DEPLOY_KEY`. Triggered by a push to `image/**` (what `build.sh --remote` does) or by hand. **CI minutes.** |

## 4. The app's own programs (`apps/runpod-dashboard/`)

| Program | What it is |
|---|---|
| `cli/index.mjs` | The command line over the core: `pod`, `sync`, `pull`, `import`, `config`. `POD_MANAGER_CORE` points it at a core built elsewhere (tests). Only wiring; the plans and the rsync / AWS CLI commands it runs are built and tested in `libs/core/src/sync.ts`. `npm run cli -- <args>`. |
| `mcp/server.mjs` | The pod manager MCP server (stdio; `--http <port>` serves it on 127.0.0.1). Pods, volumes, configuration, sync, cost, governance. Bundled to `mcp/dist/server.cjs` by `npm run mcp:bundle`: **rebuild the bundle after changing the core, and restart any client that loaded the old one**. |
| `mcp/comfy-bridge.mjs` | The ComfyUI bridge MCP: works inside the ComfyUI of a pod (workflows, nodes, queue, history). Never creates, stops or bills a pod. `--comfy <url>` or `COMFY_URL`. |
| `mcp/transport.mjs` | The Streamable HTTP transport both MCP servers share. |
| `libs/core/runtime/adapter-runner.mjs` | The child process an import adapter runs in, under Node's permission model (read-only on the source folder). Prints one JSON line; writes nothing. |
| `libs/core/runtime/adapters/*.mjs` | The built-in import adapters (`panama-imax-redux`, `comfy-shared`). Yours live in `~/.config/runpod-pod-manager/adapters/`. |
| `libs/core/mark-esm.mjs` | Build step: marks `libs/core/dist` as ESM and copies the runtime and the adapter spec beside it. |
| `electron/make-icon.mjs` | Renders `build/icon.png` for the installers (`npm run icon`). |

**npm scripts** (`apps/runpod-dashboard/package.json`): `dev`, `build` (core build, MCP bundle, Vite), `core:build`, `core:test`, `mcp:bundle`, `mcp:test`, `ipc:test`, `test` (core, MCP and IPC), `test:e2e` (browser suite), `test:electron` (the app in no-spend mode),
`test:live` (**spends**), `electron:dev`, `electron:build[:mac|:win|:linux]`, `electron:pack`, `cli`, `mcp`, `mcp:bridge`.

**Commands the app runs for you** (built as data in `libs/core/src/`, so they are tested without a network):

| Command | From | For |
|---|---|---|
| `rsync -rlt ... -e ssh` into the pod | `sync.ts`, `syncrun.ts` | Sync and Pull while a pod runs. Additive, never `--delete`; excludes `temp/` on a push (ADR-021). |
| `aws s3 cp --recursive --endpoint-url https://s3api-<dc>.runpod.io` | `sync.ts` | Sync with no pod, in datacenters RunPod's S3 API serves. |
| `aws s3 ls`, `aws s3 sync s3://<bucket>/rounds/<round>/ <temp/rounds/round>` | `panama.ts` | The BH library: list rounds, size one, download one (resumable, read-only against the bucket). The keys are passed in the environment, never the command line. |
| `python3 verify_round.py`-equivalent in TypeScript | `panama.ts` `verify` | The manifest check after a download. |
| `rm -r` of one `temp/rounds/<round>` | `panama.ts` `remove` | Delete from this computer; refuses anything not directly inside the staging folder. |

## 5. Release and documentation

| Script | What it does |
|---|---|
| `scripts/release.sh` | Bumps the version, builds the Mac DMG, tags the commit and publishes the DMG as a GitHub Release on the downloads repo. Needs a clean tree on `develop` or `master`. **Publishes.** `docs/RELEASING.md`. |
| `scripts/docs-site.mjs <outDir>` | Builds the public documentation site from the README's Documentation section (ADR-014). Docs that name the client job or the BH bucket are left out by its `EXCLUDE` list: add new ones there. `./start.sh release docs` publishes it. |

## 6. Binc's material and the rules for agents

| Script | What it does |
|---|---|
| `.claude/hooks/protect-binc-tree.sh` | PreToolUse hook: refuses Claude's Edit, Write and NotebookEdit under `projects/desktop/` (Binc's mirror). Exit 2 blocks the call. It does not stop shell commands or the app. |
| `shared/governance/sync.sh` | Copies Binc's policy pages from the mirror into `shared/governance/` (one-way, `MANIFEST.md` records it). Never writes into the mirror. |
| `shared/sync-nodes.sh` | Refreshes the `shared/nodes` submodule from the mirror. Never deletes a pack; release steps in `NODE-PACKS.md`. |
| `queue/sync.sh [<name> <dir>]` | Seeds `queue/<project>/in/` from a project's own queue folder, one-way and additive. |
| `shared/shapes/check.py project|shot|job|name|pack <arg>` | Read-only checks of real folders, job files and names against the shapes in `shared/shapes/`. Exit 1 when something required is missing. |

## 7. Older or one-off

| Script | Status |
|---|---|
| `infra/setup-team.sh` | A first-day setup script from the Python era (installs Python tooling, writes a `.env` template). The pod manager is one Node app now, so most of it is switched off (`if false`); prefer `./start.sh`. Not exercised in this session. |

## Outside this repo

`~/Workspaces/ai-tooling/` (`setup.sh`, `check.sh`) rebuilds the AI tooling on this Mac (OpenClaw, the Chrome DevTools MCP, the TODO hook); see its own README. The BH side has its own scripts (`build-brynley-comfy-delivery.py`, `migration/s3_rounds.py`, `verify_round.py`),
described in `docs/ADR-016-bh-library-in-import-shot-pack.md`; we read what they publish and run none of them.
