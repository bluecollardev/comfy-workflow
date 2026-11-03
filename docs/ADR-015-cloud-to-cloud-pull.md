# ADR-015: Cloud to cloud: the pod pulls from the bucket into the volume

**Date:** 2026-11-03
**Status:** Proposed (Lucas asked for it; built as the image side only, not yet run).
**Extends:** ADR-007 (options E and G), `docs/POD-PULLS-FROM-S3.md`.

## Context

The S3 access key in Default Configuration (`RUNPOD_S3_ACCESS_KEY`, the RunPod
user id) drives ADR-007 option G. That path runs **locally**: the app on the
Mac runs `aws s3 cp --recursive` against `s3api-<datacenter>.runpod.io`, so
every byte goes Mac → RunPod over the Mac's uplink (`libs/core/src/sync.ts`,
`s3Cmd`). It never touches a pod, but it is not cloud to cloud, and the Mac's
uplink is the limit that made the first sync take hours.

The Panama data already sits in an AWS bucket (`bh-panama-exchange…`,
us-west-2), with a read-only `panama-pod` key issued for the pod.

## Decision

For data that already lives in a bucket, the **pod** pulls it into the volume
(`S3_PULL` in the image entrypoint, rclone, additive). Bytes go bucket →
RunPod datacenter and never touch the Mac. The Mac-side S3 push stays for data
that exists only on the Mac.

| Where the data is | Path | Runs on | Limit |
|---|---|---|---|
| Only on the Mac | G: `aws s3 cp` to RunPod's S3 API | the Mac | Mac uplink |
| In an S3 bucket | E: `S3_PULL` in the pod | the pod | needs a running GPU/CPU pod billing while it pulls |

## Consequences

- A pod bills while it pulls; a CPU pod (ADR-007 D) would be cheaper, when the
  datacenter has one.
- Credentials are a separate read-only key per consumer, held in RunPod
  Secrets, not in the app's settings file.
- A bucket → volume copy with no pod at all is not possible with these tools:
  RunPod's S3 API has no server-side copy from a foreign bucket, so a client
  between them would stream every byte (the Mac again).
- Open: Default Configuration fields for `S3_PULL` and its key, so the app
  sets them on each new pod; an app-side "Pull from bucket" button that starts
  a short-lived pod, waits for `.s3-pull.done`, and stops it.
- Plates need Binc's named yes before they move to a RunPod volume.
