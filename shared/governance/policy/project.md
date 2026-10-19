# CanalV2: project governance (single reference)

Compiled 2026-10-15 for Brynley (Binc) Cadman.

This file collects, in one place, every governance document we use on CanalV2. It covers:
- the ComfyUI Workflow Engineering Contract v3 (full text);
- our standing rules and policies;
- decisions and agent permissions;
- structure and naming;
- the production (BH console) rules that bind us.

**Where each rule lives.** Each section names its source. The source document stays the master. If this file and a source disagree, the source wins; fix this file.

**Order of authority, highest first:**
1. The production record: the BH console, Slack and the `panama-imax-redux` repo. It is the official status of every deliverable.
2. Binc's explicit instructions in conversation. They are recorded here when they are standing rules.
3. The Engineering Contract v3, for how graphs and workflows are built.
4. Our CANALV2 policies, in `00_POLICY/`.

---

## Contents
1. ComfyUI Workflow Engineering Contract v3 (full text)
2. Standing rules (Binc)
3. Technical standards for corrosion: tracking, solve, carry, comp
4. CANALV2 policies (`00_POLICY/`)
5. Decisions log
6. Agent permissions
7. Structure, naming, tracker, inbox
8. Live requests and the attention list
9. Production rules: BH console / `panama-imax-redux`
10. Corrosion route on the production record
11. Known inconsistencies between documents
12. Document index

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

### Our reading of the contract (`claude/contract-adoption-2026-10-09.md`)
- **QC measures report and never gate.** This covers stereo QC, colour step and alignment numbers.
- **Input incompatibilities fail loudly** with the five §6 fields. This covers wrong size, missing file, untagged colour and ambiguous channel.
- **"BUILT - NOT RUN" applies only to client-approved, locked shots** (e.g. cgi-042, Kyle's). Our open shots can be worked on and run on request.
- **Kyle's own contract versions** (his COMFY_GRAPH_PACKAGE / engineering contract) are his to run. We stay as symmetrical with them as possible, but we don't adopt them.

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
- **Delivery has to be autonomous.** Binc is not an operator who pastes or opens things. Work runs on a fixed per-shot recipe with automatic checks; only passing results reach him.
- **The comp is graded to match the frame**, then comped over the plate through the matte.
- The production's harness and resources live in the BH console repo (§9). Use them.

---

## 6 · Agent permissions

Sources: `claude/agent-brief-2026-10-09.md` and `00_POLICY/agent-permissions.md`.

**Roles**
- **Binc:** shots, creative calls, approvals, the GUI look at each graph, permissions.
- **Claude (project session, cloud):** briefs, acceptance checks, review of reports, project docs, file staging and commits to connected folders, Blender MCP.
- **Claude Code agent (binc-PC, or a RunPod/GCP container):** builds, loads, runs and reports. Works from the brief.

| Action | Claude (project) | Claude Code agent |
|---|---|---|
| Read v4, frozen ComfyUI, Binc's graphs, paint-app repo, panama-console | yes | yes, read-only |
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

**Collector**
- Checks every asset location and makes proxies; never guesses or substitutes.
- An entry goes live only when every required asset is found.

**Slug builder**
- The slug is the shot name.
- Writes `04_GRAPH/<shot>_graph_v001.json` from the type template. Never overwrites; the next build is `v002`.

---

## 8 · Live requests and the attention list

Source: `claude/live-requests-and-attention-list-2026-10-09.md`.
- **The BH console, Slack and the repo are the centre of the official deliverables.** Where our tracker and the official record disagree, the official one wins and we fix ours.
- **Every live request gets an inbox entry.** That means any request, question or side note from Kyle, Joe, Tunnel or BH. Kinds: `shot`, `request`, `question`. Request and question folders are `<yyyy-mm-dd>_<topic>`.
- **The attention list** is a private Slack List in Binc's space, created only on his yes. Columns: item, kind, from, received, due, status, inbox entry, Slack link, next action. Status words: needs me, waiting on them, in progress, done.

---

## 9 · Production rules: BH console / `panama-imax-redux`

Source: `~/panama-console` (Kyle's repo; Binc is second operator): `CLAUDE.md`, `docs/OPERATOR-SETUP.md`, `docs/PIPELINES-START-HERE-BRYNLEY.md`.

**Read-only for us unless Binc says.**

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

**Routes**
- **Deterministic route** (`plate-paint-fresh.py`):
  - ECC hull track;
  - on the reference frame: a depth-derived hull mask with hold-outs, a stain matte, and a chroma LUT;
  - in Fusion: steady the hull (`CornerPositioner`), light the paint from a blur of the current frame, unsteady, Merge.
- **Measured best route** (notes/57): Runway **Aleph** (`aleph2`, video-to-video) carrying OUR painted lead frame as its keyframe.
  - Beats the deterministic paint on texture, removes the fabrication Kyle saw, and is within 13% on temporal stability.
  - *"The keyframe was the whole problem, and our paint is the keyframe."*
  - One fire on the 058 bow plate cost $1.0850 (logged).
- **Rejected routes, not to be re-tried:** per-frame inpaint (it jumps) and a frozen still (one frame's light). Source: notes/43 §10.
- **Proposed by Brynley, not built:** an IC-LoRA trained on the Merlion's paint (BHSOM-736).

---

## 11 · Known inconsistencies between documents

| Item | Says | Correct | Source of the correction |
|---|---|---|---|
| Hero eye | agent brief and the 051 `00_READ_ME`: RIGHT | **LEFT** | decisions 2026-10-09 |
| Root folder | storage policy: `~/CANALV2` | in use: `/home/binc/CANALV2_r3/CANALV2` | the tree on binc-PC |
| ComfyUI in use | handovers: CanalV2 API at `127.0.0.1:8188`, models in-install | running instance on port **8189**; input, output and models in `~/ComfyUI-Shared` | ComfyUI log, 2026-10-15 |
| "Signed off" v4 | older handoffs | **v4 was rejected** (Kyle); it's a paint process, not a photoreal texture comp | Binc |
| Frozen ComfyUI `~/ComfyUI-Installs/ComfyUI` | "production / signed-off baseline" | **leftover, zero recoverable data** | Binc |
| Harness | our docs: ComfyUI graphs as deliverable | production harness: Claude Code + Fal/Runway, no ComfyUI (Kyle's lanes); our corrosion graphs remain the contract-governed deliverable for our work | §9 vs §1; **open question for Binc** |

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
| Production operating manual | `~/panama-console/CLAUDE.md`, `START-HERE.md` |
| Operator setup (Binc) | `~/panama-console/docs/OPERATOR-SETUP.md` |
| Pipelines start here (Binc) | `~/panama-console/docs/PIPELINES-START-HERE-BRYNLEY.md` |
| Toolchain authority | `~/panama-console/docs/TOOLCHAIN.md` |
| Corrosion route evidence | `~/panama-console/films/panama-canal-v2/notes/57-corrosion-aleph-test.md` |
