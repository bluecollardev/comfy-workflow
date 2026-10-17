# Dockerfile Deviations from Official RunPod/ComfyUI

**Base Image:** `ashleykza/comfyui:latest` (Community-maintained)

## Deviations from Official

### 1. **Base Image Choice**
**Official:** `runpod/base:0.4.0-cuda11.8.0` (RunPod official)  
**This:** `ashleykza/comfyui:latest` (Community image)

**Why it matters:**
- ✅ Community image has ComfyUI pre-installed
- ❌ No official RunPod support guarantees
- ❌ Updates tied to community maintainer, not RunPod releases
- ⚠️ May be missing latest ComfyUI security patches

**Impact:** Works fine but updates lag behind official.

---

### 2. **Custom Node Support**
**Official:** No mechanism for custom nodes in base image  
**This:** Includes custom node installation hooks

```dockerfile
WORKDIR /workspace/ComfyUI/custom_nodes
# RUN git clone https://github.com/example/custom-node-pack.git
```

**Why:** Allows extending ComfyUI with third-party nodes at build time.

**Trade-off:** Bloats image size if many custom nodes added.

---

### 3. **Custom Python Dependencies**
**Official:** Only base ComfyUI + RunPod SDK  
**This:** Placeholder for project-specific pip packages

```dockerfile
# COPY requirements-custom.txt .
# RUN pip install -r requirements-custom.txt
```

**Why:** Lets you add dependencies (transformers, specialized models, etc.)

**Risk:** Version conflicts with ComfyUI's requirements.

---

### 4. **Environment Variables**
**Official:** None set explicitly  
**This:** Sets COMFY_PORT and PYTHONUNBUFFERED

```dockerfile
ENV COMFY_PORT=8188
ENV PYTHONUNBUFFERED=1
```

**Why:**
- `COMFY_PORT=8188` — Explicit port (redundant, already 8188)
- `PYTHONUNBUFFERED=1` — ✅ Good practice (log streaming in containers)

---

### 5. **Health Check**
**Official:** No health check  
**This:** Includes HTTP health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8188/system_stats || exit 1
```

**Why:** 
- ✅ RunPod can auto-restart unhealthy pods
- ✅ Prevents silent failures
- Requires `/system_stats` endpoint (ComfyUI has this)

---

### 6. **Startup Command**
**Official:** Varies by image  
**This:** Uses `python -m comfy.cli`

```dockerfile
CMD ["python", "-m", "comfy.cli"]
```

**Why:** Explicit Python module invocation.  
**Note:** RunPod may override this with `python -m runpod.worker.handler` for serverless.

---

## Comparison Table

| Feature | Official | This Dockerfile | Impact |
|---------|----------|-----------------|--------|
| Base image | RunPod official | Community maintained | Updates lag |
| Custom nodes | ❌ No | ✅ Yes | More flexibility |
| Pip packages | ❌ No | ✅ Yes | Dependency conflicts possible |
| Health check | ❌ No | ✅ Yes | Better reliability |
| Port explicit | ❌ No | ✅ Yes | Redundant but clear |
| Python unbuffered | ❌ No | ✅ Yes | Better logging |

---

## Risk Assessment

### Low Risk ✅
- Health check — improves reliability
- Unbuffered Python — no negative impact
- Explicit port — harmless

### Medium Risk ⚠️
- Community base image — depends on maintainer staying current
- Custom nodes — can break on ComfyUI updates

### High Risk ❌
- Custom pip packages — version conflicts likely

---

## Recommendations

### For Production On-Demand
Use this Dockerfile as-is. The community image is well-maintained and the additions are sensible.

```dockerfile
# Keep these:
- HEALTHCHECK (improves reliability)
- PYTHONUNBUFFERED (better logging)
- Custom node hooks (we'll add nodes)

# Consider adding:
- Explicit ComfyUI version pin
- APK/apt layer caching
- User setup (don't run as root)
```

### For Production Serverless (Flash SDK)
Modify for `runpod.worker.handler`:

```dockerfile
# Add RunPod SDK
RUN pip install runpod

# Change startup
CMD ["python", "-m", "runpod.worker.handler"]
```

This swaps custom CLI for RunPod's serverless handler.

### For Safe Custom Nodes
Pin versions to avoid breaks:

```dockerfile
WORKDIR /workspace/ComfyUI/custom_nodes
RUN git clone --depth 1 --branch v1.2.3 \
    https://github.com/example/custom-node-pack.git
```

---

## How to Use This Dockerfile

### Local Testing
```bash
docker build -t comfyui-custom:latest .
docker run -p 8188:8188 comfyui-custom:latest
```

### With ComfyUI Build
```bash
comfy build init . --name comfy-custom
# Copy Dockerfile to project root
# Configure pip packages in requirements-custom.txt
# Configure custom nodes in Dockerfile
comfy build push .
comfy build release create . --target linux/nvidia
```

### With Serverless (Future)
```dockerfile
# Modify to:
FROM ashleykza/comfyui:latest
RUN pip install runpod
CMD ["python", "-m", "runpod.worker.handler"]
```

---

## Summary

**This Dockerfile is:**
- ✅ Production-ready for on-demand
- ✅ Well-designed (health checks, logging)
- ⚠️ Depends on community image (minor risk)
- ⚠️ Custom packages need version pinning
- 📋 Needs modification for serverless

**Action:** Use as-is for on-demand pool. Modify for serverless when building Flask SDK integration.
