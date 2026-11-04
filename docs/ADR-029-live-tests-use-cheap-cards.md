# ADR-029: Tests that create real pods use the cheap cards, for now

**Date:** 2026-11-04
**Status:** Accepted **for now** (Lucas: "use cheap cards for these tests for now").
**Extends:** ADR-026 (the big cards are explicit-only), ADR-024 (pull pods take the cheapest free card).

## Context

On 2026-11-04 two big pods (an H100 at USD 3.99/h and an H200 at 5.29/h) were made to work. A test of the pod flows (creating a pod, pulling a BH round onto the volume, a sync, an import over MCP) does not need a big card; it needs a pod that boots, answers, and is deleted. The USD 100 cap covers a day of tests on small cards and about eleven hours of one H200.

## Decision

1. **A test that creates a real pod asks for `auto`** (the cheapest of the ten table cards in stock, which never falls to an explicit-only card, ADR-026) **or a small card by name** (`rtx2000ada`, `a4000`, `l4`). Never an L40S, A100, H100, H200 or a Blackwell card.
2. **Small and short:** the pod is named `ComfyUI-Test-<what>-<date>`, gets an idle stop of 5 minutes at most, a 20 GB disk unless the test is about disk, and is deleted when the test ends. The test reports what it cost.
3. **Where this is enforced.** `e2e-electron/live.spec.js` (run with `RUNPOD_LIVE=1`) already selects `auto`; a comment there names this ADR. `gpus.test.ts` pins that `auto` cannot choose an explicit-only card. The MCP's own pod tests run in no-spend mode and never reach RunPod.
4. **A big card is for a run, not a test.** Stereo and restoration graphs that need the memory are run by choosing the card by name, with a named yes, by the person who wants the run.

## Revisit

When a test needs VRAM (a model that does not fit 24 GB), name the smallest card that fits and say so in the test, not a big one by default.
