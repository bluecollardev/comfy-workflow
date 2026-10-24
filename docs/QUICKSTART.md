# Quick Start - See ComfyUI Working

Three ways to see ComfyUI in action, from simplest to most powerful.

## 🟢 Option 1: RunPod Dashboard (Fastest - 2 mins)

**Like Docker Desktop but for RunPod**

```bash
cd ~/workspaces/comfy_workflow
echo 'RUNPOD_API_KEY=your-real-api-key' >> .env   # or export it
./start.sh pods
```

That installs the app's dependencies, builds the core and the page
(`npm install` + `npm run build` in `apps/runpod-dashboard`) and starts the
API, which serves the dashboard at `/`. By hand: README.md "Manual start".

**Then open:** http://localhost:8000 (interactive API docs at http://localhost:8000/docs)

The desktop version is the Electron app in `apps/runpod-dashboard`
(`npm run electron:dev`); it starts the API itself. The older single-file
Flask dashboard is kept in `apps/runpod-api/legacy/`.

✨ You'll see:
- All your RunPod pods
- Real-time status
- Quick links to ComfyUI web UIs
- SSH commands to access pods

---

## 🟡 Option 2: ComfyUI Locally (30 mins)

**Run ComfyUI on your own GPU**

### Step 1: Clone ComfyUI
```bash
git clone https://github.com/comfyanonymous/ComfyUI.git ~/ComfyUI
cd ~/ComfyUI
```

### Step 2: Set up Python
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### Step 3: Install PyTorch
```bash
# For Mac (auto-detects Metal acceleration):
# Just works! No extra step needed

# For Linux/Windows with NVIDIA GPU:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# For AMD GPU:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm5.7
```

### Step 4: Start ComfyUI
```bash
python main.py
```

**You'll see:**
```
Starting server...
Listening on 0.0.0.0:8188
Browse to http://127.0.0.1:8188
```

**Then open:** http://localhost:8188

✨ You'll see:
- ComfyUI web interface
- Node editor for building workflows
- Ability to generate images immediately
- Default models pre-loaded

---

## 🔵 Option 3: Create Real RunPod Pod (5 mins)

**Rent a powerful GPU in the cloud**

### Step 1: Get RunPod API Key
1. Go to https://www.runpod.io/account
2. Click "Create API Key"
3. Copy the key

### Step 2: Set API Key
```bash
export RUNPOD_API_KEY="your-actual-api-key"
```

### Step 3: Create Pod
```bash
cd ~/workspaces/comfy_workflow

./start.sh pod create \
  --name ComfyUI-Dev \
  --gpu rtx4090 \
  --volume 50 \
  --disk 20
```

**You'll get:**
```
✓ Pod created successfully!
  Pod ID: a1b2c3d4e5f6
  Status: starting
  
  Web UI: http://a1b2c3d4e5f6.proxy.runpod.io:8188
  SSH: ssh root@a1b2c3d4e5f6.proxy.runpod.io
```

### Step 4: Wait for startup (1-2 mins)
```bash
# Check status
./start.sh pod status --pod-id a1b2c3d4e5f6
```

### Step 5: Access ComfyUI
Open in browser: `http://a1b2c3d4e5f6.proxy.runpod.io:8188`

✨ You'll see:
- ComfyUI web interface running on cloud GPU
- Powerful RTX 4090 (24GB VRAM)
- Ready for production workflows
- Web accessible from anywhere

---

## 🟣 Import a shot pack (5 mins)

A delivery package (Kyle's rounds) into ComfyUI-Shared and onto a pod: map ComfyUI-Shared in
Default Configuration, then on a pod's card press **Import Shot Pack**, pick the folder, Dry run,
Import. Setup, the optional Claude key, adapters and limits: [`IMPORT-SHOT-PACKS.md`](IMPORT-SHOT-PACKS.md).

## 📊 Comparison

| Feature | Dashboard | Local ComfyUI | RunPod Pod |
|---------|-----------|---------------|-----------|
| **Setup Time** | 2 min | 30 min | 5 min |
| **Cost** | Free | Your hardware | $1.10/hr |
| **GPU Power** | View only | Your GPU | Enterprise GPU |
| **Access** | http://localhost:5000 | http://localhost:8188 | http://pod-id.proxy.runpod.io:8188 |
| **Generate Images** | No | Yes ✅ | Yes ✅ |
| **Manage Pods** | Yes ✅ | N/A | Yes ✅ |
| **Offline Use** | No | Yes ✅ | No |

---

## 🚀 Recommended Path

### For Development:
```
1. Start with local ComfyUI (30 min setup)
2. Iterate on prompts locally
3. Use RunPod dashboard to monitor cloud pods
4. When ready: submit batch jobs to cloud
```

### For Production:
```
1. Create RunPod pod (5 mins)
2. Access via web UI
3. Or submit workflows programmatically
```

### For Monitoring:
```
1. Always have dashboard running
2. Quick view of all pods
3. Direct access to ComfyUI UIs
```

---

## What's Next?

### If you chose Local ComfyUI:
```bash
# Go to http://localhost:8188
# Use our workflows:
cd ~/workspaces/comfy_workflow
comfy set-default --where local
comfy workflow compose blueprints/example.yaml
```

### If you chose RunPod Pod:
```bash
# Go to http://pod-id.proxy.runpod.io:8188
# Use the web UI to build workflows
# Or submit via API
```

### If you're using the Dashboard:
```bash
# Open http://localhost:5000
# See your pods in real-time
# Click on any pod to access its ComfyUI
```

---

## Troubleshooting

### Local ComfyUI won't start
```bash
# Make sure CUDA is installed (NVIDIA)
nvidia-smi

# Or check Mac has Metal
# Should work automatically
```

### RunPod pod creation fails
```bash
# Check API key is valid
export RUNPOD_API_KEY="..."
./start.sh pod list

# If "Unauthorized" error: API key is wrong
# If "Unavailable" error: GPU stock is low, try different GPU
```

### Dashboard won't load
```bash
# Check Flask is installed
pip install flask

# Check port 5000 is free
# If not, change port in pod_dashboard.py

# Make sure API key is set
echo $RUNPOD_API_KEY
```

---

## Questions?

- **ComfyUI Questions:** See `docs/WORKFLOWS.md`
- **RunPod Questions:** See `docs/SETUP.md` and `docs/ADR-001-runpod-strategy.md`
- **Local Setup Issues:** See `docs/LOCAL-SETUP.md`
