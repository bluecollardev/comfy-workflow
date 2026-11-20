# CANALV2: backfilling the DPX frames of reviews that were already published

**Date:** 2026-11-20. **Status:** plan, nothing sent yet. **Needs:** Lucas's go, a round decision (section 5) and a spend/size yes (the frames are 151 GB). **Touches:** ADR-050 (publishing, the BKK return layout, the transfer adapters), Binc's `agent-permissions.md` (a named yes for anything leaving the machine; nothing here sends to the client, and Slack stays out).

## 1. The problem

The Tunnel delivery needs, per element, the 16-bit DPX frames, the H.264 proxy and a manifest (the 20 Nov "contents" listing: `<shot>/<clip>/<clip>.<frame>.dpx`, `<shot>/<clip>.mp4`, `<clip>_MANIFEST.json`). Auto-publish was set to include the DPX frames (`include_dpx: true`) but never sent any: every published card shows 3 files (the .mov, its `.meta.json`, `DELIVERY.md`) and no frames.

**Cause (found 2026-11-20).** The pod writes the review sidecar (`<clip>.mov.meta.json`) with `"render_fps":` left empty when the measured encode rate came back empty. That is invalid JSON. Auto-publish learns which source frames a review came from by reading that sidecar; it read the broken file as `{}`, so it knew of no frames and sent none, with no message.

**Fixed in v1.6.6 (going forward).**
- The render script writes `0` when the rate is empty, so new sidecars are valid.
- Auto-publish repairs an empty value in a sidecar it reads, so the frames are found even in the old broken sidecars (tested: `libs/core/tests/autopublish-volume.test.ts`).
- A sidecar that cannot be read at all now holds that review with the reason, instead of uploading it without its frames.

**Not fixed by 1.6.6: reviews that already went out.** Auto-publish records each shot version as uploaded and does not look at it again, so those 24 clips stay without frames until we send them on purpose. That is this plan.

## 2. What is affected (measured 2026-11-20)

24 clips in two S3 rounds, all with the frames on the volume at a known folder and none under `returns/BKK/`. Total **151.1 GB** (the DPX are about 53 MB a frame at 6336x2688 stills, 50 MB at 4K).

| Priority | Clips | Frames | Size |
|---|---|---|---|
| **A. In the Tunnel batch 03 list** (the V11 EDL elements) | 077 a, b; 080 a, b, c, d, e (v015) and 080 a v017; 084 main; 093 b; 104 b; 123 c | 80, 69; 94, 60, 90, 83, 44; 94; 39; 126; 130; 66 | about 44 GB (+5 GB if the 080 a v017 copy is sent too) |
| **B. Other approved reviews, not in the batch 03 list** | 101 a; 103 main; 123 a | 89; 96; 68 | about 12 GB |
| **C. Other shots (not V11 batch elements)** | cgi-042B alt, creature-266 landing, enhance-146 b (a 25-frame retime review), map-066 assembly, photoreal-013 chasmfast07 / floortrack / chasmfastia2, photoreal-187 main, cgi-090 shot1 | 299, 51, 25, 537, 101, 167, 95, 176, 345 | about 90 GB |

Group C is not part of the Tunnel delivery list in the 20 Nov PDF. Send it only if Lucas wants it.

**Not part of this plan:** the 19 batch 01/02 elements (archival-087, 123 f, 168 a-d, cgi-072 x3, creature-266 dolphin-lowtrack, photoreal-013 x8). Their DPX are not on the volume at all; see the missing-elements note in the session log. And the 12 batch 03 elements with no H.264 proxy: a separate render, below.

## 3. Options

1. **Publish window or `publish run` with explicit volume items (recommended).** For each clip: `items: [{ where: 'volume', path: '<dpx folder>', stem: '<frames stem>' }]`, the round of its review, targets `s3` only, `approved_by` Lucas. The plan call returns the sequences with their EDL flags first; nothing is sent until `run` with `confirm: true`. Files that are already in the bucket (the review video) are skipped as "same size already there", so only the frames go. Proven read-only today: a plan for `archival-080_a` v017 returns 95 files, 4.99 GB, 94 frames, EDL start 01:00:00:00, nothing blocked.
2. **Publish Now on the shot in Auto-publish.** It does exactly option 1 for that one version through the same code path (`include_dpx` on). One click per shot version; use it for a handful, not 24.
3. **Backfill (scan, inventory, plan, run).** It uploads volume files under their original names next to an `_inventory` CSV. Wrong shape here: the delivery wants clip folders and the round layout, not original names. Not recommended.
4. **Clear Auto-publish's `uploaded` markers and let it re-run.** Rejected: it re-plans every review as well, and clearing state by hand is how a duplicate or a wrong upload happens.

## 4. How the frames travel, and how long it takes

- **Through this PC (today's default for volume files):** about 2.5-4 MB/s measured on the earlier uploads. 44 GB (group A) is roughly 3.5-5 hours, all 151 GB roughly 11-17 hours. It works unattended but is slow.
- **S3 to S3 from the running pod (v1.6.4's `s3.transfer: auto`):** a pod attached to the volume uploads straight to the Panama bucket from presigned links made on this PC, so no key reaches the pod. Pod `eagffo99jjrf1n` (RTX PRO 4500, EU-RO-1, volume `a3upg9ey48`) is running now. This should be several times faster, but **it has not been run against a real pod and real S3 yet**; the first run is its first test. Start with one small clip (`archival-084 main`, 39 frames, 1.6 GB) and read the job's "via pod ..." line and rate before sending the rest. If it misbehaves, set Transfer to This PC.
- No new pod is started by any of this. The pod that is running stays running, so its hourly cost continues while the upload runs; stop it when done (or let the idle watch do it).

## 5. Decisions needed from Lucas

1. **Which round?** The reviews are in `_TEST_2026-11-19` (and `_TEST_2026-11-20` for 080 a v017 and cgi-090). Backfilling into the same rounds keeps each shot's review and frames together and is reversible (they are test rounds). The Tunnel delivery itself uses `tunnel-v11-edl-2026-11-18/<shot>/` with V11 clip names (`ARCHIVAL-077_A_FINAL_V03_...`); getting there means re-publishing with the EDL clip names, a real round and the EDL checks fully on. **Recommendation:** backfill the `_TEST_` rounds now (it proves the frames and the speed); do the real-round publish as its own step after Binc confirms names.
2. **Which groups:** A only (44 GB), A + B (56 GB), or all (151 GB).
3. **080 a:** both v015 (in `_TEST_2026-11-19`) and v017 (in `_TEST_2026-11-20`)? v017 is the newer render; v015 can be skipped.
4. **Pod transfer:** start with the pod adapter on one clip (recommended), or use This PC from the start.

## 6. Steps

1. Update the app to 1.6.6 (done on Lucas's PC 2026-11-20). Confirm Settings > Publishing > Transfer is Auto.
2. **Pilot:** plan, then run `archival-084 main` (round `_TEST_2026-11-19`, targets `s3`). Expect 39 `.dpx` files under `archival-084/archival-084_main_mono_v015_NOT_RELEASED/`, a `RETURN-MANIFEST.json` updated with a sha256 per file, "via pod CanalV2-mono-v015-RO-pro4500-c2" on the card, and no Slack post. Read the rate.
3. **Group A**, one shot at a time (`streams: 1`), in this order: 084, 123 c, 077 a, 077 b, 104 b, 093 b, 080 e, 080 b, 080 d, 080 c, 080 a (v017). Check each card before the next.
4. Groups B and C if chosen, same way. `cgi-042B`, `map-066`, `enhance-146` and the other non-V11 shots are not in the V11 EDL: a `_TEST_` round waives only the frame count, so the EDL check will hold them as "not in the EDL". Say so in the plan output; do not override (the override is for a frame-count difference, never for a missing element).
5. **Verify** (read-only): list each shot folder in the round and check that the DPX count equals the frames in section 2, that the manifest lists them with sha256, and that nothing else changed. A script for this is the inventory and bucket listing used on 2026-11-20 (`browse` of `returns/BKK/<round>/<shot>/`).
6. Stop the pod when the last upload finishes. Update this doc's log.

## 7. Prevention

- 1.6.6 covers the cause. Add a visible check later: an Auto-publish entry whose review is on the volume with a sidecar that names frames, but whose plan has none (with `include_dpx` on), should say so on its card rather than finish silently. (Not built; a follow-up.)
- The Generations/Publishing cards already show the file count; 3 files for a review that has frames is the sign to look for.

## 8. Related: the 12 missing H.264 proxies (blocked on a colour statement)

Batch 03 elements with DPX on the volume but no H.264 proxy: 071, 077 c, 080 a-e, 083, 085, 093 b, 102, cgi-042 main. Planned 2026-11-20 on the running pod (kind review, codec h264, 12 sequences, 1,307 frames, about 0.7 GB out, no new pod): every frame count and EDL start timecode checks out (071 starts 00:00:00:12, the 080 stills 01:00:00:00, the rest 00:00:00:00), nothing is held by the EDL.

**Not started.** The DPX headers of all 12 say *linear* (transfer 2), and the app will not guess a colour (policy/colour.md). The plan resolved `colour_in` to `linear-p3-d65` from the Default Configuration (`render.colour.format`, set_by "unknown"), which is what the earlier review videos used. Binc's 20 Nov listing says the delivered elements are **P3-D65 Gamma 2.6**, and it records a header bug (CGI-072: tagged linear, pixels Gamma 2.6). If these volume frames are really Gamma 2.6, a linear-to-display conversion would make every proxy (and the earlier reviews) too bright. **Decision for Lucas (or Binc):** state the colour of these frames, `linear-p3-d65` (as before) or `p3-d65-gamma26`, and the proxies run with that statement recorded in each sidecar. Until then they are not rendered.

## 9. Log

- 2026-11-20: planned the 12 proxies (all clean except the colour statement, section 8); found the cause (invalid sidecar JSON), released v1.6.6, measured the 24 clips and 151 GB, wrote this plan. Nothing uploaded.
