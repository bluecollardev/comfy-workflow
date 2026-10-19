# CanalV2: project

Version v008, 2026-10-15. Purpose: to improve our overall ability to do our jobs. Rules, roles and how-tos only.

**Who writes the rules.** Every rule is Binc's words or a quoted source document. Claude writes no rules and does not reword one into a new one. A disagreement is raised once, with a reason, then built Binc's way.

**Symmetry, not authority.** Kyle and the production are the client. The goal is symmetry with Kyle's workflow where our deliverable must match; his workflow rules have no authority over ours. We never interact with their harness except to build parity into our workflow.

## Four areas, one file each

| Area | What it holds | Changes by | File |
|---|---|---|---|
| Contract | engineering contract, standing rules, naming, structure | Binc only | `00_POLICY/area-contract_v001.md` |
| Client | Kyle's shot list, deliverables, review formats, inbox, outbox | Binc; Claude records | `00_POLICY/area-client_v001.md` |
| Shot pipeline | locked graphs, locked solves, queue, shot tracker | promoted work only | `00_POLICY/area-pipeline_v001.md` |
| Development | trackers, solvers, mesh, node packs, tests | anyone, in its own folders | `00_POLICY/area-development_v001.md` |

**Machines, network, NAS, git, RunPod:** `00_POLICY/systems_v001.md`.
**Structure master:** `00_POLICY/structure_v003.md`. **Shots:** `04_TRACKER/shots-table_v###.md`.

## Roles
Source: `claude/agent-brief-2026-10-09.md`.

| Role | Does |
|---|---|
| **Binc** | Shots, creative calls, approvals, the GUI look at each graph, the permissions. "I have my own work to do." |
| **Claude** (project session, cloud) | Brief, acceptance checks, review of reports, project docs. |
| **Claude Code agent, Mac** | Development area. Builds and tests; promotes nothing on its own. |
| **Claude Code agent, Linux PC** (or a RunPod container) | Shot pipeline area. Runs queued jobs and reports. Works only from the brief. Stops and writes a report on any ambiguity. |

Permissions: `00_POLICY/agent-permissions.md` and the table in `00_POLICY/project_v007.md` (unchanged).
