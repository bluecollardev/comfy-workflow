# ComfyUI Custom Docker Image for RunPod
# Based on ashleykza/runpod-comfyui with additional customizations

FROM ashleykza/runpod-comfyui:latest

# Install additional custom nodes (example)
WORKDIR /workspace/ComfyUI/custom_nodes

# Add any custom node installations here
# RUN git clone https://github.com/example/custom-node-pack.git

# Install Python dependencies for custom nodes
WORKDIR /workspace/ComfyUI
# COPY requirements-custom.txt .
# RUN pip install -r requirements-custom.txt

# Set environment variables
ENV COMFYUI_PORT=8188
ENV PYTHONUNBUFFERED=1

WORKDIR /workspace
EXPOSE 8188

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8188/system_stats || exit 1

# Start ComfyUI
CMD ["python", "-m", "comfy.cli"]
