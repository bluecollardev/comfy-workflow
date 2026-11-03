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

## Rules that still apply

- Plates and anything from the client leave their bucket only with Binc's
  named yes (`shared/governance/policy/agent-permissions.md`); a pull to a
  RunPod volume is data moving to a third-party datacenter.
- Egress from AWS is billed to the bucket owner; the volume bills as usual.
- The image must be rebuilt and pushed for the pull to exist
  (`./start.sh comfy-image --push <ref>`); the stock image has no rclone.
- The app does not yet have fields for these variables; set them as extra
  environment on the pod. A field in Default Configuration is the next step.
