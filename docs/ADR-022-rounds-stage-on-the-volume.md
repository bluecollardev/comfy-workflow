# ADR-022: Rounds can stage on the volume too: a Pod / Local switch on the Panama source

**Date:** 2026-11-03
**Status:** The kind of short-lived pod is **decided and final** (decision 2b, Lucas, 2026-11-03); the rest is Proposed. Lucas: "Rounds are downloaded to /Users/lucas/ComfyUI-Shared/temp/rounds (Local) why not just have a corresponding entry on the volume for these"; and
"a switch / toggle ... (Pod / Local)".
**Extends:** ADR-015 (the pod pulls from the bucket), ADR-021 (staging in `temp/rounds`, Sync skips `temp/`).

## Context

A round is staged in `<ComfyUI-Shared>/temp/rounds/<round>` on this PC, then verified and imported. The pod pull (ADR-015) already puts a round on the network volume, at
`/workspace/comfy-shared/temp/rounds/<round>` (proved 2026-11-03: the files survive the pod, and a second pull transfers nothing). The two are the same layout in two places, one the
mirror of the other. Sync deliberately never carries `temp/` (ADR-021), so nothing copies one to the other and a big round never crosses the Mac's uplink.

## Decision

1. **The Panama pane gets a Pod / Local switch: where the round is staged.**
   - **Local** (today): `aws s3 sync` into `~/ComfyUI-Shared/temp/rounds/<round>`, verified against the manifest on this PC, imported here, then synced to a pod.
   - **Pod**: the round is staged on the volume at `/workspace/comfy-shared/temp/rounds/<round>`, pulled by a pod straight from the bucket (`S3_PULL`, ADR-015). The bytes never touch this Mac.
   The same row states apply in both (none, partial, not verified, downloaded) and the same buttons (Download, Resume, Re-Download, Delete), each acting on the chosen place.
2. **Pod mode uses an active pod when there is one, else a short-lived one.** (Lucas: "if toggle flipped to Pod import to S3 from an active pod".)
   - **A pod is already running on the volume:** the app runs the pull there, over the same SSH transport the Sync uses (the host and port RunPod reports for the pod's SSH, not the `*.proxy.runpod.io` name that did not resolve on 2026-11-03), as an `rclone copy` of that one round into
     `/workspace/comfy-shared/temp/rounds/<round>` with the bucket keys passed in the environment of the command, not its arguments. No new pod, no new bill beyond the one already running. The Sync's requirement stands: an SSH key on the RunPod account, added before the pod starts.
   - **No pod is running:** the app creates a short-lived one on the configured volume with `S3_PULL` (ADR-015), waits for the pull to end, then stops and deletes it. A pod of any kind is the only way to reach the volume: `EUR-IS-2` has no RunPod S3 API (`s3: false` in the live list), so the app cannot list or fill it pod-less.
   - The pod's progress comes from its log, the idle stop is the safety net, and only one Pod download of a round runs at a time.
2b. **FINAL DECISION: the short-lived pod is the cheapest GPU pod in stock on the volume's datacenter. There is no CPU pod path.** (Lucas, 2026-11-03: "Fallback: until then, the cheapest GPU pod, as in the tests ... adr this as the final decision".)
   The create call is the one the app already has (`gpu: auto` picks the cheapest card in stock where the volume lives); nothing new is built for it. Measured on 2026-11-03: a pull-and-start pod cost about USD 0.04 for 2 minutes, and a second about USD 0.05
   (L4 at USD 0.59/h, then an RTX 4090). A GPU does no work in a pull, a hash or a delete; the extra cost over a CPU pod (priced about USD 0.04/h in ADR-007, availability in `EUR-IS-2` never confirmed) is cents per use and is accepted in return for building and maintaining no second pod path.
   Not pursued, and why: the app creates GPU pods only (`pods.ts`, `runpod.ts`), the card table and `list_datacenters` are GPU-only, and a CPU path would also need a flavour probe and stock handling for a saving that does not matter at this size. Revisit only if short-lived pods become frequent or long (for example pulls of many 30 GB rounds), or if the cheapest GPU is not in stock where the volume lives.
2c. **The short-lived pods show up in the manager like any other pod.** (Lucas, 2026-11-03: "these pods should show up in our manager too".) They are ordinary pods created through the app's own create path, so they appear in the pod list with a card, its status, price per hour and
   Stop and Delete, and the idle stop applies. What the app adds:
   - **A name that says why:** `ComfyUI-Pull-<round>-<date>` (the repo's `ComfyUI-{Purpose}-{Date}` convention, `CLAUDE.md`), so it is never mistaken for a working pod.
   - **A "temporary" tag and the job on the card:** the round, what it is doing (pulling, checking, deleting) and the same progress and log tail the Panama pane shows. Cancel on the pane stops the pull and deletes the pod.
   - **No orphans:** the pod is recorded as the app's before it is created, and ends by itself (delete when the job ends). If the app closes mid-job the pod is still on the list with its tag and its idle stop, so it can be deleted by hand; on the next start the app offers to finish or delete any temporary pod it finds.
   - **The active-pod route (decision 2) uses the user's own pod and never tags it, stops it or deletes it.**
2d. **Pull pods acknowledge the auto-shutoff timer like every other pod.** (Lucas, 2026-11-03: "like other pods they should acknowledge the auto shutoff timer".)
   - **They carry one.** A pull pod is created with the configuration's idle stop (`idle_stop_minutes`, 30 by default) and is registered with the idle watch like any pod; its card shows the timer as the others do, and the user can change it from the card.
   - **A pull must not be mistaken for idle.** The idle watch counts only what ComfyUI reports (a running or pending queue, a new prompt in `/history`; `idle.ts`), and a pull queues nothing, so after the 15-minute start-up grace the watch would stop a pod in the middle of a long pull. The Sync handles this by registering the pod with 0 minutes while it copies and restoring the value after
     (`syncrun.ts`). A pull does the same, **with a ceiling** the Sync does not have: the hold expires after a limit (the larger of 30 minutes and the round's size at 30 MB/s, so a 39 GB round gets about 22 minutes plus margin) and the timer then resumes. A job that dies, or an app that closes, therefore cannot keep a pod billing indefinitely.
   - **After the job:** a temporary pod is deleted (decision 2c); if that delete fails, the restored timer stops it. On the user's own pod (the active-pod route) the hold is released and the previous timer value restored, exactly as a Sync does.
   - **Not an exception to the spend cap.** Pull pods count against the same USD 100 cap and need `approved_by`, as every pod creation does.
3. **The pod verifies, not only copies.** The image gets a small script that checks every file against the round's manifests (size and sha256, as `panama.verify` does) after the pull and writes `.s3-pull.done` only when it passes. This also
   closes the gap from the 2026-11-03 pod tests, where the files were compared with the bucket by checksum but never with the manifest. Needs an image rebuild (ADR-020).
4. **Delete on the volume is a pod action too** (`rm -r` of that one round, in a short pod), confined to `temp/rounds/<round>` like the local one (ADR-021). The volume bills about USD 0.07 per GB-month, so a staged 15 GB round is about USD 1 a month until deleted; the row shows that.
5. **Import Package in Pod mode is a second phase.** The adapters run in this app against a folder on this PC (ADR-008). To import on the volume the app would build the plan locally from a *shadow* of the round (names and the small manifests, no bytes), send the plan's copy operations to
   a pod, and a pod-side executor would run them inside `/workspace/comfy-shared`, never outside it. Until then Pod mode stages and verifies; importing stays Local.

## What is built (2026-11-03): step 1, the image

`apps/comfy-app/docker/verify_round.py` (stdlib Python; both manifest shapes; exit 0 / 1 / 2 for match / mismatch / no file list) and the entrypoint's `S3_PULL` block now run it after each pair and write `.s3-pull.done`, `.s3-pull.failed` or `.s3-pull.unverified`
(documented in `docs/POD-PULLS-FROM-S3.md`). Tested: 3 unit tests (`libs/core/tests/verifyround.test.ts`, run against temp rounds) and the real entrypoint block in a container against a local S3 with a good round, a round with one wrong checksum and a round
with no manifest, giving the three markers, and a rerun that rewrites the marker. Not yet on a pod: the image must be rebuilt (`./start.sh comfy-image --remote --wait`). The app does not read these markers yet (steps 2 and 3).

## What is not known

- **Seeing the volume without a pod.** RunPod's S3 API can list a volume with no pod, but the app has no RunPod S3 keys stored and `EUR-IS-2` was not on the supported list in ADR-007 (it may have changed since). If it is not available, a row's state in Pod mode comes from what the last
  pod run reported (kept in the app, per volume) and is refreshed whenever a pod is up. That is a stale-able fact and the row must say when it was read.
- **Reaching a pod's files from here.** The SSH hostname RunPod's API returns did not resolve from this Mac on 2026-11-03, so a check or delete on the volume cannot rely on SSH; it runs inside the pod itself (the entrypoint or a command).
- Whether the active-pod route works end to end here: the Sync's SSH path is built (`sync.ts`) but its host and port for a pod were not exercised in the 2026-11-03 tests, which used the `S3_PULL` start-up route.

## Consequences

- The Mac's disk and uplink are out of the loop for rounds that are only to be used on a pod; the cost is pod minutes and volume storage.
- A second place to keep track of, with its own Delete.

## Order of work

1. Image: the pod-side verify script and marker; rebuild and push (`./start.sh comfy-image --remote --wait`).
2. Core: a Pod download (named and tagged as in 2c) (use an active pod over SSH, else create a short-lived one with `S3_PULL`, follow the log, stop and delete), the per-volume state record.
3. UI: the Pod / Local switch on the Panama pane, applying to the row states and buttons.
4. Pod-side Delete.
5. Phase 2: Import Package on the volume.
