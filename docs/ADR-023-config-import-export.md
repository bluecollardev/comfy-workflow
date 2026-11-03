# ADR-023: Export and import the Default Configuration as a JSON file

**Date:** 2026-11-03
**Status:** Accepted. The decisions marked *assumption* were chosen by the builder from the request and are open to change.
**Request (Lucas):** "add a feature to allow the full configuration import and export for the default configuration"; "export to json and import json, user can pick from filesystem"; and, for a new installation, "have a popup that lets the user choose whether or not they want to do this json import and if so forward them to the correct screen and scroll to the import form".

## Context

Everything the app is set up with (the folder mapping, the network volume and datacenter, the image and registry login, the environment table, the pod defaults, the MCP servers it serves, the exchange-bucket settings) lives on one PC, in
`~/.config/runpod-pod-manager/mounts.json` and the settings file. Setting a second PC up, or setting one up again, meant retyping all of it. Most of it is not secret; some of it is (keys, tokens), and some of it only means something on the PC it
came from (folder paths).

## Decision

**The file.** One JSON file, versioned:

```json
{
  "format": "runpod-pod-manager-config",
  "version": 1,
  "exported_at": "2026-11-03T05:00:00.000Z",
  "app_version": "1.0.2",
  "config": {
    "folders": { "project": "/Users/me/CANALV2", "plates": "", "comfy-shared": "/Users/me/ComfyUI-Shared" },
    "custom": [], "links": [], "required": {},
    "network_volume_id": "vol1", "mount_path": "/workspace", "data_center_id": "EUR-IS-2",
    "image": "ghcr.io/example/comfy-app:contract-v26", "registry_auth_id": "cmv…",
    "env": { "COMFY_PORT": "8188" },
    "idle_stop_minutes": 30, "sync_parallel": 8, "sync_shared": ["input", "models", "workflows"], "pull_shared": ["output"], "apply_by_default": true,
    "mcp_http": { "pod-manager": { "enabled": false, "port": 8765 }, "comfy-bridge": { "enabled": false, "port": 8766 } }
  },
  "panama": { "bucket": "<bucket>", "region": "us-west-2", "profile": "panama" },
  "secrets_set": ["RUNPOD_API_KEY", "ANTHROPIC_API_KEY"],
  "env_omitted": ["HF_TOKEN"],
  "not_exported": ["the no-spend switch (dry_run)", "per-pod configurations", "adapters you wrote", "git accounts and repositories (they hold tokens)", "every key and token"]
}
```

`secrets_set` and `env_omitted` are names only, so the person importing knows what to enter again. Nothing in them is a value.

1. **No secret is ever in the file** (*assumption*). Not the RunPod key, the RunPod S3 keys, the exchange-bucket keys, the console key, the Anthropic key, nor git tokens; and an environment variable whose name looks like a secret (`SECRET`, `TOKEN`, `PASSW`, `CREDENTIAL`,
   `PRIVATE`, `AUTH`, `API_KEY`, `ACCESS_KEY`, `*_KEY`) is left out of an export and dropped from an import, so a hand-edited file cannot smuggle one in and a variable you typed into the table is not lost (an import keeps the ones already there).
   There is no "include keys" option in v1: the file is plain text on a disk that will be copied, mailed and committed by accident. If it is wanted later it needs a passphrase and encryption, not a checkbox.
2. **What is not exported** (*assumption*): the no-spend switch (`dry_run`: a per-machine safety switch, and an import must never silently turn it off), per-pod configurations (`pod-configs.json`), adapters you wrote, git accounts and repositories (they hold tokens),
   and the idle registry. The panel says so beside the buttons, and every file lists it under `not_exported`.
3. **Machine- and account-specific parts are flagged.** The folder mapping holds paths on the exporting PC: the preview marks Folders "paths from another machine" and leaves it **unticked** by default. The volume and the image and registry sections hold ids that belong to
   the exporting RunPod account and may not exist in yours ("a volume id from another account gives *not found*"): marked, ticked if they change.
4. **Import is validate, preview, apply; never blind.** The file is parsed and its `format` and `version` checked (an unknown format, or a newer version, is refused with a plain message; an older one is read), its types checked, and a file over 2 MB is refused as "not a
   configuration" without being read. Unknown keys are ignored with a warning. The preview lists one section per group the file carries (Volume and datacenter; Image and registry login; Environment; Pod defaults; MCP servers; Folders; the exchange-bucket settings), each with
   what changes (now and in the file), its own error when its values would not save (the other sections still import), and a checkbox. Only ticked sections are written, **through `mounts.put`**, the same normalize, validate and save the panel's Save uses; the exchange-bucket
   fields go through `settings.set`. Nothing is written until Apply.
5. **A backup before, an Undo after.** Before an import writes, the current configuration (and the exchange-bucket settings) is copied to `<config dir>/backups/mounts-<time>.json`; the newest ten are kept. Undo puts the last one back and removes it, so a second Undo goes one step further.
6. **An imported file is data, not instructions.** No field is executed, followed as a path, or used to read anything; values are stored as strings; `__proto__` and friends are ignored as unknown keys. (Tested with path-traversal strings, shell metacharacters and 100 000-character values.)
7. **The file is picked from the filesystem** in the app's own window: the main process shows the native Save and Open dialogs (`core:file:save`, `core:file:open`) and only moves one UTF-8 text file; the page gets the text, never a path to read. In a browser the same buttons are a download and an `<input type=file>`.
8. **A new installation asks once.** When the app starts with no RunPod key, no saved configuration and no earlier answer in this browser, a Welcome popup asks: *Import a configuration file* or *Set up from scratch*. The first opens Default Configuration scrolled to the import form (and
   briefly outlined), which is available before a key exists so a configuration can be loaded first and the key typed after; the second opens Default Configuration on the key, as it always did. Closing the popup counts as the second. Either answer is remembered, so it does not return.
9. **The command line has the same three things** (*assumption*, small): `./start.sh config export [file]`, `config import <file> [--sections a,b] [--dry-run]`, `config undo`, with the same checks, preview and backup (they call the same core functions).

## Consequences

- A configuration moves between PCs as a file, safely: it carries no secret, shows what it will change, and can be undone.
- The keys still have to be entered on the new PC. This is deliberate (decision 1), and the preview says which ones.
- The set of sections is fixed in the core (`libs/core/src/configio.ts`); a new setting needs a line there to travel.
- The Welcome popup changes what a brand-new launch looks like: specs that start with no key now answer it first.

## Not covered

Per-pod configurations, adapters, git accounts, and a passphrase-protected file that includes keys. Merging two configurations (an import replaces whole sections, or leaves them). Cloud storage of the file.
