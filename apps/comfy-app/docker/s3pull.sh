#!/usr/bin/env bash
# s3pull.sh: pull bucket prefixes onto the network volume, then check each against its manifests (ADR-015, ADR-022).
#
#   S3_PULL      "bucket/prefix=/workspace/dir;bucket/prefix2=/workspace/dir2"   what to pull and where
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (default us-west-2)       a read-only key
#   S3_ENDPOINT, S3_PROVIDER (default AWS)                                         only for a non-AWS bucket
#
# Run by the entrypoint in the background at pod start, or by the app over SSH on a pod that is already running. Destinations must be under
# /workspace, the network volume, so the bytes stay after the pod is deleted. Each pair is copied with rclone, additive (copy never deletes),
# checksum-compared, so a rerun transfers only what differs. Nothing is written to the image; the key comes from the environment of this process.
# Exit: 0 every pair copied (a pair that failed its manifest check still counts, see the markers), 1 a copy failed, 64 to 66 bad setup.
#
# A delivery round carries MANIFEST.json files: every listed file is checked (size and sha256, verify_round.py) before the pair is called done.
# One marker is left in <dir>, and the log says which:
#   .s3-pull.done        copied, and the manifest check passed
#   .s3-pull.failed      copied, but the check found a mismatch (the list is in the file and the log)
#   .s3-pull.unverified  copied, but there is no MANIFEST.json to check against
set -uo pipefail
[ -n "${S3_PULL:-}" ] || { echo "s3pull: S3_PULL is empty" >&2; exit 64; }
command -v rclone >/dev/null || { echo "S3_PULL set but rclone is not in this image" >&2; exit 65; }
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then echo "S3_PULL set but AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not" >&2; exit 66; fi
export RCLONE_CONFIG_PODS3_TYPE=s3 RCLONE_CONFIG_PODS3_PROVIDER="${S3_PROVIDER:-AWS}" \
  RCLONE_CONFIG_PODS3_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" RCLONE_CONFIG_PODS3_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  RCLONE_CONFIG_PODS3_REGION="${AWS_REGION:-us-west-2}"
[ -n "${S3_ENDPOINT:-}" ] && export RCLONE_CONFIG_PODS3_ENDPOINT="$S3_ENDPOINT"
status=0
IFS=';' read -ra PULLS <<< "$S3_PULL"
for pair in "${PULLS[@]}"; do
  [ -n "$pair" ] || continue
  src="${pair%%=*}"; dst="${pair#*=}"
  case "$dst" in
    /workspace/*) ;;
    *) echo "s3 pull refused: $dst is not under /workspace (the network volume); it would fill the container disk" >&2; status=1; continue ;;
  esac
  mountpoint -q /workspace 2>/dev/null || echo "note: /workspace is not a mount here; the pull goes to the container disk, not a volume" >&2
  mkdir -p "$dst" && echo "s3 pull: $src -> $dst"
  if rclone copy "PODS3:$src" "$dst" --transfers 8 --checksum --stats 30s --stats-one-line -v; then
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
    echo "s3 pull FAILED: $src (rclone exit $?); run it again, a rerun carries on" >&2; status=1
  fi
done
exit $status
