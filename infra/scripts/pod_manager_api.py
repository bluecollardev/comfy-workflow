#!/usr/bin/env python3
"""
FastAPI-based RunPod Pod Manager
RESTful API with interactive dashboard
Auto-generated API docs at /docs
"""

import os
import asyncio
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import runpod
import logging

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="RunPod Pod Manager API",
    description="API for managing RunPod GPU pods",
    version="1.0.0",
)

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
    volume_gb: int = Field(default=50, description="Volume size in GB")
    disk_gb: int = Field(default=20, description="Container disk size in GB")
    image: str = Field(default="prebuilt", description="Docker image")


# ============================================================================
# API Routes
# ============================================================================

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


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
# Serve Static Files (Dashboard UI)
# ============================================================================

@app.get("/", tags=["UI"])
async def root():
    """Serve dashboard HTML"""
    html_path = os.path.join(os.path.dirname(__file__), "pod_dashboard.html")
    if os.path.exists(html_path):
        return FileResponse(html_path)
    else:
        return {
            "message": "RunPod Pod Manager API",
            "docs_url": "/docs",
            "api_endpoints": {
                "dashboard": "/api/dashboard",
                "list_pods": "/api/pods",
                "get_pod": "/api/pods/{pod_id}",
                "stop_pod": "POST /api/pods/{pod_id}/stop",
                "resume_pod": "POST /api/pods/{pod_id}/resume",
                "delete_pod": "DELETE /api/pods/{pod_id}",
                "websocket": "WS /ws/pods"
            }
        }


def main():
    """Run the API server"""
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
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )


if __name__ == '__main__':
    main()
