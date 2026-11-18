# ADR-046: Auto sync, and the change feed of the volume

**Date:** 2026-11-18
**Status:** Proposed. Nothing built. Lucas asks for a solution and an ADR; the decisions he is asked to make are in "Decisions needed".
**Context from:** Lucas ("before release we want an auto sync on pods to pull the volume on filechanges. have an api for this filechange data. maybe we can have db trigger or use model events on save or something. suggest a solution and adr"; "eg Sync CanalV2-lores-v003-a-v27 modal should have a checkbox to autosync and when saved the card Sync button should be colored green / success").
**Extends:** ADR-007 (the volume is the hub; additive, never deletes), ADR-011 (what a sync carries: `sync_shared` push, `pull_shared` pull, `existing`), ADR-045 (the volume over S3 without a pod), ADR-042 (Retry Later's pod watches: the same kind of background watcher).

## Context

Sync today is a button: a person presses it, a plan is shown, a run moves files in one direction (push this PC's folders to the volume, or pull the pod's outputs down), additive, never deleting (ADR-007, ADR-011). Two things are wanted: it should happen by itself when files change, and the data about what changed should be available as an API (to the app, to agents, to pods).

The two directions are not alike:

| Direction | Where the change happens | How we can know |
|---|---|---|
| **Push** (this PC to the volume: `input`, `models`, `workflows`) | on this Mac | a local file watcher (FSEvents through Node's recursive `fs.watch`): immediate, free, easy |
| **Pull** (the volume to this PC: `output`, and anything else a pod or another person wrote) | on the volume, written by a pod's ComfyUI, by another pod, by Binc, by our own imports | **hard**: RunPod's S3 API for volumes has no event notifications (no SNS/SQS), and a network volume does not carry inotify events between hosts |

ComfyUI writes its outputs itself, so there is no "save event" in our code for the most important pull. Everything below is about making the volume side knowable.

## Options for the volume side

1. **Poll the listing (a reconciler).** List allowlisted prefixes over the S3 API (no pod, no spend; ADR-045 already does this) and compare `LastModified` + size with the last snapshot kept per volume. Needs nothing in the image. Latency is the poll interval; deletes and renames are only inferred; cost grows with the object count (`output/` has tens of thousands of files, so it is listed by prefix, newest folders first, never whole). Correct for everything, including writes that bypass our tools.
2. **A change journal written at save time** (the "model events on save" idea). Every writer appends a small event after it writes: our own code paths (imports, sync, model fetch, round pull, place, erase) in the app, and, for ComfyUI's own writes, a small agent in each pod using **inotify**, which does see the writes made by processes on that pod (even on a network mount) and is exactly a "saved" event. Low latency, knows the writer, knows deletes. Needs the pod image to carry the agent, and only sees writes made through something that emits.
3. **A database with triggers / NOTIFY** (Postgres, Supabase). Gives the event semantics, but the files are not rows: a trigger fires on a row, not on a file, so every writer would still have to write the row (option 2 with a heavier store), plus a service to run, secure and pay for, and an outage stops syncing. SQLite on the volume is unsafe (file locking over a network mount). Not recommended now; the journal below has the same shape, so a database can take its place later if several people share one feed.
4. **inotify on the pod alone.** Does not see writes made by another pod or from outside; fine as the producer in option 2, not as the whole answer.

## Decision (recommended)

**A volume change feed in two layers, with the app as its reader, and Auto sync built on it.**

### 1. The feed (the "API for the filechange data")
- **Source of truth: a journal on the volume** at `comfy-shared/.journal/<yyyy>/<mm>/<dd>/<ulid>-<writer>.json`, one small file per event batch (never a shared append-only file: appends from several hosts to one file are not atomic on a network mount; a time-sortable key per event is atomic and lists cheaply in key order). An event: `{ seq (the key), ts, writer ("app:sync", "app:import", "app:models", "pod:<id>", "reconciler"), op ("created" | "modified" | "deleted" | "batch"), prefix or path, files, bytes, sha256 (when known) }`. A long write (a round pull, a model fetch) emits one `batch` event for its prefix when it ends, not one per file.
- **The cursor** is the last key read. S3 lists in key order, so "everything after the cursor" is one cheap `StartAfter` listing of `.journal/`; no scan of the data.
- **Reader API:** core `changes.list({ volume_id, since, prefix, limit })` and the MCP tool `volume_changes` (same arguments), reading the journal over S3, so it works with no pod running (ADR-045). A pod can read the same files straight from the mount. No new always-on server.
- **Retention:** day folders are compacted into one file after 14 days and removed after 90; the journal is our own hidden folder, never Binc's material, and deleting from it is the only deletion this ADR adds (stated, configurable).

### 2. The writers
- **In the app (phase 1):** every path that writes to the volume emits a `batch` event after it succeeds: sync (push and pull), import apply, round pull and place, model fetch, erase (as `deleted`). These are the "model events".
- **In each pod (phase 2):** a small agent in the image (`comfy-app`, started with ComfyUI, supervised) runs inotify on the allowlisted folders (`output/`, `workflows/`, `input/`, `models/`, `node-packs/`), debounces (about 5 s), and writes `pod:<id>` events for what changed on that pod. This is what catches ComfyUI's own outputs. It needs an image rebuild and the pinned digest moved (ADR-042).
- **The reconciler (phase 1, always):** while an Auto sync pod or volume exists, the app lists the allowlisted prefixes every few minutes (default 5; `output/` newest folders first) and writes `reconciler` events for differences from its snapshot. It is the safety net for anything that bypasses the journal (a manual upload, Binc's own tools, a pod without the agent) and the whole mechanism until phase 2 exists.

### 3. Auto sync (what the person sees)
- **Per pod, in the Sync window:** an **Auto sync** checkbox with two sub-choices, **Pull volume changes** (default on) and **Push this PC's changes** (default off), and a Save. It is stored with the pod's own configuration (next to `sync_shared` / `pull_shared`, ADR-011), so it follows Recreate.
- **On the card:** the **Sync button is green (success)** while Auto sync is on for that pod, with a tooltip "Auto sync on: pulled 3 files at 18:20" and the plan's status line under the button; an error turns it amber with the reason.
- **Pull:** a controller in the core (a timer like the pod watches, ADR-042) reads the feed every 30 s for each Auto sync pod's volume, turns the new events into folders and file lists, and runs the existing sync with a new **paths** filter (rsync `--files-from` over SSH, or `aws s3 cp` per key over S3, so a stopped pod or no pod is fine). It pulls only the folders in `pull_shared`.
- **Push:** a local watcher (FSEvents) on the folders in `sync_shared`, debounced about 10 s, queues a push of the changed files only.
- **Safety, all inherited and some new:** additive and never deleting (ADR-007); the project tree and plates (Binc's material) are never included, only ComfyUI-Shared folders; a file changed on both sides since the last sync is **not overwritten** and is reported as a conflict (a small per-pod "last synced" manifest in the app's config folder decides); the event's `writer` stops echo (our own pull does not write events, our own push events are ignored by the pod agent); events are untrusted data: paths are validated inside ComfyUI-Shared, only whitelisted actions run.
- **Named yes:** turning Auto sync on needs the approver's name, recorded in the History (it moves data between machines and keeps doing so; Binc's rules treat sending as an explicit yes); turning it off needs nothing.
- **Cost:** none from RunPod for the feed or the S3 transport; an SSH transport needs the pod running and bills as it does today; a spend or bandwidth cap per hour is a setting (default off for push of `models`).

### 4. Also useful to the pod, with no copy (phase 2)
The same feed lets the pod agent refresh what ComfyUI caches without a person: a `models/` event triggers a model-list refresh, `node-packs/` events link the packs and mark the pod "needs restart", `input/` and `workflows/` need nothing (read on demand). It never restarts ComfyUI by itself.

### 5. Outputs come to this PC by themselves, with a banner (Lucas, 2026-11-18)
Lucas: "when outputs are generated we want them to sync to our local. display progress as an alert just below nav above the summary / aggregate cards" (the row with Total pods, Running, Stopped, Credits Remaining, Storage / month).
- **The trigger for outputs does not have to wait for the feed.** A run started from the app already ends with the list of files it made (the run job's `files`, the saved record in `output-runs.json`, ADR-037 and ADR-045). When a graph finishes with files, the pull controller is told at once and pulls exactly those paths; a run started somewhere else (ComfyUI's own window, an agent) is found by the feed and the reconciler (sections 1 and 2). So the latency for the common case is seconds, and phase 1 needs no image change.
- **Where they land:** the same relative path under this PC's mapped ComfyUI-Shared `output/` folder (`output/proxy_v004/.../*.dpx`); additive, an existing file with the same size is skipped; the transport is the S3 route when the volume has it (works with the pod stopped) else SSH to a running pod.
- **The banner:** one alert under the navigation bar and above the summary cards (the same band as the failed-action alert and the toasts' anchor, so nothing is covered), shown while something syncs and for a few seconds after. It reads like "Syncing outputs to this PC: 12 of 25 files · 1.1 of 1.2 GB · 38 MB/s · `archival-080_a_v004_proxy.0011.dpx`", with a progress bar, one row per pod when several sync, a **Pause auto sync** link, a click that opens that pod's Sync window, and on finish "Pulled 25 files (1.2 GB) to `output/`" that dismisses itself after about 8 seconds. An error does not dismiss: it names the file and the reason and offers **Retry**. It reuses the Sync window's progress events (files done and left, bytes, rate, the newest files), so the two always agree.
- **Size is real:** a DPX sequence is about 1.2 GB per 25 frames, so the controller has a size cap per run (default: ask, above 5 GB) and a global **Pause**, and it never starts a second pull for the same pod while one runs.

## Consequences
- Phase 1 needs no image change and no new service: the journal written by the app, the S3 reconciler, the `volume_changes` API, the Sync window checkbox and the green button, the paths filter, the pull controller. Latency for ComfyUI's outputs is the reconciler's interval (minutes).
- Phase 2 adds the pod agent: seconds of latency, deletes and renames, the refresh actions; costs an image rebuild.
- A new folder `comfy-shared/.journal/` appears on the volume; a sync must not carry it to this PC, and the volume browsers hide dot folders.
- The journal is a small durable contract other tools can use (agents ask `volume_changes` instead of listing the volume).

## Decisions needed (Lucas)
1. **Phases:** start with phase 1 (journal from the app plus the S3 reconciler, no image change) and add the pod agent later, or build the agent first for low latency?
2. **Defaults:** is Pull on and Push off right? Should Push cover `models` (large) at all by default?
3. **Conflicts:** report and skip (recommended), or prefer the newer side for `workflows` only?
4. **Reach:** `output/` only for pull at first, or also `workflows/` (Binc and pods both write graphs)?
5. **Retention:** 14 days then compacted, 90 days then removed: acceptable?
6. **Outputs to this PC:** pull every new output automatically (the banner shows it), or only for runs started from the app, or only after a click on the banner? What size is too big to pull without asking (default 5 GB per run)?
7. **Where:** the mapped ComfyUI-Shared `output/` with the same relative paths (recommended), or a separate folder per pod?

## Not decided / open
Whether a person other than Lucas will share one feed (a database then earns its place); an hourly bandwidth cap default; how a pod that was created before the agent existed learns the agent (a one-time install over SSH is possible but is an install and needs its own yes).
