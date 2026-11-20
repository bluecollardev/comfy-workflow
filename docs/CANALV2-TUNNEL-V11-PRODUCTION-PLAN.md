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
