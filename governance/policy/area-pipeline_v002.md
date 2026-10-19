# Area: shot pipeline

Production. Only promoted work runs here. Agents run jobs; they do not experiment here.

| What | Where |
|---|---|
| Shot folders | `10_CORROSION/<shot>/`, `20_STEREO/<shot>/` … |
| Locked graphs | `<shot>/04_GRAPH/` |
| Locked solves | `<shot>/03_WORK/` |
| Production scripts (queue, delivery, slug builder, graph builder, linter) | `02_SCRIPTS/queue-graphs/`, `delivery/`, `slug-builder/`, `graph-builder/`, `linter/` |
| Node packs in use | `02_SCRIPTS/nodes/` |
| Job queue | `04_TRACKER/queue/in/`, `running/`, `done/` (one job file in, one report out) |
| Review renders, one folder per job | `<shot>/06_REVIEW/<shot>_job_<yyyymmdd-hhmm>_graph-v###/` |
| Shot table | `04_TRACKER/shots-table_v###.md` |
| Six-stage tracker | artifact https://claude.ai/artifact/V36NdfcmgpeSxe1uYD1RdN, collection `shots` |

- Runs on the resource the brief names: binc-PC, Mac Studio, or RunPod (`02_SCRIPTS/containers/runpod/`). See `00_POLICY/systems_v002.md`.
- Approval is a node plus Binc's visual check.
- Locked or client-approved shots are never edited or run by us.
