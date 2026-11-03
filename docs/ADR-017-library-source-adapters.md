# ADR-017: The library is built from adapters: a source adapter fetches, a round adapter reads

**Date:** 2026-11-03
**Status:** Proposed (Lucas: "use the adapter pattern").
**Extends:** ADR-008 and ADR-009 (import adapters and the Studio), ADR-016 (the BH library in Import Shot Pack).

## Context

ADR-008 made *what is in a package* an adapter: a module per package format maps a folder onto ComfyUI-Shared, built in or yours,
hot-loaded, fenced, written with Claude in the Studio. The BH library (ADR-016) adds two more places the same variation shows up,
and they are already visibly different:

- **Where a package comes from.** A folder on this PC, a round in the Panama S3 bucket, later the masters or a pod's volume, a
  Drive part. Each has its own way to list, to size, to fetch and to authenticate.
- **How a round describes itself.** Read from the bucket on 2026-11-03: the inbox round carries `schema: bh-round-1` and `kind`; the
  20 Oct round has an empty root file list and puts its files in `<shot>/MANIFEST.json`; 22 and 23 Oct mix a root list with per-shot
  ones; 29 Oct has a `round` field and no `kind`. The BH side will keep changing this (Brynley's inbox template, the effort and
  editorial packages). Hard-coding one shape in the app means a release per change.

The first cut (`libs/core/src/panama.ts`) hard-codes both: `aws s3` against one bucket, and a `verify` that reads the two manifest
shapes known today. It works for today's five rounds and is the thing to replace.

## Decision

Three kinds of adapter, one pattern (a small module, built in or yours in `~/.config/runpod-pod-manager/`, hot-loaded, listed and
editable in Manage adapters, written in the Studio, validated on save):

| Adapter | Question it answers | Interface (data in, data out) | Today |
|---|---|---|---|
| **Source** | Where do packages live, and how do I get one? | `detect(config)`, `list() -> LibraryItem[]`, `fetch(item, dest, {onProgress}) -> files`, `auth` requirements | `folder` (this PC), `panama-s3` (AWS profile `panama`) |
| **Round** (format) | What is in a package the source delivered (per-shot layout from `build-brynley-comfy-delivery.py`, or the inbox/editorial shapes), is it intact, and which revision is newest? | `detect(dir)`, `describe(dir) -> { kind, written_at, shots[], files[{path,bytes,sha256}] }`, `verify(dir)` | `bh-round-1`, `bh-legacy-per-shot` (20, 22, 23, 29 Oct) |
| **Package** (ADR-008) | Where does each file go in ComfyUI-Shared? | `detect(dir)`, `plan(dir) -> ops` | the existing built-ins |

The chain for one import is **source -> round -> package**: the source puts a package in the staging folder, the round adapter says
what it is and checks it, the package adapter plans the import. Each stage is replaceable alone: a new bucket is a source adapter, a
changed manifest is a round adapter, a new file layout is a package adapter, none of them an app release.

`LibraryItem` is the one shape the picker shows, whatever the source: `{ source, id, name, kind?, written_at?, shots[], files?, bytes?,
staged, verified, importable }`. `importable` is true when some package adapter `detect`s it after staging; the inbox round is listed
and downloadable but not importable. Sizes and kinds that a source can only get by fetching a manifest are read lazily and cached.

Rules carried over from ADR-008, unchanged:

- An adapter returns **data**; the app checks it and applies it. A source adapter's `fetch` writes only into the staging folder; it
  never writes to the remote. Round and package adapters read the staged folder and never change it.
- Built-ins are editable by override, not in place. Yours are validated on save and run fenced (Node permission model); a source
  adapter needs a network allowance that the package fence denies, so the fence has a per-kind policy: package and round adapters have
  no network and read-only staging, a source adapter has network to the hosts it declares in `auth.hosts` and write to staging only.
- Secrets never live in an adapter. A source declares what it needs (an AWS profile name, a key in the settings file); the app
  supplies it.
- The Studio's "Write an adapter with Claude" gets a kind switch (source, round, package); the spec page `docs/IMPORT-ADAPTERS.md`
  gains a section per kind and `adapter_spec` in the MCP server returns all three.

## Consequences

- `panama.ts` becomes the `panama-s3` source adapter plus the `bh-round-1` and `bh-legacy-per-shot` round adapters, behind the same
  IPC (`panama:*` becomes `library:list|fetch|job`). The tests I wrote for `verify` move with the round adapters.
- The picker (ADR-016) lists items from every configured source: *Zip or folder* is the `folder` source, *Panama S3* is `panama-s3`;
  a third source appears without a UI change.
- Cost: three adapter kinds to maintain and a fence policy per kind. Worth it only if sources or formats really keep changing, which
  the manifests on 2026-11-03 say they do; if they settle, the built-ins stay and nothing else is needed.
- Not decided: whether a source adapter may run on a pod (ADR-015) with the same contract, or the pod keeps its own `S3_PULL`.

## Order of work

1. Move today's `panama.ts` behind the `LibraryItem` shape without changing behaviour (built-in source and round adapters).
2. Per-kind fence policy and the Studio kind switch.
3. The shot-pack level (ADR-016, decision 4) as `shots[]` on the item, fetched by prefix.
