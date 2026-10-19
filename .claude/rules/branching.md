# Branching and merging

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
