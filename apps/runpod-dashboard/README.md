# RunPod dashboard (`apps/runpod-dashboard`)

Installers: https://bluecollardev.github.io/downloads/ ([releases](https://github.com/bluecollardev/downloads/releases)); the pod image is [`ghcr.io/bluecollardev/comfy-app`](https://github.com/orgs/bluecollardev/packages/container/package/comfy-app). See the repo root README.

Vue 3 + Vite dashboard for managing RunPod pods

## Quick Start

### Install Dependencies
```bash
cd apps/runpod-dashboard
npm install
```

### Development (Hot Reload)
```bash
# One app: no backend. Hot reload runs inside the app window, the core over IPC:
# ./start.sh dashboard   (from the repo root)
# Or by hand:
npm run dev
```

Then open: **http://localhost:5173**

### Build for Production
```bash
npm run build
# Output in apps/runpod-dashboard/dist/ (the API serves it at / when present)
```

## Features

- ⚙️ Configuration (gear icon): the network volume and the mount points a pod needs, edited here and stored by the API, not hardcoded. `docs/MOUNT-POINTS.md`.

- 🚀 Real-time pod status updates
- ⚡ Hot reloading during development
- 📊 Beautiful dashboard UI
- 🎯 One-click pod actions (Stop/Resume/Delete)
- 🔗 Direct links to ComfyUI web UIs
- 📱 Responsive design

## Architecture

```
frontend/
├── index.html              # Entry point
├── vite.config.js          # Vite config with API proxy
├── package.json            # Dependencies
└── src/
    ├── main.js             # Vue app init
    ├── App.vue             # Root component
    ├── api/
    │   └── pods.js         # API client with axios
    └── components/
        ├── Dashboard.vue   # Main dashboard
        ├── PodCard.vue     # Individual pod card
        └── Stats.vue       # Statistics display
```

## API Integration

The frontend proxies API calls to the FastAPI backend:
- Development: `http://localhost:5173` → `http://localhost:8000/api/*`
- WebSocket: `ws://localhost:8000/ws/pods`

## Development Tips

### Hot Reload
Any change to Vue components auto-reloads instantly in the browser.

### API Debugging
Open browser DevTools → Network tab to see all API calls.

### WebSocket
The dashboard subscribes to `/ws/pods` for real-time updates (every 5 seconds from backend).

## Production Build

The build output goes to `apps/runpod-dashboard/dist/`.

To serve it from FastAPI:
1. Build: `npm run build`
2. Update `pod_manager_api.py` to serve static files from `dist/`
3. Deploy together

## Tech Stack

- **Vue 3** - Reactive UI framework
- **Vite** - Lightning-fast build tool & dev server
- **Axios** - HTTP client
- **FastAPI** - Backend API
- **WebSocket** - Real-time updates


## Packaging (2026-10-19)

The app is self-contained: the core (`libs/core`, TypeScript) runs in the main process and the
page loads from the app's own files. Build installers from the repo root:

```bash
./start.sh package mac                              # dmg + zip        -> dist-electron/contract-v26/
./start.sh package linux                            # AppImage + deb
./start.sh package win                              # nsis + portable; a stub here, run it on the Windows machine
./start.sh package all --comfy contract-v26 --image ghcr.io/<org>/comfy-app:contract-v26
```

`--comfy` names the comfy-app variant (a ShotPipe set from `shared/nodes/sets.json`, default
`contract-v26`) and `--image` the pushed reference of that build; both are baked into the app as
`build-info.json` and become the image a new pod boots by default. Without `--image` the local tag
is baked in and pod creation refuses it until it is pushed. There is no backend: the core
(`libs/core`) runs in the main process and the page reaches it over IPC; the MCP server (`mcp/`)
and the CLI (`cli/`) are Node programs over the same core (`docs/ADR-005-typescript-core-no-server.md`).
