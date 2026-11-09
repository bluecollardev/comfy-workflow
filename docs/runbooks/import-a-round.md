# Runbook: import a round across the pool

**For an AI agent.** ADR-038 (queue), ADR-035 (pull picks the pod), ADR-037 (run workflows).

1. `plan_round_import {round}`: the shots, the pod price, the estimate and the caps (pod limit, dollar cap; `cap_enabled: false` means none).
2. `import_round {round, shots?, approved_by}` (a named yes; one approval covers the import and every pod it starts). It queues a pull (which places the round) and one run per shot.
3. `queue_list` until the import's `state` is `done`. Tasks: `waiting`, `running`, `done`, `failed` (read `error`), `held` (past the cap: `queue_task {action: "set_limits", id: <import id>, cost_cap_usd}` then `retry` the held tasks), `interrupted` (the app stopped: `retry`).
4. `queue_task {action: "cancel_import", id}` stops everything. Pods the import started are stopped when it ends; a pod that was already running is left running.
5. Every task's outcome is also in the History (`job: queue`).

**Log**
- 2026-11-07: built and tested with fakes; **never run against real pods**. First live run: record the pods used, whether `h100` creation worked, and how long a shot took (the estimate assumes 0.5 h per shot).
