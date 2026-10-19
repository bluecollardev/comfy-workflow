# Systems: two machines, NAS, git, RunPod

Binc, 2026-10-15: two-system workflow (Linux PC + Mac on a direct link), a common Claude project with coordinated code, a NAS for backup and git, RunPod containers when we need the compute.

## Machines

| Machine | Job | Runs | Claude Code agent |
|---|---|---|---|
| **binc-PC** (Linux Mint, RTX A4000, 128 GB) | render node | ComfyUI CanalV2 (`/home/binc/ComfyUI-Installs/CanalV2/ComfyUI`, port 8189), headless Blender, the job queue | shot pipeline area: runs queued jobs, writes reports |
| **Mac Studio** | control, review, development | Claude desktop, Resolve review, Blender GUI, paint app, development | development area: builds and tests; promotes nothing on its own |
| **RunPod** (when needed) | extra compute | containers in `02_SCRIPTS/containers/runpod/` | same as binc-PC, from the brief |

## Network
- Direct cable Mac ↔ binc-PC on its own subnet with static addresses (set when cabled).
- binc-PC is 2.5 GbE until the 10 GbE card is in (PCIe splitter). 2.5 GbE carries proxy work.

## Paths
- The CANALV2 tree lives on binc-PC: `/home/binc/CANALV2_r3/CANALV2`. Plates stay linked where served.
- The Mac mounts the tree over the direct link for review and development.
- Graphs carry binc-PC paths and run on binc-PC or in a container (containers link the same path).
- Scripts take the root as an argument (`--root`), so they run from either machine.

## Coordination
- One git repository, text only: policies, scripts, templates, graphs. No plates, no media, no client tracker (`00_POLICY/storage-and-backup.md`).
- The two agents coordinate through the repository and the job queue (`04_TRACKER/queue/in/`, `running/`, `done/`): a job file in, a report out. Not through Binc.
- The Claude project holds docs and decisions only.

## NAS
- Git server: bare repositories over SSH (a web UI such as Forgejo is optional). The repository starts on binc-PC and its origin moves to the NAS when the NAS is in.
- Backup target: a zero-compression archive of everything, then that is backed up. Include and exclude are Binc's decision, asked first.
- Working caches stay on local NVMe; the NAS is the record, not the scratch disk.

## RunPod
`02_SCRIPTS/containers/runpod/README.md`: RunPod's ComfyUI template and worker images plus our packs, a Blender solve image, and the RunPod MCP for managing pods and volumes. Each first use needs Binc's yes (install, plate upload, spend, registry).

## Access the agents need
- A shell on binc-PC scoped to the CANALV2 folder (pipeline agent).
- `BLENDER_PATH` set for the Blender MCP: `/var/lib/flatpak/exports/bin/org.blender.Blender`.
- `~/ComfyUI-Shared` connected (input, output, models).
