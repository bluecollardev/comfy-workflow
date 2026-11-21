# CANALV2: what to import and produce for the Tunnel V11 delivery (the 20 Nov PDF)

**Date:** 2026-11-20. **Status:** plan, read-only research; nothing imported or generated. **Source of the requirement:** `Tunnel _ Media Shuttle Send 112026.pdf` (Binc's contents listing of `BKU1 CANALV2/07_DELIVER/`). **Related:** [CANALV2-DPX-BACKFILL-PLAN.md](./CANALV2-DPX-BACKFILL-PLAN.md) (frames of the reviews already published), ADR-050, ADR-034 runbooks.

## 1. The requirement

36 unique elements, each as: mono left eye, **16-bit DPX, P3-D65 Gamma 2.6, 23.976**, timecode = V11 EDL source-in (the 080 stills start 01:00:00:00), an **H.264 proxy** and a **MANIFEST.json**, frame counts matching the V11 EDL, in the BH `returns/BKK/<round>/<shot>/<clip>/` layout.

## 1a. Output specifications

**Source: Binc's `Tunnel _ Media Shuttle Send 112026.pdf` (20 Nov 2026).** What is quoted is the PDF's own text; the structure comes from its "Contents listing" of the folders sent by Media Shuttle.

**What every element must be** (PDF, page 1): "mono left eye, **16-bit DPX, P3-D65 Gamma 2.6, 23.976**, timecode = V11 EDL source-in (080 stills start 01:00:00:00), **H.264 proxy and MANIFEST.json per element**. Frame counts match the V11 EDL. Spec check of every element: `_records/spec_check_v001.jsonl`." (The photoreal-013 elements are 24 fps in their names and in the delivered folders.)

**Three things per element**, under `returns/BKK/<round>/<shot>/`:

| What | Name and place | Seen in the PDF |
|---|---|---|
| H.264 proxy | `<CLIP>.mp4` next to the shot folder's other files | 1.2 to 47 MB each |
| Manifest | `<CLIP>_MANIFEST.json`, one per element | 6.6 to 83 KB each (so it lists the files, not just the clip) |
| DPX frames | a folder `<CLIP>/` holding `<CLIP>.0000.dpx` to `<CLIP>.<last>.dpx` | frame numbering starts at **0000**; the last number is frames minus 1 (e.g. 94 frames: `.0000` to `.0093`) |

**The clip name** (the same for the mp4, the manifest, the folder and the frames): `<SHOT>_<ELEMENT>_<FINAL|STILL|ALT>_V<nn>_<width>X<height>_<fps>_<CODEC>`, upper case, for example `ARCHIVAL-077_A_FINAL_V03_3840X2160_23.976_PRORES422HQ`, `ARCHIVAL-080_A_STILL_V01_6336X2688_PNG`, `PHOTOREAL-013_ASCENT_FINAL_V01_1920X1080_24_HEVC`. The raster, fps and codec in the name are those of the **source element** (the V11 EDL clip), not necessarily of the DPX (which are the pipeline's 4K output).

**Layout and round.** The PDF's folders all use the round folder `returns/BKK/tunnel-v11-edl-2026-11-18/` with the shot folders under it (`archival-071/`, `archival-077/`, ...). Three packages are described: batch 03 v002 (1,998 files), photoreal-013 v003 (1,931 files) and first17 v003 (2,794 files); the "all-approved v003" folder holds all 36 together. Our own publishes went to `_TEST_` rounds and the app's default round template is `tunnel-v11_{date}_r01`: **the real publish must use the round name `tunnel-v11-edl-2026-11-18`** (Auto-publish setting `round`, or the Publish window's Round field).

**Per element: frames and rasters from the PDF** (these are the checks after production):

| Element | Frames | Name raster, fps, codec | Colour of the DPX |
|---|---|---|---|
| ARCHIVAL-071 main | 227 | 3840x2160, 23.976, ProRes 422 HQ | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-077 a, b, c | 80, 69, 74 | 3840x2160 (a, b), 1920x1080 (c), 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-080 a to e (stills) | 94, 60, 90, 83, 44 | 6336x2688 PNG, start TC 01:00:00:00 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-083 main | 98 | 3852x2152, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-084 main | 39 | 2356x1572, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-085 main | 54 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-087 platform, rain | 97, 96 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (PDF; no record yet) |
| ARCHIVAL-093 b | 126 | 1618x1080, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-102 main | 128 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-104 b | 130 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| ARCHIVAL-123 c, f | 66, 43 | 3840x2160, 23.976 | c: Gamma 2.6 P3-D65 (OCIO record); f: Gamma 2.6 P3-D65 (PDF; no record yet) |
| ARCHIVAL-168 a, b, c, d | 153, 139, 105, 48 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (PDF; no record yet) |
| CGI-042 main | 229 | 3840x2160, 23.976 | Gamma 2.6 P3-D65 (OCIO record) |
| CGI-072 head, backhalf-b, backhalf-c | 106, 70, 162 | 1920x1080, 23.976, **V02**, ProRes 422 HQ | Gamma 2.6 P3-D65 (PDF; no record yet) |
| CREATURE-266 dolphin-lowtrack | 94 | 1920x1080, 23.976 (ALT V01) | Gamma 2.6 P3-D65 (PDF; no record yet) |
| PHOTOREAL-013 ascent, chasm07, f23, hadal, landing, splash, sunlight, top | 108, 271, 633, 160, 226, 96, 212, 209 | 1920x1080, **24**, HEVC (landing and top: ProRes 422 HQ; top is V02) | Gamma 2.6 P3-D65 (PDF; no record yet) |

**Colour, every element:** P3-D65, Gamma 2.6 (PDF page 1). For the 17 elements already on the volume this is confirmed by each sequence's ComfyUI-OCIO record (`colorInteropID: g26_p3d65_display`; all 45 sequences on the volume carry it), while their DPX headers say linear (the known header bug). The 19 not yet produced are expected to carry the same record; check it after production (the Outputs window shows it per sequence from v1.6.8). **Proxies:** Rec.709 (H.264, limited range), made from the stated colour `p3-d65-gamma26`; the 17 on the volume were re-rendered with it on 2026-11-20 (new versions, both ProRes and H.264, each sidecar records `p3-d65-gamma26` and the Rec.709 curve). Convert or tag-only for the Tunnel proxy is still to be settled (section 1b).

**Known issue in the PDF** (CGI-072 head, backhalf-b, backhalf-c in batches 01, 02, 03 v002, first17 v003 and all-approved v003): the DPX header is tagged linear (transfer/colorimetric 2) while the pixels are P3-D65 Gamma 2.6, and the proxies carry no timecode. Corrected copies: `tunnel_v11_2026-11-20_cgi-072-header-fix_v004` (header colour code user-defined instead of linear, pixels unchanged, proxy timecode added). The same header-vs-pixels disagreement is on **all** our volume DPX (all 45 sequences record Gamma 2.6 P3-D65 in the ComfyUI-OCIO record and say linear in the header), so every element we produce needs the header fixed or a note that the header is wrong; see section 5, item 5.

**More the PDF does not say, from ADR-050 (Kyle, 2026-11-19; secondary, check with Binc):** the proxy is H.264 1920x1080, same name, frame count and start timecode as the DPX, no burn-ins, Rec.709 (H.264 because Tunnel's Avid wants it); the timecode is the *source* timecode (the EDL source-in); finished shots go up one at a time and the round's `RETURN-MANIFEST.json` (schema `bh-return-1`, a sha256 for every uploaded file) is rewritten after each shot.

## 1b. Colour: what Rec.709 is, and tag versus convert

**Rec.709** (ITU-R BT.709) is the HD video standard that nearly every screen, player and editing system assumes. It fixes four things: the **primaries** (the red, green and blue that bound the gamut; smaller than P3), the **transfer curve** (how brightness is encoded: about gamma 1/2.2 for capture, shown at about 2.4), the **matrix** (RGB to the YCbCr that H.264 stores) and the **range** (limited: 16 to 235 on 8 bits). Tunnel's Avid wants the H.264 proxy in Rec.709.

**Our DPX are P3-D65, Gamma 2.6**: the same white point (D65) as Rec.709 but a wider gamut and a different curve (the cinema-style display encoding). All 45 sequences on the volume say so in their ComfyUI-OCIO record (`colorInteropID: g26_p3d65_display`, "Gamma 2.6 P3-D65 - Display"), and so does the PDF. Their DPX headers say linear (transfer 2): the header is wrong (section 1a, known issue).

**Two ways to make a Rec.709 proxy from them, and they look different:**
- **Convert:** undo the Gamma 2.6 curve to linear, map P3 to Rec.709 primaries with a matrix, encode with the Rec.709 curve, tag Rec.709. The picture matches the DPX on a Rec.709 display; very saturated P3 colours that Rec.709 cannot show are clipped.
- **Tag only:** leave the pixels alone and write "Rec.709" into the metadata. The proxy then shows the P3 Gamma 2.6 pixel values as if they were Rec.709, so it looks a little different from the DPX (colour and contrast), though the colours are "in the file as delivered".

**The differences, side by side**

| | Our DPX (P3-D65, Gamma 2.6) | Rec.709 proxy (H.264) |
|---|---|---|
| Primaries (gamut) | DCI-P3: wider, more saturated reds and greens | Rec.709: narrower; P3 colours outside it are clipped |
| White point | D65 (0.3127, 0.3290) | D65: the same, so no white shift |
| Transfer curve | Pure power, gamma 2.6 (cinema display) | The Rec.709 curve (linear toe, then about 1/2.2); shown on a monitor at about 2.4 |
| Bit depth and format | 16-bit RGB, full range, one file per frame | 8-bit YUV 4:2:0 (yuv420p), limited range (16 to 235), H.264 |
| Matrix | none (RGB) | BT.709 RGB to YCbCr |
| Where it is used | Grading and delivery to the colourist | The offline edit in Avid, playback, review |

**What each choice does to the picture**
- **Convert (P3 Gamma 2.6 to Rec.709):** on a Rec.709 monitor the proxy looks like the DPX does on a P3 grading display, apart from the clipped extreme colours.
- **Tag only:** the pixel values stay as they are, so contrast and saturation shift a little (Gamma 2.6 values read with the Rec.709 curve look slightly different, and P3 colours look a bit less saturated). The tag claims Rec.709, so a player makes no correction.
- **Today's wrong proxies** (header trusted, `linear-p3-d65`): the Gamma 2.6 values were treated as linear and encoded again, so they look too bright and flat. This is the only case that is plainly wrong, not a choice.

**What the app does today.** The review/proxy converter **converts** from the colour it is told the frames are (the ffmpeg arguments carry a `colorchannelmixer` matrix and the Rec.709 `lutrgb` curve). ADR-050's Tunnel preset (Kyle's spec) says **tag, not a conversion**. Until 2026-11-20 the converter was told `linear-p3-d65` (it trusted the header), so every review and proxy made before then was double-encoded and has the wrong colour. On 2026-11-20 Lucas stated `p3-d65-gamma26` (Default Configuration, `render.colour`, recorded in History) and the phase 1 re-render of the 17 V11 elements uses it; v1.6.8 makes the converter read the ComfyUI-OCIO record instead of guessing from the header (precedence: a stated colour, then the OCIO record, then the configured mode, then `known`).

**Open (to settle with Binc and Kyle, section 5 item 5):** is the Tunnel proxy to be *converted* to Rec.709 (the picture looks like the DPX on a Rec.709 monitor) or only *tagged* (as ADR-050 says)? The PDF does not say. Whichever it is, the Tunnel preset and the review converter must agree, and the proxy's sidecar and manifest should state which was done.

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

5. **The DPX header and the proxy colour (new).** The PDF calls the linear header a bug and ships a corrected copy for CGI-072, so the deliverable headers should not say linear. Our DPX come from the pipeline with that header. Decide with Binc: rewrite the header colour code (pixels untouched, as in `cgi-072-header-fix_v004`) before delivery, or leave it and say so in the manifest. Also: the proxy is "Rec.709" per Kyle; the app's Tunnel preset tags Rec.709 without converting, while the review converter converts from the stated colour (`p3-d65-gamma26`) to Rec.709. Confirm which one the Tunnel proxy should be.

## 6. Order of work

1. Decide section 5 items 1 to 3 (Lucas / Binc).
2. Import `brynley-comfy-2026-11-14` (whole) and the `archival-168` and `cgi-072` shots of `-10-29` (skip cgi-072 until item 1 is answered). Verify the files are on the volume and the counts match.
3. Produce the DPX for archival-123 f (already staged), then the rest, one shot at a time on the running pod, each checked against the PDF frame count before the next. Read-only on locked shots; USD 100 cap (agent-permissions); stop and report on any ambiguity.
4. Render the H.264 proxies for all elements still without one (the 12 of batch 03 plus the 19 new), with the stated colour and the EDL start timecodes.
5. Publish frames, proxies and sidecars to `_TEST_` rounds first (the backfill plan), then the real round with V11 names after Binc confirms.
6. Stop the pod when done.

## 7. Log

- 2026-11-20: cross-checked the PDF against the volume and the Panama rounds: 17 of 36 present, 19 missing; one (123 f) is staged, the rest need two rounds (`-11-14`, and shots of `-10-29`); CGI-072 version mismatch found. Nothing imported or generated.
- 2026-11-20 (later): executed the plan's section 6 steps 2 and 3 through Import Round, see section 8. The delivery report is [CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md](CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md) (what was generated, what was skipped and why, what is delivered).

## 8. Execution, 2026-11-20

**What the volume holds (checked 2026-11-20, `a3upg9ey48`).** The finished DPX under `comfy-shared/output/`, and one staged round, `brynley-comfy-2026-10-23`, under `comfy-shared/temp/rounds/`. None of the other Brynley rounds exist under `comfy-shared/workflows/<round>/` (the listing of each answers "aws exited 1": no such folder). So the sources for the missing elements come from BH's Panama bucket, not from the volume. A full folder listing of the volume was started and did not finish; only the six rounds were checked.

**Why Run Workflows produces the DPX.** Every shot in these rounds ships with the same graph as archival-085 had in `brynley-comfy-2026-10-23`, the shot that produced one of the 17 DPX sets: `<shot>/comfy/workflows/<shot>-common-nodes-vNN-delivery-<date>.json` plus its `-inputs-manifest.json` (checked for archival-087, photoreal-013, archival-168 and archival-085). The finals themselves are `approved/05-outputs/Approved/master/*.mov` (ProRes 422 HQ, 4K) and `elements/`. The graph is the delivery route; the finals are its inputs. Importing with Run Workflows on runs that graph on a pod.

**Imports queued (Import Round, source BH, Run Workflows on, Generate Outputs on, Publish off, approved by Lucas, up to 5 pods, one shot per pod, USD 50 cap).**

| Import | Round | Shots | Why these |
|---|---|---|---|
| `imp-mwp4yo1w-4` | `brynley-comfy-2026-11-14` | archival-087, creature-266, photoreal-013 | 10 of the 19 missing elements (087 x2, creature-266 x1, photoreal-013 x8; some are already in the count) |
| `imp-mwp4yo38-9` | `brynley-comfy-2026-10-29` | archival-168 | 168 a, b, c, d |
| `imp-mwp4yo4x-c` | `brynley-comfy-2026-10-23` | archival-123 | 123 f (already staged on the volume; the graph may also make 123 c again, into a new version folder, nothing overwritten) |

The first two plans of this day were pull-only (`imp-mwp4ub0g-0`, `imp-mwp4ub1o-2`); they were cancelled and replaced by the three above so the DPX are produced in the same step. The `-11-14` round also holds archival-080, 083, 084 and 093, already delivered: left out of the import.

**Held back, not imported:** CGI-072 head, backhalf-b, backhalf-c (the round holds V03 HEVC 24 fps; the PDF wants V02 ProRes 23.976; waiting for Binc, section 5 item 1).

**Also done today (details in the report):** colour pipeline fixed (Gamma 2.6 P3-D65 by default, OCIO record read), the 17 reviews re-rendered with that colour, four failed uploads re-sent, DPX backfill 8 of 24 clips, app releases v1.6.6 to v1.7.0.

**Status of that list (updated 2026-11-21; the list above it was written on 2026-11-20):**
- **DPX header and timecode patch: done.** `dpx_fix` makes corrected copies (colour code user-defined, timecode from the EDL, frame rate, gamma 2.6, frame position); every header is read back on the pod after writing. For the 17 elements in the real round the first-frame headers were also read back from the bucket (transfer and colorimetric 0, 23.976, gamma 2.60, timecodes as the EDL gives them). For the 11 `base_v008` elements the patch is done on the pod and checked there; their headers have not been read back from the bucket yet.
- **The real round `tunnel-v11-edl-2026-11-18`: done for the 17** (1,770 files, 84.88 GB). The `base_v008` elements stay in a `_TEST_` round until Lucas says otherwise.
- **Rec.709 convert-or-tag: still open, parked** (Lucas: Rec.709 later, as its own generation step).
- **Stopping the pods: done.** Pods are stopped, not deleted; old stopped pods whose logs are saved were deleted on 2026-11-21 at Lucas's instruction.

## 9. Delivery of what we have (decided 2026-11-20: "deliver what we can and have first")

**Scope:** the 17 elements that have DPX on the volume and a corrected review video (section 2). The 16 elements without DPX (087, 123 f, 168, creature-266, photoreal-013) and the 3 CGI-072 elements are not in this delivery: see the report, section 3.

**Rules (Lucas, 2026-11-20):**
1. **Test first.** A few elements go to a `_TEST_` round first (`_TEST_tunnel-v11-2026-11-20`) with exactly the layout and names the real round will get. They are checked in the bucket before anything goes to the real round.
2. **Nothing existing in the real `returns/BKK/` is ever overwritten**, in any round that is not a `_TEST_` round. Enforced in the app (v1.7.1): a file already in a non-`_TEST_` round with a different size is refused (the whole run is refused and lists them), a file with the same size is skipped, and a `RETURN-MANIFEST.json` that is not ours is left untouched (the run fails with a 409 after the files are up; nothing is overwritten). Only a `_TEST_` round is written over.
3. S3 only (no Slack post) until the delivery is checked.

**What each element carries (from the PDF, section 1a):** the frames as `<CLIP>/<CLIP>.0000.dpx` and up, the H.264 proxy `<CLIP>.mp4`, and the manifest. The clip name is the EDL's, e.g. `ARCHIVAL-077_A_FINAL_V03_3840X2160_23.976_PRORES422HQ`; the files on disk keep their own names (`..._mono_v015_NOT_RELEASED`) and are renamed on upload only (`clip_names`). The app writes one `RETURN-MANIFEST.json` for the round (sha256 per file); the PDF shows a manifest per element: to settle with Binc.

**Plan check (read-only, 2026-11-20), all 17 against the real round name:** 1,770 files, 91.1 GB, no blockers, nothing refused, the frame count equal to the EDL for each of the 17. One warning: ARCHIVAL-093 b is `low-source-resolution` (1618x1080, as the PDF says).

**Order:** (1) test round with three elements (084 main, 085 main, 123 c); (2) check keys, sizes, names and manifest in the bucket; (3) the other 14 into the test round if the first three are right, or straight to the real round if Lucas says so; (4) the real round `tunnel-v11-edl-2026-11-18`, never overwriting; (5) record in the delivery report.

**Defects of the DPX as the pipeline writes them, and where each stands (updated 2026-11-20, evening):** (1) the header says linear (transfer/colorimetric 2) while the pixels are Gamma 2.6 P3-D65 (the PDF calls it a bug): **fixed in the tool** (`dpx_fix`: user-defined, as the PDF's corrected CGI-072 files), unit-tested on the byte layout, **not yet applied to any frame we have delivered or checked against a frame of Binc's**; (2) no timecode in the header: **fixed in the tool** (TV header, per frame from the EDL start), same state; (3) the manifest per element: **built**, not yet seen in a delivery; (4) the proxy's timecode and the Rec.709 convert-or-tag choice: **open**. Nothing delivered so far (the test round `_TEST_tunnel-v11-2026-11-20`, the earlier `_TEST_` rounds) has the corrected headers: only the copies written under `output/_delivery_v11/` will.

## 10. The cases and how each is handled (2026-11-20)

Not every element is in the same state, so the delivery is handled by case. **Rules for every case:** a `_TEST_` round first, checked in the bucket; nothing already in the real `returns/BKK/` is overwritten (ADR-055); no Slack post until Lucas has checked the result; the DPX on the volume are never altered in place, corrected copies go to `output/_delivery_v11/`.

| Case | Elements | Handling | Status |
|---|---|---|---|
| **A. DPX exist, header wrong** | 17: 071, 077 a/b/c, 080 a-e, 083, 084, 085, 093 b, 102, 104 b, 123 c, cgi-042 | Corrected header copies of the frames (`dpx_fix`: colour code user-defined, timecode, frame rate, gamma), the review video, a manifest per element; `_TEST_` round, then the real round. **The frames are not regenerated**: the picture bytes are copied unchanged, only the 2048-byte header differs | **Done 2026-11-21**: all 17 in the real round `tunnel-v11-edl-2026-11-18` (1,770 files, 84.88 GB, S3 only, no Slack), 17 manifests read back from the bucket; headers were checked on the pod at write time (headers read back from the bucket 2026-11-21: section 14) |
| **B. Stills** | 080 a-e (PNG, start timecode 01:00:00:00) | As A; the start timecode comes from the EDL | Plan check passed |
| **C. Low resolution** | 093 b (1618x1080) | As A, with the `low-source-resolution` warning (the PDF says the same) | Plan check passed |
| **D. No DPX yet, ProRes masters on the volume** | 087 platform and rain, 123 f, 168 a-d, creature-266 dolphin-lowtrack | Convert each master to 16-bit DPX with the stated colour handling (ffmpeg, to build, or Binc's mono pipeline); in the meantime H.264 proxies from the masters can go out marked proxy-only, DPX to follow | Waiting on Lucas and Binc |
| **E. No DPX yet, 24 fps** | photoreal-013, 8 elements (landing and top ProRes, the rest HEVC; top is V02) | As D with the frame rate 24, not 23.976 (the tool takes the rate per element) | Waiting |
| **F. Version mismatch** | CGI-072 head, backhalf-b, backhalf-c | Not held: rendered from V03 HEVC 24 fps (the only round we have; the PDF lists V02 ProRes 23.976), difference noted in the manifest | In `base_v008` import |

**What was found on 2026-11-20 that shapes D and E:** the finals are in the pulled rounds (`<shot>/approved/05-outputs/Approved/master/*.mov`, ProRes 422 HQ 4K); the round's own delivery graph (`<shot>-common-nodes-vNN-delivery-<date>.json`) is a replay that writes MP4 candidates under `shots/<shot>/05-outputs/WIP`, not DPX (archival-168: 7 seconds, four `.mp4`). Those candidates are not delivered: they carry the graph's names, were not compared with the approved masters, and have no DPX or manifest. Run Workflows through Import Round therefore does not produce the DPX; the rounds `-11-14` (the whole round), `-10-29` (archival-168) and `-10-23` (archival-123, staged) are pulled and on the volume.

**The mono graphs that make the DPX (checked on the volume, 2026-11-20).** The DPX of the 17 came from per-clip graphs in the volume rounds `mono_v015` (337 graphs, 25 shots), `mono_v016` (131), `mono_v017` (archival-080 only) and `mono_v018` (080, 101), named `<shot>_<element>_<round>_partNN.json` and run from the volume with Import Round (Source = Volume). There are **no mono graphs for the 16 elements without DPX**: the volume's graphs for archival-123 are `a` and `c` (not `f`), for creature-266 `breach-alt1` and `landing` (not `dolphin-lowtrack`), for photoreal-013 `chasmfast07`, `chasmfastia2` and `floortrack` (not ascent, chasm07, f23, hadal, landing, splash, sunlight, top), and there are none at all for archival-087 (only `proxy_v005` graphs) and archival-168. So the missing DPX are not just "workflows not run": **the graphs that would make them do not exist yet.** They have to be made (Binc's side builds these parts from the final) or the conversion has to be done another way.

**Open decisions:** (1) how the 16 get their DPX: **decided 2026-11-20 to unpack the masters ourselves with ffmpeg, straight, with Rec.709 as a later step (section 11.5)**; Binc's mono graphs remain the alternative; (2) whether to send proxy-only deliveries for D and E meanwhile; (3) the CGI-072 version; (4) the DPX colour code (user-defined, as the PDF's corrected CGI-072 files) and the round-level manifest next to the per-element ones.

**Pods:** stopped, never deleted; their logs are kept (ADR-055 section 4). The delivery copies run on `vvi0hvuj4v5dsg` (RTX PRO 4000, $0.57/h, created 2026-11-20 because the host of `eagffo99jjrf1n` had no free card; idle stop after 30 minutes).

## 11. The 36 elements, their state, and what is left (2026-11-20, evening)

**Summary.** 36 elements in the PDF. **17 have DPX on the volume** with the exact frame counts and a review video re-rendered in the right colour (cases A to C). **16 have no DPX** (D and E) and **3 are held** (F). **None has gone to the real round yet**; the real round `tunnel-v11-edl-2026-11-18` already exists in the bucket and is never overwritten. Three of the 17 (084 main, 085 main, 123 c) are in the test round `_TEST_tunnel-v11-2026-11-20` with the old header; their corrected copies are being written.

### 11.1 The 17 with DPX (cases A to C)

| # | Element | Frames (PDF = volume) | Raster | DPX on volume | Review video re-rendered | Corrected DPX copy | In the real round |
|---|---|---|---|---|---|---|---|
| 1 | ARCHIVAL-071 main | 227 | 3840x2160 | yes | yes | yes | yes |
| 2 | ARCHIVAL-077 a | 80 | 3840x2160 | yes | yes | yes | yes |
| 3 | ARCHIVAL-077 b | 69 | 3840x2160 | yes | yes | yes | yes |
| 4 | ARCHIVAL-077 c | 74 | 1920x1080 | yes | yes | yes | yes |
| 5 | ARCHIVAL-080 a (still) | 94 | 6336x2688 PNG | yes | yes | yes | yes |
| 6 | ARCHIVAL-080 b (still) | 60 | 6336x2688 PNG | yes | yes | yes | yes |
| 7 | ARCHIVAL-080 c (still) | 90 | 6336x2688 PNG | yes | yes | yes | yes |
| 8 | ARCHIVAL-080 d (still) | 83 | 6336x2688 PNG | yes | yes | yes | yes |
| 9 | ARCHIVAL-080 e (still) | 44 | 6336x2688 PNG | yes | yes | yes | yes |
| 10 | ARCHIVAL-083 main | 98 | 3852x2152 | yes | yes | yes | yes |
| 11 | ARCHIVAL-084 main | 39 | 2356x1572 | yes | yes | yes | yes |
| 12 | ARCHIVAL-085 main | 54 | 3840x2160 | yes | yes | yes | yes |
| 13 | ARCHIVAL-093 b | 126 | 1618x1080 (low source resolution) | yes | yes | yes | yes |
| 14 | ARCHIVAL-102 main | 128 | 3840x2160 | yes | yes | yes | yes |
| 15 | ARCHIVAL-104 b | 130 | 3840x2160 | yes | yes | yes | yes |
| 16 | ARCHIVAL-123 c | 66 | 3840x2160 | yes | yes | yes | yes |
| 17 | CGI-042 main | 229 | 3840x2160 | yes | yes | yes | yes |

### 11.2 The 19 without delivered DPX

**Updated 2026-11-21:** the route is `base_v008` through Import Round (not ffmpeg), the last column is the state now; everything from `base_v008` stays in `_TEST_tunnel-v11-base-v008-2026-11-21` until it is right (section 14). CGI-072 is not held.

| # | Element | Frames (PDF) | Raster | DPX on volume | Review video | Corrected DPX copy | In the real round | Note |
|---|---|---|---|---|---|---|---|---|
| 18 | ARCHIVAL-087 platform | 97 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round; blocked in the real round: 29 files there differ in size |
| 19 | ARCHIVAL-087 rain | 96 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 20 | ARCHIVAL-123 f | 43 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 21 | ARCHIVAL-168 a | 153 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 22 | ARCHIVAL-168 b | 139 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 23 | ARCHIVAL-168 c | 105 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 24 | ARCHIVAL-168 d | 48 | 3840x2160 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 25 | CREATURE-266 dolphin-lowtrack (ALT V01) | 94 | 1920x1080 | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 26 | PHOTOREAL-013 ascent | 108 | 1920x1080, 24 fps HEVC | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 27 | PHOTOREAL-013 chasm07 | 271 | 1920x1080, 24 fps HEVC | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 28 | PHOTOREAL-013 f23 | 633 | 1920x1080, 24 fps HEVC | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 29 | PHOTOREAL-013 hadal | 160 | 1920x1080, 24 fps HEVC | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 30 | PHOTOREAL-013 landing | 226 | 1920x1080, 24 fps ProRes | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 31 | PHOTOREAL-013 splash | 96 | 1920x1080, 24 fps HEVC | yes | no | yes | no | Made, matches the PDF count, header-patched, in the test round |
| 32 | PHOTOREAL-013 sunlight | 212 | 1920x1080, 24 fps HEVC | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 33 | PHOTOREAL-013 top (V02) | 209 | 1920x1080, 24 fps ProRes | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 34 | CGI-072 head | 106 | 1920x1080 V02 ProRes 23.976 | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 35 | CGI-072 backhalf-b | 70 | 1920x1080 V02 ProRes 23.976 | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |
| 36 | CGI-072 backhalf-c | 162 | 1920x1080 V02 ProRes 23.976 | no | no | no | no | Not generated: killed for memory (plan section 15); needs chunked runs (ADR-056) |

### 11.4 How we get the missing DPX, in plain words

For 16 elements we have the finished video (a ProRes `.mov`, or an `.mp4` for some photoreal ones) but not the DPX frames the PDF asks for. A DPX is one picture file per frame, so the video has to be unpacked into frames and saved in the delivery format (16-bit, Gamma 2.6 P3-D65, numbered from 0000). There are two ways:

1. **Binc's way.** Binc's side writes a small "mono" graph for each element (like the ones that made the 17) and puts them on the volume. We run them from Import Round (Source = Volume, Run Workflows). Same method as the 17, so same result, but it waits for Binc.
2. **Our way.** We write the unpacking ourselves with ffmpeg on a pod. Quick to build and we need nobody, but the colours must be handled exactly as Binc expects, so Binc has to confirm that first.

Either way, once an element has its frames it is delivered like the 17: corrected header and timecode, review video, manifest, then a test round, then the real round.

### 11.5 Decision (Lucas, 2026-11-20): unpack straight now, Rec.709 as a separate step later

- **The DPX step is a straight unpack.** The ProRes master is unpacked into 16-bit DPX frames with the pixels carried across unchanged; no colour conversion. The frames are labelled as the PDF says (P3-D65, Gamma 2.6): corrected header as in ADR-055 section 3, numbered from 0000, the EDL start timecode, the element's frame rate (23.976, or 24 for photoreal-013).
- **Rec.709 is a separate, later generation step.** The H.264 proxy is made from the DPX, as the 17 already are (the review/proxy converter reads the DPX and is told the colour of the frames). The open choice (convert to Rec.709, or only tag) therefore concerns the proxy step only and does not hold up the DPX.
- **The one assumption to check:** that each master really holds Gamma 2.6 P3-D65, as the PDF says for every element. If a master is Rec.709 in fact, its DPX would carry Rec.709 values under a Gamma 2.6 P3-D65 label and the proxy made from it would look wrong. Check before the real round: read the colour tags of one master of each group (087, 123 f, 168, creature-266, photoreal-013) and compare one unpacked frame with the approved picture. No need to wait for Binc for this check.
- **First run:** `archival-123` f (staged on the volume, no import needed), to a `_TEST_` round, then the others one shot at a time. Built as an ffmpeg step on a pod, written as copies under `output/_delivery_v11/`, never over an existing file.

### 11.3 What needs to be done, in order

**Ours, now (no one else needed):**
1. Write the corrected DPX copies for the three test elements on the new pod, publish them to a second test round (`_TEST_tunnel-v11-fixed-2026-11-20`), and read the headers back from the bucket (colour code, timecode, frame rate, gamma, the per-element manifest). **Status: pod starting.**
2. Compare one corrected frame with a frame from Binc's `cgi-072-header-fix_v004` (colour code and timecode position). If they differ, change the tool and redo step 1.
3. Corrected copies for the other 14 of the 17 (about 85 GB on the volume), published to the test round, checked by a plan against the real round (no refusals, no collisions).
4. The 17 to the real round, S3 only, never overwriting; then the Slack post when Lucas says.
5. Check that the review videos carry the start timecode (the PDF's second defect for CGI-072).

**Needs a decision from Lucas or Binc:**
1. **How the 16 get their DPX** (D, E): Binc makes the mono graphs for them (a new `mono_v0NN` round on the volume, then Import Round with Source = Volume and Run Workflows), or we convert the ProRes masters with ffmpeg (the colour handling to confirm with Binc). Until then the 16 can only be sent as proxy-only (H.264 from the masters), marked as such.
2. **CGI-072**: V02 ProRes 23.976 (PDF) or the V03 HEVC 24 fps in the round.
3. **The DPX colour code** (user-defined, as the corrected CGI-072 files?), the round-level manifest next to the per-element ones, Rec.709 convert or tag for the proxy, and the clip names for the real round (the EDL names are used; Binc confirms).

**To close the job:** stop the pod `vvi0hvuj4v5dsg` (it stops by itself after 30 quiet minutes) and `eagffo99jjrf1n` stays stopped; merge this branch; release the app with the no-overwrite guard, the per-element manifest, `dpx_fix` and the pod logs (full gate); update `docs/CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md` with the final result.

## 12. Rendering the 19 elements without DPX: the work plan (2026-11-21)

**Where it was in this plan before:** section 6, steps 3 and 4 (produce the DPX, then render the H.264 proxies "for the 12 of batch 03 plus the 19 new"); section 11.2 (the list of the 19); sections 11.4 and 11.5 (how: unpack the ProRes masters straight, Rec.709 later). It was a description and a decision, **not a work plan with steps and a state**: nothing for the 19 has been started. This section is that plan. The 36 elements need, each: DPX frames, an H.264 review video, and a manifest. The 17 have all three in progress (section 9); the 19 have none of them.

**Per element, the steps (the same for the 16 in cases D and E; the 3 of case F wait for Binc):**

| Step | What | Where it runs | State |
|---|---|---|---|
| 1 | Check the master's colour tags and compare one unpacked frame with the approved picture (the assumption in 11.5) | one master per group: 087, 123 f, 168, creature-266, photoreal-013 | not started |
| 2 | **Unpack the master into DPX**: 16-bit, numbered from 0000, the frame count equal to the PDF, straight (no colour conversion), at 23.976 (24 for photoreal-013) | an ffmpeg step on a pod, writing a new folder under `output/` (`mono_v019`-style round name, never over an existing folder); **to build**: a core module like `dpxfix.ts`, an MCP tool and an Outputs button | **built, not yet run on a pod**: `libs/core/src/dpxmake.ts` and the MCP tool `dpx_make` (plan, run), tested against real ffmpeg locally; the Outputs button is still to build (ADR-055 section 8). Elements are cuts of their masters: the EDL's source ranges decide which frames are unpacked (`from_edl`). |
| 3 | Check the frames against the PDF count; the EDL judges each sequence (frame count, timecode) | Prepare For Delivery plan | built, runs once step 2 has output |
| 4 | **Render the review video** (H.264 and ProRes, the colour stated, the EDL start timecode) from the new DPX | Outputs > Generate (the same as the 17) | built |
| 5 | Corrected header copies (colour code, timecode, frame rate) | Outputs > Prepare For Delivery | built |
| 6 | Publish to a `_TEST_` round, check, then the real round (never overwriting) | Publish | built |

**Order and size:** the 16 are 2 (087), 1 (123 f), 4 (168), 1 (creature-266) and 8 (photoreal-013) elements; the frames in the PDF add up to 2,690 (087: 193; 123 f: 43; 168: 445; creature-266: 94; photoreal-013: 1,915). Do one shot first, **archival-123 f** (staged, no import needed, 43 frames), through steps 1 to 6 into a `_TEST_` round; then the other 15 one shot at a time, each checked against the PDF count before the next.

**What blocks:** step 2 is not built (about half a day with its tests: the ffmpeg command, the frame numbering, the 16-bit conversion, a read-back of frame count and bit depth); step 1 needs a pod and a few minutes; the **CGI-072 three** wait for Binc's answer on the version. Nothing here needs Binc except the colour check outcome if step 1 shows a master that is not Gamma 2.6 P3-D65.

**Decision needed:** none to start (11.5 decided it). Build step 2 next.

## 13. The route for the 19 is `base_v008` through Import Round; the unpack is the fallback (2026-11-21)

The volume round **`base_v008`** (30 shots, 62 graphs, adapter `brynley-rounds-layout`) has a graph for every one of the 19 elements without DPX: archival-087 platform and rain; 123 a, c, f; 168 a to d; creature-266 breach-alt1, dolphin-lowtrack, landing; photoreal-013 (11 graphs, all 8 elements of the PDF among them); cgi-072 head, backhalf-b, backhalf-c. Earlier sections said no graphs existed: that was wrong, only the `mono_v015` to `v018` rounds and `proxy_v005` had been checked. Lucas's route (2026-11-21): **Import Round, Source = Volume, round `base_v008`, Run Workflows and Generate Outputs on, Publish off**, up to 6 pods, each shot on its own pod, any card of 32 to 96 GB, USD 50 cap. Started as `imp-mwp9elrt-0` (26 graphs at about 61 s). What a base graph writes (DPX or not) is to be read from the first one that finishes.

**The ffmpeg unpack (`dpx_make`, ADR-055 section 8) stays as the fallback**, finished and merged on `develop`: it unpacks the EDL source ranges of a master into 16-bit DPX, straight, never into an existing folder, on a pod. Use it for an element whose base graph does not write DPX. Not yet run on a pod. Found while testing against the real EDL: ARCHIVAL-123_F has an empty second range (in and out both 00:00:04:20), now dropped by `from_edl`; its masters in the round are two "mcp-preview-8bit" files (193 and 151 frames), neither obviously the final.

## 14. Status 2026-11-21: what is delivered, what is in test, what blocks

**Delivered to the real round (`returns/BKK/tunnel-v11-edl-2026-11-18/`):** the 17 of case A. Job `publish-mwpe8qd6-7`; the round now lists 1,840 files (the extra 70 were already there; nothing was overwritten). Read back from the bucket: 17 per-element manifests, the DPX folders and their counts.

**Headers read back from the bucket (first frame of each of the 17, 2026-11-21):** transfer and colorimetric code 0 (user-defined), frame rate 23.976, gamma 2.60, on all 17. Timecode: 071 00:00:00:12, 123 c 00:00:02:00, 080 a-e 01:00:00:00, the others 00:00:00:00 (as the EDL source-in gave them; 084 and 085 start at 00:00:00:00, not independently checked against the EDL here). Film-header fields (frame position, sequence length, filename) were not read back.

**In a test round only (`_TEST_tunnel-v11-base-v008-2026-11-21`):** the `base_v008` elements whose frames exist and match the PDF count: archival-087 platform (97), 123 a (68) and 123 f (43), 168 a-d (153/139/105/48), photoreal-013 ascent (108) and chasm07 (271). Header-patched with `dpx_fix` first (checked on the pod). Decision (Lucas, 2026-11-21): **everything from `base_v008` stays in `_TEST_` until it is right**; nothing of it goes to the real round yet.

**Blocker in the real round:** the round already holds archival-087 platform DPX files that differ in size from ours (49,768,448 bytes there, 49,768,064 here, 29 files). The no-overwrite guard refuses them; they need another clip name or round, a decision for Lucas.

**Not in the 36:** photoreal-013 `chasmfast07` and `chasmfastia2` (extra graphs on the volume) are not on the PDF list; they are never published.

**Still generating:** archival-087 (second element), cgi-072 (head, backhalf-b, backhalf-c, from V03), creature-266 (on a 96 GB card; the 32 GB card died mid-graph), photoreal-013 f23, hadal, landing, splash, sunlight, top. Import `imp-mwpkxqng-0`.

**What went wrong and the fix:** the first `base_v008` import failed on cold pods (HTTP 502/404 on the graph fetch, conversion timeouts). The retry covered only timeouts; it now also covers 404/502/503/504 (6 tries, 20 s apart, commit a733759), the conversion script waits 4 minutes, and ComfyUI is waited for before the first graph. A retried queue task still starts a new pod (NEXT-STEPS); duplicates are stopped by hand (stopped, never deleted).

**Parked:** Rec.709 convert or tag (Lucas: later, as its own generation step).

**Stuck, and how it was got around (2026-11-21, ~23:30 UTC):**
- The queue task for archival-087 sat "running" on a pod that had been stopped (`kwlz8x4p0to1xn`); RunPod would not resume it ("no free GPU on the host", a stopped pod is pinned to its host). Fix: retried the task (new pod). `resume_pod` with `retry_until_free` is the other way.
- Stopping the "duplicate" pods the retry had made also stopped the runs that were attached to them; the queue marked those tasks failed (archival-123, cgi-072, creature-266, photoreal-013). Do not stop a pod before checking which task owns it (`queue_list` pod_id). Lesson written to NEXT-STEPS.
- Workaround used: skip the queue and run the remaining graphs directly with `run_pod_workflows` on four warm pods (cgi-072 on one, creature-266 on the 96 GB card, photoreal-013 split in two), which also runs them in parallel; one pod per shot made photoreal-013 (11 graphs) the long pole.
- Left out on purpose: photoreal-013 `floortrack`, `chasmfast07`, `chasmfastia2` (not among the 36).

<!-- run-status:start -->
### Run status of the 19 (2026-11-21, 13:00 local)

Frames produced (DPX in `delivery_v008/<clip>/` on the volume) against the PDF count. **11 of 19 match; 8 not generated.** A mismatch or an error is shown, never hidden. No frame-count mismatch so far.

| Element | PDF frames | Produced | Check | Run | Error |
|---|---|---|---|---|---|
| ARCHIVAL-087 platform | 97 | 97 | OK | done, in the test round |  |
| ARCHIVAL-087 rain | 96 | 96 | OK | done, in the test round |  |
| ARCHIVAL-123 f | 43 | 43 | OK | done, in the test round |  |
| ARCHIVAL-168 a | 153 | 153 | OK | done, in the test round |  |
| ARCHIVAL-168 b | 139 | 139 | OK | done, in the test round |  |
| ARCHIVAL-168 c | 105 | 105 | OK | done, in the test round |  |
| ARCHIVAL-168 d | 48 | 48 | OK | done, in the test round |  |
| CREATURE-266 dolphin-lowtrack | 94 | 94 | OK | done, in the test round |  |
| PHOTOREAL-013 ascent | 108 | 108 | OK | done, in the test round |  |
| PHOTOREAL-013 chasm07 | 271 | 271 | OK | done, in the test round |  |
| PHOTOREAL-013 splash | 96 | 96 | OK | done, in the test round |  |
| PHOTOREAL-013 hadal | 160 | - | no frames | failed | killed for memory (exit 137) after 22 min on a 96 GB card |
| PHOTOREAL-013 sunlight | 212 | - | no frames | failed | killed for memory on a 32 GB card |
| PHOTOREAL-013 top | 209 | - | no frames | failed | killed for memory on a 32 GB card |
| PHOTOREAL-013 landing | 226 | - | no frames | failed | killed for memory on a 32 GB card |
| PHOTOREAL-013 f23 | 633 | - | no frames | failed | killed for memory on a 4x pod (233 GiB): RAM 40 to over 232 GiB in about a minute |
| CGI-072 head | 106 | - | no frames | failed | killed for memory on a 32 GB card |
| CGI-072 backhalf-b | 70 | - | no frames | not completed | conversion timeout, then its pods died or were stopped before it ran |
| CGI-072 backhalf-c | 162 | - | no frames | not completed | 502 (container killed), then not run again |
<!-- run-status:end -->

**Review of the base_v008 failures (2026-11-21, branch `fix/base-v008-failures`).** Causes and fixes:
- *`Page.wait_for_function: Timeout 60000ms`* (conversion, stage load): the pod ran the image's own `ui2api.py` through a `sed`; whatever the reason it did not take effect on those pods. The app now sends its own converter script (240 s) so nothing depends on the image's copy; a test fails if the app's copy and `apps/comfy-app/docker/ui2api.py` differ.
- *`HTTP 502 for /history/<id>`* (execute): the pod's container was killed for memory (RunPod's system log: `exit code 137 ... triggered memory limits (OOM)`, also on the 96 GB card), ComfyUI restarted with an empty history. The run now keeps asking through an outage of up to 3 minutes, fails at once with "ComfyUI restarted while the graph ran" when ComfyUI is back without the prompt, reads the pod's log to tell out of memory from a plain 5xx, and does not retry an out-of-memory graph on the same card.
- *`The operation was aborted due to timeout`* (execute, load): a single 30 s poll on a busy ComfyUI ended the graph; the poll is now retried (see above). The load-stage graph fetch also retries 404/502/503/504.
- *`502 for /api/userdata/workflows...`* right after a crash: ComfyUI is now waited for before **every** graph, not only the first.
- **Out of memory moves to a bigger card by itself** (`cards.ts`, `queue.ts`): the task goes back to waiting with the next bigger cards (32 -> 48 -> 80 -> 96 GB, never B200, B300, H200), only the graphs that did not finish, at most 3 times; the small pod is stopped, not deleted; each step is a task event and a History line.
- A retried task takes its own pod again; the idle stop no longer stops a pod while a run is on it.
Not verified on a real pod: all of it is unit-tested with fakes; nothing was run against RunPod. The app must be restarted for it to apply.

**Why the last 8 are not generated (2026-11-21, ~10:00 local):** these graphs run the SeedVR2 upscaler over the whole clip and keep it in system RAM. RunPod's system log on the 96 GB RTX PRO 6000 pod says `high memory utilization 76.35 GiB / 87.54 GiB` and then `exit code 137 ... triggered memory limits (OOM)` after 22 minutes of photoreal-013 hadal (160 frames, 1080p); on the 32 GB RTX PRO 4500 pods (57.7 to 59 GiB RAM) every photoreal-013 graph dies about 2 minutes after the prompt is accepted; cgi-072 head sat at 55 of 57.7 GiB. So **more VRAM does not help; system RAM does**, and the ladder 32 -> 96 GB can not fix it. The earlier theory that pinned memory caused it was wrong: `COMFY_ARGS` now carries `--disable-pinned-memory` (Default Configuration env) and hadal still died; the flag can stay or go. Routes left: (1) a card with more system RAM (A100 SXM, create is waiting for stock, `watch-mwptb6sh-a5ep`; B200/B300/H200 are excluded by Lucas); (2) run the graph in frame chunks (`chunk_plan`, about 50 frames for 4K with SeedVR2) if the base_v008 graphs take a frame range; (3) deliver what exists and list these 8 as not generated. The conversion timeout was a separate cause: ComfyUI's page takes 80 to 160 s to become ready on a fresh pod, so the 60 s wait failed; graphs are now run from this Mac with one page per pod (`scratchpad/rungraphs.mjs`), which waits as long as needed.

## 15. Run notes and status, 2026-11-21 (midday)

**Memory limits and every failure's error:** [Appendix A of the delivery report](CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md#appendix-a-which-runs-pushed-the-memory-limits-and-the-error-of-every-failure-2026-11-21) (which runs pushed the limits, the RAM limit of each pod, the errors of the 8 graphs).


**Delivered and verified:** 17 of 36 in the real round `returns/BKK/tunnel-v11-edl-2026-11-18` (1,770 files; manifests and first-frame headers read back from the bucket). **Frames made, matching the PDF counts, in the test round `_TEST_tunnel-v11-base-v008-2026-11-21` only (decision Lucas: nothing from base_v008 goes to the real round until it is right):** 11 of the 19: archival-087 platform (97) and rain (96), 123 f (43), 168 a/b/c/d (153/139/105/48), creature-266 dolphin-lowtrack (94), photoreal-013 ascent (108), chasm07 (271) and splash (96). **Not generated, 8 of 36:** photoreal-013 hadal, sunlight, top, landing, f23; cgi-072 head, backhalf-b, backhalf-c (cgi-072 renders from V03, not held). No review video exists yet for the 11; none of their headers has been read back from the bucket.

**Why the 8 fail (run notes, in the order they were found):**
1. *Conversion timeout.* The pod's own converter failed with `Page.wait_for_function: Timeout 60000ms`. ComfyUI's page takes 80 to 160 s to become ready on a fresh pod, and the pod path kept failing at 60 s even after the 240 s fixes were merged (cause of the 60 s not found; the Mac-side fallback also did not help inside the app). Worked around by running the graphs from this Mac with one Chrome page per pod (`rungraphs.mjs`: fetch the UI graph, convert with ComfyUI's own frontend, POST /prompt, poll /history).
2. *Out of memory, not a bad card.* RunPod's system log on every failed pod says `container is unhealthy: exit code 137 ... triggered memory limits (OOM)`: 1x RTX PRO 4500 (57.7 GiB container RAM, killed about 2 min after the prompt), 1x RTX PRO 6000 (87.5 GiB; RAM 76 GiB then killed after 22 min on hadal), 4x RTX PRO 4500 (232.8 GiB; **killed on f23 at 05:34:58 UTC after RAM went from 40 GiB at 05:33 to over 232 GiB inside about a minute**). A jump like that is not a leak: one step of the graph tries to hold the whole clip in RAM at once. (An earlier note in this session said f23 "wasn't RAM" because only 40 GiB was in use three minutes before the kill. That was wrong; the system log shows the OOM.)
3. *What the graph does.* base_v008 graphs read the source video (OCIORead, frame window, f23: 88 to 720 = 633 frames), scale to 3840x2160, run SeedVR2 (UNETLoader, VAEEncodeTiled, SeedVR2TemporalChunk [1, auto], KSampler, SeedVR2TemporalMerge, VAEDecodeTiled), convert colour and write DPX with OCIOWrite. The merge and write stages hold the whole upscaled clip: 633 frames at 4K float32 is about 63 GB per copy. So RAM needed grows with the frame count; more VRAM does not help.
4. *More RAM is available by adding GPUs.* RunPod has no RAM setting; RAM scales with the GPU count: 1x RTX PRO 4500 = 57.7 GiB, 2x = 116.4 GiB, 4x = 232.8 GiB ($0.72, $1.44, $2.88/h). That fixed nothing for f23 (needs more than 232 GiB in one step), so **chunking by frame window is the real fix** (OCIORead has the window; `chunk_plan` suggests about 50 frames per chunk for 4K SeedVR2). Not done yet.
5. *Pinned memory theory was wrong.* `COMFY_ARGS` now carries `--disable-pinned-memory` (Default Configuration env); hadal still died. It can stay or go.
6. *Escalation to a bigger card* (merged, `cards.ts`) cannot fix this class: it climbs VRAM (32 to 96 GB) and the 96 GB card has less RAM per GB of VRAM than the 4x 4500 pod. It should escalate GPU count for RAM (see NEXT-STEPS).

**Other happenings today:**
- *Auto-publish* had Slack on and posted about 16 review videos (S3 + Slack, round `_TEST_2026-11-21`), including items not on the 36 list (photoreal-013 chasmfast07, creature-266 landing and breach). It is now **off** (turned off by Claude, 2026-11-21); re-enable only with Lucas's say, S3 only until checked. The Slack posts cannot be deleted from here.
- *Pods not ours:* `vlvrtpnig8rkoh` (CanalV2-fix-v020-a, RTX PRO 6000, running, $2.69/h) and `medb5fr68r9la5` (CanalV2-fix-v020-b, stopped) were created at 00:46 UTC by something outside these runs. Not touched.
- *Pod logs saved* in one document with a contents list per pod and per run: `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md` (38 pods, 5.2 MB; not redacted, do not publish). 26 pods have no saved log (stopped before the app saved them; RunPod does not serve a stopped pod's log). After the document was written, 36 old stopped pods with saved logs were deleted at Lucas's instruction (volume untouched); the 26 without a log, the two live RAM-test pods and the two foreign pods were kept.
- *Pod card* now shows GPU count, total VRAM and container RAM (branch `feature/pod-card-gpu-count-ram`, merged to develop, not yet in the running app). The Outputs cards show a red `Frames N / M` badge when a sequence's count differs from the EDL.
- *Known flaws:* a retried queue task still starts a new pod unless it can reuse its own; stopping a pod fails the task attached to it; `run_workflows_job` loses a run's record after a minute or two (the work continues on the pod).
