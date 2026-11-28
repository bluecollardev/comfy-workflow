# ADR-072: This PC as the destination of an event

Date: 2026-11-28. Status: built, not released. Amends ADR-069.

## Context

Lucas wants renders to come down to this Mac, and to be pushed on an event rather than polled. Neither Wasabi nor a RunPod volume can reach into the Mac,
so nothing outside can send to it.

## Decision

- A sync rule destination is a storage (`{ type: 'storage', id }`) or This PC (`{ type: 'local' }`). A volume as a destination is still refused.
- "Push on event" to This PC is the app reacting to its own event (Generated, Approved, Published) and downloading that event's folder from the volume
  to the same place under the mapped ComfyUI-Shared (`libs/core/src/localcopy.ts`). No timer.
- The download is `sourcesync`'s (RunPod S3, no pod): a Queue job; files of the same size are skipped, a file of another size is left alone, nothing is
  deleted, weights never come. It is best effort and never fails the event; what it did or why not is a History line.
- The ticks are on This PC's row (per volume and event) and on each volume's row. Auto Sync (On Change, both directions) stays beside them on both rows.
- This PC can also pull from a storage: a rule keyed by the storage id with `{ type: 'local' }`. It fires when the app itself has put an event's files in
  that storage, and downloads their folders to the same place under ComfyUI-Shared/output. Files put there by anything else are not noticed: Pull Now
  (the Sync window, from that storage) covers those.

## Consequences

- The app must be running when the event happens. An event missed while it is closed is not replayed.
- Generated brings down only what was rendered on a pod. Approved brings down a version found on the volume. Published brings down only the folders
  whose files were published from the volume.
- With ComfyUI-Shared not mapped, nothing is copied and History says so.
- Approved and Published also send files that are only on the volume to the storages: each is read once over the volume's S3 API through this PC (no pod) and keeps the volume's layout below
  `comfy-shared/output/`, as Generated does. `npm run storage:live` checks these paths against the real services; it is not part of the merge gate.
