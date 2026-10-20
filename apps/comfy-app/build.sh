#!/usr/bin/env bash
# Build the ComfyUI server image. Local by default; --push tags it with a registry
# reference and pushes it. The image carries Binc's ShotPipe packs, so the push needs
# Binc's named yes (registry name, account; policy/agent-permissions.md) and a prior
# `docker login <registry>`. The pushed reference is what the dashboard's
# Configuration (Image) and `./start.sh package --image` take.
#
#   ./build.sh                       # comfy-app:contract-v26 with the ShotPipe set the corrosion graphs need
#   ./build.sh --push ghcr.io/<org>/comfy-app:contract-v26   # build, tag, push; prints the reference to configure
#   ./build.sh --remote [--wait]     # build and push on GitLab CI next to the registry: nothing big leaves this Mac
#   ./build.sh --shotpipe v26,v14,v7 # explicit versions instead of a set from shared/nodes/sets.json
#   ./build.sh --tag comfy-app:test
#   ./build.sh --no-shotpipe         # BincStereo only
#   ./build.sh --base pytorch/pytorch:2.12.1-cuda13.0-cudnn9-runtime   # e.g. for Blackwell GPUs
#
# Node packs come from shared/nodes (the comfy-node-packs submodule); ShotPipe is
# client's (projects/desktop/CANALV2/02_SCRIPTS/nodes/, not in git), so it is
# staged into .build/custom_nodes/ (ignored) when asked for. Builds linux/amd64,
# which is what RunPod and the Windows/Linux boxes run; on Apple Silicon that
# goes through emulation and is slow but works.
#
# --remote: the build context (under 2 MB: Dockerfile, requirements, docker/, workflows/
# and the staged packs) is pushed as a branch of the GitLab project that holds the
# registry, with a .gitlab-ci.yml that builds natively on amd64 and pushes into that
# project's registry over the datacenter's link. The 3 GB torch layer never leaves this
# Mac. Needs a GitLab token with api scope: GITLAB_TOKEN (env or the repo's .env), else
# the one `docker login registry.gitlab.com` stored. Project: COMFY_CI_PROJECT (default
# bcdevlucas/comfy-workflow). --wait follows the pipeline and prints the reference.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/pins.env"

SHOTPIPE="contract-v26"
TAG=""
BASE=""
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
    --platform) PLATFORM="$2"; shift 2 ;;
    --push) PUSH="$2"; shift 2 ;;
    --remote) REMOTE=1; shift ;;
    --wait) WAIT=1; shift ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$TAG" ] || TAG="comfy-app:${SHOTPIPE:-base}"
if [ -n "$PUSH" ]; then
  case "$PUSH" in */*) ;; *) echo "--push needs a registry reference with a namespace, e.g. ghcr.io/<org>/comfy-app:$SHOTPIPE (a pod cannot pull a bare name)" >&2; exit 2 ;; esac
  case "$PUSH" in *:*) ;; *) PUSH="$PUSH:${SHOTPIPE:-base}" ;; esac
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

if [ -n "$REMOTE" ]; then
  # ----- build on GitLab CI: push the context as a branch, the runner builds and pushes -----
  [ -f "$REPO/.env" ] && GITLAB_TOKEN="${GITLAB_TOKEN:-$(sed -n 's/^GITLAB_TOKEN=//p' "$REPO/.env" | tr -d '"' | head -1)}"
  if [ -z "${GITLAB_TOKEN:-}" ] && command -v docker-credential-desktop >/dev/null; then
    GITLAB_TOKEN="$(echo registry.gitlab.com | docker-credential-desktop get 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("Secret",""))' 2>/dev/null || true)"
  fi
  [ -n "${GITLAB_TOKEN:-}" ] || { echo "--remote needs GITLAB_TOKEN (api scope) in the environment or $REPO/.env, or a docker login to registry.gitlab.com" >&2; exit 1; }
  IMAGE_TAG="${TAG##*:}"; [ "$IMAGE_TAG" != "$TAG" ] || IMAGE_TAG="${SHOTPIPE:-base}"
  CTX="$(mktemp -d "${TMPDIR:-/tmp}/comfy-app-ci.XXXXXX")"
  mkdir -p "$CTX/docker" "$CTX/workflows" "$CTX/.build"
  cp "$HERE/Dockerfile" "$HERE/requirements-packs.txt" "$HERE/.dockerignore" "$CTX/"
  cp -R "$HERE/docker/." "$CTX/docker/"; cp -R "$HERE/workflows/." "$CTX/workflows/"; cp -R "$HERE/.build/." "$CTX/.build/"
  find "$CTX" -name __pycache__ -type d -prune -exec rm -rf {} +
  cat > "$CTX/.gitlab-ci.yml" <<YML
# Generated by apps/comfy-app/build.sh --remote. Builds the ComfyUI server image on a
# shared runner (amd64, next to the registry) and pushes it into this project's registry.
build:
  image: docker:27
  services: [docker:27-dind]
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
    IMAGE: "\$CI_REGISTRY_IMAGE/comfy-app:$IMAGE_TAG"
  script:
    - docker login -u "\$CI_REGISTRY_USER" -p "\$CI_REGISTRY_PASSWORD" "\$CI_REGISTRY"
    - docker pull "\$IMAGE" || true
    - docker build --platform $PLATFORM -t "\$IMAGE" --cache-from "\$IMAGE"
        --label "dev.bluecollar.comfy-node-packs=$PACKS_REV" --label "dev.bluecollar.shotpipe=${SHOTPIPE:-none}"
        --build-arg "COMFYUI_REPO=$COMFYUI_REPO" --build-arg "COMFYUI_REF=$COMFYUI_REF" ${BASE:+--build-arg "BASE_IMAGE=$BASE"} .
    - docker push "\$IMAGE"
    - echo "pushed \$IMAGE"
YML
  BRANCH="build/$IMAGE_TAG"
  ( cd "$CTX" && git init -q -b "$BRANCH" && git add -A && git -c user.name=comfy-app -c user.email=build@comfy-app commit -q -m "build context for comfy-app:$IMAGE_TAG (packs $PACKS_REV, ComfyUI $COMFYUI_REF)" \
    && git push -q --force "https://oauth2:$GITLAB_TOKEN@gitlab.com/$CI_PROJECT.git" "HEAD:refs/heads/$BRANCH" )
  rm -rf "$CTX"
  ENC="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$CI_PROJECT")"
  REF="registry.gitlab.com/$CI_PROJECT/comfy-app:$IMAGE_TAG"
  echo "pushed the build context to gitlab.com/$CI_PROJECT branch $BRANCH; CI builds and pushes $REF"
  echo "pipelines: https://gitlab.com/$CI_PROJECT/-/pipelines"
  [ -n "$WAIT" ] || exit 0
  sleep 5
  PIPE=""
  for _ in $(seq 1 12); do
    PIPE="$(curl -fsS --max-time 20 -H "PRIVATE-TOKEN: $GITLAB_TOKEN" "https://gitlab.com/api/v4/projects/$ENC/pipelines?ref=$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$BRANCH")&per_page=1" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d[0]["id"] if d else "")')"
    [ -n "$PIPE" ] && break; sleep 5
  done
  [ -n "$PIPE" ] || { echo "no pipeline started for $BRANCH: are shared runners enabled for the project?" >&2; exit 1; }
  echo "pipeline $PIPE: https://gitlab.com/$CI_PROJECT/-/pipelines/$PIPE"
  while :; do
    ST="$(curl -fsS --max-time 20 -H "PRIVATE-TOKEN: $GITLAB_TOKEN" "https://gitlab.com/api/v4/projects/$ENC/pipelines/$PIPE" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')"
    case "$ST" in
      success) echo "pushed $REF"; echo "next: enter $REF as the image in the dashboard's Default Configuration, or ./start.sh package mac --comfy ${SHOTPIPE:-base} --image $REF"; exit 0 ;;
      failed|canceled|skipped) echo "pipeline $ST: https://gitlab.com/$CI_PROJECT/-/pipelines/$PIPE" >&2; exit 1 ;;
      *) printf '  %s %s\n' "$(date +%H:%M:%S)" "$ST"; sleep 30 ;;
    esac
  done
fi

args=(build --platform "$PLATFORM" -t "$TAG" -f "$HERE/Dockerfile"
      --label "dev.bluecollar.comfy-node-packs=$PACKS_REV" --label "dev.bluecollar.shotpipe=${SHOTPIPE:-none}"
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
