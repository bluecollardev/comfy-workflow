# ADR-038: Importing a round queues one task per shot; pool pods take the tasks

**Date:** 2026-11-07
**Status:** Accepted; built on `feature/round-import-queue` (branched from `feature/run-workflows`, which it uses): the queue, the two windows, the settings and the MCP tools, with unit and browser tests. **Never run against real pods**; creating a pod uses the `h100` card (`POOL_GPU` in `queue.ts`) and the Default Configuration.
**Extends:** ADR-022 / ADR-035 (a pod pulls a round, picks a pod), ADR-033 (the round is placed), ADR-037 (run workflows on a pod), ADR-028 (MCP does what the window does). Governed by Binc's spend rules (`shared/governance/policy/agent-permissions.md`).

## Context

Lucas (2026-11-07): "i want a button, right side, with cta that allows user to import a round, a round import auto creates a bunch of pods, or queues the action. have a button in cta to view queue as well." Answers: one task per shot, run on pool pods; approve once per import with a cap, "except also have a default setting to disable cap"; the queue view shows all queued tasks and their pods.

Today a round is pulled with Pod download (one pod, one round), placed, and its graphs run one pod at a time by hand (ADR-037). The work is moving to a pool of H100 pods on one volume (ADR-035). Nothing coordinates which pod does which shot, and nothing keeps a list of what is waiting.

## Decision

1. **Two buttons**: **Import Round** (green) in the **Rounds header** of the pod list (moved there from the top bar, Lucas 2026-11-09: "Rounds header should have import button for rounds ... like we used to have. this button will auto create pods for each shot"; ADR-039) and **Queue** at the right of the top bar (shows how many tasks are waiting or running).
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

## Amendment (2026-11-09): pods in the round, one pod per shot

- The pods the queue **creates** are put in the round being imported (ADR-039), so the Rounds list shows them under it. Pods it only restarts or reuses are not moved.
- The window's **pods at once** starts at the number of shots ticked (one pod per shot) and follows the ticks until it is typed over; before, it started at the Default Configuration's `import_max_pods`. The dollar cap and the governance cap still apply, and a shot waits when the limit is reached.

## Amendment (2026-11-09): several rounds at once

- The button reads **Import Round(s)** and the window lists the rounds with a tick each (and Browse files). Ticking a round loads its plan; shots are grouped by round.
- Each ticked round is its **own import** in the queue (own pull, own runs, own limits, cancelable alone). One approval covers them all.
- The **dollar cap** typed is the total and is split evenly between the rounds, so the sum of the caps never passes it; the estimate shown is the sum. **Pods at once** is per round and follows each round's ticked shots until typed over.

## Amendment (2026-11-09): the Import button is always shown; drop a round from the desktop

- The window's **Import** button is always visible at the bottom (it was hidden until a plan loaded); it is disabled with a one-line reason until a round is ticked, a shot is ticked and "Approved by" is filled.
- **Drag and drop** from the desktop onto the window: folders, files or a `.zip`. A zip is **extracted** (the existing safe unpack: no zip-slip, entry and size limits). The content is copied into a **new** folder under the staging folder (`ComfyUI-Shared/temp/rounds/<name>`), never overwriting (a taken name gets a `-2`); one folder or zip keeps its name, several things become `dropped-<date>-<time>`. The sources are only read.
- A dropped round appears under "From this PC" with an **Import** button that opens Import Shot Pack on that folder (adapter, plan, Import into ComfyUI-Shared). It does **not** use pods and costs nothing; the pods get the files with Sync. It is not queued, because the queue's pull comes from the bucket. MCP: `panama_stage`.
- The page needs the real path of a dropped item: Electron's `webUtils.getPathForFile` through the preload; a plain browser tab cannot see it and says so.

## Amendment (2026-11-09): three steps, and a card for each shot

- The window is a **three-step wizard**: **1 Choose rounds** (the list, Browse files, drop from the desktop), **2 Choose shots** (per round, and whether to run the workflows), **3 Choose cards** (a card for every ticked shot, or one for all; then the estimate and the caps). **Approved by**, Back, Next, Cancel and **Import** are in the modal footer on every step; Import is enabled on the last step once there is a shot and a name.
- A shot may have a **card** (a GPU key as in `list_gpus`). That shot's run gets a **pod of its own with that card**, created in the round's group; a shot with no card takes the pool as before (a pod already on the volume, else an H100). A card is not shared across shots, because the pool's pods do not say which card they have.
- The card's price is in the estimate (the run at the card's price, the pull at the pool price) and counts against the dollar cap at its own price; an unknown key is refused (`Unknown card`). MCP `plan_round_import` and `import_round` take `cards` (`{ shot: card }`).
