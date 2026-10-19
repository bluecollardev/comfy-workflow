#!/usr/bin/env bash
# Download the weights listed in models.txt into ComfyUI/models/<folder>/<name>.
# Uses huggingface_hub from the venv (installed by ComfyUI's requirements).
# Set HF_TOKEN for gated repos. Re-running skips files already present.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/ComfyUI/.venv/bin/python"
[ -x "$PY" ] || { echo "run ./setup.sh first" >&2; exit 1; }
while read -r folder repo; do
  case "$folder" in ''|'#'*) continue ;; esac
  dest="$HERE/ComfyUI/models/$folder/$(basename "$repo")"
  echo "$repo -> ${dest#$HERE/}"
  "$PY" - "$repo" "$dest" <<'PY'
import sys
from huggingface_hub import snapshot_download
repo, dest = sys.argv[1], sys.argv[2]
snapshot_download(repo_id=repo, local_dir=dest, allow_patterns=["*.json", "*.safetensors", "*.md", "*.txt"])
PY
done < "$HERE/models.txt"
echo "done"
