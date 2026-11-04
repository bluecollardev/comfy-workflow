# ADR-030: A CUDA 13 image for the Blackwell cards, chosen per card

**Date:** 2026-11-04
**Status:** Accepted. Verified on a real pod (see below).
**Extends:** ADR-020 (the image on `ghcr.io`), ADR-024 and ADR-025 (the Blackwell card that could not run graphs), ADR-026 (the big cards by name). **Supersedes:** ADR-026 decision 3 (the Blackwell cards stay out).
**Code:** `apps/comfy-app/build.sh`, `pins.env`, `.github/workflows/comfy-image.yml`, `libs/core/src/gpus.ts`, `pods.ts`, `runpod.ts`, `podpull.ts`.

## Context

The image is built on `pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime`. A Blackwell card has compute capability 12.0 (`sm_120`), which needs CUDA 12.8 or newer: PyTorch logged `CUDA capability sm_120 is not compatible` and ComfyUI would not run GPU work on it (ADR-025). Those cards were left out of the table, yet on 2026-11-04 they were the only big cards in stock in the region where the network volume lives (EUR-IS-2: RTX PRO 6000, 96 GB), and the only way to B200 and B300 memory. Lucas asked what it would take; the answer was a second image.

## Decision

1. **A second image, on CUDA 13, beside the first.** `./build.sh --cuda 13` builds on `pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime` (pinned as `BASE_IMAGE_CU13` in `pins.env`, with the 12.6 base as `BASE_IMAGE_CU126`) and tags it `comfy-app:<set>-cu13` (`ghcr.io/bluecollardev/comfy-app:contract-v26-cu13`). The default image is unchanged: the Hopper, Ampere and Ada cards keep the CUDA 12.6 one, so the H100 and H200 work does not move. The base tag was checked on Docker Hub (amd64, 2026-06-18); there is no 2.12.1 cuda12.8 base, so the choice is 12.6 or 13.
2. **CI builds it from a variant name.** A branch `image/<set>-cu13-<time>` (what `build.sh --cuda 13 --remote` pushes) is read by the workflow as set `<set>` on the CUDA 13 base, pushed as `<set>-cu13`.
3. **The card picks the image.** The Blackwell cards (RTX 5080, 5090, RTX PRO 4000, 4500, 4500 SE, 5000, 6000 in three editions, B200, B300) are table cards with `cuda: 13`, **explicit-only** like the other big cards (`auto` never lands on one). `plan()` turns our `…/comfy-app:<tag>` into `…:<tag>-cu13` for them (`gpus.imageFor`); a raw RunPod id is matched too. Another image (RunPod's stock one, a custom reference) is left as given.
4. **A host that can run it.** A CUDA 13 container needs a host driver that offers CUDA 13, and older RunPod hosts do not. A `-cu13` pod is created with `allowedCudaVersions` (13.0 to 13.4), RunPod's host filter.
5. **A pull pod keeps the normal image.** A pull, a hash or a delete never touches the GPU (ADR-022), so `podpull` creates its pod with `cuda_match: false` and it boots the default image wherever it lands. The pull path also chooses from the ten `auto` cards only, not the explicit-only ones (it had been choosing from the whole table since ADR-026 added the big cards).
6. **The picker says so.** A Blackwell card reads "CUDA 13 image", no longer "needs CUDA 13". A card still outside the table (a MIG slice, H100 NVL) reads "not in the table"; AMD reads "AMD, not CUDA".

## Verified

PENDING: filled in after the real-pod check.

## Not decided

- **One image for everything.** Simpler, but it would move the H100 and H200 lane onto CUDA 13 and risk the hosts with older drivers. Kept apart until the cu13 image has run real graphs.
- **The MIG slices** (a Blackwell card split into 24 or 48 GB) and **H100 NVL / H200 NVL** are not in the table; they are chosen by raw id and get the default image.
- **Newer torch.** The base is pinned to the Mac's torch (2.12.1). 2.14 and 2.15 bases exist with CUDA 13.2 and 13.4; moving needs the Mac install moved with it.
- **`allowedCudaVersions` is RunPod's list of host versions**, set to 13.0 to 13.4. A future 13.5 host would be filtered out until the list is extended.
