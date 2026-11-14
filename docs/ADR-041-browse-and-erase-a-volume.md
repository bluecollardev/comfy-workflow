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

## Amendment 2026-11-15: two ways to reach a volume (Lucas: "if it's an s3 storage volume, can't we use the S3 API to read? have a runpod adapter and an s3 adapter")

Browse and Erase pick their route from the volume: the **S3 route** (`aws s3 ls` / `aws s3 rm` from this PC against `https://s3api-<datacenter>.runpod.io/`, the bucket being the volume id; no pod, no cost) when the volume's datacenter has RunPod's S3 API and S3 keys are in Default Configuration, else the **pod route** (your pod on the volume, or a short-lived one). The plan (`volume_job plan_volume_id`, and the window before anything starts) says which, and when it is the pod route, why (`s3_note`: `datacenter` or `keys`). Same job shape and the same guards either way. `comfy-workspace` is in EUR-IS-2, which has no S3 API, so it stays on the pod route; `brynley-rounds-eu-ro-1` and `-us-ne-1` can use S3 once keys are set. Not run against RunPod's S3 API yet (no keys were set when this was written); the commands are tested with a stand-in. A pull and the placing still need a pod: S3 has no links.

## Amendment 2026-11-15: Clone (Lucas: "clone a volume to another datacenter", "we can do runpod to runpod")

Clone copies a volume's files into an existing volume or a new one in another datacenter. **RunPod to RunPod is the default and needs no S3**: a short pod on the source volume and one on the target (a pod mounts only one volume, in one datacenter), a one-off ed25519 key made here (never stored) added to the source pod, and the target pod runs `rsync -aH` from the source pod over SSH (`-H` keeps the hard links of `input/`); the key is removed and both pods are deleted at the end. When RunPod S3 keys are set and one side is in an S3 datacenter, one pod does it through the S3 API instead (push from a pod on the source, or pull by a pod on the target): cheaper. `input/` is left out unless asked (placing a round again relinks it). Both pods bill by the hour while it runs, a new volume monthly: it needs `approved_by`. Not run against real pods yet.

## Consequences

- A volume can be inspected and cleared without leaving the app; the cost is the short pod's minutes (a few cents).
- Erasing is not reversible; re-pulling a round needs a named yes and the bucket.

## Amendment (2026-11-15): the explorer, the keys alert, icon buttons

- Browse is a **tree you go into**: a folder opens its children; deeper ones load with **List inside** (`volume_files` takes a `path`). No more `-1 folders` for an empty listing.
- In an S3-capable datacenter **without S3 keys**, Browse and Erase say so before any pod is started, with **Add S3 keys** (opens Default Configuration at the S3 section) and **List with a short pod** as the explicit alternative. Keys come from the RunPod console, Settings, S3 API Keys.
- The Volumes list uses **icon buttons with instant tooltips** (`v-tip`); Default is **Set as Default**; the datacenter menu groups S3 and non-S3 datacenters.
