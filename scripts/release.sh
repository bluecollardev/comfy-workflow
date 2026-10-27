#!/usr/bin/env bash
# Cut a release of the app: bump the version, build the Mac DMG, tag the commit, and publish the DMG
# as a GitHub Release on the downloads repo (the page in downloads/ links to the latest one).
#
#   ./start.sh release patch|minor|major|X.Y.Z [--dry-run] [--no-publish]
#
# Needs a clean tree on develop or master (build-info.json aside). Publishing needs a token with repo scope:
# GITHUB_TOKEN (env or .env), else the `gh auth login` session. Versioning rules and the first-time setup: docs/RELEASING.md.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$HERE"
APP="apps/runpod-dashboard"
DL_REPO="${DOWNLOADS_REPO:-bluecollardev/downloads}"
BUMP="${1:-}"; shift || true
PAGE_ONLY=0; [ "$BUMP" = page ] && PAGE_ONLY=1
DRY=0; PUBLISH=1
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; --no-publish) PUBLISH=0 ;; *) echo "unknown option $a" >&2; exit 2 ;; esac; done
[ -n "$BUMP" ] || { echo "usage: ./start.sh release patch|minor|major|X.Y.Z|page [--dry-run] [--no-publish]" >&2; exit 2; }
[ -z "${GITHUB_TOKEN:-}" ] && [ -f .env ] && GITHUB_TOKEN="$(grep -E '^GITHUB_TOKEN=' .env | cut -d= -f2- || true)"
[ -z "${GITHUB_TOKEN:-}" ] && command -v gh >/dev/null && GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"

if [ "$PAGE_ONLY" = 1 ]; then   # ./start.sh release page : only the download page, no build, no tag
  [ -n "${GITHUB_TOKEN:-}" ] || { echo "needs a token with repo scope (gh auth login)" >&2; exit 1; }
  SHA="$(curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" "https://api.github.com/repos/$DL_REPO/contents/index.html" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).sha' 2>/dev/null || true)"
  curl -fsS -H "Authorization: Bearer $GITHUB_TOKEN" -X PUT "https://api.github.com/repos/$DL_REPO/contents/index.html" -d "{\"message\":\"update the page\",\"content\":\"$(base64 < downloads/index.html | tr -d '\n')\"${SHA:+,\"sha\":\"$SHA\"}}" >/dev/null
  echo "page updated: https://${DL_REPO%%/*}.github.io/${DL_REPO##*/}/"; exit 0
fi
CUR="$(node -p "require('./$APP/package.json').version")"
case "$BUMP" in
  patch|minor|major) NEXT="$(node -e "const [a,b,c]='$CUR'.split('.').map(Number);console.log({patch:[a,b,c+1],minor:[a,b+1,0],major:[a+1,0,0]}['$BUMP'].join('.'))")" ;;
  [0-9]*.[0-9]*.[0-9]*) NEXT="$BUMP" ;;
  *) echo "version must be patch, minor, major or X.Y.Z" >&2; exit 2 ;;
esac
TAG="v$NEXT"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "release: $CUR -> $NEXT (tag $TAG, branch $BRANCH, downloads repo $DL_REPO)"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "tag $TAG already exists" >&2; exit 1; }
[ "$DRY" = 1 ] && { echo "dry run: would bump $APP/package.json, build the Mac DMG, tag $TAG, ${PUBLISH:+publish to $DL_REPO}"; exit 0; }
case "$BRANCH" in develop|master) ;; *) echo "release from develop or master (on $BRANCH)" >&2; exit 1 ;; esac
[ -z "$(git status --porcelain | grep -v 'build/build-info.json' || true)" ] || { echo "the tree has uncommitted changes" >&2; exit 1; }
if [ "$PUBLISH" = 1 ]; then [ -n "${GITHUB_TOKEN:-}" ] || { echo "publishing needs GITHUB_TOKEN (repo scope); or use --no-publish" >&2; exit 1; }; fi

( cd "$APP" && npm version "$NEXT" --no-git-tag-version >/dev/null )
IMAGE="${COMFY_IMAGE:-}"
for PLATFORM in ${RELEASE_PLATFORMS:-mac}; do ./start.sh package "$PLATFORM" ${IMAGE:+--image "$IMAGE"}; done
DMG="$APP/dist-electron/contract-v26/RunPod Manager-$NEXT-mac-arm64.dmg"
[ -f "$DMG" ] || DMG="$(ls -t "$APP"/dist-electron/*/RunPod\ Manager-"$NEXT"-mac-arm64.dmg | head -1)"
[ -f "$DMG" ] || { echo "no DMG for $NEXT was built" >&2; exit 1; }

git add "$APP/package.json" "$APP/package-lock.json" 2>/dev/null || git add "$APP/package.json"
git commit -q -m "chore(release): $TAG

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git tag -a "$TAG" -m "RunPod Manager $NEXT"
echo "tagged $TAG; push it with: git push origin $BRANCH --tags"
[ "$PUBLISH" = 1 ] || { echo "DMG: $DMG"; exit 0; }

API="https://api.github.com"; H=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")
if ! curl -fsS "${H[@]}" "$API/repos/$DL_REPO" >/dev/null 2>&1; then
  echo "creating $DL_REPO (public: Pages and release downloads need it)"
  curl -fsS "${H[@]}" -X POST "$API/orgs/${DL_REPO%%/*}/repos" -d "{\"name\":\"${DL_REPO##*/}\",\"private\":false,\"auto_init\":true}" >/dev/null
fi
# the page: downloads/index.html on main, served by Pages
SHA="$(curl -fsS "${H[@]}" "$API/repos/$DL_REPO/contents/index.html" 2>/dev/null | node -pe 'JSON.parse(require("fs").readFileSync(0)).sha' 2>/dev/null || true)"
curl -fsS "${H[@]}" -X PUT "$API/repos/$DL_REPO/contents/index.html" -d "{\"message\":\"page for $TAG\",\"content\":\"$(base64 < downloads/index.html | tr -d '\n')\"${SHA:+,\"sha\":\"$SHA\"}}" >/dev/null
curl -fsS "${H[@]}" -X POST "$API/repos/$DL_REPO/pages" -d '{"source":{"branch":"main","path":"/"}}' >/dev/null 2>&1 || true
REL="$(curl -fsS "${H[@]}" -X POST "$API/repos/$DL_REPO/releases" -d "{\"tag_name\":\"$TAG\",\"name\":\"RunPod Manager $NEXT\",\"body\":\"Mac (Apple Silicon). Unsigned: right-click the app and choose Open the first time.\"}")"
RID="$(echo "$REL" | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')"
# every installer built for this version (mac dmg; win exe; linux AppImage, deb), each as the versioned
# file and a stable alias without the version: RunPod-Manager-<platform>-<arch>.<ext>
for F in "$APP"/dist-electron/*/RunPod\ Manager-"$NEXT"-*.{dmg,exe,AppImage,deb}; do
  [ -f "$F" ] || continue
  BASE="$(basename "$F")"; VERSIONED="${BASE// /-}"; ALIAS="${VERSIONED/-$NEXT-/-}"
  for NAME in "$VERSIONED" "$ALIAS"; do
    curl -fsS "${H[@]}" -H "Content-Type: application/octet-stream" -X POST "https://uploads.github.com/repos/$DL_REPO/releases/$RID/assets?name=$NAME" --data-binary @"$F" >/dev/null
    echo "uploaded $NAME"
  done
done
echo "released: https://github.com/$DL_REPO/releases/tag/$TAG"
