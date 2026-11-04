# ADR-027: The datacenter is chosen by the card; the picker hides nothing

**Date:** 2026-11-04
**Status:** Accepted.
**Extends:** ADR-026 (the big cards by name), ADR-020 (the image on `ghcr.io`). **Code:** `libs/core/src/runpod.ts` (`datacenterAvailability`), `pods.ts` (`datacenters`), `src/components/DatacenterTable.vue`, `PodForm.vue`, `ConfigModal.vue`.

## Context

A datacenter is chosen for the card it has. On 2026-11-04 Lucas needed an H100 or H200 and the picker could not show where one was: it was a dropdown (grouped, filtered) listing only the ten cards of our table that were *in stock*. Every other datacenter read "none of our cards in stock", and the H100s, H200s, the A100s and everything else were absent. His words:
"whatever stupid fucking thing you're doing to hide cards from me in this list"; "we should see cards regardless of whether they are in use or not. if we have to wait we have to wait"; "obviously i want to choose a datacenter based on whether or not it has the card i want".

Four things hid cards: the table filter (ten cards), the in-stock filter (a busy card was dropped), the NVIDIA-only filter (RunPod's AMD MI300X was dropped), and a failed chunk of RunPod's price query (eight datacenters per request) that showed those datacenters as "none" without saying it had failed. A fifth, found the same day: a running app keeps the core it started with, so a rebuilt core shows nothing until the app restarts.

## Decision

1. **List every card RunPod runs in every listed datacenter, free or in use.** One query, `dataCenters { gpuAvailability { gpuTypeId gpuTypeDisplayName available stockStatus } }`, which is RunPod's own list and includes the cards that are not available (for example H100 NVL, `available: false`). Prices come from the existing per-datacenter price query and are an addition: if that query fails for some datacenters the card is still listed, without a price.
2. **Stock is a label, never a filter.** Free cards sort first, a card in use reads "Out of stock" in the same weight as the rest, nothing is dimmed, collapsed or switched off. You may choose a datacenter whose card is busy and wait for it.
3. **The picker is a table, not a dropdown, and the default view is by card.** *By card*: each card, biggest first, with every datacenter that offers it (free ones first, price, S3). *By datacenter*: each datacenter with all its cards, most free cards first. A click chooses the datacenter. It replaces the select in the pod form and in Default Configuration.
4. **A card the image cannot run is shown and marked, not removed.** Blackwell cards (RTX PRO 6000, RTX 5090, B200, B300, RTX PRO 4500) read "needs CUDA 13" (the image is CUDA 12.6; ADR-026); AMD cards read "AMD, not CUDA".
5. **The volume does not lock the choice.** A new volume is made for whichever region is chosen (Lucas: "we will make a new volume for whatever region we choose"). Picking a datacenter other than the configured volume's turns the volume and the mount configuration off for that pod, says so, and offers "Create a volume in {dc}" (the Volumes window opens with that datacenter chosen). The list reads again every minute while the form is open, with a refresh button; the core caches a minute.
6. **A pod made without the mount configuration still gets the image's registry credential.** It did not: a private `ghcr.io` image failed to pull ("unauthorized") and RunPod exited the pod ten seconds after creating it. `registry_auth_id` now goes out whether or not mounts apply.

## Consequences

- The datacenter list is longer and noisier (about 30 cards, most busy). By card is the default for that reason.
- A pod cannot yet *wait* for a busy card: creation fails with "no card available". Choosing a busy card is allowed; waiting for it is not built. See open items.
- A card of an unknown size shows its size from RunPod's `memoryInGb` when the price query answers, from `OTHER_VRAM` (`gpus.ts`) for known cards outside the table, else blank. Pod lists used to say 24 GB for anything unknown.
- Restarting the app is part of picking up a core change.

## Open

- **Wait for a card.** A create that polls and retries until the chosen card is free in the chosen datacenter, with a cap on time and spend (the USD 100 limit), visible on the pod card. Today it is a script.
- **A new volume per region** means models have to arrive there: S3 datacenters take uploads with no pod (`sync`); the others need a pod or a download. The cost is USD 0.07 per GB a month.
- **A CUDA 13 image** would let the Blackwell cards, which are the only big ones free in some regions, run graphs.
