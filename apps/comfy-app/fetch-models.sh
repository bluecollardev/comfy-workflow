#!/usr/bin/env bash
# Download the weights listed in models.txt into COMFY_SHARED/models/<folder>/<name>, the
# shared models folder every runtime reads (mounts-env.sh resolves it from the dashboard's
# mapping). Weights an earlier run put inside the install (ComfyUI/models) are moved over, not
# downloaded again. Uses huggingface_hub from the venv. Set HF_TOKEN for gated repos.
# Re-running skips files already present.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY="$HERE/ComfyUI/.venv/bin/python"
[ -x "$PY" ] || { echo "run ./setup.sh first" >&2; exit 1; }
. "$HERE/mounts-env.sh"
while read -r folder repo; do
  case "$folder" in ''|'#'*) continue ;; esac
  name="$(basename "$repo")"
  dest="$COMFY_SHARED/models/$folder/$name"
  old="$HERE/ComfyUI/models/$folder/$name"
  if [ -d "$old" ] && [ ! -e "$dest" ]; then
    mkdir -p "$(dirname "$dest")" && mv "$old" "$dest" && echo "moved $old -> $dest"
  fi
  echo "$repo -> $dest"
  "$PY" - "$repo" "$dest" <<'PY'
import sys
from huggingface_hub import snapshot_download
repo, dest = sys.argv[1], sys.argv[2]
snapshot_download(repo_id=repo, local_dir=dest, allow_patterns=["*.json", "*.safetensors", "*.md", "*.txt"])
PY
done < "$HERE/models.txt"
echo "done"
