# ADR-026: The big cards are in the table by name, and `auto` never picks them

**Date:** 2026-11-04
**Status:** Accepted.
**Extends:** ADR-024 (pull pods take any free card; general pods keep the table), ADR-001 (on-demand pods). **Code:** `apps/runpod-dashboard/libs/core/src/gpus.ts`, `pods.ts`.

## Context

The pod table held ten cards of 16 to 48 GB that cost no more than a 4090 (`gpus.ts`). On 2026-11-04 Lucas asked for "the most powerful card", and every one of the ten was out of stock in every datacenter, including EUR-IS-2 where the network volume `comfy-workspace` lives. A pod could not be created, and the tools refused any card outside the table, so the bigger ones could not even be asked for.

Asking RunPod's `gpuTypes` showed the shortage was real and wider than the table: only cards of 80 GB and up, and the Blackwell workstation cards, had any stock, and all of it was `Low`.

## Decision

1. **Seven big cards join the table by name**, with their RunPod ids confirmed against `gpuTypes` on the day: `l40s` (NVIDIA L40S, 48 GB), `rtx6000ada` (NVIDIA RTX 6000 Ada Generation, 48 GB), `a100pcie` (NVIDIA A100 80GB PCIe), `a100` (NVIDIA A100-SXM4-80GB), `h100pcie` (NVIDIA H100 PCIe), `h100` (NVIDIA H100 80GB HBM3, the SXM), `h200` (NVIDIA H200, 141 GB). They are Hopper, Ampere and Ada, so the image's CUDA 12.6 runs them.
2. **They are explicit-only.** Each carries `explicit: true`. `auto` picks "the cheapest card in stock" and falls to the next one when a create fails; with these in its pool, a shortage of small cards (today's) would have landed a pod on a card at several times a 4090's rate without anyone choosing it. `auto` now draws from `gpus.autoCards()`, the original ten. The menu marks the new ones "pick by name".
3. **The Blackwell cards stay out** *(superseded 2026-11-04 by [ADR-030](./ADR-030-cuda-13-image-for-blackwell.md): they are in the table now, on a CUDA 13 image)* (RTX 5090, RTX PRO 4500/6000, B200, B300). The image is built on CUDA 12.6 and they need 12.8 or newer; a pod on one starts and then cannot run ComfyUI work (ADR-025 saw `sm_120 is not compatible`). They need an image built with `build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime` first.
4. **The datacenter list shows the new cards' stock**, because it prices every card of the table. ([ADR-027](./ADR-027-datacenter-is-chosen-by-card.md) then lists every card RunPod runs, free or busy.)

## What was in stock (2026-11-04, about 13:15 local, secure cloud, all `Low`)

Stock changed within minutes: a card seen free was gone on the next call, and EU-SE-1 went from an A40 to nothing to an A6000.

| Datacenter | Cards | Image runs it? |
|---|---|---|
| EUR-IS-1 (S3) | B300 288 GB $8.99; RTX PRO 6000 96 GB $2.49 | no (Blackwell) |
| EUR-IS-2 (the volume) | RTX PRO 6000 96 GB $2.49; PRO 6000 MIG 24 GB $0.69 | no (Blackwell) |
| US-NE-1 (S3) | B200 180 GB $7.99; H100 SXM 80 GB $3.99 | H100 yes |
| AP-JP-1 | H200 141 GB $5.29; H100 SXM 80 GB $3.99 | yes |
| AP-IN-1, EU-FR-1, EUR-NO-2, US-MO-1 (S3) | H100 SXM 80 GB $3.99 | yes |
| US-MD-1 (S3) | A100 SXM 80 GB $1.79 | yes |
| EU-SE-1 | RTX A6000 48 GB $0.59 | yes |
| CA-MTL-3, US-NC-2 (S3), EU-CZ-1 (S3) | RTX PRO 6000 96 GB $2.49 to $2.59 | no |
| EU-RO-1 (S3), US-PA-1, US-WA-1 | RTX PRO 4500 32 GB $0.72; PRO 6000 MIG 48 / 24 GB | no |

Seventeen datacenters had nothing. No datacenter had more than two cards. Elsewhere in any cloud, `Low` stock was also shown for the 5090, 5080, 3080 class and the RTX 5000 Ada.

## Constraints that decide where a pod can go

- **The volume pins the datacenter.** `comfy-workspace` (350 GB) is in EUR-IS-2, which had only Blackwell cards. A pod on an H100 or H200 is in another datacenter and cannot mount it: it has no models, and data has to come through S3 (several of these datacenters have it) or a download.
- **Blackwell needs a new image.** The only big card free where the volume lives cannot run graphs on the current image.

## Not decided

- Whether to build the CUDA 13 image so the volume's datacenter becomes usable (the RTX PRO 6000, 96 GB, $2.49/h).
- A second volume next to the Hopper cards: decided in [ADR-027](./ADR-027-datacenter-is-chosen-by-card.md), a new volume is made for whichever region is chosen; what it costs per month and how the models get there are open there.
- A way to wait for a card: today a retry loop is a script, not a feature of the app.
- Prices are RunPod's secure-cloud rate on the day; the USD 100 agent cap is far closer at $4 to $9 an hour than at a 4090's $0.89.

## Consequences

`gpu: h200` and the like work from the New pod form, the CLI and the MCP tools. `auto` behaves as before. A test pins the ten `auto` cards and the seven explicit ones (`libs/core/tests/gpus.test.ts`), and three tests that used `h100` as their "card outside the table" now use `b200`.
