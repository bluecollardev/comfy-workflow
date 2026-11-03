# ADR-020: The pod image lives on GitHub (ghcr.io); GitLab is no longer the registry

**Date:** 2026-11-03
**Status:** Accepted (Lucas: "we are using github").
**Supersedes:** the registry and CI parts of ADR-006. **Agrees with:** ADR-012 (the app's default image is `ghcr.io/bluecollardev/comfy-app:<variant>`), `docs/RELEASING.md`.

## Context

ADR-006 (2026-10-20) put the pod image in a private GitLab registry (`registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app`) and built it
on GitLab CI, so the 3 GB torch layer never crossed the Mac's uplink. Since then the app, its releases and its docs moved to GitHub:
the app's configured image is `ghcr.io/bluecollardev/comfy-app:contract-v26`, new users log RunPod in to `ghcr.io` (README, "First time on a
RunPod account"), and the repo's origin is GitHub. On 2026-11-03 the S3 pull work built an image on GitLab CI by following ADR-006
(`./start.sh comfy-image --remote --wait`); it is pushed, but nothing points a pod at it.

## Decision

1. **`ghcr.io/bluecollardev/comfy-app:<variant>` is the one pod image.** Default Configuration, the app's baked default, the docs and the
   MCP `create_pod` all use it. Pods pull it with the registry-auth ID of a `ghcr.io` login saved on the RunPod account.
2. **GitLab is retired as a registry.** `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26` (built 2026-11-03, the first
   image with `rclone` and `S3_PULL`) is a one-off and is not used by pods. The `gitlab-comfy-workflow` credential on the RunPod account
   is not needed. `build.sh --remote` still targets GitLab and is to be replaced (below).
3. **The build moves to GitHub, so the Mac's uplink is still not in the loop.** Proposed: a GitHub Actions workflow in
   `bluecollardev/comfy-workflow` that builds `apps/comfy-app` natively on amd64 and pushes to `ghcr.io` with the workflow's token, tagged
   by variant (`contract-v26`) and by commit. `./start.sh comfy-image --remote` then triggers it (`gh workflow run`) and `--wait` follows it
   (`gh run watch`) instead of pushing a branch to GitLab. `--push <ref>` from the Mac stays as the slow fallback.
4. **Package visibility stays private** (the node packs are Binc's; ADR-006's reasoning holds). The package is linked to the repo so the
   workflow can write it; readers get a token with `read:packages`.

## Consequences

- To use the 2026-11-03 image now without waiting for the workflow: pull it from GitLab and push it to `ghcr.io` (a download then a
  multi-GB upload over the Mac's link, the cost ADR-006 avoided), or rerun the build once the workflow exists. Neither is done.
- The Actions workflow needs the node packs: they come from the `shared/nodes` submodule (`bluecollardev/comfy-node-packs`, private), so the
  workflow's checkout needs a token that can read it, and the ShotPipe packs that `build.sh` stages from the CANALV2 mirror must be
  available the same way. This is the open part; if it cannot be done, the build stays a local `--push`.
- GitHub's free Actions minutes for private repos are limited (as GitLab's were); a build of this image is long, so builds are
  triggered by hand or by a tag, not on every push.
- ADR-015's pod test uses the `ghcr.io` reference, with no GitLab login needed.

## Order of work

1. Decide how the workflow reaches the node packs (token for the submodule, and the ShotPipe staging).
2. Add `.github/workflows/comfy-image.yml`; make `build.sh --remote` drive it.
3. Build `contract-v26` there; point nothing else at GitLab; delete the GitLab project's registry tags when convenient.
