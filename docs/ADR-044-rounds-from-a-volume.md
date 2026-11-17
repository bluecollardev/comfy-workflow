# ADR-044: rounds from a volume: a source selector in Import Round, a read-only volume source, and round adapters

**Date:** 2026-11-17
**Status:** Plan validated against Binc's governance (section "Validation") on 2026-11-17. **Built 2026-11-17 (uncommitted on `feature/volumes-v2-fallback`, tested with fakes, never run against a real volume's run): steps 1 to 4, the three guards, the preflight's core and button, MCP parity.** Not built: the Adapter Studio kind switch (step 5). See "What is built" below.
**Context from:** Lucas ("there are 600+ workflows in here, is there a way to import rounds / segments of bincs tree, so we can import via import round. let's have adapters for these too, and have the rounds imports have a similar builder / adapter builder for the rounds logic as well"; "when we import rounds, one source is BH, but let's have a source ... for volume based"; "step 1 choose rounds can have a dropdown with a source selector"; "check bincs governance to make sure this makes sense").
**Extends:** ADR-016 (the BH library in Import Shot Pack), ADR-017 (source / round / package adapters; Proposed, not built), ADR-038 (importing a round queues work for the pool), ADR-043 (which adapter for which source).

## Context

Binc's graphs are already on the shared volume (EU-RO-1, `a3upg9ey48`): `comfy-shared/workflows/` holds `canalv2`, `canalv2-library`, `proxy_v004e/f/g`, `proxy_v005` and `rounds` (Lucas counts 600+ workflows; not counted by us yet). Import Round lists only rounds from the BH bucket (the Panama S3 source), so a round Binc keeps on the volume cannot be imported, pooled or run through it. ADR-017 already names "a pod's volume" as a later source.

## Decision

1. **Step 1 of Import Round, "Choose rounds", gets a Source dropdown.** `BH (Panama bucket)` stays the default and behaves exactly as today; `Volume` is the new one. Both feed the same list (ADR-017's `LibraryItem`: `{ source, id, name, shots[], files?, bytes?, staged, verified, importable }`), so the rest of the wizard is unchanged. Choosing Volume adds a volume picker (the default is the Shared volume).
2. **The `volume` source is built into the core, read-only.** It lists what is under `comfy-shared/workflows/` (a round is a folder of shots; a **segment** is a shot or a set of shots of a round: the picker already ticks shots for a BH round (`import-round-shot`), and the volume source fills the same ticks from the folder names, so "archival-080 and archival-084 of `proxy_v005`" is one import; ADR-038 queues one task per shot) over the RunPod S3 API from this PC (no pod, no cost), else a short pod (cents). It never writes to, renames, moves or deletes anything on the volume. It is code in the core, not a user module, so no adapter with network access is needed (ADR-008, open point 2).
3. **Round adapters read the listing and say what a round is.** A round adapter (ADR-017's middle kind) is fenced like a package adapter: no network, no writes; it gets the volume source's listing and may read small files (graph JSON, manifests) through `ctx`. It returns `describe(dir) -> { kind, round, shots[], variants[], graphs[], locked[], findings }`, and names the newest revision. First built-in: `brynley-rounds-layout` for `<round>/<shot>/<shot>__<variant>__<round>.json`. Yours are written in the **Adapter Studio with a kind switch (source, round, package)**, by Claude or by hand; Claude writes adapters and nothing else (ADR-008).
4. **Importing a volume round is in place.** No copy of Binc's graphs. The import creates the ADR-038 tasks for the chosen rounds or segments: place the round's inputs on a pod (new flat-named files, never overwriting), and optionally run. The package adapter `brynley-rounds` (ADR-043) is for rounds that arrive from elsewhere and are copied onto the volume.
5. **A read-only preflight per graph** before any pod or run: every model a graph names is looked up in the volume's model list, and a miss says where the file is instead (the 2026-11-17 case: `LTX23_audio_vae_bf16.safetensors` only in `vae/`, the loader reads `checkpoints/`). Spends nothing. Fixing a miss is a separate, named step (ADR-043, decision 5).
6. **Import is not run.** Importing a round places it; running a graph is a separate step with its own named yes and a cost estimate against the cap.

7. **MCP parity (ADR-028):** `list_rounds` (all sources, a `source` argument) and `round_info` (a round adapter's `describe` for one round); the existing import tools take `source: "volume"` and `shots`, so an agent does what the window does.

## Validation against Binc's governance (2026-11-17)

Sources read: `shared/governance/policy/agent-permissions.md`, `standing-rules_v001.md`, `area-pipeline_v002.md`, `engineering-contract.md`, `workflow/workflow-rules.md`, `workflow/decisions_v001.md`, `operator-brief.md`, `README.md` (precedence: Binc's win for their material). Copies dated 2026-10-19; the master is Binc's tree.

| Rule (Binc) | This plan | Verdict |
|---|---|---|
| "Nothing is renamed, moved, overwritten or deleted. Versions only go up." (standing rules; operator brief 4) | The source is read-only; import is in place; placing writes only new flat-named inputs and skips a differing file as a conflict (ADR-033). No "replace" option for volume rounds. | Complies, with a guard: the Replace switch must not apply to a volume source |
| "Locked or client-approved shots (e.g. cgi-042) are never edited or run by us" (area-pipeline; standing rules) | A round adapter returns `locked[]`; those shots are listed and may be placed for reference, but Run refuses them. Today the list is a constant in the adapter; Binc's record is the tracker's `locked` column and the BH console. | Needs a guard, and the list's source confirmed with Binc |
| "Approved graphs are locked": locked graphs live in `<shot>/04_GRAPH/` (area-pipeline) | A segment taken from that part of Binc's tree is reference-only: placed, never run. | Needs a guard: any segment under `04_GRAPH` is treated as locked |
| "May run OPEN shots at proxy when asked" (agent-permissions) | Run stays a separate step, per round or segment the person chose, at proxy. No "run everything". | Complies |
| "Any spend, with a cap" and USD 100 total for agents and cloud GPU; an agent stops and reports before passing it (agent-permissions) | Listing by S3 costs nothing; a pod listing is cents. Running is the real spend: runs seen today cost USD 0.01 to 0.34 each (4090 and A100), so 600 graphs would be about USD 66 to 200 on those figures (illustration, not an estimate for these graphs). The wizard must show the estimate against the remaining cap and stop at it. | Needs the existing cost cap (ADR-038) applied to volume imports, with the estimate shown before Start |
| "Downloads and installs need a named yes; name, source and size first" | Nothing is downloaded: the volume source and the preflight read in place. Fixing a missing model is a download and keeps the named yes. | Complies |
| "Graphs are real ComfyUI UI-format files ... never overwrite a last known good" (standing rules; engineering contract) | Graphs are never edited by the import; a graph that names a missing model is reported, not changed. | Complies |
| "Nothing is guessed or substituted"; "stop and report on ambiguity" (workflow-rules 2; agent-permissions) | The preflight reports a miss and where the file is; it never substitutes a file. A round the adapter cannot place is a finding, not a guess. | Complies |
| "Never paste or store API keys" (standing rules) | The source uses the S3 keys already in the app's settings; no adapter holds a secret (ADR-017). | Complies |
| "Sending ... needs an explicit yes" | The Studio sends nothing to Claude until Send is pressed, and shows what it carries first (ADR-009). For Binc's rounds that is file names and small manifests; Lucas confirms Send each time. Whether Binc is content with names of his graphs going to the Anthropic API is not stated in his pages. | Complies mechanically; ask Binc once (TODO section 5) |
| "Nothing starts without an inbox entry (03_INBOX)"; "an entry goes live only when every required asset is found" (workflow-rules 1-2) | These govern Binc's own queue and tracker. Import Round is our tool acting on Lucas's request, as Run workflows already is. Not changed by this plan. | Not applicable, noted |

**Result:** the plan makes sense under Binc's governance. It is a read-only listing, an in-place import and an explicit run step, which is what his pages allow. Three guards must be built with it (no Replace on a volume source; locked and `04_GRAPH` shots are never run; the cost estimate against the USD 100 cap before Start), and two points go to Binc (where the locked list is kept; names to the Anthropic API from the Studio).

## Consequences

- The picker's list is per source, so a third source later (a Drive part, another volume) is another entry in the dropdown.
- ADR-017's order of work moves up: `LibraryItem` and the per-kind fence policy are needed first; the Studio kind switch follows.
- The `volume` source is built in, so ADR-017's "source adapters you write" stays unbuilt until there is a second source that needs one.

## Order of work

1. **Built:** `LibraryItem` shape behind the existing Panama list, no behaviour change (ADR-017, step 1): `libs/core/src/library.ts` (`sources()`, `list(source)`, `itemOfRound`), IPC `library.sources|list`, MCP `list_rounds`, `src/api/library.js`, and a Source dropdown in Import Round step 1 (`import-round-source`, BH only; changing the source reloads and clears the ticks). Tests: `library.test.ts`, the dropdown spec in `import-round.spec.js`, MCP parity.
2. The `volume` source (S3 listing, else a short pod), the `brynley-rounds-layout` round adapter, and the Volume entry in the dropdown. Rounds and segments listed; locked and `04_GRAPH` shown as reference-only.
3. Import in place: the ADR-038 tasks without a pull; the three guards; the cost estimate.
4. The preflight (models per graph against `models_status`), shown per round in the list.
5. Studio kind switch for round adapters; `adapter_spec` returns the round kind.
6. Tests at each step (core unit, MCP parity, browser), docs, `docs/IMPORT-ADAPTERS.md` section per kind.

## Open

- Where Binc keeps the locked list for the volume's rounds (the tracker's `locked` column is in his tree, not on the volume).
- Whether a segment is a set of shots, a folder, or both; the first cut is a set of shots inside one round.
- Listing speed: the whole `/workspace` listing paged 1,000 files per call and took minutes for 31,062 files. List only `comfy-shared/workflows/<round>/` by prefix, never the whole volume, and cache per round.
- Where "newest revision" comes from for a volume round: the round name's suffix (`v004e` < `v005`) or the folder's modified time.
- Whether Run workflows should open on a round's shots from here instead of listing every graph of a pod.
- A volume in another datacenter (EUR-IS-2): listing works, running needs pods there; cross-volume copy is a transfer and stays out of this ADR.

## Related

`docs/ADR-037-run-workflows-on-a-pod.md`, amendment 2026-11-17 (the Run window keeps its state; a larger split pane with reports and logs).

## What is built (2026-11-17, honest account)

- **Step 2, the `volume` source:** `libs/core/src/library.ts` (source `volume`, `needs: 'volume'`) and `libs/core/src/volumeround.ts`. Lists `comfy-shared/workflows/` one level (one `aws s3 ls`), then each folder by prefix (`--recursive`, 3 at a time, cached 90 s). Only `aws s3 ls` and `aws s3 cp <key> -` (a read to stdout) are ever issued; a test asserts it. No S3 keys, or a datacenter without the S3 API: `library.status` says why, nothing is listed, no pod is started. Items: `source: 'volume'`, `staged: true`, `verified: false`, shots, graphs, locked, variants; a folder with no `<shot>/<shot>__<variant>__<round>.json` layout (canalv2, canalv2-library, rounds on the real volume) is listed and `importable: false`. **Not confirmed against the real volume's listing in this build** (the S3 listing shape is the one `modelsOnVolume` already parses).
- **Step 3, the round adapter step:** the runner's fenced `describe` action (listing on stdin, `describe(listing, ctx)`, no folder, no network, no writes), the built-in `brynley-rounds-layout` (kind round, documentation header, ADR-043 rule 6), `imports.describeRound`, IPC `library.round`. `ctx` for `describe` has `roundName`, `target` and `options` only: the adapter reads no file (the ADR's "may read small files" is not built; the listing is enough for the layout).
- **Step 4, in place import and the guards:** `queue.importRound/importRounds/planImport` take `source: 'volume'` and `volume_id`. No pull task; one `run` task per unlocked shot with its graph paths as the Workflows panel names them (`proxy_v005/archival-080/archival-080__a__proxy_v005.json`), the existing pod limit, cost cap and `approved_by`. The guards are in the core: **(a)** `replace`/`overwrite` on a volume source is refused (400) by plan and import, and the source's code only lists; **(b)** a locked shot (`cgi-042`, any shot with a graph under `04_GRAPH`, from the adapter AND the core's own constants in `volumeround.ts`) asked for by name is refused at start (403) and shown as `refused` in the plan; with no shots named, locked ones are left out; **(c)** the plan carries the estimate (graphs x median seconds per graph from the History's `run` events, else 600 s, x the pod's hourly price, the assumption in words) and `remaining_usd` (the USD 100 agent spend cap minus the History's spend); start refuses (402) when it passes the import's cap or what is left.
- **Window:** Source = Volume shows a volume chooser (the Shared volume first), the rounds with shot and graph counts, locked shots disabled with a "reference only" badge, no Browse, no pull wording, the estimate with its assumption and the cap before Start (Start disabled over the cap), and a **Check models** button per round.
- **Preflight (decision 5):** `volumeround.preflightRound` reads each graph's JSON from the volume (at most 60 per call, lazily, per round) and looks each model up in `comfy-shared/models/`, knowing which folder common loaders read; a miss lists where the same file name is (the audio VAE case). Read-only; fixing a miss is not built.
- **MCP:** `list_rounds` takes `source: 'volume'`, `volume_id`, `status`; new `round_info` (describe, and `models: true` for the preflight); `plan_round_import`, `import_round`, `import_rounds` take `source` and `volume_id`. Parity and the tool list updated.

**Not built:** step 5 (the Studio kind switch for round adapters; `adapter_spec` still describes the shot-pack kind first); per-round graph counts for a folder the listing could not read are absent; the held-task check in the scheduler still uses the old half-hour per shot rule, not the plan's estimate; no live run of a volume import has been done (no spend was made).
