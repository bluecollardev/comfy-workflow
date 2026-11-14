#!/usr/bin/env bash
# round-nodes.sh: make the custom node packs a delivery round ships with its shots loadable by ComfyUI (ADR-040).
#
# A shot pack can carry `<round>/<shot>/nodes/<pack>/`. The image has its own packs baked in at build time (/opt/ComfyUI/custom_nodes), and
# ComfyUI loads only that folder, so a bundled pack on the volume does nothing by itself. This links each one in, BEFORE ComfyUI starts
# (the entrypoint runs it first), so a pod that starts after the pull needs no restart.
#
#   ROUND_NODES_ROOT   where the rounds are        (default /workspace/comfy-shared/temp/rounds)
#   CUSTOM_NODES       ComfyUI's custom_nodes      (default /opt/ComfyUI/custom_nodes)
#   PIP                the pip command             (default "pip install -q")
#
# For each pack: the same bytes as one already in the image (or already linked from another shot) is skipped; a new one is linked in under its
# own name (with a short hash when that name is taken) and its requirements.txt is installed. Nothing is written into the round, a failed
# install is a warning (the pack then fails to load, as before), and the script never stops the pod's start. Run it again over SSH on a pod
# that is already up: it says "restart ComfyUI" when it linked something, since ComfyUI reads custom_nodes only at start.
set -uo pipefail
ROOT="${ROUND_NODES_ROOT:-/workspace/comfy-shared/temp/rounds}"
DEST="${CUSTOM_NODES:-/opt/ComfyUI/custom_nodes}"
PIP="${PIP:-pip install -q}"
[ -d "$ROOT" ] || { echo "round-nodes: no rounds at $ROOT, nothing to do"; exit 0; }
mkdir -p "$DEST"
if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
# The same pack is the same bytes: hash the files by relative path, leaving out caches and a key file.
hash_of() { ( cd "$1" && find . -type f ! -path '*/__pycache__/*' ! -name '*.pyc' ! -name config.ini ! -name .DS_Store -print0 | sort -z | xargs -0 -r "${SHA[@]}" | "${SHA[@]}" | cut -c1-16 ); }
declare -A known=()   # hash -> where it is
for d in "$DEST"/*/; do [ -d "$d" ] && known[$(hash_of "$d")]="$(basename "$d") (the image)"; done
linked=0
for pack in "$ROOT"/*/*/nodes/*/; do
  [ -d "$pack" ] || continue
  pack="${pack%/}"; shot="$(basename "$(dirname "$(dirname "$pack")")")"; round="$(basename "$(dirname "$(dirname "$(dirname "$pack")")")")"
  h="$(hash_of "$pack")"; name="$(basename "$pack")"
  if [ -n "${known[$h]:-}" ]; then echo "round-nodes: $round/$shot $name: same as ${known[$h]}, skipped"; continue; fi
  [ -e "$DEST/$name" ] && name="$name-$h"
  ln -sfn "$pack" "$DEST/$name" && known[$h]="$name (from $round/$shot)" && linked=$((linked + 1)) && echo "round-nodes: $round/$shot: linked $name"
  req="$pack/requirements.txt"
  if [ -f "$req" ]; then   # plain opencv-python becomes the headless build the image has, as in the Dockerfile
    tmp="$(mktemp)"; sed -E 's/^opencv-python([<>=!~].*)?$/opencv-python-headless\1/' "$req" > "$tmp"
    $PIP -r "$tmp" || echo "round-nodes: WARNING: installing the requirements of $name failed; the pack may not load" >&2
    rm -f "$tmp"
  fi
done
[ "$linked" -eq 0 ] && echo "round-nodes: nothing new to link" || echo "round-nodes: $linked pack(s) linked; ComfyUI reads them at start (restart it if it is already running)"
exit 0
