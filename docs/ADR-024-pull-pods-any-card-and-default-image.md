# ADR-024: Pull pods may use any free card (a root setting), and the image selected by default

**Date:** 2026-11-03
**Status:** Accepted (Lucas: "it can be a different card"; "this behavior should be toggleable in default configuration as a root setting"; "by default, select the ghcr.io/bluecollardev/comfy-app:contract-v26 image").
**Extends:** ADR-022 (rounds on the volume; decision 2b "the cheapest GPU pod in stock"), ADR-020 (the image is on `ghcr.io`).

## Context

ADR-022 made the short-lived pod of a Pod download "the cheapest GPU pod in stock", chosen from the app's table of ten cards (16 to 48 GB, the small Ampere and Ada cards, the L4 and the 48 GB workstation cards;
`libs/core/src/gpus.ts`). On 2026-11-03 RunPod had none of those ten free anywhere (`No card available right now ... no longer any instances available`), and the datacenter that holds the volume had exactly one
NVIDIA card free: an RTX PRO 6000 Blackwell (96 GB, USD 2.49/h, low stock), which is outside the table. The core refused it (`unknown GPU`). Run by hand, a pull and the whole active-route test on that card passed
(379 files copied and verified on the pod, a second pull transferred nothing, remove over SSH, pull again, remove), although the image is built on CUDA 12.6 and Blackwell cards want 12.8: **a pull, a hash and a delete never touch the GPU.**
Cost for the test: about USD 0.26 (6 minutes).

Separately, the Default Configuration's built-in image was the bare local name `comfy-app:contract-v26`, which a pod cannot pull; a fresh configuration therefore needed the image typed in before the first pod.

## Decisions

1. **A root setting `pull_any_card` in the Default Configuration** (Options, "Pull pods may use any free card"; a top-level key of the saved configuration beside `apply_by_default`). **On by default.** It applies to the pods a Pod download starts (pull and delete, ADR-022), nothing else.
   - **On:** the plan takes the cheapest NVIDIA card RunPod has free **in the volume's datacenter on the secure cloud**, of any type, not only the table's ten (`runpod.freeCardsIn`, ordered by price). A card outside the table is created by its RunPod id (`CreatePodRequest.gpu_type_id`),
     which must match `NVIDIA <letters, digits, space . _ ( ) ->` and is otherwise refused; AMD cards are never picked. When no answer about free cards comes back, the app's previous choice is used.
   - **Off:** only the table's cards, as before this ADR; with none free the job fails with RunPod's message and leaves nothing behind.
   - **The price is part of what the user confirms.** The plan names the card and its hourly price, and the Pod download's confirmation bar (ADR-022) shows both before anything starts, so a USD 2.49/h card is visible, not a surprise. The idle ceiling (ADR-022, 2d) and the temporary-pod rules (2c) are unchanged.
2. **General pods are not widened.** A pod made from the New pod form or an agent keeps the table (`gpu: auto` picks among its ten), because ComfyUI does use the GPU and a card that needs a newer CUDA than the image's 12.6 (the Blackwell cards) would start and then not run its graphs. Only jobs that never touch the GPU may take any card.
3. **The import and export carry the setting** (ADR-023): `pull_any_card` is in the export under Pod defaults, shown as a change in the import preview, applied only with that section ticked, restored by Undo, and a non-boolean value in a file is reported and not imported. A file from before the setting leaves the machine's own value alone.
4. **The image selected by default is `ghcr.io/bluecollardev/comfy-app:contract-v26`** (`mounts.DEFAULT_IMAGE_REF`). `COMFY_IMAGE` still overrides it, and an image saved in the Default Configuration wins over both. A bare local name is still refused at pod creation. A new installation therefore starts with the registry image selected; it still needs its `ghcr.io` login saved on the RunPod account, with the registry-auth ID entered once.

## Bug found while building it

The configuration panel's switches (`Apply to new pods by default`, and the new one) set their field to `undefined`, not `false`, when switched off; `undefined` is dropped when the configuration is sent, and the core reads a missing value as "on" (`apply_by_default` and `pull_any_card` default to true), so **neither switch could ever be turned off**.
Both now declare an explicit off value (`:unchecked-value="false"`), and a spec asserts the saved body carries `false`. (The no-spend switch was not affected: it only ever needs "true".)

## Consequences

- A Pod download can start on a card the app never lists, at a higher hourly price than the L4, for the few minutes a pull takes; the user sees the card and price first and can turn the behaviour off.
- It removes the stock failure seen on 2026-11-03 for as long as any NVIDIA card is free in the datacenter. It does not help when the datacenter has none.
- Two more things to keep true: the table's comment in `gpus.ts` (cards left out on purpose) now describes general pods only, and the setting must be listed wherever the Pod defaults section is.

## Tests

Core (`podpull`, `pull-any-card`, `configio`, `mounts`, `pods`, `pool`): the cheapest free card wins whether or not it is in the table; only an unlisted card free is taken and created by its id with the volume, the name, `S3_PULL` and the idle ceiling intact, and the pod is deleted at the end; the setting off ignores it; bad ids are refused; no answer falls back; the setting round-trips through export, preview, apply and Undo; the default image is the registry reference and a bare name is refused.
Browser: the switch is on by default, switching it off saves an explicit `false`. Real pods: the Blackwell card ran the active-route test end to end (above).
