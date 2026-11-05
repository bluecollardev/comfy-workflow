# Runbook: pod lifecycle through MCP

**For an AI agent.** Spend needs a named `approved_by`; state the price first (ADR-034, `agent-permissions.md`, cap USD 100).

1. **Look first:** `list_pods`, `list_volumes`, `cost_now`, `get_credits`. Reuse a pod on the volume before creating one; a duplicate H100 was created and deleted on 2026-11-05.
2. **Start a stopped pod:** `resume_pod`. "not enough free GPUs on the host" -> `recreate_pod` (new host, same settings, the volume follows; the old pod is terminated). A new host downloads the image first: `starting` for ~10 minutes is normal (`get_logs` shows `Downloading`).
3. **Name it:** `rename_pod` (a name on our side; RunPod's name stays).
4. **Idle stop:** `set_idle_stop {minutes}`. It only runs while the app is open; 0 = never. State the cost of a forgotten pod (price x hours).
5. **Create new only when none fits:** `create_pod` with `gpu`, `approved_by`; the volume's datacenter wins. `custom_nodes` / `pip_requirements` set env vars that only RunPod's stock image acts on, **not** our image (packs are baked at build time).
6. **Stop:** `stop_pod` pauses the bill; disk and volume stay. Delete only what you created and no longer need: `delete_pod` is irreversible (the volume is untouched).

## Log
- 2026-11-05: duplicate H100 created by mistake, deleted at once. `resume_pod` failed on a full host; `recreate_pod` worked. `rename_pod` needed the app's HTTP MCP until `/mcp` reconnect.
