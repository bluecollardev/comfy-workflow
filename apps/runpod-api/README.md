# RunPod pod manager API (`apps/runpod-api`)

The Python service behind the RunPod dashboard: a FastAPI app that lists,
creates, stops, resumes and deletes RunPod GPU pods, plus the pool manager
it is built on and an MCP server that exposes the same pool to Claude Code.
Moved here from `infra/scripts/` in October 2026; the pod lifecycle CLI
(`create_pod.py`) stayed in `infra/scripts/`.

## Files

| File | What it is |
|---|---|
| `pod_manager_api.py` | The FastAPI app and its `uvicorn` entry point. Pod endpoints under `/api/pods`, `/api/dashboard`, a `/ws/pods` WebSocket, `/health`, and the built dashboard served at `/`. |
| `git_accounts.py` | Router: GitHub / GitLab OAuth connect, stored accounts, repo listing (`/api/git-accounts`, `/api/auth/{provider}/…`). |
| `repositories.py` | Router: saved repositories and repo/branch/folder search (`/api/repositories`, `/api/repos/…`). |
| `images.py` | Router: default env vars for a pod, read from the comfy-app Dockerfile's `ENV`/`ARG` lines (`/api/images/env`). |
| `pool_manager.py` | `PoolManager`, `PoolAgent`, `PodConfig`: pod orchestration over the RunPod SDK, used by the MCP server. |
| `mcp_server.py` | MCP server over stdio for Claude Code. Tools: `list_agents`, `get_pool_status`, `create_agent`, `stop_agent`, `resume_agent`, `delete_agent`, `health_check_agent`, `get_agent_info`, `submit_job`, `get_job_status`. See `docs/MCP-SERVER.md`. |
| `oauth_config.py`, `oauth_handler.py`, `oauth_routes.py` | RunPod OAuth2 and JWT handling. The handler is imported by the MCP server and covered by tests; the `/oauth` router is written but not mounted on the app. |
| `tests/` | pytest suite (`docs/TESTING.md`). `pytest.ini` beside it sets asyncio mode and markers. |
| `requirements.txt` | Everything above needs. The CLI in `infra/scripts/` has its own shorter list. |
| `legacy/` | `pod_dashboard.py`, the original single-file Flask dashboard on port 5000, and its HTML. Superseded by the API plus `apps/runpod-dashboard`; needs `flask`, which is not in `requirements.txt`. |

All modules import each other as flat siblings (`from pool_manager import …`),
so run things from this directory or with it on `sys.path`; do not nest them.

## Run it

```bash
pip install -r apps/runpod-api/requirements.txt
export RUNPOD_API_KEY=rpa_...

python3 apps/runpod-api/pod_manager_api.py      # http://localhost:8000, docs at /docs
```

With `apps/runpod-dashboard/dist` built (`npm run build` there), the API serves
the dashboard at `/`. During UI development Vite on port 5173 proxies to it
instead, see `apps/runpod-dashboard/README.md`. The Electron app starts this
API itself and, when packaged, carries a copy of this directory as
`resources/backend` (the `extraResources` rule in the dashboard's
`package.json`).

The MCP server:

```bash
cd apps/runpod-api && python3 mcp_server.py     # stdio; register the path with Claude Code
```

## Environment

| Variable | Default | Used by |
|---|---|---|
| `RUNPOD_API_KEY` | required | API, pool manager, MCP server |
| `API_HOST`, `API_PORT`, `API_RELOAD` | `0.0.0.0`, `8000`, `1` | `pod_manager_api.py` entry point |
| `UI_DIST_DIR` | `../runpod-dashboard/dist` | where the API looks for the built UI |
| `DOCKERFILE_PATH` | `../comfy-app/Dockerfile` | `images.py` env defaults |
| `GIT_ACCOUNTS_FILE`, `REPOSITORIES_FILE` | `~/.config/runpod-pod-manager/*.json` | stored accounts and repositories |
| `GITHUB_CLIENT_ID/_SECRET`, `GITLAB_CLIENT_ID/_SECRET`, `GITLAB_URL`, `FRONTEND_URL`, `API_BASE_URL` | unset | Git provider OAuth in `git_accounts.py`; providers show as disabled until set |
| `RUNPOD_CLIENT_ID/_SECRET`, `APP_URL`, `API_URL`, `REDIRECT_URI`, `SECRET_KEY`, `ENVIRONMENT` | see `oauth_config.py` | RunPod OAuth / JWT |

`oauth_config.py` also reads a `.env` in the working directory and ignores
unrelated keys.

## Tests

```bash
pytest apps/runpod-api/tests/ -m "not integration"   # required before any merge (CLAUDE.md)
pytest apps/runpod-api/tests/                        # includes the RunPod integration tests
```
