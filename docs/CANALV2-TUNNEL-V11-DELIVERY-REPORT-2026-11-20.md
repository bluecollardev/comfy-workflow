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
