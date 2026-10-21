# Infrastructure Setup

Automation scripts and configurations for managing ComfyUI infrastructure on RunPod.

## Structure

```
infra/
├── scripts/
│   ├── setup.sh         # Installs the CLI deps and creates a first pod
├── pod-config.yaml      # Pod specifications
├── setup-team.sh        # Team machine setup (Homebrew, Python, Node, Terraform)
├── terraform/           # IaC (future)
└── README.md            # This file
```

Not here any more: the pod manager API, pool manager and MCP server are the
`apps/runpod-dashboard/` app (its core, MCP server and CLI), and the ComfyUI Docker image is `apps/comfy-app/`.

## Quick Start

### 1. Install Dependencies

```bash
cd ~/workspaces/comfy_workflow
# nothing to install: the CLI is part of the app (./start.sh installs it on the first run)
```

### 2. Set RunPod API Key

```bash
export RUNPOD_API_KEY="your-api-key-from-runpod"
```

### 3. Create On-Demand Pod

```bash
./start.sh pod create \
  --name ComfyUI-Dev \
  --gpu rtx4090 \
  --volume 50 \
  --disk 20 \
  --image prebuilt
```

### 4. Check Pod Status

```bash
./start.sh pod list
./start.sh pod status --pod-id <pod-id>
```

## Scripts

### `./start.sh pod` (apps/runpod-dashboard/cli/index.mjs)

Comprehensive pod management CLI.

**Commands:**

```bash
# Create new pod
./start.sh pod create --name MyPod --gpu auto

# List all pods
./start.sh pod list

# Get pod status
./start.sh pod status --pod-id <id>

# Stop pod (pause billing)
./start.sh pod stop --pod-id <id>

# Resume stopped pod
./start.sh pod resume --pod-id <id>

# Delete pod
./start.sh pod delete --pod-id <id> --force
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
./start.sh pod create --name CustomPod --image <registry>/comfyui-custom:latest
```

## Terraform (Future)

Placeholder for Infrastructure-as-Code approach (TBD):
- Manage multiple pods
- VPC and networking
- Storage configuration
- Auto-scaling policies

## Cost Management

The app shows what a pod pays: the datacenter and card menus carry the secure-cloud
price per hour where the volume lives (Romania's 4090 is USD 0.89, the A40 in Montreal
0.35), and the stats bar carries the network volume's monthly cost (0.07 per GB). Eight
hours a day on a 0.35 card is about USD 84 a month; the idle watch stops what is forgotten.

Output:
```
rtx4090: $8.80/day = $264.00/month
l40s: $14.40/day = $432.00/month
h100: $36.00/day = $1080.00/month
```

## Monitoring

### Check GPU Availability

```bash
./start.sh pod list
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
