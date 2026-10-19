# ComfyUI server image for RunPod pods, Linux boxes and Windows via Docker Desktop (WSL2).
#
# Same ComfyUI commit and torch version as the Mac install (see manifest.json /
# snapshots/), on CUDA instead of MPS. Build with ./build.sh, which stages the
# custom node packs into .build/ first; the packs are not in git.
#
# Layout inside the container:
#   /opt/ComfyUI                      the app, at COMFYUI_REF
#   /opt/ComfyUI/custom_nodes/        BincStereo + the ShotPipe versions build.sh staged
#   /workspace/ComfyUI-Shared/{input,output,models}   mount: same layout as the Mac and binc-PC
#   /workspace/CANALV2                mount: the project tree
#   /home/binc/CANALV2_r3/CANALV2 -> /workspace/CANALV2   so graphs keep their binc-PC paths
#
# Models and plates are never baked in; mount them (RunPod network volume at /workspace).

ARG BASE_IMAGE=pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime
FROM ${BASE_IMAGE}

ARG COMFYUI_REPO=https://github.com/comfyanonymous/ComfyUI.git
# v0.39.2, the commit the Mac install runs (snapshots/*.json: comfyui.commit)
ARG COMFYUI_REF=3c1b7a17fdf239d35ce98cc777756f572d089795

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    COMFY_SHARED=/workspace/ComfyUI-Shared \
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

# Node packs, staged by build.sh (BincStereo from the Mac install, ShotPipe from CANALV2).
# Last layer that changes often, so everything above stays cached.
COPY .build/custom_nodes/ /opt/ComfyUI/custom_nodes/
RUN for req in /opt/ComfyUI/custom_nodes/*/requirements.txt; do \
        [ -f "$req" ] && pip install -r "$req"; done; true

COPY docker/extra_model_paths.yaml /opt/comfy-app/extra_model_paths.yaml
COPY docker/entrypoint.sh /opt/comfy-app/entrypoint.sh
RUN chmod +x /opt/comfy-app/entrypoint.sh \
    && mkdir -p /home/binc/CANALV2_r3 \
    && ln -s /workspace/CANALV2 /home/binc/CANALV2_r3/CANALV2

EXPOSE 8188
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -fs "http://127.0.0.1:${COMFY_PORT}/system_stats" || exit 1

ENTRYPOINT ["/opt/comfy-app/entrypoint.sh"]
