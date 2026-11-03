#!/usr/bin/env bash
# Start ComfyUI inside the container. Mirrors ../launch.sh for the Mac.
#
#   COMFY_SHARED  root of the shared input/output/models/workflows tree (default /workspace/comfy-shared)
#   COMFY_PORT    default 8188
#   COMFY_ARGS    extra arguments for main.py, e.g. "--highvram"
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
# S3_PULL: "bucket/prefix=/workspace/dir;...". Destinations must be under /workspace, the network volume,
# so the bytes stay after the pod is deleted. Each pair is copied down with rclone, additive (copy never
# deletes), in the background so ComfyUI is up while the bytes arrive. Credentials come from the pod's
# environment, a read-only key (RunPod secrets: {{ RUNPOD_SECRET_name }}); nothing is written to the image.
# Progress and errors go to the container log, and each pair leaves <dir>/.s3-pull.done when it finishes clean.
if [ -n "${S3_PULL:-}" ]; then
  if ! command -v rclone >/dev/null; then echo "S3_PULL set but rclone is not in this image" >&2
  elif [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then echo "S3_PULL set but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not" >&2
  else
    export RCLONE_CONFIG_PODS3_TYPE=s3 RCLONE_CONFIG_PODS3_PROVIDER="${S3_PROVIDER:-AWS}" \
      RCLONE_CONFIG_PODS3_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" RCLONE_CONFIG_PODS3_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
      RCLONE_CONFIG_PODS3_REGION="${AWS_REGION:-us-west-2}"
    [ -n "${S3_ENDPOINT:-}" ] && export RCLONE_CONFIG_PODS3_ENDPOINT="$S3_ENDPOINT"
    (
      IFS=';' read -ra PULLS <<< "$S3_PULL"
      for pair in "${PULLS[@]}"; do
        [ -n "$pair" ] || continue
        src="${pair%%=*}"; dst="${pair#*=}"
        case "$dst" in
          /workspace/*) ;;
          *) echo "s3 pull refused: $dst is not under /workspace (the network volume); it would fill the container disk" >&2; continue ;;
        esac
        mountpoint -q /workspace 2>/dev/null || echo "note: /workspace is not a mount here; the pull goes to the container disk, not a volume" >&2
        mkdir -p "$dst" && echo "s3 pull: $src -> $dst"
        if rclone copy "PODS3:$src" "$dst" --transfers 8 --checksum --stats 30s --stats-one-line -v; then
          # A delivery round carries MANIFEST.json files: check every listed file (size and sha256) before saying it is done (ADR-022). Markers, in <dst>:
          #   .s3-pull.done        copied, and the manifest check passed
          #   .s3-pull.failed      copied, but the manifest check found a mismatch (the list is in the file and the log)
          #   .s3-pull.unverified  copied, but there is no MANIFEST.json to check against
          rm -f "$dst/.s3-pull.done" "$dst/.s3-pull.failed" "$dst/.s3-pull.unverified"
          if [ -f "$dst/MANIFEST.json" ]; then
            PY="$(command -v python3 || command -v python)"
            if "$PY" /opt/comfy-app/verify_round.py "$dst" > "$dst/.s3-pull.check" 2>&1; then
              mv "$dst/.s3-pull.check" "$dst/.s3-pull.done" && echo "s3 pull done (manifest verified): $dst"
            else
              mv "$dst/.s3-pull.check" "$dst/.s3-pull.failed"; echo "s3 pull FAILED the manifest check: $dst" >&2; tail -n 5 "$dst/.s3-pull.failed" >&2
            fi
          else
            echo "no MANIFEST.json" > "$dst/.s3-pull.unverified"; echo "s3 pull done, NOT verified (no MANIFEST.json): $dst"
          fi
        else
          echo "s3 pull FAILED: $src (exit $?); rerun the container or run rclone by hand" >&2
        fi
      done
    ) &
  fi
fi
TREE="${PROJECT_ROOT:-/workspace/project}"
[ -e "$TREE" ] || echo "note: $TREE is not present; corrosion graphs will not find the project tree" >&2
cd /opt/ComfyUI
# shellcheck disable=SC2086
exec python main.py --listen 0.0.0.0 --port "$PORT" \
  --input-directory "$SHARED/input" \
  --output-directory "$SHARED/output" \
  --extra-model-paths-config /opt/comfy-app/extra_model_paths.yaml \
  ${COMFY_ARGS:-} "$@"
