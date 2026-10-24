# Plan: building import adapters

**Status:** COMPLETE, 2026-10-24: all six phases built and tested on `feature/import-adapters` (not merged or pushed). Results are at the end. Decisions are in
`docs/ADR-008-import-adapters.md`; the adapter contract is `docs/IMPORT-ADAPTERS.md`.
Branch: `feature/import-adapters` (cut from `fix/session-fixes`, which is `develop` plus
the delivery docs commits; merges to `develop` with `--no-ff` once `./start.sh test` is green).

## What was found while planning (changes the spec slightly)

- **Manifest paths are relative to the package root and start with the shot id**
  (`archival-071/comfy/workflows/…`, `archival-071/comfy/input/shots/archival-071/…`), not
  to the shot folder. Each entry carries `path`, `role`, `sha256`, `bytes`, `repo_path`.
  The adapter strips `<shot>/comfy/input/` and `<shot>/comfy/workflows/` itself.
- **A package arrives in parts, each holding only some files of each shot** (parts 2 to 5
  have `approved`, `comfy`, `provenance` but not the top-level `MANIFEST.json` or `final`).
  So the adapter must work on a partial folder: plan the files present, and report the
  manifest entries it cannot find as a finding (a count, not a failure).
- **The copy carries its own hash.** A `copy` op can carry `sha256` from the manifest; the
  executor hashes the source before writing and refuses a mismatch. That replaces the
  separate whole-manifest verify (hashing 14 GB of finals that are not being copied would
  be wasted). `verify` stays as an op for a file left in place.
- **Node packs are staged, not installed:** `node-packs/<project>/<pack>/` under ComfyUI-Shared (the
  `-vN` dropped). The image links packs from its own sources (ADR-006), so a staged pack
  is a finding ("this graph needs pack X; staged at …"), not a live install.
- **The permission fence runs on the dev machine's Node 22.22 and the app's Node 24.22**
  (`--permission`); where a Node lacks it the run says `fenced: false` instead of failing.
- The app's core is plain compiled TypeScript (`libs/core/dist`), so the runner and the two
  built-in adapters are TypeScript files compiled with it. No packaging change.

## Phases

Each phase ends green (`./start.sh test`) and is its own commit.

### 1. The core: types, executor, runner (no UI)  [x] done

- `libs/core/src/adapter-types.ts`: `Op`, `Finding`, `Plan`, `AdapterInfo`, the `ctx` shape.
- `libs/core/src/adapter-runner.ts`: the child-process entry. Imports one adapter file,
  runs `detect` or `plan` with a confined read-only `ctx` (exists, stat, list, text, json,
  sha256, roundName, target, options), prints one JSON result. Output capped; killed on
  a timeout.
- `libs/core/src/imports.ts`:
  - `list()`: built-ins plus `~/.config/runpod-pod-manager/adapters/*.mjs` (source hash,
    approval state, load error).
  - `detect(source)`: runs every approved adapter's `detect`, returns the matches.
  - `plan(source, adapterId?)`: runs the child under `--permission` (read on the source
    folder, the runner and the adapter file only; no write, no child process), returns the
    plan, findings and `fenced`.
  - `validate(plan, source, target)`: every `from` inside the source, every `to` inside
    ComfyUI-Shared, no `..`, no absolute paths, no symlink escapes.
  - `apply(plan, …, { dryRun, overwrite })`: `copy` (clone-on-write where the disk has it,
    hash check when the op has `sha256`), `link`, `verify`, `note`, `placeholder`. Never
    deletes; a different existing file is a conflict, not an overwrite, unless chosen.
    Returns a per-op result and writes the record to `~/.config/runpod-pod-manager/imports/`.
  - `approve(id)`: stores the adapter's source hash; a changed file needs approval again.
    Built-ins are always approved.
- `paths.ts`: `adaptersDir()`, `importsDir()` (env overrides for tests, like the others).
- Built-ins in `libs/core/src/adapter-builtins/`, one self-contained file each:
  `comfy-shared.ts` (`input/`, `models/`, `workflows/` as they are; `output/` skipped) and
  `panama-imax-redux.ts` (manifest-driven, as in "found while planning").
- Tests (`libs/core/tests/imports.test.ts`): a fake package built in a scratch folder in
  the real shape (partial parts included) with real hashes; plan contents; a hash mismatch
  stops that file; conflict not overwritten; `..` and absolute paths in a plan rejected;
  idempotent second apply; a user adapter unapproved is refused, then runs once approved;
  a hostile adapter (reads outside, writes, spawns) is refused by the fence, and the test
  skips the fence assertions where the Node lacks `--permission`.

### 2. CLI and IPC  [x] done

- `./start.sh import <folder> [--adapter <id>] [--dry-run] [--overwrite] [--to <dir>]`
  (default target: the mapped ComfyUI-Shared; refuses when it is unmapped). Prints the
  plan summary by kind, the findings, and the result.
- `./start.sh import --list` and `--approve <id>`.
- IPC namespace `imports` in `electron/core.cjs` (`list`, `detect`, `plan`, `apply`,
  `approve`); `core.test.mjs` pins it.

### 3. MCP tools (so a coding agent can write adapters)  [x] done

On the pod-manager server (`mcp/server.mjs`, then re-bundled): `adapter_spec` (returns
`docs/IMPORT-ADAPTERS.md` and the target structure), `adapter_save` (validates the module
loads and exports the shape, saves it unapproved), `adapter_test` (the dry run against a
folder), `adapters_list`, `import_plan`, `import_apply` (apply needs the approval to have
been given in the app or CLI, not by the agent). Tests alongside the existing MCP node
tests.

### 4. The UI  [x] done

- Connect ▸ Import (or a button on the ComfyUI-Shared mount row): pick a folder, see the
  detected adapter, the plan by kind with counts and sizes, the findings, `fenced` badge,
  dry-run then Apply, the record afterwards.
- Adapters list: built-in and yours, source hash, Approve (shows the source), load errors.
- Strings in `src/locales/en.json`, `data-testid` locators, Playwright specs against the
  fake API in `e2e/fixtures.js`, and the Electron no-spend spec.

### 5. The Claude key setting and "write an adapter with Claude"  [x] done

- Settings: an optional Anthropic key beside the RunPod keys (`settings.ts` `KEYS`,
  stored in the same `.env`, shown as set plus last four). Reads of this setting are the
  only change before the action exists; the open point in the ADR about its meaning is
  settled with Lucas first.
- The action sends the folder's file listing and manifests (no media) and the spec, saves
  the reply as an unapproved draft adapter, and runs the dry run. Tested against a faked
  model reply; no live call in the suite.

### 6. Real folders, docs, merge  [x] done

- Run the `panama-imax-redux` adapter dry-run on the real first package and on the 5 parts
  (`projects/test/`), read-only, into a scratch target, and compare counts with the
  manifests. Run the apply into a scratch folder, never into `~/ComfyUI-Shared` or the
  mirror.
- Update `docs/IMPORT-ADAPTERS.md` to what was built (op kinds, `node-packs/`), the
  README and CHANGELOG; move the next-steps item.
- `./start.sh test`, then merge to `develop` (`--no-ff`).

## Out of scope for this build

Importing onto a running pod (ADR-008 decides: import locally, then Sync); pushing to the
volume; running any graph; merging the five Drive parts into one folder (the adapter reads
a merged folder or a single part); a CANALV2 adapter (Binc's tree is read in place; add
when the mapping is settled); an OS sandbox for the network gap (ADR-008, open point 2);
signing or packaging changes.

## Result (2026-10-24)

| Phase | Done as | Where |
|---|---|---|
| 1 core | runner and the two built-ins are plain `.mjs` in `libs/core/runtime/` (copied into `dist/runtime` by `core:build`, so they run from source and from the packaged app); `imports.ts` lists, detects, plans (fenced), validates and applies | `libs/core/src/imports.ts`, `libs/core/runtime/`, `libs/core/tests/imports.test.ts` (20 tests) |
| 2 CLI, IPC | `./start.sh import`; `imports` namespace (list, detect, plan, apply, approve, source, save, spec, draftPreview, draft) | `cli/index.mjs`, `electron/core.cjs`, `core.test.mjs` |
| 3 MCP | `adapter_spec`, `adapters_list`, `adapter_save`, `import_plan`, `import_apply`; no approve tool | `mcp/server.mjs`, `docs/MCP-ENDPOINTS.md` |
| 4 UI | Import Shot Pack modal | `ImportPane.vue`, `stores/imports.js`, `e2e/import.spec.js` (10), `e2e-electron/import.spec.js` (3) |
| 5 Claude | Anthropic key in Default Configuration; preview then send; draft saved unapproved | `settings.ts`, `ConfigModal.vue`, `imports.ts` |
| 6 real folders, docs | see below | CHANGELOG, ADR-008, `IMPORT-ADAPTERS.md` |

Decisions taken on the three open questions: the Claude key is the in-app adapter-writing key
(the `placeholder` op also exists for a pack's own `config.ini`); the entry is Import Shot Pack;
packs are staged under `node-packs/<project>/<pack>/`, and workflows under
`workflows/<project>/<round>/` (Lucas asked for a project namespace; inputs cannot take one).

What the real packages showed, and what changed because of it:
- Two of the five Drive parts were not recognised (no manifest in them): detection now also
  accepts a shot folder with `comfy/input`, `comfy/workflows` or `nodes/`.
- Parts of one round landed under different workflow folders (`... 2`, `... 4`): the round name
  now drops the " N" Drive adds.
- Merged, the five parts import 84 files (1.0 GB) with every hash checked and nothing missing
  or unlisted. Part by part, cgi-042 and creature-266 have no manifest in the first part, so
  those files copy unchecked (reported as warnings).
- Same shot id in two projects would collide in `input/`; the app reports a conflict and
  never overwrites.

Not done, by design: anything in "Out of scope", merging or pushing the branch.

## Order and size

Phase 1 is the bulk (executor, runner, two adapters, tests) and everything else hangs off
it. Phases 2 and 3 are thin wiring. Phase 4 is the largest UI piece. Phase 5 waits on one
answer. Phase 6 is the check against the real packages.

## Decisions I need from Lucas before the phase that uses them

1. **Phase 5:** is the Claude key setting for in-app adapter writing (my reading), or a
   placeholder for a pack's own `config.ini` (ADR-008, open point 1)?
2. **Phase 4:** where the Import entry lives (Connect ▸ Import, or on the ComfyUI-Shared
   mount row).
3. **Phase 1:** staged node packs under `node-packs/` inside ComfyUI-Shared (planned), or
   elsewhere.
