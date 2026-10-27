# Local ComfyUI Setup

Yes! You can run ComfyUI locally on your machine instead of using RunPod cloud.

## Local vs Cloud Comparison

| Aspect | Local | RunPod Cloud |
|--------|-------|--------------|
| **Cost** | Hardware only (one-time) | $1-4/hour (pay-as-you-go) |
| **Setup Time** | 30 mins - 2 hours | 2-3 minutes |
| **Hardware Needed** | GPU (RTX 4090 recommended) | None (rent from cloud) |
| **Speed** | Depends on your GPU | Enterprise-grade GPUs |
| **Storage** | Limited to your drive | Unlimited (pay for storage) |
| **For Development** | ✅ Great for iteration | ✅ No hardware needed |
| **For Production** | ✅ Good for 24/7 inference | ✅ Better for scaling |

## Local Installation Options

### Option 1: This project's ComfyUI (recommended)

`apps/comfy-app` is ComfyUI at a pinned version with the project's node packs (BincStereo, ShotPipe), the saved workflows and the
model downloads. One command installs and starts it; it is what the project's graphs are built and tested against.

**Requirements:**
- macOS on Apple Silicon, or Linux with an NVIDIA GPU (Windows: WSL2, or Option 2's Docker image)
- `git` and `uv` (`brew install uv`)
- 8GB+ VRAM or an Apple Silicon Mac with 16GB+ RAM; 50GB+ disk space for models

```bash
cd comfy_workflow
./start.sh comfy        # first run: clone at the pin, build the venv, link the packs and workflows, download models, start
./start.sh stop         # stop it
```
Choose the ShotPipe set a graph needs: `COMFY_SHOTPIPE=contract-v26 apps/comfy-app/setup.sh` (sets in `shared/nodes/sets.json`).
Torch is the Metal build on a Mac (`requirements-mac.txt`) and the CUDA build elsewhere (`requirements-cuda.txt`); the scripts pick it.

**Access:** http://localhost:8188 · More: [`apps/comfy-app/README.md`](../apps/comfy-app/README.md)

### Stock ComfyUI from upstream (not the project's)

Only for trying ComfyUI itself. It has none of the project's packs or workflows, so the project's graphs will not load.

```bash
git clone https://github.com/comfyanonymous/ComfyUI.git && cd ComfyUI
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121   # NVIDIA; a Mac needs nothing extra
python main.py
```

### Option 2: ComfyUI via Docker (Reproducible)

The project's own image is `ghcr.io/bluecollardev/comfy-app:contract-v26` (private; log in with `docker login ghcr.io`). The `ashleykza/comfyui` image below is the stock community one.


```bash
# Pull image
docker pull ashleykza/comfyui:latest

# Run locally
docker run -it \
  -p 8188:8188 \
  -v ~/comfy_models:/workspace/ComfyUI/models \
  ashleykza/comfyui:latest

# Access: http://localhost:8188
```

### Option 3: ComfyUI Manager (Easiest for Extensions)

Within ComfyUI web UI:
1. Install "ComfyUI Manager" custom node
2. Use Manager to install models, nodes, extensions
3. Much easier than manual installation

## Hardware Requirements

### Recommended Setups

**Budget (~$1500-2000):**
- RTX 4060 Ti (8GB)
- 16GB system RAM
- 512GB SSD
- ✅ Handles 512x512-1024x1024 generation

**Mid-Range (~$3000-4000):**
- RTX 4090 (24GB)
- 32GB system RAM
- 1TB+ SSD
- ✅ Handles 1024x1024-2048x2048 generation
- ✅ Good for batch processing

**High-End (~$6000+):**
- RTX 6000 or H100
- 64GB+ system RAM
- 2TB+ SSD
- ✅ Professional production use
- ✅ Video generation capable

## Speed Comparison

**Generation times on 1024x1024 image:**

| Hardware | Flux | SDXL | Speed |
|----------|------|------|-------|
| RTX 3060 Ti | 45-60s | 15-20s | Baseline |
| RTX 4090 | 8-12s | 3-5s | 5-10x faster |
| H100 (Cloud) | 5-8s | 2-3s | 10-15x faster |

**Video (Kling/Grok, 5 seconds):**
- Local RTX 4090: 2-3 minutes
- Cloud H100: 30-60 seconds

## Local Workflow Setup

Once ComfyUI is running locally:

```bash
# Use comfy CLI against local instance
export COMFY_LOCAL_URL="http://localhost:8188"

# Or set in comfy config
comfy set-default --where local

# Now comfy commands hit your local instance
comfy run --workflow blueprints/example.compiled.json
comfy assets push  # (if using project structure)
```

## Models for Local Use

**Recommended starter models:**

```
~5-10GB total:
- Flux Schnell (free): 24.3GB
- SDXL: 5.2GB (very good quality)
- ControlNet: 1.5GB
- Real-ESRGAN Upscaler: 500MB
```

**Install locally:**
```bash
# Inside ComfyUI folder
mkdir -p models/checkpoints
cd models/checkpoints

# Download models
# Flux: https://huggingface.co/black-forest-labs/FLUX.1-schnell
# SDXL: https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
```

Or use ComfyUI Manager to install automatically.

## Switching Between Local and Cloud

```bash
# Use local (default)
comfy set-default --where local
comfy run --workflow blueprints/example.compiled.json

# Switch to cloud
comfy set-default --where cloud
comfy run --workflow blueprints/example.compiled.json

# Or specify per-command
comfy run --workflow file.json --where local
comfy run --workflow file.json --where cloud
```

## Recommendations

### Use Local When:
- ✅ Developing and iterating rapidly
- ✅ You already have a good GPU
- ✅ Testing new prompts/techniques
- ✅ You want zero latency
- ✅ Working offline

### Use Cloud (RunPod) When:
- ✅ You don't have a GPU
- ✅ Need professional GPUs (H100)
- ✅ Batch processing large jobs
- ✅ Need 24/7 reliability
- ✅ Horizontal scaling needed

### Hybrid Approach (Recommended):
1. **Develop locally** — Iterate fast, zero latency
2. **Batch on cloud** — Scale production rendering
3. **Keep both** — Best of both worlds!

## Next Steps

### For Local Setup:
```bash
# Install ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
# Follow "Option 1" above

# Then use our workflows
comfy set-default --where local
cd ~/workspaces/comfy_workflow
comfy workflow compose blueprints/example.yaml
comfy run --workflow blueprints/example.compiled.json
```

### For Cloud Setup:
```bash
# Follow docs/SETUP.md
./start.sh pod create --name ComfyUI-Dev --gpu auto   # or the app's form: ./start.sh desktop
```

## Troubleshooting Local Setup

| Issue | Solution |
|-------|----------|
| CUDA not found | Install NVIDIA drivers + cuDNN |
| Out of memory | Reduce resolution, enable VAE tiling |
| Slow generation | Check GPU isn't being shared, close other apps |
| Models not loading | Verify path is `models/checkpoints/` exactly |

## Resources

- **ComfyUI Official:** https://github.com/comfyanonymous/ComfyUI
- **Installation Guide:** https://docs.comfy.org/installation
- **ComfyUI Manager:** https://github.com/ltdrdata/ComfyUI-Manager
- **Model Downloads:** https://huggingface.co
