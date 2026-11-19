# Releasing the app

Decision and reasons: [ADR-012](./ADR-012-versioned-releases.md).

## Cut a release
```bash
git checkout develop && git pull
./start.sh test                              # the gate; nothing releases red
./start.sh release patch --dry-run          # prints the versions and what it would do
./start.sh release patch                     # bump, build the DMG, commit, tag, publish
git push origin develop --tags
git checkout master && git merge --ff-only develop && git push origin master
```
**Use `patch` unless Lucas names a version** (ADR-012). `patch|minor|major` bump from the current version in `apps/runpod-dashboard/package.json`; an
exact `X.Y.Z` also works. `--no-publish` builds and tags only and prints the DMG path.
Add the release to `CHANGELOG.md` with its tag.

## First time
1. `gh auth login` (installed with `brew install gh`) with `repo` scope, or put
   `GITHUB_TOKEN=` in the repo `.env`.
2. The script creates the public repo `bluecollardev/downloads` if it is missing, uploads
   `downloads/index.html` and turns on Pages (source: `main`, `/`). Check
   Settings → Pages once. The page is at `https://bluecollardev.github.io/downloads/`.
3. `COMFY_IMAGE` (env or `.env`) is the pod image baked into the DMG. Without it the build
   falls back to the local tag, which pods refuse.

## What a release contains
Delivery: [ADR-013](./ADR-013-delivery.md). `RELEASE_PLATFORMS="mac win linux" ./start.sh release patch` builds more than macOS (default `mac`); every installer built is uploaded as `RunPod-Manager-X.Y.Z-<platform>-<arch>.<ext>` plus the alias without the version. `./start.sh release page` re-publishes only the page.
- `RunPod-Manager-X.Y.Z-mac-arm64.dmg` and the alias `RunPod-Manager-mac-arm64.dmg`.
- The app is unsigned. On macOS 15 and later right-click, Open no longer works: the page tells users to run `xattr -dr com.apple.quarantine "/Applications/RunPod Manager.app"` once, or use System Settings, Privacy & Security, Open Anyway. For a signed build,
  `CSC_IDENTITY_AUTO_DISCOVERY=true ./start.sh package mac` needs a Developer ID certificate.
- No keys: users enter their RunPod key, and the registry-auth ID of their `ghcr.io` login,
  in Default Configuration.

## The documentation site
`./start.sh release docs` rebuilds https://bluecollardev.github.io/downloads/docs/ from the README's Documentation section (ADR-014). No version, no release. `node scripts/docs-site.mjs <dir>` builds it locally to look at first. Setup screenshots: `WALKTHROUGH=1 ./start.sh e2e-app walkthrough.spec.js`.

## Change the download page
Edit `downloads/index.html` and cut a patch release; the script re-uploads the page each time.

## The gate comes first (2026-11-19)
Run `./start.sh test` (with the app stopped) on the code you are about to release; it must pass in full (core, MCP, IPC, unit, browser, the real app) and records the pass. `./start.sh release ...` then proceeds; without a current pass for exactly this code it refuses. A deliberate skip is `--skip-gate "reason"` and is recorded in `.gate/skips.log` and in the CHANGELOG entry. See ADR-005 (amendment).


## Signing and notarizing the Mac build (so nobody sees a Gatekeeper block)
An unsigned Mac app is blocked on macOS 15 and later. `./start.sh package mac` (and `release`) sign and notarize automatically when these are set, and print a loud UNSIGNED warning when they are not:
- `CSC_NAME="Developer ID Application: Name (TEAMID)"` (or `CSC_LINK` and `CSC_KEY_PASSWORD` for a .p12), and
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (an app-specific password), `APPLE_TEAM_ID`.
This needs an Apple Developer ID Application certificate from a paid Apple Developer account. Until it exists, the download page offers the Terminal `curl` install (no quarantine flag, so no warning) and the Open Anyway steps.
