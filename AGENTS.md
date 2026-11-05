# AGENTS.md

Entry point for any coding agent in this repo. Claude Code loads it through
`CLAUDE.md`; other tools read it directly.

**What this is.** ComfyUI workflows for IMAX restoration (stereo conversion,
corrosion clean-up) and the infrastructure to run them: a ComfyUI server for
the Mac and a CUDA image (`apps/comfy-app`), one app for RunPod pods
(`apps/runpod-dashboard`: Electron, a TypeScript core, the MCP server and the
CLI over it; no server, no Python), and a read-only mirror of the client
project (`projects/desktop/`). The goal it
serves is in `README.md`, "Goal".

**Rules, in order.**
1. `shared/governance/policy/agent-permissions.md` for anything touching the
   CANALV2 job: read-only on locked shots, named yes for installs, spend and
   anything leaving the machine, USD 100 cap, stop and report on ambiguity.
2. `.claude/rules/binc-tree.md`: never write into `projects/desktop/`.
3. `.claude/rules/branching.md`: feature branches off `develop`, `--no-ff`
   into `develop`, `--ff-only` into `master`, tests green first:
   `./start.sh test`.

**Jobs.** `queue/<project>/in/` holds job files; run one per session the way
`shared/governance/operator-brief.md` says, moving it to `running/` then `done/`.

**Running a BH shot on a pod.** `docs/RUNBOOK-ai-shot-generation.md`, through the `pod-manager` MCP only; update its Log in the same session whenever a step is proven or fails.

**Start here.** `shared/governance/README.md` for precedence and what is where;
`CLAUDE.md` for conventions and commands; `./start.sh` for running things;
`docs/ADR-004-where-the-workflows-run.md` for which machine does what.
