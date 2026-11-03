# ADR-019: The app connects to BH's MCP server: a Remote servers section in Connect › MCP

**Date:** 2026-11-03
**Status:** Proposed (Lucas: "i need to be able to connect to his mcp server too from our app in the MCP connector of the connect modal").
**Extends:** `docs/MCP-ENDPOINTS.md`, ADR-018 (the export API), ADR-017 (source adapters).

## Context

Connect › MCP today lists the two servers **this app provides** (the pod manager and the ComfyUI bridge), with a ready-made setup per
client and a Check that runs `initialize` and `tools/list` (`libs/core/src/mcp.ts`: `probe`, `probeCommand` over stdio, `probeHttp`).
The app is a server there. It is never a client.

BH's Panama console is online (checked 2026-11-03): `https://panama-console.beinghuman.studio/api/mcp` answers `401 missing bearer
key` without a key. A key is made by the person on the console's `/connect` page (shown once, revocable); the role (`internal`,
`partner`, `client`) decides which tools exist for that key (`policy.ts`). ADR-018 wants the app to read exports from it.

## Decision

1. **A second section in the MCP tab, "Remote servers"**, for MCP servers this app *uses*. The first entry is BH's Panama console, with
   its URL prefilled. The section is generic (a name, a URL, a key) so a later server is a row, not a release.
2. **The key is a secret like the others.** Stored in the settings file (`~/.config/runpod-pod-manager/.env`, mode 0600) as
   `PANAMA_CONSOLE_KEY`, entered in the section, shown only as its last four characters, never written to the repo, a log, an
   adapter or a snippet. The URL is a plain setting.
3. **Check reuses the existing probe, with a header.** `probeHttp` gains an `Authorization: Bearer <key>` option; the result shows the
   tools the key's role may call, `whoami` (name and role) when the server has it, and the HTTP reason when it fails (401: no or bad
   key; 403: role). No tool is *called* by Check beyond `tools/list` and `whoami`.
4. **Read first.** The app calls only read tools (`list_exports`, `get_export`, `get_export_urls`, ADR-018, and `whoami`). It exposes no
   BH write tool (`set_shot_stage`, `mark_step_done`...) in its UI; those stay in Claude Code with the person's own key.
5. **One connection, two uses.** The section's connection is what the `panama-console` source adapter (ADR-017) uses to list and fetch
   rounds; the picker in Import Shot Pack shows "BH (Panama console)" when the section has a working key. The AWS-profile source stays
   as the fallback until ADR-018's tools exist on the server.
6. **The key never leaves the machine for anywhere but that URL.** The URL must be `https`; a typed `http` URL is refused except for
   `127.0.0.1` (tests). Redirects to another host are not followed with the key.

## Consequences

- Needs a console key per person; Lucas's role on the console decides what shows (the Panama guide gives his machine read-only access;
  whether that is `partner` or a narrower role is an open question to Kyle, ADR-018).
- Today the console has **no export tools**, so the first Check can only list shot-status and lineage tools. That is still a useful proof
  of the connection; the export tools arrive with ADR-018 on BH's side.
- Tests: the existing MCP browser tests use a fake API; add a fake remote that returns `401` without a header and a tool list with one,
  plus a unit test that the key is sent only to the configured host and masked on the way out.

## Order of work

1. Core: `remote.ts` (settings keys, `probeHttp` with headers, `whoami`), the IPC namespace, the IPC-table entry.
2. UI: the Remote servers section (URL, key field, Check, tools list), strings, the fake and the specs.
3. Later: the source adapter on top of it, when ADR-018's tools exist.
