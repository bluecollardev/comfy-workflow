#!/usr/bin/env bash
# Start ComfyUI inside the container. Mirrors ../launch.sh for the Mac.
#
#   COMFY_SHARED  root of the shared input/output/models/workflows tree (default /workspace/comfy-shared)
#   COMFY_PORT    default 8188
#   COMFY_ARGS    extra arguments for main.py, e.g. "--highvram"
#   COMFY_MODE    worker | ui | both (default both): worker = the queue the pod manager drives, on COMFY_PORT, --cache-none;
#                 ui = a second ComfyUI on COMFY_UI_PORT (default 8189) for watching and editing during the run (ssh -L 8189:localhost:8189)
#   Every instance starts with the same head flags: --base-directory /opt/ComfyUI (the frozen tree: custom_nodes and
#   models baked at build), --offline (no frontend, registry or partner-node network), no Manager (--enable-manager never passed).
#   COMFY_LINKS   "path=target;..." symlinks to make binc-PC paths resolve on the volume (see below)
#   S3_PULL       "bucket/prefix=/local/dir;..." pulled from S3 at start, in the background (see below)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_ENDPOINT   credentials for S3_PULL (endpoint only for non-AWS)
# Anything passed to the container after the image name is appended too.
set -euo pipefail
SHARED="${COMFY_SHARED:-/workspace/comfy-shared}"
PORT="${COMFY_PORT:-8188}"
mkdir -p "$SHARED/input" "$SHARED/output" "$SHARED/models"
# ComfyUI-Shared/models mirrors the Mac layout; make sure the folders exist so
# extra_model_paths.yaml points at something.
for d in checkpoints clip clip_vision controlnet diffusion_models embeddings loras upscale_models vae; do
  mkdir -p "$SHARED/models/$d"
done
# Workflows live on the mount, so they change without a rebuild and survive the pod. The
# image carries the repo's workflows/ as a seed and copies it in only while the mount is empty;
# ComfyUI's Workflows panel reads the mount through the link.
mkdir -p "$SHARED/workflows" /opt/ComfyUI/user/default
if [ -z "$(ls -A "$SHARED/workflows" 2>/dev/null)" ] && [ -d /opt/comfy-app/workflows ]; then
  cp -R /opt/comfy-app/workflows/. "$SHARED/workflows/" && echo "seeded $SHARED/workflows from the image"
fi
rm -rf /opt/ComfyUI/user/default/workflows
ln -sfn "$SHARED/workflows" /opt/ComfyUI/user/default/workflows
echo "workflows $SHARED/workflows ($(find "$SHARED/workflows" -name '*.json' | wc -l | tr -d ' ') graphs)"
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
# SSH for the sync (and a shell): RunPod passes the account's key as PUBLIC_KEY and maps 22/tcp.
if [ -n "${PUBLIC_KEY:-}" ] && command -v sshd >/dev/null; then
  mkdir -p /root/.ssh /run/sshd && chmod 700 /root/.ssh
  printf '%s\n' "$PUBLIC_KEY" > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
  ssh-keygen -A >/dev/null 2>&1 || true
  /usr/sbin/sshd -o PermitRootLogin=yes -o PasswordAuthentication=no && echo "sshd on 22 (for ./start.sh sync)"
fi
# S3_PULL: pull bucket prefixes onto the volume at start, in the background so ComfyUI is up while the bytes arrive. The work is docker/s3pull.sh
# (/opt/comfy-app/s3pull.sh): what the variables are, the markers it leaves, and that it is also run over SSH on a pod that is already up (ADR-022).
if [ -n "${S3_PULL:-}" ]; then
  /opt/comfy-app/s3pull.sh &
fi
TREE="${PROJECT_ROOT:-/workspace/project}"
[ -e "$TREE" ] || echo "note: $TREE is not present; graphs will not find the project tree" >&2
cd /opt/ComfyUI
export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
MODE="${COMFY_MODE:-both}"
# --headless and --dont-up-weights are our own launch tags, not ComfyUI flags (its parser exits on them): accepted
# here and dropped, so a launch line or COMFY_ARGS that carries them still starts.
keep=(); for a in "$@"; do case "$a" in --headless|--dont-up-weights) ;; *) keep+=("$a") ;; esac; done; set -- "${keep[@]+"${keep[@]}"}"
ca=""; for a in ${COMFY_ARGS:-}; do case "$a" in --headless|--dont-up-weights) ;; *) ca="$ca $a" ;; esac; done; COMFY_ARGS="${ca# }"
UI_PORT="${COMFY_UI_PORT:-8189}"
# The head flag first: ComfyUI builds custom_nodes, models and user from the frozen tree and nothing else.
HEAD=(--base-directory /opt/ComfyUI --offline --disable-auto-launch)
IO=(--input-directory "$SHARED/input" --output-directory "$SHARED/output" --extra-model-paths-config /opt/comfy-app/extra_model_paths.yaml)
if [ "$MODE" = ui ] || [ "$MODE" = both ]; then
  mkdir -p /opt/comfy-ui-instance/user /opt/comfy-ui-instance/temp
  # shellcheck disable=SC2086
  python main.py "${HEAD[@]}" --listen 0.0.0.0 --port "$UI_PORT" "${IO[@]}" \
    --user-directory /opt/comfy-ui-instance/user --temp-directory /opt/comfy-ui-instance/temp \
    ${COMFY_ARGS:-} > /var/log/comfy-ui.log 2>&1 &
  echo "ui instance on $UI_PORT (log /var/log/comfy-ui.log)"
fi
if [ "$MODE" = ui ]; then wait; exit $?; fi
# shellcheck disable=SC2086
exec python main.py "${HEAD[@]}" --listen 0.0.0.0 --port "$PORT" "${IO[@]}" --cache-none \
  ${COMFY_ARGS:-} "$@"
