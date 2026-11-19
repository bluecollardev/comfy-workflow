# ADR-005: The pod manager is a TypeScript core inside Electron, not a server

**Date:** 2026-10-19
**Status:** Accepted; implemented 2026-10-21 (branch `feature/registry-and-volume`): the Python tree is deleted, the Electron shell starts no backend, the MCP server and the CLI are Node over the core, the gate is the core suite plus the browser suite.
**Owner:** Lucas (Blue Collar Dev)
**Supersedes:** the "Python SDK + MCP server" half of ADR-003 for the pod manager. ADR-003's case against Terraform stands.

## Context

The pod manager is a FastAPI backend (`apps/runpod-api`, 13 modules, about
3,000 lines, 50 tests) that the Vue dashboard calls over HTTP. It is also what
the Electron app (`apps/runpod-dashboard`) runs: the main process looks for a
Python on the PC, in a venv under the config folder, then the repo, then the
path, spawns `pod_manager_api.py`, waits for `/health`, and loads the UI from
port 8000. `start.sh pods` does the same dance for the browser mode, including
clearing a stale server from its port.

Two things changed on 2026-10-19 that make this the wrong shape:

- The app now runs on **one PC per user**, and on each PC the user maps their
  own folders (ADR-004, `docs/MOUNT-POINTS.md`). "Install the app" therefore
  means "install Python 3.12, make a venv, pip install, then the app". Lucas:
  packaging for Electron, and "it's kind of annoying to have to boot a separate
  server".
- Nothing in the backend needs Python. It imports no ComfyUI, no numpy. It is
  file and path logic (mounts, governance, idle registry), HTTP against RunPod's
  GraphQL and REST APIs (six calls through the SDK plus the pool manager's own
  GraphQL), HTTP against registries and GitHub, and an MCP server, for which an
  official TypeScript SDK exists.

Python stays where Python belongs: ComfyUI, the node packs, Binc's scripts and
the queue tooling run on the render machine and have nothing to do with the
manager.

## Decision

1. **One core library in TypeScript, with no HTTP in it:** `apps/runpod-dashboard/libs/core`, inside the app (Lucas, 2026-10-19: one app, run locally, in Electron).
   Mounts, GPUs, governance, idle, pods against RunPod, images, git accounts.
   Pure functions over the same JSON files in the same formats
   (`~/.config/runpod-pod-manager/mounts.json`, `idle.json`), so nothing
   migrates. The tests live here (Vitest) and never drop below the Python
   coverage while the port runs.
2. **Electron calls the core over IPC.** The main process imports the core and
   exposes it through the preload bridge. The Vue app's `api/*.js` modules keep
   their names and call `window.api.*` when the bridge is present. Opening the
   app is the whole start: no port, no server, no daemon, nothing to clear.
3. **HTTP is an optional adapter** over the same core, for `npm run dev`
   against hot reload and for anyone who wants the dashboard in a browser tab.
   It is the one case that still needs a process, and it is opt in.
4. **The MCP server imports the core** and runs over stdio, which Claude Code
   starts and stops itself. The governance instructions, resources and the
   spend gate port one to one through the official TypeScript MCP SDK.
5. **The CLI imports the core** too, so `start.sh pod create` and
   `start.sh sync` stop needing a running API.
6. **Order:** the pure modules first (mounts, gpus, governance, idle); pods
   against RunPod's API second; Electron IPC third; the HTTP adapter and the
   MCP server after that; then Electron drops the Python lookup, the Python
   tree is retired, and the merge gate and the branching rule stop naming
   pytest. The Python keeps running until each module has parity.

## Consequences

- The idle watch is the one thing that wants to stay alive. It runs while the
  app is open, and the MCP server sweeps while a session is up. A pod created
  and then the app closed is not watched; the pod card says so.
- Two code paths cannot drift, because the CLI, the MCP server, Electron and
  the browser adapter share one core.
- Electron packaging carries no interpreter. The config folder, the governance
  copy and the mount-points shape travel as data, as they do today.
- RunPod's SDK is replaced by direct calls to the same GraphQL mutations it
  wraps, which is where the care in step 2 goes.

## Alternatives considered

- **Bundle Python into the app** (PyInstaller or a vendored CPython). Removes
  the install step, keeps the server, the port and the daemon dance, and adds
  a hundred megabytes and a platform build matrix. Rejected: it solves the
  smaller of the two problems.
- **Keep FastAPI and only move Electron to spawn it better.** Rejected for the
  same reason: the process is the annoyance, not how it is spawned.

## Amendment 2026-11-19: the gate is enforced at release, and it is the whole gate
Lucas: "make sure our testing gate is enabled ... make sure you are running the full gate of tests before releasing new version of the app." Until now the gate was a habit: `./start.sh test` ran only the core, IPC, browser and Electron suites (not the MCP or unit tests), nothing recorded that it had passed, and `./start.sh release` did not look. Several v1.5.x patches shipped on targeted runs. Now:
- **`./start.sh test` is the whole gate:** core (vitest), MCP, IPC table, unit (`dpx:test`), the full browser suite and the real app in no-spend mode (the Electron suite). Stop the app first. On a full pass it records `.gate/last-pass.json` (the time, HEAD, the suites, and a fingerprint of the code the tests exercise: `apps/runpod-dashboard`, `start.sh`, `scripts`, minus what a release itself changes: `package.json`, `package-lock.json`, `build/build-info.json`). On any failure it records nothing and exits 1.
- **`./start.sh release` checks the record first** (`scripts/gate.mjs check`): it refuses unless a pass exists, is not older than 24 hours, and matches the current code exactly. Changing code after the gate invalidates it; changing docs or the changelog does not. `--dry-run` only reports the gate.
- **The one way round is explicit and on the record:** `./start.sh release patch --skip-gate "Lucas: no tests for this patch"` writes the reason to `.gate/skips.log` and prints a warning; a skip is also stated in the CHANGELOG entry. Nobody (and no agent) skips without a person saying so for that release.
- **Tests of the gate itself:** `scripts/gate.test.mjs` (a pass for the same code, through a version bump, invalidated by changed, added or removed code, ignoring docs, the age limit, skips need a reason).

