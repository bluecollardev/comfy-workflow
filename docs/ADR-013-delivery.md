# ADR-013: how the app is delivered

**Status:** accepted (2026-10-27) · **Decided by:** Lucas · Builds on [ADR-012](./ADR-012-versioned-releases.md)

## Context
Binc and others install the app on their own machines, not only Macs. Lucas:
"we want to have a github page to distribute dmg and exe and whatever for linux too."

## Decision
1. **One delivery point: a GitHub Pages site on the public `bluecollardev/downloads` repo**
   (`https://bluecollardev.github.io/downloads/`), with the installers as GitHub Release assets
   on the same repo. The page is `downloads/index.html` here; `./start.sh release page` updates it
   without a release.
2. **Every platform the app is built for, one button each:**
   macOS `.dmg`, Windows `.exe` (NSIS installer; the portable `.exe` is also built), Linux
   `.AppImage` (and `.deb`). The page highlights the visitor's system and greys out a platform
   with no build in the latest release.
3. **Names.** Each release carries the versioned file (`RunPod-Manager-1.0.2-win-x64.exe`) and
   a stable alias without the version (`RunPod-Manager-win-x64.exe`). The page and anyone's bookmark
   link to the alias through `releases/latest/download/`.
4. **What a release contains is what was built.** `./start.sh release` builds the platforms in
   `RELEASE_PLATFORMS` (default `mac`) and uploads every installer for that version. A platform is
   added to the default only after its installer has been opened on that system; until then the
   page greys it out. Today only macOS arm64 is built and verified.
5. **Where Windows and Linux are built is open.** electron-builder can cross-build from a Mac, but
   a Windows or Linux installer made that way has not been run on those systems. The route intended
   once those builds are needed is a CI job per platform (GitHub Actions matrix on the downloads
   or this repo) that builds on the native runner and attaches to the same release.
6. **Unsigned for now.** The page tells each platform how to get past the warning (Gatekeeper,
   SmartScreen). Signing (Apple Developer ID, a Windows certificate) is separate work.
7. **No secrets in a download.** Installers contain no keys; users enter their RunPod key and the
   registry-auth ID of their `ghcr.io` login. The pod image stays private (ADR-012).

## Consequences
- One link to give anyone: the Pages URL.
- Releases stay macOS-only until Windows and Linux builds are verified; the page says so by greying
  the button instead of linking something untested.
- The downloads repo is public, so the installers are too.
