# ADR-069: Configure Sync: for each event, send to where

Status: accepted, 2026-11-28, being built. Lucas: "actually, sends to should be for each toggle, for each event, send to where" (after "should be any volume configured", "everything has sync rules, including local", "why i gotta go somewhere else"). Replaces the storage-centric events of ADR-064 (a storage's own `events` list plus a `volumes` filter) as the thing a person edits.

## Decision

A **rule** is `(volume, event) -> destinations`. In a volume's **Configure Sync** each event has its own destination list:

| Event | When it fires | Where it can send |
|---|---|---|
| **Generated** | a render on a pod of this volume finishes | any ready storage (Wasabi, S3, yours); later a volume, This PC |
| **Approved** | a shot version on this volume is approved | any ready storage; later a volume, This PC |
| **Published** | a publish that sent files from this volume ends | any ready storage; later a volume, This PC |

- A destination is `{ type: 'storage', id }` today. `{ type: 'volume', id }` and `{ type: 'local' }` are accepted by the data but **not built**: shown disabled with "Not built yet", never stored as active.
- The BH exchange bucket is never a destination (ADR-067); its row keeps only **Approved = Auto-publish** (name, tick, dry run, ADR-050). Generated and Published are not offered on it (they would write to the client's bucket).
- **Auto Sync** with This PC stays a per-volume setting beside the events (ADR-046, ADR-068), not an event.
- The same rule is edited from either end, in place, with no "go to another row": on a **volume** row, each event has the list of storages (tick boxes, the default storage first); on a **storage** row, Configure Sync lists the volumes with, for each, the three events as tick boxes (ticking 'Generated' on volume A is the rule `(A, Generated) -> this storage`). This PC's row lists every volume's Auto Sync switch (ADR-068).
- **All volumes**: a rule set for the pseudo volume `*` applies to any volume that has no rule of its own for that event (a storage row offers 'All Volumes' as the first line, as the old empty `volumes` list meant).
- **No rule, no copy.** Nothing is sent unless a rule names the destination. A rule never overrides the safety rules: weights are skipped, a same-size file is skipped, Files over 5 GB are a named warning, a failed copy is a warning, every upload is a Queue job with Cancel (`storage-upload`), keys and links never in a message.

## Data and compatibility

- `sync-rules.json` (0600, `~/.config/runpod-pod-manager`): `{ rules: { "<volume_id|*>": { "generated": [Dest], "approved": [Dest], "published": [Dest] } } }`.
- **Migration on first read** when the file is missing: every storage's old `events` and `volumes` become rules (`volumes` empty -> the pseudo volume `*`, otherwise one entry per volume id); after that the old fields are kept in the storage record untouched but **ignored** (no double sending). The old `generating` and `publishing` events were already dropped.
- `storage.forEvent(event, volumeId)` (what the hooks call) answers from the rules: the destinations of `(volumeId, event)`, else of `(*, event)`; enabled, complete storages only.
- A deleted storage is removed from every rule; a storage that is switched off or not ready stays in the rule and is skipped with a warning naming why.
- The MCP: tool `sync_rules` (actions `get`, `set`; `set` takes `volume_id`, `event`, `destinations`). Keys stay a person's act.

## Core interface (the window and the MCP use exactly this)

- `syncrules.get(volumeId | '*')` -> `{ volume_id, rules: { generated: Dest[], approved: Dest[], published: Dest[] } }` (empty arrays when nothing is set; for a volume with no rules of its own `inherited: { generated: boolean, approved: boolean, published: boolean }` says the `*` rules apply).
- `syncrules.set(volumeId | '*', event, destinations)` -> the same shape; validates the event, that each `storage` id exists and is a real storage (not `panama-s3`/`publish-s3`), drops duplicates, refuses `volume` and `local` with "Not built yet".
- `syncrules.all()` -> `{ rules: { [volume_id | '*']: { generated, approved, published } } }` (one call for the storage and This PC views).
- `Dest = { type: 'storage', id: string }`.

## Amendment: push and pull, every pair (Lucas, 2026-11-28: "push pull all of it", meaning both directions for every pair)

- Every pair of places (a volume, a storage, This PC) is meant to work in both directions: **push** (this place sends to the other) and **pull** (this place fetches from the other). In the Sync window each pair offers both; in Configure Sync a standing rule gets a direction beside its destination (push is the default and the only one built for events).
- What exists: push volume (pod) to storage (events and the window); pull storage to This PC and volume to This PC (the window, `sourcesync`); push This PC to volume (pod sync); pull volume to This PC (pod sync, Auto Sync); bucket to bucket through a pod (`bucketsync`).
- Not built, shown disabled with "Not built yet": pull into a volume (from a storage, another volume or This PC without a pod), pull into a storage from This PC, push This PC to a storage, any pull as a standing rule on an event, sync on change for pulls (S3 cannot call the app: a timer would poll).
- The BH exchange bucket stays pull-only (a source), and is never pushed to except by Publishing (ADR-067, ADR-068).

## Amendment: Push and Pull each have their own events (Lucas, 2026-11-28: "this is awkward with push and pull as push and pull should each have a set of events to attach to")

A direction toggle per destination is dropped. Every row's **Configure Sync** has two blocks, **Push** and **Pull**, and each has its own events with their own lists. Seen from the row you are on: **Push** is the routes that leave this row, **Pull** is the routes that arrive at this row. A route is stored once and shown at both ends, editable at either (the same rule, ADR-069 above).

| Row | Push (leaves this row) | Pull (arrives at this row) |
|---|---|---|
| **A RunPod volume** | events Generated, Approved, Published -> storages (built); **On Change** -> This PC (Auto Sync's "bring new outputs down", ADR-046) | **On Change** from This PC (Auto Sync's "send my changes up"); events Generated, Approved, **Pod Started** from storages, volumes, This PC: not built |
| **A storage** (Wasabi, S3) | events -> volumes or This PC: not built | events Generated, Approved, Published from each volume (the per-volume matrix, built) |
| **This PC (ComfyUI-Shared)** | **On Change** -> each volume (Auto Sync push tick); events -> storages or volumes: not built | **On Change** from each volume (Auto Sync pull tick) |
| **The BH exchange bucket** | none (pull-only source, ADR-067) | Approved = Auto-publish (the only rule, ADR-050) |

- **On Change** is Auto Sync: the volume's change feed (ADR-046), not an event the app raises; it needs the approver's name and applies to every pod on the volume.
- **Pod Started** (Pull): fetch when a pod on the volume starts, as the Panama "pull on start" does today; the generic version is not built.
- The data: `sync-rules.json` keeps today's flat `rules[volume].{generated,approved,published}` as the **Push** lists (nothing to migrate); Pull lists will be stored as `rules[volume].pull.{generated,approved,pod_started}` when an engine exists. Until then the Pull items are shown disabled with "Not built yet" and nothing is stored for them.

## Not done here

- Volume and This PC as destinations; bucket-to-bucket and pod-to-volume on an event; saved routes for the Sync window's one-off runs.
- Per-destination options (a prefix, a filter by shot).

## Tests

Core: migration from old events and volumes, `forEvent` with a volume rule, with only the `*` rule, with both (the volume's own wins), a switched-off storage skipped with a warning, delete cleans rules, `set` validation. Browser: a volume row's three events each with their own storage ticks, the storage row's per-volume tick boxes editing the same rule, 'All Volumes', volume destinations disabled with "Not built yet", BH row with Auto-publish only. Real: one rule `(volume, Generated) -> bincvfx` and one render.
