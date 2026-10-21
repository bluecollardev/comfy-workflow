# The ComfyUI API, as this repo uses it

ComfyUI serves one HTTP API from the same port as its UI: 8188 for our image
and the Mac install, 3001 for RunPod's stock image. On a pod the base URL is
`https://<pod id>-<port>.proxy.runpod.net`, the `web_ui_url` the card shows; on
the Mac it is `http://127.0.0.1:8188`. There is no auth. Everything below is
what our code and the project's scripts call; ComfyUI has more
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
| `POST /interrupt` | stops the running prompt | nobody yet |
| `GET /view?filename=...&subfolder=...&type=output` | fetches a produced file | the UI; a Pull would use the volume instead |

Two graph formats exist. The panel holds **UI graphs** (nodes with positions,
what the canvas saves). `/prompt` takes **API graphs** (node id to class and
inputs, what "Export (API)" writes). The project keeps both beside each other
(`<shot>_graph_v###.json` and its `_api.json` twin); `comfy workflow capture`
converts a UI graph into a recipe.

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
