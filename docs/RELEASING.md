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
- `RunPod-Manager-X.Y.Z-mac-arm64.dmg` and the alias `RunPod-Manager-mac-arm64.dmg`.
- The app is unsigned: users right-click, Open. For a signed build,
  `CSC_IDENTITY_AUTO_DISCOVERY=true ./start.sh package mac` needs a Developer ID certificate.
- No keys: users enter their RunPod key, and the registry-auth ID of their `ghcr.io` login,
  in Default Configuration.

## Change the download page
Edit `downloads/index.html` and cut a patch release; the script re-uploads the page each time.
