# ADR-065: One card for the Panama bucket, with two roles

Status: accepted and built, 2026-11-27. Lucas: "why do we have panama bh exchange and a separate s3 with same creds" / "I'd merge them into one card. It would hold the bucket, region and keys once, with two role switches: Pull rounds from here (rounds/) and Publish returns here (returns/BKK/). The Upload On switches would stay on that one card. do that". Also: "you can choose a wasabi bucket or s3"; "when add storage is clicked scroll to new item, also make new item at top of list".

## Decision

- The Storage tab shows **one card for the Panama bucket** (default title "Panama BH (S3)", renamable). Before, ADR-063 showed two: the Publishing destination and the Panama exchange, which were the same bucket with the same keys under two settings stores.
- The card holds the **bucket, region and keys once** (the Panama form: `cfg-panama-*`), then two roles, each with its own switch:
  - **Pull Rounds From Here** (the Panama exchange: list, browse, size and pull `rounds/`; the switch is the `panama-s3` flag, so the Panama gate of ADR-063 is unchanged). The AWS profile and "Pull on pod start" sit under it.
  - **Publish Returns Here** (the publish destination: `returns/BKK/` by default; the switch is the `publish-s3` flag). Its directory, link lifetime and the advanced endpoint sit under it.
- **Same bucket and keys** (a tick under Publish Returns Here, on by default when the publish bucket and region equal the Panama ones and it uses the exchange keys): the destination then follows the Panama bucket and region and uses the exchange keys, and shows no bucket, region or key fields of its own. Untick it and the destination has its own bucket, region and keys as before. Nothing in `publish.json` or `PANAMA_*` changes shape: saving with the tick on writes the Panama bucket, region and `credentials: panama` into the publish settings.
- The five Upload On switches (ADR-064) are on this card once; their events are kept under the publish destination's id. Publishing is locked on, Approved is Auto-publish.
- Records and ids are unchanged: `publish-s3` and `panama-s3` still exist, the MCP `storage_adapters` tool still lists both and switches either one. Only the window shows one card (`panama-s3` is a role of `publish-s3`). The pod's "Pull on start" and every Panama command are untouched.

## Add Storage

- The form opens **at the top of the list**, is scrolled to and focused, and asks first: **Wasabi Bucket** or **S3 (AWS Or Compatible)**. Wasabi takes a region and fills the endpoint (`s3.<region>.wasabisys.com`, `s3.wasabisys.com` for us-east-1); S3 asks for an endpoint (blank for AWS).
- The new storage is saved **first in the list** and scrolled to.

## Not done

- Merging the two sets of keys in the stores (the exchange keys stay in the Panama settings; the publish destination points at them). A separate decision if the two stores should become one.
- Reading from an adapter and volume sync on change: ADR-066 (still to write).

## Tests

`e2e/storage-adapters.spec.js` (one Panama card with the keys, bucket, region, profile and pull once; the two role switches; the five event switches; Add Storage at the top with Wasabi or S3; rename; order), `libs/core/tests/storage.test.ts` (titles, events).
