# ADR-042: the pinned image, SeedVR2's weights and VAE, and guarding the agent on binc-pc

**Status:** Partly built 2026-11-15 (the pin); the rest is proposed, with the open questions below.
**Context from:** Lucas ("bincs agent keeps bypassing our system"; "bincs agent says our key is unauthorized"; "can't we rebuild and pin image"; "seedvr2 is in comfy org isn't it?"; "can we use a dedicated volume on runpod for these weights"; "to stream them to the volume on build?"; "we also need to be able to choose vae"; "doc these issues").

## 1. The image tag moved (built)

`contract-v26` is re-pushed by every rebuild; it moved on 2026-11-14 at 20:58 UTC (digest `a06a461c…`, replacing the 19:04 and 19:05 builds), so pods created a day apart could run different contents. Fixed in ADR-020's amendment: `mounts.DEFAULT_IMAGE_REF` and the Default Configuration are the digest, `gpus.CU13_PINS` pairs it with the CUDA 13 digest (`116c2012…`), and the workflow tags `<variant>-<commit>` and prints the digest. **Open:** the merge, a release carrying the new default, and telling Binc the digest and what the 14 Nov rebuild changed (the commits after `7e1e94e`: round-nodes.sh, no workflow seeding, the converter's browser path).

## 2. "Our key is unauthorized" (diagnosed, not reproduced)

Checked from this Mac on 2026-11-15: the RunPod key works (balance returned), the BH bucket keys list ten rounds, and last night's pod pulled the private image, so the `ghcr.io` login worked then. Not set here: the Anthropic key. The agent that reported it is on **binc-pc**, which has its own config, so the likely causes are a missing or different key there. **Open:** the exact error text from binc-pc. `AccessDenied` is the bucket, `401` the RunPod key, `denied: access forbidden` the registry login (Registry auth ID in Default Configuration), `authentication_error` the Anthropic key.

## 3. Binc's agent goes around the system (guard written, not wired)

The spend gate (`approved_by`, USD 100) lives only in the pod-manager MCP. A shell can reach the same things (`runpodctl`, RunPod's REST/S3 endpoints, `start.sh pod create`, `aws s3 rm` on BH's bucket, writes into `projects/desktop/`), and `.claude/settings.json` has only an Edit/Write hook and no permissions. `.claude/hooks/guard-bash.sh` blocks those routes and names the MCP tool to use (tested on twelve sample commands). **Open:** register it in `.claude/settings.json` with a `Bash` matcher plus a `permissions` block, ship it to binc-pc through `shared/governance/` (nothing here reaches that machine), and get one real example of a bypass to see whether the cause is routing, stale docs, context or settings.

## 4. SeedVR2 (decided in part)

- The **nodes are in ComfyUI itself** (`comfy_extras/nodes_seedvr.py`, `comfy/ldm/seedvr/`) at the commit the image pins (`3c1b7a17…`): no node pack to add. The `FalAPI_*seedvr*` nodes in `ComfyUI-fal-API` are a cloud API and need no weights.
- The **weights are in no image and in no folder on this Mac**; the two volumes (`a3upg9ey48`, EU-RO-1; `kceera10qh`, EUR-IS-2) were not listed. Model size (3B or 7B, fp16 or fp8) is not chosen, and no graph of Binc's uses SeedVR2.
- **Where they live:** on the volume under `/workspace/comfy-shared/models` (`diffusion_models/`, `vae/`), about 7 to 16 GB, USD 0.07 per GB per month. Not baked into the image (7 to 16 GB on every pod pull). A pod mounts one network volume only, and only one in its own datacenter, so a "dedicated weights volume" cannot sit beside the workspace volume: the options are the workspace volumes themselves, or a master copy that Clone copies per datacenter.
- **Putting them there:** a build cannot write to a volume (the runner mounts nothing). RunPod's S3 API can, from any machine with no pod, but only in S3 datacenters: EU-RO-1 is one, EUR-IS-2 is not in `S3_DATACENTERS` (the list has `EUR-IS-1`; check RunPod's current list). It needs RunPod S3 keys as GitHub secrets, which do not exist yet. Otherwise a short pod runs one download (cents, any datacenter). Proposed: a separate manually triggered workflow or a small script with a manifest (file, URL, sha256, destination), idempotent, size-checked; not part of the image build.

## 5. Choosing the VAE

ComfyUI lists every file in `models/vae` in its VAE loader, and it recognises SeedVR2's VAE by its contents (`comfy/sd.py`: the `decoder.up_blocks.2.upsamplers.0.upscale_conv.weight` key), not by name. So choosing a VAE needs no code in the image: it is whichever files are on the volume. The weights manifest should therefore list **every** VAE we want selectable, not one, and a graph picks by file name. **Open:** which VAE files (the SeedVR2 one, and any others for other graphs), and whether the app should show what is in `models/vae` on the volume (Browse already lists folders).

## 6. Built 2026-11-15: a model choice per pod

`libs/core/src/podmodels.ts` keeps, per pod (`pod-models.json`, dropped with the pod), a **VAE** (`VAELoader.vae_name`) and a **diffusion model** (`UNETLoader.unet_name`). `runflows.run` puts the choice into each converted graph that has exactly one loader of that class; with two or none it leaves the graph alone and names it in the result (`models`). `runflows.models(pod)` lists the files the pod's ComfyUI offers (`/object_info/<loader>`), so whatever is on the volume can be picked and **nothing is baked into the image or downloaded by the app**. MCP: `pod_models` (read, and set with `vae` / `diffusion_model`; empty clears). Tests: `libs/core/tests/podmodels.test.ts`. **Defaults travel:** the Default Configuration has `models` (`vae`, `diffusion_model`; Default VAE / diffusion model fields in the window), used by every pod without its own choice (`podmodels.effective`); it is in the *Pod defaults* section of the configuration export and import (ADR-023). The per-pod choices are not exported (a pod id means nothing on another machine; listed in `NOT_EXPORTED`). The S3 keys and the pinned `image` already travel (the *Keys and tokens* and *Image* sections). **Not built:** the per-pod picker in the Run workflows window, and the weights manifest and download script.

## 7. Where the weights go: all of them, on the volume

Every variant (3B and 7B, fp16 and fp8, and the VAEs) is kept on the volume under `models/`, about 35 to 45 GB (estimate, not measured), roughly USD 2.50 to 3 a month; each pod chooses at run time (section 6). Not streamed at run time (a billed pod waits for the download, and Hugging Face may refuse it); not baked into the image. The S3 route needs RunPod S3 keys: Settings, S3 API Keys in the RunPod console, then Default Configuration's S3 fields (or the Add S3 keys button in the volume browser). **Update:** S3 keys added 2026-11-15 and proven (a free listing of `a3upg9ey48`); the volume holds 89 GB of 250. Files, from `Comfy-Org/SeedVR2` on Hugging Face (Apache-2.0): `diffusion_models/seedvr2_3b_fp16` 6.78 GB, `seedvr2_3b_fp8_e4m3fn` 3.39 GB, `seedvr2_7b_fp16` 16.48 GB, `seedvr2_7b_fp8_e4m3fn` 8.24 GB (each `.safetensors`), and `vae/seedvr2_ema_vae_fp16.safetensors` 0.5 GB. They stay on the volume, mounted into pods, not in the image (the registry's 10 GB layer limit would also stop the 7B fp16). **Open:** the transfer: from this Mac over the S3 API (no spend, but the uplink is the limit) or by a short pod downloading directly (cents, fast, needs a named yes). Previously: free space on `a3upg9ey48` (it holds rounds), a named yes for the pod or the transfer, and the exact file names from the official template.

## 8. What the SeedVR2 files are

SeedVR2 is a video and image upscaler. ComfyUI has its nodes built in (`comfy_extras/nodes_seedvr.py`: `SeedVR2Preprocess`, `SeedVR2Conditioning`, `SeedVR2TemporalChunk`, `SeedVR2TemporalMerge`, `SeedVR2PostProcessing`); only its **weights** are missing from the image, and they are kept on the volume, never in the image. Source: Hugging Face `Comfy-Org/SeedVR2` (Apache-2.0). Sizes as listed there on 2026-11-15.

| File | Goes in | Size | What it is |
|---|---|---|---|
| `seedvr2_3b_fp16.safetensors` | `models/diffusion_models/` | 6.78 GB | The upscaler network, 3 billion parameters, full 16-bit precision. The safe default. |
| `seedvr2_3b_fp8_e4m3fn.safetensors` | `models/diffusion_models/` | 3.39 GB | The same, 8-bit: half the size and memory, slightly lower quality. |
| `seedvr2_7b_fp16.safetensors` | `models/diffusion_models/` | 16.48 GB | 7 billion parameters, 16-bit: the best quality, the most VRAM. Over the registry's 10 GB layer limit, so it could not be baked into an image anyway. |
| `seedvr2_7b_fp8_e4m3fn.safetensors` | `models/diffusion_models/` | 8.24 GB | 7 billion, 8-bit: near the 7B quality in about half the memory. |
| `seedvr2_ema_vae_fp16.safetensors` | `models/vae/` | 0.5 GB | The VAE: encodes frames into SeedVR2's latent space and decodes the result. Every SeedVR2 graph needs it, whichever network is chosen. ComfyUI recognises it by its contents, not its name. |

A graph uses **one** diffusion model and **one** VAE. Which ones a pod uses is the pod's choice (section 6), so having all four on the volume costs only storage (about 35 GB, USD 2.50 a month); nothing is loaded into a pod's memory until a graph names it. The Comfy-Org repack also has `sharp`, int8, mxfp8 and nvfp4 variants of the 7B and 3B networks; they are not fetched.

Status 2026-11-15: the VAE is on `a3upg9ey48` (`comfy-shared/models/vae/seedvr2_ema_vae_fp16.safetensors`, 478.1 MiB, uploaded over the S3 API at about 2.5 MB/s); the four networks are not yet (approved by Lucas for a short pod; the Mac's uplink would take about four hours). The 110 to 124 byte files already in `diffusion_models/` and `vae/` are placeholders, not weights.

## Consequences

- One tag no longer means two images; Blackwell cards keep their CUDA 13 build.
- Anything a shell can do to bypass the gate stays possible until the guard is wired and shipped; it is a heuristic, not a proof.
- Until the weights and VAE choice are decided, nothing is downloaded and nothing is spent on this.
