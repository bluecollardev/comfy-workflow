# CANALV2: what to import and produce for the Tunnel V11 delivery (the 20 Nov PDF)

**Date:** 2026-11-20. **Status:** plan, read-only research; nothing imported or generated. **Source of the requirement:** `Tunnel _ Media Shuttle Send 112026.pdf` (Binc's contents listing of `BKU1 CANALV2/07_DELIVER/`). **Related:** [CANALV2-DPX-BACKFILL-PLAN.md](./CANALV2-DPX-BACKFILL-PLAN.md) (frames of the reviews already published), ADR-050, ADR-034 runbooks.

## 1. The requirement

36 unique elements, each as: mono left eye, **16-bit DPX, P3-D65 Gamma 2.6, 23.976**, timecode = V11 EDL source-in (the 080 stills start 01:00:00:00), an **H.264 proxy** and a **MANIFEST.json**, frame counts matching the V11 EDL, in the BH `returns/BKK/<round>/<shot>/<clip>/` layout.

## 2. Cross-check against the volume (2026-11-20)

Checked on `a3upg9ey48` (`brynley-rounds-eu-ro-1`, EU-RO-1): the DPX under `comfy-shared/output/mono_v015` to `mono_v018`, and the rounds staged under `comfy-shared/temp/rounds/`.

- **17 of 36 elements have their DPX on the volume, with the exact frame counts:** archival-071 main, 077 a b c, 080 a-e, 083, 084, 085, 093 b, 102, 104 b, 123 c, cgi-042 main. (All of batch 03.)
- **19 elements have no DPX on the volume:** the batch 01 and 02 elements below.
- **Staged rounds on the volume: only `brynley-comfy-2026-10-23`** (29 GB: archival-085, 102, 103, 104, 123). Nothing else is staged. So the sources for the 19 are not on the volume yet, except one (123 f).

## 3. The 19 missing elements, and where each comes from

| Element (PDF frames) | Source final in the round | Round | On the volume? |
|---|---|---|---|
| ARCHIVAL-123 f (43) | `archival-123_f_final_v01_3840x2160_23.976_prores422hq.mov` (459 MB) | `brynley-comfy-2026-10-23` | **Yes, staged.** No import needed |
| ARCHIVAL-087 platform (97), rain (96) | `archival-087_platform / _rain_final_v01_3840x2160_23.976_prores422hq.mov` (490 / 451 MB) | `brynley-comfy-2026-11-14` | No: import |
| CREATURE-266 dolphin-lowtrack (94) | `creature-266_dolphin-lowtrack_alt_v01_1920x1080_23.976_prores422hq.mov` (264 MB) | `brynley-comfy-2026-11-14` | No: import |
| PHOTOREAL-013 ascent (108), chasm07 (271), f23 (633), hadal (160), landing (226), splash (96), sunlight (212), top (209) | `photoreal-013_<element>_final_v01_1920x1080_24_hevc.mp4` (landing and top are ProRes .mov, top is v02), 19-202 MB each | `brynley-comfy-2026-11-14` | No: import |
| ARCHIVAL-168 a (153), b (139), c (105), d (48) | `archival-168_<a-d>_final_v01_3840x2160_23.976_prores422hq.mov` (470 / 433 / 320 / 152 MB) | `brynley-comfy-2026-10-29` (the same four are also in `-11-06`) | No: import |
| CGI-072 head (106), backhalf-b (70), backhalf-c (162) | `cgi-072_<head, backhalf-b, backhalf-c>_final_v03_1920x1080_24_hevc.mp4` (51 / 18 / 103 MB) | `brynley-comfy-2026-10-29` (the only round with cgi-072) | No: import |

The names and sizes match the PDF's elements except **CGI-072** (section 5).

## 4. Rounds to import

| Round | Whole-round size | Needed for | Recommendation |
|---|---|---|---|
| `brynley-comfy-2026-11-14` | 13.9 GB, 2,287 files | 087 x2, creature-266 dolphin-lowtrack, photoreal-013 x8 (10 elements) | **Import the whole round.** Small, and it also holds the other photoreal-013 and creature-266 finals |
| `brynley-comfy-2026-10-29` | 39.4 GB, 2,521 files | archival-168 a-d, cgi-072 x3 (7 elements) | **Import only the shots `archival-168` and `cgi-072`** (a shot-level pull), not the whole 39 GB: the rest is other shots already handled (077, 101, cgi-090, depth-182, enhance, map-066, photoreal-187) |
| `brynley-comfy-2026-10-23` | already staged | archival-123 f | Nothing to import |

Not needed: `-10-20`, `-10-22`, `-10-28`, `-11-06`, `-11-06b`, `-11-17` and the `brynley-inbox-*` rounds (older or lighter copies of the same finals; `-11-06` duplicates the 168 finals in `-10-29`).

Importing is a pod job through the app (Network Volumes > Panama, or `panama_import`): it needs a pod on the volume and a named yes for the spend. A short pull of about 14 GB plus two shots is minutes of pod time at the rates seen on this volume (the pod uploads at about 12 MB/s; downloads from the bucket to the volume are typically faster).

## 5. What is still open

1. **CGI-072 does not match.** The PDF's CGI-072 elements are `V02`, `1920x1080`, `23.976`, `PRORES422HQ`, with head = 106 and backhalf-c = 162 frames. The only round with cgi-072 (`-10-29`) holds `v03`, HEVC, **24 fps**. Binc's PDF also lists a header bug for these three (header tagged linear, pixels Gamma 2.6) and a corrected package, `cgi-072-header-fix_v004`. Before producing anything for cgi-072: ask Binc where the V02 ProRes finals are (a round we do not list, or his drive BKU1). Do not produce from the v03 HEVC and call it V02.
2. **Which graph produces the DPX?** The 17 on the volume came from the pod's mono run (`mono_v015`; later `mono_v016` to `v018` also exist). The 19 need the same conversion (stereo to the mono left eye, 16-bit DPX, P3-D65 Gamma 2.6, EDL timecode) from the finals above. Lucas to confirm the graph and version (v015 as before, or v018), and that the finals are the stereo packs the graph expects. This is the "production" step and is the costly one.
3. **Colour statement** for the proxies and the earlier reviews: `linear-p3-d65` (what the app used) or `p3-d65-gamma26` (what the PDF says). See the backfill plan, section 8.
4. **Frame counts** for the 19 are only checkable after production: the PDF's numbers are the targets (097, 096, 043, 153, 139, 105, 048, 106, 162, 070, 094 and the photoreal-013 set).

## 6. Order of work

1. Decide section 5 items 1 to 3 (Lucas / Binc).
2. Import `brynley-comfy-2026-11-14` (whole) and the `archival-168` and `cgi-072` shots of `-10-29` (skip cgi-072 until item 1 is answered). Verify the files are on the volume and the counts match.
3. Produce the DPX for archival-123 f (already staged), then the rest, one shot at a time on the running pod, each checked against the PDF frame count before the next. Read-only on locked shots; USD 100 cap (agent-permissions); stop and report on any ambiguity.
4. Render the H.264 proxies for all elements still without one (the 12 of batch 03 plus the 19 new), with the stated colour and the EDL start timecodes.
5. Publish frames, proxies and sidecars to `_TEST_` rounds first (the backfill plan), then the real round with V11 names after Binc confirms.
6. Stop the pod when done.

## 7. Log

- 2026-11-20: cross-checked the PDF against the volume and the Panama rounds: 17 of 36 present, 19 missing; one (123 f) is staged, the rest need two rounds (`-11-14`, and shots of `-10-29`); CGI-072 version mismatch found. Nothing imported or generated.
