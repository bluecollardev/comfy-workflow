# CANALV2 Tunnel V11: which runs pushed the memory limits, and the error of every failure

**Date:** 2026-11-21. **Part of:** [the production plan](CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md) (sections 14 and 15) and [the delivery report](CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md). **Decision it led to:** [ADR-056](ADR-056-memory-safe-graph-runs.md). **Sources:** RunPod's own system log of each pod (`[system]` lines, UTC; the full logs are in `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`) and the app's History (`history.jsonl`, 214 failed `base_v008` graph runs, times UTC).

## 1. How to read the errors
| What the app showed | What it was |
|---|---|
| `ComfyUI answered HTTP 502 for /history/<id>` (26 runs) | **The container was killed for memory** (system log: `exit code 137 ... triggered memory limits (OOM)`); ComfyUI restarts and forgets the prompt. The recovery text "a transient problem... retried at most twice, 5 then 20 minutes apart" is wrong for this case: a retry on the same pod meets the same limit. |
| `the pod lost the prompt (restarted: out of memory?)` (Mac-side runner) | The same kill, seen by the runner: the prompt is neither in the queue nor in the history after the pod restarted. |
| `ComfyUI answered HTTP 502 / 404 for /api/userdata/workflows...` (124 runs) | The graph fetch at the start of a graph: ComfyUI not up yet (cold pod) or restarting right after a kill. |
| `The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded` (53 runs) | **Not memory.** ComfyUI's page takes 80 to 160 s to be ready on a fresh pod and the conversion gave up after 60 s. |
| `The operation was aborted due to timeout` (11 runs) | The app's own poll of a busy ComfyUI gave up (fixed: it keeps asking for up to 3 minutes); not memory by itself. |

## 2. The container RAM limit differs by pod (so the same graph passes on one and dies on another)
Read from the system log (`high memory utilization - used / limit`) and from ComfyUI's startup line (`Total RAM`):
| Card | Container RAM limit |
|---|---|
| RTX PRO 4500 (one pod) | 27.94 GiB (pod `2f3nrnl70593lf`), 57.7 GiB (others) |
| RTX 5090 | 55.88 GiB (`2uhkv8qexsx5ui`, `o74wl0wesb887e`), 85.68 GiB (`ftnr9m237wrdtk`) |
| RTX PRO 6000 | 87.54 GiB (`1qo9ndp1cbq7u8`, `3svm5sllhfito3`) |
| RTX PRO 6000 WK | 262.6 GiB (`ej3q8v0srppy63`) |
| 2x RTX PRO 4500 | 116.4 GiB (`v2283n9nfof484`) |
| 4x RTX PRO 4500 | 232.8 GiB (`wcw7rzxp622iou`) |

The limit comes with the host and the GPU count, not with the VRAM, and it varies even for the same card.

## 3. The runs that pushed or hit the limit (system log evidence)
| UTC | Pod, card, limit | Graph running (app History) | What the system log says | What the app showed |
|---|---|---|---|---|
| 2026-11-20 17:55 | `o74wl0wesb887e`, RTX 5090, 55.88 GiB | archival-087 | high memory 46.29 GiB (82 %) | (this graph finished later) |
| 2026-11-20 18:25 to 18:28 | `2f3nrnl70593lf`, RTX PRO 4500, 27.94 GiB | archival-087 | high memory 21.54 to 23.63 GiB (77 to 84 %), rising | (no kill in the saved log) |
| 2026-11-20 18:05:59, kill 18:17:09 | `2uhkv8qexsx5ui`, RTX 5090, 55.88 GiB | photoreal-013 chasmfast07 | high memory 43.3 GiB (77 %) at 18:08; `exit code 137 ... OOM` at 18:17:09 and 18:17:11 | HTTP 502 for /history/27498fd5... |
| 2026-11-20 18:07:13 to 18:17:17 | `ftnr9m237wrdtk`, RTX 5090, 85.68 GiB | creature-266 breach-alt1 (twice, 18:07:13 and 18:14:54) | 74.73 GiB (87 %) at 18:09:42, `137` at 18:10:01; 77.91 GiB (90 %) at 18:16:38, `137` at 18:17:15 and 18:17:17 | HTTP 502 for /history/d750e952... and /history/366c7627... |
| 2026-11-20 19:40:36 | `ej3q8v0srppy63`, RTX PRO 6000 WK, 262.6 GiB | photoreal-013 f23 | high memory 207.3 GiB (78 %) steady 20:04 to 20:07 | HTTP 502 for /history/005c3d2a... |
| 2026-11-20 23:03:05, 23:27:16, 23:43:30, 23:48:26 | `1qo9ndp1cbq7u8`, RTX PRO 6000, 87.54 GiB | creature-266 breach-alt1 (four times) | **84.71 GiB (96 %) at 23:06:49, 86.8 GiB (99 %) at 23:07:18, `137` at 23:07:46**; `137` at 23:28:27; 70.84 GiB (80 %) at 23:18:11 | HTTP 502 for /history/c4afef38..., ac2246bf..., 21a2a7a5..., 42817299... |
| 2026-11-20 23:48:47 and 2026-11-21 00:21:29 | `1qo9ndp1cbq7u8` | photoreal-013 f23, then hadal | (same pod, container restarted by the kills above) | HTTP 502 for /history/3854fd9a... and /history/d36fa727... |
| 2026-11-21 02:23 to 02:33 | `xrvnto15sdq32x`, RTX PRO 4500, 57.7 GiB | photoreal-013 hadal, sunlight, top, landing, one after the other, each killed about 2 minutes after the prompt | ComfyUI restarted each time (`Starting server` at 02:24:43 and 02:25:11; no `[system]` memory line was captured in the tail) | `the pod lost the prompt` x4 |
| 2026-11-21 02:28 to 02:51 | `3svm5sllhfito3`, RTX PRO 6000, 87.54 GiB | photoreal-013 hadal (22 minutes) | **76.35 GiB (87 %) at 02:49:50; `exit code 137 ... OOM` at 02:50:07**; RAM was still rising | `the pod lost the prompt` at 02:51:22 |
| 2026-11-21 02:23 to 02:54 | `519be4ha35a35m`, RTX PRO 4500, 57.7 GiB | cgi-072 head (31 minutes) | `pod_ram`: **55.2 of 57.7 GiB (95.6 %)** at about 02:52 | `the pod lost the prompt` at 02:54:32 |
| 2026-11-21 05:24 to 05:36 | `wcw7rzxp622iou`, 4x RTX PRO 4500, 232.8 GiB | photoreal-013 f23 (633 frames) | 40.4 GiB at 05:33 (ComfyUI `system_stats`); **`OOM` at 05:34:41, 05:34:47, 05:34:52, `exit code 137` at 05:34:58** | `the pod lost the prompt` at 05:36:41 |
| 2026-11-21 05:20 to now | `v2283n9nfof484`, 2x RTX PRO 4500, 116.4 GiB | photoreal-013 hadal | 39.6 GiB at 05:33, 56.7 GiB at 05:43; running | (still running when this was written) |

Read: a graph that dies on 57.7 GiB (hadal, cgi-072 head) came within 4 GiB of the limit on a 57.7 GiB pod after 31 minutes and passed 76 GiB on a 87.5 GiB pod; f23 went from 40 GiB to the 232 GiB limit in about a minute. The memory is taken by the stages that work on the whole clip (merge, decode, post-process, colour, write), not by the chunked SeedVR2 sampling.

## 4. The errors of each of the 8 graphs that are not generated
Count of failed attempts in the History per graph and kind (all attempts, all pods, 2026-11-20 and 21):
| Graph | Attempts failed | Conversion timeout (60 s) | Graph fetch 502/404 | 502 on /history (killed) | Poll timeout |
|---|---|---|---|---|---|
| photoreal-013 hadal | 8 | 3 | 2 | **3** | 0 |
| photoreal-013 sunlight | 4 | 2 | 2 | 0 | 0 |
| photoreal-013 top | 6 | 2 | 3 | 0 | 1 |
| photoreal-013 landing | 7 | 2 | 4 | **1** | 0 |
| photoreal-013 f23 | 5 | 1 | 1 | **3** | 0 |
| cgi-072 head | 15 | 7 | 6 | **1** | 1 |
| cgi-072 backhalf-b | 16 | 7 | 6 | **1** | 2 |
| cgi-072 backhalf-c | 15 | 7 | 6 | **2** | 0 |

Most failed attempts never reached the graph (cold pod, page not ready); the **kills** are the ones the history shows as 502 on `/history`, and the Mac-side runs added `the pod lost the prompt` (hadal x2, sunlight, top, landing on 59 GiB; hadal on 87.5 GiB; f23 on 232.8 GiB; cgi-072 head on 57.7 GiB). A graph with no kill listed (sunlight, top) was never held long enough to be killed in the app's History, but was killed in the Mac-side runs.

Exact error strings (for searching the logs): `ComfyUI answered HTTP 502 for /history/<prompt id>`, `ComfyUI answered HTTP 502 for /api/userdata/workflows%2Fbase_v008%2F<shot>%2F<graph>.json`, `ComfyUI answered HTTP 404 for /api/userdata/workflows...`, `The pod could not convert the graph: Page.wait_for_function: Timeout 60000ms exceeded.`, `The operation was aborted due to timeout`, `Dispatch paused: 3 graphs in a row (...) failed`, `the pod lost the prompt (restarted: out of memory?)`.

## 5. Where to look
- Every pod's full log, one section per pod and per run: `~/.config/runpod-pod-manager/pod-logs/POD-LOGS-2026-11-21.md`. Pods stopped before the app saved them have none (the 4x pod's last log is among the lost).
- The app's History: `~/.config/runpod-pod-manager/history.jsonl`; failures with their recovery text: `failures.jsonl`.
- What to do about it: [ADR-056](ADR-056-memory-safe-graph-runs.md) (probe, chunk by default, live guard, RAM by GPU count).
