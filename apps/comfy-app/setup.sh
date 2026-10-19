#!/usr/bin/env bash
# Make apps/comfy-app runnable on this machine. Idempotent; re-run after a pull.
#
#   ./setup.sh                  # clone ComfyUI at the pinned commit, build the venv, link our packs
#   COMFY_SHOTPIPE=contract-v26 ./setup.sh   # link the ShotPipe set the corrosion graphs need (a set from
#                                         # shared/nodes/sets.json, or versions: v26 also brings what its
#                                         # pyproject.toml [tool.packs] requires, here v14 and v7)
#
# What ends up where (ComfyUI/ is ignored by git; everything else is tracked):
#   ComfyUI/                       upstream clone at pins.env COMFYUI_REF, unmodified
#   ComfyUI/.venv                  uv venv on Python 3.13 (uses standalone-env/ when present)
#   ComfyUI/custom_nodes/<pack>    symlink -> shared/nodes/{portable,bound}/<pack> (the comfy-node-packs submodule)
#   ComfyUI/user/default/workflows symlink -> workflows/
#   ComfyUI/models/                weights, see fetch-models.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck disable=SC1091
source "$HERE/pins.env"
APP="$HERE/ComfyUI"
VENV="$APP/.venv"
command -v uv >/dev/null || { echo "uv is required: brew install uv  (or pipx install uv)" >&2; exit 1; }
command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

# 1. ComfyUI core at the pinned commit.
if [ ! -d "$APP/.git" ]; then
  echo "cloning ComfyUI -> $APP"
  git clone --filter=blob:none "$COMFYUI_REPO" "$APP"
fi
if [ "$(git -C "$APP" rev-parse HEAD)" != "$COMFYUI_REF" ]; then
  git -C "$APP" fetch -q origin
  git -C "$APP" checkout -q --detach "$COMFYUI_REF"
fi
git -C "$APP" config core.fileMode false
echo "ComfyUI at $(git -C "$APP" rev-parse --short HEAD) ($(git -C "$APP" describe --tags 2>/dev/null || echo untagged))"

# 2. Python venv. Prefer the bundled standalone Python when it is there; otherwise
#    uv fetches a python-build-standalone of the pinned version itself.
if [ -x "$HERE/standalone-env/bin/python3" ]; then PY_FOR_VENV="$HERE/standalone-env/bin/python3"; else PY_FOR_VENV="$PYTHON_VERSION"; fi
if [ -d "$VENV" ] && ! "$VENV/bin/python" -c "import sys" >/dev/null 2>&1; then
  echo "existing .venv is broken (built on another machine); recreating"
  rm -rf "$VENV"
fi
[ -d "$VENV" ] || uv venv --python "$PY_FOR_VENV" "$VENV"
export VIRTUAL_ENV="$VENV"

# 3. torch per platform, then ComfyUI, Manager and the packs' extra deps.
case "$(uname -s)" in
  Darwin) TORCH_REQ="$HERE/requirements-mac.txt" ;;
  *)      TORCH_REQ="$HERE/requirements-cuda.txt" ;;
esac
uv pip install -q -r "$TORCH_REQ"
uv pip install -q -r "$APP/requirements.txt"
[ -f "$APP/manager_requirements.txt" ] && uv pip install -q -r "$APP/manager_requirements.txt"
uv pip install -q -r "$HERE/requirements-packs.txt"

# 4. Our node packs: symlinked, so edits in the repo are live in the server.
NODES="${COMFY_NODES_DIR:-$REPO/shared/nodes}"
if [ ! -f "$NODES/README.md" ]; then
  echo "fetching the node packs submodule (shared/nodes)"
  git -C "$REPO" submodule update --init --depth 1 shared/nodes
fi
# Packs sit in portable/ (no binc-PC paths in them) or bound/ (CANALV2 paths as
# defaults); see shared/nodes/docs/PORTABILITY.md. A pack is found in either.
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
# Every pack that is not a ShotPipe version (BincStereo today) is always linked.
for dir in "$NODES"/portable/*/ "$NODES"/bound/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  case "$name" in ComfyUI-BH-ShotPipe-*) continue ;; esac
  ln -sfn "$dir" "$APP/custom_nodes/$name"
  [ -f "$dir/requirements.txt" ] && uv pip install -q -r "$dir/requirements.txt"
  echo "linked custom_nodes/$name"
done
# ShotPipe only on request, and only the versions named: unprefixed BH_* node
# names repeat across versions and ComfyUI keeps the last one loaded.
for old in "$APP"/custom_nodes/ComfyUI-BH-ShotPipe-*; do [ -L "$old" ] && rm "$old"; done
if [ -n "${COMFY_SHOTPIPE:-}" ]; then
  IFS=, read -ra REQUESTED <<< "$COMFY_SHOTPIPE"
  VERSIONS=(); for r in "${REQUESTED[@]}"; do for v in $(expand_set "$r"); do VERSIONS+=("$v"); done; done
  VERSIONS=($(resolve_requires "${VERSIONS[@]}"))   # v26 alone pulls in v14 and v7
  for v in "${VERSIONS[@]}"; do
    src="$(pack_dir "ComfyUI-BH-ShotPipe-$v")" || { echo "no ShotPipe $v in $NODES/portable or bound" >&2; exit 1; }
    ln -sfn "$src" "$APP/custom_nodes/ComfyUI-BH-ShotPipe-$v"
    echo "linked custom_nodes/ComfyUI-BH-ShotPipe-$v"
  done
fi

# 6. Workflows: the UI saves into the repo's workflows/ folder.
mkdir -p "$APP/user/default"
wf="$APP/user/default/workflows"
if [ -d "$wf" ] && [ ! -L "$wf" ]; then
  # keep anything saved before the link existed
  cp -n "$wf"/* "$HERE/workflows/" 2>/dev/null || true
  rm -rf "$wf"
fi
ln -sfn "../../../workflows" "$wf"
echo "linked user/default/workflows -> workflows/"

# 7. Sanity check and model hint.
"$VENV/bin/python" - <<'PY'
import torch
dev = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
print(f"torch {torch.__version__}, device {dev}")
PY
missing=0
while read -r folder repo; do
  case "$folder" in ''|'#'*) continue ;; esac
  [ -d "$APP/models/$folder/$(basename "$repo")" ] || { missing=1; echo "model missing: models/$folder/$(basename "$repo")"; }
done < "$HERE/models.txt"
[ "$missing" = 1 ] && echo "run ./fetch-models.sh to download the weights in models.txt"
echo "ok. start with ./launch.sh"
