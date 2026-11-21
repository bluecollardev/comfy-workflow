# CANALV2 Tunnel V11: delivery report

## Read this first (2026-11-21, about 13:00 local)

**Bottom line:** 28 of the 36 elements are done. 17 are delivered to Binc's real round. 11 more are finished and checked but held in a test round, as you asked. **8 are not done** and cannot be done as things stand.

- **Delivered (17):** in `returns/BKK/tunnel-v11-edl-2026-11-18`, with corrected headers and timecode, review videos and manifests. I read them back from the bucket and they are right.
- **Ready, waiting for your word (11):** archival-087 platform and rain, 123 f, 168 a-d, creature-266 dolphin-lowtrack, photoreal-013 ascent, chasm07, splash. Frame counts match the PDF exactly. Still missing for these: a review video each, and a check of their headers in the bucket. One problem: archival-087 platform clashes with 29 differently sized files already in the real round, so it can't go there as it is.
- **Not done (8):** photoreal-013 hadal, sunlight, top, landing, f23, and cgi-072 head, backhalf-b, backhalf-c. Their graphs run out of memory on RunPod and get killed (RunPod's own log says so). A bigger card doesn't help; more system RAM only helps the small ones. The real fix is to run each graph in pieces of about 50 frames, and that isn't built yet. A test on a 116 GB-RAM pod (hadal) has been running over 30 minutes and hasn't died yet.

**What I need from you**
1. **Build the chunked runs?** (I can't give a firm time: it depends on whether the graphs accept a frame window, which I haven't confirmed; it is the only way to get the last 8). Or deliver 28 and list the 8 as not generated.
2. **Move the 11 to the real round?** Which ones, and what to do about the archival-087 platform clash.
3. Whether Auto-publish may come back on. It's off because it posted about 16 review videos to Slack on its own, including items not on the list.

**Money running now:** two pods, about $4.10/hour (2× RTX PRO 4500 and a pod that isn't ours at $2.69/h). I stop mine when the last test ends.

Everything below is the detail behind this summary. Appendix A has the memory evidence and every error.


## All 36 elements, one line each (2026-11-21, about 13:00 local)

| # | Element | PDF frames | State | One line |
|---|---|---|---|---|
| 1 | ARCHIVAL-071 main | 227 | **DELIVERED (real round)** | 227 DPX frames, header read back from the bucket OK (timecode 00:00:00:12), manifest and review video there |
| 2 | ARCHIVAL-077 a | 80 | **DELIVERED (real round)** | 80 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 3 | ARCHIVAL-077 b | 69 | **DELIVERED (real round)** | 69 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 4 | ARCHIVAL-077 c | 74 | **DELIVERED (real round)** | 74 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 5 | ARCHIVAL-080 a (still) | 94 | **DELIVERED (real round)** | 94 DPX frames, header read back from the bucket OK (timecode 01:00:00:00), manifest and review video there |
| 6 | ARCHIVAL-080 b (still) | 60 | **DELIVERED (real round)** | 60 DPX frames, header read back from the bucket OK (timecode 01:00:00:00), manifest and review video there |
| 7 | ARCHIVAL-080 c (still) | 90 | **DELIVERED (real round)** | 90 DPX frames, header read back from the bucket OK (timecode 01:00:00:00), manifest and review video there |
| 8 | ARCHIVAL-080 d (still) | 83 | **DELIVERED (real round)** | 83 DPX frames, header read back from the bucket OK (timecode 01:00:00:00), manifest and review video there |
| 9 | ARCHIVAL-080 e (still) | 44 | **DELIVERED (real round)** | 44 DPX frames, header read back from the bucket OK (timecode 01:00:00:00), manifest and review video there |
| 10 | ARCHIVAL-083 main | 98 | **DELIVERED (real round)** | 98 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 11 | ARCHIVAL-084 main | 39 | **DELIVERED (real round)** | 39 DPX frames, header read back OK (timecode 00:00:00:00, not checked against the EDL separately), manifest and review video there |
| 12 | ARCHIVAL-085 main | 54 | **DELIVERED (real round)** | 54 DPX frames, header read back OK (timecode 00:00:00:00, not checked against the EDL separately), manifest and review video there |
| 13 | ARCHIVAL-093 b (low resolution, as the PDF) | 126 | **DELIVERED (real round)** | 126 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 14 | ARCHIVAL-102 main | 128 | **DELIVERED (real round)** | 128 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 15 | ARCHIVAL-104 b | 130 | **DELIVERED (real round)** | 130 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 16 | ARCHIVAL-123 c | 66 | **DELIVERED (real round)** | 66 DPX frames, header read back from the bucket OK (timecode 00:00:02:00), manifest and review video there |
| 17 | CGI-042 main | 229 | **DELIVERED (real round)** | 229 DPX frames, header read back from the bucket OK (timecode 00:00:00:00), manifest and review video there |
| 18 | ARCHIVAL-087 platform | 97 | **MADE, in test round only** | 97 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket; BLOCKED for the real round: 29 files of it already there have a different size |
| 19 | ARCHIVAL-087 rain | 96 | **MADE, in test round only** | 96 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 20 | ARCHIVAL-123 f | 43 | **MADE, in test round only** | 43 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 21 | ARCHIVAL-168 a | 153 | **MADE, in test round only** | 153 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 22 | ARCHIVAL-168 b | 139 | **MADE, in test round only** | 139 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 23 | ARCHIVAL-168 c | 105 | **MADE, in test round only** | 105 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 24 | ARCHIVAL-168 d | 48 | **MADE, in test round only** | 48 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 25 | CREATURE-266 dolphin-lowtrack | 94 | **MADE, in test round only** | 94 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 26 | PHOTOREAL-013 ascent | 108 | **MADE, in test round only** | 108 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 27 | PHOTOREAL-013 chasm07 | 271 | **MADE, in test round only** | 271 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 28 | PHOTOREAL-013 f23 | 633 | **NOT DONE** | killed for memory 3 times (5 failed attempts); on a 232.8 GiB pod RAM went from 40 GiB to the limit in about a minute |
| 29 | PHOTOREAL-013 hadal | 160 | **NOT DONE** | killed for memory 3 times (8 failed attempts), once at 76 of 87.5 GiB after 22 minutes; a test on a 116.4 GiB pod has run over 30 minutes without dying yet |
| 30 | PHOTOREAL-013 landing | 226 | **NOT DONE** | killed for memory on a 57.7 GiB pod (7 failed attempts) |
| 31 | PHOTOREAL-013 splash | 96 | **MADE, in test round only** | 96 frames, matches the PDF count; header patched and checked on the pod; no review video yet; header not yet read back from the bucket |
| 32 | PHOTOREAL-013 sunlight | 212 | **NOT DONE** | killed for memory on a 57.7 GiB pod (4 failed attempts) |
| 33 | PHOTOREAL-013 top (V02) | 209 | **NOT DONE** | killed for memory on a 57.7 GiB pod (6 failed attempts) |
| 34 | CGI-072 head | 106 | **NOT DONE** | killed for memory at 55.2 of 57.7 GiB after 31 minutes (15 failed attempts); renders from V03, not held for anyone |
| 35 | CGI-072 backhalf-b | 70 | **NOT DONE** | never completed: conversion timeouts and pod restarts (16 failed attempts) |
| 36 | CGI-072 backhalf-c | 162 | **NOT DONE** | never completed: conversion timeouts and a kill (15 failed attempts) |

## Status tables (kept up to date in the production plan)
- [The 17 with DPX: state of each (plan 11.1)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#111-the-17-with-dpx-cases-a-to-c)
- [The 19 without delivered DPX: state of each, same columns (plan 11.2)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#112-the-19-without-delivered-dpx)
- [Run status of the 19: PDF frames against frames produced, errors (plan)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#run-status-of-the-19-2026-11-21-1300-local)
- [What is delivered, in test, and what blocks (plan 14)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#14-status-2026-11-21-what-is-delivered-what-is-in-test-what-blocks)
- [Run notes: why the 8 fail, what was tried, pods and logs (plan 15)](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md#15-run-notes-and-status-2026-11-21-midday)
- [The rules and the process for memory-safe runs (ADR-056)](ADR-056-memory-safe-graph-runs.md); [delivery integrity and kept logs (ADR-055)](ADR-055-delivery-integrity-and-kept-logs.md)

## What was done (2026-11-20 to 2026-11-21)
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

## 1. The 36 elements at a glance

| State | Count | Elements |
|---|---|---|
| **Delivered**, real round `returns/BKK/tunnel-v11-edl-2026-11-18` | 17 | archival-071, 077 a/b/c, 080 a-e, 083, 084, 085, 093 b, 102, 104 b, 123 c, cgi-042 |
| **Made and checked, in the test round only** (`_TEST_tunnel-v11-base-v008-2026-11-21`) | 11 | archival-087 platform and rain, 123 f, 168 a/b/c/d, creature-266 dolphin-lowtrack, photoreal-013 ascent, chasm07, splash |
| **Not generated** | 8 | photoreal-013 hadal, sunlight, top, landing, f23; cgi-072 head, backhalf-b, backhalf-c |

All destinations are S3 only: `s3://bh-panama-exchange-610140802195/returns/BKK/`. Nothing from these runs was posted to Slack by us (but see section 6: Auto-publish did, and is now off).

## 2. Delivered: the real round
- Publish job `publish-mwpe8qd6-7`: **1,770 files, 84.88 GB, 17 elements in 11 shots**, `RETURN-MANIFEST.json` updated. The round lists 1,840 files; the 70 extra were already there and were not touched. Nothing in the round was overwritten.
- Each element: corrected DPX frames (`_delivery_v11/<clip>`), the review video, and its own `<CLIP>_MANIFEST.json`.
- **Read back from the bucket (2026-11-21):** all 17 manifests are present; each DPX folder is there with a plausible count (071 227, 077 a/b/c 80/69/74, 080 a-e 94/60/90/83/44, 083 98, 084 39, 085 54, 093 b 126, 102 128, 104 b 130, 123 c 66, cgi-042 229). First-frame headers of all 17: transfer and colorimetric code 0 (user-defined), frame rate 23.976, gamma 2.60, timecode from the EDL (071 00:00:00:12, 123 c 00:00:02:00, 080 a-e 01:00:00:00, the rest 00:00:00:00; 084 and 085 not checked against the EDL separately). Film-header fields (frame position, sequence length, filename) were not read back.
- **The DPX header and timecode patch is done** (`dpx_fix`: colour code user-defined instead of linear, timecode, frame rate, gamma, frame position; the picture bytes are copied unchanged; every header is read back on the pod after writing). It was a fix of the frames' headers, not a regeneration.

## 3. Made and checked, waiting in the test round (11)
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

**No frame-count mismatch so far.** Still to do for these 11: a review video each, and reading the headers back from the bucket. **archival-087 platform cannot go into the real round as it is:** the round already holds 29 files of it with a different size (49,768,448 bytes there, 49,768,064 here); the no-overwrite rule refuses them, and where those files came from is not known. Two extra graphs on the volume (photoreal-013 chasmfast07, chasmfastia2) are not among the 36 and are never published.

## 4. Not generated (8) and why
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

## 5. Skipped, and why
- Nothing is skipped because it is missing from the volume: every one of the 36 has its source on the volume or in the staged rounds.
- photoreal-013 chasmfast07, chasmfastia2, floortrack and creature-266 landing, breach-alt1 are not among the 36; they were generated or attempted by mistake of scope and are not delivered.
- Rec.709 convert or tag is parked (Lucas: later, as its own generation step).

## 6. Things you should know
- **Auto-publish posted to Slack.** It was on with Slack enabled (standing approval of 2026-11-20 09:10) and published about 16 review videos to S3 and Slack in round `_TEST_2026-11-21`, including items not on the list. It is now **off** (turned off by Claude); re-enable only on Lucas's say, S3 only until checked. The Slack posts cannot be deleted from here.
- **Pods not ours:** `vlvrtpnig8rkoh` (CanalV2-fix-v020-a, RTX PRO 6000, running at $2.69/h) and `medb5fr68r9la5` (CanalV2-fix-v020-b, stopped) appeared at 00:46 UTC from outside these runs. Not touched.
- **Pod logs** are saved in one document with a contents list per pod and per run: `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md` (38 pods, 5.2 MB; not redacted, do not publish). 26 pods have no saved log (stopped before the app saved them). 36 old stopped pods whose logs are in that document were deleted on Lucas's instruction; the volume was not touched.
- **Pods running now:** two RAM-test pods (2x and 4x RTX PRO 4500, $1.44 and $2.88/h) and an A100 request waiting for stock (up to 6 hours). These cost money until stopped.
- **Built today (on develop, not yet in the running app unless restarted):** the pod card shows GPU count, total VRAM and container RAM; a red `Frames N / M` badge on Outputs cards whose frame count differs from the EDL; wait for ComfyUI before every graph; card escalation on out-of-memory (to be replaced by chunking, ADR-056); pod reuse on retry.

## 7. Open
1. The 8 graphs: build chunked runs and generate them (ADR-056 section 5), then patch, check against the PDF counts and publish to the test round.
2. A review video for each of the 11 (and the 8 after them); header read-back from the bucket for the 11.
3. Decide with Lucas: what goes from the test round to the real round, and what to do with the 29 differing archival-087 platform files already in it.
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
