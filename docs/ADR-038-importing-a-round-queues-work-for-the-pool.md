# ADR-038: Importing a round queues one task per shot; pool pods take the tasks

**Date:** 2026-11-07
**Status:** Accepted; built on `feature/round-import-queue` (branched from `feature/run-workflows`, which it uses): the queue, the two windows, the settings and the MCP tools, with unit and browser tests. **Never run against real pods**; creating a pod uses the `h100` card (`POOL_GPU` in `queue.ts`) and the Default Configuration.
**Extends:** ADR-022 / ADR-035 (a pod pulls a round, picks a pod), ADR-033 (the round is placed), ADR-037 (run workflows on a pod), ADR-028 (MCP does what the window does). Governed by Binc's spend rules (`shared/governance/policy/agent-permissions.md`).

## Context

Lucas (2026-11-07): "i want a button, right side, with cta that allows user to import a round, a round import auto creates a bunch of pods, or queues the action. have a button in cta to view queue as well." Answers: one task per shot, run on pool pods; approve once per import with a cap, "except also have a default setting to disable cap"; the queue view shows all queued tasks and their pods.

Today a round is pulled with Pod download (one pod, one round), placed, and its graphs run one pod at a time by hand (ADR-037). The work is moving to a pool of H100 pods on one volume (ADR-035). Nothing coordinates which pod does which shot, and nothing keeps a list of what is waiting.

## Decision

1. **A call to action at the right of the top bar**, two buttons: **Import Round** (primary) and **Queue** (shows how many tasks are waiting or running).
2. **Import Round** opens a window: pick a round from the exchange bucket's rounds; it lists the shots found in the round (all ticked); the work per shot (pull and place once for the round, then **run that shot's workflows**, ticked by default); the pods (how many may run at once, their card and hourly price from the Default Configuration); and the **estimate and caps**. One **Approve and start** covers the whole import: its name goes on every task and every pod it starts (`approved_by`).
3. **The import creates tasks, in a queue that survives a restart** (`~/.config/runpod-pod-manager/queue.json`):
   - `pull` (once per round, on the volume; a verified pull places the round by itself, ADR-033, so there is no separate place task), then one `run` task per ticked shot, each running that shot's placed graphs (ADR-037, from the place report's graphs for that shot).
   - A `run` task waits for the `pull`. Tasks of different shots run in parallel, one per pod.
4. **The scheduler gives each task a pod** from the user's pods on the volume: a running pod that has no task (ADR-035's order), else a stopped pod restarted, else a pod created from the Default Configuration, **never more than the import's pod limit at once**. A pod the queue started or created is stopped when the queue has no more tasks for it (the pod's idle stop covers a crash). A pod that was already running is left running.
5. **Caps.** An import has a **pod limit** and a **dollar cap** (the estimate: pods x hourly price x the hours it expects; when the running total would pass the cap the queue stops starting pods and the rest wait, marked `held: cap`). Defaults in the Default Configuration: `import_max_pods` (default 2), `import_cost_cap_usd` (default 50), and **`import_cap_enabled`** (default on). Switching it off removes **the import's own** pod limit and dollar cap. It does **not** remove the governance cap: Binc's USD 100 total for agents and cloud GPU is enforced by the MCP server for agent calls and stays unless Brynley changes it.
6. **The Queue window** lists every task: round, shot, kind, state (waiting, running, done, failed, held, cancelled), the pod, started and finished times, the error. Per task: Cancel, Retry; per import: Cancel all. It refreshes by itself (a change event like the History).
7. **MCP** has the same: `import_round {round, shots?, run_workflows?, max_pods?, cost_cap_usd?, approved_by}`, `queue_list {}`, `queue_task {id, action: cancel|retry}` (ADR-028). A task that fails is logged to the History as a `queue` job event with its error (ADR-037's logging).
8. **A task that was running when the app stopped is marked `interrupted`**, not resumed blindly; Retry runs it again (a pull is resumable, a run starts the graph over).

## Not decided

- The estimate's hours: a pull is estimated from the round's size; a run has no known duration, so the estimate for a run task is the previous run of the same graph on this volume, else a flat 30 minutes. The cap is on the estimate plus what has been spent, so it is a guard, not an exact bill.
- Whether pods of the pool are created fresh or only started if they exist: v1 creates one from the Default Configuration only when none can be started, within the limit.
- A queue that outlives the app: tasks run only while the app (or its MCP server) is running here, because the scheduler lives in it. A pod that finished its task is stopped by its own idle timer if the app is closed.

## Consequences

- One approval starts a whole round across the pool, and the Queue shows what each pod is doing and what failed.
- The queue is the first persistent work list in the app, so a task's state is data that survives restarts and must be migrated if it changes.
- Spend is bounded by the pod limit and the dollar cap by default; switching the cap off is a deliberate setting, and is shown on the import window when it is off.
