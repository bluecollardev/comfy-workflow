#!/usr/bin/env bash
# One-command starts for this repo. Each target installs what it needs on the
# first run and reuses it after. The same steps by hand: README.md "Manual start".
#
#   ./start.sh comfy          ComfyUI on this Mac                       http://127.0.0.1:8188
#   ./start.sh pods           pod manager API, serves the dashboard     http://localhost:8000
#   ./start.sh desktop        the dashboard as an Electron app (starts the API itself)
#   ./start.sh dashboard      dashboard with hot reload, needs `pods` running   http://localhost:5173
#   ./start.sh pod <args>     pod lifecycle CLI, e.g. ./start.sh pod list
#   ./start.sh mcp            the MCP server over stdio (what Claude Code launches)
#   ./start.sh sync --pod <id> copy the mapped folders to a pod's network volume (never deletes)
#   ./start.sh e2e | e2e-app | e2e-live | core-test | smoke   browser suite; the app in no-spend mode; the live RunPod proof (spends); core suite; headless boot
#   ./start.sh package [mac|win|linux|all] [--comfy <variant>] [--image <ref>]  build the app installers for a comfy-app variant
#   ./start.sh test [args]    the merge gate: pytest without the integration tests
#   ./start.sh stop           stop the pod manager API (even a stale one) and a backgrounded ComfyUI
#
# RUNPOD_API_KEY comes from the environment or from .env at the repo root; so can
# API_PORT (default 8000). Python lands in .venv/ at the repo root (the Electron app
# looks there too). `pods` and `desktop` first clear a stale pod manager from the
# port, refuse a port owned by anything else, and `pods` waits for /health to answer
# instead of leaving you guessing.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
VENV="$HERE/.venv"
PY="$VENV/bin/python"
API_REQ="apps/runpod-api/requirements.txt"
CLI_REQ="infra/scripts/requirements.txt"
API_PORT="${API_PORT:-8000}"

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

load_env() {
  if [ -f "$HERE/.env" ]; then set -a; # shellcheck disable=SC1091
    source "$HERE/.env"; set +a; fi
  API_PORT="${API_PORT:-8000}"
}

need_key() {
  [ -n "${RUNPOD_API_KEY:-}" ] || { echo "RUNPOD_API_KEY is not set. Export it or put it in $HERE/.env" >&2; exit 1; }
}

ensure_venv() {
  [ -x "$PY" ] || { echo "creating $VENV"; python3 -m venv "$VENV"; }
  local stamp="$VENV/.requirements.sha" want
  want="$(cat "$API_REQ" "$CLI_REQ" | shasum | cut -c1-40)"
  if [ "$(cat "$stamp" 2>/dev/null || true)" != "$want" ]; then
    echo "installing Python deps into $VENV"
    "$PY" -m pip install -q --upgrade pip
    "$PY" -m pip install -q -r "$API_REQ" -r "$CLI_REQ"
    echo "$want" > "$stamp"
  fi
}

port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }
cmd_of() { ps -o command= -p "$1" 2>/dev/null || true; }
ours() {  # the pod manager itself, or a worker it spawned
  case "$(cmd_of "$1")" in *pod_manager_api.py*) return 0;; esac
  case "$(cmd_of "$(ps -o ppid= -p "$1" 2>/dev/null | tr -d ' ')")" in *pod_manager_api.py*) return 0;; esac
  return 1
}
api_pids() { { port_pids "$API_PORT"; pgrep -f '[p]od_manager_api.py'; } | sort -un; }

stop_api() {  # stop every pod manager process; returns 1 if the port belongs to someone else
  local pid busy=0
  for pid in $(port_pids "$API_PORT"); do
    ours "$pid" || { echo "port $API_PORT is in use by pid $pid: $(cmd_of "$pid")" >&2; busy=1; }
  done
  [ "$busy" = 0 ] || return 1
  local pids; pids="$(api_pids)"
  [ -n "$pids" ] || return 0
  echo "stopping pod manager pid(s): $(echo $pids | tr '\n' ' ')"
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 20); do [ -z "$(api_pids)" ] && return 0; sleep 0.5; done
  kill -9 $pids 2>/dev/null || true; sleep 1
  [ -z "$(port_pids "$API_PORT")" ]
}

free_port() { stop_api || { echo "stop it, or run with API_PORT=<other> ./start.sh $1" >&2; exit 1; }; }

run_api() {  # start, wait for /health, then stay in the foreground
  "$PY" apps/runpod-api/pod_manager_api.py & local pid=$!
  trap 'kill $pid 2>/dev/null; wait $pid 2>/dev/null; exit 130' INT TERM
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
      echo "ready: http://localhost:$API_PORT  (API docs: /docs)"
      wait $pid; return
    fi
    kill -0 $pid 2>/dev/null || { echo "the API exited during startup" >&2; wait $pid || exit 1; exit 1; }
    sleep 1
  done
  echo "no answer from http://localhost:$API_PORT/health after 30s; stopping it" >&2
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; exit 1
}

ensure_dashboard() {
  if ! command -v npm >/dev/null; then
    echo "npm not found: the API runs without the UI; http://localhost:8000/docs still works" >&2
    return
  fi
  ( cd apps/runpod-dashboard
    [ -d node_modules ] || npm install
    if [ ! -f dist/index.html ] || [ -n "$(find src index.html package.json vite.config.* -newer dist/index.html 2>/dev/null | head -1)" ]; then
      echo "building the dashboard"; npm run build
    fi )
}

case "${1:-help}" in
  comfy)
    shift
    [ -f shared/nodes/README.md ] || git submodule update --init --depth 1 shared/nodes
    cd apps/comfy-app
    [ -x ComfyUI/.venv/bin/python ] || ./setup.sh
    ./fetch-models.sh
    exec ./launch.sh "$@" ;;
  pods)
    load_env; need_key; free_port pods; ensure_venv; ensure_dashboard
    run_api ;;
  desktop)
    load_env; need_key; free_port desktop; ensure_venv; ensure_dashboard
    cd apps/runpod-dashboard
    exec npx electron . ;;
  dashboard)
    cd apps/runpod-dashboard
    [ -d node_modules ] || npm install
    exec npm run dev ;;
  pod)
    shift; load_env; ensure_venv
    exec "$PY" infra/scripts/create_pod.py "$@" ;;
  sync)
    shift; load_env; need_key; ensure_venv
    exec "$PY" infra/scripts/sync_volume.py "$@" ;;
  e2e)
    # the browser suite against hot reload (Playwright starts the dev server itself)
    shift; cd apps/runpod-dashboard; [ -d node_modules ] || npm install
    exec npx playwright test "$@" ;;
  e2e-app)
    # the real app through Electron in no-spend mode: pods simulated, nothing bills
    shift; ensure_dashboard; cd apps/runpod-dashboard
    exec npx playwright test --config playwright.electron.config.js no-spend.spec.js "$@" ;;
  e2e-live)
    # the proof against RunPod: one real pod with the stock image, stopped and deleted by the test. Spends.
    # RUNPOD_LIVE_KEEP=1 leaves it stopped (bills nothing with no per-pod volume) so the app can show it.
    shift; load_env; need_key; ensure_dashboard; cd apps/runpod-dashboard
    RUNPOD_LIVE=1 exec npx playwright test --config playwright.electron.config.js live.spec.js "$@" ;;
  core-test)
    shift; cd apps/runpod-dashboard; [ -d node_modules ] || npm install
    exec npm run --silent core:test -- "$@" ;;
  smoke)
    # boot the Electron app headless, call the core from the page, print what loaded, quit
    shift; load_env; ensure_dashboard; cd apps/runpod-dashboard
    RUNPOD_MANAGER_SMOKE=1 exec npx electron . ;;
  comfy-image)
    # build the ComfyUI server image for a ShotPipe set (apps/comfy-app/build.sh; amd64 box or emulation)
    shift; cd apps/comfy-app; exec ./build.sh "$@" ;;
  package)
    # ./start.sh package [mac|win|linux|all] [--comfy <set-or-tag>] [--image <registry ref>]
    #   -> apps/runpod-dashboard/dist-electron/<variant>/
    # The variant is a comfy-app build (apps/comfy-app/build.sh, a ShotPipe set from
    # shared/nodes/sets.json, default contract-v26). It is baked into the app as
    # build/build-info.json: the image a new pod boots by default (--image, the pushed
    # reference of that build; else the local tag, refused at pod creation until pushed).
    shift; target="${1:-mac}"; [ $# -gt 0 ] && shift
    variant="contract-v26"; image=""
    while [ $# -gt 0 ]; do case "$1" in
      --comfy) variant="$2"; shift 2 ;;
      --image) image="$2"; shift 2 ;;
      *) echo "usage: ./start.sh package [mac|win|linux|all] [--comfy <set-or-tag>] [--image <registry ref>]" >&2; exit 2 ;;
    esac; done
    case "$target" in mac|win|linux|all) ;; *) echo "usage: ./start.sh package [mac|win|linux|all] [--comfy <set-or-tag>] [--image <registry ref>]" >&2; exit 2 ;; esac
    cd apps/runpod-dashboard
    [ -d node_modules ] || npm install
    mkdir -p build
    printf '{\n  "comfy_variant": "%s",\n  "comfy_image": "%s",\n  "shotpipe_sets": "shared/nodes/sets.json",\n  "built_at": "%s"\n}\n' \
      "$variant" "${image:-comfy-app:$variant}" "$(date -u +%Y-%m-%dT%H:%MZ)" > build/build-info.json
    echo "building the app for comfy-app:$variant (default pod image ${image:-comfy-app:$variant}) -> dist-electron/$variant"
    out="--config.directories.output=dist-electron/$variant"
    case "$target" in
      mac)   npm run build && exec npx electron-builder --mac "$out" ;;
      win)   npm run build && exec npx electron-builder --win "$out" ;;
      linux) npm run build && exec npx electron-builder --linux "$out" ;;
      all)   npm run build && exec npx electron-builder --mac --win --linux "$out" ;;
      *) echo "usage: ./start.sh package [mac|win|linux|all] [--comfy <set-or-tag>] [--image <registry ref>]" >&2; exit 2 ;;
    esac ;;
  mcp)
    load_env; need_key; ensure_venv
    cd apps/runpod-api
    exec "$PY" mcp_server.py ;;
  stop)
    load_env
    [ -n "$(api_pids)" ] || echo "no pod manager running"
    stop_api
    [ -f apps/comfy-app/logs/comfyui.pid ] && apps/comfy-app/stop.sh
    true ;;
  test)
    shift; ensure_venv
    "$PY" -m pytest apps/runpod-api/tests/ -m "not integration" "$@" || exit 1
    # The TypeScript core (docs/ADR-005): same gate, same rule, nothing merges red.
    ( cd apps/runpod-dashboard && { [ -d node_modules ] || npm install --no-fund --no-audit; } && npm run --silent core:test ) ;;
  help|-h|--help) usage ;;
  *) echo "unknown target: $1" >&2; usage >&2; exit 2 ;;
esac
