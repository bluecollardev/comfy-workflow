#!/usr/bin/env bash
# Build the ComfyUI server image. Local by default; --push tags it with a registry
# reference and pushes it. The image carries Binc's ShotPipe packs, so the push needs
# Binc's named yes (registry name, account; policy/agent-permissions.md) and a prior
# `docker login <registry>`. The pushed reference is what the dashboard's
# Configuration (Image) and `./start.sh package --image` take.
#
#   ./build.sh                       # comfy-app:contract-v26 with the ShotPipe set the corrosion graphs need
#   ./build.sh --push ghcr.io/<org>/comfy-app:contract-v26   # build, tag, push; prints the reference to configure
#   ./build.sh --remote [--wait]     # build and push on GitHub Actions to ghcr.io: nothing big leaves this Mac
#   ./build.sh --shotpipe v26,v14,v7 # explicit versions instead of a set from shared/nodes/sets.json
#   ./build.sh --tag comfy-app:test
#   ./build.sh --no-shotpipe         # BincStereo only
#   ./build.sh --cuda 13              # the Blackwell image: CUDA 13 base (pins.env), tagged ...-cu13 (docs/ADR-030)
#   ./build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime   # any other base
#
# Node packs come from shared/nodes (the comfy-node-packs submodule); ShotPipe is
# client's (projects/desktop/CANALV2/02_SCRIPTS/nodes/, not in git), so it is
# staged into .build/custom_nodes/ (ignored) when asked for. Builds linux/amd64,
# which is what RunPod and the Windows/Linux boxes run; on Apple Silicon that
# goes through emulation and is slow but works.
#
# --remote: build on GitHub Actions (ADR-020): pushes a branch image/<variant>-<time>; the workflow reads the packs with a deploy key and pushes to ghcr.io.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/pins.env"

SHOTPIPE="contract-v26"
TAG=""
BASE=""
CUDA=""
SUFFIX=""
PLATFORM="linux/amd64"
PUSH=""
REMOTE=""
WAIT=""
CI_PROJECT="${COMFY_CI_PROJECT:-bcdevlucas/comfy-workflow}"
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --shotpipe) SHOTPIPE="$2"; shift 2 ;;
    --no-shotpipe) SHOTPIPE=""; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    --cuda) CUDA="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --push) PUSH="$2"; shift 2 ;;
    --remote) REMOTE=1; shift ;;
    --wait) WAIT=1; shift ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$CUDA" in
  "") ;;
  13) BASE="${BASE:-$BASE_IMAGE_CU13}"; SUFFIX="-cu13" ;;
  12.6|126) ;;   # the Dockerfile's default
  *) echo "--cuda takes 13 (or 12.6, the default), not $CUDA" >&2; exit 2 ;;
esac
[ -n "$TAG" ] || TAG="comfy-app:${SHOTPIPE:-base}${SUFFIX}"
if [ -n "$PUSH" ]; then
  case "$PUSH" in */*) ;; *) echo "--push needs a registry reference with a namespace, e.g. ghcr.io/<org>/comfy-app:$SHOTPIPE (a pod cannot pull a bare name)" >&2; exit 2 ;; esac
  case "$PUSH" in *:*) ;; *) PUSH="$PUSH:${SHOTPIPE:-base}${SUFFIX}" ;; esac
fi

if [ -n "$REMOTE" ]; then
  # ----- build on GitHub Actions (.github/workflows/comfy-image.yml, ADR-020): push a branch, the runner builds and pushes to ghcr.io -----
  command -v gh >/dev/null || { echo "--remote needs the GitHub CLI (gh), logged in" >&2; exit 1; }
  SLUG="${COMFY_CI_REPO:-bluecollardev/comfy-workflow}"
  IMAGE_TAG="${SHOTPIPE:-base}${SUFFIX}"; BRANCH="image/$IMAGE_TAG-$(date +%Y%m%d-%H%M%S)"
  REF="ghcr.io/${SLUG%%/*}/comfy-app:$IMAGE_TAG"
  git -C "$REPO" diff --quiet HEAD -- apps/comfy-app shared .github 2>/dev/null || echo "note: uncommitted changes under apps/comfy-app are not in the build; commit them first" >&2
  git -C "$REPO" push -q origin "HEAD:refs/heads/$BRANCH"
  echo "pushed $(git -C "$REPO" rev-parse --short HEAD) to $SLUG branch $BRANCH; Actions builds and pushes $REF"
  echo "runs: https://github.com/$SLUG/actions/workflows/comfy-image.yml"
  [ -n "$WAIT" ] || exit 0
  sleep 15; RUN=""
  for _ in 1 2 3 4 5 6; do RUN="$(gh run list -R "$SLUG" --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)"; [ -n "$RUN" ] && break; sleep 10; done
  [ -n "$RUN" ] || { echo "no run appeared for $BRANCH" >&2; exit 1; }
  echo "run $RUN: https://github.com/$SLUG/actions/runs/$RUN"
  gh run watch "$RUN" -R "$SLUG" --exit-status --interval 30 >/dev/null && {
    git -C "$REPO" push -q origin ":refs/heads/$BRANCH" 2>/dev/null || true
    echo "pushed $REF"; echo "next: enter $REF as the image in the dashboard's Default Configuration, or ./start.sh package mac --comfy ${SHOTPIPE:-base} --image $REF"; exit 0; }
  echo "run $RUN failed: gh run view $RUN -R $SLUG --log-failed" >&2; exit 1
fi

STAGE="$HERE/.build/custom_nodes"
rm -rf "$HERE/.build" && mkdir -p "$STAGE"

NODES="${COMFY_NODES_DIR:-$REPO/shared/nodes}"
[ -f "$NODES/README.md" ] || git -C "$REPO" submodule update --init --depth 1 shared/nodes
# A name in sets.json (e.g. contract-v26) expands to its packs; anything else is a version like v26.
expand_set() { python3 - "$NODES/sets.json" "$1" <<'PY'
import json, sys
sets = json.load(open(sys.argv[1])); s = sets.get(sys.argv[2])
print(" ".join(p.replace("ComfyUI-BH-ShotPipe-", "") for p in s["packs"] if "ShotPipe" in p) if isinstance(s, dict) else sys.argv[2])
PY
}
# Each pack's pyproject.toml [tool.packs] requires = [...] names the packs it imports from; pull those in too.
resolve_requires() { python3 - "$NODES" "$@" <<'PY'
import sys, re, pathlib
root = pathlib.Path(sys.argv[1]); want = list(sys.argv[2:]); seen = []
def requires(v):
    for f in ('portable', 'bound'):
        pp = root / f / f"ComfyUI-BH-ShotPipe-{v}" / 'pyproject.toml'
        if pp.exists():
            m = re.search(r'\[tool\.packs\](.*?)(?:\n\[|\Z)', pp.read_text(), re.S)
            r = re.search(r'requires\s*=\s*\[(.*?)\]', m.group(1) if m else '', re.S)
            return [x.replace('ComfyUI-BH-ShotPipe-', '') for x in re.findall(r'"([^"]+)"', r.group(1))] if r else []
    return []
while want:
    v = want.pop(0)
    if v in seen: continue
    seen.append(v); want += requires(v)
print(" ".join(sorted(seen, key=lambda v: int(v[1:]))))
PY
}
pack_dir() { for f in portable bound; do [ -d "$NODES/$f/$1" ] && { echo "$NODES/$f/$1"; return; }; done; return 1; }
for d in "$NODES"/portable/*/ "$NODES"/bound/*/; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"; case "$n" in ComfyUI-BH-ShotPipe-*) continue ;; esac
  rsync -a --exclude __pycache__ --exclude tests --exclude test-input "$d" "$STAGE/$n/"; echo "staged: $n"
done
PACKS_REV="$(git -C "$NODES" rev-parse --short HEAD 2>/dev/null || echo unknown)"
IFS=, read -ra REQUESTED <<< "$SHOTPIPE"
VERSIONS=(); for r in "${REQUESTED[@]}"; do for v in $(expand_set "$r"); do VERSIONS+=("$v"); done; done
[ ${#VERSIONS[@]} -eq 0 ] || VERSIONS=($(resolve_requires "${VERSIONS[@]}"))   # v26 alone pulls in v14 and v7
for v in "${VERSIONS[@]}"; do
  [ -n "$v" ] || continue
  src="$(pack_dir "ComfyUI-BH-ShotPipe-$v")" || { echo "no ShotPipe $v in $NODES/portable or bound" >&2; exit 1; }
  rsync -a --exclude __pycache__ "$src/" "$STAGE/ComfyUI-BH-ShotPipe-$v/"
  echo "staged: ComfyUI-BH-ShotPipe-$v"
done


args=(build --platform "$PLATFORM" -t "$TAG" -f "$HERE/Dockerfile"
      --label "dev.bluecollar.comfy-node-packs=$PACKS_REV" --label "dev.bluecollar.shotpipe=${SHOTPIPE:-none}" --label "dev.bluecollar.cuda=${CUDA:-12.6}"
      --build-arg "COMFYUI_REPO=$COMFYUI_REPO" --build-arg "COMFYUI_REF=$COMFYUI_REF")
[ -n "$BASE" ] && args+=(--build-arg "BASE_IMAGE=$BASE")
args+=("${EXTRA[@]}" "$HERE")
echo "docker ${args[*]}"
docker "${args[@]}"
echo "built $TAG"
if [ -n "$PUSH" ]; then
  docker tag "$TAG" "$PUSH"
  docker push "$PUSH" || { echo "push failed: run 'docker login ${PUSH%%/*}' first (a token with write:packages for ghcr.io), then re-run with --push" >&2; exit 1; }
  echo "pushed $PUSH"
  echo "next: enter $PUSH as the image in the dashboard's Configuration (gear icon), or ./start.sh package mac --comfy ${SHOTPIPE:-base} --image $PUSH"
fi
