# ADR-033: A pulled round's inputs are placed where its graphs look, automatically

**Date:** 2026-11-05
**Status:** Accepted and implemented 2026-11-05 (`libs/core/src/place.ts`, called from `podpull.ts`; MCP `panama_place`; the Place button). The route (stage files **and** write a path-corrected graph copy) is Lucas's choice, 2026-11-05: "when loading workflows, these paths need to get updated in graphs" and "Both".
**Extends:** ADR-015 (the pod pulls from the bucket), ADR-022 (rounds stage on the volume), ADR-028 (MCP can do everything the app does).

## Context

On 2026-11-05 the cgi-042 stereo graph opened on the H100 pod with "Missing Inputs: A required media input has no file selected" for `cgi-042-pullback-4k-v03.mp4`.
The pull had worked (15.2 GB, 1,402 files, manifest verified). The cause is where the bytes sit, not whether they arrived:

- A pod pull puts the round at `/workspace/comfy-shared/temp/rounds/<round>/` (ADR-022). `temp/` is staging and is never synced (ADR-021).
- BH's graphs name their inputs relative to ComfyUI's `input/`, e.g. `LoadVideo` = `shots/cgi-042/05-outputs/Approved/master/cgi-042-pullback-4k-v03.mp4`,
  and 27 `LoadImage` nodes under `shots/cgi-042/01-look-dev/...`. ComfyUI's loaders open only files under `input/` (`/workspace/comfy-shared/input/`).
- Each shot in a round carries a ComfyUI-shaped copy, `<shot>/comfy/input/shots/<shot>/...`, plus `<shot>/comfy/workflows/<graph>.json` and `*-inputs-manifest.json` (graph path -> repo path, sha256, bytes).
  Nothing copies the first into `input/`, and nothing puts the graph where the Workflows panel lists it.
- The Mac has no equal problem only because the Import (adapters) already copies into ComfyUI-Shared. The pod has no import step: `panama_import` and `import_apply` write to this PC, and Sync never carries `temp/`.
- Two rounds can ship a shot of the same name with different files (cgi-042 is in the 10-20 and 10-22 rounds). Placing one over the other silently changes what an old graph loads.

## Decision

1. **Placing is a step of the pod pull, not of the user.** When a pod pull ends with the manifest check passing (`s3 pull done (manifest verified)`), the app runs the placement on that same pod over the same SSH transport, before the job is called done. A round that failed or skipped its check is not placed.
2. **Files: staged twice, never overwritten.**
   - *Per round* (always): each shot's `comfy/input/` is linked into `input/rounds/<round>/` (same relative paths), so the round is self-contained and cannot collide with another round. Hard links when the volume allows them (no extra bytes: a round is 15 GB on a 100 GB volume), a copy when it does not.
   - *As shipped* (when free): the same files are also linked at `input/<relative path>` (`input/shots/cgi-042/...`) so a graph loaded unchanged, or a graph from an older round, resolves. An existing file with the same size and sha256 is left; one that differs is **not** replaced, and is reported as a conflict naming both rounds.
   - Nothing is ever written under `temp/rounds/` (the staged round stays as delivered and verifiable) and nothing is deleted.
3. **Graphs: a corrected copy beside the original, never an edit of it.** Each `comfy/workflows/<graph>.json` is copied to `workflows/rounds/<round>/<graph>.json` (the Workflows panel's folder, ADR: `comfy-shared/workflows`), with the path widgets of `LoadImage`, `LoadImageMask`, `LoadVideo` and other `Load*` nodes that the inputs manifest lists rewritten to `rounds/<round>/<path>`. The byte-identical original is kept as `<graph>.as-delivered.json`.
   Only values that appear as keys in that graph's inputs manifest are rewritten; anything else is left alone and listed. After rewriting, every rewritten path is checked to exist under `input/`; a graph with a missing file is still written but marked in the report.
4. **Reported, not silent.** The job's result carries: files linked, files already there, conflicts, graphs written, paths rewritten, paths unresolved. It is a job event in History (ADR history: origin, tool, approved_by apply as for any job) and shows in the Panama pane under the round.
5. **Also by hand, same code.** MCP tool `panama_place` (`round`, optional `pod_id`, `dry_run` default true) and a Place button on a staged round in Pod mode run exactly this, for a round pulled before this ADR or after a conflict was resolved. Idempotent: a second run changes nothing. The Local route is untouched (Import already does this on the Mac).
6. **Not done:** editing graphs in `temp/rounds`; rewriting `.json` that BH did not list in a manifest; guessing a path by file name; placing a round that is not verified; touching `projects/desktop/` (read-only, `.claude/rules/binc-tree.md`).

## As built

- `place.rewriteGraph` (pure) rewrites UI-format (`nodes[].widgets_values`, including subgraph nodes) and API-format graphs; a node counts as a loader when its type contains "load". Tested on the real cgi-042 graph and manifest: all 28 inputs rewritten, none unresolved, a second pass rewrites nothing.
- The pod runs two scripts over the pull's SSH, neither holding a secret: an inventory (prints each shot's `comfy/workflows/*.json`) and an apply (the plan rides as one base64 value; python3 links, compares size then sha256, writes the graph copies, checks that every rewritten path exists). `dry_run` runs the same script and writes nothing.
- A pull places on the same SSH session target: the user's pod directly; a temporary pod is waited for up to 3 minutes to expose SSH (a pod without SSH fails the placing, not the pull) and is deleted afterwards as before. A conflict names the path and both sizes; naming the other round would need a record the volume does not keep.
- Measured: not yet on the real volume (no pod was touched while building this). The hard-link question stays open until the first real run: the report's `mode` says `hardlink` or `copy`.

## Amendment 2026-11-05: graph values are flat unique names (the default)

Found on the pod: ComfyUI's `LoadImage`/`LoadVideo` dropdowns list only the **top-level** files of `input/` (the pod listed two), and the frontend's "Missing Inputs" check compares a node's value with that list. So all 28 loaders of the cgi-042 graph were flagged red ("28 nodes, 28 missing inputs") even though the backend loaded them (the previews render, and a bridge run with a subfolder path validated and ran). A graph that is to open clean in the window must name files the dropdown lists.
- **Decision:** placing also hard-links each loaded file at the top of `input/` as `<shot>__<file stem>__<first 8 of the manifest sha256>.<ext>` (`flatName`), and the corrected graph copy uses that name. Unique by content (a different file of the same name in another round gets another name, so there is no conflict to resolve) and stable (the same file always gets the same name). The `rounds/<round>/…` and shipped-path links stay, so older graphs and API runs keep working.
- `names: 'round'` keeps the earlier form (`rounds/<round>/<path>`) for callers that want it; flat is the default.

## Consequences

- A pulled round opens in ComfyUI with its inputs found, with no shell step. The cgi-042 case becomes: pull the 10-22 round, open `workflows/rounds/brynley-comfy-2026-10-22/cgi-042-common-nodes-v13-delivery-20261020.json`.
- A graph keeps working after a later round brings a different `cgi-042` file, because its copy points into its own round.
- Open until the first real run: whether the network volume supports hard links (the report says; the fallback is a copy, at the cost of the round's size again).
