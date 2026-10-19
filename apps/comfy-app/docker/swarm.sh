#!/usr/bin/env bash
# Run the ComfyUI image on Linux NVIDIA boxes: one with Compose, several as a Swarm.
#
#   ./swarm.sh up              # this box only: docker compose up -d
#   ./swarm.sh init            # make this box a Swarm manager and a GPU node
#   ./swarm.sh join <token> <manager:2377>   # add a GPU worker
#   ./swarm.sh deploy          # docker stack deploy comfy
#   ./swarm.sh status | logs | down
#
# Needs: Docker, the NVIDIA container toolkit, and the image (../build.sh, or pull it).
# Paths: PROJECT_ROOT, COMFY_SHARED, PLATES_ROOT, COMFY_IMAGE, COMFY_PORT; see compose.yml.
# Not for macOS: Docker there has no GPU. On a Mac run ../launch.sh (MPS) instead.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="$HERE/compose.yml"
GPU="$HERE/compose.gpu.yml"
STACK="${STACK:-comfy}"
cd "$HERE"

gpu_uuid() { nvidia-smi --query-gpu=uuid --format=csv,noheader 2>/dev/null | head -1 || true; }

case "${1:-help}" in
  up)     docker compose -f "$COMPOSE" -f "$GPU" up -d && docker compose -f "$COMPOSE" ps ;;
  down)   docker stack rm "$STACK" 2>/dev/null || docker compose -f "$COMPOSE" down ;;
  status) docker stack services "$STACK" 2>/dev/null || docker compose -f "$COMPOSE" ps ;;
  logs)   docker service logs -f "${STACK}_comfy" 2>/dev/null || docker compose -f "$COMPOSE" logs -f ;;
  init)
    [ "$(uname -s)" = Linux ] || echo "note: $(uname -s) cannot be a GPU worker; manager only" >&2
    docker info --format '{{.Swarm.LocalNodeState}}' | grep -q active || docker swarm init
    docker node update --label-add gpu=true "$(docker info --format '{{.Swarm.NodeID}}')"
    uuid="$(gpu_uuid)"
    if [ -n "$uuid" ]; then
      cat <<MSG

Swarm schedules GPUs only when the node advertises them. Once per GPU node:

  1. /etc/docker/daemon.json
       { "default-runtime": "nvidia",
         "node-generic-resources": ["NVIDIA-GPU=${uuid}"] }
  2. /etc/nvidia-container-runtime/config.toml: uncomment
       swarm-resource = "DOCKER_RESOURCE_GPU"
  3. sudo systemctl restart docker

Then: docker node inspect self --format '{{.Description.Resources.GenericResources}}'
Worker join command:
MSG
      docker swarm join-token worker | sed -n 3p
    else
      echo "no nvidia-smi here: this node is a manager, not a GPU worker" >&2
    fi ;;
  join)   docker swarm join --token "$2" "$3" ;;
  deploy) docker stack deploy -c "$COMPOSE" "$STACK" && docker stack services "$STACK" ;;
  help|*) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
