#!/usr/bin/env bash
# One-command starts for this repo. One app: the Electron pod manager with its TypeScript core
# (docs/ADR-005); no server, no Python. Each target installs what it needs on the first run.
#
#   ./start.sh comfy          ComfyUI on this Mac                       http://127.0.0.1:8188
#   ./start.sh desktop        the pod manager app (built UI)
#   ./start.sh dashboard      the app with hot reload (Vite dev server inside the Electron window)
#   ./start.sh pod <args>     pod lifecycle CLI, e.g. ./start.sh pod list
#   ./start.sh sync --pod <id> | --s3   copy the mapped folders onto the network volume (never deletes)
#   ./start.sh pull --pod <id> | --s3   bring renders back down (comfy-shared/output, the shots' review and deliver)
#   ./start.sh mcp            the MCP server over stdio (what Claude Code launches)
#   ./start.sh e2e | e2e-app | e2e-live | core-test | smoke   browser suite; the app in no-spend mode; the live RunPod proof (spends); core suite; headless boot
#   ./start.sh comfy-image [--remote --wait] [--push <ref>]   build the ComfyUI server image (on GitLab CI with --remote)
#   ./start.sh package [mac|win|linux|all] [--comfy <variant>] [--image <ref>]  build the app installers for a comfy-app variant
#   ./start.sh test           the merge gate: core, IPC table, browser suite, the app in no-spend mode
#   ./start.sh stop           stop ComfyUI, wherever it was started (background, terminal or IDE)
#
# RUNPOD_API_KEY comes from the environment, from .env at the repo root, or from the app's
# settings (~/.config/runpod-pod-manager/.env, entered in Default Configuration).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
APP="$HERE/apps/runpod-dashboard"

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }

load_env() {
  if [ -f "$HERE/.env" ]; then set -a; # shellcheck disable=SC1091
    source "$HERE/.env"; set +a; fi
}

ensure_app() {
  command -v npm >/dev/null || { echo "npm not found: install Node 22 (nvm) first" >&2; exit 1; }
  ( cd "$APP"
    [ -d node_modules ] || npm install --no-fund --no-audit
    [ -x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ] || [ -x node_modules/electron/dist/electron ] || node node_modules/electron/install.js
    [ -f libs/core/dist/index.js ] || [ -n "$(find libs/core/src -newer libs/core/dist/index.js 2>/dev/null | head -1)" ] && { echo "building the core"; npm run --silent core:build; } || true )
}

ensure_ui() {  # the built page the desktop target loads
  ( cd "$APP"
    if [ ! -f dist/index.html ] || [ -n "$(find src index.html package.json vite.config.* -newer dist/index.html 2>/dev/null | head -1)" ]; then
      echo "building the dashboard"; npm run --silent build
    fi )
}

case "${1:-help}" in
  comfy)
    shift
    # Already serving? Say so instead of dying with "Port 8188 is already in use".
    COMFY_PORT_NOW="${COMFY_PORT:-8188}"
    if curl -fsS --max-time 2 "http://127.0.0.1:$COMFY_PORT_NOW/system_stats" >/dev/null 2>&1; then
      echo "ComfyUI is already running on http://127.0.0.1:$COMFY_PORT_NOW (pid $(lsof -nP -iTCP:$COMFY_PORT_NOW -sTCP:LISTEN -t 2>/dev/null | head -1)). Open it, or stop it first: ./start.sh stop"
      exit 0
    fi
    [ -f shared/nodes/README.md ] || git submodule update --init --depth 1 shared/nodes
    cd apps/comfy-app
    [ -x ComfyUI/.venv/bin/python ] || ./setup.sh
    ./fetch-models.sh
    exec ./launch.sh "$@" ;;
  desktop|pods)
    load_env; ensure_app; ensure_ui
    cd "$APP"; exec npx electron . ;;
  dashboard)
    # Vite's dev server, then the app window pointed at it: hot reload, the core over IPC, no server
    load_env; ensure_app
    cd "$APP"
    npx vite --strictPort --port 5173 & VITE=$!
    trap 'kill $VITE 2>/dev/null; wait $VITE 2>/dev/null' EXIT INT TERM
    for _ in $(seq 1 40); do curl -fsS --max-time 1 http://localhost:5173 >/dev/null 2>&1 && break; sleep 0.5; done
    VITE_DEV_SERVER_URL=http://localhost:5173 npx electron . ;;
  pod)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs pod "$@" ;;
  sync)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs sync "$@" ;;
  pull)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs pull "$@" ;;
  mcp)
    # stdout is the MCP transport: everything the setup prints goes to stderr
    load_env; ensure_app >&2
    cd "$APP"; exec node mcp/server.mjs ;;
  e2e)
    # the browser suite against hot reload (Playwright starts the dev server itself; the API is faked)
    shift; ensure_app; cd "$APP"
    exec npx playwright test "$@" ;;
  e2e-app)
    # the real app through Electron in no-spend mode: pods simulated, nothing bills
    shift; ensure_app; ensure_ui; cd "$APP"
    exec npx playwright test --config playwright.electron.config.js "$@" ;;
  e2e-live)
    # the proof against RunPod: one real pod with the stock image, stopped and deleted by the test. Spends.
    # RUNPOD_LIVE_KEEP=1 leaves it stopped (bills nothing with no per-pod volume) so the app can show it.
    shift; load_env; ensure_app; ensure_ui; cd "$APP"
    RUNPOD_LIVE=1 exec npx playwright test --config playwright.electron.config.js live.spec.js "$@" ;;
  core-test)
    shift; ensure_app; cd "$APP"
    exec npm run --silent core:test -- "$@" ;;
  smoke)
    # boot the app headless, call the core from the page, print what loaded, quit
    shift; load_env; ensure_app; ensure_ui; cd "$APP"
    RUNPOD_MANAGER_SMOKE=1 exec npx electron . ;;
  comfy-image)
    # build the ComfyUI server image (apps/comfy-app/build.sh): --remote --wait on GitLab CI, --push <ref> from here
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
    ensure_app; cd "$APP"
    # Unsigned unless asked: electron-builder otherwise signs with whatever certificate the keychain holds
    # (here an "Apple Distribution" one, which is for the Mac App Store and stalls on a keychain prompt).
    # For a build other Macs open without a warning, sign with a Developer ID Application certificate:
    #   CSC_IDENTITY_AUTO_DISCOVERY=true ./start.sh package mac   (or CSC_NAME="Developer ID Application: ...")
    export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
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
    esac ;;
  stop)
    # ComfyUI started in the background has a pid file; one started in a terminal or the IDE does not:
    # stop whatever ComfyUI is listening on its port too.
    [ -f apps/comfy-app/logs/comfyui.pid ] && apps/comfy-app/stop.sh
    for pid in $(lsof -nP -iTCP:"${COMFY_PORT:-8188}" -sTCP:LISTEN -t 2>/dev/null); do
      case "$(ps -o command= -p "$pid")" in *ComfyUI*main.py*) echo "stopping ComfyUI pid $pid"; kill "$pid" ;; esac
    done
    true ;;
  test)
    # The merge gate (docs/ADR-005): the core suite, the IPC table, the browser suite and the app itself in no-spend mode; nothing merges red.
    shift; ensure_app; ensure_ui; cd "$APP"
    npm run --silent core:test && npm run --silent ipc:test && npx playwright test && npx playwright test --config playwright.electron.config.js ;;
  help|-h|--help) usage ;;
  *) echo "unknown target: $1" >&2; usage >&2; exit 2 ;;
esac
