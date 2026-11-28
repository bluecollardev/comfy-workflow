# ADR-066: Sync a network volume's outputs to a storage (Network Volumes modal)

Status: accepted, 2026-11-28; **paused by Lucas the same day** ("we don't need to sync to wasabi yet, pause that"). The core and MCP half is built and tested against fakes (`libs/core/src/volumesync.ts`, MCP tool `volume_sync`); the window half (the Sync To Storage button and dialog) is NOT built or shown, and no real sync has been run. Nothing in the app starts a sync on its own. Lucas: "sync all outputs from s3 to wasabi" / "is there an app function to do this?" (there was not) / "via volumes (network volumes modal)".

## Decision

Each network volume row in the Network Volumes modal gets a **Sync To Storage** action. It copies the files under a folder of the volume (default `comfy-shared/output/`) to one of the app's storages (ADR-063: Wasabi, S3, your own; not the publish destination, which is the Panama return). It never deletes, on either side.

- **Where the bytes go**: a **pod** on that volume uploads its own files to the storage by signed PUT links (`publish.podPutTo`, ADR-064). Nothing passes through this PC. If no pod on the volume is running, the plan says so and Start is refused; the app never starts a pod for it (a person resumes one).
- **Two steps**: **Plan** lists the volume over RunPod's S3 API (no pod, no cost; about 400 files a second, so a big folder takes minutes and shows "N files so far"), lists the storage under its directory, and answers how many files and bytes, how many are already there at the same size, what is too big, what is a weight, per top-level folder, and an estimate of pod time and cost. **Start** copies from that plan; it does not list again. Nothing is copied by planning.
- **Rules**: model weights are never sent (`isWeight`); a file already in the storage at the same size is skipped (so Start can be run again after a stop and continues); a file over 5 GB (one PUT) is a named warning, not an upload; keys in the storage are the volume path below the synced folder, below the storage's directory. No keys or links in any message.
- **Queue**: the sync is a job in the Queue (`jobsregistry`, kind `volume-sync`) with files and bytes done, rate, current file, Cancel, and Retry Failed. A failed file does not stop the others; the job ends `done_with_warning` with the list.
- **Spend**: the only spend is the running pod's hourly price, shown in the plan before Start (`estimate.usd`, from the pod's `cost_per_hr` and a measured or assumed rate of 11 MB/s, the figure seen for pod uploads). The MCP `start` needs `approved_by` when the named-yes setting is on (agent permissions).
- **Leave out**: hidden folders (`.previews`, `.proxies`) and test folders (`_TEST_*`, `*_tests`) are ticked off by default in the window and can be ticked on; the plan counts them separately.

## The API (core namespace `volumesync`, the contract the window and the MCP use)

- `plan(req)` -> `{ plan_id }`. `req = { volume_id, storage_id, prefix?: string /* under /workspace, default 'comfy-shared/output/' */, skip_folders?: string[] /* top-level names under prefix to leave out */, pod_id?: string }`.
- `planStatus(plan_id)` -> `{ state: 'listing' | 'done' | 'failed' | 'cancelled', files_so_far: number, error?: string, plan?: Plan }`.
- `Plan = { plan_id, volume_id, storage_id, storage: { name, bucket, prefix, region }, prefix, files, bytes, to_copy: { files, bytes }, already_there: { files, bytes }, too_big: { files, names: string[] /* at most 20 */ }, excluded_weights: number, folders: { name, files, bytes }[], pod: { id, name, cost_per_hr } | null, estimate: { hours, usd, rate_mb_s }, can_start: boolean, reason?: string }`.
- `start({ plan_id, approved_by? })` -> `{ job_id }`.
- `status(job_id?)` -> `{ jobs: Job[] }`; `cancel(job_id)` -> `Job`; `retry(job_id)` -> `{ job_id }` (failed files only).
- `Job = { job_id, kind: 'volume-sync', state: 'uploading' | 'done' | 'done_with_warning' | 'failed' | 'cancelled', volume_id, storage_id, storage_name, started_at, finished_at?: string, files_total, files_done, files_skipped, files_failed, bytes_total, bytes_done, rate: number /* bytes per second */, current: string, warnings: string[], error?: string }`.
- MCP: one tool `volume_sync` with actions `plan`, `plan_status`, `start`, `status`, `cancel`, `retry` (no key or link ever returned).

## Storage details in the Network Volumes modal (2026-11-28, built, not paused)

Lucas: "for wasabi try to show details same as [the volume row]". A storage row shows what a volume row shows: the bucket as the id line, badges, "<size> in <region> · about $<month> a month", and "Used by" (the events it listens to). The size comes from `storage.usage(id)` (`libs/core/src/storageusage.ts`): a read-only listing of the bucket under its directory in the background, counted as lines arrive, kept 10 minutes; the answer is `{ bytes, objects, as_of, state: 'done' | 'listing' | 'failed', objects_so_far?, error?, price_per_tb_month }`. The price is Wasabi's pay-as-you-go list price, 7.99 USD per TB a month (wasabi.com/pricing, checked 2026-11-28; older pages say 6.99; a 1 TB minimum applies and is not modelled), and null for other storages. The publish destination and the Panama exchange are one bucket and are listed whole. MCP: `storage_adapters` action `usage`.

## Not done here

- Pulling from a storage to a volume, and sync on change (the ADR-064 notes): a later ADR.
- Files over 5 GB (multipart from the pod).
- Starting a pod for the job, throttling, scheduling.
- Syncing the publish destination or the Panama exchange (they are not storages in this sense).

## Tests

Core: planning counts (already there, too big, weights, skipped folders, estimate), Start uploads through the signed link with a fake ssh, same-size skip, a failure is a warning, Cancel stops it, Retry sends only the failed. Browser: the row action, the dialog (storage choice, folders, Plan with progress, Start, the job's progress, Cancel), refusal when no pod runs. Real run: one small folder to `bincvfx` before any large one.
