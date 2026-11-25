# ADR-063: Storage adapters: S3-compatible places files go to and come from

Status: accepted, 2026-11-25. Lucas: "we have import adapters, but i think we need storage adapters too, rename this section in configuration the Adapters tab. these adapters can be enabled or disabled like other pod features. our sync to s3 for panama bh needs to be an adapter. then we need a new adapter for wasabi." / "an adapter is simply an S3 compatible storage." / "when publishing to S3, then we want to publish to any available / enabled adapters." / "this section in publishing really represents the params of s3 compat storage ... it should be moved to our adapters config." / "and then in the default configuration you can change these values, with a link to the config page to update the setting if necessary."

## Decision

Default Configuration has an **Adapters** tab (it was "Import Adapters") with the import adapters (ADR-008, ADR-009: JavaScript files that map a package folder onto ComfyUI-Shared, unchanged). The **storage** adapters are the Storage group at the top of the **Publishing** tab (Lucas, 2026-11-25: "move these all to publishing"):

- **Storage**: an adapter there is not code. It is one S3-compatible storage, a record of: id, name, endpoint (blank = AWS), region, bucket, directory (prefix), access key and secret key, and an `enabled` switch. Everything runs through the one `aws` runner, with `--endpoint-url` when an endpoint is set.

### The built-in storage adapters

| Id | What it is | Where its values live |
|---|---|---|
| `publish-s3` | the Publishing destination (bucket, directory, region, link lifetime, endpoint, credentials: own keys or the Panama exchange keys) | `publish.json` and the publish secrets, as before; only the form moved |
| `panama-s3` | the Panama BH exchange bucket that rounds are pulled from (list, browse, size, pull) | the existing `PANAMA_*` settings; its switch is kept in `storage-adapters.json` |
| `wasabi` | Wasabi: endpoint `https://s3.<region>.wasabisys.com`, own bucket, directory and keys | `storage-adapters.json` (keys 0600, never returned: a hint only) |

Users add more S3-compatible storages (Add Storage); a built-in is switched off, a user's own is deleted.

### Enabled and disabled

- A new storage adapter, and Wasabi, start **off**. `publish-s3` and `panama-s3` start on, as today.
- Off means the app does not use it: Panama list, browse, size and pull refuse with "the Panama S3 adapter is off" (every `panama.ts` command goes through one function, so one check); publishing does not mirror to it.

### Publishing fans out

A publish uploads to `publish-s3` first, as before, and that result decides the job. Then every **other enabled** storage adapter gets a copy of each file that was uploaded from this PC, under the same key below its own directory (`aws s3 cp <file> s3://<bucket>/<directory><key> --endpoint-url …`).

- A mirror that fails is a **warning** on the job (`Wasabi: <file>: <reason>`), never a failed job: the S3 destination is the record of delivery (the BKK return manifest is written from it).
- Files that exist only on the volume are not mirrored by this version (they are streamed to S3 through this PC with no local copy); the job says so in one warning.
- No keys, no URLs in any message (the existing `redact`).

### Where the values are edited

The S3 block that was in Publishing (bucket, directory, region, link lifetime, endpoint, credentials, Test) is now the form inside the `publish-s3` card of the Storage group, with the same fields and test ids; Panama's card links to the Panama settings; Wasabi and your own are edited in their cards. Below the cards Publishing keeps what is about the act of publishing (Slack, which targets are on, the transfer route, the message). The window's one Save writes both.

## Why

Three places held the same parameters under different names (the Publishing S3 block, the Panama fields, and nothing yet for Wasabi). They are all "an S3-compatible bucket with keys". One shape means a new storage is configuration, not code, and publishing to several is a loop.

## Not done here

- Mirroring volume-only files; a second required destination (all-or-nothing); pulling from Wasabi in the Panama pane; per-pod switches (the switches are app-wide, in Default Configuration).
- The MCP can list adapters, switch them on or off and test them; entering a destination or keys is a person's act in the window, as for publishing (ADR-050).

## Tests

`libs/core/src/storage.test.ts` (the record, the Wasabi endpoint, redaction, enable/disable, the Panama gate, the mirror loop with a fake `aws`); `e2e/storage-adapters.spec.js` (Adapters keeps the import adapters; Publishing has the Storage group, the three cards, enable/disable, Add Storage).
