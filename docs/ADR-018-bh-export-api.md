# ADR-018: The export gets an API option: read the bundle from BH instead of downloading it

**Date:** 2026-11-03
**Status:** Proposed. Needs BH (Kyle) to build the server side; the app side is specified here.
**Extends:** ADR-016 (how the export works), ADR-017 (source adapters). **Read from:** the Panama console repo, `app/src/lib/mcp/`
(`server.ts`, `policy.ts`), `docs/MCP-CONNECT-GUIDE-BRYNLEY.md`, `docs/DELIVERY-CONTRACT.md` §5.2.

## Context

Lucas, 2026-11-03: "the export behind the zip should have an api option, the zip bundles as it does now, but instead of download we
should be able to read from bh."

Today an export reaches a person one way: `build-brynley-comfy-delivery.py` builds a round (STAGED), Kyle says go, `s3_rounds.py`
copies it into the exchange bucket (SENT), and the receiver downloads it with an AWS or rclone key (ADR-016). The app's first cut
(`panama.ts`) reads the bucket directly with an AWS CLI profile. That works but:

- the credential is an AWS key per person, outside BH's own identity (the console's roles, keys and audit);
- the app learns what exists by parsing bucket listings and non-uniform manifests (ADR-017), and cannot tell a sent round from a
  revoked or superseded one;
- nothing ties a download to a person in BH's records.

The console already has the right front door: `https://panama-console.beinghuman.studio/api/mcp`, per-person keys created on
`/connect` (shown once, revocable), roles `internal | partner | client` with a tool absent from `tools/list` for a role that may not
call it (`policy.ts`), and audited events. Its tools today cover shot status, lineage and effort. **None lists or serves an export.**

## Decision

Add an **export API** to the console. The bundling does not change; only the way it is read does.

1. **Same bundle, same builder.** Rounds are still built by `build-brynley-comfy-delivery.py` and sent by Kyle's go. If BH also writes a
   zip per round or per shot pack, it is built exactly as now; the API serves what the builder produced and adds no new packaging.
   (Today the bucket holds folders and a manifest, not zips; see ADR-016. The API is agnostic: it returns files, or the zip object if
   one exists.)
2. **Four read tools on the existing MCP endpoint, role `internal` and `partner` only** (the method is ours, as with lineage):

   | Tool | Returns |
   |---|---|
   | `list_exports` | one entry per sent round: `name`, `base`, `revision` (`-rN`), `superseded_by`, `kind`, `written_at`, `shots[]` with files and bytes, `importable`, `status` (`SENT` or `REVOKED`), `readme_sha256` |
   | `get_export` | one round: the normalised manifest (path, bytes, sha256, role per file) for a round or for a single shot pack, whatever shape the stored manifest has (the round-format adapters of ADR-017 live server side too) |
   | `get_export_urls` | short-lived (for example 15 minutes) presigned GET URLs for named files or a prefix, scoped to that person, with a byte total; the bytes come from the exchange bucket, not through the serverless function |
   | `report_export_pulled` | the caller says what it fetched and whether `verify` passed; written to the record so BH sees who holds which round |

   The list is generated from the same place that publishes, so a round appears when `s3_rounds.py` PASSes and disappears or turns
   `REVOKED` on the BH side. No bucket listing is parsed by the receiver.
3. **One credential.** A console key (Bearer, per machine, revocable) replaces the AWS profile for reading. The bucket stays private;
   BH's server signs the URLs. The pod side (ADR-015) gets URLs from the same call, or a console key as a RunPod Secret, instead of an
   AWS key.
4. **The app side is a `panama-console` source adapter** (ADR-017): `detect` (a console key is set), `list` (`list_exports`), `fetch`
   (`get_export_urls`, then parallel GETs with resume into the staging folder), then the same round adapter verifies sha256 against
   the manifest. The picker's "Panama S3 bucket" becomes "BH (Panama console)"; the direct-bucket source stays as the fallback until
   the API exists. The key lives in the app's settings file with the other secrets, never in an adapter.
5. **Read-only, additive, verified.** The API has no write tool for exports. Nothing the app fetches is trusted until the manifest check
   passes, as in ADR-016.

## Consequences

- BH controls visibility and revocation in one place, and sees who pulled what. A sent round is never edited; a `-rN` appears as a new
  entry that supersedes the old one, and the app can say so.
- A new dependency on the console being up for listing. The direct-bucket source covers that.
- BH-side work (Kyle's repo, which we cannot change from here; this ADR is the request): the four tools, a policy row each, the
  presigner, an exports index written by `s3_rounds.py` on PASS, and a REVOKED marker. The app-side work waits on that or on a mock.
- Plates and masters are not exports; they stay behind their own named yes and are not served by these tools.

## Open questions for BH

- Is a zip ever written, and where? If yes, should `get_export_urls` offer it as one object next to the per-file URLs?
- Should Lucas's console role be `internal` or `partner` (the guide calls his machine read-only)? A read-only partner role may be needed.
- URL lifetime and a per-key byte quota for a 39 GB round.
- Should `report_export_pulled` be required, or best effort?

## Order of work

1. BH: `list_exports` and `get_export` on top of the existing index of rounds (no bytes move yet).
2. App: the `panama-console` source adapter against a mock of those two tools, then the real endpoint.
3. BH: `get_export_urls` and the presigner; app: fetch with resume.
4. Retire the AWS-profile source for people with a console key.
