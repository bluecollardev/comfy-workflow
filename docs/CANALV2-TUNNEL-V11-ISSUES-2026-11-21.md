# CANALV2 Tunnel V11: issue register (2026-11-21, 18:35 Bangkok time)

Every open problem found in the delivery and in the app during 20 to 21 November, one row each, with its status and what decides it. The state of the 36 elements is in [the delivery report](CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md); the work log is in [the production plan](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md) (sections 18 to 26); the decisions are [ADR-057](ADR-057-parallel-renders-and-uploads-in-the-app.md). Status words: **open** (nothing done), **decision** (waits for Lucas or Binc), **built, not live** (merged to `develop`, live after the next app restart), **live**, **parked** (known, not worth doing now).

State at 19:57: **35 of 35 targeted elements are in the real round** `returns/BKK/tunnel-v11-edl-2026-11-18` (top, landing and sunlight delivered 19:48 to 19:50, `RETURN-MANIFEST.json` 35 items); f23 is the only element left (tomorrow). The app was restarted at 19:19, so items marked `built, not live` below are now live except 25 (manifest tools) and 26 (Purge Dry Runs) and the progress-bar padding, which wait for the next restart.

## A. Delivery content

| # | Issue | Why it matters | Status | Next step / who |
|---|---|---|---|---|
| 1 | **18 delivered elements have no review video** (top, landing, sunlight now included) (the 11 of 14:05, backhalf-b, head, hadal, backhalf-c; top, landing and sunlight will be 3 more): frames and manifest only. | The PDF asks for a review video per element. | open | Generate the videos once the colour statement (3) is settled; Auto-generate does it for sequences it sees. |
| 2 | **The 17 first-delivery review videos are the first pass:** made from the old frames, at 24 fps not 23.976, no start timecode. | They do not match the corrected frames. | open | Replace them (new ProRes/H.264 from the corrected copies) after 3. |
| 3 | **The colour statement for review videos: settled by Lucas, 2026-11-21 ~18:55: "Gamma 2.6 P3-D65"** (`p3-d65-gamma26`, as the PDF and the first pass; it supersedes the 20 Nov "linear P3-D65" statement). Auto-generate is already set to it. The H.264 handling (tag or convert to Rec.709) stays **parked** (Lucas: "yes parked"), so only ProRes review videos are made for now. | The H.264 files stay missing until that step is taken up. | decided (colour); parked (H.264) | Auto-generate makes the ProRes reviews (scope `edl` after the restart); the 17 first-pass videos are replaced from the corrected frames. |
| 4 | **Raster mismatch:** the delivered DPX are 3840x2160 (49,768,064 bytes a frame) while the clip names say 1920X1080. | The base_v008 graph upscales; every 1920x1080 element probably matches. | decision | Ask Binc whether 4K is intended or the name is wrong. Nothing changed. |
| 5 | **CGI-072 source:** rendered from the V03 HEVC at 24 fps (the only version we have) while the PDF lists V02 ProRes 23.976. | The element names say V02. | decision | Ask Binc; add a note in the manifest. |
| 6 | **`ISSUES.json` in the round is stale and noisy:** 10 `not-generated` entries from the failures log (archival-123 A, creature-266 breach-alt1 and landing, photoreal-013 chasmfast07, chasmfastia2, floortrack, f23, landing, sunlight, top); several are wrong now and five are not among the 36. It is also not part of Binc's `bh-return-1` schema. | Misleading to the client. | decision | Lucas: list only the real gaps of the 36, or leave it. Each publish rewrites it; it settles when the last element lands. |
| 7 | **backhalf-b's element manifest has no `issues` section** (published before that code merged); head had 3 frames (0056 to 0058) fall back through this PC. | Inconsistent manifests; 150 MB through the PC. | open | Re-publish backhalf-b's manifest (a re-run skips same-size frames). |
| 8 | **Not verified from the bucket:** head's and hadal's DPX headers (only the pod read-back is known) and their sizes per file. | | **closed 19:55** | First-frame headers of head, hadal, top, landing and sunlight read from the bucket: code 0, 24 fps (head 23.976), gamma 2.6, timecodes as `dpx_fix` set them. |
| 9 | **f23 (633 frames): tomorrow** (Lucas, 18:45: "nvm we will do that tomorrow"; at 18:40 he had asked to restart and queue it once the renders finish). | The round is 35 of 36 until it is in. | planned for 2026-11-22 | After the three renders are done: restart the app, then `run_split` on three 2x pods (about 2 hours, about USD 8 to 13), `dpx_fix` from the settings, parallel pod upload. Pods stay within the 16-GPU account limit: stop the finished render pods first. |
| 10 | **Slack:** Auto-publish posted 55 times into test rounds (21 on 19 Nov, 28 on 20 Nov, 6 on 21 Nov), including items not on the 36; the links expire 72 hours after posting. | Cannot be deleted from here. | parked | Slack stays ticked on Lucas's wish; the scope (11) is the fix. |

## B. Auto-publish (enabled in dry run, not live)

| # | Issue | Why it matters | Status | Next step / who |
|---|---|---|---|---|
| 11 | **Scope (built, not live: `feature/autopublish-scope-edl` merged `9d97fcb`, setting `scope: edl`, live after the restart tonight):** the dry-run list and the volume scan include work that is not ours: map-066, chasmfastia2, cgi-072 v001 and v002, photoreal-013 v007 to v009, archival-087 v002 and the assembly `NOT_RELEASED` runs. | Going live would publish them to the real round and Slack. | open | Review the pending list, cancel or exclude everything not among the 36 (EDL check or `require_approval`), then go live. Only a person can hold or approve in the window. |
| 12 | **`include_dpx` was on (turned OFF at 18:48 for tonight; the DPX fix wiring is built on `feature/dpx-fix-in-pipeline`, live after tomorrow's restart):** Auto-publish would upload the original frames with the wrong header (linear flag, no timecode). | Corrupt delivery. | open | Keep DPX out of Auto-publish until `dpx_fix` is wired into the pipeline (ADR-057, decision 7). |
| 13 | **Auto-generate and the preview batch can land on a render pod** (previews timed out on the landing pod: `The file did not arrive in time`). | Slows the renders; adds RAM load. | open | Prefer the volume's S3 route or an idle pod; stop the batch while rendering. |

## C. App and tools

| # | Issue | Status | Next step |
|---|---|---|---|
| 14 | False `Frames N / M` alarms on chunked renders; chunk runs shown as many rows; incomplete sequences visible. | live (restart 19:19) | Fixed in `develop` (`e6a4460`): union frame check, one row per render, `Show Incomplete`. Live at the restart after the renders. |
| 15 | **DO NEXT: the Queue banner "Still loading the queue" never ends (Lucas, 21 Nov): it counts the Auto-publish volume scan (`scanning: true` since 19:19) as loading; fix `QueueLoadingBanner.vue` and the scan.** Also: **Generate window counters stay on `checking…`** (91 folders, 26 failed previews); **the Auto-publish banner always reads `scanning volume`.** | open | Investigate the probes and the scan loop. |
| 16 | **Re-attach does not cover the current renders:** top, landing and sunlight were started by code without records; a restart before they finish drops their loops (the chunk in flight keeps running). | live (restart 19:19) | Re-attach is merged (`e2d5c38`) and live; the renders it did not cover finished before the restart. |
| 17 | Publish picked the first running pod (the busiest); a job started in another process showed `0 B of 0 B`. | live | Pod ranking, `pods`/`exclude_pod_ids`, `parallel_pods` and real bytes are in the tool server since 18:27 (and the app after the restart). |
| 18 | `create_pod` with `like_pod_id` ignores the GPU count (came up 1x); one 2x pod reported 55.9 GiB of RAM. | parked | Create pods with an explicit `gpu_count`; check `ram_gb` before relying on a pod. |
| 19 | `dpx_fix` was a deliberate step, not part of Import Round or Auto-publish. | live (restart 19:19; Auto-publish only) | Merged `002f218` (`fix_dpx`, ADR-055 section 13); live after the restart; still not run after Import Round or queue runs. |
| 20 | The tool server hosts publish jobs; a restart wipes their records (backhalf-c's counts were lost). | parked | Do not restart it during an upload; the shared record now carries the progress. |
| 25 | **Manifest repairs are code, not hand edits.** The 21 Nov removal of three stale bundled `main` items from RETURN-MANIFEST.json was a one-off script. | built, not live | `manifest_check` (read-only) and `manifest_rebuild` (plan, then run with approved_by and understood; backup `RETURN-MANIFEST.backup-<UTC>.json`, one item per element manifest, read-back verify, ISSUES.json regenerated) are merged (ADR-055 section 14); live after the next restart; first use: `manifest_check` on `tunnel-v11-edl-2026-11-18` once top, landing and sunlight are in. |
| 26 | **Pending Uploads clutter in dry run:** a `Purge Dry Runs` button (confirm, plan then run) and the MCP actions `purge_dry_runs` and `restore_dry_runs` dismiss the dry-run entries; nothing is deleted from the volume, the PC or the bucket. | built, not live | Merged (ADR-050 amendment); live after the next restart; `Restore Dismissed` undoes it. |
| 27 | **Manifest sha256 gaps:** top has 6 and sunlight 3 files with `sha256: n/a` in their element manifests (the frames the cancelled 19:28 jobs had already sent; the re-run skipped same-size files without hashing them). The files are in the bucket at the right size. | Binc cannot verify those frames by checksum. | open | Fix in code: a re-publish should hash skipped files (or `manifest_rebuild` should fill them from the bucket); then fix these 9. |
| 28 | **Unset TV-header bytes:** interlace, field number and video signal hold arbitrary non-zero values in every DPX frame sampled (new and old elements), written by the encoder (Lavc), not by `dpx_fix`. | Cosmetic unless Binc's tools read them. | decision | Ask Binc; `dpx_fix` could zero them. |

## D. Process and environment

| # | Issue | Status | Next step |
|---|---|---|---|
| 21 | **Ungated merges:** about ten merges after v1.7.2 went in without the full gate (outputs grouping and paging, frame previews and filmstrip, chunk-run merging, manifest issues, settings block, re-attach, ranges, pod choice, Auto-publish lists); `publish-backfill` has a pre-existing failing test (`needs the approver…`, 5 s timeout). | decision | Run `./start.sh test` before the next release. |
| 22 | **Spend:** the app's estimate since 4 Nov is USD 546.31 across all projects and agents; Binc's cap is USD 100 total. These renders were authorised by Lucas without a figure (about USD 25 to 30 for the last elements). | decision | Lucas to agree a figure with Binc. |
| 23 | **Two sessions share the pods:** the other session's script (`chunkrun-mac`) rendered head, hadal, backhalf-c and then sunlight on `8eyco022cqbswy`; its sunlight was interrupted at 18:10 and my message to tell it failed, so it may resubmit. Four of the five stopped pods I had kept logs of were deleted by someone else. `vlvrtpnig8rkoh` is foreign (idle stop never). | open | Tell the other session; never start a run on a pod whose queue shows another client. |
| 24 | **Harmless, low:** the LTXVideo node pack fails to import on new pods (hash in the folder name; none of our graphs use it); SeedVR2 runs without SageAttention or Flash Attention (likely faster with them, not measured); 50 old graph failures in the Queue banner; the Dozzle MCP does not connect. | parked | Add the two attention packages at the next image build. |

## E. What blocks what
- **Going live with Auto-publish:** 11, 12 (and 13 while renders run).
- **Review videos:** 3, then 1 and 2.
- **Telling the client the round is complete:** 3, 4, 5, 6, 9 and the last three uploads.
- **The next release:** 21.
