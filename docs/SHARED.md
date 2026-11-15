# Shared: what lives on the Shared volume and in the image

Sections: [Models](#models) · [Custom nodes](#custom-nodes) · [Image dependencies](#image-dependencies). Models go on the volume; nodes and Python dependencies go in the image (ADR-042).

Source list: `comfy-shared/models/_canalv2_pull/MODELS_PULL_v003.csv` on the Shared volume (40 files, 307.9 GB). Models live on the volume, never in the image (ADR-042).

## Models

### How to load them

1. **Grow the volume first.** The Shared volume must hold the total below plus what is already on it. Volumes cost about $0.07/GB/month; RunPod volumes can only grow.
2. **Gated files need a Hugging Face token** and the account's acceptance of the gate (e.g. `Lightricks/LTX-2.3-22b-IC-LoRA-HDR`, accept as Binko65). Set the token in Default Configuration (Keys, from huggingface.co/settings/tokens, read access): a gated file is then listed with real hashes and loads; without it the file is listed with a gated badge and cannot be loaded, and the message says so (ADR-042 section 14).
3. In **Shared → Models**, search the repo, pick the file and folder, Fetch. A short pod runs `curl -C -` with size and sha256 checks and is deleted when done (about $0.07 for 10 GB). Do one pipeline at a time.
4. Files whose destination is not `models/` (`depth_anything_v2_vitl.pth`, controlnet_aux ckpts) need a separate destination.

### Totals by pipeline

| Pipeline | Files | GB |
|---|---|---|
| stereo | 3 | 3.4 |
| gen-fill | 6 | 44.0 |
| ltx-2.5 | 9 | 110.8 |
| h3 | 6 | 46.7 |
| upscale | 2 | 7.3 |
| roto | 2 | 1.1 |
| ltx-2.3 | 12 | 94.7 |

### Files

#### stereo

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `depth_anything_v2_vitl.pth` | custom_nodes ckpts (controlnet_aux) | `depth-anything/Depth-Anything-V2-Large` | 1.3 | DepthAnythingV2Preprocessor (H3 control graphs) |
| `depth_anything_v2_vitl_fp32.safetensors` | depthanything/ | `Kijai/DepthAnythingV2-safetensors` | 1.3 | kijai ComfyUI-DepthAnythingV2 (PC) |
| `depth_anything_v2_vitl_fp16.safetensors` | depthanything/ | `Kijai/DepthAnythingV2-safetensors` | 0.7 |  |

#### gen-fill

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `flux-2-klein-4b.safetensors` | diffusion_models/ | `Comfy-Org/Flux-2-Klein-4B` | 7.8 | also on 2TbBlue PC backup |
| `flux-2-klein-9b-fp8.safetensors` | diffusion_models/ | `black-forest-labs/FLUX.2-klein-9b-fp8` | 9.4 | gated (HF token); also on 2TbBlue PC backup |
| `flux2-vae.safetensors` | vae/ | `Comfy-Org/Flux-2-Klein-4B` | 0.3 |  |
| `qwen_3_4b.safetensors` | text_encoders/ | `Comfy-Org/Flux-2-Klein-4B` | 8.0 |  |
| `qwen_3_8b_fp8mixed.safetensors` | text_encoders/ | `Comfy-Org/Flux-2-Klein-9B` | 8.7 |  |
| `t5xxl_fp16.safetensors` | text_encoders/ | `comfyanonymous/flux_text_encoders` | 9.8 | PC (flux.1 controlnet route) |

#### ltx-2.5

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` | diffusion_models/ | `Lightricks/LTX-2.5` | 21.5 | gated (HF token) |
| `ltx-2.5-22b-distilled-transformer-bf16.safetensors` | diffusion_models/ | `Lightricks/LTX-2.5` | 42.0 | used by some graphs |
| `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` | text_encoders/ | `Lightricks/LTX-2.5` | 15.4 |  |
| `gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` | text_encoders/ | `Lightricks/LTX-2.5` | 26.3 |  |
| `ltx-2.5-video-vae-bf16.safetensors` | vae/ | `Lightricks/LTX-2.5` | 1.5 |  |
| `ltx-2.5-video-vae-conv-bf16.safetensors` | vae/ | `Lightricks/LTX-2.5` | 1.5 |  |
| `ltx-2.5-audio-vae-bf16.safetensors` | vae/ | `Lightricks/LTX-2.5` | 0.4 |  |
| `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` | latent_upscale_models/ | `Lightricks/LTX-2.5` | 1.0 |  |
| `ltx-2.5-22b-ic-lora-layout-to-render-1.0.safetensors` | loras/ltx2/ | `Lightricks/LTX-2.5-22b-IC-LoRA-Layout-To-Render` | 1.3 |  |

#### h3

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | diffusion_models/ | `Comfy-Org/MiniMax-H3` | 21.0 |  |
| `minimax_h3_fun_controlnet_union_pruned_int8_convrot.safetensors` | model_patches/ | `Comfy-Org/MiniMax-H3` | 2.3 |  |
| `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | text_encoders/ | `Comfy-Org/MiniMax-H3` | 15.7 | nvfp4 needs Blackwell-class GPU for speed |
| `minimax_h3_video_vae_fp16.safetensors` | vae/ | `Comfy-Org/MiniMax-H3` | 5.2 |  |
| `minimax_h3_audio_vae_fp32.safetensors` | vae/ | `Comfy-Org/MiniMax-H3` | 0.6 |  |
| `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16-minimax-h3-reference-t-pujCC7E7.safetensors` | loras/ | `Comfy-Org/MiniMax-H3` | 2.0 | saved under the graph's (Floyo) filename |

#### upscale

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `seedvr2_ema_3b_fp16.safetensors` | SEEDVR2/ | `numz/SeedVR2_comfyUI` | 6.8 |  |
| `ema_vae_fp16.safetensors` | SEEDVR2/ | `numz/SeedVR2_comfyUI` | 0.5 |  |

#### roto

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `sam2.1_hiera_base_plus-fp16.safetensors` | sam2/ | `Kijai/sam2-safetensors` | 0.2 | PC |
| `sam2.1_hiera_large.safetensors` | sam2/ | `Kijai/sam2-safetensors` | 0.9 |  |

#### ltx-2.3

| File | Install to | Hugging Face repo | GB | Notes |
|---|---|---|---|---|
| `ltx-2.3-22b-dev.safetensors` | checkpoints/ltx-2.3/ | `Lightricks/LTX-2.3` | 46.1 | graphs also load it from diffusion root |
| `ltx-2.3-22b-distilled-lora-384.safetensors` | loras/ | `Lightricks/LTX-2.3` | 7.6 |  |
| `ltx-2.3-spatial-upscaler-x2-1.1.safetensors` | latent_upscale_models/ | `Lightricks/LTX-2.3` | 1.0 | graphs name x2-1.0 (not on HF now) |
| `gemma_3_12B_it_fp8_scaled.safetensors` | text_encoders/ | `Comfy-Org/ltx-2` | 13.2 |  |
| `gemma_3_12B_it_fp4_mixed.safetensors` | text_encoders/ | `Comfy-Org/ltx-2` | 9.4 |  |
| `ltx-2.3-22b-dev-Q3_K_S.gguf` | unet/ | `unsloth/LTX-2.3-GGUF` | 9.9 |  |
| `ltx-2.3-22b-ic-lora-union-control-ref0.5-ltx-2-3-ic-lora-control-MplWpT-2.safetensors` | loras/ | `Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control` | 0.7 | saved under the graph's (Floyo) filename |
| `ltx-2.3_text_projection_bf16.safetensors` | text_encoders/ | `Kijai/LTX2.3_comfy` | 2.3 |  |
| `ltx-2.3-22b-distilled-lora-dynamic_fro09_avg_rank_105_bf16.safetensors` | loras/ltx2/ | `Kijai/LTX2.3_comfy` | 2.6 |  |
| `LTX23_audio_vae_bf16.safetensors` | vae/ | `Kijai/LTX2.3_comfy` | 0.4 |  |
| `LTX23_video_vae_bf16.safetensors` | vae/ | `Kijai/LTX2.3_comfy` | 1.5 |  |
| `taeltx2_3.safetensors` | vae_approx/ | `Kijai/LTX2.3_comfy` | 0.0 | graphs load it with VAELoader; also place in vae/ if needed |

### Already installed (about 10 GB)

Depth Anything V2 Large fp32 and fp16, SeedVR2 3B fp16 and VAE, SAM 2.1 base+ and large. Extra test file: `vae/seedvr2_ema_vae_fp16.safetensors`.

### Wanted models list

The names of the models you want on a Shared volume, kept in the configuration and exported with it (section *Wanted models*), so a new machine or a new datacenter can be filled from the same list (ADR-042 section 12). Open Shared > Models: add files from a search (*Add to wanted list*), record what the volume holds (*Saved List*) or add Binc's list above (*Install Defaults*, read off the volume or pasted). Each row shows whether the volume has it; *Load Missing* fetches the rest from Hugging Face in jobs of 20 files, and warns when the volume is too small. MCP: `models_wanted`, `models_wanted_add`, `models_wanted_remove`, `models_load_wanted`.

### Deleting models already on the volume

Shared > Models lists what the volume holds ("Already on the volume"). Tick files (or use a row's trash icon) and press *Delete selected*: the app asks first and lists the files and the GB; the files are removed from `comfy-shared/models/` (over RunPod's S3 API with no pod when the volume has it, else by a short pod). The `_canalv2_pull` folder is never deleted from. A deleted model stays in the wanted list and shows as missing. MCP: `models_delete` with `confirmed: true`. Details: ADR-042 section 15.

### A download survives dropped connections

The download runs detached on its pod and the app follows its log with short ssh calls (ADR-042 section 17). A dropped connection shows *Reconnecting (Attempt n)* and the download carries on; if the pod cannot be reached for ten minutes the job is *Interrupted* and the pod is kept, listed in the Queue with **Reattach** and **Delete Pod**. Cancel stops the script on the pod.

### Download progress and volume jobs

While Load Missing or a Hugging Face load runs, Shared > Models shows the job live: *Creating Pod*, *Pod Starting*, *Connecting (SSH)*, *Downloading File 2 Of 5* with a bar (*file i of n: name - X of Y GB (rate, ETA)*), *Verifying Checksum*, *Done*; Cancel is at the right of the row. A wanted row whose `<name>.part` is on the volume says *Downloading N%* (or *Partial N%* if no download is running; Load Missing resumes it). The Queue has a *Volume Jobs* section (downloads, deletes, erases, clones, browses) and lists a pod the app lost at a restart as *Interrupted (No Job)* with *Delete Pod*. MCP: `volume_jobs`. See ADR-042 section 16.

## Custom nodes

### Packs in the repo (`shared/nodes/packs.json`)

| Pack | Nodes | In the pinned image | Sample nodes |
|---|---|---|---|
| ComfyUI-BH-ShotPipe-v6 | 21 | no | `BH_Anaglyph`, `BH_CDL`, `BH_CarryLayer`, `BH_CarryToEye` |
| ComfyUI-BH-ShotPipe-v7 | 25 | yes | `BH_Anaglyph`, `BH_CDL`, `BH_CarryLayer`, `BH_CarryToEye` |
| ComfyUI-BH-ShotPipe-v8 | 3 | no | `BH_CarryLayerV8`, `BH_StabiliseHull`, `BH_StereoWarp` |
| ComfyUI-BH-ShotPipe-v9 | 1 | no | `BH_CarryLayerMesh` |
| ComfyUI-BH-ShotPipe-v10 | 2 | yes | `BH_CarryLayerMesh`, `BH_RenderMp4` |
| ComfyUI-BH-ShotPipe-v11 | 1 | yes | `BH_LockedSolve` |
| ComfyUI-BH-ShotPipe-v12 | 1 | yes | `BH_WriteProxySeq` |
| ComfyUI-BH-ShotPipe-v13 | 1 | yes | `BH_TrackTolerance` |
| ComfyUI-BH-ShotPipe-v14 | 4 | yes | `BH_CarryLayerExact`, `BH_DetailReinject`, `BH_SolveHealth`, `BH_TrackSolveReseed` |
| ComfyUI-BH-ShotPipe-v15 | 9 | no | `BH15_CompToPlate`, `BH15_CurveApply`, `BH15_CurveFit`, `BH15_GenStandIn` |
| ComfyUI-BH-ShotPipe-v16 | 1 | no | `BH16_PointStabilise` |
| ComfyUI-BH-ShotPipe-v17 | 1 | no | `BH17_CarryStillToPlate` |
| ComfyUI-BH-ShotPipe-v20 | 3 | no | `BH20_CarryStill`, `BH20_PlateFrameImage`, `BH20_SurfaceSolve` |
| ComfyUI-BH-ShotPipe-v21 | 3 | no | `BH21_CarryStill`, `BH21_PlateFrameImage`, `BH21_SurfaceSolve` |
| ComfyUI-BH-ShotPipe-v22 | 2 | no | `BH22_CarryStillPatches`, `BH22_PatchSolve` |
| ComfyUI-BH-ShotPipe-v23 | 4 | no | `BH23_CarryObjects`, `BH23_Object`, `BH23_ObjectList`, `BH23_ObjectSolve` |
| ComfyUI-BH-ShotPipe-v24 | 6 | no | `BH24_CarryObjects`, `BH24_Object`, `BH24_ObjectList`, `BH24_ObjectSolve` |
| ComfyUI-BH-ShotPipe-v25 | 7 | no | `BH25_CarryObjects`, `BH25_Object`, `BH25_ObjectList`, `BH25_ObjectSolve` |
| ComfyUI-BH-ShotPipe-v26 | 3 | yes | `BH26_ObjectSolve`, `BH26_RefineToLead`, `BH26_StickCheck` |
| ComfyUI-BincStereo | 6 | yes | `BincDepthAnythingV2`, `BincDepthTemporalFilter`, `BincLoadImageSequence`, `BincStereoFromDepth` |
| ComfyUI-fal-API | 1625 | no | `Bria_Video_Increase_Resolution_fal`, `CombinedVideoGeneration_fal`, `DYWanFun22_fal`, `DYWanUpscaler_fal` |

### Nodes Binc asked about

| Node | Provided by | In the pinned image |
|---|---|---|
| `BH_ReadSequence` | ComfyUI-BH-ShotPipe-v6, ComfyUI-BH-ShotPipe-v7 | yes |
| `BH_ReadStill` | ComfyUI-BH-ShotPipe-v6, ComfyUI-BH-ShotPipe-v7 | yes |
| `BincSeqToImage` | ComfyUI-BincPlateIO-v004 | yes (tested on a pod) |
| `BincWriteGenDPX_v002` | ComfyUI-BincGenDPX-v002 | yes (tested on a pod) |
| `OCIOVAEDecode` | ComfyUI-OCIO | yes (tested on a pod) |

### Needed but not in the image

- **ComfyUI-BincGenDPX-v002, ComfyUI-BincPlateIO-v004**: from Binc's `BH_loaders_and_DPX_writer_mac8194_20261115_v002` package (Downloads, 15 Nov); in `comfy-node-packs`, staged by the next build. PlateIO needs ShotPipe v7 (in the image) and OpenImageIO.
- **ComfyUI-OCIO** (`OCIOVAEDecode`, EXR read/write): now in `comfy-node-packs` (`ef909b2`), so the next image build stages it; the pinned digest predates it.
- **ComfyUI-LTXVideo**: now in `comfy-node-packs` (`ef909b2`, LTX-2 Community License: keep repo and image private), staged by the next build; Binc reports it fails to import on both Macs, so test it on a pod first.
- **SeedVR2**: ComfyUI core node in v0.39.2; weights are on the Shared volume, not a pack.
- **MoGe** (`LoadMoGeModel`, `MoGeInference`, `MoGeGeometryToFOV`): ComfyUI core nodes (`cnr_id: comfy-core` in Binc's graphs), no pack needed. `MoGeRender` and `MoGePointMapToMesh` are not confirmed core.
- Core ComfyUI nodes used by graphs (PreviewImage, ImageScaleBy, MaskToImage, SaveGLB, ...) need nothing.


### Still to load (read from volume `a3upg9ey48`, 15 Nov)

281.4 GB of the 307.9 GB list is not on `a3upg9ey48` (250 GB, EU-RO-1): ltx-2.5 110.8, ltx-2.3 94.7, h3 46.7, gen-fill 27.9, stereo 1.3. SeedVR2 3B and VAE, Depth Anything V2 Large and SAM 2.1 are installed. `comfy-workspace` (`kceera10qh`, 2.2 TB, EUR-IS-2, no S3 API) has not been checked.

## Image dependencies

- Base: `pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime` (CUDA 13 variant for Blackwell cards), torch 2.12.1, Python 3.13.
- ComfyUI v0.39.2, commit `3c1b7a17fdf239d35ce98cc777756f572d089795` (BH says 0.36.0; the Mac is on 0.39.2). Its `requirements.txt` and `manager_requirements.txt` are installed.
- Extra Python packages for the packs: `apps/comfy-app/requirements-packs.txt`; each pack's own `requirements.txt` too, with `opencv-python` swapped for the headless build.
- System: openssh-server, rsync, rclone, headless Chromium (Playwright at `/opt/playwright`) for `ui2api.py`.
- Image built 15 Nov with the OCIO, LTXVideo, BincPlateIO and BincGenDPX packs and the extra model folders (CUDA 12.6): `ghcr.io/bluecollardev/comfy-app@sha256:2e86f1da319474030d59e459bda31576f57ef0bbe9a2f23eba9ab0ad592bd3e9` (tag `contract-v26-7825d00`). Tested on a pod (RTX 4090, EU-RO-1) with the previous build `38f40fb6…`: OCIO, Binc DPX and sequence nodes, BH loaders and 84 LTX nodes load.
- Default Configuration still pins the older `@sha256:a06a461ce3b38c6a3badf9cd7d47e77f12247a38785511f8b4ca077aedb4d457` (CUDA 13: `@sha256:116c2012a094e627623c3883ef96dd1c6f828d97009064371d9556be81eac43a`); no CUDA 13 build of the new image yet.
- Model folders mapped from the Shared volume (`docker/extra_model_paths.yaml`): checkpoints, clip, clip_vision, controlnet, diffusion_models, embeddings, loras, upscale_models, vae, text_encoders, vae_approx, latent_upscale_models, model_patches, unet, depthanything, sam2, SEEDVR2.
- In the image since the 15 Nov build: ComfyUI-OCIO, ComfyUI-LTXVideo, ComfyUI-BincGenDPX-v002, ComfyUI-BincPlateIO-v004. A second LTX copy that arrives with Binc's round (`ComfyUI-LTXVideo-<hash>`, missing `nodes_registry.py`) fails to import; ours loads.
