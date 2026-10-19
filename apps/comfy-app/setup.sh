#!/usr/bin/env bash
# Make apps/comfy-app runnable on this machine. Idempotent; re-run after a pull.
#
#   ./setup.sh                  # clone ComfyUI at the pinned commit, build the venv, link our packs
#   COMFY_SHOTPIPE=v26 ./setup.sh   # also link that ShotPipe version from projects/desktop/CANALV2
#
# What ends up where (ComfyUI/ is ignored by git; everything else is tracked):
#   ComfyUI/                       upstream clone at pins.env COMFYUI_REF, unmodified
#   ComfyUI/.venv                  uv venv on Python 3.13 (uses standalone-env/ when present)
#   ComfyUI/custom_nodes/<pack>    symlink -> custom_nodes/<pack>
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
for dir in "$HERE"/custom_nodes/*/; do
  name="$(basename "$dir")"
  ln -sfn "../../custom_nodes/$name" "$APP/custom_nodes/$name"
  [ -f "$dir/requirements.txt" ] && uv pip install -q -r "$dir/requirements.txt"
  echo "linked custom_nodes/$name"
done

# 5. Optional: a ShotPipe version from the CANALV2 tree (client project, not in git).
if [ -n "${COMFY_SHOTPIPE:-}" ]; then
  src="${COMFY_SHOTPIPE_DIR:-$REPO/projects/desktop/CANALV2/02_SCRIPTS/nodes}/ComfyUI-BH-ShotPipe-$COMFY_SHOTPIPE"
  [ -d "$src" ] || { echo "no ShotPipe at $src" >&2; exit 1; }
  ln -sfn "$src" "$APP/custom_nodes/ComfyUI-BH-ShotPipe-$COMFY_SHOTPIPE"
  echo "linked custom_nodes/ComfyUI-BH-ShotPipe-$COMFY_SHOTPIPE -> $src"
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
