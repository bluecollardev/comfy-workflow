# CANALV2 decisions log

Dated decisions, each with its source. Standing rules live in `00_POLICY/`.

### 2026-10-09
Source: `claude/decisions-2026-10-09-1226.md`. These supersede the matching items in the agent brief and next steps.
- **Hero eye LEFT** (mono 2D prime). For corrosion it makes no difference.
- **Tunnel's mapping from their folders to our shots is accepted as is.** Our shot names follow BH.
- **corrosion-111 and corrosion-159** were added as mastered stereo ground truth, for stereo checks only.
- **Slug every shot** whether or not its plates are local. Placeholder Read nodes are muted; eyes for placeholders are assumed and flagged.
- **Spend cap:** USD 100 total (agents + cloud GPU) until more is known. This is Binc's own control, not an argument against an approach.
- **Claude Code on binc-PC: yes**, after the file structure and policies are confirmed.
- **Test host:** the Linux PC.
- **On hold:** Slack messaging (including the attention list) and the git repo (created once the project is built and organised).
- **Console update for Kyle:** a push from the file system, later.
- **Agent/compute stance.** Proxy-res work. Approved graphs are locked and the client runs them in their own stack and Queue. RunPod and GCP are GPU farms, not special-risk platforms.

### 2026-10-14
Source: Binc in conversation.
- Tracking and camera solve happen **outside the graph**, as a utility; the graph only loads the locked solve.
- Use existing tracking and comp software, not custom trackers; it must run as a CLI or MCP on Linux or Mac.
- Blender match-move is not an option for this job (time).

### 2026-10-15
Source: Binc in conversation and his review of the docs.
- **Slugs:** populate every shot in corrosion with the Comfy graph slug.
- **Kyle and the production are the client.** Kyle's workflow rules do not have authority over ours; the goal is symmetry with his workflow where our deliverable must match.
- **Delivery:** "I want a coding agent that has a list of shots that get completed on a daily basis, without having to reinvent the process every single deadline." "I have my own work to do."
- **Mesh and solve:** "if so create it with AI Image 2 Mesh and put it in your camera solved scene in Blender, then track the motion of the boat using a few motion tracking points over a cloud of points."
- **The ship is a rigid object:** the camera solve moves the lead-frame shape; the warp tracks only the relative residual between that shape and the tracker targets, not absolute pixel positions.
- **The comp is graded to match the frame**, then comped over the plate through the matte.
- **Never interact with the production's harness** (BH console repo, its scripts, MCPs, keys, ledger, console, Linear). The only exception is building parity into our workflow.
