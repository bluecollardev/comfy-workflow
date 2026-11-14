# ADR-041: Browse and Erase a network volume

**Date:** 2026-11-15
**Status:** Accepted; built: `libs/core/src/podpull.ts` (`browseVolume`, `eraseVolume`, `volumePlan`, `ERASABLE`), the Volumes window (Browse and Erase buttons), MCP `volume_files`, `volume_erase`, `volume_job`; unit and browser tests. **Not run on a real pod yet.**
**Related:** ADR-022 / ADR-033 (a pod does the work on a volume), ADR-038 (the queue), NEXT-STEPS item 15 (the open questions this answers).

## Context

Lucas (2026-11-15), looking at a volume that still listed an old pod: "have an option like grow and delete to clear a volume", "Erase", "also have an explore button to explore the volume. Browse". A volume cannot be read without a pod (a volume in EUR-IS-2 has no S3 API), and `delete_volume` removes the volume, not its contents.

## Decision

**Browse** and **Erase** sit beside Grow and Delete on each volume. Both use the machinery of the pull and remove jobs: your own pod on the volume if one is running, else a short-lived pod of the cheapest free card (named `ComfyUI-Pull-vol-<id>-…`), a script over SSH, then the pod is deleted. They work on any volume of the account, not only the Default Configuration's, and need only the RunPod key (no bucket keys).

- **Browse** is read-only: `du` to depth 3, shown as a tree with sizes, after the window says where it runs and what the pod costs per hour.
- **Erase** empties chosen folders (their contents; the folder and the volume stay, and the volume keeps billing). The choice is a fixed list the app holds, never a path from the caller: pulled rounds (`temp/rounds`), inputs (`input`, with the files placed from rounds), round graphs (`workflows/rounds`), outputs and models. Rounds, inputs, graphs and outputs are ticked by default; **models are not** and are marked slow to download again. "Show sizes" runs a Browse first so the sizes are seen before the yes.
- **The yes:** the user's name (`approved_by`) and the volume's exact name typed back (`confirm_name`); both through the window and the MCP (`volume_erase`). Without them nothing starts.
- **Guards:** refused while another job (a pull, a place, another browse or erase) runs on the same volume. Erasing `temp/rounds` forgets what the app knew about the volume's rounds (`volume-rounds.json`).
- **Not guarded:** a Queue run in progress on a pod of the volume is not known to this layer; do not erase while an import is running.

## Consequences

- A volume can be inspected and cleared without leaving the app; the cost is the short pod's minutes (a few cents).
- Erasing is not reversible; re-pulling a round needs a named yes and the bucket.
