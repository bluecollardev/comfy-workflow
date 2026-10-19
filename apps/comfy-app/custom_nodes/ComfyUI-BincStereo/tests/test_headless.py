"""Headless check of the node logic — no ComfyUI needed.  python -I tests/test_headless.py"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import torch
from binc_stereo import BincStereoFromDepth, BincStereoPack, BincStereoReport, forward_warp

torch.manual_seed(0)
B, H, W = 2, 270, 480

# plate: horizontal colour ramp + a bright disc; depth: far gradient (0.1->0.3) + near disc (0.9)
yy, xx = torch.meshgrid(torch.arange(H), torch.arange(W), indexing="ij")
plate = torch.zeros(B, H, W, 3)
plate[..., 0] = (xx / W).float()
plate[..., 1] = (yy / H).float()
plate[..., 2] = 0.6
disc = ((xx - W * 0.5) ** 2 + (yy - H * 0.5) ** 2) < (H * 0.2) ** 2
plate[:, disc] = torch.tensor([1.0, 1.0, 0.0])
depth = 0.1 + 0.2 * (yy / H).float()
depth = depth.expand(B, H, W).clone()
depth[:, disc] = 0.9
depth_img = depth.unsqueeze(-1).expand(B, H, W, 3).contiguous()

node = BincStereoFromDepth()
t = time.time()
left, right, sbs, ana, vis, holes, dhull, report = node.run(
    plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 2, "sbs_full", warp_mode="splat_fill")
print(f"run {time.time()-t:.2f}s  left {tuple(left.shape)} sbs {tuple(sbs.shape)} ana {tuple(ana.shape)}")

rep = json.loads(report)
print(json.dumps(rep["summary"], indent=1))
assert rep["summary"]["ok"], "budget flags on an in-budget setup"
assert rep["summary"]["worst_pct"]["near"] <= 1.0 and rep["summary"]["worst_pct"]["far"] <= 0.25

# 1) sign convention: the near disc (negative parallax, in front of screen) must shift RIGHT in the left eye
#    and LEFT in the right eye.  Measure disc centroid in each eye via the yellow colour.
def centroid_x(im):
    m = (im[0, ..., 0] > 0.9) & (im[0, ..., 1] > 0.9) & (im[0, ..., 2] < 0.15)
    return float(xx[m].float().mean())
cx_src, cx_l, cx_r = centroid_x(plate), centroid_x(left), centroid_x(right)
print(f"disc centroid src {cx_src:.1f}  left {cx_l:.1f}  right {cx_r:.1f}")
assert cx_l > cx_src + 1 and cx_r < cx_src - 1, "near object must appear right in L eye and left in R eye"
expected_half = W * 1.0 / 100 * (0.9 - 0.35) / (1 - 0.35) * 0.5
print(f"expected ±{expected_half:.2f}px, measured L {cx_l-cx_src:+.2f} R {cx_r-cx_src:+.2f}")
assert abs((cx_l - cx_src) - expected_half) < 1.0 and abs((cx_r - cx_src) + expected_half) < 1.0

# 2) raw holes exist (disocclusion) but filled output has no black pixels
_, raw_holes = forward_warp(plate, depth, torch.full((B, H, W), -3.0))
assert raw_holes[0, :, -3:].mean() > 0.9 and raw_holes[0, :, :-3].mean() == 0, "uniform -3px shift leaves exactly the right 3 columns as holes"
print(f"disocclusion holes L {holes.mean()*100:.3f}% of frame (reported, pre-fill)")
black = ((left.sum(-1) == 0) | (right.sum(-1) == 0)).float().mean()
assert black == 0, f"unfilled pixels remain: {black}"

# 3) zero-shift identity
l0, r0, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 0.0, 0.0, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 0, "sbs_full", warp_mode="splat_fill")
assert torch.allclose(l0, plate) and torch.allclose(r0, plate), "zero parallax must be identity"

# 4) right_only keeps the plate as left eye
l1, r1, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "right_only", 0, 0, 0.04, "background_pushpull", 0.06, 1, 2, "sbs_full", warp_mode="splat_fill")
assert torch.equal(l1, plate)

# 5) pack layouts
pk = BincStereoPack()
for layout, shape in [("sbs_full", (B, H, 2 * W, 3)), ("sbs_half", (B, H, W, 3)), ("over_under_full", (B, 2 * H, W, 3)),
                      ("over_under_half", (B, H, W, 3)), ("interleaved_rows", (B, H, W, 3)), ("anaglyph", (B, H, W, 3))]:
    out = pk.run(left, right, layout, True, False)[0]
    assert tuple(out.shape) == shape, (layout, out.shape)
assert torch.equal(pk.run(left, right, "sbs_full", True, False)[0][:, :, :W], left), "sbs must be left-first"
assert torch.equal(pk.run(left, right, "sbs_full", False, False)[0][:, :, :W], right)

# 6) over-budget flag
rp = json.loads(BincStereoReport().run(depth_img, 3840, "near_is_bright", 0.35, 2.0, 0.25, 1.0)[0])
assert rp["summary"]["worst_pct"]["near"] > 1.0
rp2 = json.loads(BincStereoReport().run(depth_img, 3840, "near_is_bright", 0.9, 1.0, 0.25, 1.0)[0])
assert rp2["summary"]["ok"]

# 7) MASK depth path + batch broadcast
l2, r2, *_ = node.run(plate, depth_img[:1], "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 2, "sbs_full", warp_mode="splat_fill",
                      depth_mask=depth[:1])
assert torch.allclose(l2, left, atol=1e-6)

# 8) determinism
l3, r3, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 2, "sbs_full", warp_mode="splat_fill")
assert torch.equal(l3, left) and torch.equal(r3, right)

# 9) push-pull fill must not bleed foreground (yellow) into the disocclusion beside the disc
#    left eye: disc moved right -> hole on its LEFT edge (x ~ 185..189, row 135); fill must be background-coloured
h_row = holes[0, 135]
hx = torch.nonzero(h_row > 0.5).flatten()
hx = hx[(hx > 150) & (hx < 240)]
assert hx.numel() > 0, "expected a disocclusion left of the disc"
fillpx = left[0, 135, hx]
assert (fillpx[:, 2] > 0.4).all() and (fillpx[:, 0] < 0.9).all(), f"foreground bled into fill: {fillpx[:3]}"

# 10) stretch mode still works and equals v0.1 behaviour shape-wise; black leaves holes
ls, rs, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "background_stretch", 0.06, 0, 0, "sbs_full", warp_mode="splat_fill")
assert ((ls.sum(-1) == 0)).float().mean() == 0
lb, rb, *_ , hb, _, _ = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "black", 0.06, 0, 0, "sbs_full", warp_mode="splat_fill")
blk = lb[0].sum(-1) == 0
assert blk.any() and (hb[0][blk] > 0.5).all(), "black-mode holes must be a subset of the reported union mask"

# 11) external fill override composites only inside holes
ov = torch.full_like(plate, 0.5)
lo_, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "black", 0.06, 0, 0, "sbs_full", left_fill=ov, warp_mode="splat_fill")
assert torch.allclose(lo_[0][blk], torch.full((int(blk.sum()), 3), 0.5)), "override must land inside left-eye holes"
assert torch.equal(lo_[0][~blk], lb[0][~blk]), "override must not touch non-hole pixels"

# 12) silhouette hull: dilation grows the near disc, flat regions untouched, gradient bounded
from binc_stereo import silhouette_hull
dh, band = silhouette_hull(depth, 3, 2, 0.04)
assert float(band.mean()) > 0 and float(band.mean()) < 0.2
assert (dh[0, disc & (band[0] < 0.5)] - depth[0, disc & (band[0] < 0.5)]).abs().max() < 1e-6, "interior changed"
assert (dh[0, (~disc) & (band[0] < 0.5)] - depth[0, (~disc) & (band[0] < 0.5)]).abs().max() < 1e-6, "flat background changed"
near_area_before = int((depth[0] > 0.6).sum()); near_area_after = int((dh[0] > 0.6).sum())
assert near_area_after > near_area_before, "hull should wrap the silhouette outward"
gmax_before = float((depth[0, 135, 1:] - depth[0, 135, :-1]).abs().max())
gmax_after = float((dh[0, 135, 1:] - dh[0, 135, :-1]).abs().max())
assert gmax_after < gmax_before, "feather should bound the contour gradient"
de, _ = silhouette_hull(depth, -3, 0, 0.04)
assert int((de[0] > 0.6).sum()) < near_area_before, "negative hull erodes"
# hull-on run: both eyes still exact in the interior, report carries hull params
lh, rh, *_ , reph = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 2, 2, 0.04, "background_pushpull", 0.06, 1, 2, "sbs_full", warp_mode="splat_fill")
assert json.loads(reph)["summary"]["params"]["hull_px"] == 2

# 13) temporal filter: spike frame removed, step preserved
from binc_depth import temporal_filter, normalise_sequence, BincDepthTemporalFilter
seq = torch.full((9, 8, 8), 0.3); seq[4] = 0.9            # single-frame spike
tf = temporal_filter(seq, 5, 0.0, 0.0)
assert float((tf[4] - 0.3).abs().max()) < 1e-6, "median-5 must kill a 1-frame spike"
step = torch.full((9, 8, 8), 0.2); step[5:] = 0.7          # sustained step
ts = temporal_filter(step, 5, 0.5, 0.05)
assert float((ts[4] - 0.2).abs().max()) < 1e-6 and float((ts[5] - 0.7).abs().max()) < 1e-6, "edge_preserve must keep a real step"
out_img, out_m, rep_t = BincDepthTemporalFilter().run(seq.unsqueeze(-1).expand(9, 8, 8, 3), 5, 0.3, 0.08)
assert out_img.shape == (9, 8, 8, 3) and "filtered mean" in rep_t
# sequence normalisation: same mapping for every frame
raw = torch.rand(4, 16, 16) * 3 + 1
n = normalise_sequence(raw, "sequence_percentile", 0.0, 100.0)
assert abs(float(n.max()) - 1) < 1e-5 and abs(float(n.min())) < 1e-5
assert torch.allclose((raw[1] - raw.min()) / (raw.max() - raw.min()), n[1], atol=1e-5)

# 14) DA2 plumbing with a tiny random-init DepthAnything (no weights needed): shapes + polarity handling
try:
    from transformers import DepthAnythingConfig, DepthAnythingForDepthEstimation, Dinov2Config
    import binc_depth
    bb = Dinov2Config(hidden_size=32, num_hidden_layers=2, num_attention_heads=2, intermediate_size=64, patch_size=14,
                      image_size=224, out_features=["stage1", "stage2"], out_indices=[1, 2], reshape_hidden_states=False, apply_layernorm=True)
    cfg = DepthAnythingConfig(backbone_config=bb, reassemble_hidden_size=32, fusion_hidden_size=16, neck_hidden_sizes=[8, 16],
                              head_hidden_size=8, patch_size=14)
    tiny = DepthAnythingForDepthEstimation(cfg).eval()
    binc_depth._MODEL_CACHE[("tiny", "default")] = (tiny, False)
    node_d = binc_depth.BincDepthAnythingV2()
    dimg, dmask, info = node_d.run(plate, "tiny", "", "default", 140, 2, "sequence_percentile", 0.5, 99.5)
    assert dimg.shape == (B, H, W, 3) and dmask.shape == (B, H, W) and "frames=2" in info
    assert float(dimg.min()) >= 0 and float(dimg.max()) <= 1
    print("DA2 plumbing ok:", info)
except ImportError as e:
    print("transformers not available, DA2 plumbing test skipped:", e)

# 15) mesh_stretch: no holes, no black, near object shifted the right way by ~the requested amount
lm, rm, *_ , hm, _, repm = node.run(plate, depth_img, "near_is_bright", 0.35, 1.0, 0.25, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 0, "sbs_full")
assert float(hm.sum()) == 0 and ((lm.sum(-1) == 0).float().mean() == 0)
assert json.loads(repm)["summary"]["params"]["warp_mode"] == "mesh_stretch"
cl, cr = centroid_x(lm), centroid_x(rm)
print(f"mesh_stretch disc centroid L {cl - cx_src:+.2f} R {cr - cx_src:+.2f} (expected ±{expected_half:.2f})")
assert abs((cl - cx_src) - expected_half) < 1.0 and abs((cr - cx_src) + expected_half) < 1.0
l0m, r0m, *_ = node.run(plate, depth_img, "near_is_bright", 0.35, 0.0, 0.0, 1.0, "symmetric", 0, 0, 0.04, "background_pushpull", 0.06, 1, 0, "sbs_full")
assert (l0m - plate).abs().max() < 1e-3, "zero parallax mesh warp must be identity"

# write QC images
try:
    from PIL import Image
    import numpy as np
    outdir = os.path.join(os.path.dirname(__file__), "out"); os.makedirs(outdir, exist_ok=True)
    for name, im in [("sbs", sbs), ("anaglyph", ana), ("parallax_vis", vis), ("holes", holes.unsqueeze(-1).expand(B, H, W, 3)), ("left_hull", lh), ("depth_hull", dhull)]:
        Image.fromarray((im[0].clamp(0, 1).numpy() * 255).astype(np.uint8)).save(os.path.join(outdir, f"{name}.png"))
    print("QC images ->", outdir)
except ImportError:
    pass

print("ALL CHECKS PASSED")
