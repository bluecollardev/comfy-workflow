# ComfyUI server image for RunPod pods, Linux boxes and Windows via Docker Desktop (WSL2).
#
# Same ComfyUI commit and torch version as the Mac install (pins.env), on CUDA
# instead of MPS. Build with ./build.sh: it passes the pins as build args and
# stages any ShotPipe version (client tree, not in git) into .build/.
#
# Layout inside the container:
#   /opt/ComfyUI                      the app, at COMFYUI_REF
#   /opt/ComfyUI/custom_nodes/        what build.sh staged from shared/nodes: BincStereo + the ShotPipe versions asked for
#   /workspace/comfy-shared/{input,output,models,workflows}   mount: same layout as the Mac and binc-PC
#   /opt/ComfyUI/user/default/workflows -> /workspace/comfy-shared/workflows   the UI's Workflows panel reads the mount
#   /opt/comfy-app/workflows          workflows/ from the repo: copied onto the mount only while it is empty
#   /workspace/project                mount: the project tree
#   sshd on 22 when RunPod passes PUBLIC_KEY, so `./start.sh sync --pod <id>` can rsync onto the volume
#   /home/binc/CANALV2_r3/CANALV2 -> /workspace/project   so graphs keep their binc-PC paths
#
# Models and plates are never baked in; mount them (RunPod network volume at /workspace).

ARG BASE_IMAGE=pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime
FROM ${BASE_IMAGE}

# Defaults mirror pins.env; build.sh passes the pins explicitly.
ARG COMFYUI_REPO=https://github.com/Comfy-Org/ComfyUI.git
ARG COMFYUI_REF=3c1b7a17fdf239d35ce98cc777756f572d089795

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    COMFY_SHARED=/workspace/comfy-shared \
    COMFY_PORT=8188

RUN apt-get update && apt-get install -y --no-install-recommends \
        git curl ca-certificates ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# ComfyUI at the pinned commit. torch is already in the base image; ComfyUI's
# requirements leave it unpinned so pip keeps the base's build.
RUN git clone --filter=blob:none "${COMFYUI_REPO}" /opt/ComfyUI \
    && git -C /opt/ComfyUI checkout --detach "${COMFYUI_REF}" \
    && rm -rf /opt/ComfyUI/.git
WORKDIR /opt/ComfyUI
RUN pip install -r requirements.txt \
    && pip install -r manager_requirements.txt

# Python packages the custom node packs import beyond ComfyUI's own.
COPY requirements-packs.txt /tmp/requirements-packs.txt
RUN pip install -r /tmp/requirements-packs.txt

# Node packs: ours from the repo, ShotPipe staged by build.sh from the CANALV2 tree.
# Last layers that change often, so everything above stays cached.
COPY .build/custom_nodes/ /opt/ComfyUI/custom_nodes/
# A pack that asks for plain opencv-python gets the headless build the image already has: both together can break `import cv2` in a container with no libGL (ComfyUI-fal-API asks for it).
RUN for req in /opt/ComfyUI/custom_nodes/*/requirements.txt; do \
        [ -f "$req" ] || continue; \
        sed -E 's/^opencv-python([<>=!~].*)?$/opencv-python-headless\1/' "$req" > /tmp/pack-req.txt; \
        pip install -r /tmp/pack-req.txt; done; rm -f /tmp/pack-req.txt
# The loop above fails the build on a failed install (frozen image: nothing is installed at run time).
# the fal pack must not be silently without its client library: fail the build instead (ADR-025).
RUN [ ! -d /opt/ComfyUI/custom_nodes/ComfyUI-fal-API ] || python -c "import fal_client"
# Depth Anything V2 Large, baked at a pinned revision where BincStereo looks (models/depth_anything): no download at run time.
ARG DA2_REV=7581137eff8d4e94f6e796d3baea0e9fa79b22d2
RUN python -c "from huggingface_hub import snapshot_download as d; d('depth-anything/Depth-Anything-V2-Large-hf', revision='${DA2_REV}', local_dir='/opt/ComfyUI/models/depth_anything/Depth-Anything-V2-Large-hf', allow_patterns=['config.json','model.safetensors','preprocessor_config.json'])" \
    && rm -rf /opt/ComfyUI/models/depth_anything/Depth-Anything-V2-Large-hf/.cache \
    && ls -la /opt/ComfyUI/models/depth_anything/Depth-Anything-V2-Large-hf
# Load check: every baked pack must import in the frozen tree, or the build fails (the run-time lock-up caught here instead).
RUN python main.py --cpu --base-directory /opt/ComfyUI --offline --quick-test-for-ci > /tmp/load.log 2>&1; cat /tmp/load.log; \
    grep -q "Import times for custom nodes" /tmp/load.log && ! grep -q "IMPORT FAILED" /tmp/load.log; \
    s=$?; rm -rf /opt/ComfyUI/user /opt/ComfyUI/temp /tmp/load.log; exit $s
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

# sshd (RunPod injects PUBLIC_KEY; the entrypoint starts it) and rsync, for ./start.sh sync onto the volume;
# rclone, for the pod to pull from an S3 bucket itself (S3_PULL in entrypoint.sh).
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server rsync rclone \
    && rm -rf /var/lib/apt/lists/*
COPY docker/extra_model_paths.yaml /opt/comfy-app/extra_model_paths.yaml
COPY workflows/ /opt/comfy-app/workflows/
COPY docker/entrypoint.sh /opt/comfy-app/entrypoint.sh
COPY docker/verify_round.py /opt/comfy-app/verify_round.py
COPY docker/s3pull.sh /opt/comfy-app/s3pull.sh
RUN chmod +x /opt/comfy-app/entrypoint.sh /opt/comfy-app/verify_round.py /opt/comfy-app/s3pull.sh \
    && mkdir -p /home/binc/CANALV2_r3 \
    && ln -s /workspace/project /home/binc/CANALV2_r3/CANALV2

LABEL org.opencontainers.image.source="https://github.com/bluecollardev/comfy-workflow"
EXPOSE 8188 8189
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fs "http://127.0.0.1:${COMFY_PORT}/system_stats" || exit 1

ENTRYPOINT ["/opt/comfy-app/entrypoint.sh"]
