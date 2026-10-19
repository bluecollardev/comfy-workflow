#!/usr/bin/env bash
# Start the local ComfyUI server.
#
#   ./launch.sh                 # foreground, http://127.0.0.1:8188
#   ./launch.sh --background    # detached; logs in logs/comfyui.log
#   ./launch.sh -- --port 8189  # anything after -- goes to ComfyUI main.py
#
# input/ and output/ default to projects/desktop/ComfyUI-Shared (the folders
# shared with binc-PC); models come from the install's own models/ plus
# extra_model_paths.yaml. Override with COMFY_INPUT / COMFY_OUTPUT / COMFY_PORT.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
INSTALL="${COMFY_INSTALL:-$HERE}"
APP="$INSTALL/ComfyUI"
PY="$APP/.venv/bin/python"
SHARED="${COMFY_SHARED:-$REPO/projects/desktop/ComfyUI-Shared}"
INPUT="${COMFY_INPUT:-$SHARED/input}"
OUTPUT="${COMFY_OUTPUT:-$SHARED/output}"
PORT="${COMFY_PORT:-8188}"
LOG="$INSTALL/logs/comfyui.log"

[ -x "$PY" ] || { echo "venv missing or broken; run $HERE/setup.sh first" >&2; exit 1; }

BACKGROUND=0
if [ "${1:-}" = "--background" ]; then BACKGROUND=1; shift; fi
[ "${1:-}" = "--" ] && shift

args=(main.py --listen 127.0.0.1 --port "$PORT"
      --extra-model-paths-config "$HERE/extra_model_paths.yaml")
[ -d "$INPUT" ]  && args+=(--input-directory "$INPUT")
[ -d "$OUTPUT" ] && args+=(--output-directory "$OUTPUT")
args+=("$@")

# The ShotPipe packs read their default paths from these (bh_paths.py in each pack); on the
# Mac the project tree is the mirror and there are no plates.
export CANALV2_ROOT="${CANALV2_ROOT:-$REPO/projects/desktop/CANALV2}"
export COMFY_SHARED="${COMFY_SHARED:-$SHARED}"
cd "$APP"
mkdir -p "$INSTALL/logs"
if [ "$BACKGROUND" = 1 ]; then
  nohup "$PY" "${args[@]}" >"$LOG" 2>&1 &
  echo $! > "$INSTALL/logs/comfyui.pid"
  echo "started pid $(cat "$INSTALL/logs/comfyui.pid"); log $LOG; http://127.0.0.1:$PORT"
else
  exec "$PY" "${args[@]}"
fi
