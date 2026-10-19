#!/usr/bin/env bash
# Copy Binc's rule pages from the CANALV2 mirror into governance/binc/ so agents
# working in this repo can read them without reaching into projects/desktop/.
# One-way: mirror -> here. Never writes into the mirror. Re-run after a sync
# from binc-PC; MANIFEST.md records what came from where and when.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${CANALV2_MIRROR:-$HERE/../projects/desktop/CANALV2}"
DST="$HERE/binc"
[ -d "$SRC/00_POLICY" ] || { echo "no CANALV2 mirror at $SRC" >&2; exit 1; }

rm -rf "$DST" && mkdir -p "$DST/policy" "$DST/governance"
cp "$SRC"/00_POLICY/*.md "$DST/policy/"
cp "$SRC"/01_GOVERNANCE/*.md "$DST/governance/"
cp "$SRC/README.md" "$DST/README.md"
# The operator brief is a CLAUDE.md in the mirror. It is renamed here so that
# Claude Code does not pick it up as instructions for this repo.
cp "$SRC/CLAUDE.md" "$DST/operator-brief.md"

{
  echo "# Manifest"
  echo
  echo "Copied by \`governance/sync.sh\` on $(date -u +%Y-%m-%dT%H:%MZ) from \`$SRC\`"
  echo "(mirror of \`/home/binc/CANALV2_r3/CANALV2\` on binc-PC). The mirror is the"
  echo "source; edit nothing here, re-run the sync."
  echo
  echo "| Here | From | sha256 (first 12) |"
  echo "|---|---|---|"
  cd "$DST"
  find . -type f -name '*.md' ! -name MANIFEST.md | sort | while read -r f; do
    f="${f#./}"
    case "$f" in
      policy/*)      src="00_POLICY/${f#policy/}" ;;
      governance/*)  src="01_GOVERNANCE/${f#governance/}" ;;
      operator-brief.md) src="CLAUDE.md" ;;
      *)             src="$f" ;;
    esac
    printf '| `%s` | `%s` | `%s` |\n' "$f" "$src" "$(shasum -a 256 "$f" | cut -c1-12)"
  done
} > "$DST/MANIFEST.md"
echo "synced $(find "$DST" -name '*.md' | wc -l | tr -d ' ') files into $DST"
