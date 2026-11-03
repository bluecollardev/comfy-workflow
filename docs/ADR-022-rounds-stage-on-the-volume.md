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
2. **Pod mode uses an active pod when there is one, else a short-lived one.** (Lucas: "if toggle flipped to Pod import to S3 from an active pod".)
   - **A pod is already running on the volume:** the app runs the pull there, over the same SSH transport the Sync uses (the host and port RunPod reports for the pod's SSH, not the `*.proxy.runpod.io` name that did not resolve on 2026-11-03), as an `rclone copy` of that one round into
     `/workspace/comfy-shared/temp/rounds/<round>` with the bucket keys passed in the environment of the command, not its arguments. No new pod, no new bill beyond the one already running. The Sync's requirement stands: an SSH key on the RunPod account, added before the pod starts.
   - **No pod is running:** the app creates a short-lived one on the configured volume with `S3_PULL` (ADR-015), waits for the pull to end, then stops and deletes it. A pod of any kind is the only way to reach the volume: `EUR-IS-2` has no RunPod S3 API (`s3: false` in the live list), so the app cannot list or fill it pod-less.
   - The pod's progress comes from its log, the idle stop is the safety net, and only one Pod download of a round runs at a time.
2b. **The short-lived pod should be a CPU pod if RunPod has one for the volume's datacenter.** The pull, the sha256 check and a delete are network- and disk-bound; a GPU does nothing for them. The image is a CUDA image but runs without a GPU (rclone and Python need none). ADR-007 priced a CPU pod
   at about USD 0.04/h against USD 0.2 to 0.6/h for the cheapest GPU in stock, and found no CPU flavour in Montreal on 2026-10-20. **Not known:** whether a CPU pod can attach this volume in `EUR-IS-2` today, and the app has no CPU pod path at all (`pods.ts` and `runpod.ts` create GPU pods only; the card table and `list_datacenters` are GPU-only). Building it means RunPod's CPU compute type with a flavour and vCPU count, and a probe of what the datacenter offers. Until then the fallback is the cheapest GPU pod, as in the 2026-11-03 tests (USD 0.04 for 2 minutes).
3. **The pod verifies, not only copies.** The image gets a small script that checks every file against the round's manifests (size and sha256, as `panama.verify` does) after the pull and writes `.s3-pull.done` only when it passes. This also
   closes the gap from the 2026-11-03 pod tests, where the files were compared with the bucket by checksum but never with the manifest. Needs an image rebuild (ADR-020).
4. **Delete on the volume is a pod action too** (`rm -r` of that one round, in a short pod), confined to `temp/rounds/<round>` like the local one (ADR-021). The volume bills about USD 0.07 per GB-month, so a staged 15 GB round is about USD 1 a month until deleted; the row shows that.
5. **Import Package in Pod mode is a second phase.** The adapters run in this app against a folder on this PC (ADR-008). To import on the volume the app would build the plan locally from a *shadow* of the round (names and the small manifests, no bytes), send the plan's copy operations to
   a pod, and a pod-side executor would run them inside `/workspace/comfy-shared`, never outside it. Until then Pod mode stages and verifies; importing stays Local.

## What is not known

- **Seeing the volume without a pod.** RunPod's S3 API can list a volume with no pod, but the app has no RunPod S3 keys stored and `EUR-IS-2` was not on the supported list in ADR-007 (it may have changed since). If it is not available, a row's state in Pod mode comes from what the last
  pod run reported (kept in the app, per volume) and is refreshed whenever a pod is up. That is a stale-able fact and the row must say when it was read.
- **Reaching a pod's files from here.** The SSH hostname RunPod's API returns did not resolve from this Mac on 2026-11-03, so a check or delete on the volume cannot rely on SSH; it runs inside the pod itself (the entrypoint or a command).
- Whether the active-pod route works end to end here: the Sync's SSH path is built (`sync.ts`) but its host and port for a pod were not exercised in the 2026-11-03 tests, which used the `S3_PULL` start-up route.

## Consequences

- The Mac's disk and uplink are out of the loop for rounds that are only to be used on a pod; the cost is pod minutes and volume storage.
- A second place to keep track of, with its own Delete.

## Order of work

0. Probe: does RunPod offer a CPU pod with this volume in `EUR-IS-2` (a read-only query for CPU flavours and their stock)? That decides 2b.
1. Image: the pod-side verify script and marker; rebuild and push (`./start.sh comfy-image --remote --wait`).
2. Core: a Pod download (use an active pod over SSH, else create a short-lived one with `S3_PULL`, follow the log, stop and delete), a CPU pod path if the probe says yes, the per-volume state record.
3. UI: the Pod / Local switch on the Panama pane, applying to the row states and buttons.
4. Pod-side Delete.
5. Phase 2: Import Package on the volume.
