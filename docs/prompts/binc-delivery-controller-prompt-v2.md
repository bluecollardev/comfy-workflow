# Prompt for Binc's agent: deliver the shots through RunPod Manager (v2)

Paste everything below the line as the agent's task. Revised 2026-11-19 from `SOURCE-binc-delivery-controller-prompt-2026-11-19.md` (kept verbatim beside this file).

---

You are delivering CANALV2 shot outputs to Binc. Use RunPod Manager, which already does this work. Do not build a new controller, dashboard or policy document.

## 0. How to work: plan first, document the plan, execute in sequence, report every minute

1. **Start in plan mode.** Before anything that changes state (dispatch, upload, sync, render, publish, any setting), work read-only: read this prompt, the MCP source (section 9), the Manager state (preflight, section 2) and the round. Do not call a tool that writes or spends until the plan below is written and Binc has approved it (exit plan mode only on his yes).
2. **Document the plan, for every run.** Each run gets a plan file before it starts, `04_TRACKER/plans/<yyyy-mm-dd>-<round>-run-<n>.md`, never overwritten (a new number for every run): the round and shots in the order they will run, the four stages per shot (section 1a) with the exit check of each, the card and pod chosen (section 2, item 4), the spend estimate against the cap, the named yes needed and from whom, expected frame counts (EDL cut for V11 clips), the risks you can see, and what you will do if each stage fails. While the run executes, append to the same file under a "Run log" heading: each step's start and end time, job ids, results, failures and the failure-log line, so the file is the readable record of that run. Link the plan file in the tracker.
3. **Execute in sequence.** Follow the plan's order exactly: one shot at a time through its four stages, one step at a time inside a stage, each step started only after the previous step's exit check has passed and is logged. Do not run shots or stages in parallel and do not reorder, with one exception: in stage 2 the Manager's pod pool runs different shots at the same time across up to `max_pods` pods, as set in the plan and approved by Binc (section 1a, stage 2). Nothing else is parallel. A failed step stops that shot, is logged and reported, and the run continues with the next shot in the plan (section 4); it is never retried out of turn.
4. **Report every minute while executing.** One line per minute to Binc (in the session and appended to the run log): time, round, shot, stage and step, job id, observed progress (frames, percent, rate), what comes next, and any failure or warning since the last line. While waiting, the line says what you are waiting for. Never go silent: if nothing changed, say "no change" with the time since the last progress event. Slack is not used for these lines; Slack is only for a review ready and for failures (stage 4 and section 7).

## 1. The rule

The Manager app is the controller. Its Queue persists on disk, reconciles with RunPod, enforces the spend cap and needs a named yes before spend. The Manager queue is the single writer: other sessions may prepare graphs and may not dispatch, retry or submit the same jobs. Do not write another scheduler, runner, daemon or state file. If something you need is not in the Manager, say exactly what is missing (section 11).

Keep active renders and transfers untouched. Leave CLAUDE.md unchanged. Keep credentials out of every log, message and file.

## 1a. The four stages (every shot goes through them in this order)

Work in four stages. A shot starts a stage only when the previous stage's exit check for that shot has passed and is logged. Shots run one after another in the plan's order (section 0), each through all four stages, with no overlap unless the plan says so and Binc approved it; no shot skips a stage. A failure at a stage stops that shot at that stage (section 4, log it, report it) and never blocks the other shots.

**Stage 1: Upload to the volume and verify through Import Round.**
- Put the round's graphs and inputs on the volume `a3upg9ey48` under `comfy-shared/workflows/<round>/` (the Manager's `sync` push of the `workflows` folder; never plates without Binc's named yes; nothing is overwritten or renamed, new files only).
- Verify with the Manager, not with your own scripts: `list_rounds` (`source: "volume"`) shows the round and its shots; `round_info` and `plan_round_import` / `import_plan` show every graph and the read-only preflight (every model a graph names exists on the volume; a miss says where the file is); `volume_changes` or `volume_files` show the files and sizes arrived.
- Exit check: the round is listed with all its expected shots, the preflight has no missing model, no locked or `04_GRAPH` shot is marked to run, sizes match the source. Log the check.

**Stage 2: Run the workflows.**
- Start with `import_round` (`source: "volume"`, Binc's named yes, the cost cap), one approved job first. The Manager queue runs one task per shot on a card from the allowed list (section 2, item 4).
- **Use several pods, as Import Round allows.** An import queues one run task per shot and the pool takes them; the number of pods is `max_pods` on `import_round` (and per round on `import_rounds`), the dollar limit is `cost_cap_usd`, and `cards` gives each shot an ordered list of allowed cards (section 2, item 4: every new pod asks them from the first; one datacenter, the first free card is used and the plan prices the most expensive). Defaults come from the Default Configuration (`import_max_pods`, `import_cost_cap_usd`; read with `get_configuration`). Plan first with `plan_round_import` (price, estimate, `remaining_usd`, `blocked`, `locked`, `refused`) and choose `max_pods` from the plan and the cap, not above the number of shots; change limits later with `queue_task` `set_limits`. The scheduler's order is: a running pod on the volume with no task, else a stopped pod restarted, else a pod created from the Default Configuration, never above `max_pods` and the cap; every pod stays on volume `a3upg9ey48`. One approval (Binc's named yes) covers the whole import. This is the only parallel step: shots run side by side across the pool in stage 2; every other stage and every shot's stage order stays in sequence (section 0).
- `run_shot_chunked` and `chunk_plan` are NOT the multi-GPU setting: they split one shot into consecutive frame ranges on one pod to keep RAM down (a shot killed with exit 137). Use them only for a shot that ran out of memory, and say so in the log.
- Monitor with `queue_list`, `get_comfy_runs`, `get_comfy_logs`, `pod_watch`; fail fast (section 4).
- Exit check: the sequence on the volume is complete (the DPX frame count equals what the graph and, for V11 clips, the EDL cut require, no missing ranges). An incomplete sequence is not sent on; log the gaps.

**Stage 3: Build the rendered sequences (ProRes).**
- Run `render_sequences` with `kind: "review"`, `codecs` including `prores422hq` (ProRes 422 HQ; add `h264` for the proxy), `where: "pod"` on a pod attached to the volume, the V11 EDL clip names (`clip_name`), the start timecode from the EDL (never a default), and the colour stated (`colour_in`; never guessed for a deliverable), `skip_existing` on.
- Output goes to `output/deliver/<shot>/v###/` with the `.meta.json` sidecars and `DELIVERY.md`; a new version every run, nothing overwritten.
- Exit check: the decoded frame count equals the DPX count, the sidecar is valid and says who stated the colour, no blocking flag (not in the EDL, no start timecode, colour not stated). Log it.

**Stage 4: Publish to S3 and notify through Slack, in two parts: 4a dry run, then 4b the real publish.** The first time a round is published it ALWAYS goes through 4a first. 4b never starts without 4a's check logged and Binc's named yes.

**Stage 4a: Dry run.** Nothing is uploaded and nothing is posted by you.
- Destination is `returns/BKK/<round>/<shot>/...` with `RETURN-MANIFEST.json`; the first run of a round uses a `_TEST_<date>` round name.
- Read the Auto-publish state with `autopublish` `settings` and `status`. If it is in **dry run**, run `autopublish` `scan_volume`, then `status` and `dry_run_report`: the S3 dry run (the exact keys it would write, sizes, skip-same-size, the manifest and inventory keys, the access check) and the Slack dry-run summary ("DRY RUN: nothing was uploaded"). If it is **live**, do not use it for the dry run and do not switch it (that is Binc's act in the window): use `publish` `plan` instead (free, writes nothing) and report that Auto-publish is live.
- Check the dry run against the plan: every expected file is listed with the right key and size; no blocking flag (not in the EDL, frame count differs from the EDL cut, no start timecode, colour not stated); the round name is right; the access check is OK (it cannot prove write access, say so); the Slack summary lists the same files; nothing is held or cancelled that should go.
- Exit check for 4a: write the dry-run report (files, bytes, destination, flags, access result, the Slack summary text) into the run log and the plan file, report it to Binc, and ask for his named yes for 4b. A dry run that shows any blocking flag, a wrong key, or a missing file stops here: report it, do not go on.

**Stage 4b: Actual publish.** Only after 4a passed and Binc has given his named yes for exactly this round and these versions (name, time and scope in the log).
- Publish through the Manager's `publish` (`run`, with Binc's `approved_by` and `confirm: true`) or let Auto-publish do it in the mode and state Binc has set (section 7: you do not switch it on or live). Only versions Binc has released leave the machine. Upload shot by shot as each is finished; the manifest is rewritten after each shot.
- Notify through Slack with the Manager's post (one per finished shot, with the folder link and the preview frame); never post from your own script or print the webhook.
- Exit check for 4b: the manifest lists every uploaded file with its sha256, the upload shows in `publish` `status` (children per shot), and the Slack post is in the log. A failed upload or post is retried only when the cause is transient (section 4); a failed shot does not stop the others.
- A real publish with no logged 4a, or beyond the scope Binc named, is a defect: stop and report it.

Log every stage entry, exit check (pass or fail, with the evidence) and hand-over to the next stage (section 10).

## 2. Preflight (do these first, report the results)

1. Manager version. Binc's machine reports 1.5.3. Needed: **1.7.0** (Publishing, Auto-publish, the V11 EDL checks, the colour setting, Generate Outputs, failure details over MCP). Binc is on Linux; build with `./start.sh package linux`. If it is still 1.5.3, state which parts are unavailable (publishing, Slack posting, Queue Generations and Publishing tabs, colour setting, Auto-publish, EDL checks) and use the 1.5.3 subset only: Import Round, Queue, `run_pod_workflows`, `render_sequences`, sync and pull. Do not simulate the missing parts with your own scripts.
2. The Manager app is running (background work lives inside it; a stdio MCP process keeps its jobs in its own memory). Check the MCP answers: `list_pods`, `queue_list`.
3. Pods: use only pods attached to volume `a3upg9ey48` (EU-RO-1). A pod on another volume, or whose volume you cannot confirm, is not used. Never create, resume, delete or recreate a pod without Binc's named yes and the cap check.
4. **Cards.** Run graphs on one of these cards, or on any other card with **48 GB to 96 GB** of VRAM: RTX 6000, RTX 6000 SXM, RTX 6000 PCI, RTX 6000 Ada, RTX A6000, L40, A40, PRO 6000 MIG 48GB, RTX PRO 6000 WK, H100 PCIe, H100 NVL. Check a card's name and VRAM with `list_gpus` (and `list_pods` for a running pod's card) before using it; the window is 48 GB to 96 GB inclusive. A pod with less VRAM (for example RTX 4000 Ada 20 GB or RTX PRO 4500 32 GB) is not used for graph runs, and a card above 96 GB is not used unless Binc says so. If none of the listed cards is available in the volume's datacenter (EU-RO-1), report exactly which were checked and stop: do not substitute a card outside the window and do not move the work to another datacenter or volume. The spend cap still applies to every card.
5. Keys present (RunPod, Panama bucket, Slack webhook): check that they are set; never print them.
6. Governance is read-only: `shared/governance/` and the CANALV2 tree. Nothing is renamed, moved, overwritten or deleted; every output is a new folder or a new version.

## 3. Dispatch through Import Rounds

**Round-based imports from the volume are the only way work enters.** Every job comes from an **Import Round with source `volume`** (the rounds under `comfy-shared/workflows/` on volume `a3upg9ey48`), so every job belongs to a named round and a shot of that round. Do not start a graph any other way: no direct `run_pod_workflows`, `submit_job`, `queue_task`, `run_shot_chunked` or hand-written script outside an import, and no import from the BH Panama bucket unless Binc says so. The round name is the unit everywhere: the dedupe key, the report, the failure log and the delivery round (`returns/BKK/<round>/`).

1. Reconcile BEFORE any submit or retry: `queue_list`, `list_pods`, `volume_jobs`, `get_history`. If a job for the same key already exists (queued, running, done, failed), do not submit it again.
2. Dedupe key: **shot + graph version + round**. One job per key.
3. Find work with `list_rounds` using `source: "volume"` (`comfy-shared/workflows/`), and `round_info` for one round. Plan with `import_plan` (`source: "volume"`, the round and the shots Binc named). Start with `import_round` using Binc's named yes (`approved_by`) and the cost cap. Never "run everything": the round or segment Binc named, at proxy, one step at a time.
4. Locked shots, and anything under `04_GRAPH`, are reference-only: place, never run.
5. Run the read-only preflight per graph before any pod time (models named in the graph exist on the volume; a miss says where the file is). A missing model is a failure to report, never to substitute.
6. Start small: one approved job first. Show its job id and observed progress before feeding the rest of the approved queue.

## 4. Fail fast: never wait all day on a failed graph

- A graph that cannot load or validate fails at once: ComfyUI `/prompt` `node_errors`, a preflight miss, `execution_error` in the run history. Mark it failed immediately.
- Every job has a hard time limit: 3 times the last successful run of that graph, otherwise 2 hours.
- Stall rule: no progress event for 10 minutes means failed.
- Retries: at most 2, after 5 then 20 minutes, only for transient causes (pod stopped, network error, HTTP 503). **Never retry a graph error.**
- A failed or stuck job is marked failed, logged (section 5), reported to Binc with the details, and the queue **moves on to the next job**. Do not sleep or poll in a loop waiting for a failed job.
- If 3 consecutive different graphs fail the same way, pause dispatch and report once with the shared cause. Resume only when Binc says so.

## 5. Failure log

Every graph failure appends ONE JSON line to the failures log. Location: `failures.jsonl` in the Manager's config folder (`~/.config/runpod-pod-manager/`) when your Manager version writes it; otherwise `<project>/04_TRACKER/failures/<date>.jsonl`. Fields:

`time`, `job_id`, `round`, `shot`, `graph` (name and version), `pod_id`, `card`, `stage` (`load` | `validate` | `queue` | `execute` | `encode` | `transfer`), `node_id` and `node_class` when ComfyUI gives them, `error` (first 500 characters), `log_tail` (last 20 lines of the ComfyUI log, secrets removed), `missing_model` and where it exists on the volume (from the preflight), `recovery` (taken or recommended), `attempt`.

Get these details ONLY through the Manager MCP: `get_comfy_runs`, `get_comfy_logs`, `queue_list`, `get_history`, `adapter_problems`. If a tool does not return a detail, write `"unavailable"` and name the tool; never guess a node, a cause or a model. If the MCP gives too little to diagnose a failure, report that as a missing capability (section 11). No credentials, URLs with tokens or webhook addresses in any line.

## 6. Delivery as Binc wants it

Outputs:
- Reviews land in `output/deliver/<shot>/v###/` with a `.meta.json` sidecar per file and `DELIVERY.md`. Never overwritten; a new version each run.
- Frames are never renamed or resized. DPX: 4K, 16-bit RGB, 3840x2160 as made, colour P3-D65, no handles, the EDL's record range with **retimes baked in** (EDL record frame counts: enhance-146 b 260, enhance-231 main 247, creature-266 breach-alt1 140). Flag the 1280x720 source of creature-266 breach-alt1 instead of claiming a 4K from it.
- Names: the **V11 EDL clip names** (`rounds/tunnel-v11-edl-2026-11-18/` in the exchange bucket; the Manager parses the `.edl`).
- Proxies: H.264, 1920x1080, 23.976, same name, frame count and start timecode as the DPX, no burn-ins, a **converted Rec.709 view** of the P3-D65 picture. Colour is stated, never guessed, for anything delivered.
- Start timecode, in this order: per-sequence value, DPX header, EDL source-in of the element's first event (stills start at 01:00:00:00). If none exists, **stop and flag the shot. Never write a default.**

Return layout, in the exchange bucket `returns/BKK/<round>/`:
- `<shot>/<clip>/<clip>.<frame>.dpx`, proxies at `<shot>/<clip>.mp4`, and `RETURN-MANIFEST.json` (schema `bh-return-1`, sha256 for every file) at the round root, merged after each shot. Upload finished shots as they finish, not in a full batch.
- First uploads go to a round named `_TEST_<date>`, small. Our key cannot delete; Kyle can delete a wrong folder.

Never deliver: anything not in the V11 EDL (archival-102 main-B), or a sequence whose frame count differs from the EDL cut unless Binc overrides it for that run. Carter-reframe: deliver v02 for both takes. cgi-090 shot 2 waits on Jon. Tunnel cannot pull from S3: Brynley pushes to Signiant after final QC. That step is not yours.

With Manager 1.7.0 this is done by Auto-publish (generate the review, publish to the BH bucket, post to Slack). Keep **Dry run** on until Binc has seen the dry-run summary; turning it off is Binc's act.

## 7. Review and release

- Binc inspects. Only the exact versions Binc has released leave the machine: Auto-publish must be in the **Approved review videos** mode, which only Binc sets in the Manager window (read it with `autopublish` `settings`). If it says "all review videos", or Auto-publish is live and Binc has not told you so, do not change it and do not publish: report it to Binc and wait for his answer on that item only, while the rest of the queue continues. Binc approves, holds and releases versions himself in the window; you can see them with `autopublish` `approvals` and `reviews`.
- Notify Binc at once when a review is ready and when anything fails: Slack `#panama-runpod` through the Manager (the webhook lives in Manager settings and is never printed), plus the Manager History. No other channel.
- Spend: Binc's USD 100 total cap for agents and cloud GPU applies. Stop and report before passing it.

## 8. State and restart

State is on disk in `~/.config/runpod-pod-manager/` (`mounts.json`, `autopublish-state.json`, `renders.json`, `imports/`, `history.jsonl`) and the queue's own files. After a restart, look at the Manager queue and History first, then continue; never re-submit a key that exists. Background work happens only while the Manager app runs: say so, and say if it is not running. Update the existing tracker (`04_TRACKER`) by appending status lines only; create no new dashboard.

## 9. Tools (read the MCP source first)

**Always read the MCP source before you call a tool.** Never guess a tool's name, argument or result. Read, in this order: `apps/runpod-dashboard/mcp/server.mjs` and `apps/runpod-dashboard/mcp/app-tools.mjs` (every tool, its arguments and its description), `docs/MCP-ENDPOINTS.md`, and the Manager's own `docs` and `mcp_endpoints` tools (they answer from the installed version). If the checkout is not on this machine, use `docs` and `mcp_endpoints` and say that the source was not available. When a tool is missing or an argument is refused, report the exact tool and message (section 11); do not work around it with a script.

Tools you will need, by job (Manager MCP, server `pod-manager`):

- **Read the rules and settings:** `governance`, `docs`, `mcp_endpoints`, `get_configuration`, `get_settings`, `agent_guard_status`.
- **Preflight and reconcile (before every submit or retry):** `list_pods`, `get_pod`, `list_gpus`, `list_datacenters`, `list_volumes`, `get_volume_info`, `queue_list`, `volume_jobs`, `volume_job`, `sync_status`, `get_history`, `export_history`, `cost_now`, `get_credits`, `get_spend_history`, `rate_limit_status`.
- **Rounds from the volume (the only way work enters):** `list_rounds`, `round_info`, `plan_round_import`, `import_plan`, `import_round`, `import_apply`, `import_detect`, `import_rounds`; adapters when a round needs one: `adapters_list`, `adapter_spec`, `adapter_problems`.
- **Pods (only with Binc's named yes and the cap check):** `resume_pod`, `create_pod`, `stop_pod`, `set_idle_stop`, `set_pod_round`, `set_pod_shot`.
- **Monitor a run:** `queue_list`, `queue_task` (the queue's own task actions: retry, cancel), `get_comfy_runs`, `get_comfy_logs`, `get_logs`, `pod_watch`, `pod_ram`, `list_outputs`, `volume_changes`.
- **Failures:** `failures` (the Manager's graph failure log), `adapter_problems`, `get_comfy_logs`.
- **Outputs, review, delivery:** `render_sequences`, `generate_existing` (preview only), `edl` (`load`, `status`, `elements`, `lookup`), `volume_files`. The `publish` tool has the actions `settings`, `local`, `volume`, `volume_size`, `plan`, `run`, `status`, `cancel`, `rounds`, `retry`, `slack`, `backfill`: `plan` and `status` are free, but `run`, `retry` and `slack` send files or a post and need Binc's named yes (`approved_by`, `confirm: true`). The `autopublish` tool has the actions `status`, `settings`, `approvals`, `reviews`, `cancel`, `off`, `scan_volume` and `dry_run_report`: it is read, cancel, off and scan only. Enabling Auto-publish, going live, approving or revoking a version, holding or releasing one, and Publish now are Binc's acts in the Manager window and answer 403 over MCP; do not look for a way around that, report it.
- **Settings you may change (preferences only):** `set_configuration`, `config_export`, `config_backups`. Never turn Auto-publish on, off or live for Binc: that confirmation is his.
- **Never call without Binc's explicit named yes, written in the log:** `delete_pod`, `delete_round`, `delete_volume`, `volume_erase`, `models_delete`, `recreate_pod`, `reset_configuration`, `resize_volume`, `volume_clone`, `set_default_volume`, `set_shared_volume`. Never delete model weights, tensors or anything under `models/`.

## 10. Full logging

Log everything you do, so any hour of the day can be reconstructed from the files alone.

- **Where.** The Manager records its own History (`get_history`, `export_history`) and the graph failure log (`failures`); you do not duplicate those. You also keep one append-only log of your own decisions: `04_TRACKER/logs/delivery-<yyyy-mm-dd>.jsonl` (one file per day, JSON lines, never edited or rewritten). It is a log, not state: state stays in the Manager.
- **Log before and after every tool call.** One line before (intent) and one after (result), so a crash leaves evidence. Fields: `time` (UTC, ISO), `session`, `step` (preflight, reconcile, dispatch, monitor, failure, review, release, transfer, notify), `tool`, `args` (secrets removed), `result` (ok or error, ids returned, counts, the first 300 characters of any error), `ms`, `round`, `shot`, `job_id`, `pod_id`.
- **Log decisions, not only calls:** why a job was dispatched, and why one was skipped (duplicate key, locked shot, cap reached, card outside 48 to 96 GB, model missing, no named yes); each reconcile result; each state change (queued, running, done, failed, cancelled); each retry (cause, attempt number, next try time); each notification sent (channel, what was said, to whom); each named yes used (who, when, what for); each spend estimate against the cap.
- **Heartbeat.** Every one-minute report of section 0 is also written to this log. When work is queued but nothing is executing (waiting for Binc, the cap, a card), write one status line every 15 minutes (counts per state, current job, time since the last progress event). A gap in the log means the controller was not running: say so in the next report.
- **Failures** go to `failures` through the Manager and to your log with the same job id; a failure with no log line is a defect.
- **Never log secrets:** no key values, no webhook URLs, no signed URLs or tokens, no passwords; log that a key was present, not what it was. Strip them from error text and command lines before writing.
- **In every report** give the log path and the last 5 lines of it.

## 11. Honesty and the first report

If an interface is missing, name it exactly (tool, version, field). Do not invent an API or claim background operation that is not running.

Your first report must contain: the Manager version and how it was checked; the real first job id; the state-file path; the log path; observed progress of that job; one completed job and one failed job (a real or a deliberately tiny one), each with its failure-log line where it failed. Not a plan.
