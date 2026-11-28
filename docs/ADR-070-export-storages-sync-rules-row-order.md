# ADR-070: Export and import carry the storages, sync rules, volume Auto sync and the row order

**Status:** built, not released (2026-11-28). Extends ADR-023.

## Why

Lucas, 2026-11-28: "this volume config is all in exports right? and imports?" It was not. "order stored in import export too" / "yes build it".

## Decision

| What | Where in the file | On import |
|---|---|---|
| Storages (Wasabi and your own): records, Default Storage, card order, titles of the BH buckets | `storages` section; keys in `secrets.storages` | A storage that is on stays on only if its keys are present after the import, else it arrives off with a warning |
| Sync rules (`sync-rules.json`, ADR-069) | `sync_rules` section | Replaces this machine's rules. A rule naming a storage neither in the file nor here is dropped with a warning; a rule for an unknown volume is kept |
| Auto sync of volumes | `auto_sync_volumes` section | Arrives **off**. Turning it on needs a named yes on that machine; the name in the file is information only |
| Network Volumes row order (volume ids, storage ids, `local`, `bh`) | `volume_order`, in the volume section | Taken as is; ids that match nothing are harmless |

- Keys follow the existing rule: included by default, can be left out, masked in every preview, never in a log or error.
- Import backs up `storage-adapters.json`, `sync-rules.json` and `autosync.json` (0600) beside the configuration, and Undo restores them.
- The file stays version 1: a missing section means "not in the file".
- The row order is one list in the configuration, read and written by `volumes.getOrder` / `volumes.setOrder`, which save only that field.

## Not covered

No import from one real machine to another has been run: the tests use fakes.
