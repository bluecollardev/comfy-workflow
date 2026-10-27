# ADR-012: the app is released by version

**Status:** accepted (2026-10-27) · **Decided by:** Lucas

## Context
The app was at `1.0.0` in `package.json` and never tagged, so no build could be
tied to a commit. Binc and others need a stable place to download a build from,
and a DMG (about 130 MB) cannot live in git (100 MB file limit).

## Decision
1. **Semantic versioning**, one number: the app's `version` in
   `apps/runpod-dashboard/package.json`. **Every release is a patch increment
   (1.0.1, 1.0.2, ...) unless Lucas names the version.** `minor` and `major` are
   never chosen by an agent: `minor` is for a release Lucas calls a feature
   release, `major` for one that breaks saved configuration or the CLI/MCP. The
   first tagged release is **1.0.1**, a patch on the untagged 1.0.0 (it carries
   the sync options of ADR-011; Lucas chose a patch).
2. **A release is cut from `develop` or `master`** with a clean tree, by
   `./start.sh release patch|minor|major|X.Y.Z` (`scripts/release.sh`): bump the
   version, build the Mac DMG, commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`.
   `master` fast-forwards to the tagged commit as before (`.claude/rules/branching.md`).
3. **Downloads are published as GitHub Releases on a separate public repo,
   `bluecollardev/downloads`**, not in this one. Each release has the versioned
   DMG and a stable alias `RunPod-Manager-mac-arm64.dmg`, so
   `.../releases/latest/download/RunPod-Manager-mac-arm64.dmg` never changes.
4. **The download page** is `downloads/index.html` here, copied by the script to
   the downloads repo and served by GitHub Pages. It reads the latest release
   from the GitHub API and falls back to the releases page.
5. **The build records its version.** The DMG file name carries the version; the
   default pod image is baked in from `COMFY_IMAGE` (`ghcr.io/bluecollardev/comfy-app:<variant>`),
   which is a separate version: the image is tagged by ShotPipe set, not by app release.

## Consequences
- Every installed app can be matched to a tag and its CHANGELOG entry.
- The downloads repo is public. The DMG holds no keys; the pod image stays
  private and needs the registry login on the user's RunPod account.
- Builds are unsigned until a Developer ID certificate exists; the page says how
  to open one. Only macOS arm64 is built; Windows, Linux and Intel are not.
- Releasing needs a token with `repo` scope: `GITHUB_TOKEN`, `.env`, or `gh auth login`.
