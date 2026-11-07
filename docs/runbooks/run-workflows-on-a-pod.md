# Runbook: run a pod's workflows and read the errors

**For an AI agent.** ADR-037. Needs a running pod with the round's graphs placed (`round-pull-and-place.md`).

1. `list_pod_workflows {pod_id}`: the graphs in the pod's Workflows panel by folder. A round's graphs are under `rounds/<round>/`. Pick the paths (all of a shot's, or chosen ones).
2. `run_pod_workflows {pod_id, paths, approved_by}` (a named yes: it uses GPU time on a billing pod). It returns a job at once.
3. `run_workflows_job {id}` until `state` is not `running`. Each result is `done`, `failed` (read `error`: it names the node) or `skipped`. `cancel: true` stops it and interrupts the running prompt.
4. Every graph's outcome is also in the History (`job: run`), so a later session can read what failed without this job.
5. A graph for a locked shot is refused, not run. A graph that is not a UI graph, or that fails to convert, fails with the reason; the rest still run.

**Known gaps / Log**
- 2026-11-07: built and unit/browser-tested; **not yet run on a real pod**. Conversion happens on the pod only with an image built after ADR-037 (Chromium + `ui2api.py`); otherwise on this PC with Chrome (the app or MCP server must be running on this PC). First live run: record here the pod, graph, conversion path taken and any page-API surprise (`window.app.loadGraphData` / `graphToPrompt`).
