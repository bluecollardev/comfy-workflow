# Runbook: an AI agent runs a BH shot on an H100 pod, through MCP only

(Part of `docs/runbooks/`; the requirement is ADR-034. Sub-tasks: `pod-lifecycle.md`, `round-pull-and-place.md`, `mcp-session.md`.)

**For:** an AI agent (Claude Code) with the `pod-manager` MCP server. Not for people; the app's window does the same things.
**Status:** living document. Update it in the same session whenever a step is proven, fails, or changes (section "Log" at the end). First written 2026-11-05 from the cgi-042 session.
**Rules that govern it:** `shared/governance/policy/agent-permissions.md` (USD 100 cap, a named yes for any spend), `.claude/rules/binc-tree.md` (never write into `projects/desktop/`), ADR-022 (pod pulls), ADR-033 (placing), ADR-028 (MCP does everything the window does).

## 0. Ground rules

- **Spend needs `approved_by`** (`create_pod`, `recreate_pod`, `panama_pull` with `target: pod`, `set_pod_config recreate`). Use the name of the person who said yes in this session. Never guess one.
- **MCP only.** If a step has no tool, say so and ask; do not edit app files (`pod-names.json`, `history.jsonl`) by hand.
- **Stale tools:** this session's stdio server loads the core once. A tool added later (for example `rename_pod`, `panama_place`) is missing until the user runs `/mcp` and reconnects `pod-manager`. The app's own HTTP MCP (`localhost:8765/mcp`) is always current but has its own job table, so a job started over stdio is "No such job" there.
- **Big outputs:** `panama_job` returns ~60 KB (every log line). It is saved to a file; read it with python (`json.load`, drop `lines` and `recent`), never into context.
- **Stop what you start.** Say the pod's price when you start it; stop or delete it when idle (see section 7).

## 1. Find the version to process

1. `panama_rounds` lists the rounds. The newest delivery that carries the shot is the source; `brynley-inbox-<date>-vNNN` is a text-only inbox of `ENTRY.md` and `ASSETS.csv` per shot, not footage.
2. Read the inbox entry from the bucket: `aws s3 cp s3://bh-panama-exchange-610140802195/rounds/<inbox>/03_INBOX/<shot>/ENTRY.md - --profile panama --region us-west-2` (write the options out, zsh does not split a variable). It names the delivery round, the approved final's file name and its **sha256** (`ASSETS.csv`), the frame count and the ask. A changed entry arrives as `ENTRY_v002.md`.
3. Confirm by hash: the final in every round that carries it, and on disk, must match the `ASSETS.csv` sha256. Same hash in two rounds = the same file; cite the round the entry names.
4. A shot with `plate_delivery: not yet delivered` (for example cgi-042b on 2026-11-05) has nothing to process. Stop and report.

## 2. Get a pod on the volume

1. `list_pods`, `list_volumes`. The default volume is `comfy-h100-apin1` (AP-IN-1, 100 GB, 7 USD/mo). A pod pinned to a datacenter by its volume.
2. Reuse the existing H100 pod: `resume_pod`. If it says the host has no free GPU, `recreate_pod` (same settings, new host, the volume follows, `approved_by` not needed by the tool but the spend is the user's: say the price). Do **not** `create_pod` a second H100 when one exists; a duplicate was made and deleted on 2026-11-05.
3. `rename_pod` names it after the shot (our side only; RunPod's name stays). Expect `status: starting` for several minutes on a new host: the image (`ghcr.io/bluecollardev/comfy-app:contract-v26`) is downloaded first (`get_logs` shows `Downloading`).
4. `set_idle_stop` for the session (the idle watch runs only while the app is open; 6 hours was chosen for cgi-042, about 24 USD at 3.99/h if forgotten).

## 3. Put the round on the volume

1. `panama_pod_plan <round>` shows size, card and price. It reports `current: null` until the pod is **running**.
2. `panama_pull` `{round, target: "pod", route: "current", approved_by}` once the pod is running. "No pod of yours is on this volume" = the pod is still starting.
3. Follow with `panama_job` (`target: "pod"`), reading the file. Measured 2026-11-05: 15.2 GB, 1,402 files in about 6 minutes at ~136 MB/s; `verify.ok: true` means the manifest check passed. The whole round is pulled; there is no single-shot pull.
4. It lands at `/workspace/comfy-shared/temp/rounds/<round>/`. **ComfyUI cannot read it from there.**

## 4. Place the inputs where the graphs look (ADR-033)

- A pull whose check passed places by itself (`job.place`). For a round pulled before ADR-033, or to re-run: `panama_place {round}` (dry run) then `panama_place {round, dry_run: false}`.
- Result: inputs at `input/rounds/<round>/…` and, where free, at the shipped path `input/shots/<shot>/…`; graph copies in `workflows/rounds/<round>/<graph>.json` with the paths rewritten (flat unique names); the originals stay in the round folder and are not in the Workflows panel. Read `conflicts`, `missing` and `mode` (`hardlink` or `copy`).
- In ComfyUI open the graph from `workflows/rounds/<round>/`, not from the round folder. "Missing Inputs: a required media input has no file selected" means placing has not run or reported `missing`.
- Proven on the real volume 2026-11-05 (Log).

## 5. The work (stereo conversion of a final)

BH's ask for a CGI shot (from `ENTRY.md`): convert the approved final to stereo; return **LEFT + RIGHT eyes, 16-bit RGB TIFF, one file per frame, the final's raster, colour untouched and untagged**, to `returns/<delivery round>/<shot>/`, with a `bh-return-1` manifest (sha256 + bytes). **We do not make DPX: BH makes Tunnel's DPX and the side-by-side review file from our TIFF eyes** (their `ENTRY.md`: "BH makes Tunnel's DPX and the side-by-side review file"; Lucas asked 2026-11-05 and had it noted). DPX is a corrosion-plate format elsewhere in this repo (ADR-004), not part of this return. There is **no BH production graph for stereo**; their graph in the round is the HISTORY graph (how the final was made) and must not be rewired.

Starting points in this repo (unverified for this job, see Log): `shared/nodes/portable/ComfyUI-BincStereo/workflows/binc-stereo-sequence-chain.json` (frames, depth, temporal filter, stereo, SaveImage) and `binc-stereo-video-chain.json`. Neither writes 16-bit TIFF eyes; that output step is still to be built and tested on a few frames first. A depth set for cgi-042 exists on the Mac (`input/shots/cgi-042/06-stereo/v03-depth-current`, 241 frames); `sync` pushes it (plates need a named yes).

Always: run a handful of frames first, check parallax and holes with the report nodes, then the full clip. Never run a locked shot; this is not one, but never touch `projects/desktop/`.

## 6. Return

Not yet exercised. The return goes to S3 `returns/…` (a write to a shared bucket: needs a named yes from the user, and the manifest). Do not upload without it.

## 7. Close down

1. Pull results you need with `sync {direction: pull}` or leave them on the volume.
2. `stop_pod` (the volume and disk stay; billing pauses). Resume may fail later (host full) and then needs `recreate_pod`.
3. Anything temporary you made (`ComfyUI-Pull-…` pods) is deleted by the app when its job ends; confirm with `list_pods`.

## Log (newest first; add a line each time something is proven or breaks)

- 2026-11-05: Lucas asked whether the run should generate DPX frames. No: BH's entry asks for 16-bit RGB TIFF eyes and BH makes the DPX (Tunnel's) and the review file themselves. The first full run saves 8-bit PNG frames (agreed as fine for a first pass); the 16-bit TIFF eyes are still to build.
- 2026-11-05: Lucas opened a `.as-delivered` copy in the Workflows panel by mistake and saw every loader red. Placing no longer writes those copies; the stale ones were deleted from the pod's panel (originals are in `temp/rounds/<round>/<shot>/comfy/workflows/`).
- 2026-11-05: **ComfyUI issues read with `get_comfy_logs {level: warnings}`:** (a) my first test prompt failed validation on `model: ''` (expected, fixed); (b) a run from the window of a `binc-stereo-*` sample failed `BincDepthAnythingV2 model: 'Depth-Anything-V2-Large-hf' not in ['(put HF-format folders in models/depth_anything/)']`: **there are no depth weights in `models/depth_anything/` on the volume**; the graphs only work with `hf_repo_id` (Hub, fetched each time into the container's cache); (c) `BincLoadImageSequence: folder not found /workspace/comfy-shared/input/frames`: the sequence-chain sample expects a frames folder that does not exist (use the video chain); (d) startup warnings: pytorch is not cu130 (our `-cu13` tag is for Blackwell), `FAL_KEY` not configured (fal nodes will not run). **To do:** put the DA2 weights on the volume (an MCP tool or the image) and set `HF_HOME` on the volume so a recreated pod does not re-download.
- 2026-11-05: the window flagged all 28 loaders "Missing Inputs" on the placed v13 graph though images render: ComfyUI lists only top-level `input/` files and flags any other value. Fix: ADR-033 amendment, flat unique names (`<shot>__<stem>__<sha8>.<ext>`) at the top of `input/`.
- 2026-11-05: **5-frame stereo test ran end to end through the bridge** (`run_workflow`, prompt `ee589b6a…`, success): `LoadVideo` (the placed `rounds/<round>/shots/…/master/…v03.mp4`) -> `GetVideoComponents` -> `ImageFromBatch` (frames 120-124) -> `BincDepthAnythingV2` (`depth-anything/Depth-Anything-V2-Large-hf` fetched from the Hub by the pod, fp16, max_side 1036) -> `BincStereoFromDepth` (convergence 0.35, near 1.0 %, far 0.25 %, symmetric, mesh_stretch, the node defaults and the same values as the existing `cgi-042-binc-stereo-v01` graph) -> `SaveImage` L, R and depth into `output/cgi-042-test/` (8-bit PNG). The `model` input must be the literal `(put HF-format folders in models/depth_anything/)` when `hf_repo_id` is given. **Not yet judged:** the parallax report and the pictures; the full 241 frames; 16-bit TIFF.
- 2026-11-05: Lucas opened `#cgi-042-binc-stereo-v01` (an existing 22-node Binc graph in the pod's workflows: video -> frames 108+25 -> depth -> temporal filter -> stereo -> SBS/eyes videos) and got "Missing Inputs": its `LoadVideo` pointed at the Mac layout `shots/cgi-042/05-outputs/Approved/cgi-042-pullback-4k-v03.mp4` (no `master/`), which is not on the pod. Fixed through the bridge `save_workflow`: the original kept as `cgi-042-binc-stereo-v01.as-found.json`, v01 now loads `rounds/brynley-comfy-2026-10-22/shots/cgi-042/05-outputs/Approved/master/cgi-042-pullback-4k-v03.mp4`. Lesson: a graph made on the Mac names Mac paths; point it at the placed round path.
- 2026-11-05: cgi-042 latest = `cgi-042_main_final_v01_3840x2160_24_hevc.mp4`, sha256 `fe53cada90d469ef44e7777a123e82a220796de2610a58b2c0c0a26fbf164630`, identical in rounds 10-20 and 10-22; entry in `brynley-inbox-2026-10-28-v001`. Proven: sections 1, 2, 3 on pod `3h25wd2p4es40i` (named cgi-042), H100 SXM, AP-IN-1, 3.99/h.
- 2026-11-05: **placing proven** on pod `3h25wd2p4es40i`: `panama_place` real run linked 156 files by hard link, wrote 3 graph copies (cgi-042: 28 inputs), no conflicts, none missing; rerun idempotent. The ComfyUI bridge (:8766) targets this pod's ComfyUI 0.39.2 and the Binc/Stereo nodes are present.
- 2026-11-05: the graph failed with "Missing Inputs" because nothing copied the round's inputs into `input/`. Fixed in code by ADR-033; **not yet run on the pod**. Next: `panama_place` dry run for `brynley-comfy-2026-10-22`, then the real one; record `mode` and any `conflicts` here.
- 2026-11-05: `rename_pod` was missing in the session until `/mcp` reconnect (stale stdio server); the HTTP MCP on :8765 had it.
- 2026-11-05: `resume_pod` on the old H100 failed (host full); `recreate_pod` gave a new host; the image download made it `starting` for ~10 minutes.
- Open: the stereo output step (16-bit TIFF per eye), the depth source decision, the return upload and its named yes.
