# ADR-023: Export and import the Default Configuration as a JSON file

**Date:** 2026-11-03
**Status:** Accepted. **Decision 1 (no secret in the file) was SUPERSEDED by Lucas on 2026-11-03**: the file now carries the keys and tokens by default and the import restores them (decision 1b). The other decisions stand.
**Request (Lucas):** "add a feature to allow the full configuration import and export for the default configuration"; "export to json and import json, user can pick from filesystem"; and, for a new installation, "have a popup that lets the user choose whether or not they want to do this json import and if so forward them to the correct screen and scroll to the import form". On the first version's text ("The file never contains keys or tokens..."): "wrong, export adds tokens" and "import reads"; "exports should have secrets".

## Context

Everything the app is set up with (the folder mapping, the network volume and datacenter, the image and registry login, the environment table, the pod defaults, the MCP servers it serves, the exchange-bucket settings, and the keys and tokens) lives on one PC, in
`~/.config/runpod-pod-manager/` (`mounts.json`, the settings file, `git_accounts.json`). Setting a second PC up, or setting one up again, meant retyping all of it. Some of it only means something on the PC it came from (folder paths); some is secret.

## Decision

**The file.** One JSON file, versioned (secrets redacted here):

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
    "env": { "COMFY_PORT": "8188", "HF_TOKEN": "hf_…REDACTED…" },
    "idle_stop_minutes": 30, "sync_parallel": 8, "sync_shared": ["input", "models", "workflows"], "pull_shared": ["output"], "apply_by_default": true,
    "mcp_http": { "pod-manager": { "enabled": false, "port": 8765 }, "comfy-bridge": { "enabled": false, "port": 8766 } }
  },
  "panama": { "bucket": "<bucket>", "region": "us-west-2", "profile": "panama" },
  "secrets_included": true,
  "secrets": {
    "settings": {
      "RUNPOD_API_KEY": "rpa_…REDACTED…", "RUNPOD_S3_ACCESS_KEY": "user_…REDACTED…", "RUNPOD_S3_SECRET_KEY": "rps_…REDACTED…",
      "PANAMA_AWS_ACCESS_KEY_ID": "AKIA…REDACTED…", "PANAMA_AWS_SECRET_ACCESS_KEY": "…REDACTED…", "PANAMA_CONSOLE_KEY": "…REDACTED…", "ANTHROPIC_API_KEY": "sk-ant-…REDACTED…"
    },
    "git_accounts": [
      { "id": "…", "provider": "github", "host": "github.com", "username": "octocat", "scope": "repo", "token": "ghp_…REDACTED…", "refresh_token": null, "expires_at": null, "connected_at": 1700000000 }
    ]
  },
  "secrets_set": ["RUNPOD_API_KEY", "ANTHROPIC_API_KEY", "git:github/octocat"],
  "env_omitted": [],
  "not_exported": ["the no-spend switch (dry_run)", "per-pod configurations", "adapters you wrote", "the repositories attached to pods"]
}
```

With the box unticked (`--no-secrets`) the file has `"secrets_included": false`, no `secrets` block, the secret-looking environment variables are left out of `config.env` and named in `env_omitted`, and `secrets_set` lists only the names.

1. ~~**No secret is ever in the file.**~~ **SUPERSEDED (Lucas, 2026-11-03).** The first version left every key and token out and listed only their names; Lucas overruled it ("export adds tokens", "import reads"). It is replaced by 1b. *Why it was reversed:* he wants **one file that sets up a whole new computer**,
   and a file that still needs seven keys and every git login typed in by hand does not do that.

1b. **The file carries the keys and tokens by default, and the import reads them.** The export writes a `secrets` block with the real values: the RunPod API key, the RunPod S3 keys, the exchange-bucket keys, the console key and the Anthropic key (`settings.ts`'s `SECRET_FIELDS`), the git accounts with their tokens and
    refresh tokens (`git_accounts.json`), and the environment-table entries whose names look like secrets (`HF_TOKEN` and the like), which now travel in the ordinary `config.env`. `"secrets_included": true` says so. *Mitigations, because the file is now as sensitive as the keys in it:*
    - **An opt-out in the export:** a checkbox "Include keys and tokens", **ticked by default**, with a warning beside it that is not missable: "The file will contain your keys and tokens in plain text. Keep it private; anyone with it can use your RunPod account and buckets." Unticked, or `config export --no-secrets`, gives the old shape (names only).
    - **Written 0600:** the main process (native Save dialog) and the CLI create the file owner-only and `chmod` it, since the mode option only applies to a new file. The CLI also prints a one-line warning on stderr.
    - **Never shown:** the import preview has a "Keys and tokens" section (only when the file has the block), **ticked by default**, listing each name with only the **last four characters** (a value shorter than eight characters shows only dots). No full value appears in the UI, a toast, the CLI output, a warning, an error message or a log line; a secret-looking environment value in the preview is masked the same way. The plan the page receives is
      built from a masked copy; the real values stay inside the module that applies them.
    - **Checked like the panel's own Save:** each key goes through the same rules `settings.set` uses (no spaces, minimum lengths); a **malformed key is reported by name** ("ANTHROPIC_API_KEY is too short...") and never echoed, the others still import, and the result names what was skipped. A section with nothing importable is refused by name. Git accounts are checked for a known provider and a well-formed token, merged by `id`, and saved through the git store (which writes 0600).
    - **Backed up and undoable:** see 5.
    - **Nothing deleted by omission:** importing a file never removes a secret-looking environment variable that is in the table already because the file does not mention it, nor a stored key because the file lacks one.
2. **What is not exported** (*assumption*): the no-spend switch (`dry_run`: a per-machine safety switch, and an import must never silently turn it off), per-pod configurations (`pod-configs.json`), adapters you wrote, the repositories attached to pods, and the idle registry. The panel says so beside the buttons and every file lists it under `not_exported`.
3. **Machine- and account-specific parts are flagged.** The folder mapping holds paths on the exporting PC: the preview marks Folders "paths from another machine" and leaves it **unticked** by default. The volume and the image and registry sections hold ids that belong to the exporting RunPod account and may not exist in yours: marked, ticked if they change.
4. **Import is validate, preview, apply; never blind.** The file is parsed and its `format` and `version` checked (an unknown format, or a newer version, is refused with a plain message; an older one is read), its types checked, and a file over 2 MB is refused as "not a configuration" without being read. Unknown keys are ignored with a warning.
   The preview lists one section per group the file carries (Volume and datacenter; Image and registry login; Environment; Pod defaults; MCP servers; Folders; the exchange-bucket settings; **Keys and tokens**), each with what changes, its own error when its values would not save (the other sections still import), and a checkbox. Only ticked sections are written,
   **through `mounts.put`** (the same normalize, validate and save the panel's Save uses), `settings.set` for the exchange-bucket fields and the keys, and the git store for the accounts. Nothing is written until Apply.
5. **A backup before, an Undo after.** Before an import writes, the current configuration, the exchange-bucket settings **and the current keys and tokens** are copied to `<config dir>/backups/mounts-<time>.json`; the folder is **0700** and each file **0600** (they hold keys now); the newest ten are kept. Undo puts the last one back (a key that was absent is removed again) and removes it, so a second Undo goes one step further. A backup made before keys travelled has no `secrets` and leaves the current keys alone.
6. **An imported file is data, not instructions.** No field is executed, followed as a path, or used to read anything; values are stored as strings; `__proto__` and friends are ignored as unknown keys. (Tested with path-traversal strings, shell metacharacters and 100 000-character values.)
7. **The file is picked from the filesystem** in the app's own window: the main process shows the native Save and Open dialogs (`core:file:save`, `core:file:open`) and only moves one UTF-8 text file; the page gets the text, never a path to read. In a browser the same buttons are a download and an `<input type=file>`.
8. **A new installation asks once.** When the app starts with no RunPod key, no saved configuration and no earlier answer in this browser, a Welcome popup asks: *Import a configuration file* or *Set up from scratch*. The first opens Default Configuration scrolled to the import form (and briefly outlined), which is available before a key exists, so a file that carries the RunPod key sets the app up completely in one step;
   the second opens Default Configuration on the key, as it always did. Closing the popup counts as the second. Either answer is remembered, so it does not return.
9. **The command line has the same three things** (*assumption*, small): `./start.sh config export [file] [--no-secrets]`, `config import <file> [--sections a,b] [--dry-run]`, `config undo`, with the same checks, preview and backup (they call the same core functions).

## Consequences

- A configuration, keys included, moves between PCs as one file; the preview shows what it will change and can be undone.
- **The file is a secret.** Anyone holding it can use the RunPod account, the buckets and the git logins in it. It is written owner-only, the panel and the CLI say so, and the box can be unticked; but a copy mailed, synced or committed by accident is a leaked key. Rotate the keys if one is.
- The backups folder now holds keys too (0700/0600), up to ten snapshots; they are removed as they are undone or pruned.
- An import that sets the RunPod key on a new PC makes that PC ready at once; an import over a PC that has its own keys replaces them with the file's (and Undo brings them back).
- The set of sections is fixed in the core (`libs/core/src/configio.ts`); a new setting, or a new secret, needs a line there to travel.
- The Welcome popup changes what a brand-new launch looks like: specs that start with no key now answer it first.

## Not covered

Per-pod configurations, adapters, the attached repositories, and a passphrase-protected (encrypted) file, which remains the better answer if the file is going anywhere but straight to the other computer. Merging two configurations (an import replaces whole sections, or leaves them). Cloud storage of the file.
