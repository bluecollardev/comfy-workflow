# ADR-062: v1.7.4 is released ungated, on Lucas's say-so, for a demo

**Date:** 2026-11-25
**Status:** Accepted (Lucas, 2026-11-25: "i need this done in under an hour i have a demo ... then release an ungated patch version"). Not released yet.
**Context from:** [ADR-012](ADR-012-versioned-releases.md), `docs/RELEASING.md`, the rule that the full gate runs before every release and is skipped only on Lucas's explicit say-so for that patch, recorded with `--skip-gate`.

## 1. What happened (the evidence)
- The last full gate pass is v1.7.3 (2026-11-21). Since then about thirty merges went in with only their touched specs (Outputs rows and slots, stereo checkbox, stock cards, previews). The last core run showed 20 failures in five files (`podpull`, `autosync-async`, `autosync-output-pull`, `jobsregistry`, `panama-drop-async`); `podpull` fails on `develop` as well, the other four were not checked on `develop`.
- Lucas has a demo within the hour and asked for an ungated patch.

## 2. Decisions
1. **v1.7.4 is released with `./start.sh release patch --skip-gate`** (the skip is written into the release record as Lucas's decision of 2026-11-25).
2. **Before it:** the touched specs (Outputs, config, btncase) run once, one Playwright run at a time, and pass; failures there stop the release.
3. **The gate is owed:** the next patch runs the full gate; the five failing core files are fixed or recorded as known first.
4. **Nothing is pushed** beyond the release itself (tag and downloads repo); `develop` is pushed only if Lucas asks.

## 3. Consequences
- The DMG on the downloads page carries merges the full gate has not seen; the Releases notes say so.
- The gate debt is listed in [the demo plan](PLAN-OUTPUTS-DEMO-2026-11-25.md).
