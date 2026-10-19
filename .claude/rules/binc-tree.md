# Binc's material: use it freely, never modify the source

`projects/desktop/` (CANALV2, ComfyUI-Shared) is a mirror of binc-PC and
belongs to BH / Binc. It is ignored by git on purpose.

**We can read whatever and do whatever with it** (Lucas, 2026-10-19): read it,
copy it, link it, track copies in this private repo, build on it. Examples:
`COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh` symlinks a node pack,
`governance/sync.sh` copies the policy pages, BincStereo is tracked under
`apps/comfy-app/custom_nodes/`, the queue scripts take `--comfy <url>`.

**We just cannot modify the source in that folder.** Never write, edit,
rename, move or delete anything under `projects/desktop/`, and never `git add`
it. If something there needs to change, it is a request to Binc, not an edit.
Work on a copy outside the folder.

Enforcement: `.claude/hooks/protect-binc-tree.sh` (PreToolUse) blocks Edit,
Write and NotebookEdit under `projects/desktop/`. Shell commands are not
intercepted; this rule covers them. When an agent runs *inside* the CANALV2
job (on binc-PC, against its queue), Binc's own
`governance/policy/agent-permissions.md` applies on top.
