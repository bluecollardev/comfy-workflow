"""
ComfyUI-BincStereo — depth-image-based stereo conversion, authored in-house.

Cinematic Immunity / Bincos · Lab A, Cloud 11 · 2026-10
Pure torch, no third-party dependencies beyond what ComfyUI already ships.

Nodes
-----
  BincStereoFromDepth   mono plate + depth map  ->  left, right, sbs, anaglyph, disparity, holes, report
  BincStereoPack        left + right            ->  SBS / over-under / anaglyph / interleaved / single-eye
  BincStereoReport      disparity (+ budget)    ->  per-frame parallax statistics as a STRING (for the ledger)

Conventions
-----------
  * depth: brighter = nearer by default ("near_is_bright"); switchable.
  * parallax is expressed as a PERCENTAGE OF FRAME WIDTH, signed:
        positive  = behind the screen  (far / "divergence" side, the one with a hard ceiling)
        negative  = in front of screen (near / audience side)
  * convergence is a CONSTANT depth value in [0,1] that lands on the screen plane (zero parallax).
    Nothing auto-converges per frame: large-format locked-off stereo wants a fixed convergence.
  * SBS output is LEFT-FIRST.
  * Both eyes are synthesised symmetrically (±½ parallax) by default, as an off-axis camera pair would.
    "right_only" keeps the plate as the left eye and synthesises only the right.

Algorithm
---------
Forward splat (depth-ordered, deterministic): every source pixel is pushed to x + shift. Where two
sources land on the same target pixel the NEARER one wins (packed-key scatter_reduce amax, so the
result does not depend on scatter order). Holes — 1-px cracks from disparity gradients and true
disocclusions — are filled from whichever horizontal neighbour is FARTHER (the background), which
is what a hole revealed by a foreground edge should contain; the filled region only is optionally
feathered so foreground edges stay crisp.
"""

import json
import math
import time

import torch
import torch.nn.functional as F

try:
    from .binc_io import resource_snapshot, progress_bar
except Exception:  # headless tests import binc_stereo directly
    from binc_io import resource_snapshot, progress_bar


# ----------------------------------------------------------------------------------------------
# core
# ----------------------------------------------------------------------------------------------

def _depth_to_single_channel(depth: torch.Tensor) -> torch.Tensor:
    """IMAGE (B,H,W,C) or MASK (B,H,W) -> (B,H,W) float in [0,1]."""
    if depth.dim() == 4:
        depth = depth[..., :3].mean(dim=-1) if depth.shape[-1] >= 3 else depth[..., 0]
    return depth.clamp(0.0, 1.0).float()


def _match_size(depth: torch.Tensor, H: int, W: int) -> torch.Tensor:
    if depth.shape[-2] == H and depth.shape[-1] == W:
        return depth
    return F.interpolate(depth.unsqueeze(1), size=(H, W), mode="bilinear", align_corners=False).squeeze(1)


def depth_to_parallax_px(depth: torch.Tensor, W: int, convergence: float,
                         near_pct: float, far_pct: float, gamma: float) -> torch.Tensor:
    """
    depth (B,H,W) in [0,1], 1 = nearest.  Returns signed parallax in pixels (B,H,W):
      depth == convergence -> 0
      depth == 0 (farthest) -> +far_px   (behind screen)
      depth == 1 (nearest)  -> -near_px  (in front of screen)
    Linear in depth-map value on each side of convergence (depth-anything style maps are
    relative inverse depth, i.e. already ~proportional to disparity).
    """
    if gamma != 1.0:
        depth = depth.pow(gamma)
    c = float(min(max(convergence, 0.0), 1.0))
    far_px = W * far_pct / 100.0
    near_px = W * near_pct / 100.0
    eps = 1e-6
    behind = (c - depth).clamp(min=0.0) / max(c, eps) * far_px          # depth < c
    front = (depth - c).clamp(min=0.0) / max(1.0 - c, eps) * near_px    # depth > c
    return behind - front


def forward_warp(img: torch.Tensor, depth: torch.Tensor, shift_px: torch.Tensor):
    """
    Depth-ordered forward splat along x.
      img      (B,H,W,C)   depth (B,H,W) 1 = nearest   shift_px (B,H,W) signed pixels
    Returns warped (B,H,W,C), hole mask (B,H,W) 1 = no source landed here.
    """
    B, H, W, C = img.shape
    dev = img.device
    N = H * W

    xs = torch.arange(W, device=dev, dtype=torch.float32).view(1, 1, W).expand(B, H, W)
    tx = xs + shift_px                                   # float target x
    src_idx = torch.arange(N, device=dev).view(1, H, W).expand(B, H, W)   # row-major source index
    rows = torch.arange(H, device=dev).view(1, H, 1).expand(B, H, W)

    # quantised depth as priority (nearer = larger).  16 bits is plenty for 8/16-bit maps.
    prio = (depth * 65535.0).round().long().clamp(0, 65535)
    key = prio * N + src_idx                             # amax picks nearest; ties -> highest src idx (deterministic)

    out_key = torch.full((B, N), -1, device=dev, dtype=torch.long)

    # single rounded splat keeps object edges crisp; 1-px cracks from disparity gradients are
    # closed by the hole-fill pass (nearest valid neighbour), same as a mesh would stretch them.
    tgt = tx.round().long()
    valid = (tgt >= 0) & (tgt < W)
    flat_tgt = (rows * W + tgt).clamp(0, N - 1)
    k = torch.where(valid, key, torch.full_like(key, -1))
    out_key.scatter_reduce_(1, flat_tgt.view(B, N), k.view(B, N), reduce="amax", include_self=True)

    holes = out_key < 0
    win_src = torch.where(holes, torch.zeros_like(out_key), out_key % N)   # (B,N)

    flat_img = img.reshape(B, N, C)
    warped = torch.gather(flat_img, 1, win_src.unsqueeze(-1).expand(B, N, C))
    warped = torch.where(holes.unsqueeze(-1), torch.zeros_like(warped), warped)
    return warped.view(B, H, W, C), holes.view(B, H, W).float()


def _hole_background_ref(holes: torch.Tensor, depth_w: torch.Tensor):
    """
    For every hole pixel: depth of the FARTHER of its nearest valid left/right neighbours (the background
    the disocclusion reveals), and that neighbour's column.  Non-hole pixels get ref = their own depth.
    Returns ref (B,H,W), pick (B,H,W) column index.
    """
    B, H, W = holes.shape
    dev = holes.device
    valid = holes < 0.5
    idx = torch.arange(W, device=dev).view(1, 1, W).expand(B, H, W)
    left_idx = torch.where(valid, idx, torch.full_like(idx, -1)).cummax(dim=2).values
    right_idx = torch.where(valid, idx, torch.full_like(idx, W)).flip(2).cummin(dim=2).values.flip(2)
    has_l, has_r = left_idx >= 0, right_idx < W
    li, ri = left_idx.clamp(0, W - 1), right_idx.clamp(0, W - 1)
    d_l, d_r = torch.gather(depth_w, 2, li), torch.gather(depth_w, 2, ri)
    use_left = torch.where(has_l & has_r, d_l <= d_r, has_l)
    pick = torch.where(use_left, li, ri)
    ref = torch.gather(depth_w, 2, pick)
    ref = torch.where(valid, depth_w, ref)
    return ref, pick


def _min_pool(x, k):
    return -F.max_pool2d(-x.unsqueeze(1), kernel_size=k, stride=1, padding=k // 2).squeeze(1)


def push_pull(rgb: torch.Tensor, w: torch.Tensor, levels: int = 8) -> torch.Tensor:
    """
    Pull-push (Gortler et al.) diffusion: fills every zero-weight pixel of rgb from the weighted average of
    the nearest valid pixels at all scales — isotropic, no 1-D streaks.
      rgb (B,H,W,C) premultiplied by nothing; w (B,H,W) in {0,1}.  Returns full image (B,H,W,C).
    """
    x = (rgb * w.unsqueeze(-1)).permute(0, 3, 1, 2)
    m = w.unsqueeze(1)
    pyr = [(x, m)]
    for _ in range(levels):
        if x.shape[-1] < 2 or x.shape[-2] < 2:
            break
        x = F.avg_pool2d(x, 2, ceil_mode=True)
        m = F.avg_pool2d(m, 2, ceil_mode=True)
        pyr.append((x, m))
    # coarsest: normalise
    x, m = pyr[-1]
    cur = x / m.clamp(min=1e-6)
    for xi, mi in reversed(pyr[:-1]):
        up = F.interpolate(cur, size=xi.shape[-2:], mode="bilinear", align_corners=False)
        mi_c = mi.clamp(max=1.0)
        # where this level has coverage use its own (normalised) value weighted by coverage, else the coarser estimate
        cur = torch.where(mi_c > 0, xi / mi_c.clamp(min=1e-6) * mi_c + up * (1 - mi_c), up)
    return cur.permute(0, 2, 3, 1)


def fill_holes_background(warped: torch.Tensor, holes: torch.Tensor, depth_w: torch.Tensor, feather: int,
                          mode: str = "pushpull", depth_tol: float = 0.06, dilate_px: int = 1,
                          override: torch.Tensor = None):
    """
    Paint-in for disocclusions.
      stretch : 1-D fill from the farther horizontal neighbour (v0.1 behaviour, fast, streaky on wide holes)
      pushpull: isotropic pull-push diffusion seeded ONLY from background pixels — any valid pixel whose depth
                is nearer than the hole's background reference + depth_tol is excluded, so foreground never
                bleeds into the hole.
      override: optional (B,H,W,C) image (e.g. from an inpainting model fed the `holes` mask) composited in.
    dilate_px grows the hole mask into the BACKGROUND side only (never into foreground) so the fill overlaps
    the seam.  feather blurs inside the (dilated) hole only.
    """
    B, H, W, C = warped.shape
    ref, pick = _hole_background_ref(holes, depth_w)
    hole = holes > 0.5

    if dilate_px > 0:
        k = 2 * dilate_px + 1
        grown = F.max_pool2d(holes.unsqueeze(1), kernel_size=k, stride=1, padding=dilate_px).squeeze(1) > 0.5
        ref_grown = _min_pool(torch.where(hole, ref, torch.ones_like(ref)), k)     # background ref spread to the ring
        is_bg = depth_w <= ref_grown + depth_tol
        hole = hole | (grown & is_bg)
        ref = torch.where(hole & ~(holes > 0.5), ref_grown, ref)

    # foreground pixels bordering a hole: nearer than the hole's background reference -> never a fill source
    reach = max(9, 2 * feather + 1)
    ref_ring = _min_pool(torch.where(hole, ref, torch.ones_like(ref)), reach)       # ref carried into the valid ring
    near_hole = F.max_pool2d(hole.float().unsqueeze(1), kernel_size=reach, stride=1, padding=reach // 2).squeeze(1) > 0.5
    fg_excl = near_hole & ~hole & (depth_w > ref_ring + depth_tol)

    if override is not None:
        out = torch.where(hole.unsqueeze(-1), override[..., :C], warped)
    elif mode == "stretch":
        filled = torch.gather(warped, 2, pick.unsqueeze(-1).expand(B, H, W, C))
        out = torch.where(hole.unsqueeze(-1), filled, warped)
    else:
        w = (~hole & ~fg_excl).float()
        diffused = push_pull(warped, w)
        out = torch.where(hole.unsqueeze(-1), diffused, warped)

    if feather > 0:
        # background-gated blur inside the hole: foreground neighbours carry zero weight
        kk = 2 * feather + 1
        wgt = (~fg_excl).float().unsqueeze(1)
        num = F.avg_pool2d((out.permute(0, 3, 1, 2) * wgt), kernel_size=kk, stride=1, padding=feather)
        den = F.avg_pool2d(wgt, kernel_size=kk, stride=1, padding=feather)
        blur = (num / den.clamp(min=1e-6)).permute(0, 2, 3, 1)
        out = torch.where(hole.unsqueeze(-1), blur, out)
    return out, hole.float()


def silhouette_hull(depth: torch.Tensor, hull_px: int, feather_px: int, edge_threshold: float):
    """
    Cyclopean silhouette hull.  Treat the plate as the centre (cyclopean) view and give every foreground
    region a hull: grey-level dilation (hull_px > 0) pushes the near depth outward so the mixed edge pixels
    (hair, foliage fringe, motion blur) ride WITH the foreground instead of being torn between layers;
    erosion (hull_px < 0) pulls it in.  Then the contour transition is feathered over feather_px so the
    disparity gradient at the edge is bounded.  Only pixels within the edge band (gradient > edge_threshold)
    are touched — flat regions keep their exact values.  Both eyes are warped from this one depth, so the
    object boundary is identical in L and R and disocclusions open only on the background side.
    Returns hull depth (B,H,W) and the edge band mask (B,H,W).
    """
    if hull_px == 0 and feather_px == 0:
        return depth, torch.zeros_like(depth)
    d = depth.unsqueeze(1)
    gx = F.pad(d[..., :, 1:] - d[..., :, :-1], (0, 1, 0, 0))
    gy = F.pad(d[..., 1:, :] - d[..., :-1, :], (0, 0, 0, 1))
    grad = torch.sqrt(gx * gx + gy * gy)
    band = (grad > edge_threshold).float()
    reach = abs(hull_px) + feather_px + 1
    band = F.max_pool2d(band, kernel_size=2 * reach + 1, stride=1, padding=reach)

    h = d
    if hull_px > 0:
        h = F.max_pool2d(d, kernel_size=2 * hull_px + 1, stride=1, padding=hull_px)
    elif hull_px < 0:
        k = -hull_px
        h = -F.max_pool2d(-d, kernel_size=2 * k + 1, stride=1, padding=k)
    if feather_px > 0:
        k = 2 * feather_px + 1
        h = F.avg_pool2d(h, kernel_size=k, stride=1, padding=feather_px, count_include_pad=False)
    out = d * (1 - band) + h * band
    return out.squeeze(1).clamp(0, 1), band.squeeze(1)


def mesh_warp(img: torch.Tensor, shift_px: torch.Tensor, depth: torch.Tensor):
    """
    Mesh / rubber-sheet warp along x — the equivalent of rendering a depth-displaced image-plane mesh from a
    shifted camera. Every OUTPUT pixel samples the plate (bicubic), so nothing is invented:
      1. the per-pixel shift is carried into the output view with depth ordering (nearer surface wins),
      2. where no surface lands (disocclusion) the shift is interpolated linearly between the two sides,
         exactly as a mesh triangle stretches across the gap,
      3. the plate is sampled once at x_out - shift_out.
      img (B,H,W,C), shift_px (B,H,W) signed px, depth (B,H,W) 1 = near.  Returns (B,H,W,C).
    """
    B, H, W, C = img.shape
    dev = img.device
    sh_out, holes = forward_warp(shift_px.unsqueeze(-1), depth, shift_px)
    sh_out = sh_out[..., 0]
    valid = holes < 0.5
    idx = torch.arange(W, device=dev).view(1, 1, W).expand(B, H, W)
    li = torch.where(valid, idx, torch.full_like(idx, -1)).cummax(dim=2).values
    ri = torch.where(valid, idx, torch.full_like(idx, W)).flip(2).cummin(dim=2).values.flip(2)
    has_l, has_r = li >= 0, ri < W
    lic, ric = li.clamp(0, W - 1), ri.clamp(0, W - 1)
    sl, sr = torch.gather(sh_out, 2, lic), torch.gather(sh_out, 2, ric)
    t = (idx - lic).float() / (ric - lic).clamp(min=1).float()
    interp = torch.where(has_l & has_r, sl + t * (sr - sl), torch.where(has_l, sl, sr))
    sh_out = torch.where(valid, sh_out, interp)
    x_src = idx.float() - sh_out
    gx = x_src * (2.0 / max(W - 1, 1)) - 1.0
    gy = torch.linspace(-1, 1, H, device=dev).view(1, H, 1).expand(B, H, W)
    out = F.grid_sample(img.permute(0, 3, 1, 2), torch.stack([gx, gy], -1), mode="bicubic",
                        padding_mode="border", align_corners=True)
    return out.permute(0, 2, 3, 1).clamp(0, 1)


def synth_eye(img, depth, parallax_px, eye_sign: float, fill: str, feather: int,
              depth_tol: float = 0.06, dilate_px: int = 1, override=None):
    """eye_sign: +1 right eye, -1 left eye.  Shift applied = eye_sign * parallax (already halved by caller if symmetric)."""
    shift = parallax_px * eye_sign
    if fill == "mesh_stretch":
        return mesh_warp(img, shift, depth), torch.zeros_like(depth)
    warped, holes = forward_warp(img, depth, shift)
    depth_w, _ = forward_warp(depth.unsqueeze(-1), depth, shift)
    depth_w = depth_w.squeeze(-1)
    if fill == "black" and override is None:
        return warped, holes
    mode = "stretch" if fill == "background_stretch" else "pushpull"
    warped, holes = fill_holes_background(warped, holes, depth_w, feather, mode, depth_tol, dilate_px, override)
    return warped, holes


def anaglyph(left, right, mode="dubois_approx"):
    """Red/cyan QC anaglyph. 'dubois_approx' reduces retinal rivalry; 'simple' is pure channel merge."""
    if mode == "simple":
        return torch.cat([left[..., :1], right[..., 1:3]], dim=-1)
    # Dubois (2001) red/cyan least-squares matrices
    ML = torch.tensor([[0.437, 0.449, 0.164], [-0.062, -0.062, -0.024], [-0.048, -0.050, -0.017]], device=left.device)
    MR = torch.tensor([[-0.011, -0.032, -0.007], [0.377, 0.761, 0.009], [-0.026, -0.093, 1.234]], device=left.device)
    out = left[..., :3] @ ML.T + right[..., :3] @ MR.T
    return out.clamp(0, 1)


def pack(left, right, layout: str, left_first: bool = True):
    a, b = (left, right) if left_first else (right, left)
    if layout == "sbs_full":
        return torch.cat([a, b], dim=2)
    if layout == "sbs_half":
        a2 = F.interpolate(a.permute(0, 3, 1, 2), scale_factor=(1, 0.5), mode="area").permute(0, 2, 3, 1)
        b2 = F.interpolate(b.permute(0, 3, 1, 2), scale_factor=(1, 0.5), mode="area").permute(0, 2, 3, 1)
        return torch.cat([a2, b2], dim=2)
    if layout == "over_under_full":
        return torch.cat([a, b], dim=1)
    if layout == "over_under_half":
        a2 = F.interpolate(a.permute(0, 3, 1, 2), scale_factor=(0.5, 1), mode="area").permute(0, 2, 3, 1)
        b2 = F.interpolate(b.permute(0, 3, 1, 2), scale_factor=(0.5, 1), mode="area").permute(0, 2, 3, 1)
        return torch.cat([a2, b2], dim=1)
    if layout == "interleaved_rows":
        out = a.clone()
        out[:, 1::2] = b[:, 1::2]
        return out
    if layout == "anaglyph":
        return anaglyph(left, right)
    if layout == "left":
        return left
    if layout == "right":
        return right
    raise ValueError(layout)


def parallax_report(parallax_px: torch.Tensor, W: int, near_budget_pct: float, far_budget_pct: float,
                    holes_l=None, holes_r=None, extra=None) -> str:
    """Per-frame signed parallax stats in % of width, with budget flags.  JSON string."""
    B = parallax_px.shape[0]
    frames = []
    worst_far = 0.0
    worst_near = 0.0
    for i in range(B):
        p = parallax_px[i]
        pmin = float(p.min()) / W * 100.0
        pmax = float(p.max()) / W * 100.0
        pmean = float(p.mean()) / W * 100.0
        f = {"frame": i, "parallax_pct": {"min": round(pmin, 4), "max": round(pmax, 4), "mean": round(pmean, 4)},
             "parallax_px": {"min": round(float(p.min()), 2), "max": round(float(p.max()), 2)}}
        flags = []
        if pmax > far_budget_pct + 1e-6:
            flags.append("FAR_OVER_BUDGET")
        if -pmin > near_budget_pct + 1e-6:
            flags.append("NEAR_OVER_BUDGET")
        if holes_l is not None:
            f["holes_pct"] = {"left": round(float(holes_l[i].mean()) * 100.0, 4),
                              "right": round(float(holes_r[i].mean()) * 100.0, 4)}
        if flags:
            f["flags"] = flags
        worst_far = max(worst_far, pmax)
        worst_near = max(worst_near, -pmin)
        frames.append(f)
    summary = {
        "node": "BincStereoFromDepth",
        "frame_width_px": W,
        "frames": B,
        "budget_pct": {"far_behind_screen": far_budget_pct, "near_in_front": near_budget_pct},
        "worst_pct": {"far": round(worst_far, 4), "near": round(worst_near, 4)},
        "ok": worst_far <= far_budget_pct + 1e-6 and worst_near <= near_budget_pct + 1e-6,
    }
    if extra:
        summary["params"] = extra
    return json.dumps({"summary": summary, "frames": frames}, indent=1)


# ----------------------------------------------------------------------------------------------
# ComfyUI nodes
# ----------------------------------------------------------------------------------------------

class BincStereoFromDepth:
    """Mono plate + depth -> stereo pair.  Constant convergence, parallax budget in % of frame width."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "depth": ("IMAGE",),
                "depth_polarity": (["near_is_bright", "near_is_dark"], {"default": "near_is_bright"}),
                "convergence": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01,
                                          "tooltip": "Depth value that sits on the screen plane (zero parallax). Constant for the shot."}),
                "near_parallax_pct": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.01,
                                                "tooltip": "Max parallax IN FRONT of screen at depth=1, % of frame width."}),
                "far_parallax_pct": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 3.0, "step": 0.01,
                                               "tooltip": "Max parallax BEHIND screen at depth=0, % of frame width (divergence ceiling: 0.25 % ≈ 55 mm IPD on a 22 m screen)."}),
                "depth_gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.01}),
                "eye_mode": (["symmetric", "right_only", "left_only"], {"default": "symmetric",
                             "tooltip": "symmetric = both eyes synthesised ±½ parallax (off-axis pair). right_only = plate is the left eye."}),
                "hull_px": ("INT", {"default": 1, "min": -8, "max": 8,
                                    "tooltip": "Cyclopean silhouette hull: >0 dilates near depth outward so fringe pixels ride with the foreground; <0 erodes; 0 off."}),
                "hull_feather_px": ("INT", {"default": 2, "min": 0, "max": 16, "tooltip": "Bounds the disparity gradient at contours. Only the edge band is touched."}),
                "hull_edge_threshold": ("FLOAT", {"default": 0.04, "min": 0.0, "max": 1.0, "step": 0.005,
                                                  "tooltip": "Depth gradient (0–1 units/px) above which a pixel counts as a silhouette edge."}),
                "hole_fill": (["background_pushpull", "background_stretch", "black"], {"default": "background_pushpull",
                              "tooltip": "pushpull = isotropic diffusion seeded from background only. stretch = v0.1 1-D fill. black = leave holes (QC / for an external inpainter)."}),
                "fill_depth_tol": ("FLOAT", {"default": 0.06, "min": 0.0, "max": 0.5, "step": 0.005,
                                             "tooltip": "Valid pixels nearer than the hole's background reference + this are excluded from the fill (no foreground bleed)."}),
                "fill_dilate_px": ("INT", {"default": 1, "min": 0, "max": 8, "tooltip": "Grow the hole into the background side only, so the fill overlaps the seam."}),
                "fill_feather_px": ("INT", {"default": 2, "min": 0, "max": 16}),
                "sbs_layout": (["sbs_full", "sbs_half"], {"default": "sbs_full"}),
            },
            "optional": {
                "depth_mask": ("MASK", {"tooltip": "Alternative depth input as MASK (overrides 'depth' if connected)."}),
                "warp_mode": (["mesh_stretch", "splat_fill"], {"default": "mesh_stretch",
                              "tooltip": "mesh_stretch = backward rubber-sheet warp (like a displaced mesh comp): no holes, no fill, cleanest edges. splat_fill = forward splat + hole fill (uses hole_fill / fill_* settings)."}),
                "left_fill": ("IMAGE", {"tooltip": "Optional externally inpainted LEFT eye (run `left` + `holes` through any inpainter, feed back here). Composited inside holes only."}),
                "right_fill": ("IMAGE", {"tooltip": "Optional externally inpainted RIGHT eye."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "IMAGE", "MASK", "IMAGE", "STRING")
    RETURN_NAMES = ("left", "right", "sbs", "anaglyph", "parallax_vis", "holes", "depth_hull", "report")
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"
    DESCRIPTION = "Depth-image-based stereo conversion (in-house). Cyclopean silhouette hull, deterministic depth-ordered forward splat, background-gated push-pull paint-in, constant convergence, parallax budget in % of frame width. SBS is left-first."

    def run(self, image, depth, depth_polarity, convergence, near_parallax_pct, far_parallax_pct,
            depth_gamma, eye_mode, hull_px, hull_feather_px, hull_edge_threshold,
            hole_fill, fill_depth_tol, fill_dilate_px, fill_feather_px, sbs_layout,
            depth_mask=None, left_fill=None, right_fill=None, warp_mode="mesh_stretch"):
        img = image.float()
        B, H, W, C = img.shape
        d = _depth_to_single_channel(depth_mask if depth_mask is not None else depth).to(img.device)
        if d.shape[0] == 1 and B > 1:
            d = d.expand(B, -1, -1)
        elif d.shape[0] != B:
            raise ValueError(f"depth batch {d.shape[0]} != image batch {B}")
        d = _match_size(d, H, W)
        if depth_polarity == "near_is_dark":
            d = 1.0 - d

        t0 = time.time()
        before = resource_snapshot()
        d, edge_band = silhouette_hull(d, hull_px, hull_feather_px, hull_edge_threshold)
        parallax = depth_to_parallax_px(d, W, convergence, near_parallax_pct, far_parallax_pct, depth_gamma)

        if warp_mode == "mesh_stretch":
            hole_fill = "mesh_stretch"
        lf = left_fill.float().to(img.device) if left_fill is not None else None
        rf = right_fill.float().to(img.device) if right_fill is not None else None
        kw = dict(depth_tol=fill_depth_tol, dilate_px=fill_dilate_px)

        # frames are warped in small chunks so intermediates never scale with the batch
        CH = 2
        pbar = progress_bar((B + CH - 1) // CH)
        L, R, HL, HR = [], [], [], []
        for i in range(0, B, CH):
            sl = slice(i, i + CH)
            im, dd, pp = img[sl], d[sl], parallax[sl]
            lfi = lf[sl] if lf is not None else None
            rfi = rf[sl] if rf is not None else None
            b = im.shape[0]
            if eye_mode == "symmetric":
                l_, hl_ = synth_eye(im, dd, pp * 0.5, -1.0, hole_fill, fill_feather_px, override=lfi, **kw)
                r_, hr_ = synth_eye(im, dd, pp * 0.5, +1.0, hole_fill, fill_feather_px, override=rfi, **kw)
            elif eye_mode == "right_only":
                l_, hl_ = im, torch.zeros(b, H, W, device=img.device)
                r_, hr_ = synth_eye(im, dd, pp, +1.0, hole_fill, fill_feather_px, override=rfi, **kw)
            else:  # left_only
                r_, hr_ = im, torch.zeros(b, H, W, device=img.device)
                l_, hl_ = synth_eye(im, dd, pp, -1.0, hole_fill, fill_feather_px, override=lfi, **kw)
            L.append(l_); R.append(r_); HL.append(hl_); HR.append(hr_)
            if pbar:
                pbar.update(1)
        left, right, hl, hr = torch.cat(L), torch.cat(R), torch.cat(HL), torch.cat(HR)

        sbs = pack(left, right, sbs_layout, left_first=True)
        ana = anaglyph(left, right)

        # parallax visualisation: 0.5 grey = screen plane, brighter = behind, darker = in front
        span = max(W * max(near_parallax_pct, far_parallax_pct) / 100.0, 1e-6)
        vis = (0.5 + 0.5 * parallax / span).clamp(0, 1).unsqueeze(-1).expand(B, H, W, 3)

        params = {"depth_polarity": depth_polarity, "convergence": convergence, "near_parallax_pct": near_parallax_pct,
                  "far_parallax_pct": far_parallax_pct, "depth_gamma": depth_gamma, "eye_mode": eye_mode,
                  "hull_px": hull_px, "hull_feather_px": hull_feather_px, "hull_edge_threshold": hull_edge_threshold,
                  "warp_mode": warp_mode, "hole_fill": hole_fill, "fill_depth_tol": fill_depth_tol, "fill_dilate_px": fill_dilate_px,
                  "fill_feather_px": fill_feather_px, "external_fill": [lf is not None, rf is not None],
                  "sbs_layout": sbs_layout, "sbs_left_first": True, "raster": [W, H],
                  "edge_band_pct": round(float(edge_band.mean()) * 100.0, 3),
                  "seconds": round(time.time() - t0, 2), "seconds_per_frame": round((time.time() - t0) / max(1, B), 3),
                  "resources_before": before, "resources_after": resource_snapshot()}
        report = parallax_report(parallax, W, near_parallax_pct, far_parallax_pct, hl, hr, extra=params)
        holes = torch.maximum(hl, hr)
        depth_hull = d.unsqueeze(-1).expand(B, H, W, 3).contiguous()
        return (left, right, sbs, ana, vis, holes, depth_hull, report)


class BincStereoPack:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "left": ("IMAGE",),
            "right": ("IMAGE",),
            "layout": (["sbs_full", "sbs_half", "over_under_full", "over_under_half", "interleaved_rows", "anaglyph", "left", "right"],
                       {"default": "sbs_full"}),
            "left_first": ("BOOLEAN", {"default": True}),
            "swap_eyes": ("BOOLEAN", {"default": False, "tooltip": "Swap L/R before packing (QC for eye-swap)."}),
        }}

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("packed",)
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"

    def run(self, left, right, layout, left_first, swap_eyes):
        if swap_eyes:
            left, right = right, left
        if left.shape != right.shape:
            raise ValueError(f"left {tuple(left.shape)} != right {tuple(right.shape)}")
        return (pack(left.float(), right.float(), layout, left_first),)


class BincStereoReport:
    """Standalone parallax audit from a depth map and budget — no warp, just the numbers for the ledger."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "depth": ("IMAGE",),
            "frame_width_px": ("INT", {"default": 3840, "min": 16, "max": 16384}),
            "depth_polarity": (["near_is_bright", "near_is_dark"], {"default": "near_is_bright"}),
            "convergence": ("FLOAT", {"default": 0.35, "min": 0.0, "max": 1.0, "step": 0.01}),
            "near_parallax_pct": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.01}),
            "far_parallax_pct": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 3.0, "step": 0.01}),
            "depth_gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 4.0, "step": 0.01}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("report",)
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"

    def run(self, depth, frame_width_px, depth_polarity, convergence, near_parallax_pct, far_parallax_pct, depth_gamma):
        d = _depth_to_single_channel(depth)
        if depth_polarity == "near_is_dark":
            d = 1.0 - d
        p = depth_to_parallax_px(d, frame_width_px, convergence, near_parallax_pct, far_parallax_pct, depth_gamma)
        return (parallax_report(p, frame_width_px, near_parallax_pct, far_parallax_pct),)


NODE_CLASS_MAPPINGS = {
    "BincStereoFromDepth": BincStereoFromDepth,
    "BincStereoPack": BincStereoPack,
    "BincStereoReport": BincStereoReport,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "BincStereoFromDepth": "Binc · Stereo from Depth",
    "BincStereoPack": "Binc · Stereo Pack",
    "BincStereoReport": "Binc · Stereo Parallax Report",
}
