# Governance

The rules agents and people follow in this repo, in one place.

## Precedence

1. **Binc's policies** (`policy/`, `workflow/`, `operator-brief.md`) govern anything that touches the CANALV2 job:
   its tree, its shots, its plates, its client. `policy/agent-permissions.md`
   is the page that says what an agent may do, needs a named yes for, and must
   never do. `operator-brief.md` is how an agent runs one job from the
   queue. These are copies; the master is Binc's tree on binc-PC, mirrored at
   `projects/desktop/CANALV2/`. Edit none of those copies; run `./sync.sh`.
2. **This repo's rules** (`.claude/rules/`) govern how work is done here:
   branches and merges, and that the mirror is read-only.
3. **`CLAUDE.md`** and **`AGENTS.md`** at the root are the working guide and
   the short entry point for any agent; they point here.

Where the two sets meet, Binc's wins for their material and ours wins for this
repo's code. Lucas's call on 2026-10-19: Binc's material may be used and
copied in this (private) repo; the mirror itself is still never written to.

## What is where

| Path | What | Loaded by Claude Code? |
|---|---|---|
| `CLAUDE.md` | How to work in this repo | Yes, every session |
| `AGENTS.md` | The same in the cross-tool format other agents read; imported by `CLAUDE.md` | Yes, through the import; other agents read it directly |
| `.claude/rules/*.md` | One enforced rule per file | Yes, every session (the directory, not a single `rules.md`) |
| `.claude/hooks/protect-binc-tree.sh` | Blocks Edit/Write under `projects/desktop/` | Runs before every edit, via `.claude/settings.json` |
| `shared/governance/policy/` | Binc's 33 policy pages (their `00_POLICY/`) | On demand |
| `shared/governance/workflow/` | Workflow rules, sign-off, decisions (their `01_GOVERNANCE/`) | On demand |
| `shared/governance/CANALV2-README.md` | Their one-screen index of the tree | On demand |
| `shared/governance/operator-brief.md` | The one-job operator brief (their `CLAUDE.md`, renamed so it is not picked up as ours) | On demand |
| `shared/governance/MANIFEST.md` | What was copied, from where, when, with checksums | |
| `shared/shapes/*.json` | The project's fixed shapes as JSON, with `check.py` | On demand |
| `queue/<project>/` | Job files for agents, seeded from the project's own queue | On demand |
| `docs/ADR-*.md` | Decisions about this repo's own architecture | On demand |

## Enforcement, and how it maps to Binc's agent permissions

Instruction files are context, not enforcement; Claude Code's docs say so.
A PreToolUse hook runs before a tool call and can block it, which is the
only mechanical enforcement available. Against `policy/agent-permissions.md`:

| Binc's rule | Enforced here by | Status |
|---|---|---|
| Nothing renamed, moved, overwritten or deleted; locked shots read-only | `.claude/hooks/protect-binc-tree.sh` blocks Edit/Write under `projects/desktop/` | Hooked (file tools only; shell commands rely on the rule) |
| Named yes for any download or install | nothing yet | Could hook Bash on `pip install`, `brew install`, `docker pull`, `hf download` |
| Named yes for any spend, USD 100 cap | nothing yet | Could hook Bash on `create_pod.py create`, `start.sh pod create`, `docker/swarm.sh deploy` |
| Named yes before a push to a shared repo | nothing yet | Could hook Bash on `git push` to non-origin remotes |
| No Slack, no client contact, no account or security changes | out of this repo's reach | Rule only |
| Stop and report on ambiguity | behaviour, not a tool call | Rule only |

The hooks that do not exist yet are listed so the gap is visible, not hidden.
Adding them is a small change to `.claude/settings.json`; whether to is a
decision for when an agent first runs against the job from this repo.

## Keeping it current

```bash
./governance/sync.sh          # after the mirror is refreshed from binc-PC
```

The manifest's checksums show what changed. If Binc's policy and ours ever
conflict, the fix is a conversation with Binc and a dated note in
`docs/`, not an edit to the copies.
