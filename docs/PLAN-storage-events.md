# Plan: storage events (ADR-064)

Status: **revised 2026-11-27 after Lucas's correction** ("this is pod to wasabi for long term storage"). The first build uploaded from this PC; the pod route below replaces it. To confirm before it is coded. The decisions are in `ADR-064-storage-events.md`; this is how and in what order.

## What you get
On each storage card in Default Configuration > Storage, five switches: **Generating, Generated, Approved, Publishing, Published**. Each adapter uploads files only on the events you tick. Your two cases are then settings:
- `bincvfx` (Wasabi): tick **Generated**.
- Panama publish destination: tick **Approved**.

## Where each event fires (what exists today)

| Event | Hook | Files | Status of the hook |
|---|---|---|---|
| Generating | `renders.ts`, after a sequence is pulled (next to `publishSeq`) | that sequence's files on this PC | new call |
| Generated | `renders.ts`, where the job turns `done` (next to `autopublish.considerSoon`) | all files the job pulled | new call |
| Approved | `autopublish.ts` `approve()` | that version's review files | new call |
| Publishing | `publish.ts` `uploadGroup` mirror loop | each file as it goes | exists (ADR-063); now filtered by event |
| Published | `publish.ts`, when the job ends done | files sent from this PC | new call |

**Approved on the Panama destination** is not a new upload path. It is the existing Auto-publish (ADR-050), with its standing approval, dry run, cancel window and daily cap. The Approved switch on that card is the same setting as Auto-publish's, shown where the destination is. Approving a version never bypasses those guards.

## Steps

1. **Core, `storage.ts`**: an `events` list on each adapter record (validated, five names); `forEvent(event)` returns the enabled, complete adapters that listen; `uploadOn(event, files)` copies each file (weights skipped), returns warnings and writes a History line; `mirrors()` becomes `forEvent('publishing')`. Existing records with no list are read as `['publishing']`, so nothing changes on upgrade. The publish destination's events are kept in the file's `flags`. (A first version of this edit exists as a diff in the scratchpad; I reverted it so the tree is clean until you confirm.)
2. **Hooks**: the new calls in `renders.ts`, `autopublish.ts`, `publish.ts` from the table. Each is best effort: a failure is a warning, never a failed render, approval or publish.
3. **IPC and MCP**: `storage.save` takes `events`; the MCP `storage_adapters` tool reads and sets them (keys stay a person's act). `mcp/parity.mjs` and the APP list in `server.test.mjs` updated.
4. **UI, `StorageAdapters.vue`**: five switches on each card, with one line under each saying when it fires. Saved by the window's one Save. The publish card's Approved switch drives Auto-publish. i18n keys in `en.json`; button labels stay Title Case.
5. **Your settings**: set bincvfx to Generated, Panama to Approved, after you confirm the choices below.
6. **Docs**: ADR-064 status to built, CHANGELOG entry, `README` documentation list if it lists ADRs.

## Tests
- `libs/core/tests/storage.test.ts`: events saved and validated; unknown event refused; old records read as `publishing`; `forEvent` returns only listeners; weights never uploaded.
- Render completion with a fake `aws`: an adapter with Generated gets the files, one without gets none.
- Approve: Approved adapters get the version's files; Auto-publish guards still hold.
- `e2e/storage-adapters.spec.js`: five switches on a card, saved, kept after reopening.
- Then the full gate, with the app stopped, and a release patch if you want one.

## Decisions I need from you
1. **Generating vs Generated. Confirmed by Lucas, 2026-11-27.** Generating = each sequence the moment its files are on this PC; Generated = once the whole job is done.
2. **Key layout in the bucket. Decided, Lucas: "do what you want that makes sense"; the proposal stands (no per-event folder, so a file sent on two events is the same key and is skipped the second time).** I propose the file's path under the output root, below the adapter's directory, the same as publishing. For Generated that puts renders under their shot and version folders. OK, or should each event get its own folder (`generated/`, `approved/`)?
3. **Volume-only files. Decided, Lucas: not streamed through this PC; skipped with a History line.** A render that stays on the pod (Sync off) has no copy on this PC. The first version skips those with one warning. Do you want them streamed through this PC instead? That is more work and costs download time.
4. **Panama Approved.** Confirm that "publish to the Panama bucket on approval" means the existing Auto-publish, with its dry run and cancel window kept. If you want an approval to publish at once with no guards, that is a bigger change and I would write it as a separate ADR.
5. **Wasabi default.** Your saved Wasabi adapter is on with `publishing`. Should I switch it to Generated only, or keep Publishing too?

## Taken as decided
Decisions 3 to 5 were not answered separately; Lucas delegated ("do what you want that makes sense"), so the proposals above stand: volume-only files skipped with one warning, Approved on Panama is the existing Auto-publish with its guards, Wasabi set to Generated only.

## Risks
- Generated can upload a lot (a render is large). The Wasabi copy runs after the job's own pull, so it does not slow the render, but it uses this PC's upload bandwidth. A running upload is cancelled with its job.
- A mistyped Wasabi region fails every event quietly as warnings. The card's Test button is the check before ticking events.
- A file sent on two events (Generated, then Published) is uploaded twice unless the same-size check skips it. I plan to skip a key that is already there with the same size.

## Revision: pod to storage
See ADR-064, "Correction: the pod is the source". Work to do: (1) a `podUpload(adapter, podId, paths)` in `publish.ts`/`storage.ts` that signs a PUT per file and runs `putScript` over ssh (the code exists for publishing); (2) the render and approve hooks hand it the pod paths instead of local files; (3) a retry queue for "no pod running"; (4) tests with a fake ssh and a fake presign; (5) a real run against `bincvfx` with one small file, then one render. Open: which pod runs it when several are up (the one that rendered the job; for Approved, any pod on the same volume), and whether the volume-only path is the same `output/` key layout as on this PC (I expect yes).
