# Runbook: generate on a pod, keep in Wasabi, approve, publish to Panama

Decision and status: `docs/ADR-068-generate-keep-approve-publish-flow.md`. This page says what to press, in order, and what is not built yet. Update its Log when a step is proven or fails.

## Before the first run
1. Default Configuration > Storage: Wasabi has its bucket, region and keys, Test passes, and **Default Storage** is on for `bincvfx`. The Panama keys and the publish destination are set (Storage tab, Panama card).
2. Network Volumes > the Wasabi row > Sync Rules: **Generated** is ticked (once the rules have moved there; until then the Storage tab's Upload On row). Tick **Approved** too if the approved review files should also be kept.
3. A pod is running on the volume.

## The steps
1. **Generate**: Run Workflows or the Generate window on the pod for the round's shots (ADR-048). Watch the Queue: the render, then an `Upload on generated to Wasabi` job.
2. **Check it arrived**: Network Volumes > Wasabi > Explore (or Outputs, Source = Wasabi). The keys are the volume's own paths.
3. **Review**: Outputs window, or Sync To This PC (From the Wasabi row, To This PC) into the folder the headset reads (`docs/MOON-PLAYER-REVIEW.md`).
4. **Approve**: name the approver, state the colour, approve the shot version (Outputs window, or the MCP `autopublish` approve). Nothing is copied by approving; with Approved ticked the approval and review files go to Wasabi.
5. **Publish if ok**: not built yet. Today publishing reads from the pod volume or this PC (Publish window). The target is the delivery round under `returns/BKK/` in the Panama bucket; the named approval, the checks and the Slack post are the same.

## What is not built (do not rely on it)
- Publishing from the Wasabi copy, with the checks (complete, colour stated, size and sha256 match).
- The approval marker in Wasabi.

## Log
- 2026-11-28: Generated to Wasabi proven on a real pod (proxy, 285,020 bytes, `bincvfx`). Review `.mov`, Approved and publish-from-Wasabi not yet run.
- 2026-11-28 (17:36, pod `s50ko2ri9htqqm`, RTX PRO 4500, 25-frame proxy at 1280, app on today's uncommitted core, Auto-publish in dry run and auto-generate off for the test, then restored):
  render -> volume copy to This PC proven; render -> Wasabi proven (404,253 bytes); Wasabi -> This PC proven with the volume tick off. With both ticks on, the volume copy lands first and the Wasabi pull finds the file there and says nothing.
  Approved and Published: only the copy paths were run, with probe files on the real volume and bucket. No version was approved or published.
  Found: only the `.mp4` goes to Wasabi, not its `.meta.json`; a re-render of the same size is "already there" and is not sent again.

- 2026-11-28 (17:44): a real manual publish of `archival-093 v001` (3 files, 20.4 MB, volume source, via this PC, approved by Lucas) to `returns/BKK/` with Slack, then the Published rule copied the 3 files to
  `ComfyUI-Shared/output/deliver/archival-093/v001` (3 downloaded, 0 failed). Published -> This PC is proven. Nothing went to Wasabi (volume files are not sent there). Mark approved was not used, so Approved is still unproven.
- 2026-11-28 (17:58): files that are only on the volume now go to Wasabi on Approved and Published (read over the volume's S3 API through this PC, no pod). `archival-093 v001` sent: 3 files, same sizes.
  Live tests (`npm run storage:live` in apps/runpod-dashboard, real bucket and volume, 10 of 10) cover the copy paths for all three events. Not yet seen: a real Mark approved or publish firing this in the app.

- 2026-11-28 (18:12): in the running app, a publish of synthetic `deliver/zz-test-001/v001` (3 files, 1.7 MB, volume source, S3 only, no Slack, round `_TEST_2026-11-28`) fired Published: 3 files to Wasabi and 3 to ComfyUI-Shared, 0 failed.
- 2026-11-28 (18:23): a publish of synthetic `deliver/zz-test-001/v002` from the window went to the REAL round `returns/BKK/qc_2026-11-02_r02/` with Slack (it was meant as a Mark approved test). Published fired:
  3 files to Wasabi and 3 to ComfyUI-Shared. The test objects in that round are still there until Lucas says. Check the Round box before publishing a test. Mark approved is still unproven in the app.
