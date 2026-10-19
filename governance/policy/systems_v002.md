# Systems: two machines, NAS, git, RunPod

Binc, 2026-10-15: two-system workflow (Linux PC + Mac on a direct link), a common Claude project with coordinated code, a NAS for backup and git, RunPod containers when we need the compute.

## Compute (Binc, 2026-10-15)

Two compute resources, both complete, both used. Binc's brief determines which resource a job runs on. No policy reserves a machine for one area, and no agent restricts a resource in order to control a workflow.

Every job, on either machine or on RunPod, runs as a real ComfyUI graph Binc can open.

| Resource | Has | Runs |
|---|---|---|
| **binc-PC** (Linux Mint, RTX A4000, 128 GB) | ComfyUI CanalV2 (`/home/binc/ComfyUI-Installs/CanalV2/ComfyUI`, port 8189), headless Blender, the CANALV2 tree on disk | graph runs, proxy renders, solves, queued jobs |
| **Mac Studio** | ComfyUI (Binc's main working surface), Resolve, Blender, paint app, Claude desktop; the tree over the direct link | graph runs, Binc's own graph work and HITL passes, review, development, queued jobs |
| **RunPod** (when needed) | Pod + network volume, CPU solve pod; containers in `02_SCRIPTS/containers/runpod/` | overflow; each first use needs Binc's yes (MCP install, plate upload, spend, registry) |

- One Claude Code agent per machine. Each runs the jobs the brief assigns to its machine; each stops and writes a report on any ambiguity.

## Network
- Direct cable Mac ↔ binc-PC on its own subnet with static addresses (set when cabled).
- binc-PC is 2.5 GbE until the 10 GbE card is in (PCIe splitter). 2.5 GbE carries proxy work.

## Paths
- The CANALV2 tree lives on binc-PC: `/home/binc/CANALV2_r3/CANALV2`. Plates stay linked where served.
- The Mac mounts the tree over the direct link.
- Scripts take `--root`; graphs carry the CANALV2 path; containers and the Mac mount link the same path, so a graph loads and runs the same on any resource.

## Coordination
- One git repository, text only: policies, scripts, templates, graphs. No plates, no media, no client tracker (`00_POLICY/storage-and-backup.md`).
- Coordination through the repository and the job queue (`04_TRACKER/queue/in/`, `running/`, `done/`): a job file in, a report out. The brief writes the job file and names the resource. No agent assigns work to the other, and no agent runs on a machine while Binc is working in its ComfyUI without the brief saying so.
- The Claude project holds docs and decisions only.

## NAS
- Git server: bare repositories over SSH (a web UI such as Forgejo is optional). The repository starts on binc-PC and its origin moves to the NAS when the NAS is in.
- Backup target: a zero-compression archive of everything, then that is backed up. Include and exclude are Binc's decision, asked first.
- Working caches stay on local NVMe; the NAS is the record, not the scratch disk.

## RunPod
`02_SCRIPTS/containers/runpod/README.md`: RunPod's ComfyUI template and worker images plus our packs, a Blender solve image, and the RunPod MCP for managing pods and volumes. Each first use needs Binc's yes (install, plate upload, spend, registry).

## Access the agents need
- A shell on each machine scoped to the CANALV2 folder.
- `BLENDER_PATH` set for the Blender MCP: `/var/lib/flatpak/exports/bin/org.blender.Blender`.
- `~/ComfyUI-Shared` connected (input, output, models).
