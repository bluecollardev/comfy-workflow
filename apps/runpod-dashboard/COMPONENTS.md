# Frontend — components and styling

Vue 3 + Vite. **Bootstrap Vue Next** for components, **Bootstrap 5.3** dark mode for the theme, **Tailwind** for utilities, **Font Awesome** for icons. Same stack and wiring as `props-apps/apps/dashboard`.

## Wiring

| File | Role |
|---|---|
| `index.html` | `<html data-bs-theme="dark">` — Bootstrap's native dark mode; the app is dark-only |
| `src/assets/styles/app.scss` | Sets Bootstrap SCSS variables to the PocketPT palette, then imports Bootstrap. Also the card-header collapse-trigger styles. |
| `src/assets/styles/tailwind.scss` | Tailwind directives |
| `tailwind.config.js` | `preflight: false` (Bootstrap's reboot owns base styles); blocklists `collapse`/`container` which clash with Bootstrap classes; mirrors the palette as Tailwind colors |
| `src/main.js` | `createBootstrap()` plugin + the components registered globally by name |
| `src/api/pods.js` | Axios client. **Takes camelCase, sends snake_case** — components never build API payloads themselves |

### Palette (from PocketPT `libs/app/src/styles.tsx`)

| Bootstrap var | Value | Use |
|---|---|---|
| `$primary` | `#00B8EC` | buttons, links, total-pods accent |
| `$success` | `#55801F` | running (dark enough to carry white text) |
| `$danger` | `rgb(242,22,81)` | stopped, delete, errors |
| `$warning` | `#E9A93C` | starting / stopping |
| `$info` | `#6B57B5` | — |
| `$secondary` | `#444444` | count badge, outline buttons |
| body bg / card bg | `#1E1E1E` / `#262626` | |
| secondary text | `#BDC1C6` | labels, hints |
| borders | `rgba(255,255,255,.29)` | |

Add a color in `app.scss` **and** `tailwind.config.js` so both frameworks agree.

## Components

```
App
├─ Stats               (stats)
├─ Dashboard           (pods) ──emits pods-updated──▶ App
│  ├─ PodForm          ──emits pod-created──▶ Dashboard   (contains the Attach-node dialog)
│  └─ PodCard ×N       (pod, busy) ──emits stop | resume | delete──▶ Dashboard
├─ RepositoriesModal   opened via ui.repositoriesOpen
└─ GitAccountsModal    opened via ui.accountsOpen
```

`src/stores/ui.js` is a tiny reactive store for the two global modals plus `repositoriesVersion`, bumped whenever the attached list changes so open dialogs re-fetch. `src/api/git.js` is the client for everything git-related.

### Sources: accounts → repositories → nodes

0. **Configuration** (navbar, gear icon) — `ConfigModal.vue`. Maps the three required folders on this PC (project tree, plates, ComfyUI-Shared) and any custom folders of the user's own (name, local folder, pod path, optional path the code names), each with a Browse widget (`FolderPicker.vue`, backed by `GET /api/fs/dirs`), plus the pod's network volume ID, mount path, datacenter, extra env, and whether new pods apply it by default. Under each folder it shows the path the project tree declares for it, which a pod links onto the volume. Shows what a runtime on this PC and what a new pod receive. The pod form has a Mounts switch per pod and a link to this modal.
1. **Accounts** (navbar) — OAuth connect to GitHub / GitLab. "Connect" is a plain link to `/api/auth/<provider>/start`; the provider redirects back to the UI with `?provider=&connected=` or `&error=`, which `App` shows as a notice. Providers show as disabled until the API server has `<PROVIDER>_CLIENT_ID/_SECRET` (see `apps/runpod-api/git_accounts.py` for the full setup).
2. **Repositories** (navbar) — attach repositories to the project. The Repository field is a `datalist` autocomplete over `/api/repos/search` (every connected account's repos, private included; debounced) and also accepts a pasted URL. The Branch field autocompletes from `/api/repos/branches` (`git ls-remote`, no clone) and defaults to the repo's HEAD when left blank.
3. **Attach node** (Create pod → Custom nodes) — picks from the attached repositories (auto-selects the first), branch autocompletes from real branches, then `/api/repos/folders` lists the top-level folders (blob-less no-checkout clone, fast on big monorepos) with a filter and *Select shown*. *Add selected* writes one `repo#folder` line per pick (or `repo/tree/<branch>/<folder>` off `main`) into the Custom nodes textarea; *Add the whole repository* writes the bare URL. Lines can still be edited by hand.

### App.vue
Owns `{ stats, pods }` from `GET /api/dashboard`. Fetches on mount, every 30 s, and on **Refresh**. Only the first fetch shows a page spinner; later ones spin the button so the page doesn't flash. Renders the navbar and the top-level error alert.

### Stats.vue
`props.stats: { total_pods, running_pods, stopped_pods }` → three `BCard`s with a 4px colored left border. Missing counts render as 0.

### Dashboard.vue
`props.pods: Pod[]`. Two cards:
- **Create pod** — `BCard no-body`; the `card-header` is a `<button>` that toggles a `BCollapse` holding `PodForm`. Chevron on the right rotates 90° when open; the header's bottom rule is hidden while collapsed.
- **Pods** — count `BBadge` in the header; `BRow`/`BCol` grid (1 / 2 / 3 columns) of `PodCard`, or a "No pods" empty state.

Stop / resume / delete go through one `runAction(podId, apiFn, label)`; the affected card gets `busy` while in flight, then the list is re-fetched and emitted up.

### PodCard.vue
`props.pod`, `props.busy`. Status badge variant: running→success, stopped→danger, starting/stopping→warning, else secondary. Shows ID, GPU (+VRAM), uptime, a ComfyUI link and the SSH command when present. **Stop** (outline) or **Resume** (primary) depending on status, plus **Delete** (outline-danger) behind a `window.confirm`.

### PodForm.vue
`BForm` → `podsAPI.createPod(...)` → emits `pod-created` and resets.

| Field | API field | Notes |
|---|---|---|
| name | `name` | required |
| gpu | `gpu` | rtx4090 · a100 · h100 · l40s |
| gpuCount | `gpu_count` | 1–8 |
| instanceType | `instance_type` | on-demand · spot |
| volumeGb | `volume_gb` | 10–500 |
| diskGb | `disk_gb` | 5–100 |
| image / customImageUri | `image` | `"prebuilt"`, or the URI when *Custom image* is picked (URI then required) |
| startSsh | `start_ssh` | switch, default on |
| startJupyter | `start_jupyter` | switch, default off |
| envVars | `env_vars` + `build_args` | one table of rows `{ type: env \| arg, key, value }`; env rows → `env_vars`, build-arg rows → `build_args`; blank keys dropped; pasting `KEY=value` into a key field splits it. Rows are always grouped by type (group header with count); **Key** / **Value** headers sort inside the groups, **Type** flips which group is first — reordering happens on click/add/load, never while typing. **Load defaults** presets rows from the image (`/api/images/env?source=image`: its `ENV` read from the registry config without a pull, minus NVIDIA/toolchain variables, as env rows; plus the build `ARG`s of its source repo's Dockerfile with the `docker-bake.hcl` values as build-arg rows — source found via the `org.opencontainers.image.source` label or `KNOWN_SOURCES` in `images.py`; a Docker Hub image without a `latest` tag resolves to its newest tag) or from `apps/comfy-app/Dockerfile` (`source=dockerfile`, its `ENV` + `ARG`). Missing keys are added, existing values only overwritten with *Replace existing values* on. Build args (e.g. `CUDA_VERSION`, `TORCH_VERSION`, `XFORMERS_VERSION`, `CUDA_SHORT`, `PYTHON_VERSION` for `runpod-worker-comfyui`) are overridable here; a running pod can't rebuild its image, so the API exposes them to the pod as env vars without overriding an explicit env var |
| pipRequirements | `pip_requirements` | textarea passed through as a string |
| customNodes | `custom_nodes` | textarea, one pack per line: `repo`, `repo#subfolder`, or a GitHub `…/tree/<branch>/<subfolder>` link → `[{ name, url, branch, path }]` |

The three textareas sit in collapsed "advanced" sections under the main grid. Validation is the browser's (`required`, `min`/`max`); API errors show in an alert above the buttons.

**Custom nodes contract.** Each entry is one folder under `custom_nodes/`: `name` is that folder, `url`/`branch` the repo to clone, and `path` the subfolder inside it (empty = the whole repo is the pack). This supports both layouts — our own nodes in one monorepo with a subfolder per pack, and third-party packs that are one repo each. The API currently joins entries into a `CUSTOM_NODES=name:url:branch,…` env var (it expects objects, not strings — a bare URL list crashes on `n.get('name')`) and does not yet forward `path`; nothing in this repo consumes that env var, and the stock `ashleykza/comfyui` image is not known to either. Installing the packs on the pod is a pending backend task (startup script via `docker_args`, or a custom image) — see the help popover on the *Custom nodes* section for the user-facing format.

## Conventions
- Icons: Font Awesome `<i class="fa-solid fa-…">`. No emoji.
- Layout/spacing: Bootstrap utilities first (`d-flex`, `gap-*`, `g-3`); Tailwind utilities where Bootstrap has no equivalent.
- No per-component colors — use `variant`/`text-body-secondary`/`border-*` so everything follows the palette in `app.scss`.
- Buttons are flat Bootstrap variants; no gradients, no custom hover effects.

## Run
```bash
npm install
npm run dev          # http://localhost:5173, talks to the API on :8000
npm run build        # → apps/runpod-dashboard/dist, which the API serves at http://localhost:8000/
npm run test:e2e     # Playwright, ~5 s; the API is mocked (e2e/fixtures.js), no backend needed
```

`API_BASE` (`src/api/pods.js`) is cross-origin in dev and `/api` in a build, so the built UI is same-origin with the API wherever it is served from.

## Desktop app (Electron)

`electron/main.cjs` starts the FastAPI backend, waits for `/health`, and loads `http://localhost:8000` — the backend serves the built UI, so there is no `file://` loading and the OAuth redirect comes back into the window. External links (the pod's ComfyUI URL) open in the system browser.

```bash
npm run electron:dev     # Electron against the Vite dev server (+ the API, started if not already running)
npm run electron:pack    # unsigned app in dist-electron/ for a local check
npm run electron:build   # installers: macOS dmg+zip, Windows nsis, Linux AppImage
npm run icon             # re-render build/icon.png from electron/make-icon.mjs
```

The app needs a Python 3.12 environment for the backend; it looks for `$RUNPOD_MANAGER_PYTHON`, then `~/.config/runpod-pod-manager/venv`, then the repo `.venv` (dev), then `python3`. The backend scripts ship inside the app (`Resources/backend`), and its settings — `RUNPOD_API_KEY`, the GitHub/GitLab OAuth client ids/secrets — are read from `~/.config/runpod-pod-manager/.env`. If the backend cannot start, the app shows exactly which Python it tried and the two commands to set one up.

The icon is generated, not Electron's default: `build/icon.png` (1024 px, PocketPT palette), from which electron-builder produces `.icns`/`.ico`. In dev the macOS dock icon is set from the same file.
