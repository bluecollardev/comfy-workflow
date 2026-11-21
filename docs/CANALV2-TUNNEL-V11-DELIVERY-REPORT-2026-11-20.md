# CANALV2 Tunnel V11: delivery report

**Where every one of the 36 elements stands, and what is wrong.** Rewritten on 2026-11-21 at about 18:00 Bangkok time (UTC+7; every time in this report is Bangkok time unless it says UTC). The counts come from the bucket and the render pods through `scripts/delivery-status.py` (the block below), from `RETURN-MANIFEST.json` and from the app's records. Where I could not read something it says UNVERIFIED. Appendix A (the memory-limit evidence) is history and unchanged.

## Live status

<!-- LIVE-STATUS:START -->
**Live status, 2026-11-21 19:56 Bangkok time** (written by `scripts/delivery-status.py`; read-only).

- **In the real round (element manifest present): 35 of 35 targeted** (36 in the PDF; f23 deferred by Lucas). `RETURN-MANIFEST.json` should list the same number.
- **Deferred:** PHOTOREAL-013_F23 (633 frames).

| Render pod | Element | Written (of PDF) | Chunk running | s per frame | ETA (render) |
|---|---|---|---|---|---|
| top | pod unreachable: HTTP Error 404: Not Found | | | | |
| landing | PHOTOREAL-013_LANDING | 226 of 226 | 0 frames | 28.9 | 20:06 |
| sunlight | PHOTOREAL-013_SUNLIGHT | 212 of 212 | 0 frames | 28.8 | 20:06 |
<!-- LIVE-STATUS:END -->

## Where we are (19:57 Bangkok time)

**Update 19:57: 35 of the 36 are in the real round; f23 is the only one left (tomorrow).** Frame check, `dpx_fix` (parallel, one render pod each, done about 19:27) and three parallel upload jobs (landing `publish-mwqdwb6n-2` 19:28:27 to 19:48:45, top `publish-mwqdyu4b-4` 19:30:25 to 19:49:52, sunlight `publish-mwqdz3z3-5` 19:30:38 to 19:50:36 Bangkok time, S3 only, 8.7 to 9.3 MB/s each, about 31.7 MB/s together). `RETURN-MANIFEST.json` reached 35 items at 19:50:35.
- **Verified from the bucket (read only, 19:55):** top 209, landing 226, sunlight 212 frames = the PDF; numbering contiguous from 0000, no duplicates, every object 49,768,064 bytes; each element manifest readable with an `issues` section (one warning each: `no-review-video`); `RETURN-MANIFEST.json`: 35 items, schema bh-return-1, one per element, no duplicates, no bundled or `main` item.
- **First-frame headers read from the bucket (range read, 2 KB):** top, landing, sunlight, and also head and hadal (open item 8 of the issue register, now closed): colour code 0 (user-defined), 16 bit, 3840x2160, film and TV frame rate 24.0 (head 23.976), gamma 2.6, timecodes top 00:00:00:00, landing 00:00:00:01, sunlight 00:00:04:05, head 00:00:02:02, hadal 00:00:00:00 = the `dpx_fix` values.
- **Gaps found:** (a) the manifests of **top (6 files) and sunlight (3 files) have `sha256: n/a`** for the frames the cancelled first upload attempts had already sent (the second job skipped same-size files and did not hash them; the files are in the bucket and the right size); (b) no review video for these three yet. (c) Observation: header bytes that the DPX writer (Lavc) leaves in the TV header (interlace, field number, video signal) hold arbitrary non-zero values in every frame sampled, the earlier elements included (not set by `dpx_fix`); whether Binc's tools care is not known.
- **Pods:** top `kqdx2u4xqs8jef` was stopped by the system at 19:55:12 (the idle watch, not by us; cause not verified); landing and sunlight are still running and their logs are saved (`pod-logs/2026-11-21/`, plan section 33).


- **32 of the 36 elements are in the real round `returns/BKK/tunnel-v11-edl-2026-11-18`**, each with its own `_MANIFEST.json`; `RETURN-MANIFEST.json` lists 31 items (written 17:42:28) and `ISSUES.json` is there too (17:42:39). They are: the 17 of the first delivery (job `publish-mwpe8qd6-7`), the 11 of 21 November (job `publish-mwq19u7u-3`, 14:05), CGI-072 backhalf-b (job `publish-mwq8028p-0`, 16:43 to 16:49), and CGI-072 head and PHOTOREAL-013 hadal (job `publish-mwq8u9sx-0`, 266 files, 13.2 GB, finished about 17:42).
- **CGI-072 backhalf-c is in the real round too (18:22):** 162 contiguous frames, `dpx_fix` done (timecode 00:00:16:23), uploaded as job `publish-mwqb56ax-2` through a pod (the first try, `publish-mwqb11kb-1`, was cancelled after 5 frames because the app picked the pod that was rendering; the re-run skipped those); its manifest is written 18:22:54. That is **32 delivered**; `RETURN-MANIFEST.json` is checked by the delivery subtask (expected 32).
- **Rendered through the app's own queue on 2x pods and now delivered:** PHOTOREAL-013 landing (226 frames, 1 h 54), top (209, 1 h 49) and sunlight (212, about 1 h 49) at about 29 s per delivered frame, then `dpx_fix` and the parallel upload (see the update above).
- **1 is deferred by Lucas:** PHOTOREAL-013 f23 (633 frames). Its render was cancelled in the probe (about USD 0.15). It takes about 5.6 hours as one run; `run_split` (merged, ADR-056 section 8) can render it in three ranges on three pods in about 2 hours.
- **Sunlight was being rendered twice** (ours through the app, and the other session's hand script on `8eyco022cqbswy`, both into `delivery_v008/PHOTOREAL-013_SUNLIGHT…`): at Lucas's instruction I interrupted the other script's running prompt at 18:10 (its frames 0 to 99 stay; our run is the only writer now). The message I tried to send to that session failed, so it should be told not to resubmit.
- **f23 is planned for tomorrow, 22 Nov (Lucas, 18:45):** restart the app (done tonight at 19:19, for the merged code; the next restart loads the manifest tools and Purge Dry Runs), then f23 through `run_split` on three 2x pods (about 2 hours); the target is 36 of 36 once it is in.
- **The target for this round was 35 of 36 until f23; it is reached.** What the 31 do not have: **no review video** for the 11, backhalf-b, head and hadal (frames and manifests only), and the 17 first-delivery videos are the first pass (section 1).
- **How the pieces were made.** The 17 and the 11 came out of the pipeline earlier (graphs `base_v008`, Import Round). backhalf-b was rendered through the app on a 1x pod after chunked runs were built (51 s per frame). Head, hadal and backhalf-c were rendered by the hand script `chunkrun.mjs` of another session of Lucas's (client `chunkrun-mac`, not visible in the app's Queue), then checked here (frame count, contiguous, same size), corrected with `dpx_fix` from the Prepare For Delivery settings and published through a pod like the others. Landing, top and sunlight are rendered by the app.
- **Decisions and process:** [ADR-057](ADR-057-parallel-renders-and-uploads-in-the-app.md); the running log is in the production plan, sections 18 to 26.

## 1. What is wrong (most important first)

> The full issue register (24 items, status, next step, what blocks what) is [CANALV2-TUNNEL-V11-ISSUES-2026-11-21.md](CANALV2-TUNNEL-V11-ISSUES-2026-11-21.md); this section keeps the delivery content issues in the report's own words.


1. **The review videos in the real round are the first pass, and the colour is not settled for them.** The 17 first-delivery elements carry a ProRes and an H.264 made from the *old* frames (header said linear, no start timecode), at **24 fps instead of 23.976**, with the colour stated as "P3-D65 Gamma 2.6" (stated 2026-11-20 07:38 UTC). A second pass was made from the corrected frames at 23.976 fps while the colour was stated again as **"linear P3-D65"** (2026-11-20 17:53 UTC); it exists only as ProRes, only in test rounds, with no H.264. On 2026-11-21 Lucas chose `p3-d65-gamma26` for Auto-generate's review videos. Whether the 17 are redone, and which colour is right for them, is **open**. The H.264 videos carry no start timecode in either pass.
2. **14 delivered elements have no review video in the real round:** the 11 of 21 November (ProRes exists on the volume for each, no H.264), backhalf-b, head and hadal (none made). The folders hold frames and the manifest only.
3. **The delivered DPX are 3840x2160 although the clip names say 1920X1080.** backhalf-b's frames are 49,768,064 bytes each (3840 x 2160 x 3 x 2 bytes plus header); the `base_v008` graph upscales. The other 1920x1080 elements probably have the same raster (UNVERIFIED for each). Nothing was changed; this is a question for Binc.
4. **Auto-publish posted to Slack 55 times, not about 16** (2026-11-19 to 2026-11-21, channel `#panama-runpod`, workspace Beinghuman: 21 on 11-19, 28 on 11-20, 6 on 11-21 UTC), all into test rounds; **9 of the posted frame sets carry the old header** (087 platform, 168 a, 168 c, 168 d, dolphin-lowtrack and ascent on the 36; 123 a, creature-266 landing and photoreal-013 chasmfast07 not on the 36). The links in those posts expire 72 hours after posting. The posts cannot be deleted from here. Auto-publish is now enabled **in dry run** (section 4).
5. **`ISSUES.json` in the real round lists things that are not ours.** It was written at 17:42 with 11 `not-generated` entries: 6 are not among the 36 (archival-123 a, creature-266 breach-alt1 and landing, photoreal-013 chasmfast07, chasmfastia2, floortrack) and 5 are ours and still in progress or deferred (cgi-072 backhalf-c, photoreal-013 landing, sunlight, top, f23). It is rewritten at every publish. Restricting it to the EDL's 36 is not built.
6. **Three files went through this PC.** In the head and hadal upload, frames 0056, 0057 and 0058 of head (about 150 MB) were sent from this PC after the pod's upload of them failed (the app falls back per file). Their sha256 are recorded like the others' and the transfer had finished when it was noticed. The pod that did the rest was the other session's busy pod (about 6.5 MB/s).
7. **Half-finished uploads sit in the test round `_TEST_2026-11-21`:** archival-080 e (9 of 44 frames), archival-168 b (13 of 139), photoreal-013 chasm07 (67 of 271, one file cut short at 7,077,888 bytes) and chasmfastia2 (53 of 95; not on the 36). Test round only, but confusing; unchanged since the last check (UNVERIFIED today).
8. **backhalf-b's manifest has no `issues` section** (it was published before that code was in the running tool server); the head and hadal manifests should have it (UNVERIFIED: object contents were not read).
9. **What is right.** The 17 first-delivery elements: 1,770 files, every frame count equals the PDF, no gaps or duplicates, headers read back from the bucket correct (user-defined colour code 0, 23.976 or 24 fps, gamma 2.60, start timecode equal to the EDL). The 11: right frame counts (97, 96, 43, 153, 139, 105, 48, 94, 108, 271, 96), correct first-frame headers, an element manifest each, the 53 stray frames that blocked them replaced (switch `allow_overwrite`, S3 and one Slack note). backhalf-b: 70 frames 0000 to 0069 of equal size, headers of three frames read back. Head, hadal and backhalf-c: 106, 160 and 162 frames, contiguous and of equal size on the volume, headers read back on the pod after `dpx_fix`.
10. **Slack was not used for the real-round uploads** except one note with the 11-element upload; backhalf-b, head and hadal went S3 only.

## 2. How each column was checked

| Column | How it was checked |
|---|---|
| Generated | DPX frames counted in the bucket (`aws s3 ls --recursive`, profile `panama`, of each round) and the file names checked for gaps; on the volume, the folder of each element listed (`delivery_v008/`, `_delivery_v11/`). Compared with the PDF count (plan section 11). For the renders in progress, the render pod's ComfyUI `/queue` and `/history` (GET only). |
| Header fixed | The first frame (2,048 bytes) of every sequence read from the bucket: colour code (bytes 801, 802), bit depth, frame rate (1940), gamma (1948), timecode (1920, BCD). "yes" means codes 0, correct frame rate, gamma 2.60 and a timecode equal to the EDL. For head, hadal and backhalf-c, the read-back `dpx_fix` itself does on the pod after writing (bucket read-back: UNVERIFIED). |
| Review video | Folders `deliver/<shot>/vNNN` on the volume listed with the publish tool; the `.meta.json` of each video in the bucket read for version, frame rate, colour statement and source frames. |
| In a test round | The test rounds listed in the bucket: `_TEST_tunnel-v11-all-2026-11-20`, `_TEST_tunnel-v11-base-v008-2026-11-21`, `_TEST_2026-11-19`, `_TEST_2026-11-20`, `_TEST_2026-11-21` (and the real round). |
| In the real round | `tunnel-v11-edl-2026-11-18` listed in the bucket; an element counts when its own `_MANIFEST.json` is there (`python3 scripts/delivery-status.py` counts them); `RETURN-MANIFEST.json` read (31 items at 17:42:28). |
| Posted to Slack | The app's records: `publish-jobs.json` (state `sent`, round, items) and `history.jsonl` (55 finished auto-publish jobs). **I cannot read Slack itself**, so "yes" means the app recorded a successful post. |
| Verified in bucket | The delivered files read back from the bucket: count, header, manifest, video. |

## 3. The stage matrix: all 36 elements

Stages in order: generated, header fixed, review video, test round, real round, posted to Slack, verified in the bucket. "yes" / "no" / "UNVERIFIED" are literal. Rows 1 to 27, 29, 31, 34 and 35: in the real round (31). Row 36: waiting for its upload. Rows 30, 32 and 33: rendering. Row 28: deferred.

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
| 18 | ARCHIVAL-087 platform | 97 | yes: 97 = PDF | yes | ProRes only v001 (no H.264, not in the real round) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`); 13 stray frames replaced | yes: v001 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | no review video in the real round; the test-round post carried the old header |
| 19 | ARCHIVAL-087 rain | 96 | yes: 96 = PDF | yes | ProRes only v002 (source frames UNVERIFIED) | yes: base_v008 round only | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | no | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | no review video was published |
| 20 | ARCHIVAL-123 f | 43 | yes: 43 = PDF | yes | ProRes only v006 (from the fixed frames) | yes: base_v008 round, and 2026-11-21 round (fixed) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`); 8 stray frames replaced | yes: v006 | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | no review video in the real round |
| 21 | ARCHIVAL-168 a | 153 | yes: 153 = PDF | yes | ProRes only v002 (no H.264) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`); 8 stray frames replaced | yes: v002 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | the test-round post carried the old header |
| 22 | ARCHIVAL-168 b | 139 | yes: 139 = PDF | yes | ProRes only v001 (no H.264) | yes: base_v008 round; the 2026-11-21 round holds only 13 of 139 | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | no: upload stopped, no post on record | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | a 13-frame partial copy with no manifest sits in `_TEST_2026-11-21` |
| 23 | ARCHIVAL-168 c | 105 | yes: 105 = PDF | yes | ProRes only v003 (no H.264) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | yes: v003 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | the test-round post carried the old header |
| 24 | ARCHIVAL-168 d | 48 | yes: 48 = PDF | yes | ProRes only v004 (no H.264) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | yes: v004 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | the test-round post carried the old header |
| 25 | CREATURE-266 dolphin-lowtrack | 94 | yes: 94 = PDF | yes | ProRes only v002 (no H.264) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`); 8 stray frames replaced | yes: v002 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | the test-round post carried the old header |
| 26 | PHOTOREAL-013 ascent | 108 | yes: 108 = PDF | yes | ProRes only v004 (no H.264) | yes: base_v008 round, and 2026-11-21 round (old header) | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`); 8 stray frames replaced | yes: v004 (old-header frames, test round) | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | the test-round post carried the old header |
| 27 | PHOTOREAL-013 chasm07 | 271 | yes: 271 = PDF | yes | ProRes only v005 (1.03 GB, no H.264) | yes: base_v008 round (271, no manifest there); the 2026-11-21 round holds only 67 of 271 | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | no: upload stopped, no post on record | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | in the 2026-11-21 test round one of the 67 frames is cut short (7,077,888 bytes) |
| 28 | PHOTOREAL-013 f23 | 633 | no: 0 of 633 (the render was cancelled in its 10-frame probe) | no | no | no | no | no | no | **deferred by Lucas** (2026-11-21): about 5.6 hours as one run; `run_split` (merged) can render it in three ranges later |
| 29 | PHOTOREAL-013 hadal | 160 | yes: 160 = PDF (other session's hand script; checked: contiguous, same size) | yes (`dpx_fix`, timecode 00:00:00:00, 24 fps) | no | no | yes (job `publish-mwq8u9sx-0`; its manifest was written about 17:42) | no | manifest and frames in the bucket; first-frame header read back on the pod: ok; read from the bucket: UNVERIFIED | no review video |
| 30 | PHOTOREAL-013 landing | 226 | yes: 226 = PDF (app, chunked, 2x pod, 26-frame chunks, 28.9 s per frame, 1 h 54) | yes (`dpx_fix`, timecode 00:00:00:01, 24 fps) | no | no | yes (job `publish-mwqdwb6n-2`, 19:28:27 to 19:48:45, 226 files, 11.25 GB; manifest 19:48:31) | no (S3 only) | yes: 226 frames 0000 to 0225, all 49,768,064 bytes, sha256 for all 226, first-frame header read from the bucket (code 0, 24 fps, gamma 2.6, 00:00:00:01) | no review video |
| 31 | PHOTOREAL-013 splash | 96 | yes: 96 = PDF | yes | ProRes only v008 (source frames UNVERIFIED) | yes: base_v008 round only | yes (2026-11-21 14:05, job `publish-mwq19u7u-3`) | no | yes: frames = PDF, header correct, manifest present (read from the bucket 2026-11-21); no review video | review video made but never published or posted |
| 32 | PHOTOREAL-013 sunlight | 212 | yes: 212 = PDF (app, chunked, 2x pod, 28.8 s per frame, about 1 h 49; the first try on a 1x pod failed: RAM guard at 90.5%) | yes (`dpx_fix`, timecode 00:00:04:05, 24 fps) | no | no | yes (job `publish-mwqdz3z3-5`, 19:30:38 to 19:50:36; 209 sent + 3 already there; manifest 19:50:20) | no (S3 only) | yes: 212 frames 0000 to 0211, all 49,768,064 bytes, header read from the bucket (code 0, 24 fps, gamma 2.6, 00:00:04:05); **3 files have sha256 n/a in the manifest** | no review video |
| 33 | PHOTOREAL-013 top | 209 | yes: 209 = PDF (app, chunked, 2x pod, 28-frame chunks, 28.7 s per frame, 1 h 49) | yes (`dpx_fix`, timecode 00:00:00:00, 24 fps) | no | no | yes (job `publish-mwqdyu4b-4`, 19:30:25 to 19:49:52; 203 sent + 6 already there; manifest 19:49:25) | no (S3 only) | yes: 209 frames 0000 to 0208, all 49,768,064 bytes, header read from the bucket (code 0, 24 fps, gamma 2.6, 00:00:00:00); **6 files have sha256 n/a in the manifest** | no review video |
| 34 | CGI-072 head | 106 | yes: 106 = PDF (other session's hand script; checked: contiguous, same size) | yes (`dpx_fix`, timecode 00:00:02:02, 23.976 fps) | no | no | yes (job `publish-mwq8u9sx-0`; manifest 17:27:19) | no | manifest and frames in the bucket; header read back on the pod: ok | renders from V03 HEVC 24 fps (the PDF lists V02 ProRes 23.976); 3 frames (0056 to 0058) went through this PC after the pod upload of them failed; no review video |
| 35 | CGI-072 backhalf-b | 70 | yes: 70 = PDF (app, chunked, 1x pod, 7 prompts, 51 s per frame) | yes (`dpx_fix`, timecode 00:00:03:01, 23.976 fps) | no | no | yes (job `publish-mwq8028p-0`, 16:43 to 16:49; 8 stray frames replaced) | no | yes: 70 frames 0000 to 0069, all 49,768,064 bytes; headers of frames 0000, 0035, 0069 read from the bucket (code 0, 23.976 fps, gamma 2.6, timecodes 00:00:03:01, 00:00:04:12, 00:00:05:22); manifest present | its manifest predates the `issues` section; no review video |
| 36 | CGI-072 backhalf-c | 162 | yes: 162 = PDF (other session's hand script; checked: contiguous, same size) | yes on the volume (`dpx_fix`, timecode 00:00:16:23, 23.976 fps) | no | no | no: the upload is queued behind hadal's job | no | no (0 of 162 frames in the bucket at 17:54) | upload not started at 17:54 |

**Note A: where the 17 delivered elements also sit.** `_TEST_tunnel-v11-all-2026-11-20` holds all 17 (frames, ProRes, H.264, manifest: the full test set). `_TEST_2026-11-21` holds frames, the newer ProRes and a manifest for 14 of them (not 084, 085, 123 c; 080 e is partial). `_TEST_2026-11-20` holds 084, 085 and 123 c the same way. `_TEST_2026-11-19` and `_TEST_2026-11-20` also hold first-pass copies under the old names (`archival-077_a_mono_v015_NOT_RELEASED`, old header). So each delivered element exists in four or five places in the bucket.

**Note B: versions.** "First pass" = the video that is in the real round; "newer" = the ProRes made later from the corrected frames. Older first-pass versions of 077, 083, 084, 085, 093, 102, cgi-042 and most versions of 080 were also posted to Slack on 2026-11-19 and 2026-11-20; I could not match every older version number to its element, so they are not listed per row.

**Note C: "old header" for a posted element** means the DPX folder posted to the `_TEST_2026-11-21` round was copied from `delivery_v008/` (the pipeline's own output: linear colour flag, nonsense frame rate and gamma, no timecode). The corrected copies are in `_delivery_v11/`, in the base_v008 test round and, since the uploads, in the real round. The picture bytes are the same in both.

## 4. Posted to Slack, but not on the 36 list

From the app's records (`publish-jobs.json` and `history.jsonl`), matched to the bucket. Slack channel `#panama-runpod`, workspace Beinghuman.

| When (UTC) | What | Round (bucket) | Note |
|---|---|---|---|
| 2026-11-21 00:49 | photoreal-013 **chasmfast07**, v006, 101 frames + ProRes | `_TEST_2026-11-21` | not on the 36; old-header frames |
| 2026-11-21 00:36 | creature-266 **landing**, v003, ProRes + 93 frames | `_TEST_2026-11-21` | not on the 36; old-header frames; the EDL cut is 62 frames, the posted sequence has 93 |
| 2026-11-20 22:23 | archival-123 **a**, v005, ProRes + 68 frames | `_TEST_2026-11-21` | not on the 36; old-header frames |
| 2026-11-19 15:02 to 22:29 | creature-266 **landing** v001 (ProRes), archival-101 v001, archival-103 v002, map-066 v001, enhance-146 v001, photoreal-187 v001, cgi-090 v001, photoreal-013 v001, v002, v003 (the test round holds chasmfast07 and floortrack; which element is v003: UNVERIFIED), archival-123 v002 (123 a: not verified by name) | `_TEST_2026-11-19` (`_TEST_2026-11-20` for cgi-090) | 11 posts, ProRes only, no frames; none of these is on the 36 |

Not posted, as far as the records show: creature-266 **breach-alt1** (no folder, no job, nothing in the bucket; it only failed in generation), photoreal-013 **chasmfastia2** (53 of 95 frames and a ProRes reached the test round, no post on record). The earlier report said breach-alt1 was posted; I find no trace of that.

**Since 2026-11-21 14:05:** one Slack note was posted with the 11-element upload (what was added, what is missing and why, our failures). backhalf-b, head and hadal went S3 only.

**Auto-publish today.** It is **enabled in dry run** (standing approval under Lucas's name, 2026-11-21 07:45 UTC), round `tunnel-v11-edl-2026-11-18`, S3 and Slack both ticked, cancel window 10 minutes, daily cap 50 (the setting accepted 1 to 50; the merged change allows 1 to 100, 0 or empty = no limit), review videos in `p3-d65-gamma26`. A dry run uploads nothing and posts nothing. **Its scope is a concern before it goes live:** at 17:35 its dry-run list held, besides archival-087 v002 and photoreal-013 v007 to v009 (v007 is chasmfastia2, not on the 36), `cgi-072` v001 and v002 (which element: UNVERIFIED) and `map-066` v002, and Auto-generate was waiting on assembly runs of the other session (ARCHIVAL-080, ARCHIVAL-077, CGI-090) and `mono_v018` sequences; the app's own Auto-publish pane showed only part of these lists (fixed on `develop`, live after the restart). Going live as it stands could send those to the real round and to Slack. It also uploads DPX only as the original frames when `include_dpx` is on, not the corrected copies (ADR-057, decision 7).

## 5. Other things found

- **Stray frames in the real round (53 files): resolved.** Per element they were 087 platform 13, 123 f 8, 168 a 8, dolphin-lowtrack 8, ascent 8, cgi-072 backhalf-b 8 (headers differed from ours); the 11's upload and backhalf-b's upload replaced them with `allow_overwrite` (the 11: frame counts read back equal the PDF; per-file sizes of the 10 other than backhalf-b: UNVERIFIED).
- **Duplicates.** Besides Note A, `_TEST_2026-11-21` holds two sequences of the 11's family that are not on the list (chasmfast07 101 frames, chasmfastia2 53) and the base_v008 test round holds 123 a (68 frames); `_delivery_v11/` on the volume holds all three too.
- **Manifest labels (fixed).** The first bundled manifests lumped PLATFORM, RAIN, ASCENT, CHASM07 and SPLASH into one "main" per shot; fixed at 14:11 (commits 54bfddf, 19dc14e) and the 12 manifests rewritten and read back; `RETURN-MANIFEST.json` is merged by shot and element. chasm07 has no `_MANIFEST.json` in the base_v008 test round (test round only).
- **Real-round H.264 sizes.** archival-104 b's H.264 is 228 MB and cgi-042's 214 MB; others of similar length 6 to 75 MB. Probably the picture content; not checked.
- **Timecode.** Start timecodes in the headers equal the EDL for the 28 first delivered (071 00:00:00:12, 123 c 00:00:02:00, 123 f 00:00:03:01, dolphin-lowtrack 00:00:06:01, ascent 00:00:01:16, chasm07 00:00:03:17, splash 00:00:03:00, 080 a-e 01:00:00:00, the rest 00:00:00:00); backhalf-b 00:00:03:01, head 00:00:02:02, hadal 00:00:00:00 (24 fps), backhalf-c 00:00:16:23. The review videos carry no start timecode.
- **A chunk loop lived in the tool server and died with it** (16:34, a dropped connection ended the backhalf-b loop; its last chunk finished on the pod regardless). Long renders now go through the app's queue, and a chunked run is saved as a record the app adopts after a restart (built, merged; runs started before it are not adoptable).
- **Jobs the app cannot see.** The other session's hand-script renders (client `chunkrun-mac`) are not in Queue, History or `running_jobs`; head, hadal and backhalf-c were rendered that way, and backhalf-c's last chunk was still running at 16:59 when the delivery was started.
- **The Generate window's counters stayed on `checking…`** (`checking… ready · checking… waiting · checking… failed`, 26 failed previews, 91 folders, screenshot 15:13); the probe of the folders does not finish. The preview batch also timed out on a pod that was rendering (`The file did not arrive in time`). Open.
- **The Auto-publish banner read `DRY RUN · scanning volume`** in every screenshot of the afternoon. Not investigated.
- **False `Frames N / M` alarms** on chunked renders (each chunk is a run: `5 / 70`, `11 / 70`, `50 / 162`): fixed on `develop` (union of frames, one row per chunked render, incomplete sequences hidden), live after the restart.
- **The LTXVideo node pack fails to import on the pods** (`No module named '...ComfyUI-LTXVideo-5122208afffb8f6f.nodes_registry'`: the pack's folder name carries a hash). Harmless for our graphs (they use OCIORead, SeedVR2, OCIOWrite; the same pod wrote DPX normally). SeedVR2 also reports SageAttention and Flash Attention missing, which may make it slower than it could be (not measured).
- **A pod created with `like_pod_id` ignores the GPU count** (a 2x pod came up as 1x; one 2x pod read 55.9 GiB of RAM instead of 116 GiB). Pods are created with an explicit count now.

## 6. Decisions only Lucas can make

| # | Question | State |
|---|---|---|
| 1 | Which colour statement is right for the review videos of the 17 first-delivery elements ("P3-D65 Gamma 2.6" or "linear P3-D65"), and are they redone? | **Open.** Auto-generate's review videos are set to `p3-d65-gamma26` (Lucas, 2026-11-21) for the new elements. |
| 2 | The 53 stray frames in the real round | **Resolved:** replaced by the uploads (Lucas authorised `allow_overwrite` for these elements). |
| 3 | Build chunked runs for the last 8, or deliver 28 of 36 | **Resolved:** chunked runs built (ADR-056) and used; 31 delivered, 3 rendering. |
| 4 | Spend for the renders | **Resolved:** Lucas authorised it without a figure (2026-11-21), past Binc's USD 100 line; the cost is logged (section 7). |
| 5 | Publish to the real round | **Resolved:** "if checks are good then publish for real" (Lucas, 2026-11-21); each element is checked, corrected with `dpx_fix` from the Prepare For Delivery settings and published S3 only, through a pod. |
| 6 | f23 | **Resolved for now:** skipped (Lucas, 2026-11-21 evening). When to render it later is open. |
| 7 | Auto-publish: go live? | **Open, after a scope review** (section 4): the off-list entries must be cancelled or excluded first; Lucas said "turn off dry run and publish" for the end of the run. |
| 8 | The raster (3840x2160 against the names' 1920X1080) | **Open: ask Binc.** |
| 9 | Which review videos go with the 31 / 35, and in which colour | **Open** (see 1). |
| 10 | CGI-072 renders from V03 HEVC 24 fps; the PDF lists V02 ProRes 23.976 | **Open: tell Binc** (note it in the manifest). |

## 7. Money

- **Pods of ours today (approximate, from the pod prices and run times; the app's spend history is not split by job):** backhalf-b test on a 1x RTX PRO 4500 ($0.72/h): about $0.35 for the run that was killed for memory and about $0.7 for the chunked run; the f23 render cancelled in its probe: about $0.15; landing, top and sunlight on 2x RTX PRO 4500 ($1.44/h each) since 17:07, 17:07 and 17:26: about $1.3, $1.3 and $0.8 by 18:00, and roughly $3 to $3.5 each if the pods are stopped about 19:30 after the renders (render ETA 19:10 to 19:20), about $10 for the three; the 1x pod `f1zkjr7oh97gy7` created by mistake never ran anything.
- **Total spend history:** the app's estimate since 2026-11-04 is **USD 546.31 for all projects and agents**, not only this job (not split). Binc's rule is USD 100 total until Brynley sets another figure; Lucas authorised the Tunnel V11 renders without a figure.
- **Running now (17:55):** our `top` (`kqdx2u4xqs8jef`), `landing` (`h563hjyoacn5p0`) and `sunlight` (`zlujagddxx5gop`), 2x each; the other session's `ComfyUI-chunk-proof-2x4500` (`8eyco022cqbswy`, 2x, idle stop 45 min); and `vlvrtpnig8rkoh` (`CanalV2-fix-v020-a`, 1x RTX PRO 6000, $2.69/h, **idle stop never**, not ours, not touched). Stopped: `c9as9qiz11ka87` (f23), `f1zkjr7oh97gy7`, `so7icc2vb2j80o`, `4h9i01g5dhfh83`, `medb5fr68r9la5`.
- **Added at 18:12:** `ComfyUI-v008-uploader-1x` (`4c3riwayw293jo`, 1x RTX 4090, on-demand, idle stop 30 min) for uploads, because the stopped pods `f1zkjr7oh97gy7` and `so7icc2vb2j80o` could not be resumed (their hosts had no free GPU; the retry watches were cancelled). Stop it when the uploads are done.
- **Standing rule:** stop (never delete) our pods when idle, with their logs saved first (`pod_logs`); a pod is deleted only after its log is saved.

---

## Detail from the earlier report
Kept from the first version of this report and corrected where the new checks showed it was wrong.

## Status tables (kept up to date in the production plan)
- [The 17 with DPX: state of each (plan 11.1)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#111-the-17-with-dpx-cases-a-to-c)
- [The 19 without delivered DPX: state of each, same columns (plan 11.2)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#112-the-19-without-delivered-dpx-11-delivered-2026-11-21-1405-bangkok-0705-utc-8-not-generated)
- [What is delivered, in test, and what blocks (plan 14, superseded by the Live status and plan section 26)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#14-status-2026-11-21-what-is-delivered-what-is-in-test-what-blocks)
- [Run notes: why the 8 failed, what was tried, pods and logs (plan 15)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#15-run-notes-and-status-2026-11-21-midday)
- [The renders of the last elements, their delivery, f23, the progress log (plan 18 to 26)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#18-chunked-runs-for-the-8-log)
- [The rules and the process for memory-safe runs (ADR-056)](ADR-056-memory-safe-graph-runs.md); [delivery integrity and kept logs (ADR-055)](ADR-055-delivery-integrity-and-kept-logs.md); [parallel renders and uploads in the app (ADR-057)](ADR-057-parallel-renders-and-uploads-in-the-app.md)

### D0. What was done (2026-11-20 to 2026-11-21)
**Delivery**
- 17 elements delivered to the real round `tunnel-v11-edl-2026-11-18` (job `publish-mwpe8qd6-7`): corrected DPX (header and timecode patched), review video (first pass), a manifest per element, `RETURN-MANIFEST.json`; checked first in a `_TEST_` round; read back from the bucket.
- The 17 review videos re-rendered with Gamma 2.6 P3-D65 (ProRes, test rounds); four failed uploads re-sent; DPX backfill of already-published reviews (8 of 24 clips) done and paused.
- 11 more elements generated with the `base_v008` graphs through Import Round, checked against the PDF frame counts (all match), header-patched, then published to the real round on 2026-11-21 14:05 (job `publish-mwq19u7u-3`, 1,153 files, 57.4 GB), replacing the 53 stray frames; manifests fixed and read back at 14:15.
- **Since then:** CGI-072 backhalf-b rendered through the app with chunking (1x pod, 7 prompts, 70 frames) and published (16:49); head and hadal (rendered by the other session's script) checked, corrected with `dpx_fix` and published (17:42); backhalf-c checked and corrected, upload queued; landing, top and sunlight rendering through the app on 2x pods; f23 deferred.

**Tools built** (in the app, on `develop`): Prepare For Delivery and the MCP tools `dpx_fix` and `dpx_make`; the Prepare For Delivery settings as a configuration block (`delivery_prepare`, exported and imported with the configuration); no-overwrite guard and per-element manifests with an `issues` section, and `ISSUES.json` for failed generations; chunked graph runs (probe first, 85% RAM guard, escalation), chunk-run records adopted after a restart, frame ranges and `run_split`; upload pod choice, parallel uploads and real byte progress for jobs started elsewhere; Queue and History export; Retry buttons; Title Case labels with a guard test; kept pod and app logs; the pod card with GPU count and RAM; the Outputs window with grouping by type, paging, collapse, temp files hidden, frame-preview jobs, a filmstrip, merged chunk runs and incomplete sequences hidden; the Auto-publish pane showing every list; a daily cap of 1 to 100. **Release v1.7.2** (built, gated, published on `bluecollardev/downloads`, tagged and pushed, 16:23); the work after it is merged to `develop` without the gate (ADR-057, decision 10) and goes live at the restart after the renders. ADR-055, ADR-056, ADR-057, the production plan and this report are kept up to date; `scripts/delivery-status.py` refreshes the Live status block.

**Findings**
- The failures of the last 8 graphs were memory kills (exit 137), not cold-pod trouble; RAM comes with the GPU count (57.7, 116.4, 232.8 GiB for 1, 2, 4 RTX PRO 4500); chunked runs fix it ([ADR-056](ADR-056-memory-safe-graph-runs.md)); measured: about 51 s per delivered frame on a 1x pod with 11-frame chunks, about 30 s on 2x pods with 26 to 28-frame chunks; sunlight did not fit even 5 frames on a 1x pod.
- ComfyUI's page takes 80 to 160 s to be ready on a fresh pod, which is why a 60 s conversion wait failed.
- Auto-publish had Slack on and posted review videos in the test rounds (55 times); it is now in dry run.

**This evening (18:00 to 18:25)**
- backhalf-c was checked, corrected and uploaded (the first upload try was cancelled because the app picked the busy render pod; a re-run finished); sunlight's duplicate render by the other session was interrupted at Lucas's instruction; a small uploader pod `4c3riwayw293jo` (1x RTX 4090, 30-minute idle stop) was created because two stopped pods' hosts had no free GPU; the tool server was stopped for a restart so the merged pod-choice and parallel-upload code is loaded; frame-range runs and `run_split` and the pod-choice branch were merged (ADR-056 section 8, ADR-050 amendment); ADR-057 records the decisions.

**Housekeeping**
- Every pod's saved log is in one document (`~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`) plus the day's saved logs; 36 old stopped pods with saved logs were deleted earlier and five more (`eagffo99jjrf1n`, `v2283n9nfof484`, `ztd5mwrum3labf`, `4t6x0o6bkxzcpi`, `vvi0hvuj4v5dsg`) after their logs were saved; five stopped pods whose logs held only a stub (RunPod no longer serves a stopped pod's log) were kept at the time (`3tg5wec1wjga0k`, `4h9i01g5dhfh83`, `8m9q2n9g1h865k`, `nmxb3kkl83v5lg`, `xxf7t96rv01ft4`); at 18:00 only `4h9i01g5dhfh83` is still listed, the other four are gone (who deleted them: UNVERIFIED, not this session); pods are otherwise stopped, never deleted.

**Memory limits and every failure's error:** [Appendix A](#appendix-a-which-runs-pushed-the-memory-limits-and-the-error-of-every-failure-2026-11-21) at the end of this report.

### D1. The 36 elements at a glance (19:57)

| State | Count | Elements |
|---|---|---|
| **In the real round**, first delivery (review videos are the first pass) | 17 | archival-071 main; 077 a, b, c; 080 a, b, c, d, e; 083 main; 084 main; 085 main; 093 b; 102 main; 104 b; 123 c; cgi-042 main |
| **In the real round**, 2026-11-21 14:05 (frames and manifest, no review video) | 11 | archival-087 platform, rain; 123 f; 168 a, b, c, d; creature-266 dolphin-lowtrack; photoreal-013 ascent, chasm07, splash |
| **In the real round**, this evening (frames and manifest, no review video) | 4 | cgi-072 backhalf-b, cgi-072 head, photoreal-013 hadal, cgi-072 backhalf-c |
| **In the real round**, 19:48 to 19:50 (frames and manifest, no review video) | 3 | photoreal-013 landing, top, sunlight |
| **Deferred** (Lucas) | 1 | photoreal-013 f23 |

All destinations are S3 only: `s3://bh-panama-exchange-610140802195/returns/BKK/`. Frame counts are the PDF counts (matrix, section 3).

### D2. Delivered: the real round
- **First delivery**, job `publish-mwpe8qd6-7`: 1,770 files, 84.88 GB, 17 elements in 11 shots, `RETURN-MANIFEST.json` updated; the round also held 70 files that were not ours and were not touched. Each element: corrected DPX frames, the review video (first pass: old frames, 24 fps, no start timecode) and its own `<CLIP>_MANIFEST.json`.
- **2026-11-21 14:05**, job `publish-mwq19u7u-3`: 11 elements, 1,153 files, 57.4 GB, S3 and one Slack note, `allow_overwrite` on (the 53 stray frames replaced).
- **16:43 to 16:49**, job `publish-mwq8028p-0`: backhalf-b, 70 files, 3.48 GB, S3 only, through the pod adapter.
- **17:06 to about 17:42**, job `publish-mwq8u9sx-0`: head and hadal, 266 files, 13.2 GB, S3 only, 263 files through a pod and 3 (head 0056 to 0058) through this PC.
- **19:28 to 19:50**, jobs `publish-mwqdwb6n-2` (landing, 226 files, 11.25 GB), `publish-mwqdyu4b-4` (top, 203 files + 6 already there, 10.1 GB) and `publish-mwqdz3z3-5` (sunlight, 209 + 3 already there, 10.4 GB): S3 only, pod adapter, three jobs on three pods at once; 9.3, 8.7 and 8.7 MB/s each (job average), about 31.7 MB/s together at 19:34. The first attempts for top and sunlight (19:28) were cancelled because the app had added the foreign pod `vlvrtpnig8rkoh`; they were re-run with `pods` and `exclude_pod_ids` set.
- **Read back from the bucket:** all element manifests present (31 at the last count); `RETURN-MANIFEST.json` lists 31 items (17:42:28); first-frame headers of the 17: code 0, 23.976 fps, gamma 2.60, timecode from the EDL; of the 11: correct (read 2026-11-21 afternoon); of backhalf-b: three frames read.
- **`dpx_fix`** (colour code user-defined instead of linear, timecode, frame rate, gamma, frame position; picture bytes unchanged; every header read back on the pod after writing) runs from the Prepare For Delivery settings, which are the `delivery_prepare` block of the configuration (plan values verbatim, approved by a named person, stop on a plan flag).

### D3. Made and checked, in the test round (history)
The 11 elements of 21 November (frames made with the `base_v008` graphs, header-patched, in `_TEST_tunnel-v11-base-v008-2026-11-21`, about 50 GB): 087 platform 97, rain 96, 123 f 43, 168 a to d 153/139/105/48, dolphin-lowtrack 94, ascent 108, chasm07 271, splash 96; each matched its PDF count. They are in the real round now (section 3); the test-round copies remain there. Two extra graphs on the volume (chasmfast07, chasmfastia2) are not among the 36.

### D4. The last 8 elements: where each stands (19:57)
They were all killed for memory on 1x cards (f23 also on a 4x pod) before chunked runs (ADR-056).

| Element | PDF frames | How it was made | State |
|---|---|---|---|
| CGI-072 backhalf-b | 70 | app, chunked, 1x pod (7 prompts, 51 s per frame, about $0.7) | **In the real round** (70 frames and manifest; headers of three frames read back) |
| CGI-072 head | 106 | the other session's hand script, 2x pod | **In the real round** (checked, `dpx_fix`, manifest 17:27) |
| PHOTOREAL-013 hadal | 160 | the other session's hand script, 2x pod | **In the real round** (checked, `dpx_fix`, manifest about 17:42) |
| CGI-072 backhalf-c | 162 | the other session's hand script, 2x pod | **In the real round** (162 contiguous frames, `dpx_fix` timecode 00:00:16:23, job `publish-mwqb56ax-2`, manifest 18:22:54) |
| PHOTOREAL-013 landing | 226 | app, chunked, 2x pod, 26-frame chunks | **In the real round** (226 frames, `dpx_fix` timecode 00:00:00:01, job `publish-mwqdwb6n-2`, manifest 19:48:31) |
| PHOTOREAL-013 top | 209 | app, chunked, 2x pod, 28-frame chunks | **In the real round** (209 frames, `dpx_fix` timecode 00:00:00:00, job `publish-mwqdyu4b-4`, manifest 19:49:25; 6 files without sha256) |
| PHOTOREAL-013 sunlight | 212 | app, chunked, 2x pod (first try on a 1x pod failed: RAM guard at 90.5% on a 5-frame chunk) | **In the real round** (212 frames, `dpx_fix` timecode 00:00:04:05, job `publish-mwqdz3z3-5`, manifest 19:50:20; 3 files without sha256; the other session's duplicate render of it was interrupted at 18:10) |
| PHOTOREAL-013 f23 | 633 | app, one run on a 2x pod, cancelled in its probe (about $0.15) | **Deferred by Lucas**; `run_split` can render it in about 2 hours on three pods |

**Cause of the earlier failures (history).** RunPod's system log on every failed pod said `container is unhealthy: exit code 137 ... triggered memory limits (OOM)`: system RAM, not VRAM. The graphs read the whole clip, scale it to 4K and run SeedVR2, then merge, decode, colour-convert and write DPX on the whole batch: 633 frames at 4K float32 is about 63 GB per copy and several copies exist. RAM scales with the GPU count, not the VRAM. **The fix was to run these graphs in frame chunks** ([ADR-056](ADR-056-memory-safe-graph-runs.md), built and in use). CGI-072 renders from V03 HEVC 24 fps (the only version we have; the PDF lists V02 ProRes 23.976); it is not held for anyone. Earlier errors, now understood: HTTP 502 on `/history` is the container being killed; `Timeout 60000ms` in the graph conversion is ComfyUI's page taking 80 to 160 s to be ready on a fresh pod; "pod lost the prompt" is a restart after a kill.

### D5. Skipped, and why
- Nothing is skipped because it is missing from the volume: every one of the 36 has its source on the volume or in the staged rounds.
- photoreal-013 chasmfast07, chasmfastia2, floortrack and creature-266 landing, breach-alt1 are not among the 36; they were generated or attempted by mistake of scope and are not delivered (they still appear in `ISSUES.json`, section 1 bullet 5).
- **f23 is deferred** (Lucas, 2026-11-21).
- Rec.709 convert or tag is parked (Lucas: later, as its own generation step).

### D6. Things you should know
- **Auto-publish** posted to Slack 55 times earlier (section 4). It is now enabled **in dry run**; do not take it live before its scope is reviewed.
- **Pods not ours:** `vlvrtpnig8rkoh` (CanalV2-fix-v020-a, 1x RTX PRO 6000, running, $2.69/h, idle stop never) and `medb5fr68r9la5` (CanalV2-fix-v020-b, stopped); the other session's `8eyco022cqbswy` (2x, running a hand-script render). Not touched.
- **The other session** (Claude session `comfy-workflow-4c`, started yesterday) is running renders by hand that the app does not show; coordinate before starting anything on its pod.
- **Pod logs** are saved in `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md` (38 pods, 5.2 MB; not redacted, do not publish) and the day's files in the same folder.
- **What is live (the app started 16:54:49, the tool server 16:56:55) and what is not.** Live: everything merged up to `be976da`: release 1.7.2, the Outputs rework (grouping, paging, collapse, frame previews, filmstrip, pager and filter row, viewer fix, View In Outputs), the daily cap of 100, the manifest `issues` section and the delivery settings block. Merged to `develop` after that and **live only after the restart that follows the renders** (a restart now would end the running chunk loops, which started before the re-attach code): chunk-run merging and the incomplete-sequence hiding (`e6a4460`), re-attach records (`e2d5c38`), frame ranges and `run_split` (`5fdd616`), upload pod choice and parallel uploads with real bytes (`75b8633`), the Auto-publish lists (`d799e15`). The gate has not run on any of the merges after v1.7.2.

### D7. Open
1. **Renders and the last three uploads: done** (19:50). Left from them: sha256 for 6 top and 3 sunlight frames in their element manifests (re-publish after `manifest_rebuild` is live, or a hash-and-fix step), and the review videos.
2. **backhalf-c:** uploaded and its manifest written (18:22:54); the subtask is verifying `RETURN-MANIFEST.json` (32) and that there are no strays or partials.
3. **Review videos and colour:** the 17 first-pass videos, the 14 delivered elements without one, and the colour statement (section 6, items 1 and 9).
4. **Restart:** the app was restarted at 19:19 onto the merged code; the tool server and a second app restart (manifest tools, Purge Dry Runs, progress-bar padding) come with f23 tomorrow; run the gate (`./start.sh test`) before the next release.
5. **Ask Binc:** the raster (3840x2160 against 1920X1080), the V03 HEVC against V02 ProRes note for CGI-072, and whether `ISSUES.json` belongs in the round.
6. **Auto-publish:** review its pending list, cancel or exclude everything that is not one of the 36, keep DPX out of it until `dpx_fix` is wired into the pipeline, then take it live (Lucas's instruction for the end of the run).
7. **f23:** render it when Lucas says (`run_split`, three ranges, about 2 hours), then `dpx_fix` and publish.
8. **Housekeeping:** the render pods: top stopped 19:55:12 by the system, landing and sunlight logged and still running for a frame-previews job, to be stopped (never deleted) right after; `vlvrtpnig8rkoh` has idle stop never and is not ours; the Generate counters stuck on `checking…`, the Auto-publish banner, and `ISSUES.json` scope are open items (section 5).

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
