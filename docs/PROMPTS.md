# Where the prompts are

"Prompt" means three different things around this project. All three are
listed here. Counts are from the mirror on this Mac on 2026-10-19; binc-PC is
the master and may be ahead.

## 1. ComfyUI graphs (what ComfyUI calls a "prompt")

ComfyUI's API names a submitted graph a prompt (`POST /prompt`). The
corrosion and stereo graphs contain no text prompts at all: there is no
`CLIPTextEncode` in any of them. They are image-processing pipelines built
from the ShotPipe `BH_*` nodes, BincStereo nodes, masks, scalers, previews and
`MarkdownNote` boxes.

Two formats exist for every graph. The **UI** file is the canvas as saved
from the browser, with node positions. The **API** twin is the flattened form
the queue scripts post for rendering. `comfy run` converts UI to API itself.

| Where | Count | Format | What |
|---|---|---|---|
| `projects/desktop/CANALV2/10_CORROSION/<shot>/04_GRAPH/<shot>_graph_v###.json` | 241 | UI | Every version of every corrosion shot graph, 14 shots. The highest `_v###` is current; all 14 current graphs use `BH26_*` nodes. |
| the `_api.json` beside them | 106 | API | Twins for the queue scripts. |
| `projects/desktop/CANALV2/20_STEREO/<shot>/04_GRAPH/` | 12 | UI | Stereo slug graphs, inputs only. |
| `<shot>/07_DELIVER/<shot>_*-fork_v###/*_graph*.json` | few | UI | Review and audit forks, each with its own copy of the pack version it ran with. |
| `projects/desktop/CANALV2/80_TEST-BUCKET/*/` | 21 | API | Proofs of concept and batch-run graphs. |
| `projects/desktop/CANALV2/04_TRACKER/queue/in/v20_graphs_2026-10-17/*.zip` | 22 in one zip | API | The v20 solve-carry graphs bundled for the agent queue. |
| `apps/comfy-app/workflows/*.json` | 9 | UI | Stereo QC and `cgi-042` workflows. Tracked in git; the Mac install serves them through a symlink, so they appear in its Workflows panel and saves land back here. |

Everything in the first six rows is Binc's and ignored by git. Opening a
graph needs the pack it was built with: `COMFY_SHOTPIPE=v26
apps/comfy-app/setup.sh` links the current one into the Mac install. The
generators that write these graphs are `02_SCRIPTS/graph-builder*/`; graphs
are not hand-edited, the builder is changed and rerun.

## 2. Text prompts to generative models

The only text prompts in the pipeline go to **Gemini 3 Pro Image** ("Nano
Banana"), which generates paint patches for corrosion frames. The patch, its
matte and its prompt are kept together:

| Where | Count | What |
|---|---|---|
| `projects/desktop/CANALV2/10_CORROSION/Gen_Paint_assets/Gen_Paint_Output/<frame>_Gen/<frame>_Meta.json` | 5 | One per generated patch, beside `_Gen.png`, `_Matte.png` and a `_Comfy_Fusion_Graph.json` that composites it. Fields: `engine` (`gemini-3-pro-image`), `prompt`, `seed`, `steps`, `guidance_scale`, `color_space` (ARRI LogC4), `ocio_config`, `alignment`, `resolution`. |
| `<shot>/07_DELIVER/<shot>_audit-fork_gen-fill_v###/assets/<shot>_paint-sidecar_*.json` | 4 | The same fields carried with a delivered audit fork, so a reviewer can see what was asked of the model for that frame. |
| `projects/desktop/CANALV2/10_CORROSION/Gen_Paint_assets/INDEX*.csv` | 3 | The index `02_SCRIPTS/gen-paint-assets/` writes over all of it. |

The prompts are retouch instructions over an existing plate ("this is a
retouch of this exact film frame, not a new image"), not scene descriptions.
Client frames go to Google to produce them, which is why the project's
named-yes rule for third-party services applies.

## 3. Prompts to agents

Binc's tree carries its own instructions for Claude and Claude Code working on
binc-PC. They are policy, not suggestions, and they bind anyone running
anything in that tree.

| Where | Count | What |
|---|---|---|
| `projects/desktop/CANALV2/CLAUDE.md` | 1 | The operator brief: run exactly one job file, write its report, stop. No retries, no fixes, no judgement words. |
| `projects/desktop/CANALV2/00_POLICY/*.md` | 33 | One page per rule. `agent-permissions.md` is the one that says what an agent may do, needs a named yes for, and must never do, including the USD 100 spend cap. `00_READ_ME.md` is the index. |
| `projects/desktop/CANALV2/01_GOVERNANCE/*.md` | 3 | How work is run: `workflow-rules.md`, `hitl-signoff.md`, decisions. |
| `projects/desktop/CANALV2/04_TRACKER/queue/{in,running,done}/` | 19 in, 0 running, 0 done | One-job briefs for an agent: shot, tool, machine, exact commands, what must exist afterwards, when to stop. `README_queue_2026-10-17.md` explains the queue. |
| `projects/desktop/CANALV2/99_ARCHIVE/claude-md/` | 1 | A superseded operator brief. |
| `projects/desktop/CANALV2/02_SCRIPTS/AGENT_REPORT_2026-10-09.md` | 1 | A report an agent wrote back. |

Our own, in this repo and above it: `CLAUDE.md` (how to work here),
`.claude/rules.md` (branching), and `~/Workspaces/CLAUDE.md` for the whole
workspace. Binc's goal for an agent crew over this pipeline is in the root
README under "Goal"; the crew itself does not exist yet.
