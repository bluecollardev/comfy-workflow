# Next steps and goals

## Goals, in order

1. **Run Binc's graphs where the compute is**, the same way everywhere: binc-PC
   first, the Mac for stereo, a Linux box under Docker, RunPod as overflow
   (`README.md`, "What this repo is for"; `docs/ADR-004`). Measure: a corrosion
   graph renders unchanged on each of those.
2. **RunPod as a disposable worker, never a bill nobody planned**: one app per
   PC, our image, a network volume with the three folders, the cheapest card
   in stock, idle stop, recreate instead of wait. Proven on 2026-10-19 with the
   stock image; the remaining steps are below.
3. **The crew of skills**, Binc's goal: a dispatcher over `queue/<project>/`
   that runs one job per session as the operator brief says, reports, and
   stops. Not started.
4. **One codebase, no second runtime**: the Python API retired, the core in
   TypeScript, the merge gate green (`docs/ADR-005`).

## Open from 2026-11-20 (CANALV2: the DPX backfill of published reviews, the 12 proxies; see also the delivery section below)

Plans: `docs/CANALV2-DPX-BACKFILL-PLAN.md` (frames of reviews already published), `docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md` (what to import and produce for the 20 Nov PDF).

1. **DPX backfill of the published reviews** (24 clips, about 151 GB, S3 only, into the round of each review, through the pod: about 11-13 MB/s). Needs the app (v1.6.6+) **running** and the pod `eagffo99jjrf1n` running. Resume with `python3 scripts/backfill-dpx/batch.py` (`--group A|B|C`, `--only archival-080`); it is safe to re-run (files already there are skipped). Pause between clips by creating `scripts/backfill-dpx/STOP`. Done at the time of writing:
   - [x] archival-077_a_mono_v015 (80 f, 4.0 GB, _TEST_2026-11-19)
   - [x] archival-077_b_mono_v015 (69 f, 3.4 GB, _TEST_2026-11-19)
   - [x] archival-080_b_mono_v015 (60 f, 3.2 GB, _TEST_2026-11-19)
   - [x] archival-080_e_mono_v015 (44 f, 2.3 GB, _TEST_2026-11-19)
   - [x] archival-084_main_mono_v015 (39 f, 1.6 GB, _TEST_2026-11-19)
   - [x] archival-093_b_mono_v015 (126 f, 5.3 GB, _TEST_2026-11-19)
   - [x] archival-104_b_mono_v015 (130 f, 6.5 GB, _TEST_2026-11-19)
   - [x] archival-123_c_mono_v015 (66 f, 3.3 GB, _TEST_2026-11-19)
   Still to send:
   - [ ] A: archival-080_a_mono_v015 (94 f, 5.0 GB, _TEST_2026-11-19)
   - [ ] A: archival-080_c_mono_v015 (90 f, 4.8 GB, _TEST_2026-11-19)
   - [ ] A: archival-080_d_mono_v015 (83 f, 4.4 GB, _TEST_2026-11-19)
   - [ ] A: archival-080_a_mono_v017 (94 f, 5.0 GB, _TEST_2026-11-20)
   - [ ] B: archival-101_a_mono_v015 (89 f, 3.7 GB, _TEST_2026-11-19)
   - [ ] B: archival-103_main_mono_v015 (96 f, 4.8 GB, _TEST_2026-11-19)
   - [ ] B: archival-123_a_mono_v015 (68 f, 3.4 GB, _TEST_2026-11-19)
   - [ ] C: CGI-042B_SINGLE-SPEED-25S_ALT_V01_1982X1046_23.976_PRORES422HQ_mono_v016 (299 f, 15.9 GB, _TEST_2026-11-19)
   - [ ] C: CREATURE-266_LANDING_FINAL_V03_1920X1080_23.976_PRORES422HQ_mono_v016 (51 f, 2.5 GB, _TEST_2026-11-19)
   - [ ] C: ENHANCE-146_B_FINAL_V01_3840X2160_23.976_PRORES422HQ_review_v003_rec0118-0142 (25 f, 1.2 GB, _TEST_2026-11-19)
   - [ ] C: MAP-066_ASSEMBLY_FINAL_V01_1920X1080_23.976_PRORES422HQ_mono_v016 (537 f, 26.7 GB, _TEST_2026-11-19)
   - [ ] C: PHOTOREAL-013_CHASMFAST07_FINAL_V01_1920X1080_24_HEVC_mono_v016 (101 f, 5.0 GB, _TEST_2026-11-19)
   - [ ] C: PHOTOREAL-013_FLOORTRACK_FINAL_V01_1926X1076_24_HEVC_mono_v016 (167 f, 8.4 GB, _TEST_2026-11-19)
   - [ ] C: PHOTOREAL-187_MAIN_FINAL_V03_1920X1080_23.976_PRORES422HQ_mono_v016 (176 f, 8.8 GB, _TEST_2026-11-19)
   - [ ] C: CGI-090_SHOT1_FINAL_V03_1920X1080_23.976_PRORES422HQ_mono_v016 (345 f, 17.2 GB, _TEST_2026-11-20)
   - [ ] C: photoreal-013_chasmfastia2_mono_v015 (95 f, 4.7 GB, _TEST_2026-11-20)
   Non-V11 shots (cgi-042B, map-066, enhance-146, ...) may be held by the EDL check ("not in the EDL"); do not override. Afterwards: list each shot folder in S3 and check the DPX count equals the frames above; **stop the pod** (it bills while it runs).
2. **The 12 H.264 proxies** for batch 03 elements with DPX on the volume but no .mp4 (071, 077 c, 080 a-e, 083, 085, 093 b, 102, cgi-042 main): planned and clean, **blocked on a colour statement** (`linear-p3-d65` as before, or `p3-d65-gamma26` as the PDF says). Lucas or Binc to state it.
3. **The 19 missing DPX elements** (batches 01 and 02): **superseded by the delivery section below and plan sections 10 and 11** (the rounds are pulled; Run Workflows does not make DPX). Original plan: import `brynley-comfy-2026-11-14` (whole, 13.9 GB) and the `archival-168` and `cgi-072` shots of `brynley-comfy-2026-10-29`; `archival-123` f is already staged (`-10-23`). Then produce them with the mono graph. **Ask Binc:** where the CGI-072 V02 ProRes finals are (the round has v03 HEVC 24 fps; the PDF says V02 ProRes 23.976), and which graph/version (v015 as for the 17, or v018).
4. **Publish to the real round** with V11 clip names after Binc confirms the names (the backfill goes to the `_TEST_` rounds first).
5. **Binc's beach ball:** ask for an Activity Monitor sample taken during a lock-up (RunPod Manager > Sample Process), and after he updates, `stalls.log` in the config folder (`docs/TROUBLESHOOTING-BEACH-BALL.md`). His note: it locks once a Claude session detaches; the stateless MCP host showed no obvious cause.
6. **Tidy:** remove leftover agent worktrees under `.claude/worktrees/` and merged feature branches after the release.

## Remote Instances (ADR-054, `docs/BRIDGE.md`), started 2026-11-19 on `feature/status-bridge`

Built: `libs/core/src/bridge.ts` (whitelisted snapshot, redactor, freshness, parse) with 9 tests. To build, in order:
1. **Publisher and reader** over the exchange bucket (`bridge/<name>/status.json`, `events.jsonl`; 30 s timer; refuses when another machine's newer file holds the name). First prove write access to `bridge/` from both machines; the fallback is a bucket Lucas owns.
2. **Settings and IPC/MCP**: instance name, Share my status (off by default), the list of followed instances (name, bucket, prefix); MCP tools `bridge_status` and `bridge_instances` (read-only).
3. **Connect > Remote Instances** tab: add, remove, a card each (live / late / offline, pods, Queue counts, Auto-publish, spend, last events).
4. **Account menu** (the user icon, after the refresh button in `App.vue`): instance name, Share my status, **View** switch (This instance / each remote) swapping the screens to the snapshot, read-only, with a banner and a way back.
5. Browser and real-Electron tests (fake bucket), then a patch release through the full gate.
6. Phase 2 (commands, approved in the target's window) only after Phase 1 is in use, with its own ADR amendment.

## Open from 2026-11-21 (evening): the Tunnel V11 issue register

Full table with status, why it matters and the next step: [`docs/CANALV2-TUNNEL-V11-ISSUES-2026-11-21.md`](docs/CANALV2-TUNNEL-V11-ISSUES-2026-11-21.md). State at 19:57: 35 of 35 targeted elements in the real round (f23 tomorrow); at 18:35 it was 32 of 35 with top, landing and sunlight rendering (ETA 19:06 to 19:23), f23 deferred. Decisions: [ADR-057](docs/ADR-057-parallel-renders-and-uploads-in-the-app.md).

**Needs Lucas or Binc**
- [ ] **Colour statement for the review videos** (Gamma 2.6 P3-D65 against linear P3-D65), then the review videos: 15 delivered elements have none (3 more coming), the 17 first-delivery ones are first pass (24 fps, no start timecode). (issues 1 to 3)
- [ ] **Ask Binc:** the raster (delivered 3840x2160, names say 1920X1080); CGI-072 rendered from the V03 HEVC 24 fps, the PDF says V02 ProRes 23.976. (4, 5)
- [ ] **`ISSUES.json`:** list only the real gaps of the 36, or leave it (10 stale `not-generated` entries, five not among the 36). (6)
- [ ] **f23** (633 frames): **tomorrow, 22 Nov** (Lucas, 18:45: "we will do that tomorrow"; no restart tonight): restart the app, then `run_split` (three ranges on three 2x pods, about 2 hours), `dpx_fix`, parallel pod upload. Mind the 16-GPU limit: stop the finished render pods first. (9)
- [ ] **Spend:** USD 546.31 estimated since 4 Nov (all projects) against Binc's USD 100 cap; agree a figure with Binc. (22)

**Before Auto-publish goes live**
- [ ] Review the pending list and cancel or exclude everything that is not one of the 36 (map-066, chasmfastia2, cgi-072 v001/v002, photoreal-013 v007 to v009, archival-087 v002, the assembly `NOT_RELEASED` runs); only a person can hold or approve in the window. (11)
- [ ] **dpx_fix wired in so Auto-publish never uploads unfixed DPX** (being built: `feature/dpx-fix-in-pipeline`, issue 12 and 19). Until it is live keep `include_dpx` off.
- [ ] Keep Auto-generate and the preview batch off pods that have a render queue. (13)

**After the renders finish (about 19:25)**
- [x] Upload top, landing and sunlight in parallel, verify manifests and `RETURN-MANIFEST.json` = 35: **done 19:50** (plan section 33). Still open: stop landing and sunlight (logs saved; top stopped by the system 19:55); fix 6 + 3 manifest sha256 `n/a` (register 27).
- [x] **App restarted 19:19** onto the merged code (frames badge fix, `Show Incomplete`, re-attach, parallel uploads, `dpx_fix` in Auto-publish, scope `edl`, Rec.709 option, Deliver). The next restart (with f23 tomorrow) loads `manifest_check`/`manifest_rebuild`, Purge Dry Runs and the progress-bar padding.
- [ ] Re-publish backhalf-b's element manifest so it carries the `issues` section (7). Head's and hadal's headers read back from the bucket: **done 19:55** (8).
- [ ] **Run the full gate** (`./start.sh test`) and fix `publish-backfill` ("needs the approver…" times out at 5 s), then release the next patch. About ten merges since v1.7.2 were not gated. (21)

**App and tools (open)**
- [ ] Generate window counters stuck on `checking…` (91 folders, 26 failed previews) and the Auto-publish banner always `scanning volume`. (15)
- [ ] Do not restart the tool server during an upload (the job record is wiped). (20)
- [ ] Tell the other Claude session not to resubmit sunlight on `8eyco022cqbswy`; never start a run on a pod whose queue shows another client; `vlvrtpnig8rkoh` is foreign. (23)
- [ ] Next image build: add SageAttention and Flash Attention for SeedVR2 (likely faster, not measured); the LTXVideo import failure is harmless. (24)

## Open from 2026-11-20 (Tunnel V11 delivery, ADR-055)

- **A retried import task takes its own pod again (fixed 2026-11-21 for a person's Retry; two things are still open).** `queue.retryTask` now remembers the pod (`reuse_pod`) and `begin` takes it again when nobody else holds it and it has the card the task wants (a stopped one is restarted; if its host has no free card a new pod is created and the event says so). Still open: (1) **stopping a pod fails the task attached to it** (the run job dies with the container; the queue marks the task failed): stop a pod only after `queue_list` shows which task owns it; a guard that refuses `stop_pod` on a pod with a running task is not built. (2) A task whose pod was **stopped by RunPod or the idle watch while the task shows running** stays running until the app is restarted or someone retries it (the run job's poll gives up, the queue does not look at the pod). Original text: (seen 2026-11-21: 12 duplicate `queue-base_v008` pods and the account's 16-GPU limit reached; runs then failed with "16 are in use"). Make a retry reuse the task's pod when it is still there, and stop a pod no task points to.

- ~~(superseded 2026-11-21 evening: 31 of 36 are in the real round; see the delivery report)~~ - **Deliver what we have:** the 17 elements. Test round `_TEST_tunnel-v11-2026-11-20` has 3 (084 main, 085 main, 123 c; old headers, no per-element manifest). Next: `dpx_fix` them on a pod, publish the corrected copies to a second test round, read the headers back from the bucket, compare a frame with Binc's corrected CGI-072 files, then the other 14, then the real round `tunnel-v11-edl-2026-11-18`, never overwriting. Plan: `docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md` section 9 (on `feature/dpx-backfill-plan`, not merged).
- ~~(superseded 2026-11-21: the elements were rendered through chunked runs; head, hadal, backhalf-b delivered, backhalf-c upload queued, landing/top/sunlight rendering, f23 deferred)~~ - **16 elements have no DPX** (087 x2, 123 f, 168 x4, creature-266, photoreal-013 x8) and **3 CGI-072** are held (V03 HEVC 24 fps against the PDF's V02 ProRes 23.976): the round's delivery graph makes MP4 candidates, not DPX. Ask Binc which graph or tool makes the mono DPX from the ProRes masters, or build the ffmpeg conversion (colour handling to decide).
- ~~(done: v1.7.2 released through the full gate on 2026-11-21; the merges after it are ungated, run `./start.sh test` before the next release)~~ - **Release the unreleased work** (no-overwrite guard, per-element manifest, `dpx_fix`, pod logs, purge): full gate, then a patch. Auto-publish is live: pick a quiet moment.
- ~~Wait for ComfyUI before the first graph of a fresh pod~~ built 2026-11-21 (unreleased).
- **Decide with Binc:** the DPX colour code (user-defined as in the PDF?), the round-level `RETURN-MANIFEST.json` next to the per-element ones, Rec.709 convert or tag for the proxy, the proxy timecode.
- ~~(that pod was deleted after its log was saved; stop our render pods when the renders end, logs first)~~ - **Stop the pod `eagffo99jjrf1n`** when the delivery is done (resumed for the DPX copies); pods are stopped, never deleted.
- ~~(pushed up to v1.7.2; the merges after the release are not pushed)~~ - Push `develop` and the tags from v1.7.0 on.

## Open from 2026-11-19 (v1.7.0, released with the gate skipped)

0. **Verify one live upload end to end.** Auto-publish was in dry run when v1.7.0 was cut. Switch Dry run off (the person's confirmation) with the round `_TEST_{date}` and watch one review through the cancel window to S3 (`returns/BKK/_TEST_<date>/`, with `RETURN-MANIFEST.json` and the sha256 list) and the Slack post; ask Kyle to delete the `_TEST_` folder; only then set the round back to `tunnel-v11_{date}_r01`. Until that has happened, treat the S3 write path, the manifest merge, the streaming from the volume and the Slack message as tested with fakes only. Our key cannot delete from the bucket.
1. **Run the gate that was skipped:** `./start.sh test` (core, MCP, IPC, unit, the full browser suite, the real-Electron suite) on the v1.7.0 tree, then fix what it finds. The last complete browser run (771) predates the nav badge, the dry-run view, the tab counts and the Generations play button; the real-Electron suite has not run on any of this.
2. **Auto-generate cannot start a pod yet.** Not built: `auto_publish.generate.start_pod` (use a running pod attached to the volume, else resume a stopped one, else create the cheapest card; never another volume), `stop_when_done` (stop, never delete, a pod the feature started, after 10 idle minutes), and `max_spend_usd_per_day` (default 25, next to Binc's USD 100 cap); turning it on needs the approver's name and an import must never turn it on (ADR-050). Today it renders only on a pod that is already running; with none running it waits. Both running pods had idle stop 0 (never) on 19 Nov.
3. **`auto_publish.require_review` and `max_gb_per_day`** (publish finished sequences without a review video: the DPX frames and the Tunnel proxy) are not built (ADR-050, "The review video is optional").
4. **Config export, import, backup and undo of the publishing settings write `publish.json` directly** because `applyImport` is synchronous and `publish.setSettings` is async; make them use the setter so validation and History apply. Export and import carry the non-secret settings and the `needs` list (secrets are never exported).
5. **Cross-process job visibility is half done.** Running render and publish jobs are shared (`jobs-running.json`, heartbeat, Cancel from the app); volume jobs, syncs, model fetches, imports and the other MCP handlers (`trigger: 'mcp'`) are not wired. A job started over the stdio MCP server or a script is otherwise invisible to the app until it ends.
6. **The Queue's loose ends:** the Failed and Held Auto-publish lists are not row lists yet; the Working and Finished tables exist on Overview only (the other tabs keep their own lists); the `ModelsModal` template reads an undefined `stop` (a Vue warning on every load); the Save button's check mark was dropped because the window closes on save.
7. **Graph failures over MCP and a failures log** (being built when this was written; check `docs/` and the History): every graph that fails to load or render is recorded with the shot, graph version, node id and type, the error text, the pod and the recovery action, and `get_comfy_runs`, `get_comfy_logs` and the run tools return those details to an agent. Binc's agents must not wait on a failed graph: a failure is a logged report, then the next job.
8. **`auto_sync` reads as off after the configuration reset** (a partial `mounts.put` from a script reset parts of the Default Configuration; Auto-publish, the MCP servers, the folders, the volume, the datacenter and the registry login were restored from session records, the image environment list is empty until the image is picked again). Check Auto sync, the import cost cap (50 now) and the default card against what Lucas had. Never save the configuration with a partial object again (use the setters).
9. **Binc's side.** A Linux (and Windows) build for Binc is still undecided (item "A Linux build" below); `docs/FOR-BINC-AGENTS.md` still says v1.2.8; his agent runs "Pod Manager 1.5.3", which has none of publishing, Slack, the colour setting, Auto-publish or the EDL checks. The exchange bucket shows nothing new in `returns/` since 13 Nov and nothing new in `rounds/` since 17 Nov (checked 19 Nov); a fresh sync of binc-PC (tracker, queue folders, process list, installed Manager version) is needed to see why. The revised delivery prompt is `docs/prompts/binc-delivery-controller-prompt-v2.md` (the original is kept in the same folder).
10. **Operations, not code:** only cgi-090 shot 2 waits on Jon; carter-reframe is v02 for both takes (Tunnel relinks take 2 from v01); Tunnel cannot pull from S3, so Brynley pushes to Signiant after final QC and the Tunnel target stays disabled; archival-102 main-B is not in V11 and is never delivered; creature-266 breach-alt1's source is 1280x720, flag if the 4K from it is not usable.

## Open from 2026-11-19 (ADR-053)

0. **Measure the main thread** with the real app and volume (a backfill scan of `output/`, a reconcile of a large listing, a 20,000-path publish plan, a preview batch and the viewer cache run): the longest stall of each. Then decide (ADR-053): a Web Worker for the DPX decode (cheap, clearly useful), worker threads for the scans that showed up, and the core in a `utilityProcess` only if the numbers or incidents say so.

## Open from 2026-11-19 (ADR-051 section 9)

0. **Events for the Queue's jobs:** the Queue tabs, the Working table, the counts and the nav badge are built (v1.6.0 and v1.7.0). What is left is to emit each job's start, finish, failure and cancel as events (ADR-051), and to put one `jobs.list()` behind the tabs instead of each tab's own store.

## Open from 2026-11-19 (ADR-052)

0. **Bug: `volume_erase` over S3 counts deletions that did not happen.** The job reported 44,000 files deleted while `output/` still held all 23,338. Find out whether the counter lies or the delete does not take effect; fix and add a before-and-after count of the target to the job's result. (Direct `aws s3 rm` per folder worked.)
1. **The pull guard for Binc's mirror:** skip a pull's shot steps (`06_REVIEW`, `07_DELIVER`) when the project folder is inside `projects/desktop/`, with a warning (ADR-052 section 3).
2. **A Linux (and Windows) build for Binc:** he is on Linux and gets none of the Mac-only releases; he can build (`./start.sh package linux`); decide whether the release publishes them (ADR-052 section 4).
3. **Import the EDL's clip names, the last step:** the EDL is parsed and cached (`edl.*`), the clip-name picker, the flags and the EDL status block are built (v1.7.0). Still to do: one click that pre-fills every sequence's clip name from the EDL (exact name first, then shot plus element) and lists the open ones (cgi-090 shot 2, carter-reframe: Kyle chose v02 for both takes on 14 Nov; two `main` elements make it ambiguous; archival-077 a/b/c) (ADR-052 section 5, ADR-050).
4. **Events and notifications (ADR-051):** phase 1 once Lucas answers the open decisions.

## Open from 2026-11-18 (v1.5.2, released untested)

0. **Run the tests the v1.5.2 beach-ball fix shipped without** and fix what they find: `libs/core/tests/symlinks.test.ts` ("listDirs is async, bounded and capped": its first run had 3 test mistakes patched by hand and never re-run), `electron/core.test.mjs` ("mounts.dirs is async and takes a filter"), `mcp/server.test.mjs` ("list_dirs takes a filter and returns total"), `e2e/folder-picker-big.spec.js` (4 tests; fake API `fsTruncated`, `fsTimeout`, `fsDelay` untried). Then the full gate. Also decide the 400 ms budget of `declared()` (it can truncate tree hints on a slow volume) and convert the remaining sync calls on the folder-selection path (`mounts.ts` config read/write, `existsSync`).

## Open from 2026-11-18 (Render sequences, ADR-048)

0. The Render sequences UI (Previews window option, tile badges, the viewer's Proxy | Review player, the configuration section) is built and tested with fakes (`e2e/render-sequences.spec.js`, `e2e/render-config.spec.js`); not yet tried in the real app against the real core: restart first, then render one sequence on the pod and one on this PC and play both. Check that a `<video>` plays a `localfile://` `local_url` in Electron (the protocol is registered in `electron/main.cjs`).
1. Sequences named `NAME_0001.dpx` or `NAME-0001.dpx` (not `NAME.0001.dpx`) are not offered for rendering (the core reads `NAME.%0Nd.dpx`); the window says how many it skipped.

## Open from 2026-11-17 (v1.3.1 follow-up)

0. **A test that the page and the core agree:** every `core.invoke('<ns>', '<method>')` in `src/api/` must be a key of the core's call table in `electron/core.cjs`. v1.3.1 fixed three missing `library` calls that the browser tests (fake API) and the IPC parity test (it checks the table against the MCP map, not the page against the table) could not see. A static test over both files would have caught it. Not yet written; v1.3.1 was released without running the tests, at Lucas's request.

## Open from 2026-11-17 (ADR-044, ADR-037 amendment)

1. Run workflows window: the state and the card's **Running** button are built and tested (core `latest`, selection kept per pod, MCP `pod_id`); uncommitted on `feature/volumes-v2-fallback`, app not yet relaunched on it. Written, not yet built or tested (hold until Lucas says build): the split pane with progress, report and log, and `RunJob.log` (ADR-037 amendment, points 2 and 3); needs `core:build`, the tests (add core tests for the log lines and `started_at`, a browser test for the pane), and an app relaunch once no run is in flight (a relaunch drops the app's tracking of a running job). To build: an ETA in the header, and a job that survives an app restart with Reattach (point 4). After the MCP server restarts (`/mcp` reconnect), `run_workflows_job` takes `pod_id`.
2. Rounds from a volume (ADR-044): steps 1 to 4, the three guards (no Replace; locked and `04_GRAPH` shots never run; the estimate against the cap before Start), the preflight and MCP parity are built and tested with fakes (uncommitted). Open: (a) look at the REAL volume once in the window (Source = Volume on `a3upg9ey48`, then Check models on `proxy_v005`) and record what the listing and the preflight say in `docs/runbooks/import-a-round.md`'s Log; (b) the Adapter Studio kind switch (source / round / package) and `adapter_spec` for the round kind (step 5); (c) the scheduler's held-task rule still counts half an hour per shot, not the plan's per-graph estimate; (d) fixing a model the preflight finds missing (a named-yes download or a copy into the right folder) is not built; (e) a segment is a set of shots of one round only, not a sub-folder. Ask Binc: where the locked list lives for the volume's rounds, and whether names of his graphs may go to the Anthropic API from the Studio (with TODO section 5).
3a. Outputs from the volume (ADR-045): built and tested with fakes; the browser's click-through in the real app (restart first, S3 keys set, a stopped pod on the Shared volume, open a DPX sequence and a video) is not yet done. Not built: a delete (never), a listing that stops early at the 3000 cap (aws still pages the whole subtree), thumbnails for volume images (they load full size), Open in a tab for an s3file file.
3. The 1.0 x2 spatial upscaler (ADR-043, Open): a commit or tag with the file, or a checksum run from a pod (named yes). The audio VAE fix is done (`archival-080__a` ran to success on the A100 pod after it).

## Open from 2026-11-15 (ADR-042)

1. Merge `feature/pin-image-digest` (the image pinned by digest, cu13 pair, workflow tags), release it, and send Binc the digest `sha256:a06a461c…` and what the 14 Nov rebuild changed.
2. Wire `.claude/hooks/guard-bash.sh` into `.claude/settings.json` (Bash matcher, a `permissions` block) and ship it to binc-pc through `shared/governance/`; get one real example of what Binc's agent bypassed.
3. Get the exact "unauthorized" text from binc-pc; test the registry login with one short pod (needs a named yes).
4. Shared (ADR-042 section 9): core is built (Hugging Face search, the `fetch` job, `shared_volume_id`, Shared volumes cannot be deleted); to build: the Shared button with its two windows (Volumes, Models), the Shared badge in the Volumes list, the MCP tools `models_search` / `models_files` / `models_fetch` / `set_shared_volume`, tests; then load the four SeedVR2 files through it (approved by Lucas). Built before: the per-pod VAE / diffusion model choice (`pod_models`, ADR-042 section 6). Not built: its picker in the Run workflows window. SeedVR2: all variants go on the volume (section 7); create RunPod S3 keys (console, Settings, S3 API Keys), enter them in Default Configuration, check free space, then upload with a manifest. Before: choose the size (3B or 7B, fp16 or fp8) and the VAE files, then put them on the volumes with a manifest (S3 API for EU-RO-1 if RunPod S3 keys are created, a short pod otherwise; EUR-IS-2 by pod or Clone). Weights stay out of the image.
6. Default card (ADR-042 section 13): built and tested; after the app restarts set it (the code default is `rtxpro6000`; the stored configuration has no value until saved, so it reads the default). Pin the CUDA 13 digest of the 15 Nov image build in `gpus.CU13_PINS` and the default image, or the RTX PRO 6000 boots the older CUDA 13 image without the OCIO, LTX and Binc DPX packs.
7. Hugging Face token (ADR-042 section 14): built and tested with fake answers; enter a real token in Default Configuration, accept the terms of `black-forest-labs/FLUX.2-klein-9b-fp8` and the gated LTX repos with the same account, and load one gated file to prove it.
11. RunPod's request limit (ADR-042 section 18): built and tested with fake 429s; watch a real one (the banner, then `rate_limit_status` after the wait), and measure the requests a minute on the wire (the 15 to 20 is read from the code). The agent pollers in this session were part of the load: poll `volume_job` and `list_pods` no faster than the app's own answers change.
10. A download survives dropped connections (ADR-042 section 17): built and tested with a fake detached pod; try it once on a real pod (start a Load Missing, cut the connection for a minute, watch Reconnecting, then confirm the files finish; then let the pod stay unreachable for ten minutes to see Interrupted and Reattach). `setsid`, `stat -c` and `/dev/shm` exist only on the pod's Linux.
9. Download progress and volume jobs (ADR-042 section 16): built and tested with fake pod output; watch the first real Load Missing: the bar, the Downloading badge, the Queue section; delete the `ComfyUI-Pull-vol-...` pods listed as Interrupted (No Job) after a restart.
5. Wanted models (ADR-042 section 12): built and tested with fake S3 and fake jobs; try it on a real Shared volume (Save list from the volume, Add Binc's list, Load missing) after growing the volume. Gated LTX files still need a Hugging Face token setting.
8. Delete models on a volume (ADR-042 section 15): built and tested with a fake `aws`, a fake pod and a fake API; try it once on the real Shared volume (one small test file: S3 route, then check `comfy-shared/models/` and the History entry).

## Important, open: AI-generated shots through MCP (ADR-034), cgi-042 first

As of 2026-11-05. The requirement is `docs/ADR-034-shots-are-generated-by-ai-through-mcp.md`; the script and the Log are `docs/runbooks/shot-stereo-conversion.md`. Proven so far: the latest approved cgi-042 final found and hash-checked (`fe53cada…4630`, round `brynley-comfy-2026-10-22`), an H100 pod on `comfy-h100-apin1`, the round pulled and verified, its inputs and graphs placed (156 files hard-linked, ADR-033), the ComfyUI bridge pointed at the pod with the Binc/Stereo nodes present. **Not done: any stereo has been generated.**

To do, in order:
0. **Done 2026-11-05 (later):** the first full cgi-042 stereo pass: 241 frames, 8-bit PNG eyes, budgets met, 29 minutes, USD 1.90, output on Lucas's Desktop and in `ComfyUI-Shared/output/cgi-042-stereo-v01` (details in `RUN-DETAILS.md` and the runbook Log); pod stopped. Remaining: Lucas's review of it, then the 16-bit TIFF eyes and manifest (item 3-5 below).
0. **Done 2026-11-05:** a 5-frame stereo test ran through the bridge (Depth Anything V2 Large fetched by the pod, node-default parallax); the existing graph `cgi-042-binc-stereo-v01` now loads the placed video. Still to judge: the pictures and the report, then the full 241 frames.
1. **Decide with Lucas** (blocking, assumed meanwhile: regenerate depth with DA2 Large, the node-default parallax 1.0 / 0.25 %, convergence 0.35): the depth source (reuse his 241-frame `06-stereo/v03-depth-current` on the Mac, or regenerate with Depth Anything V2: weights on the pod unchecked); the parallax budget and screen plane (near, far, convergence); a go-ahead for a 5-frame test (about USD 0.06 at 3.99/h).
2. **Build the stereo production graph** from `shared/nodes/portable/ComfyUI-BincStereo/workflows/binc-stereo-sequence-chain.json` (BH has none; their graph in the round is the history graph and is not rewired). Test on 5 frames through the bridge, check the parallax and hole report, then the full 241 frames.
3. **A 16-bit TIFF eye output** (BH's spec; BH makes the DPX and the review file themselves, we do not produce DPX), untagged, the final's raster, one file per frame, left and right (BH's return spec). `SaveImage` writes 8-bit PNG, so this needs a node or tool, tested.
4. **Bring the output home and say where it is**: a pull of an arbitrary output folder plus a manifest (sha256 + bytes); Lucas asks for the output and gets files, a short report and the pod stopped.
5. **Return to BH** (`returns/brynley-comfy-2026-10-22/cgi-042/`, manifest `bh-return-1`): a `panama_return` tool behind Lucas's named yes. Nothing is uploaded without it.
6. **Close the MCP gaps** in ADR-034's table: `panama_read` (one small bucket file), a compact `panama_job` progress view, and the stale-tools problem (the stdio server needs a `/mcp` reconnect after a new tool).
7. **Keep every runbook in `docs/runbooks/` current** as each step is run; a step counts as done only when its Log shows it ran.
8. Pod `cgi-042` (`3h25wd2p4es40i`) is **stopped** (2026-11-05); resume may need `recreate_pod` if the host is full. Stop it whenever work pauses; the idle watch only runs while the app is open.
9. Small MCP gaps seen in the run: the bridge returns no text outputs (`PreviewAny` report), `sync` push of `output` is broader than asked and cannot be cancelled.
10. Outputs viewer follow-ups: the DPX viewer and video controls are built and tested in the browser suite; look at them once in the app window (podfile:// sends no Content-Length, so the frame loading line shows MB, not a percentage). ProRes and some HEVC .mov fall back to Download/DJV; a pod-side transcode to a browser codec is not done.

## Next steps: importing the CANALV2 graphs

Open work only, as of the evening of 2026-10-19. Done items are in
[`CHANGELOG.md`](./CHANGELOG.md). The inventory behind this is in
[`projects/README.md`](./projects/README.md), section "Where the ComfyUI prompts
and graphs are".

**Where things stand:** the stereo workflows run on this Mac on MPS. The
corrosion graphs do not, because the plates are not on this machine; the packs
are linked and the paths are mapped. Blender is the solve step before a graph,
not a requirement to run one. Decision record:
`docs/ADR-004-where-the-workflows-run.md`.

## The main thing to solve next: run the graphs from any machine

The GPU is the easy part. In order:

- [ ] **Plates on this Mac.** The three folders are mapped in the dashboard's Configuration panel and every runtime follows the mapping (`docs/MOUNT-POINTS.md`); what is missing is the plates folder itself, over SMB from binc-PC or the NAS (Binc's note has a Mac Studio on SMB already). Until then the Mac can open the corrosion graphs but not render them.
- [ ] **A ComfyUI-Shared of our own on this Mac.** The saved mapping still points ComfyUI-Shared at the mirror; in dev mode the launcher substitutes `~/ComfyUI-Shared` (it did on 2026-10-19 and ComfyUI ran). Map that folder in the panel so the substitution is not needed.
- [ ] **binc-PC as the first container node.** Build `comfy-app:v26` on a Linux box (`apps/comfy-app/build.sh`; the Mac would emulate amd64), then `apps/comfy-app/docker/swarm.sh up` for one box or `init` + `deploy` for a Swarm. The Mac's browser then uses `http://binc-pc:8188` like the local one.
- [ ] **Drive it from the Mac.** `comfy` CLI and the queue scripts take `--comfy <url>`; the stereo work stays local on MPS.
- [ ] **RunPod as overflow.** The tooling is ready; the steps left are in "RunPod: what is left" below.
- [ ] **Binc's goal, the skill crew.** Not started; a design, not code, is the next step. Separate from ADR-002's GPU pool. See `README.md`, "Goal".
  - [ ] First piece: a dispatcher over `queue/<project>/`. Watch `in/`, claim a job by moving it to `running/`, start a Claude Code session with the brief as its first message, collect `REPORT.md`, move to `done/`. The folders stay the interface, so the manual and automated paths are the same.
  - [ ] **Abstract shapes and concrete shapes** (Lucas, 2026-10-19). `shared/shapes/` today is CANALV2's shapes verbatim. Split them: abstract shapes any restoration project has (a project tree, a shot folder, a job, a report, a graph with ordered boxes, naming rules) and concrete bindings per project (CANALV2's `10_CORROSION`, `BH26_` nodes, `/home/binc/...` root, its state words). The dispatcher and the checker then run against the abstract shape plus a binding.
  - [ ] What `check.py` found on 2026-10-19, to raise with Binc rather than fix: `corrosion-111` and `corrosion-159` have no `05_TEMPS/` or `07_DELIVER/`; the 17 real job files carry `job`, `shot`, `tool`, `machine`, `root` and STEP blocks but not the brief's `inputs`, `params`, `output` fields. Either the brief's template or the files should move.

## What there is to import

ComfyUI calls a submitted graph a "prompt". The project has no text prompts;
it has 393 shot graphs plus a few saved workflows.

| Source | Count | Format |
|---|---|---|
| `projects/desktop/CANALV2/10_CORROSION/<shot>/04_GRAPH/<shot>_graph_v###.json` | 260 | UI canvas |
| `projects/desktop/CANALV2/20_STEREO/<shot>/04_GRAPH/` | 6 | UI canvas |
| the `*_api.json` twins beside them | 127 | API |
| `projects/desktop/CANALV2/80_TEST-BUCKET/*/` | 21 | API |
| `projects/desktop/CANALV2/04_TRACKER/queue/in/v20_graphs_2026-10-17/*.zip` | 22 | API |
| `apps/comfy-app/workflows/` | 9 | UI canvas |

The highest `_v###` in each shot's `04_GRAPH/` is the current graph. Only the
current graph per shot needs importing; older versions stay where they are.

## Step 0: the node pack, what is still open

The graphs are built from the `BH_*` nodes in ComfyUI-BH-ShotPipe, and the v26
graphs need `BH26_*` nodes. All versions, v6–v26, plus BincStereo are in the
`shared/nodes` submodule (`bluecollardev/comfy-node-packs`); nothing is read
from Binc's mirror at install time any more. `docs/NODE-PACKS.md` has the
versioning and release steps.

- [ ] Restart the Mac ComfyUI and confirm the nodes show in the UI:
  ```bash
  export COMFY_LOCAL_URL=http://127.0.0.1:8188
  comfy --json nodes search "BH26_ObjectSolve"
  ```
- [ ] Check the pack's own requirements against the venv. `shared/nodes/README.md` lists them; the project's `containers/runpod/requirements-bh.txt` is the full Linux list.

The nine stereo workflows already saved in the install use BincStereo, which is
always linked. They need none of this and open today.

## Route A: load graphs into the ComfyUI Workflows panel

Use the project's own loader. It posts the newest UI graph per shot to
ComfyUI's user-data store under a `CANALV2_corrosion` folder and never queues
anything.

- [ ] The script hardcodes the Linux root. Run it with the Mac path, either by editing `ROOT` in a copy or by passing the root if a later version accepts one:
  `projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_load-graphs_v002.py`, `ROOT = "/home/binc/CANALV2_r3/CANALV2"`
- [ ] Dry run first. `--list` sends nothing:
  ```bash
  python3 projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_load-graphs_v002.py --list --comfy http://127.0.0.1:8188
  ```
- [ ] Then the real load, optionally one shot at a time with `--shots 058,110`, and `--forks` to include review forks.
- [ ] Manual fallback: copy the UI JSONs into `apps/comfy-app/workflows/CANALV2_corrosion/` (served to the UI through the symlink), or drag one onto the canvas.

## Route B: queue graphs for rendering

Only after Route A shows the graphs open cleanly. This renders, which takes
GPU time and writes into each shot's `06_REVIEW/`.

- [ ] Dry run with the list-file form. It checks every graph file exists and sends nothing:
  ```bash
  python3 projects/desktop/CANALV2/02_SCRIPTS/queue-graphs/corrosion_queue-api_v005.py --list-file <list.txt> --dry-run --comfy http://127.0.0.1:8188
  ```
  The list file has one `shot:version` per line, for example `058:v021`.
- [ ] Confirm the Mac can actually read the plates. `02_SOURCE/SOURCES.csv` in each shot points at `/mnt/storage/Panama_Redux/...`, a binc-PC path. Without the plates mounted at the same path, rendering here is not possible and this route belongs on binc-PC or a RunPod pod.
- [ ] Respect the project rules in `projects/desktop/CANALV2/00_POLICY/agent-permissions.md`: open shots only, proxy first, locked shots are never run.

## Route C: bring graphs into this repo's comfy CLI format

For reuse through the `comfy` CLI. Both commands validate against the running
server's node catalog, so Step 0 must be done first.

- [ ] Inspect the addressable widgets of a graph:
  ```bash
  export COMFY_LOCAL_URL=http://127.0.0.1:8188
  comfy --json workflow slots projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json
  ```
- [ ] Capture it as a recipe, the CLI's preferred reusable form. Lift the per-shot fields (plate folder, prefix, frame range) to params with `--param <node>.<widget>=<name>` once `slots` has shown their addresses:
  ```bash
  mkdir -p recipes
  comfy --json workflow capture projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json \
        --name corrosion-058 -o recipes/corrosion-058.recipe.json
  ```
- [ ] Or, for the legacy fragment and blueprint path this repo's `comfy.yaml` was set up for:
  ```bash
  comfy workflow decompose projects/desktop/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json --name corrosion-058
  ```
  That writes `fragments/corrosion-058.json`; a blueprint in `blueprints/` then composes it.
- [ ] Start with one shot. The fourteen corrosion graphs share a pipeline from the same builder, so one good recipe with shot fields as params should cover them. Check that against `projects/desktop/CANALV2/02_SCRIPTS/graph-builder/build_v25_shot_graphs_v001.py` before capturing all fourteen.
- [ ] Do not hand-edit the captured JSON. Edit source and recapture.

## RunPod: what is left

Status 2026-10-20 morning: the image is pushed, the volume exists, the
Configuration panel points at both; no plate has left binc-PC. The tooling for all of it is
in the repo and tested; what remains is a sequence of real steps, each of
which spends or moves client material and so waits on a named yes.

Binc's plan is the reference (`projects/desktop/CANALV2/02_SCRIPTS/containers/runpod/README.md`):
a GPU pod with a network volume for batch rendering, a CPU pod for Blender
solves, serverless ruled out for frame sequences, pods stopped when a job ends.

In order:

1. [x] **RunPod proven** (2026-10-19 evening, USD 35 of credit): `./start.sh e2e-live` created a stock-image pod on the cheapest card in stock, saw it running, stopped and deleted it in 3.6 minutes. Rerun it any time; it leaves nothing behind.
2. [ ] **Binc's yeses**, named, before anything below runs (`shared/governance/policy/agent-permissions.md`; `~/Workspaces/TODO.md` item 5): plates copied to a network volume; an image with the packs pushed to a registry (name and account); the spend, inside the USD 100 cap. The MCP server already refuses `create_agent` without `approved_by`.
3. [x] **Push the image** (2026-10-20 morning). `registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`, a private GitLab project of Lucas's holding only the registry; RunPod pulls with a read-only deploy token saved on the account as credential `gitlab-comfy-workflow`, whose id is in the Configuration panel under the image. Rebuild and push: `./start.sh comfy-image --push registry.gitlab.com/bcdevlucas/comfy-workflow/comfy-app:contract-v26`.
4. [x] **The network volume** `comfy-workspace` (`q8lf6riygr`), 120 GB in `CA-MTL-1` (the datacenter with the cheapest 24 GB card, the A5000 at USD 0.16/h, and the A40 in high stock behind it), about USD 8.40 a month. Entered in the Configuration panel; a volume can grow later, never shrink.
5. [ ] **Put the data on the volume**: three rsync attempts into a running pod died with the pod on 2026-10-20 (22 files landed); the decision in `docs/ADR-007` (likely a volume in Romania pushed over RunPod's S3 API, `./start.sh sync --s3`, no pod needed) comes first: `./start.sh sync --pod <id>` into a pod with the volume attached (needs the image with sshd, built 2026-10-20 afternoon; recreate the pod from it first) (the project tree is 81 GB, 66 of it corrosion shot renders; ComfyUI-Shared 17 GB); `--plates --approved-by <name>` for the plates, which are still unmapped on this Mac. Set `COMFY_MODE=prod` on the machine that drives real pods so every folder is required.
6. [~] **Boot one pod** with mounts applied: done 2026-10-20 (`ComfyUI-Dev`, A40, Montreal; nine workflows listed from the volume). Still to do on it: read the entrypoint's `linked …` lines after the sync, open a corrosion graph in its UI, queue one open shot at proxy with the queue script and `--comfy <pod url>`. Locked shots are never run; proxy first.
7. [ ] **CPU solve pod**, after the GPU pod works: `solve/` image from Binc's plan, same volume.

## Open decisions

- **Adapter Studio, later (ADR-009 todo):** autosave with versions. Save is explicit for now and there is no Revert button (re-vibe: fix the prompt and build again); a version list per adapter (code and prompt), Revert, a diff and named versions come first, then autosave of the editor draft on top. Also streaming the model's text and a diff view for the agent's fixes.
- Import adapters are built (CHANGELOG 2026-10-24). Open: what "run" means for Kyle's graphs on a pod (ADR-008 and the delivery notes say the PRODUCTION stereo graph is what runs, not the HISTORY ones); a CANALV2 adapter if Binc wants his own format imported; closing the adapter network gap with an OS sandbox (ADR-008, open point 2) and checking the fence in a packaged build; where the per-shot manifests of a Drive part live (cgi-042 and creature-266 manifests are not in part 1, so hashes are checked only on a merged folder); same shot id in two projects collides in `input/` (reported, never overwritten).
- How local state and the pod's volume stay in line: Pull, the sync in the app, pushing less, a CPU sync pod, a bucket as the hub, or RunPod's S3 API onto a volume in a supported datacenter (no pod needed; Montreal is not supported, Romania is the safe pick). Options and a recommendation in `docs/ADR-007`; no decision yet (2026-10-21).
- Which ShotPipe version, or several side by side, in the Mac install.
- Whether rendering happens here at all, given the plates live on binc-PC. RunPod is the planned overflow; see the section above.
- Whether the captured recipes belong in this repo or in `CANALV2/02_SCRIPTS/` beside the graph builders. The project's policy says the tree is "one place for everything".

## Also pending in this repo

- ComfyUI's own log on the stock image goes to `/workspace/logs/comfyui.log`, not the container's stdout, so the app's Logs modal shows the host's lines but not ComfyUI's there. Our image logs to stdout. A tail of that file over SSH would close the gap for the stock image.
- Rebuild the installers (`./start.sh package`) now that the port is complete; the Windows build on the Windows machine.
- The Bash-side governance hooks listed as open in `shared/governance/README.md`: installs, `./start.sh pod create`, pushes to other remotes.
- Abstract versus concrete shapes, and the two findings from `check.py` to raise with Binc (above).
- Run the review on `feature/desktop-app-and-mcp-fixes` against develop, then delete that branch.
- Follow-ups from the v1.7.0 EDL round (not built): Auto-generate starting or resuming a pod on the Default Configuration volume (`generate.start_pod`, `stop_when_done`, `max_spend_usd_per_day`; ADR-050 "may start a pod"); `auto_publish.require_review` (send DPX/Tunnel proxy with no review video); apply/undo of the publish settings through `publish.setSettings` (today `configio` writes the non-secret `publish.json` itself); `generateExisting` pods that start themselves; ADR-050 "Auto-publish is a pipeline" counts `held`/`eligible` in `status.watching` (only the summary sentence is done).

## Open from the base_v008 failures review (2026-11-21)

- **Memory is the cause of the 502s on /history, not ComfyUI crashing by itself.** RunPod's system log for the pods says `container is unhealthy: exit code 137 ... triggered memory limits (OOM)` (pod 1qo9ndp1cbq7u8, RTX PRO 6000, 87.5 GiB container RAM, four kills between 23:07 and 23:50 UTC; 2uhkv8qexsx5ui, ej3q8v0srppy63, ftnr9m237wrdtk the same). ComfyUI's startup line on that pod: `Enabled pinned memory 73261` (MB), i.e. **page-locked memory of 73 GB inside an 89 GB cgroup**, plus `--disable-smart-memory --cache-lru 1` from `docker/entrypoint.sh`. Untested idea, needs an image build and a run on a pod: add `--disable-pinned-memory` (or a smaller pinned pool) to the default `COMFY_ARGS`, and compare the kill rate on the same heavy graph (photoreal-013 f23, 633 frames). Not changed in the image: it cannot be tested without a rebuild and a pod.
- **The OOM signal is read from RunPod's system log; the cgroup counter is not.** `cards.classify` accepts `oomKills` (memory.events) but nothing fills it: reading it needs an ssh into the pod. Until then a kill with no log line left reads as a plain `restart`/`transient` failure and is retried on the same card (5 then 20 minutes), not escalated.
- **A restart with no memory evidence is not escalated.** Two restarts of the same graph on one card are a strong hint; the run results carry no attempt count to the queue, so the rule is not built.
- **The pod's own `/opt/comfy-app/ui2api.py` was never observed** (no ssh in this review). The conversion no longer uses it (the app sends its own copy, `ui2api.UI2API_PY`, 240 s), so what the image holds no longer matters; why the old `sed` path still produced `Timeout 60000ms` on 2026-11-21 06:32-06:48 is unexplained (the same sed rewrote the repo's oldest script correctly in a local simulation).
