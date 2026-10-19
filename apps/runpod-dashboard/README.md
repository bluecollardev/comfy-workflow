# RunPod dashboard (`apps/runpod-dashboard`)

Vue 3 + Vite dashboard for managing RunPod pods

## Quick Start

### Install Dependencies
```bash
cd apps/runpod-dashboard
npm install
```

### Development (Hot Reload)
```bash
# Make sure FastAPI backend is running first:
# python3 apps/runpod-api/pod_manager_api.py

# Then in another terminal:
npm run dev
```

Then open: **http://localhost:5173**

### Build for Production
```bash
npm run build
# Output in apps/runpod-dashboard/dist/ (the API serves it at / when present)
```

## Features

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
