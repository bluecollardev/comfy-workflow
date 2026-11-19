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
#   ./start.sh import <folder> [--adapter ID] [--dry-run]   a package folder into ComfyUI-Shared through an adapter (docs/ADR-008)
#   ./start.sh chunk plan --first N --last N [--chunk N] [--project P --shot S] | ram --pod-id ID   frame ranges, queue job files, a pod's RAM (docs/CHUNKING.md)
#   ./start.sh chunk-live   chunked runs and the RAM guard against RunPod: one real pod, tiny frames (spends)
#   ./start.sh config export [file] [--no-secrets] | import <file> [--sections a,b] [--dry-run] | undo   the Default Configuration as a JSON file, keys and tokens included unless --no-secrets (docs/ADR-023)
#   ./start.sh mcp            the MCP server over stdio (what Claude Code launches)
#   ./start.sh e2e | e2e-app | e2e-live | core-test | smoke   browser suite; the app in no-spend mode; the live RunPod proof (spends); core suite; headless boot
#   ./start.sh comfy-image [--remote --wait] [--push <ref>]   build the ComfyUI server image (on GitHub Actions with --remote)
#   ./start.sh package [mac|win|linux|all] [--comfy <variant>] [--image <ref>]  build the app installers for a comfy-app variant
#   ./start.sh release patch|minor|major|X.Y.Z [--dry-run] [--no-publish] [--skip-gate "why"]   version, build the DMG, tag, publish (docs/ADR-012); REFUSED without a passing ./start.sh test on this code
#   ./start.sh test           the gate: core, MCP, IPC, unit, browser suite, the real app in no-spend mode; a pass is recorded for release
#   ./start.sh stop           stop ComfyUI, wherever it was started (background, terminal or IDE)
#
# RUNPOD_API_KEY comes from the environment, from .env at the repo root, or from the app's
# settings (~/.config/runpod-pod-manager/.env, entered in Default Configuration).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
APP="$HERE/apps/runpod-dashboard"

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

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
  import)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs import "$@" ;;
  chunk)
    # split a shot into frame ranges and write queue job files; a pod's container RAM (docs/CHUNKING.md)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs chunk "$@" ;;
  chunk-live)
    # the proof of chunked runs and the RAM guard against RunPod: one real pod, tiny frames (spends a few minutes of the cheapest card)
    shift; load_env; ensure_app
    cd "$APP"; RUNPOD_LIVE=1 exec npx vitest run --config libs/core/vitest.config.ts tests/chunking.live.test.ts "$@" ;;
  config)
    # export / import / undo of the Default Configuration as a JSON file; keys and tokens in it unless --no-secrets (docs/ADR-023)
    shift; load_env; ensure_app
    cd "$APP"; exec node cli/index.mjs config "$@" ;;
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
    # build the ComfyUI server image (apps/comfy-app/build.sh): --remote --wait on GitHub Actions, --push <ref> from here
    shift; cd apps/comfy-app; exec ./build.sh "$@" ;;
  package)
    # ./start.sh package [mac|win|linux|all] [--comfy <set-or-tag>] [--image <registry ref>]
    #   -> apps/runpod-dashboard/dist-electron/<variant>/
    # The variant is a comfy-app build (apps/comfy-app/build.sh, a ShotPipe set from
    # shared/nodes/sets.json, default contract-v27). It is baked into the app as
    # build/build-info.json: the image a new pod boots by default (--image, the pushed
    # reference of that build; else the local tag, refused at pod creation until pushed).
    shift; target="${1:-mac}"; [ $# -gt 0 ] && shift
    variant="contract-v27"; image=""
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
    # A Mac build other people can open without a Gatekeeper block (macOS 15 and later refuse an unsigned app, right-click Open no longer works) must be SIGNED with a
    # Developer ID Application certificate and NOTARIZED by Apple. When the credentials are in the environment this does both; without them the build is unsigned and says so.
    #   CSC_NAME="Developer ID Application: Name (TEAMID)"  (or CSC_LINK=<.p12 path/URL> and CSC_KEY_PASSWORD)
    #   APPLE_ID=<apple id>  APPLE_APP_SPECIFIC_PASSWORD=<app-specific password>  APPLE_TEAM_ID=<team id>
    sign_args=""
    if [ "$target" = mac ] || [ "$target" = all ]; then
      if { [ -n "${CSC_NAME:-}" ] || [ -n "${CSC_LINK:-}" ]; } && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; then
        export CSC_IDENTITY_AUTO_DISCOVERY=true
        sign_args="--config.mac.hardenedRuntime=true --config.mac.gatekeeperAssess=false --config.mac.entitlements=build/entitlements.mac.plist --config.mac.entitlementsInherit=build/entitlements.mac.plist --config.mac.notarize=true"
        echo "mac: SIGNING with Developer ID and NOTARIZING with Apple: the DMG opens on any Mac without a Gatekeeper warning" >&2
      else
        echo "mac: UNSIGNED build. macOS 15+ blocks it on other Macs: users must use the Terminal install command or System Settings > Open Anyway (the download page says so). To sign and notarize set CSC_NAME (or CSC_LINK + CSC_KEY_PASSWORD), APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (needs an Apple Developer ID certificate)." >&2
      fi
    fi
    mkdir -p build
    printf '{\n  "comfy_variant": "%s",\n  "comfy_image": "%s",\n  "shotpipe_sets": "shared/nodes/sets.json",\n  "built_at": "%s"\n}\n' \
      "$variant" "${image:-comfy-app:$variant}" "$(date -u +%Y-%m-%dT%H:%MZ)" > build/build-info.json
    echo "building the app for comfy-app:$variant (default pod image ${image:-comfy-app:$variant}) -> dist-electron/$variant"
    out="--config.directories.output=dist-electron/$variant"
    case "$target" in
      mac)   npm run build && exec npx electron-builder --mac $sign_args "$out" ;;
      win)   npm run build && exec npx electron-builder --win "$out" ;;
      linux) npm run build && exec npx electron-builder --linux "$out" ;;
      all)   npm run build && exec npx electron-builder --mac --win --linux $sign_args "$out" ;;
    esac ;;
  release)
    # A release needs a passing gate (./start.sh test) recorded for exactly this code (scripts/gate.mjs, docs/ADR-005). The only way round it is
    # --skip-gate "reason in words", which is written to .gate/skips.log; a dry run only reports the gate.
    shift
    skip_reason=""; dry=0; rargs=()
    while [ $# -gt 0 ]; do
      case "$1" in
        --skip-gate) skip_reason="${2:-}"; [ -n "$skip_reason" ] || { echo '--skip-gate needs the reason in words, e.g. --skip-gate "Lucas: no tests for this patch"' >&2; exit 2; }; shift 2 ;;
        --dry-run) dry=1; rargs+=("$1"); shift ;;
        *) rargs+=("$1"); shift ;;
      esac
    done
    if [ "$dry" = 1 ]; then
      node scripts/gate.mjs check || echo "(dry run only: a real release would be REFUSED until ./start.sh test passes on this code)"
    elif [ -n "$skip_reason" ]; then
      node scripts/gate.mjs skip --reason "$skip_reason"; echo "WARNING: releasing WITHOUT a passing gate: $skip_reason" >&2
    else
      node scripts/gate.mjs check || { echo "release refused: run ./start.sh test (the full gate) first, then release again." >&2; exit 1; }
    fi
    exec scripts/release.sh ${rargs[@]+"${rargs[@]}"} ;;
  stop)
    # ComfyUI started in the background has a pid file; one started in a terminal or the IDE does not:
    # stop whatever ComfyUI is listening on its port too.
    [ -f apps/comfy-app/logs/comfyui.pid ] && apps/comfy-app/stop.sh
    for pid in $(lsof -nP -iTCP:"${COMFY_PORT:-8188}" -sTCP:LISTEN -t 2>/dev/null); do
      case "$(ps -o command= -p "$pid")" in *ComfyUI*main.py*) echo "stopping ComfyUI pid $pid"; kill "$pid" ;; esac
    done
    true ;;
  test)
    # The gate (docs/ADR-005, amended 2026-11-19): the core suite, the MCP tools, the IPC table, the unit tests, the browser suite and the app itself
    # in no-spend mode; nothing merges or releases red. A full pass is recorded (scripts/gate.mjs) and `./start.sh release` requires it for this code.
    # Stop the app first (the Electron suite opens its own windows).
    shift; ensure_app; ensure_ui; cd "$APP"
    if npm run --silent test && npx playwright test && npx playwright test --config playwright.electron.config.js; then
      cd "$HERE"; node scripts/gate.mjs write
    else
      echo "the gate FAILED: nothing was recorded, a release is refused" >&2; exit 1
    fi ;;
  help|-h|--help) usage ;;
  *) echo "unknown target: $1" >&2; usage >&2; exit 2 ;;
esac
