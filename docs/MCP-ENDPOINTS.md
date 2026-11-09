# The two MCP endpoints

**Status:** built 2026-10-21 as specified (the pod tools, the ComfyUI bridge, the HTTP
transport, the Connect › MCP tab with the client connectors); 2026-10-22: each server is
bundled into one file that the app's own executable runs (no Node install on the client's
side), and either can be served from inside the running app over HTTP. The sources are in
`apps/runpod-dashboard/mcp/`; the tab is Connect › MCP in the app. By default neither opens a port.

## Running

Three ways to run the same tools. The first two are a client launching a process over
stdio; the third is the app itself listening.

**1. Stdio, through the app's own executable (what the tab gives you).** The servers are
bundled, SDK included, into `mcp/dist/server.cjs` and `mcp/dist/comfy-bridge.cjs`
(`npm run mcp:bundle`; `npm run build` and `./start.sh package` do it first, and
electron-builder ships the folder as `resources/mcp`). The app's executable runs them as Node
with `ELECTRON_RUN_AS_NODE=1`, so nothing else has to be installed. Packaged, the snippets read:

```bash
claude mcp add pod-manager -e ELECTRON_RUN_AS_NODE=1 -- "/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager" "/Applications/RunPod Manager.app/Contents/Resources/mcp/server.cjs"
```

```json
{ "mcpServers": { "pod-manager": {
  "command": "/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager",
  "args": ["/Applications/RunPod Manager.app/Contents/Resources/mcp/server.cjs"],
  "env": { "ELECTRON_RUN_AS_NODE": "1" } } } }
```

```toml
[mcp_servers.pod-manager]
command = "/Applications/RunPod Manager.app/Contents/MacOS/RunPod Manager"
args = ["/Applications/RunPod Manager.app/Contents/Resources/mcp/server.cjs"]

[mcp_servers.pod-manager.env]
ELECTRON_RUN_AS_NODE = "1"
```

From a checkout the tab shows the Electron binary in `node_modules/electron/dist/` and
`mcp/dist/server.cjs` instead; if the bundle is missing the card says "Not built yet" with
the command (`npm run mcp:bundle`). The bundle finds the core beside itself (`../core`
packaged, `libs/core/dist` in a checkout; `CORE_DIR` overrides) and the shape and
governance copy under `resources/backend`. Check in the tab runs exactly the command the
snippets show.

**2. HTTP, hosted in the running app.** Each card has a **Serve from the app** switch
(`mcp-serve-<id>`) and a port field. On, the app's main process listens on
`127.0.0.1:<port>/mcp` (pod manager 8765, ComfyUI bridge 8766) with the SDK's Streamable HTTP
transport, stateless per request, with DNS-rebinding protection (the Host header must be
`127.0.0.1:<port>` or `localhost:<port>`). The state is the Default Configuration's
`mcp_http: { "pod-manager": { "enabled": false, "port": 8765 }, "comfy-bridge": { ... } }`
(off by default, ports 1024 to 65535 and distinct, validated in `libs/core/src/mounts.ts`),
applied at launch and when the switch changes; a port that is taken is refused with the
reason and the switch goes back. The card shows a **Serving :8765** badge, the **Remote
(HTTP)** client entry and ChatGPT's entry show the URL (ChatGPT still needs a public URL: tunnel
the port from this Mac), and Check asks the in-app endpoint with HTTP `initialize` and `tools/list`.
Hosted in the app the servers use the app's own state, not private copies: pods and no-spend
mode are the window's, the idle watch is the app's, and `sync` / `sync_status` drive **the
same job runner as the cards** (`sync` takes optional `shared` (an array of `input`, `models`, `output`, `workflows`: what a push carries, else the pod's or the default's `sync_shared`), `skip_renders`, `skip_tests` and `existing` (`update`, `size`, `checksum`, `replace`; SSH only); see ADR-011) (`electron/sync-jobs.cjs`, one job per pod), so a sync started
over MCP fills the card's bar and the Sync modal follows it, and a sync started on a card is
what `sync_status` reports. The hosted bridge discovers its target (the first running pod
with ComfyUI) unless `COMFY_URL` is set in the app's environment.

**3. Stdio from a checkout, for development.** `node apps/runpod-dashboard/mcp/server.mjs`
(`./start.sh mcp`, `npm run mcp`, `npm run mcp:bridge`) runs the sources directly and
keeps a private sync job map; `--http <port>` or `MCP_HTTP_PORT` serves them over HTTP from
that process. This is a developer path; end users use 1 or 2.

How it is built: `mcp/server.mjs` exports `createPodManagerServer({ core, syncHost })` and
`mcp/comfy-bridge.mjs` exports `createComfyBridgeServer({ core, target, project })`; each
returns an SDK server, and its `main()` (stdio / `--http`) runs only when the file is the
program being executed. `electron/mcp-host.cjs` serves the factories over HTTP with the
app's core and `electron/sync-jobs.cjs`; tested in a plain node process with a fake core
(`mcp/host.test.mjs`).

Conventions for every tool: arguments are a JSON object; the answer is text (JSON where
the result is structured); an error sets `isError` and says what to do; governance
(`shared/governance`) is sent as the server's instructions at initialize and the tools
that spend or touch client material are gated as the policy says; in no-spend mode the
pod manager acts on simulated pods and every answer says so.

## 1. Pod manager — `mcp/server.mjs`

An agent orchestrates RunPod the way the app does. Needs the RunPod key from the app's
settings, or no-spend mode.

### The pool (exists; ADR-002's agents are pods with a label)

| Tool | Arguments | Answer |
|---|---|---|
| `list_agents` | none | the pool as JSON |
| `get_pool_status` | none | counts, each agent's live status, cost per hour summed |
| `create_agent` | `approved_by` (required, the named yes), `agent_name`, `gpu_type` (the card table or `auto`), `storage_gb` | `✓ Agent created: <id>` with the ComfyUI and SSH URLs; refused without `approved_by` |
| `stop_agent` / `resume_agent` / `delete_agent` | `agent_id` | `✓ Agent stopped: <id>` etc. |
| `health_check_agent` | `agent_id` | `/system_stats` answered or not |
| `get_agent_info` | `agent_id` | the agent merged with its pod's live status |
| `submit_job` | `agent_id`, `workflow` (API graph) | the prompt id and status URL |
| `get_job_status` | `agent_id`, `job_id` | PENDING, COMPLETED with outputs, or ERROR |
| `governance` | `page` (optional) | the pages, or one page's text |

### Pods and the rest of the app (*new*: the same calls the cards and the panel make)

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `list_pods` | none | every pod as the dashboard shows it: id, name, status, card, ComfyUI URL, idle stop, own configuration | |
| `get_pod` | `pod_id` | the pod with RunPod's details: price per hour, cloud, datacenter, image, disks, status text | |
| `create_pod` | `approved_by` (required), `name`, `gpu` (table, big cards by name, or `auto`), `gpu_type_id` (a raw RunPod id), `gpu_count`, `datacenter`, `instance_type`, `disk_gb`, `volume_gb`, `image` (`configured`, `prebuilt` or a reference), `idle_stop_minutes`, `apply_mounts`, `start_ssh`, `start_jupyter`, `env_vars`, `pip_requirements`, `custom_nodes`, `config` (a per-pod configuration) | the new pod; "no card available" lists what was tried. A datacenter other than the volume's needs `apply_mounts=false` (ADR-027); a Blackwell card boots the `-cu13` image on a CUDA 13 host by itself (ADR-030) | spend: named yes, USD cap |
| `stop_pod` / `resume_pod` / `delete_pod` | `pod_id` | confirmation; resume reports a full host and suggests `recreate_pod` | delete asks nothing, as the card does after its confirm |
| `recreate_pod` | `pod_id` | the new pod, the old one terminated, its own configuration carried | |
| `set_pod_round` | `pod_id`, `round` (empty = out of its round) | the pod and its round | a map on our side only (ADR-039): the pod is not touched, no spend; list_pods and get_pod show `round` and `round_label` |
| `delete_round` | `round` | the round and how many pods left it | the pods keep running; only our map and name are cleared |
| `rename_round` | `round`, `name` (empty = the round's own) | the round and its shown name | the name is ours; the delivery round's own name stays the key |
| `rename_pod` | `pod_id`, `name` (empty = RunPod's own) | the name shown and RunPod's | a map on our side only: RunPod is not told; list_pods and get_pod show it; it goes with Recreate and goes on Delete |
| `get_history` | `kind` (`pod` or `job`, optional), `limit` (default 200) | the events newest first: pod created/started/stopped/recreated/renamed/deleted, and pull/remove/sync jobs with files and bytes | from this app's own log; IPC `history.list` |
| `get_spend_history` | none | total, running now, sessions and cost by day, with a note that it is an estimate | worked out from the pod events; IPC `history.spend` |
| `get_comfy_runs` | `pod_id` | the pod's ComfyUI runs newest first: status, started_at, duration_s, output files, error, `messages` (status timeline), `error_detail` (node, exception, traceback) | read from the pod's `/history` and `/queue`; the pod must be running (409 otherwise); IPC `history.runs` |
| `get_comfy_logs` | `pod_id`, `level` (all, warnings, errors), `lines` (default 300, max 2000) | ComfyUI's own server log from the pod, oldest first: `{entries:[{ts, level, text}], truncated}`; errors, warnings, missing models or nodes, OOM, tracebacks | GET `/internal/logs/raw`, else `/internal/logs`; the pod must be running (409), an old ComfyUI without the endpoint answers 501; IPC `history.logs` |
| `export_history` | `format` (`json` or `csv`), `what` (`events` or `spend`) | the file name and mime, then the file's text | read only, writes no file; IPC `history.export` |
| `get_credits` | none | the credits left on the account, the spend per hour now, the spend limit, hours left and a level (ok, low, critical); null in no-spend mode | RunPod's own balance; read it before starting anything that spends |
| `set_idle_stop` | `pod_id`, `minutes` (0 = never) | the new value | |
| `get_logs` | `pod_id`, `lines` (default 100) | the last lines from RunPod | |
| `list_datacenters` | `fresh?` | every listed datacenter with S3 support and every card RunPod runs there, free or in use, each with size, secure-cloud price, stock and whether the image can run it (ADR-027); most free cards first | |
| `list_volumes` | none | the volumes with size, datacenter, cost per month, S3, the pods on each, the default | |
| `create_volume` | `approved_by` (required), `name`, `size_gb`, `datacenter` | the volume, created in the datacenter named (a new region means a new volume) | spend (monthly) |
| `delete_volume` | `volume_id` | refused while a pod is attached | |
| `set_default_volume` | `volume_id` | the Default Configuration updated with the volume and its datacenter | |
| `get_configuration` | none | the Default Configuration: folders mapped, volume, datacenter, image, idle stop, mode | |
| `sync` | `pod_id`, `direction` (`push`/`pull`), `only` (folders), `plates`, `approved_by` | starts the copy in the app's job runner and returns the plan and transport; `sync_status` follows it | plates: named yes |
| `sync_status` | `pod_id` | folder N of M, percent, files, errors, done | |
| `adapter_spec` | none | the spec for writing an import adapter (`docs/IMPORT-ADAPTERS.md`) | |
| `adapters_list` | none | the import adapters, built-in and the user's own, with each one's code hash | |
| `adapter_save` | `id`, `source` | saves the module after a syntax and structure check, reporting structure problems; nothing is run | no approval step: the code is listed in Default Configuration > Import adapters, open to read, edit or delete |
| `import_plan` | `source`, `adapter` (optional) | which adapter recognises the folder, what it would copy where in ComfyUI-Shared by kind, findings; writes nothing | the adapter runs fenced, read-only on that folder |
| `import_apply` | `source`, `adapter`, `dry_run` (default true), `overwrite` | imports into this PC's ComfyUI-Shared; never deletes; a differing file is a conflict unless `overwrite` | the adapter runs fenced, read-only on that folder |
| `cost_now` | none | running pods' price per hour summed, volumes' cost per month | |

### Everything else the window does (ADR-028: *anything the app can do, the MCP can do*)

Each tool calls the core function the window's IPC channel calls. `mcp/parity.mjs` says which tool answers which channel of the app's dispatch table (`electron/core.cjs`), or why a channel needs a window (the git OAuth round trip, the Studio's chat loop, probing and serving the app's own MCP hosting); `mcp/parity.test.mjs` fails when a channel has neither. Also changed: `import_plan` / `import_apply` take a folder **or a `.zip`** (unpacked once into `import-zips/`, an entry that leaves the folder refused, `unzip` needed). The no-spend switch (`dry_run`) is never settable here. Keys and settings are the pod manager's own and take no named yes; their values are never returned, only whether set and the last four characters.

#### Pods and configuration

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `list_gpus` | `datacenter?` | The card menu with what RunPod has in stock and the on-demand price, for a datacenter (or the volume's, or anywhere): the table's cards, big ones included (explicit-only, ADR-026) |  |
| `get_volume_info` | `volume_id?` | The network volume a pod would use (the configured one, or the one named): size, datacenter, cost |  |
| `get_pod_config` | `pod_id` | A pod's own configuration (the Default Configuration's shape, kept for recreate_pod), or null when it uses the Default Configuration |  |
| `set_pod_config` | `pod_id`, `patch?`, `reset?`, `recreate?`, `approved_by?` | Change a pod's own configuration: a patch over its current one (or the Default Configuration), or reset it back to the default. | spend: named yes |
| `set_configuration` | `patch` | Change the Default Configuration: a patch (objects such as folders, env, required merge by key; lists and the rest replace). |  |
| `preview_configuration` | `patch?` | What a pod would get from a configuration without saving it: the env and the links. |  |
| `reset_configuration` | none | Delete the saved Default Configuration and go back to the defaults (the keys and settings are separate and stay) |  |
| `get_local_env` | none | The shell lines (export NAME=...) that set this PC up like a pod: the mapped folders as variables, for a terminal or an IDE run configuration |  |
| `list_dirs` | `path?`, `hidden?` | The folders on this PC under a path (the window's folder picker), for choosing what to map |  |

#### Keys and settings

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `get_settings` | none | The API keys and settings: whether each key is set and its last four characters, never a value; the Panama bucket, region and profile |  |
| `set_settings` | `values` | Set or remove the pod manager's own keys and settings: runpod_api_key, anthropic_api_key, runpod_s3_access_key, runpod_s3_secret_key, panama_aws_access_key, panama_aws_secret_key, panama_console_key, panama_bucket, panama_region, panama_profile. |  |
| `check_anthropic_key` | `key?` | Whether the Anthropic key (the one saved, or one passed to try) is accepted; used by the adapter drafting and describing tools |  |
| `config_export` | `file?`, `include_secrets?` | The Default Configuration as the JSON the window exports (folders, volume, image, env, adapters list, ...). |  |
| `config_import_plan` | `file` | What importing a configuration file would change, section by section (nothing is written): the folders (paths from another machine are flagged), the pod defaults, the keys (names and last four characters only) |  |
| `config_import_apply` | `file`, `sections?`, `dry_run?` | Import a configuration file: backs up first, then applies the sections named (default: the ones the plan ticks). |  |
| `config_undo` | none | Undo the last configuration import from its backup |  |
| `config_backups` | none | The backups of the configuration that imports made |  |

#### Volumes

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `resize_volume` | `approved_by?`, `volume_id`, `size_gb` | Grow a network volume (RunPod only grows them; billed monthly, USD 0.07 per GB). | spend: named yes |

#### Panama / BH rounds

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `panama_status` | none | Is the BH exchange bucket reachable: the bucket, region, how it is read (the keys in the app or an AWS profile), where rounds are staged on this PC, and whether Pod mode is available |  |
| `panama_rounds` | `target?` | The delivery rounds in the bucket with what is staged: on this PC (target local) or on the network volume as last seen by a pod (target pod). |  |
| `panama_round_files` | `round`, `prefix?`, `limit?` | One round's files in the bucket as a folder tree (read-only), each marked when already on this PC. |  |
| `panama_round_size` | `round` | Files and bytes in one round (a listing; a big round takes a few seconds) |  |
| `panama_pod_plan` | `round` | What a pod download of a round would do before it does it: use a pod of yours or start a short-lived one, its card and price, the volume, the size, the ceiling in minutes |  |
| `panama_pull` | `round`, `target?`, `approved_by?` | Download a round: to this PC (aws s3 sync, resumable, never deletes) or onto the network volume by a pod. | spend: named yes |
| `panama_job` | `id`, `target?` | Where a download (or delete) is: state, files, bytes done of total, rate, the latest files |  |
| `panama_cancel` | `id`, `target?` | Stop a download; what is already there stays and a later pull resumes |  |
| `panama_remove` | `round`, `target?`, `approved_by?` | Delete a round's staged copy: on this PC, or on the volume by a pod (needs approved_by: it uses a pod). | spend: named yes |
| `plan_round_import` | `round`, `shots?`, `run_workflows?`, `max_pods?`, `cost_cap_usd?` | What importing a round would do and cost: shots, price, estimate, caps (ADR-038). | read |
| `import_round` | `round`, `shots?`, `run_workflows?`, `max_pods?`, `cost_cap_usd?`, `approved_by` | Queue a pull and one run-workflows task per shot; pool pods take them within the limits. One approval covers the import. | spend: named yes |
| `queue_list` | | Every import and task with state, pod and error. | read |
| `queue_task` | `action`, `id`, `max_pods?`, `cost_cap_usd?` | `cancel`, `retry`, `cancel_import` or `set_limits`. | read/act |
| `list_pod_workflows` | `pod_id` | The graphs in a running pod's Workflows panel, grouped by folder (ADR-037). | read |
| `run_pod_workflows` | `pod_id`, `paths`, `approved_by` | Run chosen graphs on the pod one after another: convert with ComfyUI's frontend, queue, wait; every outcome and error goes to the History. Returns a job. | spend: named yes |
| `run_workflows_job` | `id`, `cancel?` | A run's graphs: waiting, running, done, failed (with the error) or skipped; `cancel` stops it. | read |
| `panama_place` | `round`, `pod_id?`, `dry_run?` | Put a pod-pulled round where its graphs look (ADR-033), on a running pod of yours: inputs linked into `input/rounds/<round>/` and at the shipped path when free (a differing file is a conflict, never replaced), each loaded file also hard-linked at the top of `input/` as a unique name `<shot>__<stem>__<sha8>.<ext>` (ComfyUI's dropdown lists only top-level files), path-corrected graph copies in `workflows/rounds/<round>/` using those names (the originals stay in the round folder, not in the Workflows panel). A pod pull does it by itself once its check passes; this re-runs it. `dry_run` defaults to true (report only). Idempotent |
| `panama_import` | `round`, `adapter?`, `dry_run?`, `overwrite?` | Import a downloaded round into ComfyUI-Shared (the window's Use): plans it through an adapter, and applies unless dry_run (default true). |  |

#### Import: packages, zips, adapters

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `import_detect` | `source` | Which adapters recognise a package, best first, with a match score. |  |
| `package_summary` | `source` | A package at a glance (the window's description input): file counts, folders, sample files. |  |
| `package_tree` | `source` | A package as a file tree (the Adapter Studio's explorer). |  |
| `package_file` | `source`, `path` | Read one file of a package, as the Adapter Studio shows it (text, or what it is). |  |
| `package_describe` | `source` | A written description of a package from Claude (needs the Anthropic key; sends file names and small text files to Anthropic). |  |
| `adapter_draft` | `source`, `id?` | Have Claude draft an adapter for a package (needs the Anthropic key). |  |
| `adapter_document` | `id` | Have Claude write the documentation header an adapter must carry (needs the Anthropic key). |  |
| `adapter_problems` | `id`, `source?` | Check an adapter's code: its structure problems and, with a package, whether a test plan on it runs |  |
| `adapter_manage` | `action`, `id?`, `from_id?`, `name?`, `new_id?`, `text?` | The adapters' housekeeping the Adapter Studio does: source (read the code), remove (a user's own, or reset a built-in override), template (a starter module), duplicate (from_id to id), get_prompt / save_prompt (the drafting prompt kept with it), rename (id and/or name), history (earlier versions), validate (check source text) |  |
| `sync_after` | `pod_id?` | What to sync to a pod after an import (the follow-up the window offers): the folders and the pod, or why nothing |  |

#### Images, git, repositories, MCP

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `image_env` | `source?`, `image?` | The ENV and ARG lines of the pod image (or the repo's Dockerfile) the form can load as pod environment |  |
| `image_dockerfile` | `image?` | The Dockerfile an image was built from (read from its registry), for the image menu |  |
| `git_accounts` | `action`, `id?`, `q?` | The git accounts connected (GitHub etc.): list, disconnect one, or list its repositories (q filters). |  |
| `repositories` | `action`, `url?`, `branch?`, `id?`, `q?` | The repositories attached to pods: list, add (url, branch), remove, search (GitHub), branches (of a url), folders (of a url and branch) |  |
| `remote_mcp` | `action` | The MCP servers this app uses (BH's console): status, or check (ask it for its tools). |  |
| `mcp_endpoints` | `comfy?` | The two MCP endpoints the app offers (this pod manager and the ComfyUI bridge) with their client configuration snippets, and what the bridge can point at. |  |

#### Documentation

| Tool | Arguments (`?` optional) | Does | Gate |
|---|---|---|---|
| `docs` | `page?`, `search?` | Our README, changelog and documentation (docs/*.md: the ADRs, setup, MCP, workflows). |  |


The README and these documents are also `docs://` resources; the `docs` tool excludes what the public documentation site leaves out. Live tests that create real pods use the cheap cards ([ADR-029](./ADR-029-live-tests-use-cheap-cards.md)).

## 2. ComfyUI bridge — `mcp/comfy-bridge.mjs`

A local agent works inside the ComfyUI running in a pod, through the pod's proxy URL
(`https://<pod id>-8188.proxy.runpod.net`), or any ComfyUI URL (`--comfy <url>` or
`COMFY_URL`; the Mac's own install at `http://127.0.0.1:8188` works too). Without a
target it asks the core for the first running pod whose ComfyUI answers. It never
creates, stops or bills a pod: that stays with the pod manager. Calls are the ones in
`docs/COMFY-API.md`.

Tools are grouped by the tag that leads each description (`[server]`, `[nodes]`, `[queue]`, `[files]`, `[workflows]`, `[manager]`). The last line of every description is `ComfyUI: <METHOD> <path>`, the upstream call(s), and every argument carries a description, type and where applicable default, enum and range: the app's Docs modal parses both. Destructive tools (`clear_queue`, `delete_queue_items`, `clear_history`, `delete_history_items`, `free_memory`, `delete_workflow`) refuse without `confirm: true` and say what they would do. ComfyUI-Manager tools are read-only: the bridge never installs, updates or removes a pack.

**server**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `comfy_status` | none | the target URL, versions, devices and VRAM from `/system_stats`; whether `/object_info` answers (nodes loaded); which tracker decides locked shots |  |
| `get_features` | none | the server's feature flags |  |
| `get_settings` | none | all user settings |  |
| `get_setting` | `id` | one setting's value |  |
| `get_logs` | `lines` (default 200) | the last N lines of the server log |  |
| `get_users` | none | storage mode and user ids |  |

**nodes**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `search_nodes` | `query`, `limit` (default 20) | node classes whose name, display name or category matches, with their inputs, from `/object_info` |  |
| `get_node_info` | `class_type` | one node class in full (`/object_info/{class}`) |  |
| `list_model_folders` | none | the model folder types |  |
| `list_models` | `folder` | the model files in a folder type |  |
| `get_model_metadata` | `folder`, `filename` | a safetensors file's embedded metadata |  |
| `list_embeddings` | none | textual-inversion embeddings |  |
| `list_extensions` | none | the frontend extension scripts custom nodes register |  |
| `get_folder_paths` | none | where ComfyUI looks for each file type |  |

**queue**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `queue_prompt` | `prompt` (API-format graph), `client_id` (optional) | the prompt id and queue number; 400 with the invalid node when ComfyUI refuses | refused when the graph names a locked shot (`shared/governance`, the project's shot states) |
| `run_workflow` | `prompt`, `client_id`, `timeout_s` (default 600) | queue + wait + the outputs in one call | the same locked-shot refusal as `queue_prompt` |
| `get_queue` | none | running and pending prompts |  |
| `get_prompt_info` | none | prompts remaining in the queue |  |
| `get_history` | `prompt_id` (optional), `max_items` (default 10) | finished runs with their outputs (filenames, subfolders, types) |  |
| `wait_for_prompt` | `prompt_id`, `timeout_s` (default 600) | polls history until the prompt finishes; the outputs, or a timeout |  |
| `interrupt` | none | the running prompt stopped |  |
| `clear_queue` | `confirm` | every pending prompt removed | `confirm: true` required |
| `delete_queue_items` | `prompt_ids`, `confirm` | those pending prompts removed | `confirm: true` required |
| `clear_history` | `confirm` | the run history erased (files stay) | `confirm: true` required |
| `delete_history_items` | `prompt_ids`, `confirm` | those runs erased from the history | `confirm: true` required |
| `free_memory` | `unload_models`, `free_memory` (both default true), `confirm` | models unloaded and/or caches freed | `confirm: true` required |

**files**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `get_output` | `filename`, `subfolder`, `type` (default `output`), `preview`, `channel`, `format` | small text inline; an image up to 1 MB also as an MCP `image` content block; otherwise the `/view` URL and size |  |
| `upload_image` | `file_path` or `data_base64` (+ `filename`), `subfolder`, `type` (default `input`), `overwrite` | the stored name, subfolder and type, ready for a LoadImage node |  |
| `upload_mask` | as `upload_image`, plus `original_filename`, `original_subfolder`, `original_type` | the mask applied to an already uploaded image |  |

**workflows**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `list_workflows` | `folder` (optional) | the Workflows panel's files |  |
| `get_workflow` | `path` | the workflow JSON (UI graph) |  |
| `save_workflow` | `path`, `workflow` (JSON), `overwrite` (default false) | saved, or refused because it exists |  |
| `list_userdata` | `dir`, `recurse` (default true), `full_info` | files in any user-data folder |  |
| `delete_workflow` | `path`, `confirm` | the workflow deleted | `confirm: true` required |
| `move_workflow` | `path`, `destination` | moved or renamed; refused when the destination exists |  |

**manager**

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `manager_status` | none | whether ComfyUI-Manager answers, its version and task queue (read-only) |  |
| `list_installed_nodes` | none | the installed custom node packs with version and state (read-only) |  |

Instructions sent at initialize: the governance pages as on the pod manager, plus one
line naming the target ComfyUI and that the bridge cannot spend.

## The tab in Connect

Per endpoint: purpose, the command, the `claude mcp add` line and the JSON snippet for
other clients, Copy buttons, and **Check** (the app spawns the server, performs
initialize and tools/list, shows the tool names, green or red). The bridge card has a
target menu: the running pods whose ComfyUI answers, or a typed URL; the chosen target
goes into the generated command.

## Connectors: the clients

Lucas: "i want connectors for gpt, claude, codex". Each endpoint card carries a ready
setup per client, with Copy buttons:

| Client | What the card gives | Transport |
|---|---|---|
| Claude Code | the `claude mcp add <name> -e ELECTRON_RUN_AS_NODE=1 -- <app executable> <bundle> [--comfy <url>]` line | stdio |
| Claude Desktop | the JSON block for `claude_desktop_config.json` (`command` = the app executable, `args`, `env`) | stdio |
| Codex CLI (OpenAI's agent; it runs GPT models) | the TOML block for `~/.codex/config.toml` (`[mcp_servers.<name>]`, `command`, `args`, and its `env` table) | stdio |
| ChatGPT | the in-app endpoint's URL `http://127.0.0.1:<port>/mcp` once Serve from the app is on; ChatGPT only takes remote MCP servers, so a public URL needs a tunnel from this Mac | Streamable HTTP |
| Remote (HTTP) | the same URL, for any client that takes a remote MCP URL | Streamable HTTP |

See "Running" above for the executable and bundle paths, packaged and from a checkout.

## Tests

The bridge over stdio against a fake ComfyUI HTTP server (every tool, the locked-shot
refusal); the pod manager's new tools over stdio in no-spend mode; the esbuild bundles run
alone, copied into a scratch folder laid out like `resources/` with no `node_modules`
(`mcp/bundle.test.mjs`); the factories served over HTTP by `electron/mcp-host.cjs` in a
plain node process with a fake core, from the sources and from the bundles: the shared
sync runner, Host-header protection, switching off, a port in use (`mcp/host.test.mjs`);
core tests for the endpoint list, the snippets, `mcp_http` validation and both probes
(stdio and HTTP); a browser test for the tab against the fake API (snippets, the switch, the
port, the Remote entry, a refused port); Electron tests pressing Check, then turning the switch on
in no-spend mode, POSTing `initialize` and `tools/call list_pods` to the port from the test
process, creating a simulated pod in the UI and seeing it in `list_pods`, starting a `sync`
over MCP and seeing the card's bar and the Sync modal follow the same job; the IPC table test
gains `mcp.serve`. `npm run mcp:test` bundles first.
