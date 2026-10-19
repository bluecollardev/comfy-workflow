#!/usr/bin/env bash
# Copy Binc's rule pages from the CANALV2 mirror into governance/ so agents
# working in this repo can read them without reaching into projects/desktop/.
# One-way: mirror -> here. Never writes into the mirror. Re-run after a sync
# from binc-PC; MANIFEST.md records what came from where and when.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${CANALV2_MIRROR:-$HERE/../projects/desktop/CANALV2}"
DST="$HERE"
[ -d "$SRC/00_POLICY" ] || { echo "no CANALV2 mirror at $SRC" >&2; exit 1; }

rm -rf "$DST/policy" "$DST/workflow" && mkdir -p "$DST/policy" "$DST/workflow"
cp "$SRC"/00_POLICY/*.md "$DST/policy/"
cp "$SRC"/01_GOVERNANCE/*.md "$DST/workflow/"
cp "$SRC/README.md" "$DST/CANALV2-README.md"
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
  { find policy workflow -type f -name '*.md'; echo operator-brief.md; echo CANALV2-README.md; } | sort | while read -r f; do
    case "$f" in
      policy/*)          src="00_POLICY/${f#policy/}" ;;
      workflow/*)        src="01_GOVERNANCE/${f#workflow/}" ;;
      operator-brief.md) src="CLAUDE.md" ;;
      CANALV2-README.md) src="README.md" ;;
    esac
    printf '| `%s` | `%s` | `%s` |\n' "$f" "$src" "$(shasum -a 256 "$f" | cut -c1-12)"
  done
} > "$DST/MANIFEST.md"
echo "synced $(grep -c '^| `' "$DST/MANIFEST.md") files into $DST"
