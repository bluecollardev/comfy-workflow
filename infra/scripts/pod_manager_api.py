#!/usr/bin/env python3
"""
FastAPI-based RunPod Pod Manager
RESTful API with interactive dashboard
Auto-generated API docs at /docs
"""

import os
import asyncio
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
    gpu: str = Field(default="rtx4090", description="GPU type")
    gpu_count: int = Field(default=1, description="Number of GPUs")
    instance_type: str = Field(default="on-demand", description="on-demand or spot")
    volume_gb: int = Field(default=50, description="Volume size in GB")
    disk_gb: int = Field(default=20, description="Container disk size in GB")
    image: str = Field(default="prebuilt", description="Docker image")
    env_vars: Optional[dict] = Field(default_factory=dict, description="Environment variables")
    build_args: Optional[dict] = Field(default_factory=dict, description="Image build ARG overrides (exposed to the pod as env, never over an explicit env var)")
    pip_requirements: Optional[str] = Field(default="", description="Custom pip packages")
    custom_nodes: Optional[list] = Field(default_factory=list, description="Custom node repos")
    start_ssh: bool = Field(default=True, description="Start SSH server")
    start_jupyter: bool = Field(default=False, description="Start Jupyter")


# ============================================================================
# API Routes
# ============================================================================

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

        pod_input = {
            "cloudType": request.instance_type,
            "gpuCount": request.gpu_count,
            "volumeInGb": request.volume_gb,
            "containerDiskInGb": request.disk_gb,
            "minVolumeInGb": request.volume_gb,
            "gpuTypeId": request.gpu,
            "name": request.name,
            "imageName": request.image if request.image != "prebuilt" else PREBUILT_IMAGE,
            "startJupyter": request.start_jupyter,
            "startSsh": request.start_ssh,
            "env": env_vars,
        }

        pod = runpod.create_pod(pod_input)

        if not pod or not pod.get('id'):
            raise HTTPException(status_code=500, detail="Failed to create pod")

        pod_id = pod.get('id')
        runtime = pod.get('runtime', {})

        return PodStatus(
            id=pod_id,
            name=request.name,
            status="starting",
            gpu=f"{request.gpu} x{request.gpu_count}",
            vram=24 * request.gpu_count,
            uptime_seconds=0,
            web_ui_url=f"http://{pod_id}.proxy.runpod.io:8188",
            ssh_command=f"ssh root@{pod_id}.proxy.runpod.io"
        )

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
            runtime = pod.get('runtime', {})
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
                web_ui_url=f"http://{pod_id}.proxy.runpod.io:8188" if is_running else None,
                ssh_command=f"ssh root@{pod_id}.proxy.runpod.io"
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
            runtime = pod.get('runtime', {})
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

        runtime = pod.get('runtime', {})
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
                    runtime = pod.get('runtime', {})
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

UI_DIST_DIR = os.path.abspath(os.getenv("UI_DIST_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "apps", "runpod-dashboard", "dist")))

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

    API_HOST (default 0.0.0.0), API_PORT (8000) and API_RELOAD ("1"; "0" for a packaged app)
    come from the environment so the Electron app can run it without a reloader.
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
        reload=os.getenv("API_RELOAD", "1") != "0",
        log_level="info",
    )


if __name__ == '__main__':
    main()
