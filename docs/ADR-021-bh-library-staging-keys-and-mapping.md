# ADR-021: Where Panama rounds stage, what Sync skips, and how the app holds the bucket keys

**Date:** 2026-11-03
**Status:** Accepted for staging, Sync and the mapping (Lucas, in the session); open for pod credentials (below).
**Extends:** ADR-016 (the BH library), ADR-011 (what a sync carries), ADR-015 (the pod pulls from the bucket). **Supersedes:** ADR-016's staging
folder (`~/panama-rounds`).

## Decisions

1. **Rounds stage inside ComfyUI-Shared, in `temp/rounds/<round>`.** Lucas: "put all in ComfyUI-Shared to begin with ... just call it
   temp/rounds". The folder is `<mapped ComfyUI-Shared>/temp/rounds/<round>`; with no mapping, `~/temp/rounds`; `PANAMA_ROUNDS_DIR` overrides.
   `libs/core/src/panama.ts` (`stagingDir`), `paths.ts` (`SHARED_TEMP`, `STAGED_ROUNDS`). Download is the staging; **Import Package** then runs the
   adapter plan and **Import** copies only the mapped files (each shot's `comfy/input` and `comfy/workflows`) into `input/` and `workflows/`.
2. **Sync never carries `temp/`.** Lucas: "skip temp folder when syncing". A push of ComfyUI-Shared always excludes the top-level `/temp/`
   (`syncrun.excludesFor`), so it is never a stream and a staged round (9 to 39 GB) never goes to a pod, over SSH or the S3 route. Tested
   (`tests/syncrun.test.ts`). This adds to ADR-011's folder choice; `temp/` is not one of the choosable folders.
3. **ComfyUI-Shared is mapped to `~/ComfyUI-Shared`, not Binc's mirror.** The saved mapping pointed at `projects/desktop/ComfyUI-Shared`, so an
   import would have written into the read-only mirror (`.claude/rules/binc-tree.md`). Lucas chose to remap it and to copy the mirror's tree in:
   2,008 files, 17 GB, `rsync -a --ignore-existing`, nothing overwritten or deleted, the mirror only read. **Not done:** a guard that makes an
   import refuse to write under `projects/desktop/` (Lucas: "just 1"). It stays an open item, since the mapping can still be pointed back.
4. **A download is a resumable sync, with Cancel.** The pull is `aws s3 sync` (no `--delete`), so Download again carries on over files already
   complete. Cancel kills the process, marks the job `cancelled` and leaves what was fetched. After a clean download the app verifies every file
   against the round's manifest (ADR-016) before offering **Import Package**. The Cancel button is in the download card's header, floated right;
   the downloaded badge comes before the row's buttons; the Import Package buttons are green.
5. **The app holds the bucket keys.** Default Configuration has a "Panama bucket (BH)" section (access key ID and secret, shown as the last four
   characters; stored in `~/.config/runpod-pod-manager/.env`, mode 0600; never in the mounts file). They win over the `panama` AWS profile, which is
   the fallback. The app runs `aws` with the keys in the environment and with `AWS_PROFILE` and `AWS_DEFAULT_PROFILE` **unset**; an empty
   `AWS_PROFILE` makes the CLI look for a profile named "" (`The config profile () could not be found`), the bug this fixed. For now the stored pair is
   `panama-lucas` (read-only, Lucas's own).
6. **The image is built by GitHub Actions** (ADR-020), `ghcr.io/bluecollardev/comfy-app:contract-v26`, with `rclone` and `S3_PULL`; verified from the
   registry's image history, not run.

## Open

- **Pod credentials.** The "Pull on pod start" field writes the keys into each new pod's environment on RunPod in plain text. ADR-015 recommended
  RunPod Secrets references (`{{ RUNPOD_SECRET_name }}`) so the values never sit in the pod definition. Until one is chosen, use only the read-only
  `panama-pod` key there, not `panama-lucas`.
- The mirror-write guard (decision 3).
- Moving the staging folder is a setting with no UI field yet.

## Consequences

- Everything a person handles on this PC is under one tree, and the mirror is no longer a write target by default.
- `temp/` in ComfyUI-Shared is scratch by convention now; anything placed there stays on this PC.
- The 20 Oct round is staged and verified at `~/ComfyUI-Shared/temp/rounds/brynley-comfy-2026-10-20` (1,283 files).
