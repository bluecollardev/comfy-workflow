# CANALV2 Tunnel V11: delivery report, 2026-11-20

**Status:** in progress. Written during the day; the final section is filled in when the imports end. **Plan:** [CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md). **Rule:** we deliver what we can and have first.

## 1. Generated and delivered so far

- **Review videos:** the 17 V11 elements on the volume were re-rendered on the pod with the colour Gamma 2.6 P3-D65 (job `render-mwoo3c5o-0`: 17 rendered, 0 failed): a ProRes .mov and an H.264 .mp4 each, in `deliver/<shot>/v###/` with sidecars and a DELIVERY.md.
- **Uploads to `returns/BKK/` (test rounds `_TEST_2026-11-19` and `_TEST_2026-11-20`):** 16 publish jobs done, 72.5 GB. Done: archival-077, 080, 084, 085, 102, 104, 123, 071 and cgi-042.
- **Four uploads that had failed were re-sent and are complete:** archival-123_c (47 files added), archival-104_b (90), archival-080_a v017 (0 added: all 94 frames were already there), archival-071_main (10).
- **DPX backfill:** 8 of 24 clips done; the batch is paused.
- **Not confirmed:** that the corrected-colour videos reached the bucket (Auto-publish reports 11 uploads today; not matched to the 17 re-rendered versions).

## 2. In production (imports queued 15:30)

See plan section 8: `imp-mwp4yo1w-4` (archival-087, creature-266, photoreal-013), `imp-mwp4yo38-9` (archival-168), `imp-mwp4yo4x-c` (archival-123), Run Workflows and Generate Outputs on, up to 5 pods.

## 3. Skipped, and why

| Element | Reason |
|---|---|
| CGI-072 head, backhalf-b, backhalf-c | The only round holds V03 HEVC 24 fps; the PDF wants V02 ProRes 23.976. Waiting for Binc. |
| Anything not in the volume or the staged rounds | Listed here when the imports end (section 4). |

## 4. Result of the imports (to fill in when they end)

Per element: frames produced against the PDF count, DPX on the volume, review video made, published or not, and for each element missing from the volume what was missing.

## 4a. The 36 elements

Per element, with the state of each and what is left, see [the plan, section 11](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md). 17 have DPX and a corrected review video, 16 have no DPX, 3 (CGI-072) are held; none is in the real round yet.

## 5. Not done

DPX header and timecode patch; the real round `tunnel-v11-edl-2026-11-18` (names to confirm with Binc); Rec.709 convert or tag-only; stopping the pod.
