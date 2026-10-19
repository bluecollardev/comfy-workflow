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
  rsync -a --exclude __pycache__ --exclude superseded --exclude .DS_Store "$d/" "$DST/$(basename "$d")/"
done
echo "copied from $SRC"
if [ -z "$(git -C "$DST" status --short)" ]; then echo "no changes"; else git -C "$DST" status --short | head -20; echo "next: docs/NODE-PACKS.md, 'Releasing'"; fi
