# ADR-008: Packages come in through adapters; adapters are modules the app hot-loads

**Date:** 2026-10-24
**Status:** Accepted for the build (Lucas asked for it, 2026-10-24; import-locally-then-sync decided the same day). Built on `feature/import-adapters` per `docs/PLAN-IMPORT-ADAPTERS.md`. Open points are at the end.
**Owner:** Lucas (Blue Collar Dev)
**Extends:** ADR-005 (the app on one PC, TypeScript core), ADR-007 (the volume and sync), `docs/MOUNT-POINTS.md`.
**Spec for writers of adapters:** `docs/IMPORT-ADAPTERS.md`.

## Context

Work reaches the machine in more than one shape, and today each shape is imported by
hand. Kyle's delivery package (`docs/DELIVERY-PACKAGES.md`) says to:

> Copy `<shot>/comfy/input/` into your ComfyUI input/ folder, keeping the `shots/<shot>/…`
> folders. Do not rename or flatten. Copy `<shot>/comfy/workflows/*.json` into
> `ComfyUI/user/default/workflows/`. The `_api.json` and `-inputs-manifest.json` files stay
> beside them. Copy each `<shot>/nodes/<pack>-vN/` folder into `ComfyUI/custom_nodes/<pack>/`
> (drop the -vN). Restart ComfyUI.

Binc's CANALV2 is a different shape again (a project tree with `04_GRAPH/` per shot, and a
ComfyUI-Shared beside it, `docs/CANALV2-STRUCTURE.md`). More will come: Kyle's next rounds
(`-rN`), other films built by the same script, other people's packs. Writing one importer
per shape in the app does not scale, and the people who know a new shape are not always
us.

What is fixed is the other end. Whatever comes in, it has to land in the **ComfyUI-Shared
structure** that the app already maps and syncs (`input/`, `models/`, `output/`,
`workflows/`, plus node packs for `custom_nodes/`), because that is what a pod mounts from
the volume (ADR-006, ADR-007). The package itself stays byte-identical: a received package
is never edited (contract §5.2; `.claude/rules/binc-tree.md` for Binc's tree).

## Decision

1. **An import is a mapping from a source folder to the ComfyUI-Shared structure,
   written as an adapter.** The app has one importer; the adapter is the only part that
   knows the source format.
2. **An adapter plans, the app applies.** An adapter is an ES module (`.mjs`) with a fixed
   shape: `detect(root)` says whether it recognises a folder and why; `plan(root, ctx)`
   returns a list of operations (copy, link, merge, verify, note) with source and
   destination. It writes nothing. The app's executor does the writing, inside the
   ComfyUI-Shared root only, never deleting, never overwriting without being told, after a
   dry run the user (or agent) has seen. This is what makes it safe to accept code an AI
   wrote.
3. **Built-in adapters ship with the app:** `comfy-shared` (a folder already in the
   structure), and `panama-imax-redux` (Kyle's delivery packages: `comfy/input` to
   `input/` with `shots/<shot>/` kept; `comfy/workflows` to `workflows/<project>/<round>/`;
   `nodes/<pack>-vN` to the pack folders without `-vN`; every file checked against the
   `MANIFEST.json` sha256 first; `final/`, `approved/`, `provenance/` left where they are
   and recorded as references, not copied). A CANALV2 adapter follows when its mapping is
   settled.
4. **More adapters are loaded at runtime, from a folder.** `~/.config/runpod-pod-manager/adapters/*.mjs`
   is watched. A new or changed file is imported again without a restart (cache-busting
   import), listed in Connect/Import with its source hash, and its errors shown against
   it, not thrown at the app. A user-written adapter must be approved once (its source and
   hash shown) before it runs; a changed file needs approval again.
5. **Adapters run outside the UI process.** In a child process (the app's own executable
   with `ELECTRON_RUN_AS_NODE=1`, as the MCP servers already do) under Node's
   `--permission` with read access to the source folder only (checked, open point 2), handed a read-only
   helper (`ctx`: list, stat, hash, read text/JSON of the source folder), and returning
   only the plan as JSON. The executor validates every path in the plan before acting.
6. **A user's coding agent writes adapters through the app.** The pod-manager MCP server
   gains tools to fetch the spec and the target structure, validate and save an adapter,
   dry-run it against a folder, and run an import; the CLI gets `./start.sh import
   <folder> [--adapter <id>] [--dry-run]`. An agent on any machine reads
   `docs/IMPORT-ADAPTERS.md` (the same text the tool returns), writes the `.mjs`, and
   tests it on a real folder before the user approves it.
7. **A setting for the Claude key.** Settings gets an optional Anthropic API key beside the
   RunPod keys, stored the same way (`~/.config/runpod-pod-manager/.env`, shown as set
   plus last four characters, never the value). Its one use is an in-app "Write an adapter
   with Claude" action that sends the folder's file listing and manifests (not the media)
   to the model and saves the result as a draft adapter for approval. Agents that bring
   their own key (Claude Code, Codex) do not need it. See open point 1.
8. **Import locally, then sync (Lucas, 2026-10-24).** An import always fills this PC's
   ComfyUI-Shared; getting it onto a pod or volume is the existing Sync (ADR-007), by SSH
   to a running pod or by S3 with no pod. There is no import straight onto a running pod:
   it would put the adapter's work on a billing machine, duplicate the sync's progress,
   resume and idle-hold logic, and leave no local copy to check or redo. The same dry run
   and record serve both steps.
9. **Namespaces (Lucas, 2026-10-24: "under its own project namespace?").** Workflows
   and staged node packs go under the adapter's own project folder
   (`workflows/<project>/<round>/`, `node-packs/<project>/<pack>/`). Inputs stay at
   `input/shots/<shot>/...` because the graphs load them by those relative paths and the
   package is not to be edited; the shot id is their only namespace, and a differing
   file already there is a conflict, never overwritten.
10. **Leaving the machine is not an import step.** An import fills the local ComfyUI-Shared
   (or, with `--s3`, goes through the existing sync). Pushing to a volume stays the
   sync's job, with its existing rules: plates and other client material only with Binc's
   named yes, USD 100 cap, nothing sent without a person's go.

## Consequences

- Adding a format is a file, not a release. The app's tests cover the executor and the two
  built-in adapters; a user adapter is tested by its own dry run.
- The plan is data, so the same dry-run screen serves every adapter, and a plan can be kept
  as the record of what an import did (and what it left in place).
- AI-written code gets a narrow door: read-only access to one folder, output validated as
  data. It is still code a person approved; the approval screen is part of the feature.
- The Dockerfile and image are untouched; node packs an adapter stages go where the image
  already looks (`shared/nodes` packs, `COMFY_SHOTPIPE` sets, ADR-006), and a package's
  packs that the image lacks are reported, not silently installed.
- A package still arrives in parts (five Drive parts): an adapter takes the merged folder;
  merging the parts is a separate step the doc covers, not the adapter.

## Alternatives considered

- **One hard-coded importer per format in the app.** Simple for two formats, and every new
  one is our release. Rejected for the third.
- **A declarative mapping file (JSON/YAML: "this glob goes there") instead of code.** Safer
  and enough for flat copies, but not for hash checks, per-round subfolders, reading a
  manifest to decide, or reporting missing nodes. Kept as a possible first tier: an adapter
  may be written as rules, and the built-ins can be.
- **Let adapters write files directly.** Less code, but then approving an adapter means
  trusting everything it does. Rejected for plan-then-apply.
- **Python or shell adapters.** The app has no Python (ADR-005) and users should not need
  one. Rejected.
- **Adapters as npm packages.** Needs a registry and an install step on the user's
  machine. A watched folder is enough.

## Open points

1. **The Claude key.** Read from "bake in a setting to make a placeholder for our claude
   key": an optional Anthropic key setting for in-app adapter writing. If instead it meant
   a placeholder written into an imported pack's own `config.ini` (the packages say "a
   pack's local `config.ini` (provider key) is not shipped"), that is a plan operation
   (`placeholder`) and a provider-keys section in Settings, and the two do not conflict.
2. **How strong the isolation is.** Checked 2026-10-24 on the app's own executable
   (Electron 44.9.0, Node v24.22.0, `ELECTRON_RUN_AS_NODE=1`). Node's permission model
   works there: `--permission` (the old `--experimental-permission` is rejected). With
   `--allow-fs-read=<source folder>` and the adapter file, a test module that imports
   `fs` itself could read the source, was refused on another folder
   (`ERR_ACCESS_DENIED`), refused every write, and refused to spawn a process. Without
   the flag the same module read the other folder, wrote, and spawned. Two things it does
   **not** stop: **network** (a `fetch` to an outside host succeeded under the flag, so a
   hostile adapter could send out what it can read), and anything given back by
   `--allow-child-process` or `--allow-worker`, which must stay off. Two practical notes:
   macOS paths must be real paths (`/tmp` is `/private/tmp`), and the entry file needs
   its own read grant. So: the adapter process runs under `--permission` with only the
   source folder and its own file readable; the network gap is closed by the approval
   screen for now, and by an OS sandbox later if wanted (macOS `sandbox-exec`, a
   container on Linux; not tried). Not yet checked in a packaged build, only in dev.
3. **Whether Binc wants his own format as an adapter** (CANALV2 trees and `ComfyUI-Shared`
   are read in place today, not imported).
