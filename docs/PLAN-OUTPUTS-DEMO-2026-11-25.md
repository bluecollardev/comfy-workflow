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

Not in this plan, still open: the full gate on `develop`, 20 core test failures in five files (`podpull` fails on develop too), Wasabi connection, Binc right-eye naming.
