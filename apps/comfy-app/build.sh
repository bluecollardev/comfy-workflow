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
# Node packs come from shared/nodes (the comfy-node-packs submodule); ShotPipe is
# client's (projects/desktop/CANALV2/02_SCRIPTS/nodes/, not in git), so it is
# staged into .build/custom_nodes/ (ignored) when asked for. Builds linux/amd64,
# which is what RunPod and the Windows/Linux boxes run; on Apple Silicon that
# goes through emulation and is slow but works.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/pins.env"

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

NODES="${COMFY_NODES_DIR:-$REPO/shared/nodes}"
[ -f "$NODES/README.md" ] || git -C "$REPO" submodule update --init --depth 1 shared/nodes
pack_dir() { for f in portable bound; do [ -d "$NODES/$f/$1" ] && { echo "$NODES/$f/$1"; return; }; done; return 1; }
for d in "$NODES"/portable/*/ "$NODES"/bound/*/; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"; case "$n" in ComfyUI-BH-ShotPipe-*) continue ;; esac
  rsync -a --exclude __pycache__ --exclude tests --exclude test-input "$d" "$STAGE/$n/"; echo "staged: $n"
done
PACKS_REV="$(git -C "$NODES" rev-parse --short HEAD 2>/dev/null || echo unknown)"
IFS=, read -ra VERSIONS <<< "$SHOTPIPE"
for v in "${VERSIONS[@]}"; do
  [ -n "$v" ] || continue
  src="$(pack_dir "ComfyUI-BH-ShotPipe-$v")" || { echo "no ShotPipe $v in $NODES/portable or bound" >&2; exit 1; }
  rsync -a --exclude __pycache__ "$src/" "$STAGE/ComfyUI-BH-ShotPipe-$v/"
  echo "staged: ComfyUI-BH-ShotPipe-$v"
done

args=(build --platform "$PLATFORM" -t "$TAG" -f "$HERE/Dockerfile"
      --label "dev.bluecollar.comfy-node-packs=$PACKS_REV" --label "dev.bluecollar.shotpipe=${SHOTPIPE:-none}"
      --build-arg "COMFYUI_REPO=$COMFYUI_REPO" --build-arg "COMFYUI_REF=$COMFYUI_REF")
[ -n "$BASE" ] && args+=(--build-arg "BASE_IMAGE=$BASE")
args+=("${EXTRA[@]}" "$HERE")
echo "docker ${args[*]}"
docker "${args[@]}"
echo "built $TAG"
