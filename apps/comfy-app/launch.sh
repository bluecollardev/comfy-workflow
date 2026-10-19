#!/usr/bin/env bash
# Start the local ComfyUI server.
#
#   ./launch.sh                 # foreground, http://127.0.0.1:8188
#   ./launch.sh --background    # detached; logs in logs/comfyui.log
#   ./launch.sh -- --port 8189  # anything after -- goes to ComfyUI main.py
#
# The three folders come from mounts-env.sh: the environment, else the mapping saved by the
# dashboard's Configuration panel, else the defaults there. ComfyUI gets COMFY_SHARED's input/
# and output/ as its input and output directories and COMFY_SHARED/models through a model paths
# file written here at every start (ComfyUI/extra_model_paths.local.yaml), so models live with
# input and output, the same layout as binc-PC and the pod. Override COMFY_INPUT / COMFY_OUTPUT /
# COMFY_PORT if needed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL="${COMFY_INSTALL:-$HERE}"
APP="$INSTALL/ComfyUI"
PY="$APP/.venv/bin/python"
PORT="${COMFY_PORT:-8188}"
LOG="$INSTALL/logs/comfyui.log"

[ -x "$PY" ] || { echo "venv missing or broken; run $HERE/setup.sh first" >&2; exit 1; }
. "$HERE/mounts-env.sh"
INPUT="${COMFY_INPUT:-$COMFY_SHARED/input}"
OUTPUT="${COMFY_OUTPUT:-$COMFY_SHARED/output}"

BACKGROUND=0
if [ "${1:-}" = "--background" ]; then BACKGROUND=1; shift; fi
[ "${1:-}" = "--" ] && shift

# Model folders: ComfyUI only learns them from a paths file, so write one for the mapped folder.
MODEL_PATHS="$APP/extra_model_paths.local.yaml"
{
  echo "# Written by launch.sh at every start from the ComfyUI-Shared mapping; do not edit."
  echo "shared:"
  echo "  base_path: $COMFY_SHARED/models"
  for d in checkpoints clip clip_vision controlnet diffusion_models embeddings loras upscale_models vae depth_anything; do
    echo "  $d: $d"
  done
} > "$MODEL_PATHS"

args=(main.py --listen 127.0.0.1 --port "$PORT" --extra-model-paths-config "$MODEL_PATHS"
      --input-directory "$INPUT" --output-directory "$OUTPUT")
args+=("$@")

echo "project $PROJECT_ROOT"
echo "plates  ${PLATES_ROOT:-none}"
echo "shared  $COMFY_SHARED (input, output, models)"
cd "$APP"
mkdir -p "$INSTALL/logs"
if [ "$BACKGROUND" = 1 ]; then
  nohup "$PY" "${args[@]}" >"$LOG" 2>&1 &
  echo $! > "$INSTALL/logs/comfyui.pid"
  echo "started pid $(cat "$INSTALL/logs/comfyui.pid"); log $LOG; http://127.0.0.1:$PORT"
else
  exec "$PY" "${args[@]}"
fi
