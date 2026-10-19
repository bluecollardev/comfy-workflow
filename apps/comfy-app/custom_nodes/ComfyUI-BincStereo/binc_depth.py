"""
ComfyUI-BincStereo — depth side.

  BincDepthAnythingV2     Depth Anything V2 (relative or metric) via transformers, which ComfyUI already ships.
                          No third-party custom node needed. Sequence-consistent normalisation so one
                          convergence value holds for a whole shot.
  BincDepthTemporalFilter per-pixel temporal median-N + no-lag EMA over a frame batch, in-graph.

Model files
-----------
HF-format model folders (config.json + model.safetensors + preprocessor_config.json) are found in, in order:
    <this package>/models/<folder>/                 (bundled with the component — zero-setup hand-over)
    ComfyUI/models/depth_anything/<folder>/
e.g.  depth-anything/Depth-Anything-V2-Large-hf  ->  models/Depth-Anything-V2-Large-hf/
Metric variants (…-Metric-Indoor/Outdoor-…-hf) work the same; their output is metres (larger = farther),
which this node flips so the IMAGE output is always brighter = nearer.
A bare HF repo id can also be typed in `hf_repo_id` if the machine has Hub access.
"""

import os

import time

import torch
import torch.nn.functional as F

try:
    from .binc_io import resource_snapshot, progress_bar
except Exception:  # headless tests
    from binc_io import resource_snapshot, progress_bar

try:
    import folder_paths
    _MODELS_DIR = os.path.join(folder_paths.models_dir, "depth_anything")
except Exception:  # headless tests
    folder_paths = None
    _MODELS_DIR = os.path.join(os.path.dirname(__file__), "models", "depth_anything")


_PKG_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
_SEARCH_DIRS = [_PKG_MODELS_DIR, _MODELS_DIR]      # package-bundled weights first, then ComfyUI/models/depth_anything


def _list_local_models():
    out = []
    for base in _SEARCH_DIRS:
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            p = os.path.join(base, name)
            if os.path.isdir(p) and os.path.exists(os.path.join(p, "config.json")) and name not in out:
                out.append(name)
    return out


def _resolve_model(source: str) -> str:
    if os.path.isabs(source) and os.path.isdir(source):
        return source
    for base in _SEARCH_DIRS:
        p = os.path.join(base, source)
        if os.path.isdir(p):
            return p
    return source                                   # HF repo id


def _pick_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


_MODEL_CACHE = {}


def load_da2(source: str, dtype: str):
    """source = local folder name under models/depth_anything, an absolute path, or an HF repo id."""
    from transformers import AutoModelForDepthEstimation
    key = (source, dtype)
    if key in _MODEL_CACHE:
        return _MODEL_CACHE[key]
    path = _resolve_model(source)
    td = {"default": None, "fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}[dtype]
    kw = {"torch_dtype": td} if td is not None else {}
    model = AutoModelForDepthEstimation.from_pretrained(path, **kw).eval()
    is_metric = bool(getattr(model.config, "depth_estimation_type", "relative") == "metric")
    _MODEL_CACHE[key] = (model, is_metric)
    return model, is_metric


def _prep(img_bhwc: torch.Tensor, max_side: int):
    """Resize so longest side = max_side (0 = native), both dims multiple of 14, ImageNet-normalise. -> (B,3,h,w)"""
    x = img_bhwc[..., :3].permute(0, 3, 1, 2).float()
    B, C, H, W = x.shape
    if max_side > 0:
        s = max_side / max(H, W)
        nh, nw = max(14, int(round(H * s / 14)) * 14), max(14, int(round(W * s / 14)) * 14)
    else:
        nh, nw = max(14, int(round(H / 14)) * 14), max(14, int(round(W / 14)) * 14)
    if (nh, nw) != (H, W):
        x = F.interpolate(x, size=(nh, nw), mode="bicubic", align_corners=False).clamp(0, 1)
    mean = torch.tensor([0.485, 0.456, 0.406], device=x.device).view(1, 3, 1, 1)
    std = torch.tensor([0.229, 0.224, 0.225], device=x.device).view(1, 3, 1, 1)
    return (x - mean) / std


@torch.no_grad()
def run_da2(model, images: torch.Tensor, max_side: int, batch_size: int, device) -> torch.Tensor:
    """images (B,H,W,3) in [0,1] -> raw model output (B,H,W) float32 on CPU, resized back to H,W."""
    B, H, W, _ = images.shape
    model.to(device)
    p = next(model.parameters())
    outs = []
    pbar = progress_bar((B + batch_size - 1) // max(1, batch_size))
    for i in range(0, B, max(1, batch_size)):
        x = _prep(images[i:i + batch_size].to(device), max_side).to(p.dtype)
        y = model(pixel_values=x).predicted_depth          # (b,h,w)
        if y.dim() == 3:
            y = y.unsqueeze(1)
        y = F.interpolate(y.float(), size=(H, W), mode="bicubic", align_corners=False).squeeze(1)
        outs.append(y.cpu())
        del x, y
        if pbar:
            pbar.update(1)
    return torch.cat(outs, 0)


def normalise_sequence(raw: torch.Tensor, mode: str, lo_pct: float, hi_pct: float) -> torch.Tensor:
    """raw (B,H,W), larger = nearer.  -> [0,1] brighter = nearer."""
    if mode == "raw":
        return raw.clamp(0, 1)
    if mode == "per_frame_minmax":
        lo = raw.flatten(1).min(1).values.view(-1, 1, 1)
        hi = raw.flatten(1).max(1).values.view(-1, 1, 1)
        return ((raw - lo) / (hi - lo).clamp(min=1e-6)).clamp(0, 1)
    # sequence-wide, robust percentiles (subsampled for memory)
    flat = raw.flatten()
    if flat.numel() > 4_000_000:
        idx = torch.randperm(flat.numel(), generator=torch.Generator().manual_seed(0))[:4_000_000]
        flat = flat[idx]
    lo = torch.quantile(flat, lo_pct / 100.0)
    hi = torch.quantile(flat, hi_pct / 100.0)
    return ((raw - lo) / (hi - lo).clamp(min=1e-6)).clamp(0, 1)


def _motion_gate(img: torch.Tensor, t: int, n: int, thresh: float, grow: int) -> torch.Tensor:
    """True where the plate is static between frames t and n (so their depths may be blended)."""
    diff = (img[t] - img[n]).abs().mean(-1)                     # (H,W)
    moving = (diff > thresh).float()[None, None]
    if grow > 0:                                                 # cover the full width of a moving edge
        moving = F.max_pool2d(moving, 2 * grow + 1, stride=1, padding=grow)
    return moving[0, 0] < 0.5


def temporal_filter(depth: torch.Tensor, median_window: int, ema: float, edge_preserve: float,
                    image: torch.Tensor = None, motion_threshold: float = 0.04, motion_grow: int = 3) -> torch.Tensor:
    """
    depth (B,H,W).  Per-pixel temporal median over an odd window, then an optional symmetric EMA
    (forward + backward, averaged, so it has no lag).  edge_preserve > 0 limits the EMA to pixels
    whose value is within that distance of the median result (keeps genuine depth steps).

    Motion gating (image given): a neighbouring frame only contributes at pixels where the PLATE is
    static between the two frames. Moving subjects (a walking leg) keep their own per-frame depth, so
    depth edges no longer lag the subject and leave a ghost behind it; static background is still
    smoothed.
    """
    B = depth.shape[0]
    gated = image is not None and image.shape[0] == B
    if gated:
        img = image[..., :3].float()
        if img.shape[1:3] != depth.shape[1:3]:
            img = F.interpolate(img.permute(0, 3, 1, 2), size=depth.shape[1:3], mode="area").permute(0, 2, 3, 1)
    out = depth
    if median_window > 1 and B > 1:
        k = median_window // 2
        res = torch.empty_like(depth)
        for t in range(B):
            idx = [min(max(t + o, 0), B - 1) for o in range(-k, k + 1)]   # clamp at the ends
            win = []
            for n in idx:
                if n == t or not gated:
                    win.append(depth[n])
                else:
                    win.append(torch.where(_motion_gate(img, t, n, motion_threshold, motion_grow), depth[n], depth[t]))
            res[t] = torch.stack(win, 0).median(dim=0).values
        out = res
    if ema > 0 and B > 1:
        a = float(min(max(ema, 0.0), 0.95))
        fwd = out.clone()
        for t in range(1, B):
            blend = a * fwd[t - 1] + (1 - a) * out[t]
            fwd[t] = torch.where(_motion_gate(img, t, t - 1, motion_threshold, motion_grow), blend, out[t]) if gated else blend
        bwd = out.clone()
        for t in range(B - 2, -1, -1):
            blend = a * bwd[t + 1] + (1 - a) * out[t]
            bwd[t] = torch.where(_motion_gate(img, t, t + 1, motion_threshold, motion_grow), blend, out[t]) if gated else blend
        sm = 0.5 * (fwd + bwd)
        if edge_preserve > 0:
            keep = (sm - out).abs() <= edge_preserve
            sm = torch.where(keep, sm, out)
        out = sm
    return out


# ----------------------------------------------------------------------------------------------

class BincDepthAnythingV2:
    @classmethod
    def INPUT_TYPES(cls):
        local = _list_local_models()
        return {
            "required": {
                "image": ("IMAGE",),
                "model": (local or ["(put HF-format folders in models/depth_anything/)"],),
                "hf_repo_id": ("STRING", {"default": "", "tooltip": "Optional. Overrides 'model'. e.g. depth-anything/Depth-Anything-V2-Large-hf (needs Hub access)."}),
                "weight_dtype": (["default", "fp16", "bf16", "fp32"], {"default": "default"}),
                "max_side": ("INT", {"default": 1036, "min": 0, "max": 4200, "step": 14,
                                     "tooltip": "Longest side the model runs at (multiple of 14). 0 = native. ViT attention is quadratic in tokens: 4K native is ~42k tokens."}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 16}),
                "normalise": (["sequence_percentile", "per_frame_minmax", "raw"], {"default": "sequence_percentile",
                              "tooltip": "sequence_percentile: one mapping for the whole batch so convergence holds across the shot."}),
                "lo_percentile": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 20.0, "step": 0.1}),
                "hi_percentile": ("FLOAT", {"default": 99.5, "min": 80.0, "max": 100.0, "step": 0.1}),
            }
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("depth", "depth_mask", "info")
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"
    DESCRIPTION = "Depth Anything V2 via transformers (no extra custom node). Output brighter = nearer, normalised once per sequence."

    def run(self, image, model, hf_repo_id, weight_dtype, max_side, batch_size, normalise, lo_percentile, hi_percentile):
        src = hf_repo_id.strip() or model
        t0 = time.time()
        before = resource_snapshot()
        net, is_metric = load_da2(src, weight_dtype)
        dev = _pick_device()
        raw = run_da2(net, image, max_side, batch_size, dev)
        if is_metric:
            raw = -raw                                    # metres (far = large) -> nearer = larger
        d = normalise_sequence(raw, normalise, lo_percentile, hi_percentile)
        dt = time.time() - t0
        info = (f"BincDepthAnythingV2 model={src} metric={is_metric} frames={d.shape[0]} raster={image.shape[2]}x{image.shape[1]} "
                f"max_side={max_side} normalise={normalise} raw_range=[{float(raw.min()):.4f},{float(raw.max()):.4f}] "
                f"device={dev} {dt:.1f}s ({dt / max(1, d.shape[0]):.2f} s/frame)\n"
                f"resources before: {before}\nresources after:  {resource_snapshot()}")
        return (d.unsqueeze(-1).expand(-1, -1, -1, 3).contiguous(), d, info)


class BincDepthTemporalFilter:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "depth": ("IMAGE",),
            "median_window": ("INT", {"default": 5, "min": 1, "max": 15, "step": 2, "tooltip": "Odd window length."}),
            "ema": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 0.95, "step": 0.01, "tooltip": "Symmetric (no-lag) temporal EMA strength. 0 = off."}),
            "edge_preserve": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.01,
                                        "tooltip": "EMA only where it moves a pixel less than this (0–1 depth units); keeps real depth steps. 0 = always."}),
            "motion_threshold": ("FLOAT", {"default": 0.04, "min": 0.0, "max": 1.0, "step": 0.005,
                                           "tooltip": "With `image` connected: plate change (0–1 RGB) above which a pixel counts as moving and is NOT blended across frames."}),
            "motion_grow": ("INT", {"default": 3, "min": 0, "max": 32, "tooltip": "Dilate the moving mask (px) so the whole moving edge is protected."}),
        }, "optional": {
            "image": ("IMAGE", {"tooltip": "The plate frames. Connect to gate smoothing by motion — stops ghost limbs on moving subjects."}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("depth", "depth_mask", "jitter_report")
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"

    def run(self, depth, median_window, ema, edge_preserve, motion_threshold=0.04, motion_grow=3, image=None):
        d = depth[..., :3].mean(-1) if depth.dim() == 4 else depth
        d = d.float().clamp(0, 1)
        out = temporal_filter(d, median_window, ema, edge_preserve, image, motion_threshold, motion_grow)

        def jitter(x):
            if x.shape[0] < 2:
                return 0.0, 0.0
            dif = (x[1:] - x[:-1]).abs() * 255.0
            return float(dif.mean()), float(torch.quantile(dif.flatten()[:: max(1, dif.numel() // 2_000_000)], 0.99))
        m0, p0 = jitter(d)
        m1, p1 = jitter(out)
        rep = f"adjacent-frame |Δ| (8-bit levels)  raw mean {m0:.2f} p99 {p0:.2f}  ->  filtered mean {m1:.2f} p99 {p1:.2f}  " \
              f"(median={median_window}, ema={ema}, edge_preserve={edge_preserve}, motion_gate={'on' if image is not None else 'OFF'} thr={motion_threshold} grow={motion_grow})"
        return (out.unsqueeze(-1).expand(-1, -1, -1, 3).contiguous(), out, rep)


NODE_CLASS_MAPPINGS = {
    "BincDepthAnythingV2": BincDepthAnythingV2,
    "BincDepthTemporalFilter": BincDepthTemporalFilter,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "BincDepthAnythingV2": "Binc · Depth Anything V2",
    "BincDepthTemporalFilter": "Binc · Depth Temporal Filter",
}
