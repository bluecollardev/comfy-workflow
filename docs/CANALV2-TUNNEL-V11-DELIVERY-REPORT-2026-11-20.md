# CANALV2 Tunnel V11: delivery report

**Status as of 2026-11-21, about 13:00 local: in progress.** 17 of the 36 elements are delivered to the real round. 11 more are made and checked and wait in a test round. 8 are not generated yet (memory, section 4). **Plan:** [CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md) (sections 14 and 15 carry the run notes). **Rule:** we deliver what we can and have first; nothing from the new generation goes to the real round until Lucas says so.

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
