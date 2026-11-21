# ADR-056: Memory-safe graph runs: measure first, chunk by default, guard live, grow RAM with the GPU count

**Date:** 2026-11-21
**Status:** Accepted as the process; **built:** failure classification and card escalation (`cards.ts`, wrong lever, to be changed, section 4), wait-for-ComfyUI before every graph, the pod card's GPU count, VRAM total and RAM (`podram.ts`). **Not built:** the probe, chunking by default, the live guard, escalation by GPU count (section 5).
**Context from:** the Tunnel V11 delivery (`docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md` sections 14 and 15). Eight of the 36 elements (photoreal-013 hadal, sunlight, top, landing, f23; cgi-072 head, backhalf-b, backhalf-c) could not be generated on 2026-11-21 because their graphs were killed for memory, and for hours the failures were read as cold-pod trouble. Lucas: "we had chunking already so why this die", "why didn't this automatically happen", "how can we preemptively avoid this out of memory crash", "adr this process".

## 1. What happened (the evidence)
- RunPod's system log on every failed pod says `container is unhealthy: exit code 137 ... triggered memory limits (OOM)`. The app saw it as `ComfyUI answered HTTP 502 for /history/<id>` (the container restarts, ComfyUI forgets the prompt) or as a 404 or "the pod lost the prompt".
- It is **system RAM**, not VRAM: 1x RTX PRO 4500 has 57.7 GiB of container RAM (killed about 2 minutes after the prompt), 1x RTX PRO 6000 has 87.5 GiB (RAM 76 GiB, then killed after 22 minutes on hadal, 160 frames), 4x RTX PRO 4500 has 232.8 GiB (**f23, 633 frames: 40 GiB at 05:33 UTC, killed at 05:34:58**: one step took everything inside a minute). The 96 GB card did not help; it has less RAM than the 4x pod.
- The graphs (`base_v008`) chunk only the SeedVR2 sampling (`SeedVR2TemporalChunk`). The read (`OCIORead`, whole frame window), the scale to 3840x2160, the temporal merge, the VAE decode, the wavelet post-process, the colour conversion and the write (`OCIOWrite`) work on the whole batch: 633 frames at 4K float32 is about 63 GB per copy and several copies exist. That is an inference from the timing; the node was not isolated.
- The first 11 elements came through because they were small (the largest, chasm07, 271 frames). The app has a run-level chunking (`chunk_plan`, `run_shot_chunked`) and a RAM guard at 85% of the container limit, but both apply to chunked jobs only. `run_pod_workflows`, the queue and Import Round run a graph whole.

## 1a. Why it is RAM: how these graphs use memory (confirmed with Lucas 2026-11-21; the node-level part is inferred, not profiled)
- **The limit is the container's, not the host's.** A RunPod pod is a container with a memory limit (cgroup); the host has far more RAM. Over the limit, the kernel kills the container (exit 137, `triggered memory limits (OOM)`). The limit comes with the GPU count and the host: 27.9, 57.7, 87.5, 116.4, 232.8 and 262.6 GiB were seen, and it differs between pods of the same card. It is unrelated to the container disk (20 GB by default) and to the network volume, which are storage.
- **ComfyUI's `Total RAM` line is not trusted as the limit.** It matched the container limit on our pods (59,128 MB on a 57.7 GiB pod), but the repo's own docs say it can report the host's RAM. The pod card reads the cgroup (`podram.ts`).
- **What sits in system RAM.** (a) The SeedVR2 model: about 15.7 GB of weights staged through RAM on their way to the GPU, a fixed cost. (b) **The frames, which is the big one:** ComfyUI passes a clip between nodes as one batch of float32 images in system RAM. 633 frames at 3840x2160 is about 63 GB for one copy, and the scale, preprocess, merge, wavelet post-process and colour-convert stages each make or hold a copy. SeedVR2's own sampling is chunked and runs on the GPU, which is why VRAM was never the limit. `--cache-lru 1` keeps node outputs cached, which adds to it.
- **What was seen:** f23 sat near 40 GiB for about 10 minutes (the chunked sampling), then went past 232 GiB in about a minute (a whole-clip step). hadal (160 frames) passed 76 GiB on an 87.5 GiB pod and died after 44 minutes on a 116.4 GiB pod. `--disable-pinned-memory` changed nothing.
- **Open issues:** which node takes the memory is not profiled (the probe of section 2.1 is where to measure it); whether the SeedVR2 seams between chunks show; why the pod's own converter fails at 60 s even with the 240 s fix (the Mac-side runner was the workaround); the guard (section 2.3) is not built.

## 2. Decision: RAM is chosen and checked before the run, not discovered by the kill
A graph is never started whole on a pod without an answer to "will it fit". In order:

1. **Probe.** Run the graph on a short frame window (about 10 frames) with the container RAM sampled (the cgroup read the pod card already uses, `podram.ts`). RAM per frame follows; peak = base + per-frame x frames x the copies the stages keep. The probe is cheap (minutes) and it measures the real graph, not a guess from its node list. Results are kept per graph (next to `graph-durations.json`) so a repeat run needs no probe.
2. **Chunk by default.** A graph whose estimated peak is above about 60% of the container limit is split by frame window into chunks that fit (the planner's default is about 50 frames for 4K with SeedVR2) and run as separate jobs: `OCIORead` window per chunk, `OCIOWrite` numbering offset so the frames line up, the chunks run on one pod one after another or on several pods. A graph that fits whole runs whole.
3. **Guard live.** Every graph run (not only chunked jobs) reads the container RAM; at the guard (85%) the run is interrupted through ComfyUI's `/interrupt` **before** the kernel kills the container, and the task is resubmitted as smaller chunks. The kill costs a restart (about 1 minute of node loading), every loaded model and the whole run; an interrupt costs the current chunk.
4. **Grow RAM with the GPU count, not the VRAM.** RunPod sets no RAM; it comes with the card and scales with the GPU count: 1x RTX PRO 4500 = 57.7 GiB, 2x = 116.4 GiB, 4x = 232.8 GiB ($0.72, $1.44, $2.88/h). When chunks of the smallest sensible size still do not fit, the next step is more GPUs on the same card, not a bigger card. The extra GPUs sit idle; the pod pays for the RAM.
5. **Say so.** The pod card shows the GPU count, the total VRAM and the container RAM (built), so a person sees what a pod is. A task's events and the History say what was decided ("probe: 1.9 GiB per frame; 160 frames need 304 GiB, chunk 50 on a 116 GiB pod").

## 2a. Decision (Lucas, 2026-11-21: "we built chunking, why didn't this happen automatically", "make sure it's automatic"): it is automatic, nobody asks for it
- **Why the earlier chunking did not help.** The app already had run-level chunking (`chunk_plan`, `run_shot_chunked`, `chunked_job`) and a RAM guard. Both were **opt-in tools**: a person or an agent had to choose them for a shot, and the guard only watched chunked jobs. `run_pod_workflows`, the queue's run tasks and Import Round ran a graph whole, so the 8 elements that needed chunking never met it. A safety that must be remembered is not a safety.
- **The rule.** Every graph run, through every entry point (queue run task, Import Round, `run_pod_workflows`, the Run Workflows window), goes through the same step: probe an unknown graph, plan, chunk or run whole, guard live, escalate, check the merged range. Nothing in the steps of section 2 is a tool a person has to call. The only switch is an opt-out (`chunking: 'off'` in the run options and a setting), default on, and a run that uses it says so in its events.
- **What it does not guess.** A graph whose frame window the planner cannot find (no window widgets on the read and write nodes) runs whole with the live RAM guard only, and says so in the task events and the History; the app never splits a graph it does not understand.
- **A test says so.** A run with no options on a graph it has not seen must be probed and chunked (unit test with fakes); a build that makes chunking opt-in again fails it.
- **Status:** being built on `feature/chunked-graph-runs`; not in the running app until merged and the app restarted.

## 2b. Proposed extension (Lucas, 2026-11-21: "chunking is good, but ideally if we can cache to a secondary volume, on the same datacenter"): spill and checkpoint to disk
Chunking keeps each frame batch small. Disk would let the pipeline keep **no** whole-clip batch in RAM and survive a kill. Three layers, in order of cost:
1. **Chunking** (section 2 and 2a): no new storage.
2. **Stage checkpoints on the existing network volume.** Each stage writes its result as an image sequence (e.g. `comfy-shared/cache/<graph>/<stage>/`) and the next stage reads it in frame windows; a run killed in stage N resumes from stage N-1's files instead of from frame 0. Needs graph nodes that read and write sequences in windows; the chunk planner already narrows OCIORead and OCIOWrite windows, so the pattern exists for the first and last stage.
3. **Scratch on a bigger container disk** (`create_pod` takes `disk_gb`, default 20): local, so likely faster than the network volume; persists across stop and resume, lost on delete; pinned to the host. A **second network volume** must be in the same datacenter as the first (EU-RO-1 for `a3upg9ey48`; `create_volume`) and costs about USD 0.06 per GB per month at the current rate (2,500 GB = USD 145/month); it only helps if the shared volume turns out too slow.
**Not known, measure first:** read and write throughput of the network volume under load (4K DPX frames are about 50 MB each; a stage of 633 frames is about 31 GB), and whether swap or zram can be enabled inside these containers (assumed no). The probe of section 2.1 is where the measurement belongs.

## 3. What does not change
- A pod is stopped, not deleted (ADR-055); logs are kept. Deleting old pods is a person's act, after their logs are in the log document (`pod-logs/POD-LOGS-<date>.md`).
- Delivery rules of ADR-055 stand: base_v008 output goes to a `_TEST_` round first; a real round is never overwritten.
- The frame count of every produced element is compared with the PDF's before it is patched and published (the run-status table of the plan).

## 4. Corrections to what was built earlier the same day
- **The card escalation (`cards.ts`, merged in `fix/base-v008-failures`) climbs VRAM** (32, 48, 80, 96 GB, never B200, B300, H200). For this class of failure it is the wrong lever and it can make things worse (96 GB card: less RAM than the 4x 4500 pod). Keep the failure classification (RunPod system log, exit 137); change the escalation to chunk first, then GPU count, then a card with more RAM per GPU.
- **The pinned-memory theory was wrong.** `COMFY_ARGS` now carries `--disable-pinned-memory` (Default Configuration env) and hadal still died. It can stay or be removed; it is not the fix.
- **A conversion that fails on the pod after 60 s** was not about memory: ComfyUI's page takes 80 to 160 s to be ready on a fresh pod. Graphs are run from a Mac-side Chrome page that waits as long as needed (`rungraphs.mjs`, outside the app); the pod's own converter kept failing at 60 s even with the 240 s fix, for a cause not found. The app should do the Mac-side route reliably, or wait on the pod for the page.

## 5. To build (in order)
1. Probe and the per-graph memory record (`runflows.ts`, a new `memprobe.ts`), with the frame-window edit of a copy of the graph (the original is never touched).
2. Chunk by default: the planner for UI graphs (the existing `chunk_plan` is for the corrosion pipeline's frame inputs), output numbering, and a merge check that the chunks make the whole frame range with no gap and no repeat.
3. The live RAM guard on every run and the interrupt-and-resubmit.
4. Escalation by GPU count in `cards.ts`; `create_pod` already takes `gpu_count`.
5. Tests with fakes (no pods) for each; one live proof on f23 before the 8 are called done.

## 6. Consequences
- A long graph costs a probe and several jobs instead of one job that may die after 20 minutes. The result is slower on the happy path and certain on the unhappy one.
- The RAM numbers above are observed on three pod shapes in EU-RO-1; a card in another datacenter, or another image, may differ. The probe measures the pod it runs on; that is why it is the first step.
- What is not known: which node takes the memory in f23 (inferred, not isolated), and why the pod's own converter fails at 60 s.
