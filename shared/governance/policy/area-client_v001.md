# Area: client

Kyle and the production are the client. This area records what we owe them and what came in from them. It does not hold their rules.

| What | Where |
|---|---|
| Kyle's shot list and assignments (source) | his console and repo, read only: `~/panama-console/` |
| Our record of each assignment or request | `03_INBOX/<shot>/` or `03_INBOX/<yyyy-mm-dd>_<topic>/` (`ENTRY.md`, `ASSETS.csv`) |
| What we owe, per shot | `04_TRACKER/deliverables.csv` |
| Dates | `04_TRACKER/schedule.csv` |
| What needs Binc | `04_TRACKER/attention-list_v###.csv` |
| Review formats | mono, stereo, Apple Vision Pro (Binc, 2026-10-15) |
| Outbox: anything that has gone out | `90_DELIVERIES/<type>_<topic>_<yyyy-mm-dd>/` |
| Served plates | linked from `<shot>/02_SOURCE/SOURCES.csv`, never copied or moved |

- Every live request from Kyle, Joe, Tunnel or BH gets an inbox entry.
- Sending anything to the client is Binc's. Agents never send.
- Their docs are read for symmetry only: `~/panama-console/docs/`.
