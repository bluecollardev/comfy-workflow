ors# The two MCP endpoints

**Status:** spec, 2026-10-21, for the Connect › MCP tab. The pod manager server exists
(`apps/runpod-dashboard/mcp/server.mjs`); the pod tools marked *new* and the whole
ComfyUI bridge are to build. Both are Node programs over the app's core, launched over
stdio by Claude Code or any MCP client; neither opens a port.

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
| `create_pod` | `approved_by` (required), `name`, `gpu` (table or `auto`), `datacenter`, `image` (`configured`, `prebuilt` or a reference), `idle_stop_minutes`, `apply_mounts`, `config` (a per-pod configuration) | the new pod; "no card available" lists what was tried | spend: named yes, USD cap |
| `stop_pod` / `resume_pod` / `delete_pod` | `pod_id` | confirmation; resume reports a full host and suggests `recreate_pod` | delete asks nothing, as the card does after its confirm |
| `recreate_pod` | `pod_id` | the new pod, the old one terminated, its own configuration carried | |
| `set_idle_stop` | `pod_id`, `minutes` (0 = never) | the new value | |
| `get_logs` | `pod_id`, `lines` (default 100) | the last lines from RunPod | |
| `list_datacenters` | none | every datacenter with S3 support and our cards in stock at the secure-cloud price | |
| `list_volumes` | none | the volumes with size, datacenter, cost per month, S3, the pods on each, the default | |
| `create_volume` | `approved_by` (required), `name`, `size_gb`, `datacenter` | the volume | spend (monthly) |
| `delete_volume` | `volume_id` | refused while a pod is attached | |
| `set_default_volume` | `volume_id` | the Default Configuration updated with the volume and its datacenter | |
| `get_configuration` | none | the Default Configuration: folders mapped, volume, datacenter, image, idle stop, mode | |
| `sync` | `pod_id`, `direction` (`push`/`pull`), `only` (folders), `plates`, `approved_by` | starts the copy in the app's job runner and returns the plan and transport; `sync_status` follows it | plates: named yes |
| `sync_status` | `pod_id` | folder N of M, percent, files, errors, done | |
| `cost_now` | none | running pods' price per hour summed, volumes' cost per month | |

## 2. ComfyUI bridge — `mcp/comfy-bridge.mjs` (*new*)

A local agent works inside the ComfyUI running in a pod, through the pod's proxy URL
(`https://<pod id>-8188.proxy.runpod.net`), or any ComfyUI URL (`--comfy <url>` or
`COMFY_URL`; the Mac's own install at `http://127.0.0.1:8188` works too). Without a
target it asks the core for the first running pod whose ComfyUI answers. It never
creates, stops or bills a pod: that stays with the pod manager. Calls are the ones in
`docs/COMFY-API.md`.

| Tool | Arguments | Answer | Gate |
|---|---|---|---|
| `comfy_status` | none | the target URL, versions, devices and VRAM from `/system_stats`; whether `/object_info` answers (nodes loaded) | |
| `list_workflows` | `folder` (optional) | the Workflows panel's files (`/api/userdata?dir=workflows&recurse=true`) | |
| `get_workflow` | `path` | the workflow JSON (UI graph) | |
| `save_workflow` | `path`, `workflow` (JSON), `overwrite` (default false) | saved, or refused because it exists | |
| `search_nodes` | `query`, `limit` (default 20) | node classes whose name or category matches, with their inputs, from `/object_info` | |
| `queue_prompt` | `prompt` (API-format graph), `client_id` (optional) | the prompt id and queue number; 400 with the invalid node when ComfyUI refuses | refused when the graph names a locked shot (`shared/governance`, the project's shot states) |
| `get_queue` | none | running and pending prompts | |
| `get_history` | `prompt_id` (optional), `max_items` (default 10) | finished runs with their outputs (filenames, subfolders, types) | |
| `interrupt` | none | the running prompt stopped | |
| `get_output` | `filename`, `subfolder`, `type` (default `output`) | small text files inline; otherwise the `/view` URL and size | |
| `wait_for_prompt` | `prompt_id`, `timeout_s` (default 600) | polls history until the prompt finishes; the outputs, or a timeout | |

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
| Claude Code | the `claude mcp add <name> -- node <path> [--comfy <url>]` line | stdio |
| Claude Desktop | the JSON block for `claude_desktop_config.json` | stdio |
| Codex CLI (OpenAI's agent; it runs GPT models) | the TOML block for `~/.codex/config.toml` (`[mcp_servers.<name>]`, `command`, `args`) | stdio |
| ChatGPT | the URL `http://127.0.0.1:<port>/mcp` and the command to start the server with `--http <port>`; ChatGPT only takes remote MCP servers, so a public URL needs a tunnel from this Mac | Streamable HTTP |

Both servers take `--http <port>` (or `MCP_HTTP_PORT`) to serve over HTTP on
127.0.0.1 instead of stdio; the same tools either way.

## Tests

The bridge over stdio against a fake ComfyUI HTTP server (every tool, the locked-shot
refusal); the pod manager's new tools over stdio in no-spend mode; a core test for the
endpoint list and the Check probe; a browser test for the tab against the fake API; an
Electron test pressing Check on the pod manager and reading its tools; the IPC table
test gains the `mcp` namespace.
