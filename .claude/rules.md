# Claude Code Rules for comfy_workflow

## Branching & Merging Strategy

### RULE: Always base feature branches on `develop`

❌ **WRONG:**
```bash
git checkout master
git checkout -b feature/oauth  # Branching from master
```

✅ **CORRECT:**
```bash
git checkout develop
git pull origin develop        # Always ensure develop is up to date
git checkout -b feature/oauth  # Branch from develop
```

### RULE: Master updates are fast-forward only

When merging `develop` to `master` (releases only):

❌ **WRONG:**
```bash
git checkout master
git merge develop  # Creates merge commit on master
```

✅ **CORRECT:**
```bash
git checkout master
git merge --ff-only develop  # Fast-forward only
```

This keeps master as a clean linear history of releases.

### RULE: Feature merges to develop always use --no-ff

When merging feature branches back to develop:

❌ **WRONG:**
```bash
git merge feature/oauth  # May fast-forward
```

✅ **CORRECT:**
```bash
git merge --no-ff feature/oauth  # Always creates merge commit
```

This preserves feature branch history on develop.

## Binc's tree is read-only

`projects/desktop/` (CANALV2, ComfyUI-Shared) is a mirror of binc-PC and
belongs to BH / Binc. It is ignored by git on purpose.

❌ **NEVER:**
- write, edit, rename, move or delete anything under `projects/desktop/`
- `git add` anything under it, or copy its proprietary contents (node packs,
  graphs, plates, policies) into tracked paths without Binc's named yes
- run a script from inside it that writes back into it, except as a job file
  in `04_TRACKER/queue/` instructs and `CANALV2/CLAUDE.md` permits

✅ **INSTEAD:**
- read it, and link out of it: `COMFY_SHOTPIPE=v26 apps/comfy-app/setup.sh`
  symlinks a pack; the queue scripts take `--comfy <url>`
- keep our notes about it in this repo: `docs/CANALV2-STRUCTURE.md`,
  `projects/README.md`, `docs/PROMPTS.md`
- if something in the tree needs to change, it is a request to Binc, not an
  edit. `00_POLICY/agent-permissions.md` applies to any agent we run there.

## Summary

```
develop (integration, always up to date)
  ↑ (merge --no-ff from features)
  ↓
feature/your-feature (create from develop)

develop (stable, tested)
  ↓ (merge --ff-only to master)
master (releases only)
```

## When Developing

**Before starting ANY work:**
```bash
git checkout develop
git pull origin develop
git checkout -b feature/your-feature
```

**After finishing:**
```bash
git checkout develop
git pull origin develop
git merge --no-ff feature/your-feature
git push origin develop
```

**To release to master:**
```bash
git checkout master
git merge --ff-only develop
git push origin master
```

---

**This is ENFORCED. Do not deviate.**
