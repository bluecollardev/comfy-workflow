#!/usr/bin/env bash
# Report how ComfyUI/ differs from upstream at the pinned commit, and what we
# have added on top. Exit 1 when the core is not at the pin or has edits.
#
#   ./check.sh          # summary
#   ./check.sh --diff   # also print the content diff of upstream files
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/pins.env"
APP="$HERE/ComfyUI"
[ -d "$APP/.git" ] || { echo "no ComfyUI clone at $APP; run ./setup.sh" >&2; exit 1; }
cd "$APP"
rc=0
head="$(git rev-parse HEAD)"
echo "pinned:  $COMFYUI_REF"
echo "HEAD:    $head ($(git describe --tags 2>/dev/null || echo untagged))"
if [ "$head" != "$COMFYUI_REF" ]; then echo "  !! core is not at the pinned commit"; rc=1; fi

echo
echo "upstream files changed (content, modes ignored):"
changed="$(git -c core.fileMode=false status --porcelain --untracked-files=no)"
if [ -n "$changed" ]; then echo "$changed" | sed 's/^/  /'; rc=1; else echo "  none"; fi
[ "${1:-}" = "--diff" ] && git -c core.fileMode=false diff

echo
echo "files added outside upstream's .gitignore:"
added="$(git status --porcelain --untracked-files=all | grep '^??' | cut -c4-)"
if [ -n "$added" ]; then echo "$added" | sed 's/^/  /'; else echo "  none"; fi

echo
echo "ours, on top of upstream (ignored by upstream's .gitignore):"
for d in custom_nodes/*/ custom_nodes/*; do
  [ -e "$d" ] || continue
  n="${d%/}"; n="${n#custom_nodes/}"
  case "$n" in example_node.py.example|websocket_image_save.py|__pycache__|.DS_Store) continue ;; esac
  if [ -L "custom_nodes/$n" ]; then echo "  custom_nodes/$n -> $(readlink "custom_nodes/$n")"; else echo "  custom_nodes/$n (copy, not a link to shared/nodes)"; fi
done | sort -u
wf="user/default/workflows"
if [ -L "$wf" ]; then echo "  $wf -> $(readlink "$wf")"; elif [ -d "$wf" ]; then echo "  $wf (plain folder, not linked to the repo)"; fi
for m in models/*/*/; do [ -d "$m" ] && echo "  ${m%/} ($(du -sh "$m" | cut -f1))"; done
for i in input/*/; do [ -d "$i" ] && echo "  ${i%/} ($(du -sh "$i" | cut -f1), local test input)"; done
[ -d .venv ] && echo "  .venv ($(du -sh .venv | cut -f1))"
exit $rc
