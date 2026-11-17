# Runbook: import a round across the pool

**For an AI agent.** ADR-038 (queue), ADR-035 (pull picks the pod), ADR-037 (run workflows).

1. `plan_round_import {round}`: the shots, the pod price, the estimate and the caps (pod limit, dollar cap; `cap_enabled: false` means none).
2. `import_round {round, shots?, approved_by}` (a named yes; one approval covers the import and every pod it starts). It queues a pull (which places the round) and one run per shot.
3. `queue_list` until the import's `state` is `done`. Tasks: `waiting`, `running`, `done`, `failed` (read `error`), `held` (past the cap: `queue_task {action: "set_limits", id: <import id>, cost_cap_usd}` then `retry` the held tasks), `interrupted` (the app stopped: `retry`).
4. `queue_task {action: "cancel_import", id}` stops everything. Pods the import started are stopped when it ends; a pod that was already running is left running.
5. Every task's outcome is also in the History (`job: queue`).

## A round that already sits on a volume (ADR-044)

Binc's rounds on the Shared volume (`proxy_v004e/f/g`, `proxy_v005`, under `comfy-shared/workflows/`) are not pulled or copied; they are run in place.

1. `list_rounds {source: "volume", status: true}` (can the volume be listed: S3 keys and a datacenter with the S3 API; nothing is started if not), then `list_rounds {source: "volume", volume_id?}`: the rounds with `shots`, `graphs`, `locked`. Reading is read-only and free; it lists by prefix and caches a round for a minute or two.
2. `round_info {round}`: the shots, variants and graph paths; `locked` shots (cgi-042, anything under `04_GRAPH`) are reference only. `round_info {round, models: true}` (optional, reads up to 60 graphs): which models each graph names that the volume lacks, and where the same file name sits in another folder.
3. `plan_round_import {round, source: "volume", volume_id?, shots?}`: the shots, `graphs`, the estimate with its `assumption` (graphs x median seconds from the History, else 600 s, x the pod price), `cost_cap_usd`, `remaining_usd`, `refused` (locked shots you asked for) and `blocked`. Stop on `blocked`; ask the person.
4. `import_round {round, source: "volume", volume_id?, shots?, approved_by}`: one run task per shot, no pull. Refused with an error: a locked shot (403), an estimate over the cap (402), `replace`/`overwrite` (400). Then `queue_list` as above.

**Log**
- 2026-11-07: built and tested with fakes; **never run against real pods**. First live run: record the pods used, whether `h100` creation worked, and how long a shot took (the estimate assumes 0.5 h per shot).
