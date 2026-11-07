# Runbooks (instructions for an AI agent, kept current by the agent)

ADR-034: each repeatable task has a runbook here; the session that proves, breaks or changes a step updates its **Log** in the same session. A runbook is finished only when its Log shows the steps run for real. Everything goes through the `pod-manager` MCP (and the ComfyUI bridge) unless a runbook says a gap exists.

| Task | Runbook |
|---|---|
| Run a BH shot on a pod: find the version, pod, pull, place, work, return | [`shot-stereo-conversion.md`](shot-stereo-conversion.md) |
| Bring a pod up, keep it, stop it (resume vs recreate, idle stop, spend) | [`pod-lifecycle.md`](pod-lifecycle.md) |
| Run a pod's workflows and read the errors (ADR-037) | [`run-workflows-on-a-pod.md`](run-workflows-on-a-pod.md) |
| Import a round across the pool (queue, caps, pods) (ADR-038) | [`import-a-round.md`](import-a-round.md) |
| Get a round onto the volume and ready for its graphs | [`round-pull-and-place.md`](round-pull-and-place.md) |
| MCP session care: stale tools, reconnect, which endpoint, huge outputs | [`mcp-session.md`](mcp-session.md) |
