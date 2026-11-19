# ADR-049: The Previews modal, the preview cache, and what scrolling may cancel

**Date:** 2026-11-18
**Status:** Accepted and built (v1.4.2 scrolling fix, v1.4.3 Previews modal). The Previews modal shipped without tests (Lucas's call for that patch only); the tests were written in the next patch.
**Context from:** Lucas ("Load Preview or Load all previews, issue is when scrolling, the items lose state or something, and the preview generation cancels"; "make sure if cached, it is stored persistently locally in a cache so when i reopen the output i don't have to regenerate. have a button in modal to clear the cached sequence / preview"; "have a single button with a modal that allows load all previews and build sequences options").
**Extends:** ADR-037 (the DPX viewer), ADR-045 (outputs sources; automatic loading removed 2026-11-17: "let's click the button, this causes too much loading"). **Sits beside:** ADR-048 (rendering whole sequences into playable proxies).

## Context

A DPX sequence tile shows the first frame as a small preview. One frame is about 50 MB over RunPod's proxy, so nothing loads by itself (`AUTO_CAP = 0`): a click on a tile loads one preview, "Load all previews" loads the rest. Three things went wrong in use:

1. **Scrolling cancelled work you asked for.** A tile that scrolled out of view aborted the preview it was making and went back to "Load preview". Scrolling back asked again as an *automatic* request, which stops at "click to load", so a click on Load preview or Load all was lost the moment you scrolled.
2. **"Load all" only reached tiles that had already been on screen.** Tiles never scrolled to were still idle and were not part of it.
3. **There was no single place** for the preview actions, and the cache's size and clear button were separate from them.

## Decision

### 1. What scrolling may cancel
- **Only an automatic preview** is dropped when its tile scrolls away (there are none by default now, but the rule stays for the cap).
- **A preview you asked for is never cancelled by scrolling**: a click on one tile, or Generate all. The tile remembers it was asked for (`wanted`).
- **After "Generate all previews"** every tile that comes into view later loads by itself while the Outputs window stays open (`previewBus.loadAll`); it resets when the window opens or closes. Closing the window cancels what is still running (`abortAll`), as before.

### 2. One Previews button, one modal
- The top bar has **one Previews button** (it shows progress while a batch runs) that opens the **Previews modal**. The modal holds the options:
  1. **Generate all previews** (was "Load all previews"): the first-frame preview of **every** sequence in the window, one at a time, including ones never scrolled to. A sequence already in the cache is a hit and costs **no download**. It shows done of total, a progress bar, ready / waiting / failed counts, and **Stop** (nothing restarts when you scroll afterwards). It ends by itself. A failed tile is retried by the next batch.
  2. **Render sequences** (ADR-048): whole sequences into playable proxies, on the pod or on this PC.
- The cache line ("N previews cached", **Clear preview cache**) stays in the top bar.

### 3. The preview cache persists
- Finished previews are kept in the browser storage of the app (IndexedDB `pod-manager-thumbs`), so they **survive closing the window and restarting the app**; a cached preview shows at once with no fetch.
- The key is **volume + folder + first file**, never the address that served it, so a running pod, a stopped pod's saved record and the S3 volume source share one preview. A known byte size that differs from the saved one is a miss (the file changed).
- A frame decoded as black or flat is cached as an "empty" verdict, not as a black square.
- **Bounded:** the newest 500 are kept; the oldest are evicted. **Clear preview cache** empties it. Previews are small (about 30 KB each).
- **Limits (stated, not hidden):** the dev window (`localhost:5173`) and the installed app have different storage origins, so each keeps its own cache. With more than 500 sequences the oldest are dropped; raising the cap is cheap (2,000 previews is about 60 MB) and is left as a setting for later.

## Consequences

- A click is never lost to scrolling, and Generate all means all.
- Previews are not regenerated on reopen; clearing is one click.
- Tests: `e2e/outputs-dpx.spec.js` (a slow preview survives scrolling to the end and back; Generate all ends with every tile loaded, each frame fetched once; the batch cases of the Previews modal).

## Amendment to ADR-047 (2026-11-18, v1.4.1)

The pod limit ("Number of Pods") is **not** the dollar cap. It was only shown, and only sent, when the cost cap was on, so with the cap off the queue started one pod per shot (about 20 at once, ComfyUI answering HTTP 502 on overloaded or not-yet-ready pods). The field now always shows and its value is always sent; only the cost-cap field depends on the cap. The core's rule is unchanged: the setting that switches the cap off removes the limit for callers that send no number (an agent over MCP).

## Amendment 2026-11-19: the preview batch is a job on the Queue
**Generate all previews** is a long job, but its state lives in the Outputs window (`previewBus`: counts, the batch flag and the totals), so closing the Outputs window cancels it (`abortAll`) and the Queue does not show it. **Decision (see ADR-051 section 9):** the preview batch becomes a store-level job like the render job (so closing the window does not stop it unless the person presses Stop), and it is listed on the **Queue** (*Generations*): "Previews: 12 of 40, 1 failed", Stop, and when done a summary. Its start and end are events (`preview.batch_done`, with the failed count). The per-tile click-to-load behaviour, the persistent cache and the "scrolling never cancels what you asked for" rule are unchanged.

