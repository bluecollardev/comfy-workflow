#!/usr/bin/env bash
# Start ComfyUI inside the container. Mirrors ../launch.sh for the Mac.
#
#   COMFY_SHARED  root of the shared input/output/models tree (default /workspace/ComfyUI-Shared)
#   COMFY_PORT    default 8188
#   COMFY_ARGS    extra arguments for main.py, e.g. "--highvram"
# Anything passed to the container after the image name is appended too.
set -euo pipefail
SHARED="${COMFY_SHARED:-/workspace/ComfyUI-Shared}"
PORT="${COMFY_PORT:-8188}"
mkdir -p "$SHARED/input" "$SHARED/output" "$SHARED/models"
# ComfyUI-Shared/models mirrors the Mac layout; make sure the folders exist so
# extra_model_paths.yaml points at something.
for d in checkpoints clip clip_vision controlnet diffusion_models embeddings loras upscale_models vae; do
  mkdir -p "$SHARED/models/$d"
done
cd /opt/ComfyUI
# shellcheck disable=SC2086
exec python main.py --listen 0.0.0.0 --port "$PORT" \
  --input-directory "$SHARED/input" \
  --output-directory "$SHARED/output" \
  --extra-model-paths-config /opt/comfy-app/extra_model_paths.yaml \
  ${COMFY_ARGS:-} "$@"
