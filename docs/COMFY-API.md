# The ComfyUI API, as this repo uses it

ComfyUI serves one HTTP API from the same port as its UI: 8188 for our image
and the Mac install, 3001 for RunPod's stock image. On a pod the base URL is
`https://<pod id>-<port>.proxy.runpod.net`, the `web_ui_url` the card shows; on
the Mac it is `http://127.0.0.1:8188`. There is no auth. Everything below is
what our code, the project's scripts and the MCP bridge (`apps/runpod-dashboard/mcp/comfy-bridge.mjs`) call; ComfyUI has more
(https://docs.comfy.org/development/comfyui-server/comms_routes).

## Health and readiness

| Call | Answers | Used by |
|---|---|---|
| `GET /system_stats` | 200 with versions, devices, VRAM | the image's health check; the card's readiness probe (`comfyReady` in `libs/core/src/pods.ts`): a running pod whose ComfyUI has not answered yet shows "ComfyUI starting" instead of a dead link |
| `GET /api/object_info` | the node catalog: every node class with its inputs | the UI loads it before the canvas appears; a 502 here with 200 on `system_stats` means ComfyUI is still importing custom nodes. `comfy workflow slots` and `capture` validate against it |

Through RunPod's proxy a request answers 502 until the pod's process listens;
the proxy itself is up as soon as the pod is. "Waiting for service to respond"
in the browser is that 502.

## Workflows (the UI's Workflows panel)

ComfyUI keeps the panel's files under `user/default/workflows/`, which on our
image is a link onto the volume at `/workspace/comfy-shared/workflows`
(ADR-006) and on the Mac a link onto `apps/comfy-app/workflows/`.

| Call | Does | Used by |
|---|---|---|
| `GET /api/userdata?dir=workflows&recurse=true` | lists the files in the panel | what we check on a new pod: nine names means the seed landed |
| `POST /api/userdata/workflows%2F<folder>%2F<name>.json?overwrite=false` with the graph as the body | saves a graph into the panel; `overwrite=true` replaces | `02_SCRIPTS/queue-graphs/corrosion_load-graphs_v002.py` posts the newest UI graph per shot under a `CANALV2_corrosion` folder; it queues nothing |
| `GET /api/userdata/<path>` | reads one back | the UI |

The path after `/api/userdata/` is URL-encoded as one segment (`%2F` for the
folder separators).

## Running a graph

| Call | Does | Used by |
|---|---|---|
| `POST /prompt` with `{"prompt": <API-format graph>, "client_id": "<any id>"}` | queues a run; answers `{"prompt_id": "...", "number": n}` or 400 with the invalid node | `corrosion_queue-api_v005.py`; `comfy run` |
| `GET /queue` | `{"queue_running": [...], "queue_pending": [...]}` | the idle watch's probe (`libs/core/src/idle.ts`): anything in either list means the pod is busy |
| `GET /history` and `GET /history/<prompt_id>`, `?max_items=1` | finished runs with their outputs | the queue script polls it every 15 s; the idle watch reads the newest entry and counts a new one as activity |
| `POST /interrupt` | stops the running prompt | the bridge's `interrupt` |
| `GET /view?filename=...&subfolder=...&type=output` (+ `preview=`, `channel=`, `format=`) | fetches a produced file | the UI; the bridge's `get_output` (text inline, images up to 1 MB as an image block); a Pull would use the volume instead |

Two graph formats exist. The panel holds **UI graphs** (nodes with positions,
what the canvas saves). `/prompt` takes **API graphs** (node id to class and
inputs, what "Export (API)" writes). The project keeps both beside each other
(`<shot>_graph_v###.json` and its `_api.json` twin); `comfy workflow capture`
converts a UI graph into a recipe.

Also through the bridge (every route exists bare and under `/api`):

| Call | Does | Bridge tool |
|---|---|---|
| `GET /prompt` | `{"exec_info": {"queue_remaining": n}}` | `get_prompt_info` |
| `POST /queue` with `{"clear": true}` or `{"delete": [ids]}` | empties the pending queue / removes those entries | `clear_queue`, `delete_queue_items` (confirm) |
| `POST /history` with `{"clear": true}` or `{"delete": [ids]}` | erases the history / those runs | `clear_history`, `delete_history_items` (confirm) |
| `POST /free` with `{"unload_models": bool, "free_memory": bool}` | unloads models / frees caches before the next prompt | `free_memory` (confirm) |
| `POST /prompt` then `GET /history/<id>` until it appears | queue and wait | `run_workflow` (same locked-shot gate as `queue_prompt`) |

## Nodes and models

| Call | Answers | Bridge tool |
|---|---|---|
| `GET /object_info/<class>` | one node class (`{}` when unknown) | `get_node_info` |
| `GET /models` | the model folder types | `list_model_folders` |
| `GET /models/<folder>` | files in a folder type (404 for an unknown type) | `list_models` |
| `GET /view_metadata/<folder>?filename=` | a safetensors file's embedded metadata (404 when none) | `get_model_metadata` |
| `GET /embeddings` | embedding names | `list_embeddings` |
| `GET /extensions` | frontend extension script paths | `list_extensions` |
| `GET /internal/folder_paths` | `{type: [paths, extensions]}` | `get_folder_paths` |

## Files in and out

| Call | Does | Bridge tool |
|---|---|---|
| `POST /upload/image`, multipart: `image` (file), `type` (`input`/`temp`/`output`), `subfolder`, `overwrite` | stores an image; answers `{name, subfolder, type}` (renamed when it exists and `overwrite` is false) | `upload_image` (local path or base64) |
| `POST /upload/mask`, the same plus `original_ref` (JSON `{filename, subfolder, type}`) | stores a mask as the alpha of that image | `upload_mask` |

## Workflows and user data, more

| Call | Does | Bridge tool |
|---|---|---|
| `GET /api/userdata?dir=<d>&recurse=&full_info=` | lists any user-data folder | `list_userdata` |
| `DELETE /api/userdata/workflows%2F<path>` | deletes a file (204; 404 when missing) | `delete_workflow` (confirm) |
| `POST /api/userdata/workflows%2F<path>/move/workflows%2F<dest>` | moves or renames (409 when the destination exists) | `move_workflow` |

## Server

| Call | Answers | Bridge tool |
|---|---|---|
| `GET /features` | feature flags | `get_features` |
| `GET /settings`, `GET /settings/<id>` | all settings / one value | `get_settings`, `get_setting` |
| `GET /internal/logs/raw` | `{entries: [{t, m}], size}`; the bridge returns the last N lines | `get_logs` |
| `GET /users` | storage mode and users | `get_users` |

## ComfyUI-Manager (read-only, only if installed)

| Call | Answers | Bridge tool |
|---|---|---|
| `GET /manager/version` (falls back to `/v2/manager/version`), `GET /manager/queue/status` | the Manager's version string and its task queue; 404 means no Manager | `manager_status` |
| `GET /customnode/installed` (falls back to `/v2/customnode/installed`) | installed packs: version, `cnr_id`, active/enabled | `list_installed_nodes` |

The bridge calls nothing else of the Manager: no install, update, uninstall,
fix, reboot or snapshot routes.

## Live updates

`WS /ws?clientId=<id>` streams `status`, `progress`, `executing` and
`executed` messages for the client's prompts. The UI uses it; our code does
not. A 502 on `/ws` while `system_stats` answers has the same meaning as on
`object_info`: still starting.

## Where the pieces are

- Readiness and the idle probe: `apps/runpod-dashboard/libs/core/src/pods.ts`, `idle.ts`.
- The two project scripts: `projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/` (read-only mirror; copies run from elsewhere with `--comfy <url>`).
- The `comfy` CLI wraps the same calls: `comfy nodes search`, `workflow slots`, `workflow capture`, `run`.
- Pod URLs and ports: `docs/MOUNT-POINTS.md`, `apps/comfy-app/README.md`.
