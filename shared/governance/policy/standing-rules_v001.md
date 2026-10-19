# Standing rules (Binc)

Sources: the handover of 2026-10-11 §2, project preferences, and Binc's instructions in conversation.

**Roles**
- Creative QC is Binc's alone: how the paint looks, how much it covers.
- Claude's job is technical: tracking, warps, technical consistency, and getting the pipeline working.
- Show full renders in motion, never a best-frames selection: *"if I don't see the mess, I can't tell you to fix it."*
- Approval means **a node plus Binc's visual check.** Claude's own numbers are not approval. His own load or run on binc-PC is the real test; sandbox-only work does not count.
- Match effort to stakes. Short, direct, no circling. Don't ask questions the files answer. Flag assumptions in one line.

**Files and versions**
- Versions only go up. Nothing is overwritten, moved or deleted. A new file is a new version. Fork rather than commit unless Binc authorises it.
- Names follow `<shot>_<what>_<detail>_v###.<ext>`. No UUIDs, seeds or tracker numbers in names; those go in `.meta.json` sidecars.
- The name on the source files wins any naming conflict. Naming problems are recorded and flagged, never gated.
- "We are not editors." Deliver exactly the frames served, with the same names and numbers.
- `06_REVIEW` is not cleanable: each job writes its own subfolder.
- Quick tests go into one flat file bucket (`80_TEST-BUCKET/`) for easy timeline loading.
- Backups: zero-compression archive of everything. **Never decide include or exclude for him; ask first.**

**Eyes, leads and paints**
- Hero eye is LEFT; the second eye is the same layers carried by measured disparity. Never switch eye mid-shot.
- Paints stay on the eye and frame he painted them on: *"I painted what I painted."*
- Lead = the first frame of each part.
- Anything that isn't real (placeholders, checkers) must fail loudly: REVIEW / FAIL stamps, NOT APPLIED in capitals.
- Paint intake: every lead frame to be painted must have its source frame and geo matte in `10_CORROSION/Gen_Paint_assets`. If they aren't there, they don't get painted.

**Quality and tooling**
- **IMAX projection.** Sub-pixel tracking errors are magnified on screen. Target well under 1 px at 4K.
- **Tooling.** Use existing, proven tracking and comp software rather than writing custom trackers. Any tool must run as a CLI or MCP on Linux or Mac. Fusion and Blender are both available.
- **Graphs** are real ComfyUI UI-format files: labelled nodes, a note per group, previews, logical process order, parked in the shot's `04_GRAPH`. Not Python scripts wrapped in a node.
- **Client and locked shots** (e.g. cgi-042) are not ours to edit or run.
- **Downloads, installs, spend, sending and publishing** need an explicit yes. Downloads need name, source and size first.
- **Infrastructure:** don't kill his processes. Don't touch the GCP project unless he says "go". Never paste or store API keys.
