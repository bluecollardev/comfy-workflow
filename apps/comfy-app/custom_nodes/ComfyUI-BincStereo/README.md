# ComfyUI-BincStereo

Stereoscopic conversion component for ComfyUI: mono frames + depth → left/right eyes, SBS, anaglyph, parallax report. Pure torch, no third-party node packs, no pip step. CPU / CUDA / MPS.

Version 0.2.0 · Cinematic Immunity / Bincos · internal.

## Contents

```
ComfyUI-BincStereo/
  __init__.py              node registration
  binc_stereo.py           Stereo from Depth · Stereo Pack · Parallax Report
  binc_depth.py            Depth Anything V2 · Depth Temporal Filter
  binc_io.py               Load Image Sequence
  models/                  depth weights live here (see Requirements)
  test-input/              one frame + one depth map (1080p) for the verification graph
  workflows/
    binc-stereo-smoke-test.json     verification graph — previews only, no weights needed
    binc-stereo-video-chain.json    video → depth → temporal filter → stereo → SBS + eyes
  tests/test_headless.py   runs without ComfyUI
```

## Requirements

- ComfyUI with **torch ≥ 2.1** (any recent build).
- **transformers ≥ 4.50** — only for the *Depth Anything V2* node; the stereo nodes do not import it. Ships with ComfyUI ≥ 0.3.x.
- **Depth weights** (only if you use the DA2 node): an HF-format folder — `config.json`, `model.safetensors`, `preprocessor_config.json` — placed at **`<this package>/models/<name>/`** (bundled, zero setup) or `ComfyUI/models/depth_anything/<name>/`. Source: `huggingface.co/depth-anything/Depth-Anything-V2-Large-hf` (Base / Small / Metric variants work the same). The node's `hf_repo_id` field can fetch one on first run if the machine has Hub access.

## Install

Copy the folder to `ComfyUI/custom_nodes/ComfyUI-BincStereo/`, restart ComfyUI. Nodes appear under **Binc/Stereo**.

## Verify

1. Copy `test-input/` to `ComfyUI/input/binc-stereo-test/`.
2. Load `workflows/binc-stereo-smoke-test.json`, Queue.
3. Pass = no red nodes; anaglyph shows red/cyan separation growing toward the camera; `parallax_vis` reads near = dark; `report.summary.ok` is `true`.

Headless, without ComfyUI: `python -I tests/test_headless.py`.

## Nodes

### Binc · Stereo from Depth
`image` (B,H,W,3) + `depth` (IMAGE, or `depth_mask` MASK) → `left`, `right`, `sbs` (left-first), `anaglyph`, `parallax_vis`, `holes`, `depth_hull`, `report` (JSON).

| Parameter | Meaning |
|---|---|
| `depth_polarity` | `near_is_bright` (Depth Anything style) or `near_is_dark` |
| `convergence` | depth value (0–1) that sits on the screen plane; constant for the clip |
| `near_parallax_pct` | max parallax **in front** of screen at depth = 1, % of frame width |
| `far_parallax_pct` | max parallax **behind** screen at depth = 0, % of frame width (divergence ceiling) |
| `depth_gamma` | shapes the depth map before mapping (1.0 = linear) |
| `eye_mode` | `symmetric` (both eyes ±½ parallax) · `right_only` (plate = left eye) · `left_only` |
| `hull_px` | silhouette hull: > 0 dilates near depth outward so edge fringe rides with the foreground; < 0 erodes; 0 off |
| `hull_feather_px` / `hull_edge_threshold` | bounds the disparity gradient at contours; only the edge band is touched |
| `hole_fill` | `background_pushpull` (isotropic fill seeded from background pixels only) · `background_stretch` (1-D) · `black` (leave holes) |
| `fill_depth_tol` / `fill_dilate_px` / `fill_feather_px` | fill gating, seam overlap, in-hole feather |
| `left_fill` / `right_fill` | optional externally inpainted eyes, composited inside holes only |

Sign convention: **+** parallax = behind screen, **−** = in front. Right eye `x + p/2`, left eye `x − p/2`. SBS is left-first.

`report` carries per-frame min/max/mean parallax (% and px), hole %, budget flags, and every parameter.

### Binc · Stereo Pack
`left` + `right` → `sbs_full` · `sbs_half` · `over_under_full` · `over_under_half` · `interleaved_rows` · `anaglyph` · `left` · `right`; `left_first` and `swap_eyes` toggles.

### Binc · Stereo Parallax Report
Depth + budget → the same JSON report without warping. Audit a depth sequence before rendering.

### Binc · Depth Anything V2
Image batch → depth (brighter = nearer). `max_side` = inference resolution (multiple of 14; attention is quadratic, start ≈ 1036 for 4K). `normalise = sequence_percentile` maps the whole batch with one lo/hi so a single `convergence` holds across a clip; `per_frame_minmax` for stills. Metric variants are flipped automatically.

### Binc · Depth Temporal Filter
Per-pixel temporal median-N + symmetric (no-lag) EMA, with `edge_preserve` so sustained depth steps survive. Chunked over time. Emits a jitter report: mean / p99 adjacent-frame |Δ| in 8-bit levels, raw vs filtered.

### Binc · Load Image Sequence
Numbered image folder (8/16-bit PNG, TIFF, JPG) → one IMAGE batch, with `start`/`count` to line up with an `ImageFromBatch` window on the video side. For depth sets and painted-depth returns.

## Method

The plate is treated as the cyclopean (centre) view. Foreground regions get a silhouette hull (grey-level dilation of near depth + bounded-gradient feather, edge band only); both eyes are warped from that one depth so the object boundary is identical in L and R. Warp is a deterministic depth-ordered forward splat (nearest wins; identical input → identical output). Holes take their background reference from the farther horizontal neighbour; any nearer pixel is excluded as a source; the hole is filled by pull-push diffusion from the remaining background at all scales, then feathered inside the hole only.

## Notes

- Depth must be normalised per sequence, not per frame, or convergence pumps shot-to-shot.
- Confirm polarity on `parallax_vis` before trusting anything: near = dark.
- A 4K float batch is ~100 MB per frame in each tensor; trim long clips to windows with `ImageFromBatch`.
- Output nodes in the bundled graphs are core `SaveVideo` / `SaveImage` with codec on `auto`; set codec and bit depth to your delivery spec.
