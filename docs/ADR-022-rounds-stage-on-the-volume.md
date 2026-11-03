# ADR-022: Rounds can stage on the volume too: a Pod / Local switch on the Panama source

**Date:** 2026-11-03
**Status:** Proposed. Lucas: "Rounds are downloaded to /Users/lucas/ComfyUI-Shared/temp/rounds (Local) why not just have a corresponding entry on the volume for these"; and
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
2. **A Pod download is a short-lived pod the app drives.** Create a pod on the configured volume with `S3_PULL` for that round; wait for the pull to end; stop and delete the pod. Billing is the pod's minutes (about USD 0.04 for the inbox round; a 15 GB round is
   a few minutes at datacenter speed). The app shows the pod and the pull's progress from its log, and the existing idle stop is the safety net.
3. **The pod verifies, not only copies.** The image gets a small script that checks every file against the round's manifests (size and sha256, as `panama.verify` does) after the pull and writes `.s3-pull.done` only when it passes. This also
   closes the gap from the 2026-11-03 pod tests, where the files were compared with the bucket by checksum but never with the manifest. Needs an image rebuild (ADR-020).
4. **Delete on the volume is a pod action too** (`rm -r` of that one round, in a short pod), confined to `temp/rounds/<round>` like the local one (ADR-021). The volume bills about USD 0.07 per GB-month, so a staged 15 GB round is about USD 1 a month until deleted; the row shows that.
5. **Import Package in Pod mode is a second phase.** The adapters run in this app against a folder on this PC (ADR-008). To import on the volume the app would build the plan locally from a *shadow* of the round (names and the small manifests, no bytes), send the plan's copy operations to
   a pod, and a pod-side executor would run them inside `/workspace/comfy-shared`, never outside it. Until then Pod mode stages and verifies; importing stays Local.

## What is not known

- **Seeing the volume without a pod.** RunPod's S3 API can list a volume with no pod, but the app has no RunPod S3 keys stored and `EUR-IS-2` was not on the supported list in ADR-007 (it may have changed since). If it is not available, a row's state in Pod mode comes from what the last
  pod run reported (kept in the app, per volume) and is refreshed whenever a pod is up. That is a stale-able fact and the row must say when it was read.
- **Reaching a pod's files from here.** The SSH hostname RunPod's API returns did not resolve from this Mac on 2026-11-03, so a check or delete on the volume cannot rely on SSH; it runs inside the pod itself (the entrypoint or a command).
- Whether two pods writing the same round at once is possible: refuse it (one Pod download per round at a time).

## Consequences

- The Mac's disk and uplink are out of the loop for rounds that are only to be used on a pod; the cost is pod minutes and volume storage.
- A second place to keep track of, with its own Delete.

## Order of work

1. Image: the pod-side verify script and marker; rebuild and push (`./start.sh comfy-image --remote --wait`).
2. Core: a Pod download (create pod with `S3_PULL`, follow the log, stop and delete), the per-volume state record.
3. UI: the Pod / Local switch on the Panama pane, applying to the row states and buttons.
4. Pod-side Delete.
5. Phase 2: Import Package on the volume.
