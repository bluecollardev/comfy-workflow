#!/usr/bin/env bash
# Test of round-nodes.sh against a scratch tree: no ComfyUI, no network, pip replaced by a recorder.   Run: bash round-nodes.test.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
mkdir -p "$t/rounds/r1/s1/nodes/fal-1" "$t/rounds/r1/s2/nodes/fal-1" "$t/rounds/r1/s2/nodes/new-pack" "$t/rounds/r2/s3/nodes/other" "$t/custom/ComfyUI-fal-API/nodes"
for d in "$t/rounds/r1/s1/nodes/fal-1" "$t/rounds/r1/s2/nodes/fal-1" "$t/custom/ComfyUI-fal-API"; do echo "print(1)" > "$d/__init__.py"; echo "KEY" > "$d/config.ini"; done   # same bytes (the key file does not count)
echo "print(2)" > "$t/rounds/r1/s2/nodes/new-pack/__init__.py"; echo "numpy" > "$t/rounds/r1/s2/nodes/new-pack/requirements.txt"; echo "opencv-python>=4" >> "$t/rounds/r1/s2/nodes/new-pack/requirements.txt"
echo "print(3)" > "$t/rounds/r2/s3/nodes/other/__init__.py"
mkdir -p "$t/custom/other"; echo "print(99)" > "$t/custom/other/__init__.py"   # a different pack that has the same name
printf '#!/usr/bin/env bash\ncat "$2" >> "%s/pip.log"\n' "$t" > "$t/pip.sh"; chmod +x "$t/pip.sh"   # pip stand-in: records the requirements file it is given (-r FILE)
out="$(ROUND_NODES_ROOT="$t/rounds" CUSTOM_NODES="$t/custom" PIP="$t/pip.sh" bash "$here/round-nodes.sh" 2>&1)"; echo "$out"
fail() { echo "FAIL: $1"; exit 1; }
echo "$out" | grep -q "fal-1: same as ComfyUI-fal-API (the image), skipped" || fail "the pack already in the image is skipped"
[ -L "$t/custom/new-pack" ] || fail "a new pack is linked"
ls "$t/custom" | grep -q '^other-' || fail "a name clash gets a hash suffix"
[ "$(ls "$t/custom" | wc -l | tr -d ' ')" = 4 ] || fail "only the new ones were linked (image fal, other, new-pack, other-<hash>)"
grep -q "opencv-python-headless" "$t/pip.log" || fail "opencv-python becomes headless in the requirements"
echo "$out" | grep -q "restart it if it is already running" || fail "says to restart"
out2="$(ROUND_NODES_ROOT="$t/rounds" CUSTOM_NODES="$t/custom" PIP=true bash "$here/round-nodes.sh" 2>&1)"
echo "$out2" | grep -q "nothing new to link" || fail "a second run links nothing"
ROUND_NODES_ROOT="$t/none" CUSTOM_NODES="$t/custom" bash "$here/round-nodes.sh" | grep -q "nothing to do" || fail "no rounds is fine"
echo "round-nodes: all checks passed"
