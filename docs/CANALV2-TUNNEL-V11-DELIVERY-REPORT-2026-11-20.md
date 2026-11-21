# CANALV2 Tunnel V11: delivery report, 2026-11-20

**Status:** in progress, updated 2026-11-21 06:30 local. The 17 elements with DPX are delivered; the other 19 are generating. **Plan:** [CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md). **Rule:** we deliver what we can and have first.

## 1. Generated and delivered so far

- **Review videos:** the 17 V11 elements on the volume were re-rendered on the pod with the colour Gamma 2.6 P3-D65 (job `render-mwoo3c5o-0`: 17 rendered, 0 failed): a ProRes .mov and an H.264 .mp4 each, in `deliver/<shot>/v###/` with sidecars and a DELIVERY.md.
- **Uploads to `returns/BKK/` (test rounds `_TEST_2026-11-19` and `_TEST_2026-11-20`):** 16 publish jobs done, 72.5 GB. Done: archival-077, 080, 084, 085, 102, 104, 123, 071 and cgi-042.
- **Four uploads that had failed were re-sent and are complete:** archival-123_c (47 files added), archival-104_b (90), archival-080_a v017 (0 added: all 94 frames were already there), archival-071_main (10).
- **DPX backfill:** 8 of 24 clips done; the batch is paused.
- **Not confirmed:** that the corrected-colour videos reached the bucket (Auto-publish reports 11 uploads today; not matched to the 17 re-rendered versions).

## 1a. Delivered to the real round (2026-11-21)

- **Round:** `returns/BKK/tunnel-v11-edl-2026-11-18/` on `s3://bh-panama-exchange-610140802195`, S3 only, no Slack. Job `publish-mwpe8qd6-7`: **1,770 files, 84.88 GB, 17 elements, 11 shots**, `RETURN-MANIFEST.json` updated. A test round (`_TEST_tunnel-v11-all-2026-11-20`) took the same 17 first.
- **What each element has:** corrected DPX frames (header and timecode patched, `_delivery_v11/<clip>/`), the latest review video, and its own `<CLIP>_MANIFEST.json`.
- **Read back from the bucket:** all 17 per-element manifests are present and each DPX folder is there (counts: 071 227, 077 A/B/C 80/69/74, 080 A-E 94/60/90/83/44, 083 98, 084 39, 085 54, 093 B 126, 102 128, 104 B 130, 123 C 66, cgi-042 229). The round lists 1,840 files; the extra 70 were already there and were not touched (nothing in the round was overwritten).
- **Not read back:** the DPX headers of the 16 elements other than archival-071.

## 2. In production

Runs of the 19 elements without DPX, graphs `base_v008` on the volume, through Import Round. First import `imp-mwp9elrt-0` ended with failures (cold-pod 502/404, conversion timeouts, creature-266 dying on a 32 GB card). Second import `imp-mwpkxqng-0` (2026-11-21, archival-087, 123, cgi-072, creature-266, photoreal-013; creature-266 on RTX PRO 6000 96 GB) is running on the corrected code (graph fetch asked again on 404/502/503/504).

Verified frames from the first import (counts match the PDF): archival-087 platform 97, archival-123 a 68, archival-168 a/b/c/d 153/139/105/48, photoreal-013 ascent 108 and chasm07 271. These are on the volume and **not yet header-patched or published**.

## 3. Skipped, and why

| Element | Reason |
|---|---|
| CGI-072 head, backhalf-b, backhalf-c | Not held. The only round we have holds V03 HEVC 24 fps; the PDF lists V02 ProRes 23.976. Rendered from V03 (graphs running), delivered with the difference noted in the manifest. |
| Anything not in the volume or the staged rounds | Listed here when the imports end (section 4). |

## 4. Result of the imports

Still running; the per-element table is filled in as each ends. So far: the frames listed in section 2 exist on the volume; nothing from `base_v008` is delivered yet.

## 4a. The 36 elements

17 delivered (real round, section 1a). Of the other 19: 8 shots' frames exist and wait for the header patch and publish (section 2), the rest are generating or failed, and CGI-072 (head, backhalf-b, backhalf-c) is rendering from V03 (the PDF lists V02). Detail: [the plan, section 11](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md).

## 5. Not done

The 19 `base_v008` elements are not delivered. Rec.709 is a later generation step (Lucas: convert later). Headers of 16 delivered elements not read back. CGI-072 is rendered from V03, not the PDF's V02. Known flaw: a retried queue task starts a new pod (NEXT-STEPS).

**Stuck, and how it was got around (2026-11-21, ~23:30 UTC):**
- The queue task for archival-087 sat "running" on a pod that had been stopped (`kwlz8x4p0to1xn`); RunPod would not resume it ("no free GPU on the host", a stopped pod is pinned to its host). Fix: retried the task (new pod). `resume_pod` with `retry_until_free` is the other way.
- Stopping the "duplicate" pods the retry had made also stopped the runs that were attached to them; the queue marked those tasks failed (archival-123, cgi-072, creature-266, photoreal-013). Do not stop a pod before checking which task owns it (`queue_list` pod_id). Lesson written to NEXT-STEPS.
- Workaround used: skip the queue and run the remaining graphs directly with `run_pod_workflows` on four warm pods (cgi-072 on one, creature-266 on the 96 GB card, photoreal-013 split in two), which also runs them in parallel; one pod per shot made photoreal-013 (11 graphs) the long pole.
- Left out on purpose: photoreal-013 `floortrack`, `chasmfast07`, `chasmfastia2` (not among the 36).

<!-- run-status:start -->
### Run status of the 19 (2026-11-20 23:35 UTC)

Frames produced (DPX in `delivery_v008/<clip>/`) against the PDF count. 9 of 19 match; a mismatch or an error is shown, never hidden.

| Element | PDF frames | Produced | Check | Run | Error |
|---|---|---|---|---|---|
| ARCHIVAL-087 PLATFORM | 97 | 97 | OK | queue |  |
| ARCHIVAL-087 RAIN | 96 | - | no frames yet | queue |  |
| ARCHIVAL-123 F | 43 | 43 | OK | done |  |
| ARCHIVAL-168 A | 153 | 153 | OK | not started |  |
| ARCHIVAL-168 B | 139 | 139 | OK | not started |  |
| ARCHIVAL-168 C | 105 | 105 | OK | not started |  |
| ARCHIVAL-168 D | 48 | 48 | OK | not started |  |
| CREATURE-266 DOLPHIN-LOWTRACK | 94 | 94 | OK | done |  |
| PHOTOREAL-013 ASCENT | 108 | 108 | OK | failed | ComfyUI answered HTTP 502 for /history/9fadaa0b-3da2-4c44-b57c-e6d97fb72f77 |
| PHOTOREAL-013 CHASM07 | 271 | 271 | OK | failed | ComfyUI answered HTTP 502 for /history/8932f3cf-e4ce-4a65-9927-26eff519d875 |
| PHOTOREAL-013 F23 | 633 | - | no frames yet | pending |  |
| PHOTOREAL-013 HADAL | 160 | - | no frames yet | pending |  |
| PHOTOREAL-013 LANDING | 226 | - | no frames yet | pending |  |
| PHOTOREAL-013 SPLASH | 96 | - | no frames yet | pending |  |
| PHOTOREAL-013 SUNLIGHT | 212 | - | no frames yet | pending |  |
| PHOTOREAL-013 TOP | 209 | - | no frames yet | pending |  |
| CGI-072 HEAD | 106 | - | no frames yet | failed | The operation was aborted due to timeout |
| CGI-072 BACKHALF-B | 70 | - | no frames yet | failed | The operation was aborted due to timeout |
| CGI-072 BACKHALF-C | 162 | - | no frames yet | running |  |

The Run column is the last state a pod's run reported for that graph, so a graph can show an error from an earlier attempt while its frames are complete (ascent, chasm07: a ComfyUI 502 on /history in one run; the frames on the volume match the PDF counts). cgi-072: two graphs timed out on the pod (`The operation was aborted due to timeout`), one is running. The frame count is the check that counts.
<!-- run-status:end -->

**Why the last 8 are not generated (2026-11-21, ~10:00 local):** these graphs run the SeedVR2 upscaler over the whole clip and keep it in system RAM. RunPod's system log on the 96 GB RTX PRO 6000 pod says `high memory utilization 76.35 GiB / 87.54 GiB` and then `exit code 137 ... triggered memory limits (OOM)` after 22 minutes of photoreal-013 hadal (160 frames, 1080p); on the 32 GB RTX PRO 4500 pods (57.7 to 59 GiB RAM) every photoreal-013 graph dies about 2 minutes after the prompt is accepted; cgi-072 head sat at 55 of 57.7 GiB. So **more VRAM does not help; system RAM does**, and the ladder 32 -> 96 GB can not fix it. The earlier theory that pinned memory caused it was wrong: `COMFY_ARGS` now carries `--disable-pinned-memory` (Default Configuration env) and hadal still died; the flag can stay or go. Routes left: (1) a card with more system RAM (A100 SXM, create is waiting for stock, `watch-mwptb6sh-a5ep`; B200/B300/H200 are excluded by Lucas); (2) run the graph in frame chunks (`chunk_plan`, about 50 frames for 4K with SeedVR2) if the base_v008 graphs take a frame range; (3) deliver what exists and list these 8 as not generated. The conversion timeout was a separate cause: ComfyUI's page takes 80 to 160 s to become ready on a fresh pod, so the 60 s wait failed; graphs are now run from this Mac with one page per pod (`scratchpad/rungraphs.mjs`), which waits as long as needed.
