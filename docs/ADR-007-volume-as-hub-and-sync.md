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
hours to under one. Combines with A or B. Built 2026-10-21 as a switch on the
app's push confirmation ("Skip the shots' existing renders", on by default,
`skip_renders` in the request): the three folders are excluded by name, the
confirmation shows the count and size with and without them (24,220 files,
86.7 GB against 4,564 files, 17.5 GB that day), and Pull is what brings renders
back. Later choices (which ComfyUI-Shared folders, the test bucket, and what to do with a file already on the pod) are in ADR-011.

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

### G. RunPod's S3 API onto the volume: no pod at all (found 2026-10-21)
RunPod serves network volumes over an S3-compatible API
(`https://s3api-<datacenter>.runpod.io/`, docs.runpod.io/storage/s3-api): the
Mac pushes with the AWS CLI or boto3 straight onto the volume, no pod running,
no sshd, no idle stop to cut it, resumable, files over 500 MB as multipart,
nothing added to the price. Pull is the same call the other way, so renders
come back without a pod too. The volume is then the bucket of option E
without a third party, and the pod side needs no SSH.

The catch: only fifteen datacenters support it (EU-CZ-1, EU-RO-1, EUR-IS-1,
EUR-NO-1, US-CA-2, US-GA-2, US-IL-1, US-KS-2, US-MD-1, US-MO-1, US-MO-2,
US-NC-1, US-NC-2, US-NE-1, US-WA-1), and Montreal, where our volume is, is not
one. So this option means a new volume in a supported datacenter, chosen for
card stock. On 2026-10-21 morning: EU-RO-1 had the 4090 in high stock at
USD 0.34; EUR-IS-1 the A4000, 4000 Ada and 4090 in low stock at 0.17 to 0.34;
EU-CZ-1 the 3090 low at 0.22; US-IL-1 and US-NC-1 the 4090 low; US-KS-2 the
A6000 low. Romania is the safe pick (the only high-stock entry, no host-full
lottery); Iceland is cheaper when it has stock.

The move: create the volume there, enter it and the datacenter in Default
Configuration, delete the Montreal volume (22 files on it, nothing to keep),
make an S3 key in the RunPod console (Credentials, S3 API keys; the secret
shows once, so a person does it), then push from the Mac. The sync script and
the Sync button of option B drive the AWS CLI instead of rsync. Limits from
the docs: no bucket create or delete over the API (the console does that), no
presigned URLs, a first listing of a folder over 10,000 files can be slow,
`aws s3 sync` struggles past 10,000 files, so the push goes folder by folder
with `cp --recursive`, and clocks more than an hour off are rejected.

### F. Automatic sync
A folder watch or a schedule pushing changes as they happen. Rejected in the
recommendation: hours of upload can start by surprise, a pod may be down, and
client material should not leave the PC without someone pressing something.

## Recommendation (Claude, not decided)

Revised 2026-10-21 after finding G: **G first**, a volume in Romania pushed over
the S3 API, which removes the pod from the copy and makes Pull free of a pod
too; **C** with it, since the Mac's uplink is still the limit; **B** on top of
G (the Sync button drives the AWS CLI, no SSH); E is then not needed, the
volume is the bucket; D is moot; not F. Three attempts over rsync into a pod
all died with the pod, which is the case for G.

## What is built (2026-10-21, while the hub decision stays open)

Option B is in the app, with G's transport for the case the pod is off: a Sync button on
every card opens a confirmation naming the folders and the transport, then runs the copy in
the main process (it outlives the window), streams rsync's or the AWS CLI's lines, counts
files and errors, fills the card's bar, holds the pod's idle stop and restores it after.
The transport rule, in `libs/core/src/syncrun.ts`:

| The pod is | The volume | Transport |
|---|---|---|
| running | any | SSH into the pod (rsync, additive, `-rlt`, no ownership) |
| off | in an S3 datacenter, S3 keys entered in Default Configuration | RunPod's S3 API onto the volume (`aws s3 cp --recursive`), no pod needed |
| off | elsewhere, or no keys | refused, with the reason in the confirmation |

Push: project, comfy-shared, workflows, and plates only with a named yes. Pull: comfy-shared
output and each shot's `06_REVIEW` and `07_DELIVER`. Pressed, never automatic.

## Decision

Open on the hub (C, E, G as the home of the data). To be filled in when Lucas decides; until then the script and the
one-way push are what exists.

## Consequences to weigh

- Any option keeps the volume billing whether or not a pod runs; a stopped
  pod on it bills nothing.
- Two pods writing the same output file name collide; different shots do not.
- Workflows need an "edit in one place at a time" habit under A, B and E
  alike; newest wins covers the normal case.
