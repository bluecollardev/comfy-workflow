# CANALV2 Tunnel V11: delivery report

**Where every one of the 36 elements stands, and what is wrong.** (Section "UPDATE 2026-11-21, 14:05 Bangkok (07:05 UTC)" below overrides the older statements about the 11.) Checked on 2026-11-21 (afternoon, Bangkok time; the records below are in UTC). Every number in this part was read again from the bucket and the volume for this report. Where I could not read something it says UNVERIFIED.

## UPDATE 2026-11-21, 14:05 Bangkok (07:05 UTC): the 11 are in the real round

**28 of the 36 are now in `returns/BKK/tunnel-v11-edl-2026-11-18`.** The 11 that were held (archival-087 platform and rain, 123 f, 168 a-d, creature-266 dolphin-lowtrack, photoreal-013 ascent, chasm07, splash) were uploaded on Lucas's instruction (job `publish-mwq19u7u-3`: 1,153 files, 57.4 GB, S3 and one Slack note, switch `allow_overwrite` on): the 53 stray sample frames that blocked them were written over by the full corrected sequences.
- **Read back from the bucket afterwards:** every one of the 11 has the right number of DPX frames (97, 96, 43, 153, 139, 105, 48, 94, 108, 271, 96 = the PDF counts) and a correct first-frame header (colour code 0, 23.976 or 24 fps, gamma 2.60).
- **Manifests: done and read back (14:15 Bangkok (07:15 UTC)).** Every one of the 12 elements put in this session (the 11 and archival-123 c) has its own `<CLIP>_MANIFEST.json` in its shot folder, and each lists only its own frames (97, 96, 66, 43, 153, 139, 105, 48, 94, 108, 271, 96: all equal to the PDF counts). `RETURN-MANIFEST.json` has **28 items, one per delivered element**. Two bugs were found and fixed on the way (commits 54bfddf and 19dc14e): the manifest was skipped when one already sat in a real round, and the element name was read as a single letter, so PLATFORM, RAIN, ASCENT, CHASM07 and SPLASH were lumped into one "main" per shot (the first pass wrote bundled manifests: archival-087 listed 193 frames, photoreal-013 475). The three stale bundled `main` items were removed from `RETURN-MANIFEST.json` (original kept as `RETURN-MANIFEST.backup-before-fix.json` in the working folder).
- **Still not right:** (b) **no review video (ProRes or H.264) was sent for these 11**: the folders hold frames only; (c) the review videos of the 17 are still the first pass (section 1, bullet 3); (d) **8 elements are still not generated** (hadal, sunlight, top, landing, f23, cgi-072 head, backhalf-b, backhalf-c).
- **The 28 delivered elements, by name (the 17 first, then the 11).** Real round `returns/BKK/tunnel-v11-edl-2026-11-18`; each has its own `_MANIFEST.json` there, checked in the bucket listing of 2026-11-21 (all 28 manifests present).
  - **17 delivered earlier (job `publish-mwpe8qd6-7`, review videos are the first pass):** archival-071 main; 077 a, b, c; 080 a, b, c, d, e (stills); 083 main; 084 main; 085 main; 093 b; 102 main; 104 b; 123 c; cgi-042 main.
  - **11 delivered 2026-11-21 (job `publish-mwq19u7u-3`, frames and manifest only, no review video):** archival-087 platform, rain; 123 f; 168 a, b, c, d; creature-266 dolphin-lowtrack; photoreal-013 ascent, chasm07, splash.
  - **Not delivered, 8:** photoreal-013 f23, hadal, landing, sunlight, top; cgi-072 head, backhalf-b, backhalf-c.
- **Time labels:** the times in this report's update sections were first written as UTC but are Bangkok time (UTC+7); they are corrected above.
- **Slack:** one note was posted with the upload (what was added, what is missing and why, our failures).
- **Where the rows below say "In the real round: no" for these 11, read this update: they are in.** The table is updated for the 11 rows.

## 1. What is wrong (most important first)

1. **8 of the 36 do not exist.** photoreal-013 hadal, sunlight, top, landing, f23 and cgi-072 head, backhalf-b, backhalf-c have no frames anywhere: not on the volume, not in the bucket. Their graphs run out of memory on RunPod (between 4 and 16 failed attempts each, Appendix A). Nothing here changes until the chunked runs are built (ADR-056).
2. **The 11 that were made cannot go to the real round yet.** All 11 have the right number of frames (matches the PDF) and a correct header, but: **5 of them are blocked** by stray frames already sitting in the real round (bullet 5); **none has an H.264 video** (bullet 6); They are in the test round `_TEST_tunnel-v11-base-v008-2026-11-21` only. That was Lucas's decision and it is still right.
3. **The review videos in the real round are the first pass, not the corrected one.** All 17 delivered elements carry a ProRes and an H.264 that were made from the *old* frames (header said linear, no start timecode), at **24 fps instead of 23.976**, with the colour stated as "P3-D65 Gamma 2.6" (stated 2026-11-20 07:38 UTC). A second pass was made from the corrected frames at 23.976 fps, but Lucas stated the colour again as **"linear P3-D65"** (2026-11-20 17:53 UTC), and that pass exists only as ProRes, only in test rounds, with no H.264. The two passes convert the picture differently. **Which colour is right is not settled and I cannot tell from here.** The H.264 videos have no start timecode in either pass.
4. **Auto-publish posted to Slack 55 times, not about 16.** From 2026-11-19 to 2026-11-21 it posted 55 times to channel `#panama-runpod` (workspace Beinghuman): 21 on 11-19, 28 on 11-20, 6 on 11-21 (UTC). 23 of those went to round `_TEST_2026-11-21`. **9 of the posted frame sets carry the old header** (linear flag, nonsense frame rate and gamma): 087 platform, 168 a, 168 c, 168 d, dolphin-lowtrack and ascent (6 of them on the 36), and 123 a, creature-266 landing and photoreal-013 chasmfast07 (3 not on the 36). The links in those posts expire 72 hours after posting. Auto-publish is off now. The posts cannot be deleted from here.
5. **The real round holds 53 stray frames of elements we have not delivered, and they block delivery of 5 of the 11.** The files are the first 8 frames (13 for 087 platform) of 087 platform, 123 f, 168 a, dolphin-lowtrack, ascent and cgi-072 backhalf-b, uploaded on 2026-11-20 between 07:33 and 08:40 UTC. Each file is 49,768,448 bytes; ours are 49,768,064. The no-overwrite rule refuses a different size, so publishing any of those 5 to the real round would be refused. **I could not find who put them there: no publish job of ours is on record at that time.** The old report said this was only archival-087 platform and 29 files; today I count 13 files for platform and 5 more elements are affected.
6. **None of the 11 has an H.264 video.** All 11 have a ProRes `.mov` on the volume (087 platform v001, rain v002, 123 f v006, 168 a v002, b v001, c v003, d v004, dolphin-lowtrack v002, ascent v004, chasm07 v005, splash v008). I listed every one of those version folders: each holds only the `.mov`, its `.meta.json` and `DELIVERY.md`. Only 123 f's video was made from the corrected frames; the others from the first-pass frames (rain and splash: UNVERIFIED). The earlier report said none had a review video; that was wrong for ProRes.
7. **Four half-finished uploads sit in `_TEST_2026-11-21`:** archival-080 e (9 of 44 frames), archival-168 b (13 of 139), photoreal-013 chasm07 (67 of 271, one file cut short at 7,077,888 bytes) and chasmfastia2 (53 of 95; not on the 36). Each has a `.mov` but no manifest, and no Slack post is on record for them. Test round only, but confusing.
8. **What is right.** The 17 delivered elements are sound: 1,770 files, every frame count equals the PDF, no gaps or duplicate frame numbers, all headers read back from the bucket are correct (user-defined colour code 0, 23.976 or 24 fps, gamma 2.60, start timecode equal to the EDL), a manifest per element, `RETURN-MANIFEST.json` lists exactly the 17. The headers of the 11 test copies are also correct and their timecodes equal the EDL.
9. **Slack was not used for the real round.** The real-round publish was S3 only. "Posted to Slack" in the matrix means a post to a test round.

## 2. How each column was checked

| Column | How it was checked |
|---|---|
| Generated | DPX frames counted in the bucket (`aws s3 ls --recursive` of each round) and the file names checked for gaps. The folders of the 11 exist on the volume (`delivery_v008/`, `_delivery_v11/`, listed, not counted file by file); none of the 8 is in either folder. Compared with the PDF count (plan section 11). |
| Header fixed | The first frame (2,048 bytes) of every sequence read from the bucket: colour code (bytes 801, 802), bit depth, frame rate (1940), gamma (1948), timecode (1920, BCD). "yes" means codes 0, correct frame rate, gamma 2.60 and a timecode equal to the EDL. |
| Review video | Folders `deliver/<shot>/vNNN` on the volume listed with the publish tool (`volume`); the `.meta.json` of each video in the bucket read for version, frame rate, colour statement and source frames. |
| In a test round | The six test rounds listed in the bucket: `_TEST_tunnel-v11-all-2026-11-20`, `_TEST_tunnel-v11-base-v008-2026-11-21`, `_TEST_2026-11-19`, `_TEST_2026-11-20`, `_TEST_2026-11-21` (and the real round). |
| In the real round | `tunnel-v11-edl-2026-11-18` listed in the bucket; `RETURN-MANIFEST.json` read. |
| Posted to Slack | The app's records: `publish-jobs.json` (state `sent`, round, items) and `history.jsonl` (55 finished auto-publish jobs). **I cannot read Slack itself**, so "yes" means the app recorded a successful post. An upload with no job record is shown as "no post on record". |
| Verified in bucket | The delivered files read back from the bucket: count, header, manifest, video. For the 11 this is the test copy only. |

## 3. The stage matrix: all 36 elements

Stages in order: generated, header fixed, review video, test round, real round, posted to Slack, verified in the bucket. "yes" / "no" / "UNVERIFIED" are literal. Rows 1 to 17: delivered. Rows 18 to 27 and 31: made, held in a test round. Rows 28 to 30, 32 to 36: not made.

| # | Element | PDF frames | Generated | Header fixed | Review video | In a test round | In the real round | Posted to Slack | Verified in bucket | One-line problem |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ARCHIVAL-071 main | 227 | yes: 227 = PDF | yes | yes: ProRes + H.264 v001 (first pass); newer ProRes only v002 | yes: several, see note A | yes | yes: v002 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 2 | ARCHIVAL-077 a | 80 | yes: 80 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v003 | yes: several, see note A | yes | yes: v003 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 3 | ARCHIVAL-077 b | 69 | yes: 69 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v005 | yes: several, see note A | yes | yes: v005 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 4 | ARCHIVAL-077 c | 74 | yes: 74 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v004 | yes: several, see note A | yes | yes: v004 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 5 | ARCHIVAL-080 a (still) | 94 | yes: 94 = PDF | yes | yes: ProRes + H.264 v008 (first pass); newer ProRes only v010 | yes: several, see note A | yes | yes: v010 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 6 | ARCHIVAL-080 b (still) | 60 | yes: 60 = PDF | yes | yes: ProRes + H.264 v008 (first pass); newer ProRes only v013 | yes: several, see note A | yes | yes: v013 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 7 | ARCHIVAL-080 c (still) | 90 | yes: 90 = PDF | yes | yes: ProRes + H.264 v008 (first pass); newer ProRes only v011 | yes: several, see note A | yes | yes: v011 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 8 | ARCHIVAL-080 d (still) | 83 | yes: 83 = PDF | yes | yes: ProRes + H.264 v008 (first pass); newer ProRes only v012 | yes: several, see note A | yes | yes: v012 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 9 | ARCHIVAL-080 e (still) | 44 | yes: 44 = PDF | yes | yes: ProRes + H.264 v008 (first pass); newer ProRes only v009 | yes: several, see note A | yes | no: the v009 upload stopped at 9 of 44 frames, no post on record | yes | review video upload to the 2026-11-21 test round stopped at 9 of 44 frames (no manifest there); the real-round copy is complete |
| 10 | ARCHIVAL-083 main | 98 | yes: 98 = PDF | yes | yes: ProRes + H.264 v001 (first pass); newer ProRes only v002 | yes: several, see note A | yes | yes: v002 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 11 | ARCHIVAL-084 main | 39 | yes: 39 = PDF | yes | yes: ProRes + H.264 v004 (first pass); newer ProRes only v005 | yes: several, see note A | yes | yes: v005 | yes | its newer ProRes is in the 2026-11-20 test round, not 2026-11-21 |
| 12 | ARCHIVAL-085 main | 54 | yes: 54 = PDF | yes | yes: ProRes + H.264 v001 (first pass); newer ProRes only v002 | yes: several, see note A | yes | yes: v002 | yes | its newer ProRes is in the 2026-11-20 test round, not 2026-11-21 |
| 13 | ARCHIVAL-093 b | 126 | yes: 126 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v003 | yes: several, see note A | yes | yes: v003 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 14 | ARCHIVAL-102 main | 128 | yes: 128 = PDF | yes | yes: ProRes + H.264 v001 (first pass); newer ProRes only v002 | yes: several, see note A | yes | yes: v002 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 15 | ARCHIVAL-104 b | 130 | yes: 130 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v003 | yes: several, see note A | yes | yes: v003 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 16 | ARCHIVAL-123 c | 66 | yes: 66 = PDF | yes | yes: ProRes + H.264 v003 (first pass); newer ProRes only v004 | yes: several, see note A | yes | yes: v004 | yes | its newer ProRes is in the 2026-11-20 test round, not 2026-11-21 |
| 17 | CGI-042 main | 229 | yes: 229 = PDF | yes | yes: ProRes + H.264 v002 (first pass); newer ProRes only v003 | yes: several, see note A | yes | yes: v003 | yes | real-round videos are the first pass (see bullet 3 in What is wrong) |
| 18 | ARCHIVAL-087 platform | 97 | yes: 97 = PDF | yes | ProRes only v001 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v001 (its frames were the unfixed ones) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | real round holds 13 stray frames of 97, size differs: refused; the posted frames have the old header |
| 19 | ARCHIVAL-087 rain | 96 | yes: 96 = PDF | yes | ProRes only v002 (made 07:18 UTC today; its source frames UNVERIFIED) | yes: base_v008 round only | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | no | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | no review video was ever posted; no real-round clash found |
| 20 | ARCHIVAL-123 f | 43 | yes: 43 = PDF | yes | ProRes only v006 (from the fixed frames) | yes: base_v008 round, and 2026-11-21 round (fixed) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v006 | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | 8 stray frames of 43 in the real round, size differs: refused |
| 21 | ARCHIVAL-168 a | 153 | yes: 153 = PDF | yes | ProRes only v002 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v002 (the frames posted were the unfixed ones) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | 8 stray frames of 153 in the real round, size differs: refused; the posted frames have the old header |
| 22 | ARCHIVAL-168 b | 139 | yes: 139 = PDF | yes | ProRes only v001 (no H.264) | yes: base_v008 round; 2026-11-21 round holds only 13 of 139 frames | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | no: upload stopped, no post on record | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | the 2026-11-21 copy is a 13-frame partial with no manifest |
| 23 | ARCHIVAL-168 c | 105 | yes: 105 = PDF | yes | ProRes only v003 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v003 (unfixed frames) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | the posted frames have the old header |
| 24 | ARCHIVAL-168 d | 48 | yes: 48 = PDF | yes | ProRes only v004 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v004 (unfixed frames) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | the posted frames have the old header |
| 25 | CREATURE-266 dolphin-lowtrack | 94 | yes: 94 = PDF | yes | ProRes only v002 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v002 (unfixed frames) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | 8 stray frames of 94 in the real round, size differs: refused; the posted frames have the old header |
| 26 | PHOTOREAL-013 ascent | 108 | yes: 108 = PDF | yes | ProRes only v004 (no H.264) | yes: base_v008 round, and 2026-11-21 round (unfixed header) | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | yes: v004 (unfixed frames) | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | 8 stray frames of 108 in the real round, size differs: refused; the posted frames have the old header |
| 27 | PHOTOREAL-013 chasm07 | 271 | yes: 271 = PDF | yes | ProRes only v005 (1.03 GB, no H.264) | yes: base_v008 round (271, no manifest); 2026-11-21 round holds only 67 of 271 frames | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | no: upload stopped, no post on record | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | no manifest in the base_v008 round; one of the 67 frames in the 2026-11-21 round is cut short (7,077,888 bytes) |
| 28 | PHOTOREAL-013 f23 | 633 | no: 0 of 633 | no (no frames) | no | no | no | no | no | killed for memory on a 232.8 GiB pod, RAM went 40 GiB to the limit in about a minute; 5 failed attempts |
| 29 | PHOTOREAL-013 hadal | 160 | no: 0 of 160 | no (no frames) | no | no | no | no | no | killed for memory at 76 of 87.5 GiB after 22 minutes; 8 failed attempts; test on a 116 GiB pod unfinished at last report |
| 30 | PHOTOREAL-013 landing | 226 | no: 0 of 226 | no (no frames) | no | no | no | no | no | killed for memory on a 57.7 GiB pod; 7 failed attempts |
| 31 | PHOTOREAL-013 splash | 96 | yes: 96 = PDF | yes | ProRes only v008 (made 07:27 UTC today; its source frames UNVERIFIED) | yes: base_v008 round only | yes (2026-11-21 14:05 Bangkok (07:05 UTC); sample frames overwritten) | no | yes: frames = PDF and header correct, read from the bucket 14:10 UTC; manifest and review video not sent | review video made but never published or posted |
| 32 | PHOTOREAL-013 sunlight | 212 | no: 0 of 212 | no (no frames) | no | no | no | no | no | killed for memory on a 57.7 GiB pod; 4 failed attempts |
| 33 | PHOTOREAL-013 top | 209 | no: 0 of 209 | no (no frames) | no | no | no | no | no | killed for memory on a 57.7 GiB pod; 6 failed attempts |
| 34 | CGI-072 head | 106 | no: 0 of 106 | no (no frames) | no | no | no | no | no | killed for memory at 55.2 of 57.7 GiB after 31 minutes; 15 failed attempts; renders from V03, not held |
| 35 | CGI-072 backhalf-b | 70 | no: 0 of 70 | no (no frames) | no | no | no (8 stray frames, not ours) | no | no | never completed: conversion timeouts and pod restarts; 16 failed attempts. 8 stray frames of another size, with the old linear header, sit in the real round |
| 36 | CGI-072 backhalf-c | 162 | no: 0 of 162 | no (no frames) | no | no | no | no | no | never completed: conversion timeouts and a kill; 15 failed attempts |

**Note A: where the 17 delivered elements also sit.** `_TEST_tunnel-v11-all-2026-11-20` holds all 17 (frames, ProRes, H.264, manifest: the full test set). `_TEST_2026-11-21` holds frames, the newer ProRes and a manifest for 14 of them (not 084, 085, 123 c; 080 e is partial). `_TEST_2026-11-20` holds 084, 085 and 123 c the same way. `_TEST_2026-11-19` and `_TEST_2026-11-20` also hold first-pass copies under the old names (`archival-077_a_mono_v015_NOT_RELEASED`, old header). So each delivered element exists in four or five places in the bucket.

**Note B: versions.** "First pass" = the video that is in the real round; "newer" = the ProRes made later from the corrected frames. Older first-pass versions of 077, 083, 084, 085, 093, 102, cgi-042 and most versions of 080 were also posted to Slack on 2026-11-19 and 2026-11-20; I could not match every older version number to its element, so they are not listed per row.

**Note C: "frames unfixed" for a posted element** means the DPX folder posted to the `_TEST_2026-11-21` round was copied from `delivery_v008/` (the pipeline's own output: linear colour flag, nonsense frame rate and gamma, no timecode). The corrected copies are in `_delivery_v11/` and in the base_v008 test round. The picture bytes are the same in both.

## 4. Posted to Slack, but not on the 36 list

From the app's records (`publish-jobs.json` and `history.jsonl`), matched to the bucket. Slack channel `#panama-runpod`, workspace Beinghuman.

| When (UTC) | What | Round (bucket) | Note |
|---|---|---|---|
| 2026-11-21 00:49 | photoreal-013 **chasmfast07**, v006, 101 frames + ProRes | `_TEST_2026-11-21` | not on the 36; old-header frames |
| 2026-11-21 00:36 | creature-266 **landing**, v003, ProRes + 93 frames | `_TEST_2026-11-21` | not on the 36; old-header frames; the EDL cut is 62 frames, the posted sequence has 93 |
| 2026-11-20 22:23 | archival-123 **a**, v005, ProRes + 68 frames | `_TEST_2026-11-21` | not on the 36; old-header frames |
| 2026-11-19 15:02 to 22:29 | creature-266 **landing** v001 (ProRes), archival-101 v001, archival-103 v002, map-066 v001, enhance-146 v001, photoreal-187 v001, cgi-090 v001, photoreal-013 v001, v002, v003 (the test round holds chasmfast07 and floortrack; which element is v003: UNVERIFIED), archival-123 v002 (123 a: not verified by name) | `_TEST_2026-11-19` (`_TEST_2026-11-20` for cgi-090) | 11 posts, ProRes only, no frames; none of these is on the 36 |

Not posted, as far as the records show: creature-266 **breach-alt1** (no folder, no job, nothing in the bucket; it only failed in generation), photoreal-013 **chasmfastia2** (53 of 95 frames and a ProRes reached the test round, no post on record). The earlier report said breach-alt1 was posted; I find no trace of that.

## 5. Other things found

- **Stray frames in the real round (53 files)** are detailed in bullet 5. Per element: 087 platform 13, 123 f 8, 168 a 8, dolphin-lowtrack 8, ascent 8, cgi-072 backhalf-b 8. Their first-frame headers differ from ours and from each other: colour code 0 with empty frame-rate and gamma fields for five of them, and the old linear code 2 for cgi-072 backhalf-b. Nothing was deleted or changed.
- **Duplicates.** Besides Note A, `_TEST_2026-11-21` holds two sequences of the 11's family that are not on the list (chasmfast07 101 frames, chasmfastia2 53) and the base_v008 test round holds 123 a (68 frames); `_delivery_v11/` on the volume holds all three too.
- **Manifest labels.** The manifests of photoreal-013 ascent and splash (the two I read) say `element: "main"`, not "ascent" / "splash". UNVERIFIED for the others of the 11.
- **chasm07** has no `_MANIFEST.json` in the base_v008 test round.
- **Real-round H.264 sizes.** archival-104 b's H.264 is 228 MB and cgi-042's 214 MB; the others of similar length are 6 to 75 MB. Probably the picture content; not checked.
- **Timecode.** Start timecodes in the headers equal the EDL for all 28 (071 00:00:00:12, 123 c 00:00:02:00, 123 f 00:00:03:01, dolphin-lowtrack 00:00:06:01, ascent 00:00:01:16, chasm07 00:00:03:17, splash 00:00:03:00, 080 a-e 01:00:00:00, the rest 00:00:00:00). The review videos carry no start timecode.

## 6. Decisions only Lucas can make

1. **Which colour statement is right** for the review videos: "P3-D65 Gamma 2.6" (first pass, in the real round) or "linear P3-D65" (newer pass)? Until then neither pass can be called final, and no H.264 exists for the newer one.
2. **The 53 stray frames in the real round:** whose are they, and may they be replaced? They are the reason 5 of the 11 are refused. I will not touch them without a decision.
3. **Build the chunked runs** for the last 8, or deliver 28 of 36 and list the 8 as not generated.
4. **Auto-publish:** keep it off until the Slack posts are accounted for.

## 7. Money running at the last check

Two pods, about $4.10/hour (a 2x RTX PRO 4500 test pod and a pod that is not ours at $2.69/h). Not re-checked for this report; I touched no pod.


---

## Detail from the earlier report
Kept from the first version of this report and corrected where the new checks showed it was wrong.

## Status tables (kept up to date in the production plan)
- [The 17 with DPX: state of each (plan 11.1)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#111-the-17-with-dpx-cases-a-to-c)
- [The 19 without delivered DPX: state of each, same columns (plan 11.2)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#112-the-19-without-delivered-dpx)
- [Run status of the 19: PDF frames against frames produced, errors (plan)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#run-status-of-the-19-2026-11-21-1300-local)
- [What is delivered, in test, and what blocks (plan 14)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#14-status-2026-11-21-what-is-delivered-what-is-in-test-what-blocks)
- [Run notes: why the 8 fail, what was tried, pods and logs (plan 15)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#15-run-notes-and-status-2026-11-21-midday)
- [The rules and the process for memory-safe runs (ADR-056)](ADR-056-memory-safe-graph-runs.md); [delivery integrity and kept logs (ADR-055)](ADR-055-delivery-integrity-and-kept-logs.md)

### D0. What was done (2026-11-20 to 2026-11-21)
**Delivery**
- 17 elements delivered to the real round `tunnel-v11-edl-2026-11-18`: corrected DPX (header and timecode patched), review video, a manifest per element, `RETURN-MANIFEST.json`; checked first in a `_TEST_` round; nothing overwritten; read back from the bucket.
- The 17 review videos re-rendered with Gamma 2.6 P3-D65; four failed uploads re-sent; DPX backfill of already-published reviews (8 of 24 clips) done and paused.
- 11 more elements generated with the `base_v008` graphs through Import Round, checked against the PDF frame counts (all match), header-patched, uploaded to the test round.

**Tools built** (in the app, on develop; tests green): Prepare For Delivery and the MCP tools `dpx_fix` and `dpx_make`; no-overwrite guard and per-element manifests; Queue and History export to CSV and PDF with whole errors; Retry buttons that work; Title Case button labels with a guard test; kept pod logs and app logs (never auto-deleted); wait for ComfyUI before every graph; graph fetch and poll retries; out-of-memory classification and card escalation (to be replaced by chunking); pod reuse on retry; the pod card shows GPU count, total VRAM and container RAM; a red frames badge on Outputs cards whose count differs from the EDL. Releases v1.6.9, v1.6.10, v1.7.0, v1.7.1 (later changes unreleased).

**Findings**
- The failures of the last 8 graphs were memory kills (exit 137), not cold-pod trouble; RAM comes with the GPU count (57.7, 116.4, 232.8 GiB for 1, 2, 4 RTX PRO 4500); the fix is chunked runs ([ADR-056](ADR-056-memory-safe-graph-runs.md)).
- ComfyUI's page takes 80 to 160 s to be ready on a fresh pod, which is why a 60 s conversion wait failed.
- Auto-publish had Slack on and posted review videos; it is now off.

**Housekeeping**
- Every pod's saved log is in one document with a contents list per pod and per run (`~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`); 36 old stopped pods with saved logs were deleted; pods are otherwise stopped, never deleted; ADR-055, ADR-056, the production plan and this report are kept up to date.


**Memory limits and every failure's error:** [Appendix A](#appendix-a-which-runs-pushed-the-memory-limits-and-the-error-of-every-failure-2026-11-21) at the end of this report.

### D1. The 36 elements at a glance (updated 2026-11-21, Bangkok time, after the 11 were published)

| State | Count | Elements |
|---|---|---|
| **Delivered**, real round `returns/BKK/tunnel-v11-edl-2026-11-18`, earlier (review videos are the first pass) | 17 | archival-071 main; 077 a, b, c; 080 a, b, c, d, e; 083 main; 084 main; 085 main; 093 b; 102 main; 104 b; 123 c; cgi-042 main |
| **Delivered** to the real round on 2026-11-21 (frames and manifest, no review video) | 11 | archival-087 platform, rain; 123 f; 168 a, b, c, d; creature-266 dolphin-lowtrack; photoreal-013 ascent, chasm07, splash |
| **Not generated** | 8 | photoreal-013 hadal, sunlight, top, landing, f23; cgi-072 head, backhalf-b, backhalf-c |

**The 28 delivered, one line each** (frames = the PDF count, read back from the bucket):

| # | Element | Frames | Delivered |
|---|---|---|---|
| 1 | ARCHIVAL-071 main | 227 | earlier |
| 2 | ARCHIVAL-077 a | 80 | earlier |
| 3 | ARCHIVAL-077 b | 69 | earlier |
| 4 | ARCHIVAL-077 c | 74 | earlier |
| 5 | ARCHIVAL-080 a (still) | 94 | earlier |
| 6 | ARCHIVAL-080 b (still) | 60 | earlier |
| 7 | ARCHIVAL-080 c (still) | 90 | earlier |
| 8 | ARCHIVAL-080 d (still) | 83 | earlier |
| 9 | ARCHIVAL-080 e (still) | 44 | earlier |
| 10 | ARCHIVAL-083 main | 98 | earlier |
| 11 | ARCHIVAL-084 main | 39 | earlier |
| 12 | ARCHIVAL-085 main | 54 | earlier |
| 13 | ARCHIVAL-093 b | 126 | earlier |
| 14 | ARCHIVAL-102 main | 128 | earlier |
| 15 | ARCHIVAL-104 b | 130 | earlier |
| 16 | ARCHIVAL-123 c | 66 | earlier |
| 17 | CGI-042 main | 229 | earlier |
| 18 | ARCHIVAL-087 platform | 97 | 2026-11-21 |
| 19 | ARCHIVAL-087 rain | 96 | 2026-11-21 |
| 20 | ARCHIVAL-123 f | 43 | 2026-11-21 |
| 21 | ARCHIVAL-168 a | 153 | 2026-11-21 |
| 22 | ARCHIVAL-168 b | 139 | 2026-11-21 |
| 23 | ARCHIVAL-168 c | 105 | 2026-11-21 |
| 24 | ARCHIVAL-168 d | 48 | 2026-11-21 |
| 25 | CREATURE-266 dolphin-lowtrack | 94 | 2026-11-21 |
| 26 | PHOTOREAL-013 ascent | 108 | 2026-11-21 |
| 27 | PHOTOREAL-013 chasm07 | 271 | 2026-11-21 |
| 28 | PHOTOREAL-013 splash | 96 | 2026-11-21 |

**The 8 not delivered:** PHOTOREAL-013 f23 (633), hadal (160), landing (226), sunlight (212), top (209); CGI-072 head (106), backhalf-b (70), backhalf-c (162).

All destinations are S3 only: `s3://bh-panama-exchange-610140802195/returns/BKK/`. Auto-publish posted 55 times to Slack in test rounds (section 1, bullet 4); it is now off. D3 below is kept for history: its 11 are now in the real round.

### D2. Delivered: the real round
- Publish job `publish-mwpe8qd6-7`: **1,770 files, 84.88 GB, 17 elements in 11 shots**, `RETURN-MANIFEST.json` updated. The round lists 1,840 files; the 70 extra were already there and were not touched. Nothing in the round was overwritten.
- Each element: corrected DPX frames (`_delivery_v11/<clip>`), the review video, and its own `<CLIP>_MANIFEST.json`. **The review video is the first pass (old frames, 24 fps, no start timecode); see section 1, bullet 3.**
- **Read back from the bucket (2026-11-21):** all 17 manifests are present; each DPX folder is there with a plausible count (071 227, 077 a/b/c 80/69/74, 080 a-e 94/60/90/83/44, 083 98, 084 39, 085 54, 093 b 126, 102 128, 104 b 130, 123 c 66, cgi-042 229). First-frame headers of all 17: transfer and colorimetric code 0 (user-defined), frame rate 23.976, gamma 2.60, timecode from the EDL (071 00:00:00:12, 123 c 00:00:02:00, 080 a-e 01:00:00:00, the rest 00:00:00:00; 084 and 085 not checked against the EDL separately). Film-header fields (frame position, sequence length, filename) were not read back.
- **The DPX header and timecode patch is done** (`dpx_fix`: colour code user-defined instead of linear, timecode, frame rate, gamma, frame position; the picture bytes are copied unchanged; every header is read back on the pod after writing). It was a fix of the frames' headers, not a regeneration.

### D3. Made and checked, waiting in the test round (11)
Frames produced with the `base_v008` graphs, compared with the PDF's counts, header-patched with `dpx_fix`, and uploaded to `_TEST_tunnel-v11-base-v008-2026-11-21` (about 50 GB in all):

| Element | PDF frames | Produced | Check |
|---|---|---|---|
| ARCHIVAL-087 platform | 97 | 97 | OK |
| ARCHIVAL-087 rain | 96 | 96 | OK |
| ARCHIVAL-123 f | 43 | 43 | OK |
| ARCHIVAL-168 a | 153 | 153 | OK |
| ARCHIVAL-168 b | 139 | 139 | OK |
| ARCHIVAL-168 c | 105 | 105 | OK |
| ARCHIVAL-168 d | 48 | 48 | OK |
| CREATURE-266 dolphin-lowtrack | 94 | 94 | OK |
| PHOTOREAL-013 ascent | 108 | 108 | OK |
| PHOTOREAL-013 chasm07 | 271 | 271 | OK |
| PHOTOREAL-013 splash | 96 | 96 | OK |

**No frame-count mismatch so far.** Updated 2026-11-21 afternoon: the headers of all 11 were read back from the bucket (correct). Each has a ProRes review video on the volume, none has an H.264. **Five of them cannot go into the real round as they are:** the round holds stray frames of a different size (49,768,448 bytes there, 49,768,064 here) for 087 platform (13 files), 123 f, 168 a, dolphin-lowtrack and ascent (8 files each); the no-overwrite rule refuses them, and where those files came from is not known (section 1, bullet 5). Two extra graphs on the volume (photoreal-013 chasmfast07, chasmfastia2) are not among the 36; Auto-publish nevertheless posted chasmfast07 to Slack and uploaded part of chasmfastia2 (section 4).

### D4. Not generated (8) and why
| Element | PDF frames | State |
|---|---|---|
| PHOTOREAL-013 hadal | 160 | killed for memory after 22 minutes on a 96 GB card |
| PHOTOREAL-013 sunlight | 212 | killed for memory (32 GB card, about 2 minutes) |
| PHOTOREAL-013 top | 209 | killed for memory (32 GB card) |
| PHOTOREAL-013 landing | 226 | killed for memory (32 GB card) |
| PHOTOREAL-013 f23 | 633 | killed for memory on a 4x pod with 233 GiB of RAM |
| CGI-072 head | 106 | killed for memory (32 GB card) |
| CGI-072 backhalf-b | 70 | not completed (pods died or were stopped before it ran) |
| CGI-072 backhalf-c | 162 | not completed |

**Cause.** RunPod's system log on every failed pod says `container is unhealthy: exit code 137 ... triggered memory limits (OOM)`. It is system RAM, not VRAM. The graphs read the whole clip, scale it to 4K and run SeedVR2 (chunked inside), then merge, decode, colour-convert and write DPX on the whole batch: 633 frames at 4K float32 is about 63 GB per copy and several copies exist. RAM scales with the GPU count, not the VRAM: 1x RTX PRO 4500 57.7 GiB, 2x 116.4 GiB, 4x 232.8 GiB, 1x RTX PRO 6000 87.5 GiB. f23 went from 40 GiB to over 232 GiB in about a minute, so more RAM alone does not fix it. **The fix is to run these graphs in frame chunks** (decision recorded in `docs/ADR-056-memory-safe-graph-runs.md`; not built yet). CGI-072 renders from V03 HEVC 24 fps (the only version we have; the PDF lists V02 ProRes 23.976); it is not held for anyone.

Earlier failures of the same runs, now understood: HTTP 502 on `/history` is the container being killed; `Timeout 60000ms` in the graph conversion is ComfyUI's page taking 80 to 160 s to be ready on a fresh pod (the graphs are now run from a Mac-side Chrome page that waits as long as needed); "pod lost the prompt" is a restart after a kill.

### D5. Skipped, and why
- Nothing is skipped because it is missing from the volume: every one of the 36 has its source on the volume or in the staged rounds.
- photoreal-013 chasmfast07, chasmfastia2, floortrack and creature-266 landing, breach-alt1 are not among the 36; they were generated or attempted by mistake of scope and are not delivered.
- Rec.709 convert or tag is parked (Lucas: later, as its own generation step).

### D6. Things you should know
- **Auto-publish posted to Slack.** It was on with Slack enabled (standing approval of 2026-11-20 09:10) and published 55 times to S3 and Slack (23 into round `_TEST_2026-11-21`, the rest into `_TEST_2026-11-19` and `_TEST_2026-11-20`), including items not on the list (section 4). It is now **off** (turned off by Claude); re-enable only on Lucas's say, S3 only until checked. The Slack posts cannot be deleted from here.
- **Pods not ours:** `vlvrtpnig8rkoh` (CanalV2-fix-v020-a, RTX PRO 6000, running at $2.69/h) and `medb5fr68r9la5` (CanalV2-fix-v020-b, stopped) appeared at 00:46 UTC from outside these runs. Not touched.
- **Pod logs** are saved in one document with a contents list per pod and per run: `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md` (38 pods, 5.2 MB; not redacted, do not publish). 26 pods have no saved log (stopped before the app saved them). 36 old stopped pods whose logs are in that document were deleted on Lucas's instruction; the volume was not touched.
- **Pods running now:** two RAM-test pods (2x and 4x RTX PRO 4500, $1.44 and $2.88/h) and an A100 request waiting for stock (up to 6 hours). These cost money until stopped.
- **Built today (on develop, not yet in the running app unless restarted):** the pod card shows GPU count, total VRAM and container RAM; a red `Frames N / M` badge on Outputs cards whose frame count differs from the EDL; wait for ComfyUI before every graph; card escalation on out-of-memory (to be replaced by chunking, ADR-056); pod reuse on retry.

### D7. Open
1. The 8 graphs: build chunked runs and generate them (ADR-056 section 5), then patch, check against the PDF counts and publish to the test round.
2. An H.264 review video for each of the 11 (ProRes exists), and the colour decision for all review videos (section 6); then the 8 after them. Header read-back of the 11 is done.
3. Decide with Lucas: what goes from the test round to the real round, and what to do with the 53 stray frames already in it (section 6).
4. Rec.709 convert or tag; CGI-072 V02 against V03 note in the manifest.
5. Stop the RAM-test pods and the A100 request when the generation is done.

---

## Appendix A. Which runs pushed the memory limits, and the error of every failure (2026-11-21)
**Date:** 2026-11-21. **Part of:** [the production plan](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md) (sections 14 and 15). **Decision it led to:** [ADR-056](ADR-056-memory-safe-graph-runs.md). **Sources:** RunPod's own system log of each pod (`[system]` lines, UTC; the full logs are in `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`) and the app's History (`history.jsonl`, 214 failed `base_v008` graph runs, times UTC).

## A1. How to read the errors
| What the app showed | What it was |
|---|---|
| `ComfyUI answered HTTP 502 for /history/<id>` (26 runs) | **The container was killed for memory** (system log: `exit code 137 ... triggered memory limits (OOM)`); ComfyUI restarts and forgets the prompt. The recovery text "a transient problem... retried at most twice, 5 then 20 minutes apart" is wrong for this case: a retry on the same pod meets the same limit. |
| `the pod lost the prompt (restarted: out of memory?)` (Mac-side runner) | The same kill, seen by the runner: the prompt is neither in the queue nor in the history after the pod restarted. |
| `ComfyUI answered HTTP 502 / 404 for /api/userdata/workflows...` (124 runs) | The graph fetch at the start of a graph: ComfyUI not up yet (cold pod) or restarting right after a kill. |
| `The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded` (53 runs) | **Not memory.** ComfyUI's page takes 80 to 160 s to be ready on a fresh pod and the conversion gave up after 60 s. |
| `The operation was aborted due to timeout` (11 runs) | The app's own poll of a busy ComfyUI gave up (fixed: it keeps asking for up to 3 minutes); not memory by itself. |

## A2. The container RAM limit of each pod
Read from the system log (`high memory utilization - used / limit`) and from ComfyUI's startup line (`Total RAM`):
| Card | Container RAM limit |
|---|---|
| RTX PRO 4500 (one pod) | 27.94 GiB (pod `2f3nrnl70593lf`), 57.7 GiB (others) |
| RTX 5090 | 55.88 GiB (`2uhkv8qexsx5ui`, `o74wl0wesb887e`), 85.68 GiB (`ftnr9m237wrdtk`) |
| RTX PRO 6000 | 87.54 GiB (`1qo9ndp1cbq7u8`, `3svm5sllhfito3`) |
| RTX PRO 6000 WK | 262.6 GiB (`ej3q8v0srppy63`) |
| 2x RTX PRO 4500 | 116.4 GiB (`v2283n9nfof484`) |
| 4x RTX PRO 4500 | 232.8 GiB (`wcw7rzxp622iou`) |

The limit comes with the host and the GPU count, not with the VRAM, and it differs between pods of the same card. **What is not shown:** that one graph passes on a pod with more RAM and dies on a pod with less. The graphs that passed (ascent, chasm07, splash) and the ones that died (hadal, f23, cgi-072 head) are different graphs; the first real test of "more RAM is enough" is hadal on the 116.4 GiB pod, still running when this was written.

## A3. The runs that pushed or hit the limit (system log evidence)
| UTC | Pod, card, limit | Graph running (app History) | What the system log says | What the app showed |
|---|---|---|---|---|
| 2026-11-20 17:55 | `o74wl0wesb887e`, RTX 5090, 55.88 GiB | archival-087 | high memory 46.29 GiB (82 %) | (this graph finished later) |
| 2026-11-20 18:25 to 18:28 | `2f3nrnl70593lf`, RTX PRO 4500, 27.94 GiB | archival-087 | high memory 21.54 to 23.63 GiB (77 to 84 %), rising | (no kill in the saved log) |
| 2026-11-20 18:05:59, kill 18:17:09 | `2uhkv8qexsx5ui`, RTX 5090, 55.88 GiB | photoreal-013 chasmfast07 | high memory 43.3 GiB (77 %) at 18:08; `exit code 137 ... OOM` at 18:17:09 and 18:17:11 | HTTP 502 for /history/27498fd5... |
| 2026-11-20 18:07:13 to 18:17:17 | `ftnr9m237wrdtk`, RTX 5090, 85.68 GiB | creature-266 breach-alt1 (twice, 18:07:13 and 18:14:54) | 74.73 GiB (87 %) at 18:09:42, `137` at 18:10:01; 77.91 GiB (90 %) at 18:16:38, `137` at 18:17:15 and 18:17:17 | HTTP 502 for /history/d750e952... and /history/366c7627... |
| 2026-11-20 19:40:36 | `ej3q8v0srppy63`, RTX PRO 6000 WK, 262.6 GiB | photoreal-013 f23 | high memory 207.3 GiB (78 %) steady 20:04 to 20:07 | HTTP 502 for /history/005c3d2a... |
| 2026-11-20 23:03:05, 23:27:16, 23:43:30, 23:48:26 | `1qo9ndp1cbq7u8`, RTX PRO 6000, 87.54 GiB | creature-266 breach-alt1 (four times) | **84.71 GiB (96 %) at 23:06:49, 86.8 GiB (99 %) at 23:07:18, `137` at 23:07:46**; `137` at 23:28:27; 70.84 GiB (80 %) at 23:18:11 | HTTP 502 for /history/c4afef38..., ac2246bf..., 21a2a7a5..., 42817299... |
| 2026-11-20 23:48:47 and 2026-11-21 00:21:29 | `1qo9ndp1cbq7u8` | photoreal-013 f23, then hadal | (same pod, container restarted by the kills above) | HTTP 502 for /history/3854fd9a... and /history/d36fa727... |
| 2026-11-21 02:23 to 02:33 | `xrvnto15sdq32x`, RTX PRO 4500, 57.7 GiB | photoreal-013 hadal, sunlight, top, landing, one after the other, each killed about 2 minutes after the prompt | ComfyUI restarted each time (`Starting server` at 02:24:43 and 02:25:11; no `[system]` memory line was captured in the tail) | `the pod lost the prompt` x4 |
| 2026-11-21 02:28 to 02:51 | `3svm5sllhfito3`, RTX PRO 6000, 87.54 GiB | photoreal-013 hadal (22 minutes) | **76.35 GiB (87 %) at 02:49:50; `exit code 137 ... OOM` at 02:50:07**; RAM was still rising | `the pod lost the prompt` at 02:51:22 |
| 2026-11-21 02:23 to 02:54 | `519be4ha35a35m`, RTX PRO 4500, 57.7 GiB | cgi-072 head (31 minutes) | `pod_ram`: **55.2 of 57.7 GiB (95.6 %)** at about 02:52 | `the pod lost the prompt` at 02:54:32 |
| 2026-11-21 05:24 to 05:36 | `wcw7rzxp622iou`, 4x RTX PRO 4500, 232.8 GiB | photoreal-013 f23 (633 frames) | 40.4 GiB at 05:33 (ComfyUI `system_stats`); **`OOM` at 05:34:41, 05:34:47, 05:34:52, `exit code 137` at 05:34:58** | `the pod lost the prompt` at 05:36:41 |
| 2026-11-21 05:20 to now | `v2283n9nfof484`, 2x RTX PRO 4500, 116.4 GiB | photoreal-013 hadal | 39.6 GiB at 05:33, 56.7 GiB at 05:43; running | (still running when this was written) |

Read: a graph that dies on 57.7 GiB (hadal, cgi-072 head) came within 4 GiB of the limit on a 57.7 GiB pod after 31 minutes and passed 76 GiB on a 87.5 GiB pod; f23 went from 40 GiB to the 232 GiB limit in about a minute. The memory is taken by the stages that work on the whole clip (merge, decode, post-process, colour, write), not by the chunked SeedVR2 sampling.

## A4. The errors of each of the 8 graphs that are not generated
Count of failed attempts in the History per graph and kind (all attempts, all pods, 2026-11-20 and 21):
| Graph | Attempts failed | Conversion timeout (60 s) | Graph fetch 502/404 | 502 on /history (killed) | Poll timeout |
|---|---|---|---|---|---|
| photoreal-013 hadal | 8 | 3 | 2 | **3** | 0 |
| photoreal-013 sunlight | 4 | 2 | 2 | 0 | 0 |
| photoreal-013 top | 6 | 2 | 3 | 0 | 1 |
| photoreal-013 landing | 7 | 2 | 4 | **1** | 0 |
| photoreal-013 f23 | 5 | 1 | 1 | **3** | 0 |
| cgi-072 head | 15 | 7 | 6 | **1** | 1 |
| cgi-072 backhalf-b | 16 | 7 | 6 | **1** | 2 |
| cgi-072 backhalf-c | 15 | 7 | 6 | **2** | 0 |

Most failed attempts never reached the graph (cold pod, page not ready); the **kills** are the ones the history shows as 502 on `/history`, and the Mac-side runs added `the pod lost the prompt` (hadal x2, sunlight, top, landing on 59 GiB; hadal on 87.5 GiB; f23 on 232.8 GiB; cgi-072 head on 57.7 GiB). A graph with no kill listed (sunlight, top) was never held long enough to be killed in the app's History, but was killed in the Mac-side runs.

Exact error strings (for searching the logs): `ComfyUI answered HTTP 502 for /history/<prompt id>`, `ComfyUI answered HTTP 502 for /api/userdata/workflows%2Fbase_v008%2F<shot>%2F<graph>.json`, `ComfyUI answered HTTP 404 for /api/userdata/workflows...`, `The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded.`, `The operation was aborted due to timeout`, `Dispatch paused: 3 graphs in a row (...) failed`, `the pod lost the prompt (restarted: out of memory?)`.

## A5. Where to look
- Every pod's full log, one section per pod and per run: `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`. Pods stopped before the app saved them have none (the 4x pod's last log is among the lost).
- The app's History: `~/.config/runpod-pod-manager/history.jsonl`; failures with their recovery text: `failures.jsonl`.
- What to do about it: [ADR-056](ADR-056-memory-safe-graph-runs.md) (probe, chunk by default, live guard, RAM by GPU count).
