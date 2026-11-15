#!/usr/bin/env bash
# PreToolUse hook (Bash): refuse shell routes that go around the pod-manager MCP,
# which is where the approved_by gate and the USD 100 cap are enforced
# (shared/governance/policy/agent-permissions.md). Exit 2 blocks and tells the agent
# which tool to use. Heuristic on purpose: it catches the common bypasses, not every one.
cmd="$(python3 -c 'import sys,json
print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)"
deny() { echo "blocked: $1" >&2; exit 2; }
re() { printf '%s' "$cmd" | grep -Eq "$1"; }

re '(^|[;&| (])runpodctl( |$)' && deny "runpodctl bypasses the spend gate. Use the pod-manager MCP (create_pod, stop_pod, resume_pod, delete_pod, ...) with approved_by."
re '(rest\.runpod\.io|api\.runpod\.io|runpod\.io/graphql|s3api-[a-z0-9-]+\.runpod\.io)' && deny "direct RunPod API/S3 calls bypass the spend gate. Use the pod-manager MCP (volume_files, volume_clone, create_volume, ...)."
re 'start\.sh +pod +(create|resume|recreate|delete)|cli/index\.mjs +pod +(create|resume|recreate|delete)' && deny "the pod CLI skips approved_by. Use the pod-manager MCP tool with approved_by (a named yes)."
re 'aws +s3(api)? .*(rm|rb|mv|sync|cp|put-object|delete-object)( |$).*bh-panama-exchange|bh-panama-exchange.*aws +s3 +(rm|rb|mv)' && deny "BH's bucket is read-only and downloads need a named yes. Use panama_pull (approved_by) or plan_round_import / import_round."
re '(^|[;&| (])(rm|rmdir|mv|chmod|truncate|tee)\b[^|;&]*projects/desktop|sed +-i[^|;&]*projects/desktop|>>? *[^ ]*projects/desktop/|git +add[^|;&]*projects/desktop|cp\b[^|;&]* [^ ]*projects/desktop/[^ ]* *($|[;&|])' && deny "projects/desktop/ is Binc's read-only mirror (.claude/rules/binc-tree.md). Copy out of it, never into it."
exit 0
