# ADR-040: Node packs a round ships with its shots are linked in before ComfyUI starts

**Date:** 2026-11-15
**Status:** Accepted; built: `apps/comfy-app/docker/round-nodes.sh`, run by the entrypoint, with a script test (`docker/round-nodes.test.sh`). **Needs a new image** (build and push) to take effect; not yet run on a pod.
**Related:** ADR-033 (a pull places a round), ADR-025 (the fal pack is baked into the image), ADR-038 (Import Round queues work for pods).

## Context

Lucas (2026-11-15): "how do we get the nodes from each shot pack when importing via import rounds into comfy on the runpod". A BH round can carry `<round>/<shot>/nodes/<pack>/` (in `brynley-comfy-2026-11-06`: `archival-080`, `depth-121` and `enhance-231` each have `fal-api-v2.5.0`). The pull copies those folders to the volume, but ComfyUI loads only `/opt/ComfyUI/custom_nodes/`, which the image fills at build time; nothing linked a bundled pack in. In that round the bundled pack is byte-identical to the image's `ComfyUI-fal-API`, so nothing was missing, but a future round may ship a pack the image lacks.

## Decision

`round-nodes.sh` runs in the entrypoint **before ComfyUI starts**. For each `<round>/<shot>/nodes/<pack>/` on the volume it hashes the pack's files (by relative path; caches, `*.pyc` and `config.ini` left out). A pack with the same hash as one already in `custom_nodes` (the image's, or one linked from another shot) is skipped and the log says which; a new one is symlinked under its own name (hash suffix when the name is taken by a different pack) and its `requirements.txt` is installed (plain `opencv-python` becomes the headless build, as in the Dockerfile). A failed install is a warning; the script never stops the pod's start.

Because the run pods an import creates start after the pull has finished, **their first start needs no restart**. A pod that is already up (a reused pool pod, a pull pod) reads `custom_nodes` only at start: run the script over SSH and it says to restart ComfyUI.

## Consequences

- Rounds that ship a pack the image lacks run on any pod without a rebuild; what ships that the image has is not loaded twice.
- A pack is trusted as the round ships it (its code runs on the pod): it comes from BH's bucket through the same pull as the graphs.
- Pip installs at start add time to a pod's first start when a round brings new packs.
- Not done: calling the script from the queue for a reused running pod (it would need a restart, which interrupts a running graph).
