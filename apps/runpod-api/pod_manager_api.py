#!/usr/bin/env python3
"""
FastAPI-based RunPod Pod Manager
RESTful API with interactive dashboard
Auto-generated API docs at /docs
"""

import os
import asyncio
from pathlib import Path
import json
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import runpod
import logging

from git_accounts import router as git_accounts_router, credentials_for
from images import router as images_router, PREBUILT_IMAGE
from repositories import router as repositories_router
import mounts
import governance
import gpus
import idle

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="RunPod Pod Manager API",
    description="API for managing RunPod GPU pods",
    version="1.0.0",
)

# Add CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(git_accounts_router)
app.include_router(repositories_router)
app.include_router(images_router)
app.include_router(mounts.router)

# ============================================================================
# Pydantic Models (Type-safe request/response schemas)
# ============================================================================

class PodStatus(BaseModel):
    """Pod status information"""
    id: str = Field(..., description="Pod unique identifier")
    name: str = Field(..., description="Pod display name")
    status: str = Field(..., description="Pod status (running, stopped, starting)")
    gpu: str = Field(..., description="GPU type (rtx4090, l40s, h100)")
    vram: int = Field(..., description="GPU VRAM in GB")
    uptime_seconds: Optional[int] = Field(None, description="Uptime in seconds")
    web_ui_url: Optional[str] = Field(None, description="ComfyUI web UI URL")
    ssh_command: str = Field(..., description="SSH connection command")
    idle_stop_minutes: int = Field(default=0, description="Stopped after this many quiet minutes; 0 = not watched")
    status_text: str = Field(default="", description="RunPod's own status line (lastStatusChange)")
    console_url: str = Field(default="", description="The pod in the RunPod console")


class DashboardStats(BaseModel):
    """Dashboard statistics"""
    total_pods: int = Field(..., description="Total number of pods")
    running_pods: int = Field(..., description="Running pods count")
    stopped_pods: int = Field(..., description="Stopped pods count")
    total_vram: int = Field(..., description="Total VRAM across all pods")


class DashboardData(BaseModel):
    """Complete dashboard data"""
    stats: DashboardStats
    pods: List[PodStatus]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    error: Optional[str] = None


class CreatePodRequest(BaseModel):
    """Request to create a new pod"""
    name: str = Field(..., description="Pod name")
    gpu: str = Field(default=gpus.DEFAULT, description="GPU key (a4000, a5000, rtx3090, rtx4090) or a RunPod gpu id")
    gpu_count: int = Field(default=1, description="Number of GPUs")
    instance_type: str = Field(default="spot", description="spot = community cloud (cheaper), on-demand = secure cloud")
    volume_gb: int = Field(default=0, description="Per-pod volume in GB; ignored (0) when the configured network volume is attached, which carries the data")
    disk_gb: int = Field(default=20, description="Container disk size in GB")
    image: str = Field(default="configured", description="configured = the image in the mount configuration (ours); prebuilt = ashleykza/comfyui; or an image reference")
    idle_stop_minutes: Optional[int] = Field(default=None, description="Stop after this many minutes with nothing queued; None = the configuration's value; 0 = never")
    env_vars: Optional[dict] = Field(default_factory=dict, description="Environment variables")
    build_args: Optional[dict] = Field(default_factory=dict, description="Image build ARG overrides (exposed to the pod as env, never over an explicit env var)")
    pip_requirements: Optional[str] = Field(default="", description="Custom pip packages")
    custom_nodes: Optional[list] = Field(default_factory=list, description="Custom node repos")
    start_ssh: bool = Field(default=True, description="Start SSH server")
    start_jupyter: bool = Field(default=False, description="Start Jupyter")
    apply_mounts: Optional[bool] = Field(default=None, description="Attach the configured network volume and COMFY_LINKS (GET /api/mounts); None = the config's apply_by_default")


# ============================================================================
# API Routes
# ============================================================================

def resolve_image(choice: str, mcfg: "mounts.MountsConfig") -> str:
    """The image a pod boots. `configured` is ours from the mount configuration; it must be a reference a pod can
    pull, i.e. carry a registry or namespace: a bare local name like comfy-app:contract-v26 means it has not been
    pushed yet, and a pod created with it would start, bill, and fail to pull."""
    image = {"configured": mcfg.image, "prebuilt": PREBUILT_IMAGE}.get(choice, choice).strip()
    if not image:
        raise HTTPException(status_code=400, detail="No image: set one in Configuration or pick one in the form")
    if "/" not in image:
        raise HTTPException(status_code=400, detail=f"{image} is a local image name; a pod cannot pull it. Push it to the registry Binc names (apps/comfy-app/build.sh, then docker push) and set that reference in Configuration.")
    return image


def _running_pod_ids() -> set:
    runpod.api_key = os.getenv('RUNPOD_API_KEY', '')
    return {p.get('id') for p in runpod.get_pods() if (p.get('runtime') or {}).get('uptimeInSeconds')}


def _stop_pod(pod_id: str) -> None:
    runpod.api_key = os.getenv('RUNPOD_API_KEY', '')
    runpod.stop_pod(pod_id)


@app.on_event("startup")
async def start_idle_watch():
    if os.getenv('RUNPOD_API_KEY') and os.getenv("IDLE_WATCH", "1") != "0":
        asyncio.create_task(idle.loop(_running_pod_ids, _stop_pod))


@app.get("/api/gpus", tags=["Pods"])
async def list_gpus():
    """The GPU menu: 16-24 GB cards, cheapest first; the job needs no more."""
    return {"default": gpus.DEFAULT, "gpus": gpus.menu()}


@app.put("/api/pods/{pod_id}/idle", tags=["Pods"])
async def set_idle(pod_id: str, minutes: int):
    """Watch a pod for idleness (minutes > 0) or stop watching it (0)."""
    idle.register(pod_id, minutes)
    return {"pod_id": pod_id, "idle_stop_minutes": max(minutes, 0)}


class SettingsUpdate(BaseModel):
    runpod_api_key: Optional[str] = None


_SETTINGS_ENV = Path(os.getenv("SETTINGS_ENV_FILE", Path.home() / ".config/runpod-pod-manager/.env"))


def _settings_view() -> dict:
    stored = {}
    if _SETTINGS_ENV.is_file():
        for raw in _SETTINGS_ENV.read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("="); stored[k.strip()] = v.strip().strip("'\"")
    key = os.getenv("RUNPOD_API_KEY") or stored.get("RUNPOD_API_KEY", "")
    return {"runpod_api_key_set": bool(key), "runpod_api_key_hint": f"••••{key[-4:]}" if key else "",
            "source": "environment" if os.getenv("RUNPOD_API_KEY") and not stored.get("RUNPOD_API_KEY") else (str(_SETTINGS_ENV) if stored.get("RUNPOD_API_KEY") else "none")}


@app.get("/api/settings", tags=["Settings"])
async def get_settings():
    """Whether the RunPod key is set and its last four characters; never the value. Same file the core and the shell read."""
    return _settings_view()


@app.put("/api/settings", tags=["Settings"])
async def put_settings(update: SettingsUpdate):
    if update.runpod_api_key:
        v = update.runpod_api_key.strip()
        if " " in v or len(v) < 16:
            raise HTTPException(status_code=400, detail="That does not look like a RunPod API key (no spaces, at least 16 characters)")
        _SETTINGS_ENV.parent.mkdir(parents=True, exist_ok=True)
        lines = _SETTINGS_ENV.read_text().splitlines() if _SETTINGS_ENV.is_file() else []
        done = False
        for i, raw in enumerate(lines):
            if raw.split("=", 1)[0].strip() == "RUNPOD_API_KEY":
                lines[i] = f"RUNPOD_API_KEY={v}"; done = True
        if not done:
            lines.append(f"RUNPOD_API_KEY={v}")
        _SETTINGS_ENV.write_text("\n".join(lines) + "\n"); os.chmod(_SETTINGS_ENV, 0o600)
        os.environ["RUNPOD_API_KEY"] = v
    return _settings_view()


@app.get("/api/pods/{pod_id}/details", tags=["Pods"])
async def pod_details(pod_id: str):
    """The pod as RunPod describes it (v2 REST): status text, price, place, card, image, console link."""
    import httpx
    api_key = os.getenv('RUNPOD_API_KEY')
    if not api_key:
        raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"https://api.runpod.io/v2/pods/{pod_id}", headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail=f"RunPod has no such pod ({pod_id})")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"RunPod answered {r.status_code}")
    d = r.json()
    running = (d.get("desiredStatus") or "").upper() == "RUNNING"
    return {"id": d.get("id"), "name": d.get("name", ""), "status": d.get("desiredStatus", ""), "status_text": d.get("lastStatusChange", ""),
            "cost_per_hr": d.get("cost", d.get("costPerHr")), "cloud": d.get("cloud", ""), "datacenter": d.get("dataCenterId", ""),
            "gpu": (d.get("gpu") or {}).get("id", ""), "gpu_count": (d.get("gpu") or {}).get("count", 1), "image": d.get("image") or d.get("imageName", ""),
            "disk_gb": d.get("disk", 0), "volume_gb": d.get("volume", 0), "created_at": d.get("createdAt", ""), "actions": d.get("actions", []),
            "console_url": f"https://www.runpod.io/console/pods/{pod_id}", "web_ui_url": idle.proxy_url(pod_id) if running else None, "ssh_command": f"ssh root@{pod_id}.proxy.runpod.io"}


@app.get("/api/pods/{pod_id}/logs", tags=["Pods"])
async def pod_logs(pod_id: str, tail: int = 100, source: Optional[str] = None):
    """The pod's log stream from RunPod, passed through as Server-Sent Events."""
    import httpx
    from fastapi.responses import StreamingResponse
    api_key = os.getenv('RUNPOD_API_KEY')
    if not api_key:
        raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")
    params = {"tail": tail}
    if source:
        params["source"] = source

    async def relay():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", f"https://api.runpod.io/v2/pods/{pod_id}/logs", params=params, headers={"Authorization": f"Bearer {api_key}", "Accept": "text/event-stream"}) as r:
                async for chunk in r.aiter_bytes():
                    yield chunk
    return StreamingResponse(relay(), media_type="text/event-stream")


@app.get("/api/governance", tags=["Governance"])
async def get_governance():
    """The rules applied to connecting agents: shared/governance, with the instructions the MCP server hands out."""
    return governance.summary()


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.post("/api/pods", response_model=PodStatus, tags=["Pods"])
async def create_pod(request: CreatePodRequest):
    """Create a new pod with advanced configuration"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key

        # Build environment variables. A pod can't rebuild its image, so ARG overrides reach it
        # as env vars (the images' start scripts read several of them); explicit env wins.
        env_vars = dict(request.env_vars or {})
        for key, value in (request.build_args or {}).items():
            env_vars.setdefault(key, value)

        # Add custom pip requirements if provided
        if request.pip_requirements:
            env_vars['CUSTOM_PIP_REQUIREMENTS'] = request.pip_requirements

        # Add custom nodes if provided: [{name, url, branch, path}] — path is a subfolder
        # of a monorepo (empty = the whole repo is the pack). JSON because URLs contain ':'.
        if request.custom_nodes:
            env_vars['CUSTOM_NODES'] = json.dumps(request.custom_nodes)
            # Only the hosts the pod has to clone from get a credential
            creds = credentials_for([n.get('url', '') for n in request.custom_nodes])
            if creds:
                env_vars['GIT_CREDENTIALS'] = json.dumps(creds)

        # Mounts: the configured network volume and the paths the entrypoint links (docs/MOUNT-POINTS.md).
        mcfg = mounts.load()
        apply = mcfg.apply_by_default if request.apply_mounts is None else request.apply_mounts
        volume_kwargs = {}
        volume_gb = request.volume_gb
        if apply:
            missing = mounts.missing_required(mcfg)
            if missing:
                raise HTTPException(status_code=400, detail=f"Not mapped on this PC: {', '.join(missing)}. Map them in Configuration (gear icon); in dev mode (COMFY_MODE=dev) plates are optional.")
            ov = mounts.pod_overrides(mcfg)
            for key, value in ov["env"].items():
                env_vars.setdefault(key, value)          # explicit env wins
            if ov.get("network_volume_id"):
                volume_kwargs = {"network_volume_id": ov["network_volume_id"], "volume_mount_path": ov["volume_mount_path"]}
                if ov.get("data_center_id"):
                    volume_kwargs["data_center_id"] = ov["data_center_id"]
                volume_gb = 0   # the network volume carries the data; a per-pod volume beside it is billed for nothing

        image = resolve_image(request.image, mcfg)
        try:
            gpu_id = gpus.runpod_id(gpus.DEFAULT if request.gpu == 'auto' else request.gpu)   # browser mode has no stock-aware auto; the core does
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        idle_minutes = mcfg.idle_stop_minutes if request.idle_stop_minutes is None else request.idle_stop_minutes

        # runpod.create_pod takes keyword arguments; cloud_type is ALL / SECURE / COMMUNITY.
        pod = runpod.create_pod(
            name=request.name,
            image_name=image,
            gpu_type_id=gpu_id,
            cloud_type={"on-demand": "SECURE", "spot": "COMMUNITY"}.get(request.instance_type, "ALL"),
            gpu_count=request.gpu_count,
            volume_in_gb=volume_gb,
            container_disk_in_gb=request.disk_gb,
            start_ssh=request.start_ssh,
            ports="8188/http,22/tcp",
            env=env_vars,
            **volume_kwargs,
        )

        if not pod or not pod.get('id'):
            raise HTTPException(status_code=500, detail="Failed to create pod")

        pod_id = pod.get('id')
        runtime = pod.get('runtime') or {}   # None for a stopped pod
        if idle_minutes and idle_minutes > 0:
            idle.register(pod_id, idle_minutes)

        return PodStatus(
            id=pod_id,
            name=request.name,
            status="starting",
            gpu=f"{request.gpu} x{request.gpu_count}",
            vram=gpus.vram(request.gpu) * request.gpu_count,
            uptime_seconds=0,
            web_ui_url=idle.proxy_url(pod_id),
            ssh_command=f"ssh root@{pod_id}.proxy.runpod.io",
            idle_stop_minutes=idle_minutes or 0,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating pod: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/pods", response_model=List[PodStatus], tags=["Pods"])
async def list_pods():
    """List all pods with their status"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        pods = runpod.get_pods()

        pod_list = []
        for pod in pods:
            pod_id = pod.get('id', 'unknown')
            runtime = pod.get('runtime') or {}   # None for a stopped pod
            uptime = runtime.get('uptimeInSeconds')

            # Determine if running
            is_running = uptime is not None and uptime > 0
            status = 'running' if is_running else 'stopped'

            pod_data = PodStatus(
                id=pod_id,
                name=pod.get('name', 'Unknown'),
                status=status,
                gpu=str(runtime.get('gpuCount', '?')),
                vram=24,  # Default, would need to enhance to get actual VRAM
                uptime_seconds=uptime,
                web_ui_url=idle.proxy_url(pod_id) if is_running else None,
                ssh_command=f"ssh root@{pod_id}.proxy.runpod.io",
                idle_stop_minutes=(idle.entry(pod_id) or {}).get("minutes", 0),
                status_text=pod.get('lastStatusChange') or '',
                console_url=f"https://www.runpod.io/console/pods/{pod_id}",
            )
            pod_list.append(pod_data)

        return pod_list

    except Exception as e:
        logger.error(f"Error listing pods: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard", response_model=DashboardData, tags=["Dashboard"])
async def dashboard():
    """Get complete dashboard data"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        pods = runpod.get_pods()

        pod_list = []
        running_count = 0
        total_vram = 0

        for pod in pods:
            pod_id = pod.get('id', 'unknown')
            runtime = pod.get('runtime') or {}   # None for a stopped pod
            uptime = runtime.get('uptimeInSeconds')
            is_running = uptime is not None and uptime > 0

            if is_running:
                running_count += 1

            pod_list.append(PodStatus(
                id=pod_id,
                name=pod.get('name', 'Unknown'),
                status='running' if is_running else 'stopped',
                gpu=str(runtime.get('gpuCount', '?')),
                vram=24,
                uptime_seconds=uptime,
                web_ui_url=f"http://{pod_id}.proxy.runpod.io:8188" if is_running else None,
                ssh_command=f"ssh root@{pod_id}.proxy.runpod.io"
            ))

        stats = DashboardStats(
            total_pods=len(pods),
            running_pods=running_count,
            stopped_pods=len(pods) - running_count,
            total_vram=total_vram
        )

        return DashboardData(stats=stats, pods=pod_list)

    except Exception as e:
        logger.error(f"Error getting dashboard: {e}")
        return DashboardData(
            stats=DashboardStats(total_pods=0, running_pods=0, stopped_pods=0, total_vram=0),
            pods=[],
            error=str(e)
        )


@app.get("/api/pods/{pod_id}", response_model=PodStatus, tags=["Pods"])
async def get_pod(pod_id: str):
    """Get specific pod details"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        pod = runpod.get_pod(pod_id)

        if not pod:
            raise HTTPException(status_code=404, detail="Pod not found")

        runtime = pod.get('runtime') or {}   # None for a stopped pod
        uptime = runtime.get('uptimeInSeconds')
        is_running = uptime is not None and uptime > 0

        return PodStatus(
            id=pod_id,
            name=pod.get('name', 'Unknown'),
            status='running' if is_running else 'stopped',
            gpu=str(runtime.get('gpuCount', '?')),
            vram=24,
            uptime_seconds=uptime,
            web_ui_url=f"http://{pod_id}.proxy.runpod.io:8188" if is_running else None,
            ssh_command=f"ssh root@{pod_id}.proxy.runpod.io"
        )

    except Exception as e:
        logger.error(f"Error getting pod {pod_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pods/{pod_id}/stop", tags=["Pods"])
async def stop_pod(pod_id: str):
    """Stop a running pod"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        runpod.stop_pod(pod_id)
        return {"message": f"Pod {pod_id} stopped", "pod_id": pod_id}

    except Exception as e:
        logger.error(f"Error stopping pod {pod_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/pods/{pod_id}/resume", tags=["Pods"])
async def resume_pod(pod_id: str):
    """Resume a stopped pod"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        runpod.resume_pod(pod_id)
        return {"message": f"Pod {pod_id} resumed", "pod_id": pod_id}

    except Exception as e:
        logger.error(f"Error resuming pod {pod_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/pods/{pod_id}", tags=["Pods"])
async def delete_pod(pod_id: str):
    """Delete/terminate a pod"""
    try:
        api_key = os.getenv('RUNPOD_API_KEY')
        if not api_key:
            raise HTTPException(status_code=401, detail="RUNPOD_API_KEY not set")

        runpod.api_key = api_key
        runpod.terminate_pod(pod_id)
        return {"message": f"Pod {pod_id} deleted", "pod_id": pod_id}

    except Exception as e:
        logger.error(f"Error deleting pod {pod_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# WebSocket for Real-time Updates
# ============================================================================

@app.websocket("/ws/pods")
async def websocket_pods(websocket: WebSocket):
    """WebSocket endpoint for real-time pod updates"""
    await websocket.accept()
    try:
        while True:
            # Send dashboard data every 5 seconds
            await asyncio.sleep(5)

            api_key = os.getenv('RUNPOD_API_KEY')
            if not api_key:
                await websocket.send_json({"error": "RUNPOD_API_KEY not set"})
                continue

            try:
                runpod.api_key = api_key
                pods = runpod.get_pods()

                pod_list = []
                for pod in pods:
                    pod_id = pod.get('id', 'unknown')
                    runtime = pod.get('runtime') or {}   # None for a stopped pod
                    uptime = runtime.get('uptimeInSeconds')
                    is_running = uptime is not None and uptime > 0

                    pod_list.append({
                        'id': pod_id,
                        'name': pod.get('name', 'Unknown'),
                        'status': 'running' if is_running else 'stopped',
                        'gpu': str(runtime.get('gpuCount', '?')),
                        'uptime_seconds': uptime
                    })

                await websocket.send_json({
                    "type": "pods_update",
                    "pods": pod_list,
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                await websocket.send_json({"error": str(e)})

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")


# ============================================================================
# Serve the built UI (apps/runpod-dashboard/dist, or UI_DIST_DIR) at /
# ============================================================================

UI_DIST_DIR = os.path.abspath(os.getenv("UI_DIST_DIR", os.path.join(os.path.dirname(__file__), "..", "runpod-dashboard", "dist")))

if os.path.isdir(os.path.join(UI_DIST_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(UI_DIST_DIR, "assets")), name="ui-assets")


@app.get("/", include_in_schema=False)
async def root():
    index = os.path.join(UI_DIST_DIR, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return {
        "message": "RunPod Pod Manager API — run `npm run build` in apps/runpod-dashboard to serve the UI here",
        "docs_url": "/docs",
    }


def main():
    """Run the API server.

    API_HOST (default 0.0.0.0), API_PORT (8000) and API_RELOAD (default "0") come from
    the environment. API_RELOAD=1 restarts on edits to this directory only: watching the
    repo root would include the ComfyUI install, and a reload that fails to import leaves
    the socket bound with nothing answering, which is how a stale server stalls clients.
    """
    import uvicorn

    print("""
╔════════════════════════════════════════════════════════════╗
║         RunPod Pod Manager API (FastAPI)                   ║
╠════════════════════════════════════════════════════════════╣
║                                                              ║
║  🌐 Dashboard:  http://localhost:8000                        ║
║  📚 API Docs:   http://localhost:8000/docs                   ║
║  ⚡ ReDoc:      http://localhost:8000/redoc                  ║
║                                                              ║
║  WebSocket:     ws://localhost:8000/ws/pods                  ║
║                                                              ║
║  Press Ctrl+C to stop                                       ║
║                                                              ║
╚════════════════════════════════════════════════════════════╝
    """)

    uvicorn.run(
        "pod_manager_api:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", "8000")),
        reload=os.getenv("API_RELOAD", "0") == "1",
        reload_dirs=[os.path.dirname(os.path.abspath(__file__))],
        log_level="info",
    )


if __name__ == '__main__':
    main()
