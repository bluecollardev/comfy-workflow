# CANALV2 Tunnel V11: how long render, fix, upload and delivery took (and how to estimate them)

**Written 2026-11-21, 19:20 Bangkok time (UTC+7; all times here are Bangkok unless marked UTC).** Read-only: nothing was started, stopped or uploaded to make this page. Every number says where it came from. **UNVERIFIED** means I could not read it. Companion: the estimator `scripts/delivery-estimate.py` (constants in its `C` dict, named below), the live status `scripts/delivery-status.py`, the work log in [the production plan](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md) and [ADR-056](ADR-056-memory-safe-graph-runs.md) / [ADR-057](ADR-057-parallel-renders-and-uploads-in-the-app.md).

**Sources:** the render pods' ComfyUI `/history` (GET, tonight's top, landing, sunlight); the app's `history.jsonl` and `graph-durations.json` / `graph-memory.json` in `~/.config/runpod-pod-manager/`; the bucket listing (`aws s3 ls --recursive --profile panama`) of `returns/BKK/tunnel-v11-edl-2026-11-18/`; the plan's sections 12 to 32; `git log`. The pod `8eyco022cqbswy` (the other session's hand script) answers 404 now, so its chunk times come from my own notes of its history taken earlier today (marked).

## 1. Headline numbers

| Quantity | Value | Where from |
|---|---|---|
| Render, 2x RTX PRO 4500 (116.4 GiB), steady chunks | **about 18 s per processed frame**, 28 to 29 s per delivered frame at chunks of 26 to 28 | top, landing, sunlight histories (chunks 17.7 to 18.4 s per processed frame) |
| Render, 1x RTX PRO 4500 (57.7 GiB), chunks of 11 | about 21 s per processed frame, **about 52 s per delivered frame** | backhalf-b (572 s per 11-frame chunk) |
| Probe (10 frames, first prompt) | **418 to 432 s** | all four measured runs |
| Pod boot to the first prompt | about **13 min** | top: rented 17:07:10, first prompt 17:20:23 |
| Gap between two chunk prompts | 11.6 to 19.7 s | wall minus busy, per pod |
| `dpx_fix` | **not measured**: at most about 2.1 s per frame (upper bound) | backhalf-c: last chunk 17:05:19, `dpx_fix` recorded 17:11:02 for 162 frames, checks included |
| Upload, one job on a quiet pod | **9.8 to 15.5 MB/s** (median about 14) | `history.jsonl` publish jobs |
| Upload, one job on a busy pod | 4 to 6 MB/s | head + hadal job: 13.2 GB at 6.1 MB/s |
| Upload, 5 shots in one job | **33.6 MB/s** (57.4 GB in 1709 s) | the 11-element job, 13:35 to 14:03 |
| One DPX frame (3840x2160, 16 bit) | 49.768 MB | every delivered frame is 49,768,064 bytes |
| Pod price | 1x $0.72/h, 2x $1.44/h | the app's pod list |

Correction to my earlier estimate: the working figure of "about 24 s per processed frame" was right only for the 1x pod's probe; steady state on the 2x pods is about 18 s.

## 2. Render

### 2.1 Tonight's three (app queue, 2x RTX PRO 4500; histories read at 19:13)
Rate model check: chunk = floor(0.6 x RAM / GiB per frame) - 16, at most 50; a chunk processes chunk + 16 frames (8 pad each side).

| Element | Frames | Probe | Chunks | Per-chunk time | s per delivered frame | Busy | Wall | Start to end | Cost (pod 1.44/h) |
|---|---|---|---|---|---|---|---|---|---|
| top | 209 | 426 s (1.55 GiB per frame) | 7 x 28 + 3 | 760 to 878 s (first one slowest) | 28.5 steady; 30.4 overall | 6,362 s | 6,520 s | 17:20:23 to 19:09:04 | about USD 3.0 with boot (pod rented 17:07) |
| landing | 226 | 418 s (1.64 GiB per frame) | 8 x 26 + 8 | 747 to 761 s | 28.9 steady; 29.9 overall | 6,750 s | 6,862 s | 17:19:00 to 19:13:22 | about USD 3.1 |
| sunlight | 212 (206 read at 19:12, last 6 frames running) | 432 s (1.57 GiB per frame) | 7 x 28 + 6 | 785 to 843 s | 28.0 to 30.1 | 6,083 s so far | 6,164 s so far | 17:29:19 to about 19:18 | about USD 2.6 (pod rented 17:26) |

A last chunk of 3 or 8 frames still took 309 and 315 s (a floor of about 300 s per small chunk). Sunlight's first try on a 1x pod failed (RAM guard at 90.5% on a 5-frame chunk, plan section 23): about 20 minutes (17:05 to 17:25) and about USD 0.25 lost.

### 2.2 Earlier elements
| Element | Frames | How | Time | Source |
|---|---|---|---|---|
| backhalf-b | 70 | app, 1x pod, chunks of 11, 7 prompts | probe 428 s; chunks 576, 572, 574, about 573, 463, 267 s; run 3,560 s (59 min), about 52 s per frame; first try killed for memory after 1,232 s | pod history and `graph-durations.json` (3,560.4 s); the 1x pod costs about USD 0.72 for the chunked run and about USD 0.35 for the killed one |
| head (106), hadal (160), backhalf-c (162), sunlight 0-99 | the other session's hand script on a 2x pod, chunks of 50 | between two chunk ends: hadal 20.4 to 20.5 min per 50 frames (about 24.5 s per delivered frame); backhalf-c 23.6 to 23.8 min (about 28.4 s); sunlight 26.7 min (about 32 s) | **UNVERIFIED re-read**: taken from the history of `8eyco022cqbswy` earlier today (the pod answers 404 now); the elements differ in cost per frame |
| The first 11 elements of 21 Nov (Import Round, unchunked graphs) | 43 to 271 | one prompt each, no chunking | whole-graph run times: rain 697 s, platform 372 s, ascent 898 s, splash 708 s, chasm07 2,103 s, dolphin-lowtrack 655 s, 123 f 53 s, 168 b 84 s, c 65 s, d 34 s; 168 a 3,061 s (slow run) | `graph-durations.json` (last successful run of each graph; the pod and card are not recorded: UNVERIFIED) |

### 2.3 What limits it
RAM per frame (1.25 to 1.64 GiB, 2.3 to 2.5 GiB peak) sets the chunk size; the pad makes a chunk of 11 cost 2.5 times its frames and a chunk of 28 cost 1.6 times, so the 2x pods are about 1.8 times faster per delivered frame at the same hourly cost per GPU-second ($/frame about equal). A second GPU does not speed one graph; only more pods (frame ranges, `run_split`) do.

## 3. DPX fix (`dpx_fix`)
- The app records each run only as a completion event in `history.jsonl` (30 runs on 20 and 21 November, `DPX copies with corrected headers`), with no start time, so **its duration is not measured**.
- Upper bound: backhalf-c's last render chunk ended 17:05:19 and its `dpx_fix` was recorded 17:11:02 (162 frames, about 8 GB written, checks and read-back included): at most 5.7 min, **at most about 2.1 s per frame**. The estimator assumes 1.5 s per frame (`DPXFIX_S_PER_FRAME`, ASSUMED) until tonight's top, landing and sunlight runs give a measured value (the history events and the pod give start and end).
- It reads and writes about 50 MB per frame on the volume (corrected copies under `output/_delivery_v11/<clip>/`).

## 4. Upload (publish jobs, `history.jsonl`, bucket listing)
| Job | Elements | Files | GB | Start to end | Rate | Adapter / note |
|---|---|---|---|---|---|---|
| First delivery | 17 elements | 1,770 | 84.9 (91.1 with the sidecars) | 02:50:21 to 04:30:57 (6,036 s) | 15.1 MB/s | one job, one shot after the other, quiet pod |
| 11 elements (14:05) | 087 platform and rain, 123 f, 168 a to d, dolphin-lowtrack, ascent, chasm07, splash | 1,153 | 57.4 | 13:35:04 to 14:03:33 (1,709 s) | **33.6 MB/s** | 5 shots at once; the 53 stray frames were replaced; five earlier attempts that morning failed or were cancelled (0.1 to 3.6 MB/s) |
| backhalf-b | 1 | 70 | 3.5 | 16:43:25 to 16:49:21 (356 s) | 9.8 MB/s | pod adapter, quiet pod |
| head + hadal | 2 | 266 | 13.2 | 17:06:54 to 17:42:49 (2,155 s) | 6.1 MB/s | pod adapter on the other session's busy pod; 3 head frames fell back through this PC |
| backhalf-c | 1 | 156 + 5 | 7.8 | 18:11:22 to 18:23:08 (706 s) | 11.0 MB/s | the first try (5 files, 38 s) was cancelled because the app had picked the busy pod |
| Auto-publish review uploads (20 and 21 Nov) | single reviews, 0.2 to 12 GB | 40 to 390 | | 150 to 2,600 s | 9 to 15 MB/s (the slow ones failed at 1 to 4 MB/s) | `automatic upload` jobs |
| top, landing, sunlight | 3 | about 215 each | about 10.4, 11.3, 10.6 | pending | pending | the first jobs with the merged pod ranking and `parallel_pods` (not measured yet) |

Per element (bucket listing, first to last object written): the 17 first-delivery elements took 135 s (084, 1.8 GB) to 1,287 s (080 a, 5.4 GB) each inside the one job; backhalf-b 328 s, head 1,205 s, hadal 880 s, backhalf-c 872 s.
The effect of parallel pods is **not measured** (the merged code has not uploaded yet); the one parallel data point is the 5-shot job at 33.6 MB/s, about 2.4 times a single stream. *(Superseded by 4.1: the first parallel measurement is in.)*

### 4.1 Datacenter to datacenter: RunPod volume (EU-RO-1, Romania) to the Panama bucket (AWS `us-west-2`)
**The route.** The frames sit on the network volume `a3upg9ey48` in RunPod's EU-RO-1 datacenter (its own S3 API). A publish with the `pod` adapter runs on a pod that has the volume mounted: the pod hashes each file (`sha256sum`) and sends it with a signed `PUT` (`curl`) straight to `s3://bh-panama-exchange-610140802195/returns/BKK/...`. Nothing passes through this Mac. The `pc` adapter is the fallback: volume to this Mac to the bucket, two hops over the home link (used for 3 head frames and the files over 5 GB rule; never for tonight's three).

**Measured, tonight (21 Nov 19:28 to 19:34 Bangkok, three publish jobs running at once, status read at 19:34).**
| Job | Pods used | Rate of the job | Files / GB at 19:34 |
|---|---|---|---|
| landing (226 files, 11.25 GB) | landing + sunlight pods | 10.6 MB/s | 73 / 3.63 |
| top (203 files, 10.10 GB; 6 already there) | top pod | 10.6 MB/s | 49 / 2.44 |
| sunlight (209 files, 10.40 GB; 3 already there) | sunlight + top pods | 10.5 MB/s | 46 / 2.29 |
| **All three together** | 3 pods | **about 31.7 MB/s** | 168 / 8.36 |

- **Per stream the ceiling is 10 to 15 MB/s** wherever it ran (15.1 first delivery, 14 median on a quiet pod, 10.6 tonight), about 0.5 to 0.6 Gbit/s per pod. **Three jobs on three pods gave 3 times one job (31.7 against 10.6)**, so scaling with pods looked close to linear here (efficiency about 1.0; the estimator's 0.9 is the safe side). The earlier 5-shot job gave 33.6 MB/s. Two jobs sharing a pod (top and sunlight both use the top pod; landing and sunlight share the sunlight pod) did not slow each other, so the limit is per transfer, not per pod.
- **A busy pod halves it** (6.1 MB/s on the other session's pod, 4 to 6 MB/s elsewhere): the same reason uploads now rank pods by load.
- **Why per stream is capped is not measured.** The likely cause is the long path (Romania to the US West Coast, one TCP stream per file, so round-trip time limits throughput); that is an inference, not a test. More parallel streams (more files at once on a pod) was not tried and might lift it.
- **Time for a frame:** 49.77 MB at 10.6 MB/s is 4.7 s per frame per stream, so about 11 GB (220 frames) takes about 17.5 min on one stream; tonight's three should all end between 19:47 and 19:50 with the ETA above, after about 20 min.
- **Cost:** pod time only (the pods are already running for rendering); no data-transfer charge was seen in the app's spend figures, but RunPod egress and AWS ingress pricing were not checked.

**The other direction (bucket to volume, `panama_pull` / Import Round).** **Not measured in this document**: no pull was run on 20 or 21 November. Earlier pulls (the `brynley-comfy-2026-10-23` round, about 14 GB) are in the app history but were not timed here. The estimator keeps the same 12 MB/s per stream as an assumption (UNVERIFIED) until a pull is timed (start and end of a `panama_job`).

**For the estimator.** Use 10.6 MB/s per stream (tonight) to 12 (all-day median) for one job; for `k` jobs on distinct pods use `k x 10.6`, up to the pods the account can run (three measured). `scripts/delivery-estimate.py` still uses 12 MB/s and efficiency 0.9; both stay conservative.

## 5. Delivery timeline (render start to manifest in the round)
| Element | Render | Fix | Upload and manifest | In the round |
|---|---|---|---|---|
| The first 17 | earlier work, 20 Nov | 20 Nov | 21 Nov 02:50 to 04:31 | 04:31 (last manifest, cgi-042) |
| The 11 | Import Round, 21 Nov early morning | before 13:00 | 13:35 to 14:03 | 14:13 (manifests) |
| backhalf-b | 15:22:48 to 16:23:12 (1 h) | about 16:30 | 16:43 to 16:49 | 16:49:10 |
| head | other session's script, 14:2x to 14:48 | about 17:04 | 17:07 to 17:27 | 17:27:19 |
| hadal | other session, 15:0x to 15:53 | about 17:04 | 17:27 to 17:42 | 17:42:24 |
| backhalf-c | other session, 15:50 to 17:05 | 17:11:02 | 18:11 to 18:23 | 18:22:54 |
| top | 17:20:23 to 19:09:04 (1 h 49 min) | pending | pending | pending |
| landing | 17:19:00 to 19:13:22 (1 h 54 min) | pending | pending | pending |
| sunlight | 17:29:19 to about 19:18 (1 h 49 min) | pending | pending | pending |

The render and fix columns of the first 17, the 11, head, hadal and backhalf-c are approximate (end times of chunks and history events; the start times of the other session's chunks are inferred from chunk length): **UNVERIFIED** to the minute. top, landing, sunlight and backhalf-b are read from the pods' histories.

**The whole round:** the first real-round upload was 21 Nov 02:50 (test rounds on 20 Nov from 13:08); 32 of 35 targeted elements were in by 18:23 on 21 Nov; the last three are expected about 19:50 (estimate). f23 is deferred.

## 6. How to estimate (the formulas; `scripts/delivery-estimate.py` implements them)
- **Chunk size** = min(50, floor(0.6 x RAM GiB / GiB per frame) - 16). 2x pod (116.4 GiB) at 1.55 to 1.64 GiB per frame gives 26 to 28; 1x pod (57.7 GiB) at 1.25 gives 11 (these match the planner's choices).
- **Render per range** = probe 427 s + sum over chunks of ((chunk + 16) x SPP + 15 s), small last chunks floor at 300 s, plus pod boot 780 s. SPP = 18.0 s (2x) or 21.2 s (1x) per processed frame (`C['SPP']`). With K frame ranges on K pods the render time is that of one range of frames/K (`run_split`); ranges that share a pod run one after the other.
- **dpx_fix** = frames x 1.5 s (`C['DPXFIX_S_PER_FRAME']`, assumed).
- **Upload** = frames x 49.768 MB / (12 MB/s x (1 + 0.9 x (pods - 1))) (`C['UPLOAD_MBPS']`, `C['PARALLEL_EFFICIENCY']`; the parallel efficiency is assumed).
- **Total** = render, then fix, then upload (they can overlap across elements: while one element uploads, the next renders).
- **Cost** = render pods x render hours x $/h.
- **Checks against measured:** top 209 frames, chunk 28: estimate 119.5 min against 121.9 min measured (rented 17:07:10 to done 19:09:04); landing 226, chunk 26: 128.2 against 126.3 min; backhalf-b 70 frames, 1x, chunk 11: 74.3 min against about 72 min (59 min run plus boot).

### Worked examples (output of `python3 scripts/delivery-estimate.py`)
```
f23 as ONE run on one 2x pod (--frames 633 --gpu 2 --pods 1)
  render 327.8 min (5.46 h)  dpx_fix 15.8 min  upload 31.5 GB at 12.0 MB/s 43.8 min (0.73 h)
  TOTAL 387.4 min (6.46 h)   pod cost about USD 7.87

f23 as THREE ranges on three 2x pods, upload on 3 pods (--frames 633 --gpu 2 --pods 3 --range-split 3)
  render 118.4 min (1.97 h)  dpx_fix 15.8 min  upload at 33.6 MB/s 15.6 min
  TOTAL 149.9 min (2.50 h)   pod cost about USD 8.53
```
The upload of f23's 31.5 GB alone: one pod at 12 MB/s 43.8 min; three pods at 33.6 MB/s 15.6 min (assumed efficiency 0.9). Splitting costs about the same in pod hours (USD 8.5 against 7.9) and finishes 4 hours earlier.

## 7. Filled in (tonight, 21 Nov, Bangkok time)
- **Upload, three parallel jobs, S3 only, pod adapter:** landing `publish-mwqdwb6n-2` 19:28:27 to 19:48:45 (20 min 18 s, 226 files, 10.48 GB sent, 9.3 MB/s average); top `publish-mwqdyu4b-4` 19:30:25 to 19:49:52 (19 min 27 s, 203 files sent + 6 already there, 9.41 GB sent, 8.7 MB/s); sunlight `publish-mwqdz3z3-5` 19:30:38 to 19:50:36 (19 min 58 s, 209 + 3 already there, 9.69 GB sent, 8.7 MB/s). **Together about 31.7 MB/s at 19:34**; the whole delivery of 31.6 GB took 22 min from the first job's start to the last manifest (19:50:20). The 10 to 15 MB/s per stream ceiling held, and rates drifted down from 10.6 to 9.4 MB/s over the 20 minutes.
- **Element manifests written:** landing 19:48:31, top 19:49:25, sunlight 19:50:20; `RETURN-MANIFEST.json` reached 35 items at 19:50:35 (the hashing and manifest step took about 1 min after the last byte for each).
- **`dpx_fix`:** ran in parallel on the three render pods (one each) and finished by about 19:27; **not timed separately** (the app records only the completion event). The render ended 19:18 and the uploads started 19:28:27: about 10 min for the frame check, the three `dpx_fix` runs and starting the jobs, of which `dpx_fix` was at most that.
- **A lost 3 minutes:** the first top and sunlight publish jobs (19:28) were cancelled because the app had added the foreign pod; re-run at 19:30.
- **Render pods (price USD 1.44/h each):** top created 10:07:10 UTC, stopped by the system 12:55:12 UTC (about 2.8 h, about USD 4.0); landing created 10:07:07 UTC, still running at 12:57 UTC (uptime 2.76 h, about USD 4.0 so far); sunlight created 10:26:18 UTC, running (2.50 h, about USD 3.6 so far). Those are estimates from uptime x price (the app's spend is not split by job); landing and sunlight keep billing until stopped, about USD 2.9 per hour together. Pod hours of the renders alone (first chunk to last): top 1 h 49, landing 1 h 54, sunlight about 1 h 49.
- **For the estimator:** keep 12 MB/s and 0.9 for one pod; three pods at once gave 3 x 9 to 10.6 = about 28 to 32 MB/s, so `PARALLEL_EFFICIENCY` can be 1.0 up to three pods (measured); f23 over three pods (31.5 GB) should take about 17 to 19 min to upload at that rate.
