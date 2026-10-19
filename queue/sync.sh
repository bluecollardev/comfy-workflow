#!/usr/bin/env bash
# Seed queue/<project>/in/ from a project's own queue folder. One-way, additive:
# a job already present anywhere in our in/, running/ or done/ is left alone,
# so moves we made survive; nothing is ever deleted here or in the source.
#
#   ./queue/sync.sh                 # canalv2 from the CANALV2 mirror
#   ./queue/sync.sh <name> <dir>    # another project: its queue dir with in/ running/ done/
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAME="${1:-canalv2}"
SRC="${2:-${CANALV2_MIRROR:-$HERE/../projects/desktop/CANALV2}/04_TRACKER/queue}"
DST="$HERE/$NAME"
[ -d "$SRC/in" ] || { echo "no queue at $SRC (expected in/ running/ done/)" >&2; exit 1; }
mkdir -p "$DST/in" "$DST/running" "$DST/done"
touch "$DST/running/.gitkeep" "$DST/done/.gitkeep"

have() { [ -e "$DST/in/$1" ] || [ -e "$DST/running/$1" ] || [ -e "$DST/done/$1" ]; }
new=0; kept=0
for src in "$SRC"/in/*; do
  f="$(basename "$src")"
  if have "$f"; then kept=$((kept+1)); continue; fi
  cp -R "$src" "$DST/in/$f"; new=$((new+1))
done
# jobs the source already moved on: note it, do not move ours
for state in running done; do
  for src in "$SRC"/$state/*; do
    [ -e "$src" ] || continue
    f="$(basename "$src")"
    [ -e "$DST/$state/$f" ] || echo "source has $f in $state/; ours is $(for s in in running done; do [ -e "$DST/$s/$f" ] && echo "$s"; done || echo absent)"
  done
done
{
  echo "# $NAME queue, last sync"
  echo
  echo "From \`$SRC\` on $(date -u +%Y-%m-%dT%H:%MZ): $new new in \`in/\`, $kept already here."
  echo "Source state at that time: in $(ls "$SRC/in" | wc -l | tr -d ' '), running $(ls "$SRC/running" | wc -l | tr -d ' '), done $(ls "$SRC/done" | wc -l | tr -d ' ')."
  echo "Ours now: in $(ls "$DST/in" | wc -l | tr -d ' '), running $(ls -A "$DST/running" | grep -vc .gitkeep), done $(ls -A "$DST/done" | grep -vc .gitkeep)."
} > "$DST/SYNC.md"
echo "$NAME: $new new, $kept kept -> $DST"
