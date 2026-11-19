# For Binc's agents: RunPod Manager

Self-contained on purpose. Binc's agents on binc-PC cannot read this private repo, so nothing here depends on a link into it.
Binc: paste the block at the bottom into your own `CLAUDE.md` (the operator brief) or project notes. We cannot write into your tree.

## What it is

**RunPod Manager** is Lucas's app (Electron, with an MCP server and a CLI). It creates and stops RunPod GPU pods, copies delivery
rounds from the BH exchange bucket onto RunPod network volumes, and runs shot graphs on the pods through ComfyUI.
Latest version: **v1.2.8** (downloads: the Releases page of `bluecollardev/downloads`).

## What an agent should know

- **Your rules still win.** For anything touching the CANALV2 job (its tree, shots, plates, client), `agent-permissions.md` and
  the operator brief govern: no running locked shots, a named yes for any download, install or spend, stop and report on ambiguity.
  The app's own docs describe what the app *can* do, not what you may do.
- **Pods use the v27 image** (CUDA 13 build). An older pod on the v26 image will not match. Pods that were created outside the app
  keep their old image until recreated.
- **Private image needs a Registry auth ID.** The ghcr image is private. Each RunPod account needs its own registry auth ID in the
  app's Default Configuration. Lucas's ID belongs to Lucas's account; yours must be created on yours.
- **Memory.** Pods start ComfyUI with `--cache-lru 1 --disable-smart-memory`. A long frame sequence loaded as one batch can still
  exhaust RAM (OOM, exit 137). Run long shots in chunks of about 100 frames (50 for 4K with SeedVR2 or LTX), no overlap, and use the
  app's RAM guard (default stop at 85% of the container's memory).
- **No free card or full host.** Resume and Create can fail with "no card available". The app has Retry Later: it keeps trying and
  resumes or creates the pod when a card frees up.
- **Billing.** Pods bill while running. Idle stop is 30 minutes by default. Stop pods you are not using.

## Where the full docs are

An agent connected to the app's MCP server (`pod-manager`) can read them with the `docs` tool (no arguments lists the pages; a page
name reads one) and the governance pages with the `governance` tool. Pages worth reading first: the runbooks (running a BH shot on a
pod), `CHUNKING.md`, and the MCP endpoints list.

## Paste into Binc's CLAUDE.md

```
## RunPod Manager (Lucas's app)
Lucas runs shots on RunPod pods through his app, RunPod Manager (v1.2.8+), which has an MCP server named `pod-manager`.
If that server is connected, read its `docs` tool before running anything on a pod: runbooks, CHUNKING.md (long shots in chunks,
RAM guard), MCP endpoints. These docs describe what the app can do. They do not change the rules above: locked shots stay
read-only, spend and downloads need a named yes, stop and report on ambiguity.
```
