#!/usr/bin/env bash
# The three folders on this PC, for anything that runs ComfyUI here. Source it:
#
#   . "$(dirname "$0")/mounts-env.sh"      # sets PROJECT_ROOT, PLATES_ROOT, COMFY_SHARED
#
# Each comes from the environment, else from the mapping saved by the dashboard's
# Configuration panel (~/.config/runpod-pod-manager/mounts.json, MOUNTS_FILE), else a default:
# the project tree falls back to the mirror (read), ComfyUI-Shared to ~/ComfyUI-Shared (created
# with the shared layout), plates to nothing. The mirror under projects/desktop is Binc's and
# read-only by rule (.claude/rules/binc-tree.md): a run writes into ComfyUI-Shared, so it may not
# point there. In dev mode (COMFY_MODE=dev, the default) such a mapping is replaced by
# ~/ComfyUI-Shared with a note; in prod it is refused. COMFY_REQUIRE (project,plates,comfy-shared
# or all/none; default none in dev, all in prod) names the folders a launch refuses to run without.
_ME_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_ME_REPO="$(cd "$_ME_HERE/../.." && pwd)"
_ME_STORE="${MOUNTS_FILE:-$HOME/.config/runpod-pod-manager/mounts.json}"

_me_mapped() {  # $1 = folder key -> the saved local folder, or nothing
  [ -f "$_ME_STORE" ] || return 0
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("folders",{}).get(sys.argv[2],""))' "$_ME_STORE" "$1" 2>/dev/null || true
}

export PROJECT_ROOT="${PROJECT_ROOT:-$(_me_mapped project)}"
export PLATES_ROOT="${PLATES_ROOT:-$(_me_mapped plates)}"
export COMFY_SHARED="${COMFY_SHARED:-$(_me_mapped comfy-shared)}"
: "${PROJECT_ROOT:=$_ME_REPO/projects/desktop/CANALV2}"
: "${COMFY_SHARED:=$HOME/ComfyUI-Shared}"

COMFY_MODE="${COMFY_MODE:-dev}"
case "$COMFY_SHARED/" in "$_ME_REPO/projects/desktop/"*)
  if [ "$COMFY_MODE" = "prod" ]; then
    echo "COMFY_SHARED is $COMFY_SHARED, inside Binc's mirror, which is read-only by rule and where a run writes its" >&2
    echo "input, output and models. Map a folder of your own as ComfyUI-Shared in the dashboard (gear icon), e.g." >&2
    echo "$HOME/ComfyUI-Shared, or set COMFY_SHARED." >&2
    return 1 2>/dev/null || exit 1
  fi
  echo "note: ComfyUI-Shared is mapped to Binc's mirror (read-only by rule); dev mode uses $HOME/ComfyUI-Shared instead." >&2
  export COMFY_SHARED="$HOME/ComfyUI-Shared" ;;
esac
_me_require="${COMFY_REQUIRE:-}"
[ -n "$_me_require" ] || { [ "$COMFY_MODE" = "prod" ] && _me_require=all || _me_require=none; }
case ",$_me_require," in *,all,*) _me_require="project,plates,comfy-shared" ;; *,none,*) _me_require="" ;; esac
for _k in project plates comfy-shared; do
  case ",$_me_require," in *",$_k,"*)
    case "$_k" in project) _v="$PROJECT_ROOT" ;; plates) _v="$PLATES_ROOT" ;; *) _v="$COMFY_SHARED" ;; esac
    [ -n "$_v" ] && [ -d "$_v" ] || { echo "$_k is required (COMFY_REQUIRE=$_me_require, COMFY_MODE=$COMFY_MODE) and is not mapped or missing: '$_v'" >&2; return 1 2>/dev/null || exit 1; } ;;
  esac
done
unset _me_require _k _v
case "$PROJECT_ROOT/" in "$_ME_REPO/projects/desktop/"*)
  echo "note: PROJECT_ROOT is the mirror ($PROJECT_ROOT); it is read-only by rule, so a graph that writes into the tree" >&2
  echo "      (03_WORK, 06_REVIEW, 80_TEST-BUCKET) will fail or must not run here. Map a copy of your own to work in it." >&2 ;;
esac

# The shared layout, as on binc-PC: input, output, models/<ComfyUI folder>.
for d in input output models/checkpoints models/clip models/clip_vision models/controlnet models/diffusion_models \
         models/embeddings models/loras models/upscale_models models/vae; do
  mkdir -p "$COMFY_SHARED/$d"
done
unset -f _me_mapped
