# ComfyUI Workflow Monorepo

**Project:** ComfyUI Workflow automation on RunPod  
**Owner:** Lucas (Blue Collar Dev)  
**Status:** Initial setup phase  
**Updated:** 2026-10-17

## Project Overview

A production-grade monorepo for managing ComfyUI workflows and infrastructure on RunPod. Combines workflow orchestration with infrastructure-as-code for reliable, scalable image/video generation.

### Key Decision: Hybrid RunPod Strategy

See `docs/ADR-001-runpod-strategy.md` for full context.

**Phase 1 (Current):** On-demand GPU pods for interactive development
- Direct web UI access
- Real-time iteration
- $8-15/day development costs

**Phase 2 (Future):** Add serverless endpoints for production batch rendering
- Auto-scaling
- Pay-per-job
- Cost optimization for bulk work

## Repository Structure

```
comfy_workflow/                    # Root monorepo
│
├── README.md                      # Project overview
├── CLAUDE.md                      # This file - collaboration guide
├── comfy.yaml                     # ComfyUI project config
│
├── docs/                          # Documentation
│   ├── ADR-001-runpod-strategy.md # Architecture decision
│   ├── SETUP.md                   # Pod deployment guide
│   └── WORKFLOWS.md               # Workflow patterns
│
├── apps/                          # Runnable apps (tracked scripts, ignored data)
│   ├── comfy-app/                # The ComfyUI server: Mac scripts + Dockerfile for RunPod
│   │   └── ComfyUI/              #   ignored: the ~5 GB standalone install itself
│   ├── runpod-api/               # FastAPI pod manager API, pool manager, MCP server, tests (Python)
│   └── runpod-dashboard/         # Vue 3 + Electron dashboard for the pod manager API
│
├── projects/                      # Client/creative work; ignored except README.md
│   ├── README.md                  # Inventory of what is in here
│   └── desktop/                   # Trees synced from the desktop (CANALV2, ComfyUI-Shared)
│
├── infra/                         # Infrastructure automation
│   ├── scripts/
│   │   ├── create_pod.py         # Pod lifecycle CLI (create, list, status, stop, resume, delete)
│   │   ├── setup.sh              # Installs the CLI deps and creates a first pod
│   │   └── requirements.txt       # Python deps for the CLI
│   ├── pod-config.yaml           # Pod specifications
│   ├── terraform/                # IaC (placeholder)
│   └── README.md                 # Infra guide
│
├── assets/                        # Source files
│   ├── images/
│   ├── keyframes/
│   └── references/
│
├── fragments/                     # Reusable components
│   ├── load_image.json
│   ├── text_to_image.json
│   └── ...
│
├── blueprints/                    # Workflow compositions
│   ├── basic_t2i.yaml
│   ├── basic_t2i.compiled.json
│   └── ...
│
├── outputs/                       # Generated media
│
└── .comfy/                        # Internal tracking
    ├── assets.lock.json          # Asset checksums
    └── runs.jsonl                # Job journal
```

## Git Workflow

### Branches

Three main branches with clear purposes:

| Branch | Purpose | Protection |
|--------|---------|-----------|
| `master` | Production releases (merge from develop) | Always stable |
| `develop` | Integration branch (base for all features) | Code review required |
| `feature/*` | Feature development (branch from develop) | Merged via PR to develop |

**⚠️ IMPORTANT: All feature branches must be based on `develop`, NOT master.**

Workflow:
```
develop (always up to date)
  ↓
feature/your-feature (created from develop)
  ↓
PR → code review
  ↓
merge to develop
  ↓
develop → master (only for releases)
```

### Merge Strategy

**RULE: Never merge to develop or master if tests are failing**

Before merging any branch:
```bash
pytest apps/runpod-api/tests/ -m "not integration"
# All tests must pass before merge
```

**For feature branches → develop:**
```bash
git checkout develop
git merge --no-ff feature/name  # Always create merge commit
```

**For develop → master (releases only):**
```bash
git checkout master
git merge --ff-only develop     # Fast-forward only (no merge commit)
```

This keeps develop with explicit merge commits (clear history) while keeping master a linear series of releases.

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `docs`, `infra`, `refactor`, `test`, `chore`

**Examples:**
```
feat(workflows): add batch generation blueprint
docs(setup): update pod configuration guide
infra(scripts): add pod lifecycle management
```

### Workflow

1. **Create feature branch**
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/description-of-work
   ```

2. **Make commits**
   ```bash
   git add <files>
   git commit -m "feat(scope): description"
   ```

3. **Push and create PR**
   ```bash
   git push origin feature/description-of-work
   # Then create PR on GitHub/GitLab
   ```

4. **After review, merge to develop**
   ```bash
   # Squash or rebase if needed
   # Then merge PR
   ```

5. **Release to master**
   ```bash
   git checkout master
   git merge develop --no-ff
   git tag v1.0.0
   git push origin master --tags
   ```

## Key Files to Know

### Configuration

- **`comfy.yaml`** — ComfyUI project config (routing, vars, assets)
- **`infra/scripts/requirements.txt`** — Python dependencies for the pod CLI
- **`apps/runpod-api/requirements.txt`** — Python dependencies for the pod manager API, MCP server and tests

### Documentation

- **`docs/ADR-001-runpod-strategy.md`** — Why we chose hybrid approach
- **`docs/SETUP.md`** — How to deploy on-demand pod
- **`docs/WORKFLOWS.md`** — Workflow composition patterns

### Automation

- **`start.sh`** — One-command starts: `comfy`, `pods`, `desktop`, `dashboard`, `pod <args>`, `mcp`, `test`, `stop`; clears a stale API from its port and waits for `/health`; IDE run configs in `.run/` and `.vscode/` call it
- **`apps/comfy-app/launch.sh`** — Start the local ComfyUI server (run `setup.sh` first on a new machine; see `apps/comfy-app/README.md`)
- **`infra/scripts/create_pod.py`** — Pod management CLI
- **`apps/runpod-api/pod_manager_api.py`** — FastAPI pod manager (serves the dashboard at :8000); `mcp_server.py` beside it is the MCP server for Claude Code
- **`apps/comfy-app/Dockerfile`** — The ComfyUI server image for RunPod / Linux / Windows-WSL2 (`build.sh` builds it)

## Development Tasks

### Common Tasks

**One command (installs on first run):**
```bash
./start.sh comfy     # ComfyUI on this Mac
./start.sh pods      # pod manager API + dashboard on :8000
./start.sh test      # the merge gate
```

**Set up environment:**
```bash
cd ~/workspaces/comfy_workflow
export RUNPOD_API_KEY="your-key"
pip install -r infra/scripts/requirements.txt
```

**Create on-demand pod:**
```bash
python infra/scripts/create_pod.py create \
  --name ComfyUI-Dev \
  --gpu rtx4090
```

**Build and run workflow:**
```bash
comfy workflow compose blueprints/example.yaml
comfy run --workflow blueprints/example.compiled.json --where cloud
```

**Push assets:**
```bash
comfy assets push
```

### Before Starting Work

- [ ] Review `docs/` for context
- [ ] Check `ADR-001` for architecture decisions
- [ ] Verify RunPod pod is running (if working on workflows)
- [ ] Pull latest from `develop` branch

### When Done

- [ ] All workflows tested locally or on pod
- [ ] Documentation updated (if adding new patterns)
- [ ] Commit with proper message format
- [ ] Push to feature branch and create PR
- [ ] Address review feedback
- [ ] Merge to develop once approved

## Project Conventions

### RunPod Pod Management

**Pod Naming Convention:**
```
ComfyUI-{Purpose}-{Date}
ComfyUI-Dev          # Development pod (default)
ComfyUI-Batch        # Batch rendering pod
ComfyUI-Test         # Temporary testing pod
ComfyUI-Prod-Oct17   # Production pod with date
```

**Pod ID Documentation:**
- Always document active pod ID in `RUNPOD_POD_ID` env var
- Store in `.env` file (not committed)
- Update in project notes when pod changes
- Never hardcode pod IDs in code/scripts

**Pod Lifecycle:**
1. **Create:** Use `create_pod.py create` with config from `pod-config.yaml`
2. **Document:** Add pod ID to local notes
3. **Stop:** Use `create_pod.py stop --pod-id <id>` when not in use (pause billing)
4. **Resume:** Use `create_pod.py resume --pod-id <id>` when resuming work
5. **Delete:** Use `create_pod.py delete --pod-id <id>` with confirmation (irreversible)

**Never:**
- ❌ Leave pod running 24/7 (unless production)
- ❌ Hardcode pod IDs in scripts
- ❌ Share pod ID in commits/PRs
- ❌ Use production GPU for testing
- ❌ Forget to stop pod when done (costs money!)

### Asset & Model Management

**Asset Guidelines:**
- Upload to `assets/` first, then `comfy assets push`
- Never commit large files (models, datasets)
- Reference via `$asset.<path>` in blueprints
- Keep checksums in `.comfy/assets.lock.json` (auto-managed)

**Model Organization:**
```
assets/
├── images/              # Reference images
├── keyframes/          # Keyframe sequences
├── references/         # Style/inspiration references
└── .gitkeep            # Keep directory in git
```

### Environment Variables

**Always use:**
```bash
export RUNPOD_API_KEY="..."    # Never commit!
export RUNPOD_POD_ID="..."     # Document current pod
```

**Store in `.env`:**
```
RUNPOD_API_KEY=...
RUNPOD_POD_ID=...
RUNPOD_GPU_TYPE=rtx4090
RUNPOD_VOLUME_GB=50
```

**Never commit `.env`** — it's in `.gitignore` for a reason.

## Important Constraints & Gotchas

### ComfyUI Constraints

1. **Never hand-edit compiled JSON**
   - Edit `.yaml` blueprints instead
   - Use `comfy workflow compose` to regenerate
   - Rerun `comfy workflow decompose` if you need to change a fragment

2. **Assets must be pushed before running**
   ```bash
   comfy assets push  # Required before compose/run
   ```

3. **Model availability varies by backend**
   - Always discover at runtime: `comfy model search ...`
   - Never hardcode checkpoint/LoRA names

### RunPod Constraints

1. **Pod ID is ephemeral**
   - Document current pod ID in project notes
   - Always check pod status before running workflows

2. **Storage limits**
   - Default: 50GB volume (models)
   - Upgrade if adding large datasets

3. **Network access**
   - Web UI: `http://{pod-id}.proxy.runpod.io:8188`
   - SSH: `ssh root@{pod-id}.proxy.runpod.io`
   - Use RunPod dashboard for detailed management

### Git Constraints

1. **Don't commit compiled artifacts**
   - `.compiled.json` files are auto-generated
   - Only commit `.yaml` blueprints
   - Same for `.comfy/` internals (except for documentation)

2. **Keep branches clean**
   - Rebase feature branches on `develop` before merging
   - Use squash merge for small features
   - Don't force-push to shared branches

## References

**RunPod:**
- Docs: https://docs.runpod.io
- Pod creation: https://www.runpod.io/console/pods
- CLI: `python3 infra/scripts/create_pod.py --help`

**ComfyUI:**
- Official docs: https://docs.comfy.org
- Workflow templates: https://github.com/Comfy-Org/workflow_templates
- CLI: `comfy --help`

**This Project:**
- Architecture: `docs/ADR-001-runpod-strategy.md`
- Setup: `docs/SETUP.md`
- Workflows: `docs/WORKFLOWS.md`
- Infrastructure: `infra/README.md`

## Contact & Questions

For questions about this project, check:
1. Relevant doc file
2. ADR or SETUP guide
3. Inline script comments
4. RunPod/ComfyUI official docs

If something is missing or unclear, update the docs when you figure it out.
