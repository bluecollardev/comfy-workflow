# CanalV2: project

Version v007, 2026-10-15. Purpose: to improve our overall ability to do our jobs. Rules, roles and how-tos only.

**Who writes the rules.** Every rule is Binc's words or a quoted source document. Claude writes no rules and does not reword one into a new one. A disagreement is raised once, with a reason, then built Binc's way (`00_POLICY/bh-internal-policy.md`).

**Symmetry, not authority.** Kyle and the production are the client. The goal is symmetry with Kyle's workflow where our deliverable must match; his workflow rules have no authority over ours. We never interact with their harness except to build parity into our workflow (Binc, 2026-10-15).

**Structure master:** `00_POLICY/structure_v002.md` (tree, naming, where each type goes, tracker fields).
**Shots:** `04_TRACKER/shots-table_v002.md` (one row per shot, paths only).

## Roles
Source: `claude/agent-brief-2026-10-09.md`.

| Role | Does |
|---|---|
| **Binc** | Shots, creative calls, approvals, the GUI look at each graph, the permissions. "I have my own work to do." |
| **Claude** (project session, cloud) | Brief, acceptance checks, review of reports, project docs. |
| **Claude Code agent** (binc-PC, or a RunPod/GCP container) | Builds, loads, runs, reports. Works only from the brief. Stops and writes a report on any ambiguity; does not guess. |

## Permissions
Source: `claude/agent-brief-2026-10-09.md`, `00_POLICY/agent-permissions.md`.

| Action | Claude (project) | Claude Code agent |
|---|---|---|
| Read v4, frozen ComfyUI, Binc's graphs, paint-app repo | yes | yes, read-only |
| panama-console (their harness) | read docs only, for parity | read docs only, for parity; never run, fire, commit or post |
| Write or change any of those | never | never |
| Create new folders, forks, new versions | yes | yes (new names only, nothing overwritten, moved or deleted) |
| Delete anything | never | never |
| Run workflows on OPEN shots at proxy | on request | yes, within the job given |
| Run or edit APPROVED / LOCKED shots (e.g. cgi-042) | never | never |
| Install into CanalV2 ComfyUI | no | only after Binc's named yes |
| Install in a throwaway ComfyUI / container | no shell | yes, after a named yes for any download (file, source, size) |
| Spend on RunPod / GCP / APIs | no | up to the cap Binc sets, per job; stops at the cap |
| Send to the client, Kyle, Tunnel, Slack, email | never | never |
| Publish, share, change account or security settings | never | never |
| Client thread content | project docs only | not given to the agent unless Binc says |

- An agent that meets an ambiguity stops and writes a report. It does not guess.
- Every run is resumable: per-frame writes, checkpoint, restart-safe.
- Uploading client plates or footage to a third-party service needs Binc's explicit yes per service.

## Document index

| What | Where |
|---|---|
| Engineering Contract v3 (master) | Drive › comfy claude policy › *COMFYUI WORKFLOW ENGINEERING CONTRACTv3* (https://docs.google.com/document/d/1CJuFip6au_RE8hELlL4GFCxPbO2oi7OEB9P559D_ggE/edit) |
| Policy index | `00_POLICY/00_READ_ME.md` |
| Structure master | `00_POLICY/structure_v002.md` |
| Standing rules | `00_POLICY/standing-rules_v001.md`, `00_POLICY/bh-internal-policy.md` |
| Corrosion technical standards | `00_POLICY/corrosion-standards_v001.md` |
| Shape of every shot and graph | `00_POLICY/bh-symmetry_v002.md` |
| Naming, versions, served names, colour, storage | `00_POLICY/naming.md`, `versioning.md`, `served-names.md`, `colour.md`, `storage-and-backup.md` |
| Decisions log | `01_GOVERNANCE/decisions_v001.md` |
| Change log (served-name records) | `01_GOVERNANCE/change-log_v002.csv` |
| Shots table | `04_TRACKER/shots-table_v002.md` |
| Tracker and attention list | `04_TRACKER/README_v002.md`, `shots.csv`, `attention-list_v002.csv` |
| Six-stage tracker | artifact https://claude.ai/artifact/V36NdfcmgpeSxe1uYD1RdN, collection `shots` |
| Slug builder | `02_SCRIPTS/slug-builder/build_slug.py`, `slugkit.py` |
| Graph builder | `02_SCRIPTS/graph-builder/build_master_v15.py` |
| Contract linter | `02_SCRIPTS/linter/lint_graph.py` |
| Collector (spec only) | `02_SCRIPTS/collector/collector.md` |
| Agent brief | project: `claude/agent-brief-2026-10-09.md` |
| Client docs, read only, for symmetry | `~/panama-console/docs/` |
