# ADR-007: How local state and the pod's volume stay in line

**Date:** 2026-10-20
**Status:** Proposed. No decision yet (Lucas, 2026-10-20). The options are below with a recommendation; the decision section is empty until Lucas picks.
**Owner:** Lucas (Blue Collar Dev)
**Extends:** ADR-004 and `docs/MOUNT-POINTS.md`.

## Context

A RunPod network volume is a disk in RunPod's datacenter. The Mac's folders
never mount there; the pod reads a copy. Every pod the app makes attaches the
same volume (`comfy-workspace`, 120 GB, `CA-MTL-1`, about USD 8.40 a month), so
there is one copy of the data, any number of pods over time, all in that
datacenter and in the secure cloud, and several pods at once are possible.
Deleting a pod loses nothing.

What exists today: the copy is made by rsync over SSH from the Mac into a
running pod (`infra/scripts/sync_volume.py`, `./start.sh sync --pod <id>`),
one way, additive, never deleting, started by a person in a terminal. On
2026-10-20 that showed its limits:

- the Mac's uplink gives a few MB per second, so the 98 GB (81 GB project
  tree, 17 GB ComfyUI-Shared) takes hours, and the GPU pod bills while it runs;
- a stop mid-copy cut it (the idle watch and the sync do not know about each
  other);
- nothing brings a pod's renders back down: outputs stay on the volume;
- workflows are the one folder written on both sides, so two edits can collide.

Lucas's question: "how should we keep our local state in line with the pod".

## What is fixed whichever way this goes

Per folder, who writes where. This is the contract any option implements:

| Folder | Written on | Needs to move |
|---|---|---|
| Project tree | binc-PC (source of truth); the pod renders into each shot's `06_REVIEW`, `07_DELIVER` | up: the tree; down: those shot outputs |
| Plates | nowhere (read-only client material) | up once, with a named yes |
| ComfyUI-Shared `input/`, `models/` | the Mac | up |
| ComfyUI-Shared `output/` | the pod | down |
| ComfyUI-Shared `workflows/` | both | both ways |

## Options

### A. Keep the script, add Pull
The reverse rsync for `output/` and the shots' `06_REVIEW`, `07_DELIVER`.
Same flags, a few lines. Still terminal-only, still no link to the idle stop.
Smallest change; the gap in the UI stays.

### B. Push and Pull in the app
A Sync button on the card: Push and Pull, both rsync over SSH driven by the
core, per-folder progress on the card's bar, the idle stop held while it runs
and restored after, a warning before Push listing graphs newer on the pod,
plates gated on a named yes. Newer file wins (`-u`), `--delete` never. The
Python script retires (ADR-005). Pressed, never automatic: a push is hours
and a pod comes and goes. A day's work.

### C. Push less
Skip what the pod never reads: the shots' `05_TEMPS`, `06_REVIEW`, `07_DELIVER`
(66 GB of Binc's existing renders in the mirror). The first push drops from
hours to under one. Combines with A or B.

### D. A CPU pod for the sync
The sync needs no GPU: a CPU pod on the volume at about USD 0.04 an hour
against 0.35 for the A40, created for the sync and deleted after. Montreal had
no CPU flavour available on 2026-10-20, so this can only be a fallback.

### E. A bucket as the hub
S3-compatible storage (Backblaze B2 or Cloudflare R2, about USD 5 per TB a
month, no egress on R2) that the Mac, binc-PC and the pod all sync against
with rclone. The pod fills from the bucket at datacenter speed in minutes; two
PCs stay in line through the bucket rather than through each other; a second
volume in another datacenter (Montreal ran out of cards twice in one day) is
filled bucket to volume, not from a Mac. Costs an account, a key and a second
sync tool. Only pays off once a second machine holds data.

### F. Automatic sync
A folder watch or a schedule pushing changes as they happen. Rejected in the
recommendation: hours of upload can start by surprise, a pod may be down, and
client material should not leave the PC without someone pressing something.

## Recommendation (Claude, not decided)

C now, since the sync is running anyway; A today because renders are otherwise
stranded; B next; E when the second PC arrives; D opportunistically; not F.

## Decision

Open. To be filled in when Lucas decides; until then the script and the
one-way push are what exists.

## Consequences to weigh

- Any option keeps the volume billing whether or not a pod runs; a stopped
  pod on it bills nothing.
- Two pods writing the same output file name collide; different shots do not.
- Workflows need an "edit in one place at a time" habit under A, B and E
  alike; newest wins covers the normal case.
