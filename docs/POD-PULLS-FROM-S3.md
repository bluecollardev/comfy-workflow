# A pod pulls from an S3 bucket into the volume

The image carries `rclone`; at start the entrypoint copies bucket prefixes onto
the network volume (`/workspace`), in the background, so ComfyUI is up while
the bytes arrive. The bytes land on the volume, so they survive the pod
(ADR-007, option E, with the pod doing the pull at datacenter speed instead of
the Mac's uplink).

## Pod environment

| Variable | Meaning |
|---|---|
| `S3_PULL` | `bucket/prefix=/workspace/dir;bucket/prefix2=/workspace/dir2`. Each pair is `rclone copy`: additive, never deletes, checksum compared, so a rerun only fetches what is missing. A destination outside `/workspace` is refused. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | A **read-only** key. For the Panama exchange bucket this is the `panama-pod` key Kyle issues (read `rounds/`, `masters/`, `plates/`, `returns/`; write `returns/` only). |
| `AWS_REGION` | Default `us-west-2`. |
| `S3_ENDPOINT`, `S3_PROVIDER` | Only for a non-AWS bucket (R2, B2): the endpoint URL, and `Cloudflare`, `Other`, ... Default provider `AWS`. |

Put the two key values in RunPod **Secrets** and reference them in the pod's
environment (`{{ RUNPOD_SECRET_name }}`); never in the image, the repo or
`.env`.

## Example: a Panama round onto the volume

```
S3_PULL=bh-panama-exchange-610140802195/rounds/brynley-comfy-2026-10-23=/workspace/comfy-shared/input/brynley-comfy-2026-10-23
AWS_ACCESS_KEY_ID={{ RUNPOD_SECRET_panama_pod_id }}
AWS_SECRET_ACCESS_KEY={{ RUNPOD_SECRET_panama_pod_secret }}
```

The container log shows `s3 pull: ...` and a progress line every 30 s. When a pair has copied, the pod **checks it against the round's manifests** before saying it is done
(`/opt/comfy-app/verify_round.py`, the same size-and-sha256 check as the app's own and BH's `verify_round.py`; it reads the root `MANIFEST.json` and each shot's), and leaves one marker in the pulled folder:

| Marker | Meaning | Log line |
|---|---|---|
| `.s3-pull.done` | copied, and every file listed in the manifests is present with the right size and sha256 | `s3 pull done (manifest verified): <dir>` |
| `.s3-pull.failed` | copied, but a file is missing, short or differs; the file holds the list (`MISSING`, `SIZE`, `SHA256` per file) and the totals | `s3 pull FAILED the manifest check: <dir>` (the last lines follow) |
| `.s3-pull.unverified` | copied, but there is no usable `MANIFEST.json` to check against (a prefix that is not a delivery round) | `s3 pull done, NOT verified (no MANIFEST.json): <dir>` |

The work is the script `/opt/comfy-app/s3pull.sh` (the entrypoint starts it in the background; the app can also run it over SSH on a pod that is already up). It exits 0 when every pair copied, **even if a manifest check failed**, because a failed check is a result, not a crash: read the marker, not the exit code. It exits 1 when a copy itself failed. Only `.s3-pull.done` means the round is safe to use. A rerun removes the old markers first, so a stale `.done` never survives a failed second pull; the copy itself is additive and transfers only what differs. The check
reads every byte of the round once, so a 39 GB round adds its hashing time to the pull.

By hand in a running pod: `rclone copy PODS3:<bucket>/<prefix> /workspace/<dir>`
after exporting the same `RCLONE_CONFIG_PODS3_*` variables the entrypoint
sets, or with a `[panama]` section in `~/.config/rclone/rclone.conf`.

## Pulling a round from the app: the Pod download (ADR-022)

The app can start the same pull for you, from the Panama pane's Pod mode, without a pod being created by hand. Core: `libs/core/src/podpull.ts`; IPC calls in the `panama` namespace: `podRounds`, `podPlan`, `podPull`, `podJob`, `podCancel`, `podRemove`.

| | A pod of yours is already running on the volume (`active`) | No pod is running (`temporary`) |
|---|---|---|
| Runs | `/opt/comfy-app/s3pull.sh` over SSH on that pod, the way the Sync reaches a pod; the script and the bucket keys go on **stdin**, never in an argument | a pod the app creates through its own create path on the volume, the cheapest GPU in stock (no CPU path), with `S3_PULL` for that one round and the keys in **its** environment |
| Name | your pod's | `ComfyUI-Pull-<round>-<MMDD>`, so it is recognisable in the pod list |
| Idle timer | held at the **ceiling** for the job, your old value put back after | registered at the ceiling when created; the pod is deleted when the job ends |
| After | your pod is never tagged, stopped or deleted | deleted when the job is done, failed or cancelled; if the delete fails the job says so and the timer is the backstop |

- **The ceiling** is the larger of 30 minutes and the round's size at 30 MB/s (a 300 GB round: 167 minutes). The idle watch only counts what ComfyUI reports, and a pull queues nothing, so without a hold it would stop the pod mid-pull; with the ceiling a dead job or a closed app cannot keep a pod billing forever.
- **A tag is written before a temporary pod is created** (`pull-pods.json` in the config folder: round, name, pod id once known, volume, time, `approved_by`), and removed after its delete. A pod left behind by a crash is both in that file and in the pod list under its name.
- **The job** moves `creating`, `starting`, `pulling`, `verifying`, `deleting`, then `done`, `failed` or `cancelled`, filled in from the pod's log (or the SSH output): the copied-file count, the last lines, and the verdict lines of `s3pull.sh`. A failed manifest check carries the list of files; a round with no `MANIFEST.json` is `failed` with the reason (the files are on the volume; the row shows `unverified`). The keys are scrubbed from every line.
- **What the volume holds** cannot be read without a pod (a volume in `EUR-IS-2` has no RunPod S3 API), so `podRounds` answers from what the last pod job reported, per volume, with the time it was learned (`as_of`).
- **Delete** (`podRemove`) removes exactly `/workspace/comfy-shared/temp/rounds/<round>` on the volume: a script with the path built from a constant and a name checked against the round-name rule, and the path checked again on the pod. With no pod running it creates a temporary pod, waits for its SSH port and runs the same script there.
- One job per round at a time; Cancel on an SSH job cuts the session and sends a second command that stops `rclone`; on a temporary pod it deletes the pod.
- In no-spend mode the whole job is simulated with no RunPod call and no SSH, and what it learns is kept apart from the real volume.
- Needs an image with `s3pull.sh` (a pod from an older one fails with a message saying so) and, for the SSH route, an SSH public key on the RunPod account added before the pod started (the Sync's requirement too).

## Rules that still apply

- Plates and anything from the client leave their bucket only with Binc's
  named yes (`shared/governance/policy/agent-permissions.md`); a pull to a
  RunPod volume is data moving to a third-party datacenter.
- Egress from AWS is billed to the bucket owner; the volume bills as usual.
- The image must be rebuilt and pushed for the pull to exist
  (`./start.sh comfy-image --push <ref>`); the stock image has no rclone.
- The app does not yet have fields for these variables; set them as extra
  environment on the pod. A field in Default Configuration is the next step.
