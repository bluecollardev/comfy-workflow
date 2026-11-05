# ADR-034: An AI agent generates shots through MCP on its own, and the user asks for the output

**Date:** 2026-11-05
**Status:** Accepted as a requirement of the system (Lucas, 2026-11-05: "ai should be able to generate shots via mcp on their own", "i should be able to generate shots and ask for the output", "adr this requirement of the system", "keep the runbooks updated for various tasks"). The gaps below are open work.
**Extends:** ADR-028 (MCP can do everything the app does), ADR-022 and ADR-033 (rounds on the volume, placed for the graphs), ADR-004 (where the workflows run).

## Context

The cgi-042 session ran most of a shot's life through MCP: find the approved version in the bucket, bring up an H100 on the volume, pull the round, place its inputs, drive ComfyUI on the pod through the bridge. Each time a step was missing, a person had to type a shell command or click in the window, and what the AI learned was lost when the session ended.

## Decision

1. **The whole path from "process shot X" to the finished files is possible with MCP tools alone**, with no step that needs a person at a shell or in the window, except a named yes where the rules ask for one (`approved_by` for spend, a named yes for anything leaving the machine or going to a shared bucket).
   The path: find the approved version (bucket entry, hash) -> pod up on the volume -> pull -> place -> run the production graph on the pod through the ComfyUI bridge -> check -> pull the output home or return it -> stop the pod.
2. **The user asks for the output and gets it.** "Give me the left eyes of cgi-042" is answered by the agent with files in a known folder on this PC (or the S3 return path, after the named yes), a short report (frame count, size, sha256, where), and the pod stopped. The agent does not leave the result only on the volume.
3. **If a step has no tool, the tool is the work item.** An agent that finds a gap says so, and the gap is added to the table below and built (a tool in `mcp/` + the core call + the window's matching control, ADR-028's parity table), rather than worked around by hand-editing app files or asking the user for a shell command.
4. **Runbooks carry what was learned, and are kept current by the agent that learned it.** `docs/runbooks/` has one runbook per repeatable task, written as instructions for an AI. Whenever a step is proven, fails or changes, the same session updates the runbook's Log. A runbook is not finished until its Log shows the steps were run for real.
5. **Spend and safety do not relax.** The USD 100 cap, `approved_by`, the read-only `projects/desktop/`, and "never run a locked shot" apply to an agent working alone exactly as before. The agent states the price before it starts a pod and stops what it started.

## What exists, and the gaps (2026-11-05)

| Step | Tool | State |
|---|---|---|
| Find the approved version | `panama_rounds`, bucket read (aws, profile `panama`) | works; the entry's sha256 is the check. No MCP tool reads a single bucket file: the agent shells `aws s3 cp`. **Gap: `panama_read` (one small file from a round).** |
| Pod up, named, idle stop | `create_pod`, `resume_pod`, `recreate_pod`, `rename_pod`, `set_idle_stop` | works |
| Pull a round | `panama_pull` target pod, `panama_job` | works; `panama_job` is ~60 KB. **Gap: a compact progress view.** |
| Place inputs and graphs | `panama_place` (ADR-033) | proven on the real volume 2026-11-05: 156 files hard-linked, 3 graphs, second run changed nothing |
| Run a graph on the pod | comfy-bridge `queue_prompt`, `run_workflow`, `wait_for_prompt`, `upload_image`, `get_output`, `save_workflow`; the BincStereo nodes are present on the pod | exists; the **stereo production graph does not** (BH has none) |
| Write 16-bit TIFF eyes | none | **Gap: a save node/tool for 16-bit RGB TIFF, untagged, per frame** (SaveImage writes 8-bit PNG) |
| Bring the output home | `sync` direction pull (output, review, deliver), bridge `get_output` | works for the folders it covers; **Gap: a pull of an arbitrary output folder and a manifest (sha256 + bytes)** |
| Return to BH | none | **Gap: `panama_return` (upload to `returns/<round>/<shot>/` with the bh-return-1 manifest), behind a named yes** |
| Run a command on the pod | none | **Gap by design:** prefer a purpose-built tool (as `panama_place`) over a general shell |
| Stale session tools | `/mcp` reconnect | **Gap: the stdio server does not pick up new tools until the user reconnects**; the app's HTTP MCP is current but keeps its own job table |

## Consequences

- The shot runbook (`docs/runbooks/shot-stereo-conversion.md`) is the agent's script and the place the gaps above are tracked as they close.
- Building the stereo production graph and the 16-bit TIFF step is the next piece of work, tested on a few frames first, then recorded in the runbook.
- Every new MCP tool still goes through the parity table, `docs/MCP-ENDPOINTS.md` and the gate (ADR-028).
