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

## Decisions taken while building (2026-11-03)

- **The key for the first test is `panama-lucas`** (read-only, Lucas's own, profile `panama` on this Mac), by Lucas's decision, "for now".
  The Panama guide issues a separate `panama-pod` key so the pod's access can be revoked alone; it replaces `panama-lucas` as soon as
  it is on this machine. The cost of the interim choice: revoking the pod's access also revokes Lucas's.
- **The secret never passes through a chat or a tool call.** The two values go into RunPod Secrets by Lucas and the pod environment
  refers to them (`{{ RUNPOD_SECRET_name }}`); the app and its agents only see the reference.
- **The image is `ghcr.io/bluecollardev/comfy-app:contract-v26`** (ADR-020; Lucas: "we are using github"). A GitLab CI build made on
  2026-11-03 with `rclone` and `S3_PULL` is pushed to `registry.gitlab.com/...` but is not what pods use. The test needs that build on
  `ghcr.io`: through the GitHub Actions workflow ADR-020 proposes, or by pulling from GitLab and pushing to `ghcr.io` from here.
- **First pull is the smallest round**, `brynley-inbox-2026-10-28-v001` (624 KB, 379 files), not a delivery round (9 to 39 GB), and
  never `plates/` without Binc's named yes.
- **Tested locally first** (Ubuntu container, `rclone` 1.53, an S3 server in the container): files land under `/workspace`, sha256
  matches, a rerun transfers nothing, a destination outside `/workspace` is refused. Auth failure is not covered by that test.

## Result of the pod test (2026-11-03, with spend, approved by Lucas)

Run on the app's volume `kceera10qh` (EUR-IS-2, Iceland), image `ghcr.io/bluecollardev/comfy-app:contract-v26`, an L4 at USD 0.59/h, 15-minute idle stop.
`S3_PULL=bh-panama-exchange-610140802195/rounds/brynley-inbox-2026-10-28-v001=/workspace/comfy-shared/temp/rounds/brynley-inbox-2026-10-28-v001`.

- **Pull works.** The pod's log shows `rclone` copying the round's files from the bucket (`609.227 KiB / 609.227 KiB, 100%`) and
  `s3 pull done: /workspace/comfy-shared/temp/rounds/brynley-inbox-2026-10-28-v001`, in the background while ComfyUI started (up about 70 s after the image was pulled; the pull
  itself took about 3 s). The pod pulled the image from `ghcr.io` with the saved registry login.
- **First attempt failed, usefully.** It was created through the MCP server in the session, a bundled copy older than the commit that adds the Panama keys to a pod's
  environment, so the pod had `S3_PULL` and no keys. The entrypoint said exactly that (`S3_PULL set but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not`) and pulled nothing.
  Pods made by the running app (or through its MCP, served on 127.0.0.1:8765) get the keys. The bundle was rebuilt (`npm run mcp:bundle`); a session that loaded the old one needs a restart.
- **Cost.** About USD 0.04 for both pods together (about 2 and 3 minutes). Both deleted; the volume (USD 7/month) is the only thing billing. `S3_PULL` was removed from the
  default configuration afterwards, so new pods do not pull.
- **Not covered.** A large round (the 20 Oct round is 9 GB, the 29 Oct one 39 GB), the datacenter-to-datacenter speed, a bad key (the first attempt covered a *missing* key only), the
  `.s3-pull.done` marker's content, and the manifest check on the pod (the app checks on this PC; the pod does not). The inbox round is text only, so it did not exercise multipart or large files.
- The keys sat in the pod's environment on RunPod in plain text, as the open question in ADR-021 says; `panama-lucas` was used.

## Second pod test: the app end to end (2026-11-03, approved by Lucas)

Local app, real pod, real bucket. Pod 2 (RTX 4090, created through the running app's MCP, ComfyUI up after about 5 minutes on a slow image pull) had the same `S3_PULL`.

- **The volume keeps the data and the pull is idempotent.** The pod logged `There was nothing to transfer` and `s3 pull done`: the 379 files pulled by the first, deleted pod were still on the network volume, and
  `rclone --checksum` found them identical to the bucket's. That is also the on-pod check of the files against the bucket (by size and checksum); a check against the round's `MANIFEST.json` on the pod is still not done.
- **Local half**, driven through the app's own core against the real bucket and the real `~/ComfyUI-Shared`: five real rounds listed with their state on this PC; the inbox round downloaded in 16.5 s and its manifest check passed
  (378 listed, 0 bad); the staged state read "complete"; the import plan refused it (no adapter recognises an inbox round, as expected); Delete freed 623,873 B; the 20 and 22 Oct rounds (9 and 14 GB on disk) were untouched.
- **SSH to a pod** with the host RunPod's API returns (`<id>.proxy.runpod.io`) did not resolve from this Mac, so nothing could be run on the pod. A manifest check on the pod would need the SSH route fixed.
- Cost about USD 0.05 more; no pod left running. `S3_PULL` removed from the default configuration again.
