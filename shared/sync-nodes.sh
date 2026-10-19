#!/usr/bin/env bash
# Refresh shared/nodes (the comfy-node-packs submodule) from Binc's mirror.
# Copies every ComfyUI-BH-ShotPipe-v* without superseded/ and caches, never
# deletes a pack, and stops there: review `git -C shared/nodes status`, then
# follow docs/NODE-PACKS.md to release (commit, tag, push, move the pin).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${CANALV2_MIRROR:-$HERE/../projects/desktop/CANALV2}/02_SCRIPTS/nodes"
DST="$HERE/nodes"
[ -d "$SRC" ] || { echo "no mirror at $SRC" >&2; exit 1; }
[ -f "$DST/README.md" ] || { echo "submodule not initialised: git submodule update --init shared/nodes" >&2; exit 1; }
for d in "$SRC"/ComfyUI-BH-ShotPipe-v*; do
  n="$(basename "$d")"
  if [ -d "$DST/portable/$n" ]; then dest="$DST/portable/$n"
  elif [ -d "$DST/bound/$n" ]; then dest="$DST/bound/$n"
  elif grep -rqE '/home/binc|/mnt/storage|~/ComfyUI-Shared' --include='*.py' "$d" 2>/dev/null; then dest="$DST/bound/$n"
  else dest="$DST/portable/$n"; fi
  rsync -a --exclude __pycache__ --exclude superseded --exclude .DS_Store "$d/" "$dest/"
done
echo "copied from $SRC"
python3 "$DST/tools/manifest.py" || echo "a pack sits in the wrong folder; fix before releasing" >&2
if [ -z "$(git -C "$DST" status --short)" ]; then echo "no changes"; else git -C "$DST" status --short | head -20; echo "next: docs/NODE-PACKS.md, 'Releasing'"; fi
