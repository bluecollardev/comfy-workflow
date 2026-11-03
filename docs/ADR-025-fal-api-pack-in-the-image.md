# ADR-025: The fal pack (ComfyUI-fal-API 2.5.0) goes into the packs repo and every image

**Date:** 2026-11-03
**Status:** Accepted **for now; to be revisited** (Lucas: "and doc the decision - we will revisit this later"). The open questions are listed at the end so the revisit starts from them.
**Extends:** ADR-020 (the image on `ghcr.io`), `docs/NODE-PACKS.md` (where the packs live). **Facts from:** the BH notes 118, 173, 176, 179 and the delivery builder `build-brynley-comfy-delivery.py` in the Panama console repo.

## Context

BH's graphs for `archival-071` use `FalAPI_*` nodes, for example `FalAPI_bytedance-seedance-2.0-image-to-video`. They come from one pack, **ComfyUI-fal-API 2.5.0** (`github.com/gokayfem/ComfyUI-fal-API`, Apache-2.0,
installed from the Comfy registry, no `.git` of its own), which registers the fal.ai catalog dynamically. That pack lived only in Kyle's Comfy Desktop `custom_nodes/fal-api`. Our repo, the packs submodule, Binc's mirror and our image had none of it
(BH note 176: "`fal-api` is not in `Dockerfile`, `build.sh` or `requirements-packs.txt`"), so any such graph failed on a pod with missing node types. BH ships the pack inside each round at `<shot>/nodes/fal-api-v2.5.0/` and never ships its `config.ini`, which holds Kyle's `FAL_KEY`.

## Decision

1. **Add the pack to the packs repo** as `portable/ComfyUI-fal-API` (`comfy-node-packs` commit `17b4d11`, tags `packs-2026-11-03` and `fal-api-2.5.0`). The bytes are the 90 files of the copy in the 22 Oct round, which had passed its manifest check (size and sha256); `__pycache__` and `config.ini` excluded. `LICENSE` (Apache-2.0) is kept in the folder.
   The packs repo's own `tools/manifest.py` was run with ComfyUI's Python (`COMFY_DIR`), with `fal-client` on a temporary path so the Mac environment was not changed, to regenerate `packs.json` and the docs: the pack registers **1,498 nodes** and it is `portable` (no machine path).
   Run without a ComfyUI checkout the tool falls back to a regex and **erases the existing node lists**: never commit its output from that mode.
2. **Every image and the Mac install get it.** `build.sh` stages and `setup.sh` links every pack that is not a ShotPipe version (that is how BincStereo is always there), so no change was needed to include it. `setup.sh` also installs its requirements into the Mac environment.
3. **No key, ever, in the image or the repo.** The pack's own `.gitignore` ignores `config.ini`; `config.ini.example` is the only config file in the folder; pods get no `FAL_KEY`. Without a key the pack loads, registers its nodes, logs `FAL_KEY is not configured` and each node fails when queued (seen in a ComfyUI import run on the Mac).
4. **The image installs its requirements safely.** The pack asks for `opencv-python`; the image already carries `opencv-python-headless`, and both together can break `import cv2` in a container without libGL. The Dockerfile now rewrites a pack's `opencv-python` to the headless build when it installs pack requirements,
   and a new build step fails the image if the fal pack is present and `fal_client` cannot be imported (the install loop has always ignored a failed install, so this would otherwise be silent).

## Verified (2026-11-03)

- The image built on GitHub Actions (its `fal_client` check passed, so the client library is in) and is labelled with the packs commit `17b4d11`.
- On a real pod from that image (a short-lived one, deleted after, about USD 0.06): `ComfyUI-fal-API` imported in 0.2 s and logged `Registered 1498 dynamic fal nodes (skipped 0, featured 22, 499 flagged as superseded within their family)` and `registered 10 /fal_api routes`, with `FAL_KEY is not configured` as a warning only. The ShotPipe packs and BincStereo still load beside it.
- **A side finding for ADR-024:** that pod ran on an NVIDIA RTX PRO 6000 Blackwell MIG 1g.24gb, the card the any-card setting picked because it was the only free one. PyTorch in the image (cu126) logged `CUDA capability sm_120 is not compatible with the current PyTorch installation`, so ComfyUI would not run GPU work on it. This is exactly why ADR-024 keeps the widening to jobs that never use the GPU.
- Not tested: a `FalAPI_*` node actually running (no key by design), and the Mac install with the pack linked.

## Why now, and why it is not final

It unblocks BH's fal graphs on a pod (note 176, item 6) and costs a few MB. It is a first pass: it puts a large third-party pack in front of every user of the image to solve one shot's graph, and the questions below were not settled.

## To revisit

- **Always on, or opt-in?** Today every image and every Mac install carries it (and its 1,498 nodes in the node search, and the import time). An opt-in variant (a named set `fal` in `sets.json`, `build.sh --with-fal`, a separate image tag) would keep the default image lean. This is the main question.
- **Spend.** `FalAPI_*` nodes call fal.ai with a `FAL_KEY`. This is outside the USD 100 RunPod cap and outside `approved_by`. BH note 176 found the ComfyUI bridge (`queue_prompt`) does not check for provider nodes. If a key ever reaches a pod, any queued graph can spend. Needed before that: how the key is supplied (a RunPod Secret, never baked, never in the configuration export or the repo),
  and a guard in the bridge (a `provider_nodes` check, as BH proposed for its packager). Until then, pods run without a key on purpose.
- **Versions and updates.** The folder has no version in its name (like BincStereo; the version is in `pyproject.toml`), which means an update rewrites the folder, against the packs repo's rule that `main` only gains folders. A versioned folder name cannot contain dots (`ComfyUI-fal-API-v2.5.0` would break the pack's relative imports; `...-v2_5_0` would work).
  The upstream has no tag we recorded: 2.5.0 from the Comfy registry is the only pin (BH note 173 corrected a wrong commit that was ComfyUI's, not the pack's).
- **Whose copy.** BH is the source of this pack's exact bytes; there is no upstream remote in the packs repo for it. Whether to track the registry or BH's copy.
- **Mac install.** `setup.sh` now installs `opencv-python` (the pack's requirement) into the Mac environment beside whatever OpenCV is there; not checked beyond the ComfyUI import run. Also whether the Mac should link it at all.
- **Attribution.** The Apache-2.0 `LICENSE` is in the folder; no NOTICE file or credit in our docs beyond this ADR and `NODE-PACKS.md`.

## Consequences

- Graphs with `FalAPI_*` nodes now load on our pods (they still cannot run without a key, by design).
- The packs repo grew by about 5.6 MB and 3,300 lines of generated docs; the image by the pack and `fal-client` with its dependencies.
- The Dockerfile's pack-requirements step changed (the OpenCV rewrite and the fal_client check); the image must be rebuilt (done in the same change, see the changelog).
