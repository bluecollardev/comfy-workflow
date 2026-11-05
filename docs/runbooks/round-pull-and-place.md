# Runbook: a round onto the volume, ready for its graphs

**For an AI agent.** ADR-022 (pull), ADR-033 (place).

1. Pod running first (see `pod-lifecycle.md`). `panama_pod_plan {round}`: `current` is null until the pod is **running**.
2. `panama_pull {round, target: "pod", route: "current", approved_by}`. Follow with `panama_job {id, target: "pod"}`; the result is ~60 KB and is saved to a file: read it with python and drop `lines`/`recent`. `verify.ok: true` = manifest check passed. The whole round is pulled (15 GB took ~6 min).
3. A passed pull places by itself (`job.place`). Otherwise `panama_place {round, pod_id}` (dry run), then `dry_run:false`. Read `conflicts`, `missing`, `mode`. Graph copies are in `workflows/rounds/<round>/`; open those, not the round folder.
4. A graph that says "Missing Inputs" = not placed, or `missing` non-empty.

## Log
- 2026-11-05: pulled `brynley-comfy-2026-10-22` (15.17 GB, 1,402 files, verified) onto `comfy-h100-apin1`.
- 2026-11-05: first real `panama_place`: the apply script failed with "Argument list too long" (payload in an environment string > 128 KB); fixed (payload via a temp file, test with a >200 KB graph). Then 156 files **hard-linked** (`mode: hardlink`, so the volume supports links and no bytes are doubled), 3 graphs written (archival-071: 30 paths, cgi-042: 28, creature-266: 20), 0 conflicts, 0 missing; a second run linked 0 and found 156 already there.
