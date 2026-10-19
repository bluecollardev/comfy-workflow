#!/usr/bin/env bash
# Build the ComfyUI server image. Local build only; pushing to a registry is a
# separate step that needs Binc's yes (registry name, account).
#
#   ./build.sh                       # comfy-app:v26 with ShotPipe v26
#   ./build.sh --shotpipe v26,v25    # several ShotPipe versions side by side
#   ./build.sh --tag comfy-app:test
#   ./build.sh --no-shotpipe         # BincStereo only
#   ./build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime   # e.g. for Blackwell GPUs
#
# Stages the node packs into .build/custom_nodes/ (ignored by git) because they
# are not in the repo: BincStereo comes from the Mac install's custom_nodes/,
# ShotPipe from projects/desktop/CANALV2/02_SCRIPTS/nodes/. Builds linux/amd64,
# which is what RunPod and the Windows/Linux boxes run; on Apple Silicon that
# goes through emulation and is slow but works.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

SHOTPIPE="v26"
TAG=""
BASE=""
PLATFORM="linux/amd64"
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --shotpipe) SHOTPIPE="$2"; shift 2 ;;
    --no-shotpipe) SHOTPIPE=""; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TAG" ] || TAG="comfy-app:${SHOTPIPE:-base}"

STAGE="$HERE/.build/custom_nodes"
rm -rf "$HERE/.build" && mkdir -p "$STAGE"

BINC="${COMFY_BINCSTEREO:-$HERE/ComfyUI/custom_nodes/ComfyUI-BincStereo}"
if [ -d "$BINC" ]; then
  rsync -a --exclude __pycache__ --exclude test-input --exclude tests "$BINC/" "$STAGE/ComfyUI-BincStereo/"
  echo "staged: ComfyUI-BincStereo (from $BINC)"
else
  echo "warning: no BincStereo at $BINC; image will not have the stereo nodes" >&2
fi

NODES="${COMFY_SHOTPIPE_DIR:-$REPO/projects/desktop/CANALV2/02_SCRIPTS/nodes}"
IFS=, read -ra VERSIONS <<< "$SHOTPIPE"
for v in "${VERSIONS[@]}"; do
  [ -n "$v" ] || continue
  src="$NODES/ComfyUI-BH-ShotPipe-$v"
  [ -d "$src" ] || { echo "no ShotPipe $v at $src" >&2; exit 1; }
  rsync -a --exclude __pycache__ --exclude superseded "$src/" "$STAGE/ComfyUI-BH-ShotPipe-$v/"
  echo "staged: ComfyUI-BH-ShotPipe-$v"
done

args=(build --platform "$PLATFORM" -t "$TAG" -f "$HERE/Dockerfile")
[ -n "$BASE" ] && args+=(--build-arg "BASE_IMAGE=$BASE")
args+=("${EXTRA[@]}" "$HERE")
echo "docker ${args[*]}"
docker "${args[@]}"
echo "built $TAG"
