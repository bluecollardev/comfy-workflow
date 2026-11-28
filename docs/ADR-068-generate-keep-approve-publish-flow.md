# ADR-068: The flow: generate on a pod, keep in Wasabi, approve, publish from Wasabi to the Panama delivery rounds

Status: accepted, 2026-11-28; the flow is the target, what exists and what does not is in "Where it stands". Lucas: "generate rounds on pod -> sync generated outputs to wasabi -> approve shots and coloring etc -> publish from wasabi if ok to delivery rounds in panama" / "that was the purpose of our toggles in the default configuration. move these toggles to our sync functionality in the network volumes instead, so it's in one place not two. default configuration is for keys and default buckets".

## The flow

1. **Generate** on a pod (Run Workflows, Generate window, Auto-generate; ADR-048): a round's shots render on the pod and stay on the volume.
2. **Keep**: each finished render is sent from the pod to the default storage (Wasabi, `bincvfx`) as it finishes (Upload On Generated, ADR-064), by signed links, never through this PC. The storage is the working store and the long-term copy; keys in it are the volume's own output paths (`deliver/<shot>/v###/<clip>.mov`, `.proxies/...`).
3. **Review** from the storage: Outputs window with the storage as Source, Network Volumes Explore, or Sync To This PC for a headset folder (ADR-067, `docs/MOON-PLAYER-REVIEW.md`).
4. **Approve**: a person with a name approves a shot version and states its colour (ADR-050: the named yes; the colour record `colour_in`, who and when, travels in the version's `.meta.json`). Approval is a record, not a copy; with Upload On Approved the approval marker and the review files also go to the storage, so the storage alone says what is approved.
5. **Publish if ok**: a publish whose **source is the storage copy** writes the approved version into the **delivery round in the Panama bucket** (`returns/BKK/<round>/<shot>/<clip>`, the BKK return layout of ADR-050/055, with the return manifest and the Slack post). "If ok" is checked, not assumed: the version is approved by a named person; the sequence is complete (frame count against the sidecar and the EDL); its colour is stated; the object sizes in the storage equal the sidecar's; the sha256 made at render equals the sha256 of the bytes that went to Panama (computed on the pod while piping); nothing is a model weight. Any failed check refuses that version with its reason and publishes nothing of it. The dry run first and the cancel window of Auto-publish still apply.

## Where each thing is configured (one place, not two)

- **Default Configuration** holds **keys and default buckets** only: each storage's bucket, region, directory and keys, its title and order, which storage is the default, the Panama keys and the publish destination. No behaviour that moves files is switched there.
- **Network Volumes** holds **everything that moves files**: the Sync window (one-off runs, ADR-067) and each bucket row's **Sync Rules** (the Upload On events of ADR-064: Generating, Generated, Approved, Publishing, Published; later saved routes and on-change). The same Sync Rules block is on the BH exchange row, with its two fixed rules: Publishing is always on, and Approved is Auto-publish (ADR-050), switched there with its name, tick and dry run. The Storage tab's Upload On switches are removed (the stored `events` do not change; only where they are edited).
- Publish defaults (what a publish includes, Slack) stay in the Publishing tab; they are settings of an act, not of a bucket.

## Sync Rules on every row (Lucas, 2026-11-28: "each volume should also have auto sync under sync rules" / "sync rules should specify any volumes you want to sync to as well in wasabi or s3" / "everything has sync rules, including local")

Every row in the Network Volumes modal has a **Sync Rules** section: each RunPod volume, each storage (Wasabi, S3, yours), the BH exchange bucket, and the built-in local ComfyUI-Shared (This PC). The rules are the saved routes between those places, shown from either end (the same data seen from the row you are on):

| Row | Rules shown | What they are stored as |
|---|---|---|
| **A storage** (Wasabi, S3) | Upload On events (Generating, Generated, Approved, Publishing, Published); **Volumes**: which volumes' pods it receives from (empty = every volume) | the storage record: `events`, `volumes` (built in the core) |
| **A RunPod volume** | **Auto Sync** with This PC (pull, push, the approver's name, ADR-046); **Sends To**: the storages that receive this volume's outputs, each with its events (the storages' `volumes` and `events` read from this end: ticking a storage adds this volume to its list) | Auto sync settings keyed by the volume (every pod on it follows; a pod's own older setting still applies); the storage records above |
| **The BH exchange bucket** | the same Upload On events, with Publishing locked on and Approved = Auto-publish; **Volumes** as for a storage | `publish-s3` flags (events) |
| **This PC (ComfyUI-Shared)** | **Receives From**: the volumes whose Auto Sync pulls into it, the storages it is a Sync To This PC target of (listed, started from the Sync window); **Auto Sync** is shown here read-only as the other end of the volume's rule | read from the volumes' Auto sync settings |

- A rule that has no engine yet is shown disabled with "Not built yet" (a volume as a copy target, bucket to bucket on change, a storage pulling into a volume), so the section is the one honest list of what is planned and what runs.
- Auto sync stays per volume now: turning it on needs the approver's name (ADR-046) and applies to every pod on that volume, running now or resumed later; the per-pod Auto sync settings in the Sync window, the Default Configuration's `auto_sync` block and a pod's own configuration block go away from the UI (existing per-pod settings keep working until the volume setting replaces them).
- The Sync window keeps the one-off runs; Sync Rules are the standing ones.

## Rules that hold along the whole flow

- Wasabi and Panama are never written except by these steps; Panama only by Publishing with a named approval (never by the generic bucket sync, ADR-067 amendment). Nothing is deleted anywhere by the flow (Erase of a storage is its own confirmed act).
- Every step is idempotent: a file already at the target at the same size is skipped, so a stopped step runs again.
- Every transfer is a Queue job with progress and Cancel, and History lines; no keys or links in any message.

## Where it stands (2026-11-28)

| Step | State |
|---|---|
| Generate on a pod | built (ADR-048) |
| Generated sends the render from the pod to Wasabi | built and proven on a real pod with a 25-frame proxy (285 KB `.mp4`); a review `.mov` has not been run through it |
| Upload jobs in the Queue | built (kind `storage-upload`) |
| Review from the storage | Outputs Source and Explore built; Sync to this PC built (against fakes) |
| Approve with a named yes and a stated colour | built (ADR-050; the colour record is in the sidecar) |
| Approved sends the review files to Wasabi | built only for files already on this PC; **from the pod volume: not built** |
| Approval marker in the storage | not built |
| **Publish from the storage to the Panama delivery round**, with the checks above | **not built**: publishing today reads from the pod volume or this PC |
| Sync Rules in Network Volumes instead of the Storage tab | being moved now |
| Saved routes, sync on change | not built |

## Open

- Where approvals live: the app's `approvals.json` today; mirroring a small marker to `approvals/<shot>/<v###>.json` in the storage (proposed) lets the storage alone answer "approved?".
- Whether proxies are reviewed in the storage too or only review versions (proposed: both are kept; only review versions are published).
- The publish-from-storage transport: a pod pipes the storage object to the Panama PUT link (as bucket sync does) computing the sha256 on the way; Publishing, not the bucket sync, owns the write so the named approval, manifest and Slack apply.
