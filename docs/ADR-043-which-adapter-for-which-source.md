# ADR-043: which import adapter for which source

**Date:** 2026-11-17
**Status:** Accepted (Lucas, 2026-11-17: "binc proxy rounds ... is the one we use"; "panama-imax-redux ... is the Panama import adapter"; "add to docs and adr to remember")
**Owner:** Lucas (Blue Collar Dev)
**Extends:** ADR-008 (adapters), ADR-016 (the BH library in Import Shot Pack), ADR-017 (library source adapters). Spec: `docs/IMPORT-ADAPTERS.md`; use: `docs/IMPORT-SHOT-PACKS.md`.

## Context

A request came in for "a custom adapter to load shot packs or workflows" so that Binc's graphs run in
the manager. Two adapters already cover the sources we have, and the volume already holds the rounds.
Without a written rule the next session drafts a third adapter or picks the wrong one.

## Decision

1. **Pick the adapter by source, and do not write a new one while one fits.**

   | Source | Adapter | Kind |
   |---|---|---|
   | The Panama S3 bucket (BH) rounds, staged under `temp/rounds/<round>`; Kyle's delivery packages (`<shot>/comfy/`, `<shot>/nodes/`, `MANIFEST.json`) | `panama-imax-redux` ("Panama Canal v2 delivery package") | built in (kind: shot pack) |
   | Brynley's rounds: `<round>/<shot>/<shot>__<variant>__<round>.json` | `brynley-rounds` | built in (kind: round) |
   | A folder that is already a ComfyUI-Shared (`input/`, `models/`, `workflows/`, `output/`) | `comfy-shared` | built in (kind: shot pack) |

2. **The bucket download and the adapter are two steps.** Download stages and hash-checks a round
   against its `MANIFEST.json`; Import Package then hands the staged folder to an adapter (ADR-016).
   An adapter never touches the bucket.
3. **The rounds on the shared volume need no import.** On EU-RO-1 (`a3upg9ey48`) the rounds
   `proxy_v004e`, `proxy_v004f`, `proxy_v004g` and `proxy_v005` already sit under
   `/workspace/comfy-shared/workflows/`, and the Run workflows window lists them. `brynley-rounds`
   is for bringing a new round from elsewhere onto the volume. The adapter is named for the volumes
   that keep rounds this way; the volume `brynley-rounds-eu-ro-1` is the example (Lucas, 2026-11-17).
4. **Binc's rules hold for everything on that volume** (`shared/governance/policy/agent-permissions.md`):
   nothing is overwritten, moved or deleted; a download, install or spend needs a named yes under the
   USD 100 cap; locked shots (`cgi-042`) are never edited or run; an ambiguity is a report, not a guess.
5. **A missing file is not fixed by editing Binc's graph.** If a graph names a model the volume lacks
   (the 2026-11-17 case: `ltx-2.3-spatial-upscaler-x2-1.0`, which `Lightricks/LTX-2.3` no longer
   publishes on `main`), the fix is a verified file added beside the others, from a source Lucas
   names (a commit or tag), never an unofficial copy and never a change to the graph. Same day, a
   second case: `archival-080__a__proxy_v005` failed on `LTXVAudioVAELoader` because that loader reads
   `models/checkpoints/` and `LTX23_audio_vae_bf16.safetensors` was only in `vae/`; a checksum-verified
   copy was fetched into `checkpoints/` and the `vae/` file left alone (`docs/runbooks/run-workflows-on-a-pod.md`, Log).
6. **Every adapter we build is baked into the app as a default** (Lucas, 2026-11-17: "make sure our adapters that we build in this session are all baked into the app as defaults"). It lives in `apps/runpod-dashboard/libs/core/runtime/adapters/`, which the core build copies to `dist/runtime` and the packaged app ships, so a new machine has it without anything in `~/.config`. A file of the same id in `~/.config/runpod-pod-manager/adapters/` is an **override** (shown as modified; Reset returns to the shipped one). `brynley-rounds` was the one built this session (renamed from `binc-proxy-rounds`); the round adapter and the volume source of ADR-044 follow the same rule when built.
7. **Each adapter has a kind, shown as a chip** in Default Configuration > Import adapters (Lucas: "Import Adapters have chips to show the types of adapters (shot pack vs round)"): `shot-pack` (a delivery package or a ComfyUI-Shared folder; the default when an adapter says nothing) or `round` (a round of per-shot graphs). It is a `kind: '...'` line in the module, read by the app, checked on save, and set to `shot-pack` in a new adapter's template. `comfy-shared` and `panama-imax-redux` are shot packs; `brynley-rounds` is a round.

## Consequences

- A session asked for "an adapter for shot packs or workflows" first runs `import_detect` on the
  folder it is given; it writes a new adapter only when none matches.
- The two adapters are recorded here and in the agent's memory, so the choice survives a new session.

## Open

- The 1.0 x2 spatial upscaler: the volume's copy is 995,743,504 bytes, 56 fewer than 1.1's, and no
  published checksum for 1.0 was found. It needs a commit or tag with the file, or a checksum run
  from a pod (a few cents, a named yes), and a look at which folder `proxy_v005` loads it from.
