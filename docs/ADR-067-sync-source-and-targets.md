# ADR-067: The Sync window chooses a source and several targets

Status: accepted ("go", 2026-11-28); phase 1 built (pod to storage, volume or storage to this PC, the window under Network Volumes); phase 2 (any bucket to any bucket) amended below and being built. Lucas: "i want a mechanism on the pod cards, under sync to choose targets - local, a volume etc." / "right now sync is only for pod to local, but i want to be able to choose source" / "you should be able to choose multiple targets".

## Decision

The pod card's Sync window (`SyncModal.vue`, today only pod to this PC) gets a **From** choice (one) and a **To** list (one or more, tick boxes).

- **From**: This Pod (the default, today's behaviour), a Network Volume, or a Storage (ADR-063: Wasabi, S3, yours).
- **To**: This PC (the default, today's behaviour), a Network Volume, a Storage. Several can be ticked: each ticked target is its own job in the Queue with its own progress and Cancel, started together, one failing does not stop the others.
- Same rules everywhere, as in the pod sync: nothing is ever deleted at the target; a file already there at the same size is skipped, so any job can be run again; the top-level folders are ticked in or out (the existing leave-out lists apply to a pod source); model weights are skipped unless the folder list says otherwise; the plan comes first (listing with "N files so far", then counts, bytes, estimate) and nothing moves until Start; no keys or links in any message.
- The Sync button on the card keeps its green Auto sync state; Auto sync (pod to this PC) is not changed.

## Which pairs exist (the matrix)

| From \ To | This PC | A Storage | A Network Volume |
|---|---|---|---|
| **This Pod** | exists (rsync over ssh) | phase 1: the pod uploads its own files by signed links (ADR-064/066 building block, built against fakes, paused) | later |
| **A Network Volume** | phase 1: downloads over RunPod's S3 API into the mapped local folders (no pod) | later: needs a pod or this PC in the middle | later: the existing volume clone job is the model |
| **A Storage** | phase 1: downloads from the bucket (`aws s3 cp/sync`) into a local folder you pick | later | later |

A pair that is not built is shown but disabled with the reason ("Not built yet"), so the window shows what is planned. In phase 1 a pod source can tick This PC and any number of storages; a volume or storage source can tick This PC only.

## Amendment 2026-11-28: any bucket to any bucket, and a Sync button on every bucket row

Lucas: "wasabi and bh exchange bucket need sync to pc options" / "any bucket can be configured to sync to any bucket".

- **Every bucket row in Network Volumes has the icon-only Sync button**, as the volume rows do: Wasabi, your own storages, and the BH exchange bucket. It opens the Sync window with that bucket as From and This PC ticked.
- **The BH exchange bucket is a source only.** Writing to it is publishing to the client; that stays in Publishing with its named approval and guards (ADR-050, ADR-065), so the BH bucket is never a target of this window. Reading from it needs the Panama keys (app keys or the AWS profile), as the Panama pane already uses; the Panama on/off switch applies.
- **Bucket to bucket**: any of {a network volume over S3, a storage, the BH exchange} to any storage. The bytes go through a **running pod** chosen in the window ("Run On"): the app signs a GET link for the source object and a PUT link for the target object, and the pod pipes one into the other (`curl` the GET into `curl -T -` with the known `Content-Length`), nothing is written to the pod's disk and nothing passes through this PC. No running pod: the pair is disabled with "Needs a running pod to carry it". Files over 5 GB are a warning (one PUT), a file already at the target at the same size is skipped, weights are skipped, nothing is deleted, the plan comes first, it is a Queue job with Cancel and Retry Failed, no keys or links in any message.
- **Matrix after this**: From {pod, network volume, storage, BH} to {This PC, storage}; BH and a network volume are not targets (a volume target stays a later clone-style copy). A storage cannot be both From and To.
- **"Configured"**: saved routes (a bucket's list of targets, run on demand or on change) are the next step and are not in this build; this build makes any run possible from the window.

## Why this is not one big copy engine

Each pair moves bytes a different way and costs differently: pod to PC is rsync over ssh; pod to storage is the pod uploading (pod hours); volume or storage to PC is a download to this PC (this PC's bandwidth, no pod). Treating them as separate jobs under one window keeps each simple and cancellable, and the Queue shows what is moving where.

## Open

- The local folder for a storage source (default: the mapped ComfyUI-Shared `output`; editable).
- How a volume's keys map to local folders (`comfy-shared/` to the mapped ComfyUI-Shared, `project/` and `plates/` likewise, the same map the pod sync uses).
- Pull to a pod, volume to volume, and storage to storage are later ADRs.
- Sync on change (a timer, since S3 cannot call the app): later, with the settings on the storage card (ADR-064 notes).

## Tests (when built)

Core: each phase-1 pair against fakes (plan counts, same-size skip, weights skipped, one failure is a warning, Cancel, Retry Failed, two targets at once with one failing). Browser: From and To in the window, the disabled pairs with reasons, several targets ticked starting several Queue jobs. Real: one small folder from a storage to this PC, then from the pod to `bincvfx`.
