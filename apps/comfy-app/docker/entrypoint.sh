#!/usr/bin/env bash
# Start ComfyUI inside the container. Mirrors ../launch.sh for the Mac.
#
#   COMFY_SHARED  root of the shared input/output/models tree (default /workspace/ComfyUI-Shared)
#   COMFY_PORT    default 8188
#   COMFY_ARGS    extra arguments for main.py, e.g. "--highvram"
#   COMFY_LINKS   "path=target;..." symlinks to make binc-PC paths resolve on the volume (see below)
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
# COMFY_LINKS: "path=target;path=target". The graphs, scripts and older packs name binc-PC's
# paths; the data sits on the volume. Each pair becomes a symlink so those paths resolve
# (docs/MOUNT-POINTS.md; the pod manager builds the list from its mount configuration).
if [ -n "${COMFY_LINKS:-}" ]; then
  IFS=';' read -ra PAIRS <<< "$COMFY_LINKS"
  for pair in "${PAIRS[@]}"; do
    [ -n "$pair" ] || continue
    from="${pair%%=*}"; to="${pair#*=}"
    if [ ! -e "$to" ]; then echo "COMFY_LINKS: target missing, not linked: $from -> $to" >&2; continue; fi
    if [ -e "$from" ] && [ ! -L "$from" ]; then echo "COMFY_LINKS: $from exists and is not a link, left alone" >&2; continue; fi
    mkdir -p "$(dirname "$from")" && ln -sfn "$to" "$from" && echo "linked $from -> $to"
  done
fi
[ -e /workspace/CANALV2 ] || echo "note: /workspace/CANALV2 is not present; corrosion graphs will not find the project tree" >&2
cd /opt/ComfyUI
# shellcheck disable=SC2086
exec python main.py --listen 0.0.0.0 --port "$PORT" \
  --input-directory "$SHARED/input" \
  --output-directory "$SHARED/output" \
  --extra-model-paths-config /opt/comfy-app/extra_model_paths.yaml \
  ${COMFY_ARGS:-} "$@"
