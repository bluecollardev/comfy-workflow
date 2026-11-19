# ADR-052: Retries, destructive actions on the volume, and the read-only mirror: the rules from 2026-11-18 and 19

**Date:** 2026-11-19
**Status:** Accepted for the rules that are built (1 and 2); proposed for 3 to 5.
**Context from:** the incidents of those two days: a push that filled the volume (ADR-011), Binc's `TypeError: fetch failed` on a sync plan, the Auto sync storage errors (ADR-046), the clearing of the volume's `output/`, and Lucas's standing instruction "do NOT delete tensors or that stuff".

## 1. Network retries (built: v1.5.3, v1.5.4)
- **RunPod's REST and GraphQL calls** (`libs/core/src/runpod.ts`, `fetchRetrying`): a read that fails with a network error (`fetch failed`, a reset, a timeout, DNS) or answers 502, 503 or 504 is tried twice more, after 0.4 s and 1.2 s. After the third failure the error says so in words ("Could not reach RunPod's API: the network dropped the request (ETIMEDOUT). Tried 3 times.").
- **Writes are never repeated after a reset** (a create or a stop may have gone through): they are retried only when the request provably never left (`ENOTFOUND`, `ECONNREFUSED` and the like). A real answer from RunPod (401, 404, 429) is never retried.
- **The `aws` calls to RunPod's S3** (`podpull.ts`): the same schedule; a connect failure is retried for any command, a break mid-request only for reads and downloads, never for a delete or an upload. The text after the last try has no URL. Auto sync stays "waiting" for two transient failures and turns red on the third (ADR-046).
- **Why:** one blip on a flaky link (Binc's PC, then this Mac's IPv6) must not leave a red error on something that then worked.

## 2. Destructive actions on the volume (built as practice; the app guards are partial)
1. **Model weights are never deleted** (`.safetensors .ckpt .pt .pth .bin .gguf .onnx .pkl`, and everything under `models/`), anywhere on the volume, including weights that sit inside another folder. (Lucas: "leave the models alone", "do NOT delete tensors or that stuff".) The publishing path refuses weights too (ADR-050).
2. **Look before deleting.** List the target by prefix first and show sizes and dates; delete only exact paths the person confirmed, never "old stuff" by description. A delete that can lose the only copy of pod-made renders says so before it runs.
3. **A named person says yes** for every deletion the app performs (`approved_by`), and the delete is recorded in the History.
4. **Verify by listing afterwards.** `volume_erase` over the S3 route reported 44,000 files "deleted" while a recount showed `output/` untouched (its counter was wrong, or the delete did not take effect). Direct `aws s3 rm` per folder worked and was verified by a before-and-after count of each folder. **Open bug:** the erase tool's counter and effect must be checked and fixed (NEXT-STEPS).
5. **The Sync window's "Also remove these from the volume"** deletes only what the exclusion patterns match, never uses `--delete-excluded` (which would also delete everything not in the local tree), and previews what will go (ADR-011).

## 3. Binc's mirror is read-only: the pull guard (proposed)
`projects/desktop/` is Binc's mirror and is never written to (`.claude/rules/binc-tree.md`). The Default Configuration maps the project folder to `projects/desktop/CANALV2`, and a **pull** brings each shot's `06_REVIEW` and `07_DELIVER` back into it: that would write into the mirror. **Proposed:** when the project folder is inside `projects/desktop/` (the configuration already marks it `in_mirror`), the pull planner skips the shot steps with a warning ("the project folder is Binc's mirror, read-only by rule"). Until it is built, do not pull the shot steps into the mirror.

## 4. Platforms (proposed)
The release script builds and publishes only the Mac app. Binc's PC is Linux, so none of these versions reach him. Options: he builds (`./start.sh package linux`), the release also publishes Linux and Windows builds (to be tried: a Linux build from the Mac is possible with electron-builder, Windows is harder), or he runs it from the repo. Recommended: the first now, the second as the fix (ADR-013 describes the downloads page).

## 5. EDL clip names (proposed)
Outputs are named with the clip name (ADR-048) and the person types it for a sequence whose EDL name differs (the three archival-077 takes). Tunnel's V11 EDL has 121 events and `EDL-READ.md` lists the per-shot reading. **Proposed:** an *Import EDL* action that reads the EDL (CMX3600: clip names from `* FROM CLIP NAME` comments, record and source timecodes, speed changes) and pre-fills each sequence's clip name where the shot matches, flagging mismatches (cgi-090 shot 2, carter-reframe) instead of guessing. The EDL file stays untouched; the frames are never renamed.

## Consequences
- The retries make a flaky link invisible when it recovers and honest when it does not.
- The deletion rules are a standing instruction, recorded where the next session (or agent) will read them.
- Items 3 to 5 are open and listed in NEXT-STEPS.

## Shots as child jobs (v1.6.2)
A publish run is a parent job with one child per shot (ADR-050, "Build notes for v1.6.2"): the Queue shows the parent with its children, each with its own progress, error, retry and cancel, and Auto-publish's own jobs (`trigger: 'auto-publish'`) and Auto-generate's renders (`trigger: 'auto-publish'` on the render job) are listed apart from the ones a person started. With "Sync the renders to this PC when done" and "Publish when done", each rendered sequence is pulled and then published as its own child as soon as ITS pull finishes, without waiting for the other sequences.
