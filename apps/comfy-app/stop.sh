#!/usr/bin/env bash
# Stop a server started with ./launch.sh --background.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="${COMFY_INSTALL:-$HERE}/logs/comfyui.pid"
[ -f "$PIDFILE" ] || { echo "no pid file; nothing to stop"; exit 0; }
PID="$(cat "$PIDFILE")"
if kill -0 "$PID" 2>/dev/null; then kill "$PID" && echo "stopped $PID"; else echo "pid $PID not running"; fi
rm -f "$PIDFILE"
