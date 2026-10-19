# Queue

Job files for agents, one folder per project, in the shape Binc's tree uses:

```
queue/
└── <project>/
    ├── in/        jobs waiting. Nothing in here runs without an instruction.
    ├── running/   the one job a session is on. Move the file here first.
    ├── done/      finished jobs, with their report beside them.
    └── SYNC.md    what the last seed from the project's own queue brought in
```

A job file is a short brief: shot, tool, machine, root, exact commands, what
must exist afterwards, when to stop. The format and the rules for running one
are Binc's operator brief, `shared/governance/operator-brief.md`: one job per
session, one tool, one run, one new output folder, a report, stop. No
retries, no fixes, no judgement words in the report.

## Projects

| Folder | Source | Notes |
|---|---|---|
| `canalv2/` | `projects/desktop/CANALV2/04_TRACKER/queue/` on binc-PC, via `./queue/sync.sh` | Binc's queue. Their `in/README_queue_2026-10-17.md` gives the order: jobs 001–009 are independent anchor-and-carry runs, 010–016 are Blender GUI tracks that run one at a time. Every job names binc-PC as the machine and binc-PC paths as the root. |

Add a project with `./queue/sync.sh <name> <dir>` if it has a queue of its
own, or just create `queue/<name>/{in,running,done}/` and write job files.

## How this relates to Binc's queue

Their queue is the record for their job. This folder is our working copy:
seeded from theirs, additive, never written back. Moving a file from `in/` to
`running/` to `done/` here records what *we* ran; it does not move anything
in their tree. Reports an agent writes go in `done/` next to the job, and the
output folders the job names are created where the job says, which for the
CANALV2 jobs is on binc-PC.

The sync keeps a job wherever we have moved it. If Binc's queue later shows
the same job in `running/` or `done/`, the sync prints that and leaves ours
alone, so the two can be reconciled by hand.

Before an agent runs anything from `canalv2/`: `shared/governance/policy/agent-permissions.md`,
then the job file, then `shared/governance/operator-brief.md`.
