#!/usr/bin/env bash
# PreToolUse hook: refuse Edit/Write/NotebookEdit under projects/desktop/ (Binc's mirror).
# Exit 2 blocks the tool call and shows stderr to Claude.
input="$(cat)"
path="$(printf '%s' "$input" | python3 -c 'import sys,json
d=json.load(sys.stdin); t=d.get("tool_input",{})
print(t.get("file_path") or t.get("notebook_path") or "")' 2>/dev/null)"
case "$path" in
  */projects/desktop/*|projects/desktop/*)
    echo "blocked: $path is under projects/desktop/, Binc's mirror (see .claude/rules/binc-tree.md). Read it, link or copy out of it; do not write into it." >&2
    exit 2 ;;
esac
exit 0
