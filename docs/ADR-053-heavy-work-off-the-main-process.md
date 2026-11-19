# ADR-053: Heavy work off Electron's main process: Web Worker for decoding, worker threads for scans, and the core in a utility process

**Date:** 2026-11-19
**Status:** Proposed. Nothing is built; the first step is a measurement, then the phases below.
**Context from:** Lucas ("can electron use multiple node processes?"), after the beach ball on choosing a mounted volume (v1.5.2, a synchronous folder listing), the earlier rule "make sure downloads are async so we don't block our main thread", and the load-sensitive tests that guard the loop (the 50,000-object reconcile and the 2,000-path feed that must hold the event loop under 50 ms).
**Touches:** ADR-005 (a TypeScript core, no server), ADR-046 (the journal, reconciler and pull controller), ADR-048 (renders, the DPX header and frame work), ADR-050 (the publish plan and the backfill scan), ADR-051 (jobs and events), ADR-052 (retries).

## Context

Electron is several processes already: one **main** process (Node), one **renderer** per window (Chromium plus the page), and it can start more. In this app:

- **The whole core runs inside the main process** (`electron/core.cjs` loads `libs/core`; every `ipcMain.handle('core', …)` call, every controller timer (Auto sync's 30 s pull and 5 minute reconciler, the idle watch, the pod and queue watches), every job registry (syncs, renders, publish, backfill) and the MCP host live there). The same process owns the windows and the `podfile://`, `s3file://` and `localfile://` protocol handlers, so if the main thread stalls, **the window stops responding** (the beach ball).
- **The heavy external work is already in other processes**: ffmpeg, aws, rsync, ssh and du are `spawn`ed (async, streamed). That part is right.
- **The JavaScript between those calls is not**: listing and diffing tens of thousands of S3 objects (the reconciler, the backfill scan and its inventory CSV), building a 20,000-path plan, hashing, JSON of large listings, the journal feed. Today it stays smooth only because the code yields every 500 items and avoids synchronous calls (ADR-011, the async rules, a static test and a lag test). That works, but it is a discipline each new feature must remember, and it fails silently on a slower machine or a bigger volume.
- **In the page**, the DPX decode of a 4K frame (50 MB) and the downscale for a preview or the viewer run on the renderer's main thread (no Web Worker is used; the page uses `createImageBitmap` and canvas). A preview batch decodes one frame at a time and the viewer's cache decodes up to 4, so the page can stutter while it works.

## Options
| | What | Good | Bad |
|---|---|---|---|
| **A. Status quo with rules** | async only, yield every 500, static and lag tests | nothing to build | a rule to remember; a faster-growing volume or a slower PC still hurts; a core crash takes the window with it |
| **B. Web Worker for the DPX decode** (page) | frame decode and downscale off the page's main thread | the viewer and the preview batch stop stuttering; small, local change | only the page's work |
| **C. `worker_threads` for the heavy scans** (main) | reconciler diff, backfill scan and inventory, plan expansion, hashing run on another thread of the same process, results by message | removes the biggest JS loads from the loop; no process boundary for protocols or timers | still one process (a crash is shared); structured clone cost of big results |
| **D. The core in an Electron `utilityProcess`** | the whole core (IPC table, controllers, registries, MCP host) runs in its own process; main keeps windows, protocols, dialogs and the IPC proxy | a stall or a crash in the core cannot freeze or kill the window (the supervisor restarts it); one clean boundary; the MCP host and watches are isolated | the biggest change: every `core:*` call becomes a message round trip; results are copied (paginate big ones); the protocol handlers and the sync job streams need a channel; debugging and tests need adapting |

## Decision (proposed)
Take them in order of payoff over cost, each behind the same public calls so the page and the MCP tools do not change:

1. **Measure first.** With the real app and the real volume, record the main thread's longest stall during (a) a backfill scan of the volume's `output/`, (b) a reconcile of a large listing, (c) a publish plan of 20,000 paths, and (d) a preview batch and a viewer cache run (the page's longest task). A number each. If none passes about 100 ms, stop at A and keep the rules.
2. **B: DPX decode in a Web Worker** (`src/utils/dpx.worker.js`): the page posts the frame bytes (transferred, not copied) and gets back the downscaled pixels or an ImageBitmap; the preview batch and the viewer cache use it with a small pool (2 to 4, from the existing streams setting). The pure functions in `utils/dpx.js` stay and are what the worker runs, so the unit tests do not change.
3. **C: worker threads** for the scans that showed up in the measurement: the reconciler diff and snapshot compare, the backfill scan and inventory, the publish plan expansion. Each takes a request and returns a result in pages (never one 50,000-row message); progress is a message. The aws and ssh calls stay `spawn`s in the main thread's code or in the worker (either works: they are async).
4. **D: the core in a `utilityProcess`**, as a later phase and only if the measurement or real incidents justify it. The design: `electron/core.cjs` keeps the same `TABLE`; in the main process each entry becomes a proxy that posts `{ id, ns, fn, args }` over a `MessagePort` and awaits `{ id, ok, value | error }`; `libs/core` is loaded in the utility process, which also owns the timers, registries and the MCP host; the sync run's event stream and the log streams are pushed as messages the main process forwards to the window (`core:logs`, `core:sync`, `core:events`); the protocol handlers keep reading files directly where they only need a path check (`localfile://`) and ask the core for the rest (`s3file://` signing, `podfile://` addresses) with a request over the port; a supervisor restarts the process if it dies and tells the window ("the core restarted"), jobs in flight are marked `interrupted` (the registries already do this for a restart). Large results are paginated at the core's API (the listings already are, by prefix and cap).

## Consequences
- The window stays responsive whatever the core is doing; a crash in a job no longer closes the app (phase D).
- More code paths: messages instead of function calls, a version handshake between main and the utility process, and the real-Electron suite and the IPC test must run through the proxy.
- Memory use rises a little (a second V8 instance); startup is slightly slower.
- The lag tests and the "no synchronous calls" static test stay; they become a second line of defence, not the only one.
- The page's DPX work gets smoother first (phase B), which is what the Generate and viewer windows feel.

## Decisions needed (Lucas)
1. **Measure first, then decide** (proposed), or go straight to the Web Worker for DPX decode because it is cheap and clearly useful?
2. **Phase D (the core in a utility process):** worth doing now, or only if the measurements and incidents say so? (Proposed: only then.)
3. **Pool size** for the decode workers: reuse the viewer's streams setting (default 4)? (Proposed: yes.)
