# ADR-064: Storage adapters upload on events you choose

Status: accepted, 2026-11-27. **Corrected the same day** (Lucas: "wrong this is pod to wasabi for long term storage"): events upload FROM THE POD, not from this PC. Built so far: the events setting, the switches, the MCP action and hooks that upload files already on this PC; that source is wrong for this purpose and is replaced by the pod route below. Pulling from an adapter is not built: see "Next".
Lucas: "in the storage section of the default configuration, we want to have an extra field to toggle events (publishing, published, generating, generated, approved) that we want to attach the upload actions. like when a shot is approved through the UI we want to publish to the panama bucket. this should be configurable though. when a shot is generated we want to upload to bincvfx bucket." / "again this needs to be configurable".

## Correction: the pod is the source

An adapter such as Wasabi is **long-term storage the pod writes to**, not a mirror of what this PC holds. A render stays on the pod's volume (Sync off), and Lucas does not want it pulled through this PC to be sent on ("i don't want to stream through this pc"). So an event makes the **pod** upload its own files:

- The app signs one PUT link per file for the adapter's endpoint and bucket (`s3presign.ts`, path style, the endpoint's host; Wasabi is `s3.<region>.wasabisys.com`) and the pod runs `curl -T` to it over ssh, the way the publish `pod` transfer already does (`putScript`, ADR-050). The pod never holds the adapter's keys; the links are short-lived and never logged.
- Files are read from the pod's volume paths the job reports (the sequence's `output/` path), so a render that was never pulled is still stored.
- One PUT is at most 5 GB (`PUT_MAX_BYTES`); a larger file is a warning that names it, and is not uploaded. Checked 2026-11-27 against the files on this PC: the largest movie is 0.93 GB (ProRes eye files of one shot), a DPX frame is 35 MB. So 5 GB holds for what exists today. Longer shots or heavier codecs may pass it; the warning shows when, and multipart from the pod (`aws s3 cp` on the pod, or S3 multipart with signed part links) is then the next ADR. Only this PC's mirror was sampled, not the volume.
- If no pod is running that can reach the volume, the event is recorded as waiting for the next pod and retried by the same background pass that retries publishing, never silently dropped.
- What stays from the first version: the events list per adapter, the five switches, `forEvent`, the MCP action, the same-size skip (a `HEAD` on the signed link) and weights never sent. Files on this PC are an optional source only (Approved reviews that exist locally); the pod is the default.

## Decision

Every storage adapter (ADR-063) gets an **events** list: which moments make it receive files. It is a setting on the adapter, edited on its card in the Storage tab as five switches, saved with the window's one Save. Nothing is wired to an event in code; an adapter with no event ticked gets nothing (it can still be tested and used by hand).

| Event | When it fires | What is uploaded (from the pod's volume) |
|---|---|---|
| `generating` | each sequence of a render job as soon as its files are on this PC | that sequence's rendered files |
| `generated` | a render job finishes (state done) | the files the job produced on this PC |
| `approved` | a person approves a review version in the UI (or the MCP, with a name) | that version's review files |
| `publishing` | during a publish job, after each file reaches the destination from this PC | that file (this is what ADR-063 does today for every enabled adapter) |
| `published` | a publish job ends done or done with a warning | the files that job uploaded from this PC |

### Defaults

- An existing adapter keeps what it does today: `publishing` only, so a restart changes nothing.
- A new Wasabi adapter, and a new storage you add, start with no event ticked and **off**, as in ADR-063.
- Lucas's two cases are settings, not code: the bincvfx Wasabi bucket gets `generated`; the Panama publish destination gets `approved`.

### Approved to the Panama bucket

The Panama publish destination (`publish-s3`) is the record of delivery, so an approval must not skip the guards the app already has for it. `approved` on `publish-s3` is Auto-publish (ADR-050), unchanged: its standing approval, dry run first, cancel window and daily cap all still apply, and it only runs for versions a person has approved. Ticking the event on that card is the same switch as Auto-publish's, shown where the destination is.

### Rules that hold for every event

- The same weights rule: model weights are never uploaded (`isWeight`).
- A copy that fails is a **warning** on the job or a line in History, never a failed render, a failed approval or a failed publish. No keys and no URLs in any message (`redact`).
- Only files on this PC are uploaded by an event. Files that exist only on the volume are **never** streamed through this PC by an event (Lucas, 2026-11-27: "i don't want to stream through this pc"); History says so in one line.
- A file goes to an adapter once per event: the key below the adapter's directory is the file's path relative to the output root, so a second event for the same file is "already there" and is skipped (same size).
- A disabled adapter, or one with a problem (no bucket, region or keys), is skipped with a warning naming what is missing.
- The MCP can read and set the events (`storage_adapters`), as for the switch; keys stay a person's act in the window (ADR-050, ADR-063).

## Why

ADR-063 made "an S3-compatible bucket" one shape and publishing a loop over every enabled one. That loop is one fixed moment. Lucas wants different buckets for different moments: a working bucket gets every render, the delivery bucket gets only what was approved. A list of events on the adapter keeps one shape, adds no new object, and is a setting a person changes without code.

## Every S3 card has the same five switches, and a title

Lucas, 2026-11-27: "wasabi has these flags ... but the other mechanisms (s3 should have these toggles too)"; "why are there two panama buckets listed? they should just be s3 buckets, with option to change title for these cards. allow for naming of the storage adapters"; "sorting storage adapters using drag and drop handle".

- The Upload On row (Generating, Generated, Approved, Publishing, Published) is on **every** card: the publish destination, the Panama exchange bucket, Wasabi and the ones you add. One shape, one place.
- Two switches on the publish destination are not free choices. **Publishing** is always on (a publish goes there by definition) and is shown locked. **Approved** is Auto-publish (ADR-050): it asks for a name and a tick, starts in a dry run, and keeps the cancel window and daily cap. The other three are ordinary events.
- Every storage has a **title** a person can change, the built-ins too (`flags[id].name` for the publish destination and Panama; the record's `name` for the rest). An empty title puts the default back. The id never changes.
- The cards have a **drag handle**; the order is saved (`order` in `storage-adapters.json`) and applies on every launch. A storage not in the list goes last.
- "Two Panama buckets" is one bucket in two roles: the publish destination (where returns are written) and the exchange (where rounds are pulled from). They are still two records because they hold different keys and settings (Publishing's and Panama's). Merging them into one card with a role per switch is possible and is **not decided**; until then the titles tell them apart.

## Volume sync on change (to be built, not decided in detail)

Lucas, 2026-11-27: "a storage adapter should have a setting to push or pull from another volume on change."

- Each storage adapter gets an optional **volume sync** setting: a RunPod volume, a direction (**push** the volume's changes to the storage, **pull** the storage's changes to the volume) and "on change" as the trigger. It sits beside the events on the card, off by default, with the same safety as the other settings (a named yes to turn it on, a dry run first).
- It is the storage-side counterpart of Auto sync (which keeps a pod volume and this PC level): same change detection (the volume's journal), same rules (never deletes, same-size skip, weights excluded unless the person allows them), the pod does the copying so nothing passes through this PC.
- Open: what "change" means for a pull (polling the bucket on a timer, since S3 has no push to the app, or a webhook for storages that offer one); which volume when several exist (named per adapter); conflict rule when both sides changed (proposal: the newer file wins and the other is kept, never overwritten); cost of listing a large bucket on a timer. To be settled in ADR-066 together with reading from an adapter (browse, download, sync to this PC), because they are the same machinery.

## Decisions recorded

| Decision | Who and when |
|---|---|
| Events are a per-adapter setting, edited in the Storage tab, never fixed in code | Lucas, 2026-11-27: "this needs to be configurable" |
| Generating = each sequence once its files are available; Generated = the whole job done | Lucas, 2026-11-27: "yes" |
| The upload source is the pod, to the adapter, for long-term storage; nothing is streamed through this PC | Lucas, 2026-11-27: "this is pod to wasabi for long term storage", "i don't want to stream through this pc" |
| Keys never go to the pod: it uploads to short-lived signed links | Claude's choice, same existing mechanism as the publish `pod` transfer (ADR-050); open to change |
| Keys in the bucket are the file's path under the output root, with no per-event folder, so a file sent on two events goes once | Lucas: "do what you want that makes sense"; Claude chose |
| Approved on the Panama destination is Auto-publish with its guards | Claude's proposal, not objected to |
| A file over 5 GB is a warning, not an upload, until multipart is built | Claude's proposal; sizes seen are far below it |
| bincvfx (Wasabi) listens to Generated | Claude set it, per Lucas's "when a shot is generated we want to upload to bincvfx" |
| Which pod uploads when several are running: the pod that rendered the job; for Approved any running pod on the same volume | **Open**: proposed, not answered |

## Proven on a real pod (2026-11-28)

A 25-frame 4K DPX sequence (`ENHANCE-146_B ... review_v003`, on the volume) was rendered as a 960-wide H.264 proxy on a pod (RTX PRO 4000, `pull: false`, so nothing came to this PC). The Wasabi storage `bincvfx` (ap-southeast-1) listens to **Generated**. When the job ended the pod put the file to a signed link: `.proxies/retime_review_v003/enhance-146_b/dpx/<clip>_960.mp4`, 285,020 bytes, the size of the render. History shows `1 file(s) on the pod and 0 on this PC to send` and `1 sent, 0 already there`. Checked from this PC with `aws s3 ls` against the bucket.

Found on the way: two earlier runs uploaded nothing because they ran in a **stale MCP server process** (`mcp/server.mjs`, started days earlier, which loads the core once), not the app. A render started through the app's own MCP endpoint ran the new code. After the app is updated, reconnect the Claude Code MCP (`/mcp`) or the tools keep running the old core. The event hooks now also write a History line when they fail, never silently.

Requests recorded the same day, not built: transfers between buckets and storages must appear in the Queue (the upload is a background step of the render today, with History lines only); storages appear in the Network Volumes modal with Explore; the Panama exchange Explore is icon-only.

## Erase and Delete of a storage (2026-11-28)

Lucas: "bincvfx this should be erasable and deletable but not if it's default bucket" / "default bucket is erasable but NOT deletable" / "no just unlink it from our system. erase though is allowed".

- **Delete** unlinks the storage from this app (its record and keys); it never touches the bucket in Wasabi. The default storage cannot be deleted (the core refuses; make another storage the default first). A built-in Wasabi that is deleted returns to its empty, off state.
- **Erase** deletes every object under the storage's directory in the bucket. Irreversible, so: counts first, the bucket name typed to confirm, a Queue job with Cancel. Allowed for any storage, the default included.
- Built: the core refuses Delete of the default. Not built: the Erase job and the two buttons in Network Volumes.

## Not done here

- Per-pod or per-shot overrides (the events are app-wide, in Default Configuration, like the switches).
- Streaming volume-only files on an event: refused by Lucas, not planned.
- A second required destination (all-or-nothing) or retries beyond the one the adapter already makes.
- Slack on an event (publishing keeps Slack).

## Next: reading from an adapter

Lucas (2026-11-27): "we want to be able to stream from the wasabi bucket or download or otherwise sync these to our local". Events only send. Reading back needs its own decision: browse an adapter's bucket, Download to a folder on this PC, and Sync (copy what is new, never delete) with the same same-size rule. Playing a file without downloading would use a time-limited link (`s3presign.ts`). To be written as ADR-066 after Lucas picks what to build first.

## Tests

Done: `storage.test.ts` (events saved and validated, the old default `publishing` kept, an unknown event refused, `forEvent`, weights never sent, a same-size file skipped, a failed copy is a warning). To write: a render-completion test (a fake `aws` sees the generated files for an adapter with `generated` and none for one without), an approve test, and `e2e/storage-adapters.spec.js` (the five switches on a card, saved, kept after reopening).
