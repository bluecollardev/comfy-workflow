# ADR-028: Anything the app can do, the MCP can do

**Date:** 2026-11-04
**Status:** Accepted.
**Extends:** ADR-002 (the agent pool), ADR-005 (the TypeScript core), ADR-019 (the remote MCP connector). **Code:** `apps/runpod-dashboard/mcp/server.mjs`, `mcp/docs.mjs`, `mcp/parity.test.mjs`, `libs/core/src/imports.ts` (zip source).

## Context

The MCP server covered pods, volumes, sync, adapters and a folder import. It had nothing for the Panama (BH) rounds, no zip import (the Import window says "Zip or folder" but the core only took a folder), no way to change the configuration or a pod's own, to grow a volume, to read the stock by card, to touch the API keys, or to read our own README and docs. Lucas (2026-11-04): "make sure our mcp can drive the pod creation, the import from bh, import from zip, all of it"; "it should be able to handle adjustments to pod configuration"; "it should be able to make adjustments to api keys and config"; "it should be able to manage volumes and grow them or create them in a certain datacenter"; "make sure the mcp knows about our readme and other documentation too"; and the rule: **"anything we can do in the app, we need to be able to do via mcp."**

## Decision

1. **The MCP is a peer of the window, not a subset.** The app's capability surface is the dispatch table `TABLE` in `electron/core.cjs` (namespace.method, the same calls the page makes over IPC). Every entry is either backed by an MCP tool or listed as needing a window, with the reason.
2. **A parity test keeps it true.** `mcp/parity.test.mjs` holds the map (`namespace.method` to a tool name, or `window:` and the reason) and fails when `TABLE` has an entry the map lacks, when a mapped tool does not exist, or when a tool has no entry. Adding an app capability without deciding its MCP side fails the build.
3. **What needs a window, and why** (everything else has a tool): the OAuth hand-off to a git provider (`git.connect`, a browser round trip), the native folder and file pickers (`mounts.dirs`; a tool takes the path), and the Adapter Studio's chat engine (`studio.step`, `saveChecked`, `document`, `context`: the MCP client is itself the model that writes the adapter, so it gets `adapter_spec`, `adapter_save`, `import_plan` and the package tree and file readers instead).
4. **New tool groups.**
   - *Pods:* `create_pod` takes everything the form does (card, datacenter, cloud, disks, count, env, image, idle stop, mounts, own configuration, a raw RunPod GPU id); `list_gpus`; `list_datacenters` (every card, free or in use, ADR-027); `get_pod_config` and `set_pod_config` (a pod's own configuration, optionally followed by a recreate).
   - *Volumes:* `resize_volume` (grow), `create_volume` in a chosen datacenter, with the existing list, delete and default.
   - *Configuration and keys:* `set_configuration` (a patch of the Default Configuration), `config_export` and `config_import_plan`, `config_import_apply`, `config_undo`; `get_settings` and `set_settings` for the API keys and the Panama bucket (values are never returned, only whether set and the last four characters).
   - *Panama / BH:* `panama_status`, `panama_rounds` and `panama_round_files` (the same tree the window shows), `panama_round_size`, `panama_pull`, `panama_job`, `panama_cancel`, `panama_remove`, each for Local or Pod; `panama_pod_plan` shows what a pod pull would start before it does.
   - *Import:* `import_plan` and `import_apply` take a folder **or a `.zip`**.
   - *Docs:* a `docs` tool and `docs://` resources over the README, the changelog and `docs/`.
5. **Zip as a source.** `imports.prepareSource` unpacks a `.zip` once into `import-zips/<name>-<hash>` beside the import records and the plan runs on that folder (a zip with one top folder yields that folder, as a Drive download does; `origin` on the plan names the zip). It lists the zip first and refuses an entry that would leave the folder (`..`, absolute paths), more than 200,000 entries, or more than 200 GB unpacked. It uses the system `unzip` (macOS, Linux); the zip is never changed. Several Drive parts are not merged yet.
6. **Spend stays gated, keys do not.** `create_pod`, `create_volume`, `resize_volume`, a pod-mode `panama_pull`, and any `set_pod_config` that recreates a pod need `approved_by` (the existing named yes, USD 100 cap). The pod manager's own API keys and settings are *internal to the pod manager, not the CANALV2 job* (Lucas: "this is internal to the run pod, not my project"), so Binc's rule that an agent never changes accounts or security settings does not apply to them and `set_settings` takes no named yes. The no-spend switch (`dry_run`) is the exception: it is never settable over MCP, so an agent cannot turn the safety off.
7. **Docs are served, minus what the public site leaves out.** `docs` lists, reads and searches `README.md`, `CHANGELOG.md`, `AGENTS.md` and `docs/*.md`, found from the checkout (or `COMFY_REPO_ROOT`). The same exclusion list as the public documentation site (`scripts/docs-site.mjs`: the client's job, Binc's material, planning notes) applies, because the MCP can be served remotely (ADR-019). The server's instructions tell a connecting client the tool exists. The packaged app has no checkout, so there `docs` says so.

## Consequences

- About thirty tools are added to the existing thirty-odd. Descriptions stay short and say what spends.
- A key typed into a chat reaches the model's context and the client's transcript; `set_settings` says so in its description. Reading a key back is not possible.
- An agent can now reconfigure the app, which includes the default image, the volume and the idle stop. Changes are validated by the same code the window uses, and `config_undo` restores the last import's backup.
- The remote connector (ADR-019) inherits all of it, so a remote client can run the whole BH import end to end.

## Not done

- Merging several Drive zip parts into one package.
- A packaged app that carries the docs (it would need the exclusion list applied at build time).
- A Windows unzip.
