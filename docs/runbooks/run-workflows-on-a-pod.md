# Runbook: run a pod's workflows and read the errors

**For an AI agent.** ADR-037. Needs a running pod with the round's graphs placed (`round-pull-and-place.md`).

1. `list_pod_workflows {pod_id}`: the graphs in the pod's Workflows panel by folder. A round's graphs are under `rounds/<round>/`. Pick the paths (all of a shot's, or chosen ones).
2. `run_pod_workflows {pod_id, paths, approved_by}` (a named yes: it uses GPU time on a billing pod). It returns a job at once.
3. `run_workflows_job {id}` until `state` is not `running`. Each result is `done`, `failed` (read `error`: it names the node) or `skipped`. `cancel: true` stops it and interrupts the running prompt.
4. Every graph's outcome is also in the History (`job: run`), so a later session can read what failed without this job.
5. A graph for a locked shot is refused, not run. A graph that is not a UI graph, or that fails to convert, fails with the reason; the rest still run.

**Known gaps / Log** (newest first)
- 2026-11-17: **a graph fails validation with "Value not in list" on a loader**: the file may exist on the volume in another models folder. Case: `archival-080__a__proxy_v005.json`, node 137 `LTXVAudioVAELoader`, `ckpt_name: 'LTX23_audio_vae_bf16.safetensors' not in ['ltx-2.3-22b-dev-fp8.safetensors', 'ltx-2.3-22b-distilled-fp8.safetensors', 'ltx-2.3/ltx-2.3-22b-dev.safetensors']`. This loader lists **`models/checkpoints/`**; the file was only in `vae/` on EU-RO-1 (`a3upg9ey48`). Fixed without touching the graph: `models_fetch` of `Kijai/LTX2.3_comfy` `vae/LTX23_audio_vae_bf16.safetensors` (364,855,188 bytes, sha256 `5bc10fa4…38c3`, verified) into `checkpoints`, run on the already-running pod `CanalV2-lores-v003-a-v27` (job `fetch-vol-a3upg9ey48-1794915067311`, a few seconds, nothing overwritten, `vae/` copy left). Then refresh ComfyUI's lists (`r`) or restart it on the pod. **Not yet re-run**; more "not in list" errors may follow (`LTX23_video_vae_bf16.safetensors` is also only in `vae/`). Compare what the error lists with `models_status` before fetching.
- 2026-11-07: built and unit/browser-tested; **not yet run on a real pod**. Conversion happens on the pod only with an image built after ADR-037 (Chromium + `ui2api.py`); otherwise on this PC with Chrome (the app or MCP server must be running on this PC). First live run: record here the pod, graph, conversion path taken and any page-API surprise (`window.app.loadGraphData` / `graphToPrompt`).
