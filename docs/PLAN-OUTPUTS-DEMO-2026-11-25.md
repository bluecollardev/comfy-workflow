# Plan: Outputs rows, frame mode, stock cards and an ungated patch (2026-11-25, demo in under an hour)

Lucas, 2026-11-25: "i need this done in under an hour i have a demo, so split into subtasks", "then release an ungated patch version", "build anything we mentioned that's missing in parallel", "make a plan doc and execute".

| # | Task | Who | Status |
|---|---|---|---|
| 1 | Outputs rows one (slot videos) and two (DPX previews), sequences below at full width, stereo checkbox remembered ([ADR-058](ADR-058-outputs-overall-left-right-eye.md), [ADR-059](ADR-059-outputs-eye-rows-and-frame-mode.md)) | done on `develop` | committed |
| 2 | Frame mode switch on row two: First Frame / Fifth Frame ([ADR-059](ADR-059-outputs-eye-rows-and-frame-mode.md) decisions 2 to 4) | subagent, own worktree and branch | running |
| 3 | Stock cards for Cheapest in Stock in Default Configuration (`feature/default-stock-cards`, `4d49d7b`) | subagent finished | to merge |
| 4 | Row two spec (the Overall/Left/Right/SBS DPX row sits between the videos and the sequences) | main session | to add |
| 5 | Merge 3 and 2 into `develop` with `--no-ff`; run the touched specs (one Playwright run at a time: they share a port) | main session | after 2 |
| 6 | Restart the app so the demo shows it | main session | after 5 |
| 7 | **Ungated** patch release: `./start.sh release patch --skip-gate` (Lucas said ungated for this patch; the skip is recorded) | main session | last |

## Rules for this push (Lucas, 2026-11-25)
1. **Speed first:** "i need this fast", "skip testing generate". Build what was asked; do not hold the work for a test pass.
2. **Test only the unit you touched:** "only run tests you need to run to do your job in the segment or unit of work". One spec file for the unit (for example `outputs-eye-slots.spec.js`), never the whole Outputs family or the gate, one Playwright run at a time (they share a port).
3. **Ungated patch:** v1.7.4 goes out with `--skip-gate` ([ADR-062](ADR-062-ungated-demo-patch.md)); the gate debt stays listed below.
4. **Parallel subagents** for independent units, each in its own worktree and branch off `develop`, merged `--no-ff` by the main session.

## Added during the push
| # | Task | Status |
|---|---|---|
| 8 | Persistent preview cache that survives refresh and restart ([ADR-060](ADR-060-persistent-preview-cache.md)) | merged |
| 9 | Row headings: **Video Outputs**, **DPX Frame Outputs**, **All Frames for (filename).dpx** per sequence | built, eye-slots spec only |
| 10 | No duplicate Main Video beside a sequence when slots are on: the Main Video is the first item of row one (the Overall slot, when it has no video of its own) | built |
| 11 | Load previews top to bottom (queue order follows the page, row by row) | to do |

Not in this plan, still open: the full gate on `develop`, 20 core test failures in five files (`podpull` fails on develop too), Wasabi connection, Binc right-eye naming.
