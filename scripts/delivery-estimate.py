#!/usr/bin/env python3
"""Tunnel V11 delivery time estimator: render, dpx_fix and upload for one element. Read-only, no network.

Usage:
  python3 scripts/delivery-estimate.py --frames 633 --gpu 2 [--pods K] [--chunk N] [--range-split K] [--ram-gib R] [--per-frame-gib G] [--mbps M]

  --frames        frames of the element (the PDF count)
  --gpu           1 or 2: the pod type (RTX PRO 4500, 57.7 or 116.4 GiB of container RAM)
  --pods          pods available (default 1): render ranges run on min(range-split, pods) pods, the upload uses up to `parallel_pods` of them
  --range-split   cut the element into K contiguous frame ranges rendered at the same time (run_split); default 1
  --chunk         frames per chunk (default: derived from the RAM like the planner: (chunk + 16) x per-frame GiB <= 60% of the RAM, at most 50)
  --ram-gib / --per-frame-gib / --mbps   override the constants

The constants are in C below; docs/CANALV2-TUNNEL-V11-TIMING.md says where each came from (measured on 2026-11-21, Bangkok time, or ASSUMED).
Prints minutes and hours for: pod boot, probe, render, dpx_fix, upload, and the total; plus the GB and the pod cost.
"""
import argparse, math

C = {
    'PAD': 8,                      # frames of context each side of a chunk (the planner's pad), so a chunk processes chunk + 16 frames
    'SPP': {1: 21.2, 2: 18.0},     # seconds per PROCESSED frame, steady state: 1x (backhalf-b, 572 s for 27 processed frames), 2x (top/landing/sunlight, 17.7 to 18.4 s)
    'PROBE_S': 427.0,              # the 10-frame probe (18 processed frames incl. model load): 418 to 432 s measured on three 2x pods, 428 s on the 1x pod
    'PROMPT_GAP_S': 15.0,          # idle between two chunk prompts (graph conversion, queue): 11.6 to 19.7 s measured
    'LAST_CHUNK_MIN_S': 300.0,     # a last chunk of 3 or 8 frames took 309 and 315 s: a floor per small chunk
    'BOOT_S': 780.0,               # pod rented to the first prompt running (rent, ComfyUI ready, graph conversion): 17:07 to 17:20 for top = 13 min
    'RAM_GIB': {1: 57.7, 2: 116.4},
    'PER_FRAME_GIB': 1.6,          # RAM per processed frame from the probe: 1.25 (backhalf-b), 1.55 to 1.64 (top, sunlight, landing); f23 ASSUMED 1.6
    'RAM_FRACTION': 0.6,           # the planner keeps a chunk under 60% of the container RAM
    'CHUNK_MAX': 50,
    'DPXFIX_S_PER_FRAME': 1.5,     # ASSUMED: not measured; upper bound seen 2.1 s per frame (backhalf-c: last chunk 17:05:19 to dpx_fix done 17:11:02 for 162 frames, including checks)
    'FRAME_MB': 49.768,            # one 3840x2160 16-bit DPX (49,768,064 bytes), also for the 1920x1080-named elements
    'UPLOAD_MBPS': 12.0,           # one pod, one job: single-element jobs 9.8 to 15.5 MB/s (median about 14 on a quiet pod; 6.1 on a busy pod)
    'PARALLEL_EFFICIENCY': 0.9,    # ASSUMED for the merged parallel-upload code (not run yet); measured: 5 shots in one job gave 33.6 MB/s (57.4 GB in 1709 s)
    'POD_USD_PER_H': {1: 0.72, 2: 1.44},
}


def chunk_size(gpu, per_frame_gib, ram_gib):
    c = math.floor(C['RAM_FRACTION'] * ram_gib / per_frame_gib) - 2 * C['PAD']
    return max(1, min(C['CHUNK_MAX'], c))


def render_seconds(frames, gpu, chunk):
    """One pod, one range: probe (10 frames) then ceil(rest / chunk) prompts."""
    rest = max(frames - 10, 0)
    n = math.ceil(rest / chunk) if rest else 0
    spp = C['SPP'][gpu]
    t = C['PROBE_S']
    for i in range(n):
        size = chunk if i < n - 1 or rest % chunk == 0 else rest % chunk
        processed = size + 2 * C['PAD'] if size == chunk else size + C['PAD']
        t += max(processed * spp, C['LAST_CHUNK_MIN_S'] if size < chunk else 0) + C['PROMPT_GAP_S']
    return t, n + 1


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--frames', type=int, required=True)
    a.add_argument('--gpu', type=int, choices=(1, 2), default=2)
    a.add_argument('--pods', type=int, default=1)
    a.add_argument('--chunk', type=int)
    a.add_argument('--range-split', type=int, default=1)
    a.add_argument('--ram-gib', type=float)
    a.add_argument('--per-frame-gib', type=float)
    a.add_argument('--mbps', type=float)
    a = a.parse_args()
    ram = a.ram_gib or C['RAM_GIB'][a.gpu]
    pf = a.per_frame_gib or C['PER_FRAME_GIB']
    chunk = a.chunk or chunk_size(a.gpu, pf, ram)
    k = max(1, a.range_split)
    render_pods = min(k, max(1, a.pods))
    per_range = math.ceil(a.frames / k)
    rounds = math.ceil(k / render_pods)               # ranges that have to share a pod run one after the other
    r_s, prompts = render_seconds(per_range, a.gpu, chunk)
    render = rounds * r_s + C['BOOT_S']
    fix = a.frames * C['DPXFIX_S_PER_FRAME']
    gb = a.frames * C['FRAME_MB'] / 1000
    mbps = (a.mbps or C['UPLOAD_MBPS'])
    up_pods = max(1, a.pods)
    eff = mbps * (1 + (up_pods - 1) * C['PARALLEL_EFFICIENCY'])
    upload = gb * 1000 / eff
    total = render + fix + upload
    cost = render_pods * (render / 3600) * C['POD_USD_PER_H'][a.gpu]

    def m(s):
        return f'{s / 60:7.1f} min ({s / 3600:.2f} h)'
    print(f'{a.frames} frames, {a.gpu}x pod ({ram} GiB), chunk {chunk} frames, {k} range(s) on {render_pods} pod(s), upload on {up_pods} pod(s)')
    print(f'  render (boot {C["BOOT_S"] / 60:.0f} min + probe + {prompts} prompts per range{", x" + str(rounds) + " rounds" if rounds > 1 else ""}): {m(render)}')
    print(f'  dpx_fix  ({C["DPXFIX_S_PER_FRAME"]} s/frame, ASSUMED):          {m(fix)}')
    print(f'  upload   ({gb:.1f} GB at {eff:.1f} MB/s):               {m(upload)}')
    print(f'  TOTAL (render, then fix, then upload, one after the other): {m(total)}')
    print(f'  pod cost of the render: about USD {cost:.2f} ({render_pods} pod(s) x {render / 3600:.2f} h x {C["POD_USD_PER_H"][a.gpu]}/h)')


if __name__ == '__main__':
    main()
