# Running a shot in chunks (keeping system RAM down)

**Problem.** A container that runs a long frame sequence can use all of its system RAM and be killed by the
kernel: `container is unhealthy: triggered memory limits (OOM)`, exit code 137. On 2026-11-16 one hit
223.7 GiB of 232.8 GiB and died. A full DPX/EXR sequence loaded as one float32 image batch is hundreds of GB
(4K, 3 channels, 4 bytes: about 100 MB a frame, so 2,000 frames is about 200 GB), before any model is loaded.

**Two layers of fix.**

1. **Flags (done, v1.2.5).** Every pod the app creates starts ComfyUI with `--cache-lru 1 --disable-smart-memory`.
   Node outputs are dropped once used and models are unloaded after a run, so RAM stops piling up between
   runs and shots. The flags do not shrink a single batch that is already too big. A pod's own `COMFY_ARGS`
   replaces them; add `--lowvram` for a small card (it saves VRAM, not system RAM).
2. **Chunks (this page).** Never hold the whole shot in RAM. Run it as consecutive frame ranges, write each
   range to disk, then run the next.

## The flags

| Flag | What it does | Why we use it |
|---|---|---|
| `--cache-lru 1` | Keeps the output of only the one most recent node in ComfyUI's cache; older outputs are freed. | By default ComfyUI keeps every node's output so a re-run skips unchanged nodes. On a video graph that means every intermediate batch stays in RAM. |
| `--disable-smart-memory` | Unloads models after a run instead of keeping them resident in case the next run needs them. | The LTX 2.3 22B weights, the Gemma text encoder and T5 add tens of GB each if they all stay loaded. |
| `--lowvram` (not on by default) | Offloads model parts from the GPU. | It saves VRAM, not system RAM, and slows a big card (PRO 6000, 96 GB). Set it only on a small card. |
| `--cache-none` (not on by default) | Caches nothing. | The strictest option. Every run recomputes everything, including unchanged nodes. Use it if `--cache-lru 1` is still not enough. |

**Where they are set.**
- The app adds `COMFY_ARGS=--cache-lru 1 --disable-smart-memory` to every pod it creates
  (`DEFAULT_COMFY_ARGS` in `apps/runpod-dashboard/libs/core/src/mounts.ts`). This works with the pinned image as it is.
- The image entrypoint (`apps/comfy-app/docker/entrypoint.sh`) and `docker/compose.yml` use the same default when
  `COMFY_ARGS` is not set at all, so a local or Compose run gets it too.
- To change them for one pod, set `COMFY_ARGS` in that pod's environment. Setting it replaces the default: use
  `COMFY_ARGS=--lowvram` for a small card, or `COMFY_ARGS=` (empty) for no flags.
- Pods that were already running keep their old flags. Recreate them.

**What they cannot do.** They free memory *between* nodes and runs. They do not shrink one batch that is already
too big: a 2,000-frame sequence loaded in one node still needs all of it at once. That is what chunking is for.

## How to chunk

The reader nodes already take a range, and frames are read on demand:

- `BH_ReadSequence` (ComfyUI-BincPlateIO) has `first_index` and `count`; `count = 0` means every frame, which
  is the dangerous setting.
- `BincSeqToImage` turns the sequence into an image batch for `first_frame` .. `last_frame` (served record
  numbers, the file names). It fails loudly on a gap or a size change, so a bad range is an error, not a
  silent wrong result.
- The writers (`BincWritePlateDPX`, `BincWriteGenDPX_v002`) write each frame by its number, so chunks land in
  the same folder without clashing.

**Procedure for a long shot**

1. Pick a chunk size. Start at **100 frames**; 50 for 4K with SeedVR2 or LTX. RAM is roughly
   `chunk x frame size x copies`, and a graph holds two to four copies (in, working, out).
2. Run `first_frame..first_frame+N-1`, check the output frames exist, then the next range. Do not overlap
   ranges: the writers would write the overlapped frames twice. A model that needs temporal context (SeedVR2,
   LTX) should use its own temporal window inside the chunk.
3. Watch the container's memory in Dozzle. It should fall back between chunks. If it only climbs, restart
   ComfyUI between chunks and report which node was running.

SeedVR2 also has its own batch and temporal-chunk settings in the node; set them to the same size as the chunk.
(This repo does not hold that node, so check its widgets on the pod.)

## The tools (built, v1.2.6)

All three ways of automating it are in the app, over MCP and the CLI.

**1. Queue job files: `chunk_plan`, `./start.sh chunk plan`**

```bash
./start.sh chunk plan --first 92810 --last 93809 --chunk 100                 # print the ranges
./start.sh chunk plan --first 92810 --last 93809 --chunk 100 \
    --project restore --shot cgi-042 --graph-path rounds/r1/cgi-042/graph.json   # and write queue/restore/in/<job>.md per chunk
```

One brief per chunk in `queue/<project>/in/`, named `<shot>_chunk-NofM_<date>.md`, each with its range and the exact
`run_shot_chunked` call. It never overwrites a file and never writes to `queue/canalv2/` (that is Binc's queue).

**2. Run a shot in chunks: `run_shot_chunked`, `chunked_job`**

`run_shot_chunked { pod_id, path | graph, first, last, chunk, ram_guard_pct }` runs the chunks one after another on a
running pod. For each chunk it sets the range in the graph, queues it, waits for it, then tells ComfyUI to free
memory (`/free`: unload models, free cache) and reads the container's RAM before the next. It returns a job; follow it
with `chunked_job` (`cancel: true` interrupts the running chunk and skips the rest). Every chunk is in the History.

- A graph with **BincSeqToImage** takes frame **numbers** (the file names): `first_frame`, `last_frame`.
- A graph with only **BH_ReadSequence** takes **indexes**: `first_index`, `count`.
- A graph with neither cannot be chunked: the job fails saying so. Use `run_pod_workflows`.
- No overlap: the writers would write the overlapped frames twice. A model that needs temporal context (SeedVR2, LTX)
  should use its own temporal window inside the chunk.
- Locked shots are refused, as in `run_pod_workflows`.

**3. The RAM guard: `pod_ram`, `ram_guard_pct`**

The guard reads the **container's** memory from its cgroup over SSH (cgroup v2 `memory.current` / `memory.max`, else v1).
It does not use ComfyUI's `/system_stats` or psutil, which report the host's RAM, not the container's limit. The pod card
shows the same figure (`ram_gb`, `ram_source: cgroup`, `core/src/podram.ts`), read in the background at most once a minute
per running pod (five minutes after a failure) and left out when unknown. RunPod's `memoryInGb` is not shown as the limit:
it was never checked against the observed 57.7 / 116.4 / 87.5 GiB. While a chunk
runs it is read every 10 s. Past `ram_guard_pct` (default **85**):

1. the chunk is interrupted and ComfyUI is told to free memory;
2. the job stops (`state: stopped`) with the chunk, its frames, and the frame to resume from: *"RAM guard: the container is at 91% (212 GiB of 233 GiB) ... Run again from frame 101 with a smaller chunk."*

It is also read after each chunk's free. If memory did not fall, the next chunk is not started, because it would pile
on top of what is still held (a leak, or a node that caches); the job stops and says to restart ComfyUI and continue
from the next frame.

If the pod has no memory limit, or SSH cannot reach it, the guard is off and the job says so (`ram_note`).
`pod_ram { pod_id }` (CLI: `./start.sh chunk ram --pod-id ID`) shows the reading and whether it is over the limit.

## Tests

- `libs/core/tests/chunking.test.ts` (in `./start.sh test`): the plan, the range in the graph, the memory parser, the guard
  stopping a run (over the limit while running; not falling after a free), cancel, the job files. A fake ComfyUI and fake RAM.
- `./start.sh chunk-live` (spends a few minutes of the cheapest card; needs `RUNPOD_API_KEY`): one real pod; reads its real
  container RAM; writes twelve 64x64 DPX frames; runs them as three chunks of four through BH_ReadSequence, BincSeqToImage and
  SaveImage; then proves the guard by giving it a limit of 0.1%. It never uses memory to do that: an idle container already holds
  about 0.8%, so the guard trips on the first reading. The pod is deleted at the end (`RUNPOD_LIVE_KEEP=1` keeps it).
