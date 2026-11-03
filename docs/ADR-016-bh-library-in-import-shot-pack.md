# ADR-016: The BH library in Import Shot Pack: how the export reaches the app

**Date:** 2026-11-03
**Status:** Proposed (Lucas: "adr how the export will work ... a list of shotpacks and rounds available in the bh system").
**Extends:** ADR-008 (import adapters), ADR-015 (cloud to cloud). **Source of the facts:** the Panama console repo
(`bh_panama-console`: `docs/DELIVERY-PACKAGER-PLAN.md`, `scripts/panama-gen/migration/s3_rounds.py`, `verify_round.py`,
`films/panama-canal-v2/comms/2026-10-25-brynley-connect-guide.md`) and a read-only listing of the bucket on 2026-11-03.

## Context

What Binc and Brynley received used to be zips and folders on Drive. Since 25 Oct the BH side publishes **rounds** to one S3
bucket (`bh-panama-exchange-610140802195`, us-west-2) and nothing else is the source:

| In the bucket | What it is | Who writes it |
|---|---|---|
| `rounds/<round>/` | A delivery round for Brynley: a folder per shot (`archival-071/`, `cgi-042/`...) with the ComfyUI package, READMEs and a root `MANIFEST.json`. **The manifests are not uniform** (read 2026-11-03): only the inbox round has `schema: bh-round-1`, `kind` and `written_at`; the 20 Oct round has an empty root file list and lists files in `<shot>/MANIFEST.json`; 22 and 23 Oct have seven root files plus per-shot manifests; 29 Oct adds a `round` field and no `kind`. Where present, `files[]` is path, bytes, sha256. Five on 2026-11-03: three delivery rounds (20, 22, 23 Oct; 1.3k to 5.7k files, 9 to 29 GB), the editorial round of 29 Oct (39 GB, 2.5k files) and an **inbox** round of 191 text entries (`kind: inbox entries`, 0.6 MB). | `build-round.py` / `build-brynley-comfy-delivery.py`, then `s3_rounds.py` (`aws s3 sync` with SHA-256 checksums, then a listing check, `S3-RUN-LOG.md`; never deletes) |
| `masters/shots/` | Generated-shot masters | BH |
| `plates/` | Plates (client material; Binc's named yes) | BH |
| `returns/` | Brynley's work back to BH; the only prefix he can write | Brynley |

There are **no zip files in the bucket**. A round is a folder tree because S3 gives per-file resume and the manifest gives per-file
proof; a zip would lose both. The zips that exist are Binc's older queue drops and the Drive parts, which the app already imports
from a folder (the "Zip or folder" source).

## How the export works (BH side, read from its docs 2026-11-03)

The export is a BH feature, not ours. The app never builds a round; it discovers what BH published.

1. **Approve and organise.** A final is approved by Kyle's recorded keep verdict, filed in the shot's `05-outputs/Approved/master/` with its
   chain in `elements/<final-stem>/`, and passes the spec gate (`check-delivery-contract.py`; `DELIVERY-CONTRACT.md` §1, §4).
2. **Build the round (STAGED).** `scripts/panama-gen/build-brynley-comfy-delivery.py --dest <dir> [--shot <id>]` writes
   `brynley-comfy-YYYY-MM-DD[-rN]/` on the TRANSCEND disk: per shot `comfy/workflows/*.json` (-> ComfyUI user workflows),
   `comfy/input/` (the exact loader filenames), `approved/`, `final/<delivered name>` with a `.colour.json`, `nodes/<pack>-v<version>/`,
   `provenance/`, `reference/stereo/`, a per-shot `MANIFEST.json`; at the root `00_READ_ME.md` (MODE and STATUS of each graph, the
   spec-gate result with exceptions, what changed since the last round, open problems), `MANIFEST.json`, the two guides and
   `templates/`. Every copied file is re-hashed at the destination; a loader whose file differs from the hash on its node fails the
   build. Additive, never deletes. **A sent round is never edited; a change is a new `-rN`.** The editorial package is a different
   builder (`build-editorial-package.py`: the 4K mono final plus a 1280-wide proxy) and is not an import package.
3. **Send (SENT).** Copying out is Kyle's go each time (`DELIVERY-CONTRACT.md` §1 steps 8 to 10, §5.2). Since 25 Oct that copy is
   `migration/s3_rounds.py`: `aws s3 sync` with SHA-256 checksums into `rounds/<round>/`, then a listing check that every local file is
   in S3 at the same size, logged to `S3-RUN-LOG.md` and `s3-<round>.VERIFIED.json`.
4. **Receive.** Brynley downloads with rclone and runs `verify_round.py`. His work comes back under `returns/` (the one prefix he can write).

What follows for the app:

- **The bucket holds what was SENT.** A STAGED round on the TRANSCEND disk is not visible to us, and there is no state field in the
  bucket; presence under `rounds/` is the signal. Client screening deliveries (`deliveries/D01..D71`, built by `deliver.py` from the
  console's "Package to Send" request) are a different export for the client's review room and are not listed.
- **Revisions.** `-rN` rounds supersede their base. The list groups a base name with its revisions, marks the newest, and shows older
  ones as superseded (kept, because a sent round is never edited).
- **The per-shot layout is already what the built-in Brynley package adapter reads** (`docs/DELIVERY-PACKAGES.md`: `comfy/workflows`,
  `comfy/input`, `final/`, `approved/`). A "shot pack" in the list is a `<shot>/` folder of a round: the unit a person wants out of a
  9 to 39 GB round.
- **Only a round with `00_READ_ME.md` and shot folders is a delivery package.** The inbox round (text entries) and any editorial
  package are listed, downloadable and marked "not an import package".

## Decision

1. **The BH side stays the only writer; the app is a read-only consumer.** Rounds are built by `build-brynley-comfy-delivery.py` and published by `s3_rounds.py` (see "How the export works"). The app
   never writes to the bucket, never deletes, and uses a read-only key (profile `panama` today, the `panama-pod` key for pods).
2. **The manifest is the contract, read by a round-format adapter (ADR-017).** Nothing is offered for import until the downloaded round passes the same check as
   `verify_round.py` (every listed file present, same size, same sha256). Built in `libs/core/src/panama.ts` (`verify`); a round
   without a file list is refused, not trusted.
3. **Import Shot Pack gets a source picker, shown only when Panama is configured** (an AWS profile exists): *Zip or folder on this
   PC* (today's flow) or *Panama S3 bucket*. A round is downloaded to a staging folder (`~/panama-rounds/<round>`, as the guide
   does), verified, then handed to the ordinary folder import (adapter, plan, Import). No second import path.
4. **The library lists two levels, because that is how BH ships:**
   - **Rounds**: name, `kind` (delivery, inbox entries...), `written_at`, file count and size, and whether it is already staged and verified.
   - **Shot packs**: the per-shot folders inside a round (from the manifest's file paths). A round is 9 to 39 GB; a shot pack is the
     unit someone wants. The app downloads **one shot pack** (prefix `rounds/<round>/<shot>/` plus the root manifest) and verifies only
     the files it fetched; the rest of the round is not pulled. Whole-round download stays available.
   - Only `kind` values an adapter can read are offered for import; others (the inbox round) are listed and downloadable but marked
     "not an import package".
5. **"Zips for Binc/Brynley" means rounds, not archives.** If a zip is wanted for handing a pack to someone outside the app, it is made
   locally from a staged, verified folder (an export action later); the bucket does not hold zips.
6. **Not in the list:** client screening deliveries (`deliveries/D01..D71`, the console's `/deliveries`) are for the client's review
   room, not for ComfyUI; `masters/` and `plates/` are separate pickers, plates only with Binc's named yes
   (`shared/governance/policy/agent-permissions.md`).

## What is built (2026-11-03, on `feature/pod-pulls-from-s3`)

Source picker; the Panama pane (rounds, size, download, use for import); the core module with list, size, pull and `verify`; IPC and
tests. Not yet: `kind`/`written_at`/shots on the list, the shot-pack level (decision 4), the per-subset verify, a pod-side pull of a
round (ADR-015 covers the transport).

## Open questions for the BH side

- Publish a `rounds/INDEX.json` (name, kind, written_at, shots, files, bytes) so the app lists one small file instead of fetching
  each root manifest. Until then the app reads each root `MANIFEST.json` (a few KB each).
- Agree on `kind` values and a root file list in every round (see ADR-017: the app tolerates the older shapes through adapters, but new rounds should carry `schema` and `kind`).
- A round marked superseded or revoked: the app has no way to know today.

## Consequences

- Nothing about the Drive-era zips is lost: the folder source stays.
- Staged rounds are tens of GB on the Mac; the pane shows size before download and the staging folder is the user's to clear.
- The pod pulls straight from the bucket (ADR-015) for the same rounds, with the same manifest check run on the volume.
