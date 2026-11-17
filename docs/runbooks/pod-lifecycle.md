# Runbook: pod lifecycle through MCP

**For an AI agent.** Spend needs a named `approved_by`; state the price first (ADR-034, `agent-permissions.md`, cap USD 100).

1. **Look first:** `list_pods`, `list_volumes`, `cost_now`, `get_credits`. Reuse a pod on the volume before creating one; a duplicate H100 was created and deleted on 2026-11-05.
2. **Start a stopped pod:** `resume_pod`. "not enough free GPUs on the host" (RunPod pins a stopped pod to its host) has two ways on. **(a) `resume_pod` with `retry_until_free: true`** (also `every_minutes`, `give_up_hours`): a watch tries again every 2 min for up to 12 h; nothing is deleted; follow or cancel it with `pod_watch`. **(b) `recreate_pod`** (new host, same settings, the volume follows) **terminates the old pod with its container disk**: use it only for a pod with a network volume, or when nothing on the disk is needed. A pod with no network volume (`volume_gb` 0, e.g. one made outside the app) keeps its files only on that disk: choose (a), or copy them off first. Prefer (a) when in doubt.
   **Same for a create:** `create_pod` that finds "No card available right now" can be sent with `retry_until_free: true` and the same request is retried until a card is free (one pod, never two; the name is looked up before every retry). A new host downloads the image first: `starting` for ~10 minutes is normal (`get_logs` shows `Downloading`).
3. **Name it:** `rename_pod` (a name on our side; RunPod's name stays).
4. **Idle stop:** `set_idle_stop {minutes}`. It only runs while the app is open; 0 = never. State the cost of a forgotten pod (price x hours).
5. **Create new only when none fits:** `create_pod` with `gpu`, `approved_by`; the volume's datacenter wins. `custom_nodes` / `pip_requirements` set env vars that only RunPod's stock image acts on, **not** our image (packs are baked at build time).
6. **Stop:** `stop_pod` pauses the bill; disk and volume stay. Delete only what you created and no longer need: `delete_pod` is irreversible (the volume is untouched).

## Log
- 2026-11-17: Retry Later in the window now opens a choice first: Same GPU (resume watch) or Another GPU in the pod's datacenter (a create watch for a new pod; the old pod is not deleted). MCP: `create_pod` with `like_pod_id` + `gpu` (+ `retry_until_free`). Fakes only so far.
- 2026-11-17: Retry Later built (ADR-042 section 19): `resume_pod` / `create_pod` `retry_until_free`, `pod_watch`, the window's Retry Later button. Not yet seen against a real full host: the tests use fake answers.- 2026-11-05: duplicate H100 created by mistake, deleted at once. `resume_pod` failed on a full host; `recreate_pod` worked. `rename_pod` needed the app's HTTP MCP until `/mcp` reconnect.
