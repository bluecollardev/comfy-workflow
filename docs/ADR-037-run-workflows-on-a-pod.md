# ADR-037: Run workflows on a pod, from the pod card and from MCP

**Date:** 2026-11-07
**Status:** Accepted; built on `feature/run-workflows` (unit and browser tests pass). **Not yet run against a real pod**, and the pod-side converter needs a new image tag (not built or pushed; a push needs a named yes).
**Extends:** ADR-028 (MCP can do everything the window can), ADR-033 (a round's graphs are placed in the Workflows panel), ADR-036 (the image bakes in no workflows). Uses the History (`libs/core/src/history.ts`).

## Context

Lucas (2026-11-07): "have a button on pod cards called run workflows. running this should log any errors to our logs", then "run workflows should run all workflows in shot", then "it should pop open a modal that allows you to select which workflows to run for the pod", and "this should also be exposed to mcp".

A pod's Workflows panel holds **UI graphs** (nodes with positions and links; settings stored by position). ComfyUI's `/prompt` queues only **API graphs** (node id -> class and named inputs). The UI's Run button converts in the browser; the bridge's `queue_prompt` refuses a UI graph. BH's round graphs are UI graphs only (the cgi-042 delivery graph: 89 nodes, no API twin), so running them needs a conversion.

## Decision

1. **A "Run workflows" button on a running pod's card** opens a modal. It lists the graphs in the pod's `comfy-shared/workflows`, grouped by folder (a shot or a round; inputs manifests and API twins are not listed), **all ticked**, with Select all / none and a tick per folder. Run starts the ticked graphs, one after another, on that pod, and shows each graph's state (waiting, running, done, failed, skipped) with its error.
2. **The conversion is ComfyUI's own frontend**: load the graph, `app.graphToPrompt()`. That is the Run button's code, so muted and bypassed nodes, reroutes and primitives behave as in the UI. Two ways to reach a frontend, tried in this order:
   - **On the pod** (`apps/comfy-app/docker/ui2api.py`, run over SSH): a headless Chromium on the pod opens `127.0.0.1:8188`. Needs the image to carry Chromium and Playwright (about 300 MB, `Dockerfile`); present only in images built after this ADR.
   - **On this PC** (`libs/core/src/ui2api.ts`): Chrome headless through `playwright-core` opens the pod's own page over its proxy. Works with today's pods; needs Chrome on this PC and the app (or MCP server) running here.
   The pod way is tried first; an image without the script falls back to this PC. A graph that the pod's frontend failed to convert is a failure, not a reason to retry elsewhere.
3. **Every outcome is logged to the History**, one `job` event per graph with `job: "run"`: `done`, `failed` (with the error text) or `cancelled`, the graph path, the pod, the prompt id, the seconds, and the node where it failed. Errors are the ones ComfyUI gives: a rejected prompt's first invalid node (and how many more), an `execution_error` (message, node id, node type), a conversion failure, a graph that is not a UI graph, a locked shot, a timeout. A failed graph does not stop the rest.
4. **Locked shots are refused**, the same rule as `queue_prompt` (`shots.lockedIn`): client-approved shots are never run by us.
5. **MCP has the same actions** (ADR-028): `list_pod_workflows {pod_id}`, `run_pod_workflows {pod_id, paths, approved_by}` (returns a job) and `run_workflows_job {id, cancel?}`. Running needs `approved_by` because it uses GPU time on a pod that is already billing; the window's button does not ask (the user is there and pressed it), as with Pull.
6. **Cancel** stops the job: graphs not yet started are skipped and the running prompt is interrupted (`POST /interrupt`).

## Not decided

- **Inputs that change per run** (a different frame range, a different plate): a graph is run as placed. Editing values before a run is for the Workflows panel.
- **Order and parallelism**: graphs run in the order ticked, one at a time (a pod has one queue; stacking prompts would hide which one failed).
- **Where the picked "shot" comes from**: the modal groups by the panel's folders. ADR-033 places a round's graphs under `workflows/rounds/<round>/`; a per-shot folder inside is used if the round has one.

## Consequences

- A user (or an agent) runs a round's graphs on a pod without opening ComfyUI's page and sees every failure in the History, with the same filters as pulls and syncs (`run`).
- The packaged app gains a dependency, `playwright-core` (no bundled browser).
- Until a new image tag is built and used, conversion happens on this PC.
- Untested against a real pod: the page-side calls (`window.app.loadGraphData`, `graphToPrompt`) are those of the current ComfyUI frontend and could change with it. The first live run goes in the runbook's Log.
