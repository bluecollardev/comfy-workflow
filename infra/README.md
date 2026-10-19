# Infrastructure Setup

Automation scripts and configurations for managing ComfyUI infrastructure on RunPod.

## Structure

```
infra/
├── scripts/              # Python management scripts
│   ├── create_pod.py    # Pod lifecycle management (create, stop, resume, delete)
│   └── requirements.txt  # Python dependencies
├── docker/              # Docker image definitions
│   └── Dockerfile       # Custom ComfyUI image (extends prebuilt)
├── terraform/           # IaC (future: Terraform configs for complex setups)
└── README.md           # This file
```

## Quick Start

### 1. Install Dependencies

```bash
cd ~/workspaces/comfy_workflow/infra/scripts
pip install -r requirements.txt
```

### 2. Set RunPod API Key

```bash
export RUNPOD_API_KEY="your-api-key-from-runpod"
```

### 3. Create On-Demand Pod

```bash
python3 create_pod.py create \
  --name ComfyUI-Dev \
  --gpu rtx4090 \
  --volume 50 \
  --disk 20 \
  --image prebuilt
```

### 4. Check Pod Status

```bash
python3 create_pod.py list
python3 create_pod.py status --pod-id <pod-id>
```

## Scripts

### `create_pod.py`

Comprehensive pod management CLI.

**Commands:**

```bash
# Create new pod
python3 create_pod.py create --name MyPod --gpu rtx4090

# List all pods
python3 create_pod.py list

# Get pod status
python3 create_pod.py status --pod-id <id>

# Stop pod (pause billing)
python3 create_pod.py stop --pod-id <id>

# Resume stopped pod
python3 create_pod.py resume --pod-id <id>

# Delete pod
python3 create_pod.py delete --pod-id <id> --force
```

**GPU Options:**
- `rtx4090` - $1.10/hr, 24GB VRAM (recommended for dev)
- `l40s` - $1.80/hr, 48GB VRAM (for large batch)
- `h100` - $4.50/hr, 80GB VRAM (enterprise tier)

**Image Options:**
- `prebuilt` - ashleykza/comfyui (ready-to-use)
- `official` - comfy-org/comfyui (official image)
- Custom image name (provide full image name)

## Docker

### Building Custom Image

The image lives in `apps/comfy-app/` (Dockerfile, `build.sh`, `docker/`), the
same project that runs ComfyUI on the Mac. See `apps/comfy-app/README.md`.

```bash
cd apps/comfy-app
./build.sh                       # comfy-app:v26, linux/amd64
# Push to registry: separate step, needs Binc's yes on the registry name and account.
```

The pod manager's "Load defaults" for env vars reads that Dockerfile's `ENV`
and `ARG` lines (`DOCKERFILE_PATH` overrides the location).

Then deploy to RunPod with:
```bash
python3 create_pod.py create --name CustomPod --image <registry>/comfyui-custom:latest
```

## Terraform (Future)

Placeholder for Infrastructure-as-Code approach (TBD):
- Manage multiple pods
- VPC and networking
- Storage configuration
- Auto-scaling policies

## Cost Management

```bash
# Quick cost estimate for 8 hrs/day:
python3 << 'EOF'
gpus = {"rtx4090": 1.10, "l40s": 1.80, "h100": 4.50}
hours_per_day = 8
days_per_month = 30

for gpu, price in gpus.items():
    daily = price * hours_per_day
    monthly = daily * days_per_month
    print(f"{gpu}: ${daily:.2f}/day = ${monthly:.2f}/month")
EOF
```

Output:
```
rtx4090: $8.80/day = $264.00/month
l40s: $14.40/day = $432.00/month
h100: $36.00/day = $1080.00/month
```

## Monitoring

### Check GPU Availability

```bash
python3 create_pod.py list
```

### SSH Into Running Pod

```bash
ssh root@<pod-id>.proxy.runpod.io

# Inside pod
docker ps
nvidia-smi
curl http://localhost:8188/system_stats
```

### Web UI Access

```
http://<pod-id>.proxy.runpod.io:8188
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `RUNPOD_API_KEY not set` | Export or pass `--api-key <key>` |
| Pod creation timeout | Try different GPU type or wait for availability |
| ComfyUI won't start | Check volume is mounted, models path correct |
| SSH connection refused | Pod may still be starting, wait 60s |

## Next Steps

- [ ] Create first pod
- [ ] Test ComfyUI web UI
- [ ] Upload custom models
- [ ] Document pod ID in project notes
- [ ] Set up cost monitoring
- [ ] Test workflow submission
