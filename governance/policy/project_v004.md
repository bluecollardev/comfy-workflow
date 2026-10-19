# CanalV2: project governance (single reference)

Compiled 2026-10-15 for Brynley (Binc) Cadman. v002 added the harness rule (§9). v004 removes the rules Claude had written in (a proposed role, a recipe, a mapping table, a "no fall back" rule, conclusions in §10) and keeps Binc's words. v003 corrected §10 and added the job roles (§A), how Binc decided we run the project (§B), the production's handoff contract as a parity reference (§1b), and the slug builder in full (§7).

This file collects, in one place, every governance document we use on CanalV2. It covers:
- who does what on the production and on our side;
- how Binc decided we handle the project;
- the ComfyUI Workflow Engineering Contract v3 (full text), the only engineering contract on Drive (folder "comfy claude policy"), plus the production's handoff contract (`COORDINATION.md`) for parity;
- our standing rules and policies;
- decisions and agent permissions;
- structure and naming;
- the production (BH console) rules that bind us.

**Who writes the rules.** Every rule in this file is Binc's words or a quoted source document. Claude writes no rules and does not reword one into a new one. Where Claude disagrees, it says so once, with a reason, then builds it Binc's way (bh-internal-policy). Proposals are not rules and are not kept in this file.

**Where each rule lives.** Each section names its source. The source document stays the master. If this file and a source disagree, the source wins; fix this file.

**Order of authority, highest first:**
1. The production record: the BH console, Slack and the `panama-imax-redux` repo. It is the official status of every deliverable.
2. Binc's explicit instructions in conversation. They are recorded here when they are standing rules.
3. The Engineering Contract v3, for how graphs and workflows are built.
4. Our CANALV2 policies, in `00_POLICY/`.

---

## Contents
A. Job roles
B. How we handle the project (Binc's decisions)
1. ComfyUI Workflow Engineering Contract v3 (full text)
1b. The production's handoff contract (`COORDINATION.md`), parity reference
2. Standing rules (Binc)
3. Technical standards for corrosion: tracking, solve, carry, comp
4. CANALV2 policies (`00_POLICY/`)
5. Decisions log
6. Agent permissions
7. Structure, naming, tracker, inbox, collector, slug builder
8. Live requests and the attention list
9. Production rules: BH console / `panama-imax-redux`
10. Corrosion route on the production record
11. Known inconsistencies between documents
12. Document index

---

## A · Job roles

Sources: `PIPELINES-START-HERE-BRYNLEY.md`, `docs/2026-08-31-role-codification.md`, `docs/COORDINATION.md`, `docs/CLIENT-DELIVERY-RHYTHM.md` (production, read for parity only); `claude/agent-brief-2026-10-09.md`; Binc in conversation.

### People on the production

| Who | Role | Owns | Only they can |
|---|---|---|---|
| **Joe** | End client (Panama) | — | Give `client-approved`: a written, dated client verdict |
| **Kyle** (BH / Kinetic) | Production lead and supervisor; runs the BH console and `panama-imax-redux` | cgi, titles, photoreal, creature, and anything that needs Joe in the room | Look-dev register and truth-boundary calls; `look-locked` (a recorded accept); every `decisions/` record; approve and send any delivery bundle, Slack digest or outbound note |
| **Brynley (Binc)** | VFX / ICVFX supervisor; vendor to Kyle; second operator on the console | corrosion, archival/stock, conversion (stereo) | Creative QC and approval of our work; shot assignment on our side; permissions for our agents; spend on our side |
| **Tunnel** | Post house | Serves plates; judges stereo deviation | Their folder-to-shot mapping (accepted as is, 2026-10-09) |

Ownership is by class: don't fire or change a shot you don't own without a note on it.

### Roles on our side (CANALV2)

| Role | Who | Does | Never |
|---|---|---|---|
| **Supervisor** | Binc | Shots, creative calls, approvals (a node plus his visual check), permissions, spend cap | Operate the pipeline: paste, open or debug (Binc, 2026-10-15) |
| **Coordinator** | Claude, project session (cloud) | Briefs, the shot list and tracker, acceptance checks, project docs, staging and committing files to connected folders, Blender MCP | Approve its own work; send anything outside; touch the production harness |
| **Builder / runner** | Claude Code agent (binc-PC, or a RunPod/GCP container) | Builds, loads, runs and reports, from a brief | Guess: on any ambiguity it stops and writes a report |

Permissions for each role are in §6.

### The production's agent roles (parity reference, theirs, not ours)
Kyle's harness codifies four roles, without personas: **Look-Dev** (what the shot is for), **Pipeline** (did the machine do what we asked, on the ledger), **Coordinator** (what is true on the surfaces, who is blocked), **QA** (does the evidence exist; never fixes what it finds).
- No agent ever writes `verdict: accept` or `decision: go`.
- One writer per artefact.
- "Absence of a note is not approval."

We don't run their roles (§9).

---

## B · How we handle the project (Binc's decisions)

Each line names the date Binc decided it. Detail is in §5 (decisions) and §2 (standing rules).

**Where the truth is**
1. The BH console, Slack and the repo are the official record of every deliverable. CANALV2 is our working layer; if they disagree, theirs wins and we fix ours. (10-09)
2. Every live request from Kyle, Joe, Tunnel or BH gets an inbox entry and a row on the attention list. (10-09)

**Our pipeline is ours**
3. We build in our own pipeline: ComfyUI graphs under Engineering Contract v3, plus Blender, Resolve and Fusion as CLI/MCP tools on Linux or Mac. (10-09, 10-14)
4. We never interact with the production's harness except to build parity into our workflow. (10-15)
5. Brynley's method decides. A disagreement is raised once, with a reason, then built his way. (bh-internal-policy)

**How a shot moves**
6. Inbox entry → collector → slug (V1 graph, inputs only) → corrosion template graph → locked solve → run at proxy → review → deliver. (10-09; §7)
7. Tracking and camera solve are a utility outside the graph, done once at full res and locked. The graph only loads the locked solve. (10-14)
8. Work runs at proxy. When a graph is approved it is locked, and the client runs it in their own stack and Queue. (10-09)
9. Paint before conversion: one hero eye (LEFT), the second eye is derived. (10-09; production §10)
10. The paint is graded to match the frame, then comped over the plate through the matte. (10-15)

**Delivery has to be autonomous**
11. In Binc's words: "I want a coding agent that has a list of shots that get completed on a daily basis, without having to reinvent the process every single deadline." "I have my own work to do." (10-15)
12. Approval is a node plus Binc's visual check. Claude's numbers are evidence, not approval. (handover 10-11)
13. IMAX tolerance: well under 1 px at 4K. (10-11)

**Safety**
14. Versions only go up; nothing is overwritten, moved or deleted; fork rather than commit. (standing)
15. Spend cap USD 100 total until more is known. GCP only when Binc says "go". Never paste or store keys. (10-09, standing)
16. Client plates go to a third-party service only with Binc's yes for that service. (standing)
17. Backups: a zero-compression archive of everything; Binc decides include and exclude. (standing)

---

## 1 · ComfyUI Workflow Engineering Contract v3

**Source:** Drive › "comfy claude policy" › *COMFYUI WORKFLOW ENGINEERING CONTRACTv3*
https://docs.google.com/document/d/1CJuFip6au_RE8hELlL4GFCxPbO2oi7OEB9P559D_ggE/edit

**Worked example:** `cgi-042-common-nodes-v11-BincV3c-stereoRD.json` (Drive, in the same project folder as OPERATOR-SETUP.md).

**Edit the Drive document, not this copy.** The text below was copied verbatim on 2026-10-15.

### 1. Source of Truth
The visible, saved, GUI-loadable ComfyUI workflow is the authoritative definition of the pipeline.

Python scripts, custom nodes, CLI commands, MCP tools, APIs, Floyo, shell processes and LLM reasoning are subordinate implementation mechanisms.

Never create or maintain a second invisible version of the workflow outside the ComfyUI graph.

If execution is remote, the remote system must execute a faithful representation of the current local ComfyUI graph. Remote execution is not an independent workflow-authoring environment.

### 2. Human and LLM Operability
Build every workflow so that a technically competent human or another LLM can open the graph and determine:
- what enters the workflow;
- what each major stage does;
- what assumptions each stage makes;
- which parameters materially change the result;
- where intermediate results can be inspected;
- which assets are replaceable;
- what resolution and colour space are being used;
- where files are written;
- which stages are deterministic;
- which stages are probabilistic or generative;
- which stages require human approval;
- what can fail and why.

Understanding the workflow must not require reading the Python source code of a custom node.

### 3. Subgraph Architecture
Each major functional stage must be implemented as a clearly named ComfyUI subgraph wherever practical.

Examples: INPUT + OCIO · REFERENCE FRAME · HULL SEGMENTATION · HULL / WATERLINE MATTE · CAMERA SOLVE · SHIP / OBJECT TRACK · LEAD FRAME CREATION · HUMAN APPROVAL · PROJECTION / WARP · COMPOSITE · QC · OUTPUT

Important parameters must be promoted to the subgraph surface.

Do not bury output-affecting controls inside internal nodes merely to make the graph look cleaner.

### 4. Control / Process / Evidence
Every important pipeline stage should expose three concepts:
- **CONTROL**: inputs and parameters that determine behaviour.
- **PROCESS**: the implementation that performs the work.
- **EVIDENCE**: outputs that allow a human to inspect what actually happened.

Examples of EVIDENCE include: masks; point-track overlays; depth previews; camera-solve residuals; homographies; transform reports; before/after comparison; generated candidate; approved asset; file path; resolution; colour transform report.

A stage without observable evidence should be treated as a black box and redesigned where practical.

### 5. Custom Node Rule
Custom nodes may hide computational complexity.

Custom nodes may NOT hide pipeline policy.

Any setting that materially affects image content, geometry, tracking, colour, masking, generation, resolution or approval must either:
1. be exposed as a node/subgraph parameter; or
2. be explicitly documented on the graph as an invariant.

Do not embed creative or methodological decisions as unexplained constants in Python.

### 6. No Silent Behaviour
The following are prohibited unless explicitly represented in the graph or approved beforehand: silent resizing; silent cropping; silent reframing; silent colour-space conversion; silent model substitution; silent precision changes; silent fallback algorithms; silent source-file substitution; silent reference-frame changes; silent node bypasses; silent threshold changes; silent proxy/full-resolution substitutions; silent API-side workflow changes.

When an incompatibility occurs, fail loudly with a useful error describing:
- WHAT FAILED
- WHY IT FAILED
- WHAT INPUT WAS RECEIVED
- WHAT INPUT WAS EXPECTED
- WHAT THE OPERATOR CAN CHANGE

Do not silently repair the condition if that repair can alter the output.

### 7. Architectural Change Gate
Do not change an agreed pipeline methodology without first reporting:

PROPOSED ARCHITECTURAL CHANGE
- Current method:
- Observed problem:
- Proposed method:
- Why the change is necessary:
- Output-affecting differences:
- New assumptions introduced:
- Parameters that will be exposed:
- New failure modes:
- Stages affected:

Do not implement a material architectural change until it has been approved. Routine implementation details inside an already-approved method do not require approval.

### 8. Existing Advice Has Priority
Do not bypass an earlier explicit instruction because another method appears easier to code.

When new evidence conflicts with an earlier instruction, report the conflict. Do not silently reinterpret the instruction.

If a workaround violates the intended architecture, it is not a workaround.

### 9. Geometry and Resolution
Resolution, aspect ratio, crop, framing, coordinate system and reference-frame relationships are pipeline metadata. They must never exist only as implicit assumptions inside code.

If analysis is performed at proxy resolution and rendering occurs at delivery resolution, represent that relationship explicitly. A proxy result is not automatically considered equivalent to a delivery-resolution result.

Any resampling or coordinate transformation must be visible or clearly declared.

### 10. Colour
Preserve the defined source and working colour pipeline. Do not introduce hidden display transforms or colour-space conversions.

Source colour space, working colour space and output colour space must be identifiable from the graph.

Never assume an image file is display-referred simply because it is PNG, EXR, DPX or another particular format.

### 11. Generative Stages
A generative output is a candidate, not an approved asset. Generation and approval are separate stages.

Generative nodes must expose the parameters needed to reproduce or modify the result where supported, including relevant: model; LoRA; conditioning; prompt; seed; sampler; scheduler; steps; guidance; denoise / strength.

Do not automatically promote generated content into the production pipeline without the defined approval stage.

### 12. Human-in-the-Loop Assets
Clearly identify replaceable human-created assets. A replacement point must accept a conforming asset without requiring downstream reconstruction of the workflow.

The graph must state any requirements on the replacement: dimensions; framing; crop; colour space; alpha; naming; reference frame; file format.

Never describe an asset as freely swappable when hidden constraints prevent it from being freely swapped.

### 13. Visual Impact Coding
Because base ComfyUI primarily colours nodes rather than individual widget controls, expose important controls on dedicated nodes or subgraph surfaces where necessary. Use consistent visual categories for controls.

Recommended convention:
- **RED**: output-critical / high-risk control
- **ORANGE**: geometry, tracking or mask control
- **YELLOW**: generative / probabilistic control
- **BLUE**: I/O, paths, colour and configuration
- **GREY**: diagnostic or informational

The exact colours may be changed, but the semantic convention must remain consistent once established.

### 14. Side Effects
Do not hide filesystem writes, downloads, API submissions or other side effects inside processing nodes unless technically unavoidable.

Prefer explicit graph nodes for: LOAD · SAVE · DOWNLOAD · REMOTE EXECUTE · EXPORT · CACHE

Side-effect locations must be visible to the operator.

### 15. Execution Authority
Do not perform the following unless specifically authorized: Queue Prompt; start a render; launch a large GPU task; restart ComfyUI; interrupt an existing queue; kill a process; overwrite an approved asset; overwrite the last known-good workflow; download a large model; delete caches or files; change installed custom-node versions.

Building a workflow does not automatically grant permission to execute it. When asked to build, default to **BUILT - NOT RUN** unless execution was also requested.

### 16. Testing
You may autonomously perform inexpensive engineering checks such as: Python compilation; JSON validity; node registration; link validation; path existence; tensor dimension validation; obvious mathematical sanity checks.

Do not claim visual, artistic, stereo, compositing or restoration QC unless an appropriate human has performed it.

Use these status terms accurately. They are not interchangeable:
- CODE VALIDATED
- GRAPH LOADABLE
- EXECUTION TESTED
- TECHNICALLY VERIFIED
- HUMAN QC REQUIRED
- HUMAN APPROVED

### 17. Change Reporting
After modifying a workflow, report only concrete changes. For each revision provide: VERSION · CHANGED · UNCHANGED · NEW ASSUMPTIONS · NEW PARAMETERS · REMOVED PARAMETERS · CUSTOM NODE CODE CHANGED · FILES WRITTEN · EXECUTION STATUS · HUMAN QC STATUS · KNOWN ISSUES

Never state "fixed" merely because code executed without an exception.

### 18. Version Safety
Never overwrite the last known-good workflow during development. Create a new revision. The filename and graph notes must make clear what changed.

Do not use ambiguous labels such as FINAL, FINAL2, NEWFINAL or WORKING unless the operator explicitly requests them.

### 19. Debuggability
When a failure occurs, do not immediately rewrite the workflow. First identify the stage at which the failure becomes visible. Expose or inspect the relevant intermediate output.

Distinguish: INPUT FAILURE · DATA / FORMAT FAILURE · ANALYSIS FAILURE · TRACKING FAILURE · MASK FAILURE · GENERATION FAILURE · WARP / PROJECTION FAILURE · COMPOSITE FAILURE · COLOUR FAILURE · EXECUTION / INFRASTRUCTURE FAILURE

Do not solve a downstream symptom by changing an unrelated upstream methodology.

### 20. Prime Directive
Prefer an explicit, inspectable and slightly verbose workflow over a clever opaque workflow.

The operator must never discover an important design decision only because the workflow broke.

If an implementation choice would surprise the operator, expose it before implementing it.

### Clarifications on record (`claude/contract-adoption-2026-10-09.md`, `00_POLICY/bh-internal-policy.md`)
- **QC measures report and never gate.** This covers stereo QC, colour step and alignment numbers.
- **Input incompatibilities fail loudly** with the five §6 fields. This covers wrong size, missing file, untagged colour and ambiguous channel.
- **"BUILT - NOT RUN" applies only to client-approved, locked shots** (e.g. cgi-042, Kyle's). Our open shots can be worked on and run on request.
- **Kyle's own contract versions** (his COMFY_GRAPH_PACKAGE / engineering contract) are his to run. We stay as symmetrical with them as possible, but we don't adopt them.

---

## 1b · The production's handoff contract (`COORDINATION.md`), parity reference

**Source:** `~/panama-console/docs/COORDINATION.md` (first draft, 2026-08-31) and `docs/2026-08-31-role-codification.md`. Theirs, read only, reproduced in short.

**Single-writer ownership**
- One writer per file at a time; everyone else files a note.
- No destructive git operation on a file another lane owns. Lost content is re-landed by a targeted edit, never by a revert.
- The ledger is append-only. The record layer (verdicts, decisions) is written only by Kyle and the client, through the console.

**Brief** (coordinator → worker). Valid only with all of:
- ticket and shot ids taken from the decision record and checked against `project.json`;
- the decision file it executes;
- the exact files the recipient may write;
- a spend cap;
- every claim from a note quoted verbatim with its section, or marked `[needs verification]`.

A brief is a claim, not an instruction: the recipient's first act is to verify it. A brief that fails a field is returned whole, with the field named; the recipient never repairs it.

**Result** (worker → coordinator)
- Specifics: absolute paths, request ids, ledger costs, what failed and how it was handled, what needs Kyle.
- Visible on the surface that should show it: "built but invisible" is an invalid result.
- Honest labels: "COMPLETE (N unresolved)", never a bare COMPLETE.

**Verdict** (QA → coordinator). A per-condition table: **met** (evidence path), **failed** (evidence path), or **not addressed, still open**. Nothing QA finds is fixed by QA.

**Artefact resolution.** One resolver, no private lookups, no copied keys. If a naming convention changed tomorrow, zero files should silently produce nothing; one should fail loudly.

---

## 2 · Standing rules (Binc)

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

---

## 3 · Technical standards for corrosion: tracking, solve, carry, comp

Source: Binc's instructions, recorded in project memory.

**Method**
- **Comp logic, not software logic.** Use proven digital-comp methods made quicker; don't reinvent. Build the framework first, then solve comp issues, so each shot isn't a fresh workflow design.
- **Tracking method.**
  - Solve the camera from ONE eye, then derive the second eye.
  - Track hull features as a point cloud. Keep only points that move coherently as one rigid body in 3D; reject noise by physics, not denoising.
  - Use the 6-DoF motion to predict point positions as a verification loop.
  - The ship is a solid object; the warp handles the relative residual, not absolute pixel positions.
- **Solve rule.** The solve is done once on full-res data and then locked. Proxy runs only apply the locked solve, scaled; they never re-track. Tracking and camera solve are a utility done outside the graph; the graph loads the locked solve. Tracking must not change the outcome of a shot.
- **Track health.** Track data exposes its health per frame. Raw track data does not drive the surface directly; it is solved into translation and deformation curves that remove frame-to-frame noise.
- **Order of work.** No man-hours on Gen plates until tracking is proven. Fix other issues (second eye, colour) after a working tracker. Once a quality milestone is reached, nothing is rebuilt around it; follow-on work is a fork with minimal change.

**Carry and comp**
- **Carry structure.** The geo matte is a null/parent used only for alignment: it defines the coordinates and drives the warp, and is never visible in the comp. The hand-painted matte is the comp mask. Fill and painted matte are children of the geo matte and get exactly its warp. No transfer modes, no edge re-fitting, no feathering inside the carry.
- **A mask is a mask.** The painted comp matte is not a hull silhouette (its border can be square). A build that snaps it to the hull is a bad build.
- **Geo mattes keep containers.** They are fine-tuned in the paint pass. The Gen may repaint everything inside the geo matte; the painted comp matte decides what reaches the comp.
- **Comp.** The paint is graded to match the frame, then comped over the plate through the matte. The comp is not A+B+C.
- **Colour.** Correct the palettes that drive the image, not every pixel; per-pixel gain matching is colourisation and gets noisy. The clean hull is a PBR albedo texture in a bitmap. Mattes are raw linear greyscale with no ICC or gamma chunks, used exactly as painted.
- **Foreground.** Containers, tugs and people are comped back on top with a SAM3 + Depth Anything 2 temporal matte.

**Stereo and review**
- Generate on the hero eye only. The second eye is derived. Stereo QC reports; the post house judges stereo deviation.
- The client review deliverable is a full-length mono MP4 per shot on the list, kept in one PC delivery folder and copied to Drive.

---

## 4 · CANALV2 policies (`/home/binc/CANALV2_r3/CANALV2/00_POLICY/`)

The policy files are one page each. They are reproduced here as they stand on binc-PC (2026-10-15).

### engineering-contract.md
This file points to the Drive document (§1 above). In short:
- The graph is the readable, labelled, ordered, previewed process.
- Lettered boxes, a note at the top of each, a preview after each stage.
- Stock nodes first; custom nodes only for what ComfyUI lacks.
- No silent behaviour, a change report on every revision, never overwrite a last known good.

### bh-internal-policy.md
- **Comp logic, not software logic.** Framework first, then comp finesse. Small single-purpose nodes with previews. A graph never auto-corrects or guesses.
- **Brynley's method decides.** A disagreement is raised once, with a reason. Then it is built his way.
- **Read-only, never touched:** v4, the frozen ComfyUI instance, Brynley's graphs, the paint-app repo, and the panama-console repo (Kyle's).
- **Nothing is overwritten, moved or deleted.** New work goes in new files, forks or new folders.
- **Grade and matte.** One global CDL per shot, the same in both eyes. One comp matte (white = fill, black = plate).
- **Hero eye: LEFT** for the mono 2D prime in a conversion pipeline (decided 2026-10-09). Corrosion is a comp element, so it makes no difference there.
- **Every shot gets a V1 slug** as soon as it has an inbox entry, even when its plates are not local yet. The Read nodes are muted placeholders, swapped later.
- **Stereo.** Generate on the hero eye. The second eye is the same layers offset by disparity. Only grain is per eye. Stereo QC reports only and never gates.
- **Locked or client-approved shots** (e.g. cgi-042) are never edited or run by us.
- **Downloads, installs, spending, sending and publishing** need an explicit yes (name, source, size for downloads).
- Match effort to stakes. Keep answers short.

### bh-symmetry.md
Same shape everywhere; only the contents differ.
1. Every shot folder has the same eight subfolders.
2. Every graph has the same lettered boxes in the same order:
   - 00 read first and change report;
   - A input;
   - B lead assets or clean plate slots;
   - the processing boxes;
   - the handoff.

   A note at the top of every box, a preview after every stage.
3. Every shot has an inbox entry before it has a folder, and a tracker row after.
4. Both eyes use the same layers. The hero eye generates; the second eye follows by measured disparity. The mono 2D prime is LEFT. Only grain is per eye.
5. Every shot type uses the same names for the same things.

A new shot type copies the corrosion template and changes only what the picture needs.

### naming.md
- **General.** Simple, hierarchical, common sense. A file's name alone says what it is.
- **Shot folder** = the client's name: lowercase, hyphen (`corrosion-051`, `enhance-141`, `archival-080a`).
- **Folders:** lowercase, hyphens, no spaces, no trailing spaces, no punctuation.
- **Working files:** `<shot>_<what>_<detail>_v###.<ext>`, e.g. `corrosion-051_hull-matte_lead-a_v003.png`.
- **Eye** spelled out (`left`, `right`). Frame numbers padded as served.
- **Dates** only in reports, logs and request folders (`2026-10-09`). Request folders are `<yyyy-mm-dd>_<topic>`.
- **No UUIDs, hashes, seeds, prompt ids or tracker numbers** in any file name. A number that identifies the thing to a person goes in the name. A number that only identifies it to a machine goes in a sidecar.
- **Sidecar:** `<filename>.meta.json` beside the file (seed, model, prompt, checksum, source link, who, when).
- **Shot folder shape:** `00_READ_ME.md | 01_ASK | 02_SOURCE | 03_WORK | 04_GRAPH | 05_TEMPS | 06_REVIEW | 07_DELIVER`

### served-names.md
Frames the post house served keep their names and frame numbers exactly, and every frame we deliver goes out with the same names and numbers.

A clerical fix (e.g. `[108521-NNNNNN].dpx` → `NNNNNN`) is allowed only when recorded in `01_GOVERNANCE/change-log.csv` with the original name, the new name, who and why.

Our shot names (`corrosion-056`) may differ from their folder names (`corrosion-052_3D`). Both are written in the inbox entry; neither is changed to match the other.

### versioning.md
- Versions only go up (`v001`, `v002` …). The current version is stated in the shot's `00_READ_ME.md`, never by renaming.
- Nothing is overwritten, and a last known good is never replaced.
- Superseded work moves to `99_ARCHIVE`: copy first, and the original is left in place unless Brynley says otherwise.
- Approved or locked versions are marked in `00_READ_ME.md` and tagged in git.
- Graph revisions carry a CHANGE REPORT note (contract §17).

### colour.md
- **Plates:** DPX 2.0 BE, 4096×2160, RGB 10-bit packed, printing density.
- **Cineon log to linear:** reference white 685, reference black 95, gamma 0.6. Stated on every Read node, never guessed; the DPX header is reported next to it.
- **Comp** in scene-linear float: `plate*(1-m) + fill*m`.
- **Grade:** one global CDL per shot, the same in both eyes (identity until Brynley sets it).
- **Fills and mattes** carry plate-coded values. Soft matte values are the creative grade and are used exactly.

### storage-and-backup.md
- **Root:** `~/CANALV2` on binc-PC (currently `/home/binc/CANALV2_r3/CANALV2`). Not on the IronWolf (`/mnt/storage`), which is for parking and mirroring only.
- **Source plates** stay where delivered and are LINKED (`02_SOURCE/SOURCES.csv`), never copied or moved.
- **Run output** goes to a working NVMe, not the IronWolf. Every run writes per frame and can resume after a power loss.
- **Backups:** a zero-compression archive of everything, then that is backed up. Include and exclude are always Brynley's decision, asked first.
- **Version control:** plain git, one private text-only repo (policies, scripts, templates, graphs). No plates, no client tracker or inbox, no force-push.

### agent-permissions.md
See §6.

---

## 5 · Decisions log

### 2026-10-09
Source: `claude/decisions-2026-10-09-1226.md`. These supersede the matching items in the agent brief and next steps.
- **Hero eye LEFT** (mono 2D prime). For corrosion it makes no difference.
- **Tunnel's mapping from their folders to our shots is accepted as is.** Our shot names follow BH.
- **corrosion-111 and corrosion-159** were added as mastered stereo ground truth, for stereo checks only.
- **Slug every shot** whether or not its plates are local. Placeholder Read nodes are muted; eyes for placeholders are assumed and flagged.
- **Console update for Kyle:** a push from the file system, later.
- **Spend cap:** USD 100 total (agents + cloud GPU) until more is known. This is Binc's own control, not an argument against an approach.
- **Claude Code on binc-PC: yes**, after the file structure and policies are confirmed.
- **Test host:** the Linux PC.
- **On hold:** Slack messaging (including the attention list) and the git repo.
- **Agent/compute stance.** Proxy-res work. Approved graphs are locked and the client runs them in their own stack and Queue. RunPod and GCP are GPU farms, not special-risk platforms.

### 2026-10-14
Source: Binc in conversation.
- Tracking and camera solve happen **outside the graph**, as a utility; the graph only loads the locked solve.
- Use existing tracking and comp software, not custom trackers; it must run as a CLI or MCP on Linux or Mac.
- Blender match-move was ruled out for time on 10-14. That was reopened on 10-15: Blender solve plus mesh is under test.

### 2026-10-15
Source: Binc in conversation.
- **Delivery:** "I want a coding agent that has a list of shots that get completed on a daily basis, without having to reinvent the process every single deadline." "I have my own work to do."
- **The comp is graded to match the frame**, then comped over the plate through the matte.
- **Never interact with the production's harness** (BH console repo, its scripts, MCPs, keys, ledger, console, Linear). The only exception is building parity into our workflow: read, then reproduce in ours (§9).
- "The repo's corrosion route can't make the deliverable you were hired for. Look at what notes/57 actually measured: I was hired when this failed." (§10)

---

## 6 · Agent permissions

Sources: `claude/agent-brief-2026-10-09.md` and `00_POLICY/agent-permissions.md`.

**Roles**
- **Binc:** shots, creative calls, approvals, the GUI look at each graph, permissions.
- **Claude (project session, cloud):** briefs, acceptance checks, review of reports, project docs, file staging and commits to connected folders, Blender MCP.
- **Claude Code agent (binc-PC, or a RunPod/GCP container):** builds, loads, runs and reports. Works from the brief.

| Action | Claude (project) | Claude Code agent |
|---|---|---|
| Read v4, frozen ComfyUI, Binc's graphs, paint-app repo | yes | yes, read-only |
| panama-console (their harness) | read docs only, for parity | read docs only, for parity; never run, fire, commit or post (§9) |
| Write or change any of those | never | never |
| Create new folders, forks, new versions | yes | yes (new names only, nothing overwritten, moved or deleted) |
| Delete anything | never | never |
| Run workflows on OPEN shots at proxy | on request | yes, within the job given |
| Run or edit APPROVED / LOCKED shots (e.g. cgi-042) | never | never |
| Install into CanalV2 ComfyUI | no | only after Binc's named yes |
| Install in a throwaway ComfyUI / container | no shell | yes, after a named yes for any download (file, source, size) |
| Spend on RunPod / GCP / APIs | no | up to the cap Binc sets, per job; stops at the cap |
| Send to the client, Kyle, Tunnel, Slack, email | never | never |
| Publish, share, change account or security settings | never | never |
| Client thread content | project docs only | not given to the agent unless Binc says |

- An agent that meets an ambiguity stops and writes a report. It does not guess.
- Every run is resumable: per-frame writes, checkpoint, restart-safe.
- Uploading client plates or footage to a third-party service needs Binc's explicit yes per service.

---

## 7 · Structure, naming, tracker, inbox

Source: `claude/master-structure-and-inbox-policy-2026-10-09.md`.

**Design test:** an elder VFX hand opens any folder and knows what it is from the name.

```
CANALV2/
├── 00_POLICY/        rules only
├── 01_GOVERNANCE/    workflow rules, sign-off, change log, delivery schedule
├── 02_SCRIPTS/       nodes, tools, collector, graph slug builder
├── 03_INBOX/         one entry folder per shot or live request
├── 04_TRACKER/       work tracker (plain CSV)
├── 10_CORROSION/     shot folders + Gen_Paint_assets/
├── 20_STEREO/
├── 30_CREATIVE/
├── 40_TITLES/
├── 50_RND/
├── 80_TEST-BUCKET/   flat bucket for quick tests (Binc, 2026-10-14)
├── 90_DELIVERIES/    only what has gone out, versioned
└── 99_ARCHIVE/       superseded, never deleted
```

**Tracker** (`04_TRACKER/`):
- `shots.csv`, `deliverables.csv`, `schedule.csv`, and a readable `TRACKER.md`.
- Status words: waiting, ready, live, in review, approved, delivered, closed.
- `locked = yes` when the client approves.
- Contract §16 terms live in graph reports, not the tracker.

**Inbox** (`03_INBOX/`):
- One folder per entry, holding `ENTRY.md` and `ASSETS.csv`.
- States: new, collecting, waiting, ready, live, delivered, closed.

**Collector** (`02_SCRIPTS/collector/collector.md`; spec only, not built yet)
For each row of `03_INBOX/<entry>/ASSETS.csv`:
1. Check the location exists. A required asset that is missing puts the entry in `waiting` and is listed. Never guess, never substitute.
2. Count frames; check they are contiguous and the same size; compare with the entry; report differences.
3. Make proxies into the shot's `02_SOURCE`. Originals are never copied over, moved or changed.
4. Write `COLLECT_REPORT.md`: found, missing, proxies made, sizes.
5. Only when every required asset is found: set the entry live, build the shot folder, add the tracker rows, run the slug builder.

### Slug builder

**Source:** `02_SCRIPTS/slug-builder/build_slug.py` with `slugkit.py` (on binc-PC, read 2026-10-15); spec in `claude/master-structure-and-inbox-policy-2026-10-09.md` §7.

**What it is.** It reads one inbox entry and builds the shot folder plus the V1 slug graph: a real ComfyUI UI-format graph that loads the inputs and processes nothing. Every shot gets a slug as soon as it has an inbox entry, even before its plates are local (Binc, 2026-10-09).

**Run**
```
python3 02_SCRIPTS/slug-builder/build_slug.py <CANALV2 root> corrosion-110 [more shots]
python3 02_SCRIPTS/slug-builder/build_slug.py <CANALV2 root> --all
```
`--all` builds every entry with `kind: shot` and `build_slug: yes` in its `ENTRY.md`.

**Inputs**
- `03_INBOX/<shot>/ENTRY.md`: type, eyes (stereo or mono), hero eye, their folders, first/last frame, timecode, format, reference frame, Deliverables checklist, Flags.
- `03_INBOX/<shot>/ASSETS.csv`: one row per plate (role, eye, part, location, pattern, found, checked).
- The BH node pack (`02_SCRIPTS/nodes/ComfyUI-BH-ShotPipe-v6`, or `BH_PACK_DIR`), used to validate the graph.

**What it writes** (new files only)
- The shot folder in its type folder (`10_CORROSION`, `20_STEREO`, `30_CREATIVE`, `40_TITLES`, `50_RND`) with the eight subfolders.
- `01_ASK/ENTRY.md` and `ASSETS.csv`, copied once.
- `02_SOURCE/SOURCES.csv`, links to the plates. It is never overwritten: if the content changed, it writes `SOURCES_v###.csv` beside it.
- `04_GRAPH/<shot>_graph_v###.json` at the next free version. It never overwrites.
- `00_READ_ME.md`, only if there is none.

**The graph it builds** (lettered boxes, left to right)
- **00 READ FIRST**: status line "SLUG V1 - INPUTS ONLY. OPEN FOR WORK"; shot, eyes, hero eye, frames, format; colour stated (Cineon log to linear, 685 / 95 / 0.6, never guessed); the Flags and Deliverables from the entry; the colour-code legend (contract §13).
- **00 CHANGE REPORT**: the twelve contract §17 fields. Execution status: BUILT, NOT RUN.
- **A INPUT**: one `BH_ReadSequence` per eye and part (LEFT and RIGHT for stereo; LEFT only for mono), each with a first/middle/last preview and a report (size, DPX header, colour). A plate that is not local yet becomes a **muted placeholder** Read node, named with its expected source; swap the folder and un-mute.
- **B CLEAN PLATE SLOTS**: B1 clean plate (Gen) and B2 comp matte (luma, white = fill). Both muted until a file is supplied, so Queue cannot fail on them.
- **C HANDOFF**: SLOT notes for the next stages (track, solve, carry, merge, creative, comp, second eye, write), which come from the corrosion template. Nothing left of this box is rewired.

**Failure.** A missing entry, a wrong kind, or a graph that fails validation against the pack STOPS the build with the five contract §6 fields: WHAT FAILED, WHY, RECEIVED, EXPECTED, OPERATOR CAN.

**State (agent report, 2026-10-09)**
- 23 slugs built (14 live, 9 waiting); all 23 pass the contract linter (`02_SCRIPTS/linter/lint_graph.py`).
- The active builder is r4 (writes no `.pyc`, never overwrites `SOURCES.csv`); r3 is kept as `build_slug_r3_old.py`.
- corrosion-051 has no slug: its entry says `build_slug: no` because its graph is Binc's v6.

**Open, Binc's call (from that report)**
1. A slug for corrosion-051 next to the v6 graph: yes or no.
2. Should the builder draw a "00" box around READ FIRST and CHANGE REPORT, to match bh-symmetry?
3. Should it skip a new version that would be identical to the newest one? Today, `--all` re-run adds 23 identical v002 graphs.

**After the slug.** The processing graphs (`<shot>_graph_v###.json` with track, carry and comp) are generated by `02_SCRIPTS/graph-builder/build_master_v15.py` from the corrosion-051 template: `SCALE=0.25 python3 build_master_v15.py <slug|all> <sandbox|device> [version]`. Same rule: new versions only.

---

## 8 · Live requests and the attention list

Source: `claude/live-requests-and-attention-list-2026-10-09.md`.
- **The BH console, Slack and the repo are the centre of the official deliverables.** Where our tracker and the official record disagree, the official one wins and we fix ours.
- **Every live request gets an inbox entry.** That means any request, question or side note from Kyle, Joe, Tunnel or BH. Kinds: `shot`, `request`, `question`. Request and question folders are `<yyyy-mm-dd>_<topic>`.
- **The attention list** is a private Slack List in Binc's space, created only on his yes. Columns: item, kind, from, received, due, status, inbox entry, Slack link, next action. Status words: needs me, waiting on them, in progress, done.

---

## 9 · Production rules: BH console / `panama-imax-redux`

Source: `~/panama-console` (Kyle's repo; Binc is second operator): `CLAUDE.md`, `docs/OPERATOR-SETUP.md`, `docs/PIPELINES-START-HERE-BRYNLEY.md`.

> **RULE (Binc, 2026-10-15): we never interact with their harness, except to build parity into our workflow.**
> - **Allowed:** read their docs, routes and results, and reproduce in our own pipeline whatever our deliverable must match.
> - **Never:**
>   - run their scripts, fire their routes, or use their MCPs, keys or ledger;
>   - commit, push or write into their repo;
>   - post to their console or Linear.
> - Running their harness from our side is not possible and not our job.

**Read-only for us, and only as a reference for parity.** The rules below are theirs; we mirror them where our workflow must match.

**Harness**
- Claude Code runs in the repo as the orchestration layer. Fal and Runway MCPs fire; `linear-server` carries the review loop. *"Claude as the orchestration layer, Fal to fire. No ComfyUI."* (Kyle's lanes.)
- **The console is the master.** Verdicts and comments go through the hosted console (https://panama-console.vercel.app) so they reach Linear and the record. A verdict typed into a note is invisible to the graph.
- **Read before acting:** `START-HERE.md`, `docs/METHODOLOGY.md`, `films/<film>/STATE.yaml`, `films/<film>/notes/` (`15-loop-log.md` before repeating any experiment).

**Ownership and records**
- **Ownership is by class.** Brynley: corrosion, archival/stock, conversion. Kyle: cgi, titles, photoreal, creature, and anything that needs Joe in the room. Don't fire a shot you don't own without a note on it.
- **Context lands on the shot.** Every call, note or reaction is written to a file under `notes/`, `boards/`, `meetings/`, `decisions/` or `docs/`, naming the canonical shot id in the text (e.g. `corrosion-058`). `shot_context.py` finds context by id.
- **Shot ids** are `<type>-<NNN>` (decided 2026-09-03); element suffix letters allowed. Never write a new id by hand.

**Spend and generation**
- **Every generation goes through `fireAndLog()`** (`scripts/cost-tracker.mjs`). The ledger is client-billable: it is the invoice basis. A raw `fal.subscribe()` is a ledger hole.
- **Experimentation is 720p SDR.** `--hdr` / `--exr` / `--res 1080p` are a deliberate final-pass opt-in.

**Git**
- One branch, `master`, path-scoped commits. `git pull --rebase` before work; commit by explicit path, never `git add -A`; push after each commit.
- `ledger.jsonl` and `15-loop-log.md` merge by union.
- Never hand-resolve `project.json` or `index.json`.
- **Never run** the sync job, the exporter, the media build or a deploy from his tree. **Never commit** `.env` or fal credentials.

**Picture rules**
- No handheld, ever. Locked-off or mechanically smooth camera (stereo convergence on a giant screen).
- Clean a plate frame (burn-ins, watermark, letterbox) before it becomes a reference. Text is a finishing layer.

**Skills and setup**
- Skills: `bh-model-routing`, `bh-decision-guardrails`, `google-devdocs-style`, `bh-core`, and the `superpowers` plugin.
- MCP: `linear-server` with his own OAuth. Optional: `openrouter`, `runway`/`kling`, `claude-in-chrome`.

---

## 10 · Corrosion route on the production record

Source: `PIPELINES-START-HERE-BRYNLEY.md` §3 and `notes/57-corrosion-aleph-test.md`.

**Brief**
- **Reduce, not eliminate.** Panama are embarrassed by how corroded the hero ship looks, but it must not look like it rolled off the production line.
- It is the same ship every time (the Merlion, ~15 angles, helicopter and canal level). One approved treatment covers the band. Corrosion plus archival is ~50% of the film.
- **Paint BEFORE conversion, never after:** one plate to paint, not two eyes.

**Routes on their record**
- **Deterministic route** (`plate-paint-fresh.py`):
  - ECC hull track;
  - on the reference frame: a depth-derived hull mask with hold-outs, a stain matte, and a chroma LUT;
  - in Fusion: steady the hull (`CornerPositioner`), light the paint from a blur of the current frame, unsteady, Merge.
- **Aleph route** (notes/57, 2026-09-04): Runway `aleph2` video-to-video carrying a painted lead frame as its keyframe. Their note calls it "the best route measured".
- **Rejected routes, not to be re-tried:** per-frame inpaint (it jumps) and a frozen still (one frame's light). Source: notes/43 §10.
- **Proposed by Brynley, not built:** an IC-LoRA trained on the Merlion's paint (BHSOM-736).

### What notes/57 actually measured, and why it cannot make our deliverable
> **Binc, 2026-10-15:** "The repo's corrosion route can't make the deliverable you were hired for. Look at what notes/57 actually measured: I was hired when this failed."

| | notes/57 measured | The deliverable needs |
|---|---|---|
| Shots | **one**: the 058 bow plate, 93 frames, "the kind shot" (its own words) | the corrosion list, every shot at full length (058 alone is 539 frames) |
| Picture | 1920×1012, 24 fps, an mp4 hosted at fal, SDR (`$0.28/s SDR`) | 4096×2160 10-bit DPX in, Cineon, the plate's own frames and names out |
| Eyes | mono | stereo: hero LEFT, second eye by measured disparity |
| Metrics | flicker, saturation, "redder-than-plate" pixels, texture against the clean hull | lock to the hull: well under 1 px at 4K over the whole shot |
| Track or lock | **not measured.** Aleph "does not need our track at all" | the carry must stay locked to a rigid hull |
| Its own caveats | "One shot is not nine"; the next test (058 or 051, hand-rotoed keyframe) "should be run before anyone commits the class to this route"; the flicker metric did not reproduce (≈3× off the published numbers) | — |
| State of the class in the same note | 058 "will not track, fails at frame 267"; 160 and 064 "track poor"; 148 "gate PASS at **5.43 px**"; credits at 40 | 5.43 px is many times the IMAX tolerance |

---

## 11 · Known inconsistencies between documents

| Item | Says | Correct | Source of the correction |
|---|---|---|---|
| Hero eye | agent brief and the 051 `00_READ_ME`: RIGHT | **LEFT** | decisions 2026-10-09 |
| Root folder | storage policy: `~/CANALV2` | in use: `/home/binc/CANALV2_r3/CANALV2` | the tree on binc-PC |
| ComfyUI in use | handovers: CanalV2 API at `127.0.0.1:8188`, models in-install | running instance on port **8189**; input, output and models in `~/ComfyUI-Shared` | ComfyUI log, 2026-10-15 |
| "Signed off" v4 | older handoffs | **v4 was rejected** (Kyle); it's a paint process, not a photoreal texture comp | Binc |
| Frozen ComfyUI `~/ComfyUI-Installs/ComfyUI` | "production / signed-off baseline" | **leftover, zero recoverable data** | Binc |
| Harness | production harness: Claude Code + Fal/Runway, no ComfyUI (Kyle's lanes) | **ours is separate.** We never use their harness; we only build parity into our own contract-governed workflow | Binc, 2026-10-15 (§9) |

---

## 12 · Document index

| Document | Where |
|---|---|
| Engineering Contract v3 (master) | Drive › comfy claude policy |
| CANALV2 policies | `/home/binc/CANALV2_r3/CANALV2/00_POLICY/` |
| Contract adoption | project: `claude/contract-adoption-2026-10-09.md` |
| Agent brief | project: `claude/agent-brief-2026-10-09.md` |
| Decisions 2026-10-09 | project: `claude/decisions-2026-10-09-1226.md` |
| Structure, inbox, tracker | project: `claude/master-structure-and-inbox-policy-2026-10-09.md` |
| Live requests and attention list | project: `claude/live-requests-and-attention-list-2026-10-09.md` |
| Next steps / version control | project: `claude/next-steps-2026-10-09.md` |
| Handover (shots, graphs, rules) | project: `claude/HANDOVER-shots-and-corrosion-graphs-2026-10-11.md` |
| Slug builder | `02_SCRIPTS/slug-builder/build_slug.py`, `slugkit.py` |
| Graph builder (processing graphs) | `02_SCRIPTS/graph-builder/build_master_v15.py` |
| Contract linter | `02_SCRIPTS/linter/lint_graph.py` |
| Collector spec | `02_SCRIPTS/collector/collector.md` |
| Agent report (slug run, linter) | `02_SCRIPTS/AGENT_REPORT_2026-10-09.md` |
| Production roles (parity) | `~/panama-console/docs/2026-08-31-role-codification.md` |
| Production handoff contract (parity) | `~/panama-console/docs/COORDINATION.md` |
| Production delivery rhythm (parity) | `~/panama-console/docs/CLIENT-DELIVERY-RHYTHM.md` |
| Production operating manual | `~/panama-console/CLAUDE.md`, `START-HERE.md` |
| Operator setup (Binc) | `~/panama-console/docs/OPERATOR-SETUP.md` |
| Pipelines start here (Binc) | `~/panama-console/docs/PIPELINES-START-HERE-BRYNLEY.md` |
| Toolchain authority | `~/panama-console/docs/TOOLCHAIN.md` |
| Corrosion route evidence | `~/panama-console/films/panama-canal-v2/notes/57-corrosion-aleph-test.md` |
