# ComfyUI Workflow Project

A production-grade ComfyUI setup for image and video generation on RunPod infrastructure.

## Project Structure

```
├── README.md              # This file
├── docs/                  # Documentation and architecture decisions
├── comfy.yaml            # ComfyUI project configuration
├── assets/               # Source files (images, reference frames, etc.)
├── fragments/            # Reusable workflow components
├── blueprints/           # Composed workflows (YAML definitions)
├── outputs/              # Generated outputs (images, videos)
└── .comfy/              # Internal tracking (auto-managed)
```

## Quick Start

```bash
cd ~/workspaces/comfy_workflow

# Launch on-demand pod on RunPod
# (Instructions in docs/ADR-001-runpod-strategy.md)

# Push assets to cloud
comfy assets push

# Compose and run workflows
comfy workflow compose blueprints/example.yaml
comfy run --workflow blueprints/example.compiled.json
```

## Architecture & Decisions

- **ADR-001**: RunPod serverless + on-demand hybrid strategy
- See `docs/` for detailed architecture decisions

## Status

🚀 Initial setup phase - planning RunPod integration
