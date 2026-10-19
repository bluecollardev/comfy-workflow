#!/usr/bin/env bash
# Rebuild the ComfyUI venv so the install runs on this Mac.
#
# ComfyUI/ and standalone-env/ are a copy of a ComfyUI standalone built on
# another Mac. standalone-env/ (python-build-standalone 3.13) is relocatable, but
# ComfyUI/.venv was created with absolute paths to the old home directory and
# is broken here. This script recreates .venv on top of standalone-env with the
# same pins (manifest.json / requirements-mac.txt / ComfyUI/requirements.txt).
#
# Idempotent: re-running reinstalls into the same venv.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${COMFY_INSTALL:-$HERE}"
BASE_PY="$INSTALL/standalone-env/bin/python3"
APP="$INSTALL/ComfyUI"
VENV="$APP/.venv"

[ -x "$BASE_PY" ] || { echo "no standalone python at $BASE_PY" >&2; exit 1; }
[ -f "$APP/main.py" ] || { echo "no ComfyUI at $APP" >&2; exit 1; }
command -v uv >/dev/null || { echo "uv is required (brew install uv)" >&2; exit 1; }

echo "base python: $("$BASE_PY" --version) at $BASE_PY"

if [ -d "$VENV" ] && ! "$VENV/bin/python" -c "import sys" >/dev/null 2>&1; then
  echo "existing .venv is broken (points at another machine); recreating"
  rm -rf "$VENV"
fi
if [ ! -d "$VENV" ]; then
  uv venv --python "$BASE_PY" "$VENV"
fi

export VIRTUAL_ENV="$VENV"
# Torch stack first, pinned (MPS build from PyPI).
uv pip install -r "$HERE/requirements-mac.txt"
# ComfyUI's own requirements, then ComfyUI Manager, then custom node packs.
uv pip install -r "$APP/requirements.txt"
[ -f "$APP/manager_requirements.txt" ] && uv pip install -r "$APP/manager_requirements.txt"
for req in "$APP"/custom_nodes/*/requirements.txt; do
  [ -f "$req" ] && uv pip install -r "$req"
done

"$VENV/bin/python" - <<'PY'
import torch, comfy_kitchen  # noqa
print(f"torch {torch.__version__}  mps={torch.backends.mps.is_available()}")
PY
echo "ok: $VENV"
