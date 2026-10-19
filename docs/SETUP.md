# Setup Guide - On-Demand Pod

> **Status 2026-10-19: not done.** No pod has been created on the account and
> nothing has been rendered on RunPod. This guide is the how-to for when that
> starts; the plan for the CANALV2 job and what it waits on are in
> `NEXT-STEPS.md`, "RunPod: the plan, and that none of it has run".

Instructions for deploying and accessing ComfyUI on RunPod's on-demand infrastructure.

## Prerequisites

- [ ] RunPod account (https://runpod.io)
- [ ] API key configured (`RUNPOD_API_KEY` env var)
- [ ] RunPod CLI installed (`pip install runpod`)
- [ ] ComfyUI knowledge (basic workflows and prompts)

## Pod Selection

### Recommended Configuration (Phase 1)

**GPU Options (in order of preference):**
1. **RTX 4090** - Best value for interactive work
   - 24GB VRAM
   - ~$1.10/hr (RunPod Secure Cloud)
   - Excellent for 1080p-4K generation

2. **L40S** - Professional tier
   - 48GB VRAM
   - ~$1.80/hr
   - Better for very large batch sizes

3. **H100** - Enterprise (expensive, skip unless needed)
   - 80GB VRAM
   - ~$4.50/hr
   - Overkill for most ComfyUI work

### Storage Requirements

- **Container Disk:** 20-30 GB (OS + ComfyUI installation)
- **Volume:** 50-100 GB (models, LoRAs, checkpoints)

**Estimate:**
- 1-2 large checkpoints (.safetensors): ~10-20 GB
- 10-20 LoRAs: ~500 MB - 2 GB
- Control nets, VAEs, upscalers: ~5-10 GB
- Working space: ~10 GB

Start with 50 GB, expand as needed.

## Deployment Steps

### 1. Create RunPod Pod (Python Script)

```python
import runpod
import os

# Set API key
runpod.api_key = os.getenv("RUNPOD_API_KEY")

# Create pod
pod = runpod.create_pod(
    name="ComfyUI-Dev",
    image_name="ashleykza/comfyui:latest",  # Pre-built ComfyUI image
    gpu_count=1,
    volume_in_gb=50,
    container_disk_in_gb=20,
    min_bid=1.10,  # RTX 4090 price
    template_id=None,  # Or use a RunPod template ID
    env={
        "VRAM_OPTIMIZATION": "1",
    }
)

print(f"Pod created: {pod['id']}")
print(f"Status: {pod['runtime']['uptimeInSeconds']}")
```

### 2. Access the Pod

Once the pod is running:

- **Web UI:** `http://{pod_id}.proxy.runpod.io:8188`
- **SSH:** `ssh root@{pod_id}.proxy.runpod.io`
- **Terminal:** Available in RunPod dashboard

### 3. Upload Models & Custom Nodes

```bash
# SSH into pod
ssh root@{pod_id}.proxy.runpod.io

# Inside pod - copy models to ComfyUI
cd /workspace/ComfyUI/models/checkpoints
# Upload .safetensors or .ckpt files

# Or use RunPod's Volume mount
# Models persist across pod restarts if on a Volume
```

### 4. Verify ComfyUI is Running

```bash
curl http://{pod_id}.proxy.runpod.io:8188/system_stats
# Should return JSON with VRAM, CPU, etc.
```

## Workflow Integration

Once pod is running:

```bash
# From local machine (comfy_workflow directory)
export RUNPOD_POD_ID="your-pod-id"
export RUNPOD_POD_URL="http://${RUNPOD_POD_ID}.proxy.runpod.io:8188"

# Test connection
curl ${RUNPOD_POD_URL}/system_stats

# Submit workflow (future: integrate with comfy CLI)
# Instructions TBD
```

## Cost Tracking

**Running 8 hours/day:**
- RTX 4090: ~$8.80/day = ~$260/month
- L40S: ~$14.40/day = ~$430/month

**Optimization:**
- Stop pod when not in use (RunPod UI or API)
- Use serverless for batch jobs instead

## Pod Management

### Stop (Pause Billing)

```python
runpod.stop_pod(pod_id)
```

### Resume

```python
runpod.resume_pod(pod_id)
```

### Check Status

```python
pod = runpod.get_pod(pod_id)
print(pod['runtime']['uptimeInSeconds'])
print(pod['runtime']['gpuCount'])
```

### Terminate (Delete)

```python
runpod.terminate_pod(pod_id)
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Pod won't start | Check GPU availability, try different GPU type |
| ComfyUI slow | Reduce resolution or batch size, check VRAM |
| Models not loading | Verify storage volume mounted, check paths |
| Timeout accessing web UI | Check firewall, verify pod is running |

## Next Steps

- [ ] Determine final GPU choice
- [ ] Create pod
- [ ] Test ComfyUI web UI
- [ ] Upload test models
- [ ] Run sample workflow
- [ ] Document pod ID and access details
- [ ] Set up monitoring/cost tracking
