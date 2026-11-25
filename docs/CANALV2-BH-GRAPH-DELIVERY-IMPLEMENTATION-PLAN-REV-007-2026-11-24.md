# BH graph delivery implementation plan

Revision 007 — 24 November 2026

> Pasted into the repo by Lucas on 2026-11-25, verbatim (tables rebuilt as Markdown). It is the later, shorter rewrite of [revision 006](CANALV2-BH-GRAPH-DELIVERY-IMPLEMENTATION-PLAN-REV-006-2026-11-23.md). The source text had several paragraphs twice, an old and a new wording one after the other (in sections 3, 4, 12, 13 and 15); they are kept as pasted. Revision 006 keeps some sentences that 007 drops.

## 1. The workflow

Kyle provides the brief and assets, ending upstream production history at handoff. Handoff timing is specified in XML using absolute source and record bounds with a tabulated retime curve, which Binc may refine during finishing to enhance motion while preserving creative intent. Binc supplies base graphs in approved layouts using approved nodes. A deterministic pull script copies and verifies assets into local shot folders. An assembly script clones a base graph and populates the shot name and local input paths. An LLM operates strictly within the graph's exposed control-surface contract. The next delivery round is stereo, requiring approved stereo-conversion nodes in the base graphs. The proxy runs locally for human QC, followed by a hard-stop handover to the pod. Lucas executes the handover, publishes previews, and runs supplied tests, including an independent repeat-frame check.

| Step | Responsibility | Deliverable |
|---|---|---|
| Brief and assets | Kyle | Current shot brief and exact selected assets; no history |
| Local asset pull | Deterministic transfer script | Verified local assets in the shot folder, pulled from supplied locations |
| Timing conversion and finishing | Converter for timing representation; Binc for finishing judgement | Absolute source/record bounds and tabulated curve, refined where needed to serve creative intention |
| Base graph design | Binc | Approved graph layout, nodes and exposed controls |
| Stereo integration | Binc supplies/approves nodes and layout; implementation wires them as specified | Stereo-ready base graph with defined controls |
| Assembly | Python script | Copy of the supplied graph with shot name and local inputs populated; one graph per script |
| Settings | LLM through the defined control surface | Values in permitted existing node settings, based on the brief |
| Local proxy and QC | Local execution followed by human review | Reviewed graph/settings and proxy |
| Pod handover | Transfer of the reviewed execution package | Exact graph, settings, inputs, timing data and supplied tests |
| Pod resource profile | Lucas | Actual GPU VRAM, host/container RAM limits and tested DA2 chunking profile |
| Processing and previews | Lucas under the BH harness | Processed stereo output, published previews and actual test results |

No new production harness, editorial reconstruction or separate element-building workflow is part of this implementation. A separate DA2 depth graph is evaluated explicitly in section 13; it is an optional approved technical boundary, not an agent-generated element workflow.

## 2. First hard stop: brief and assets

### What crosses

- The current shot brief from Kyle.
- The supplied locations of the selected assets for that brief, directly associated with the intended graph inputs.
- The converted XML timing data required for the shot.

### What stays upstream

Shot history, EDL commentary, past creative notes, previous handovers, policy Markdown, historical graphs, agent memory, and repository history.

The receiving LLM has no repository or history access. A deterministic transfer script retrieves only specified asset locations, including those in repositories or shared drives. This restricted access prevents exposing history to the LLM. Do not sync entire repositories into the workspace or place history sidecars alongside graph files.

The brief defines shot instructions, and assets provide selected material. Neither permits searching for alternate sources or analyzing past decisions.

### Implementation

1. Establish a dedicated exchange location with only these deliverables.
2. Pull assets deterministically from supplied locations into local shot folders. Verify transferred bytes before making local copies available. Finalize new copies only after transfers complete successfully.
3. Bind graph inputs directly to local paths. The LLM receives local file references without repository browsing access. Failed pulls report explicit transfer errors without searching for substitutes.
4. Keep transfer and integrity records strictly technical (identifying files and checksums) without adding creative commentary or instructions.

Completion check: execute a sample shot using only the exchange package. Attempts to access upstream history must fail under active workflow permissions.

## 3. Timing representation and the finishing contract

Editorial establishes creative intent, while Binc finishes motion. Jon trusts Binc to protect the edit, and Binc relies on Jon to provide clear direction. Joe's overall direction serves as the benchmark for finishing judgment, replacing strict keyframe replication.

For the whale breach, speed ramps must give the suspended moment natural weight and timing. Binc may smooth or reshape curves to achieve this, verified through human QC.

Convert editorial timing into the XML table format, maintaining absolute source and record bounds. Distinguish editorial mappings from finishing adjustments so changes remain reviewable. Tabulate the final refined finishing curve used by the graph. The LLM may only adjust finishing controls explicitly exposed by Binc, without altering algorithms or bypassing control contracts.

If an EDL lacks variable speed ramps, request complete timing exports or explicit tables rather than interpolating missing curves. Research converter scripts containing cut-merging or timecode defects are prohibited in production.

### Required timing content

| Value | Representation |
|---|---|
| Source identification | Exact asset/clip identification |
| Absolute source in/out | Absolute positions in the source timeline |
| Absolute record in/out | Absolute positions in the record timeline |
| Source and record rates | Explicit rates, preserving fractional-rate precision |
| Retime | A tabulated curve mapping record positions to source positions |
| Endpoint meaning | Explicit whether in/out values include or exclude their endpoints |
| Holds/reverse/ramps, when present | Expressed by the tabulated mapping rather than inferred from prose |

Implementation proposal: provide a source-position entry for every record frame, making fractional source positions explicit and removing LLM interpolation. Validate XML dialects and retime-node parsing against supplied sample files.

The table specifies the target finishing mapping. Curve refinement and frame interpolation remain distinct: Binc shapes timing curves while approved retime nodes synthesize image samples. Deterministic curve functions may be exposed via control interfaces. Routine finishing adjustments require local proxy QC rather than new node approvals.

The table states the finishing mapping to execute. Curve refinement and image interpolation are different operations: Binc shapes the timing, and the approved retime node synthesizes the required image samples. A deterministic curve function can be exposed through the defined controls. Normal finishing adjustments use local proxy QC, not a new node-approval process.

### Converter checks

- Source and record identities agree with the handoff.
- Absolute in/out positions and the table agree, using the declared endpoint convention.
- Every required record frame has a defined source position.
- Source positions stay within available media/handles.
- Holds, reverse motion, and speed ramps are correctly represented. Deliberate finishing adjustments must remain distinct from timing conversion errors.
- Fractional source positions retain precision through XML writing and reading.

Validate timing arithmetic using lightweight test fixtures with pre-defined mappings for constant speeds, ramps, holds, reverse motion, and fractional frame rates.

Completion check: the graph correctly parses the reviewed finishing table, preserves absolute boundaries, and passes local human QC without unauthorized fitting or post-handoff keyframing.

## 4. Graph assembly: copy and populate

Binc supplies pre-approved base graphs with locked node selections, wiring, and layouts.

The assembly script copies a supplied graph and populates the shot name and designated inputs, producing one shot graph per run without redesigning structure.

### Assembly may change

- The shot name and its designated naming fields.
- Input references in the designated loader fields.
- The designated timing input reference for the supplied XML/table, where applicable.

Field mappings are extracted directly from supplied graphs. Do not infer field locations from labels or invent node identifiers beforehand.

### Assembly preserves

- Nodes and node types.
- Links and processing order.
- Layout, groups and positions.
- Existing settings outside the designated assembly fields.
- The existing creative control surface.

Asset copying is strictly file transfer, not image preprocessing. Media loading and processing occur entirely inside the supplied graph without external element pipelines. The optional DA2 depth graph requires explicit architectural approval before integration.

When intermediate elements are required, enable existing DPX write nodes via designated controls rather than generating external element graphs.

If an element is needed, enable the existing DPX write node at the appropriate location in that graph through the designated control. Do not generate a separate element graph or move the work outside the spine.

Adding missing write nodes modifies graph structure and requires prior approval.

### Assembly verification

Compare assembled graphs against base graphs structurally. Only mapped shot-name and input fields may differ. Any unintended change in nodes, links, or layout triggers assembly failure.

Completion check: the output graph opens in the approved layout with exact matching nodes and connections, correctly populated with shot names and inputs.

## 5. LLM operation through the control surface

The LLM receives the current brief and control-surface contract, configuring settings within locked base graphs to fulfill brief requirements.

The control contract maps directly to permitted settings without granting authority to alter workflows or policies.

### Define the contract from the actual graph

For each exposed setting, record:

| Field | Purpose |
|---|---|
| Control name | Name the LLM uses |
| Existing node and input | Exact permitted target |
| Type and units | Prevent ambiguous values |
| Allowed values/range | Bounds supplied with the graph design |
| Meaning | Describe the effect of the setting |
| Dependencies | Required relationships with other exposed controls |

Exposed parameters include qualitative method selections (e.g., generative fill vs. stretch/warp) defined in base graphs. These choices remain controllable without requiring separate approvals for routine adjustments.

Assembly script fields and LLM control parameters are strictly separate. The interface supports approved finishing controls but blocks source substitution, arbitrary keyframing, topology changes, layout edits, custom code, or node insertions. Binc retains finishing discretion via proxy QC and exposed controls.

### Enforce the restriction in code

Enforce control constraints in code. A deterministic function applies parameters to copied graphs, rejecting unknown keys, type mismatches, out-of-bound values, or invalid combinations. The LLM gets no direct write access to graph files or directories.

Re-verify graph structures after applying settings. Only assembly inputs and contracted control values may differ from the base graph.

If a brief requires unexposed features, flag the missing capability. Node additions require formal approval and deliberate integration rather than dynamic insertion during execution.

Completion check: valid contracted parameters apply cleanly, while structural edits, unexposed modifications, or timing overrides outside the contract are rejected.

## 6. Local proxy run and human QC

Execute local proxy runs using assembled graphs and LLM-configured settings. Human review following local execution forms the primary QC gate.

Evaluate rendered proxies against shot briefs, verifying qualitative methods, timing, framing, restoration, and stereo quality. Adjust exposed parameters and rerun local proxies as needed.

Local runs must use standard graph proxy configurations without introducing external processing pipelines. Proxy-to-final output switches must be explicitly defined in handovers.

Record the exact graph state and parameters used for approved proxies. Handover packages must contain these parameters alongside established full-resolution settings. Rebuilding shots between proxy review and pod execution is prohibited.

Completion check: approved proxies match handed-over graph settings exactly, ensuring no creative changes are deferred to pod execution.

## 7. Second hard stop: handover to the pod

Upon completing local QC, transfer prepared execution packages across the hard stop to BH for Lucas to process.

### The handover contains

- The prepared execution graph with the reviewed settings.
- The exact required input assets or their designated transfer references.
- The XML/table consumed by the graph.
- The established proxy-to-final settings, if the graph requires them.
- The expected output identity, frame range and delivery settings.
- The supplied tests and their fixed configuration.
- Lucas's validated pod resource/chunking profile, including the reviewed depth/stereo settings and DA2 graph choice.

Handover packages exclude local LLM session logs, agent prompts, production history, or intermediate setting iterations.

Graph conversions required for execution must maintain functional parity and undergo pre-transfer verification without altering underlying structures. Avoid introducing unneeded intermediate graph formats.

### Lucas's role

Lucas runs prepared graphs under the BH harness, publishing previews and running supplied tests. Lucas defines pod memory limits and validates DA2 execution chunking profiles before full execution. Pod execution processes validated packages without modifying sources, briefs, timing, or graph structures. Memory tuning must remain within validated limits without altering depth resolutions, models, or picture controls.

Return output files and test logs directly. Job or test failures must be reported without making unapproved graph or method changes. Corrections require explicit package updates across the handover boundary.

Verify executed graphs against handovers using structural comparisons or checksums to catch accidental modifications.

Completion check: Lucas executes handed-over graph packages and returns generated previews alongside complete test results.

## 8. Automated output QC and integrity

Lucas executes the automated QC test suite on rendered outputs and returns results alongside preview files. The automated scan checks:

- Duplicate/repeated frames and temporal jitter.
- Colour-space and encoding checks against the delivery specification.
- Zero-byte, missing, corrupt or unreadable frames and sequence completeness.
- Filenames, shot/version/eye identifiers and frame numbering against the agreed naming convention.
- DPX header integrity, including the required timecode entries/placeholders as specified for delivery.
- Expected dimensions, bit depth, frame counts and stereo eye synchronization, plus the usual automated file/transfer integrity checks.

Automated checks inspect output files directly. Offline reference matching cannot override test failures. Test logs report affected shot versions and specific frame ranges.

## 9. Build sequence

| Order | Implementation task | Exit evidence |
|---|---|---|
| 1 | Establish the brief/assets-only exchange boundary | Receiving workflow can read the handoff and cannot access history |
| 2 | Inspect the actual XML and retime-node interface; implement or adapt conversion | Absolute ranges and tabulated mapping round-trip correctly |
| 3 | Map Binc's supplied graph fields and implement copy/populate | Only shot name and designated inputs differ |
| 4 | Map the defined control surface and implement the constrained settings operation | Allowed settings work; structural edits fail |
| 5 | Run one representative proxy locally and perform human QC | Reviewed graph/settings and proxy are retained together |
| 6 | Hand the prepared package to Lucas through the existing BH route | Received/executed graph matches the handover |
| 7 | Replace the repeat test's offline-comparison route and verify planted defects | Independent test catches known repeats without offline access |
| 8 | Complete the representative pod run and preview publication | Output, published preview and supplied test results returned |

Reuse existing working modules that meet specification requirements. Avoid restructuring repository setups, production harnesses, or base graphs during implementation. Confirm the dry-run estimates in Section 15 after inspecting graph structures, XML schemas, stereo nodes, and handover tooling.

## 10. Required implementation inputs

Implementation requires the following inputs:

1. Binc's actual approved base graphs, including their local proxy and final-output controls.
2. The defined control-surface contract, or Binc's explicit mapping of settings from which to encode it.
3. One current brief and its selected assets from Kyle, without history.
4. The actual EDL/XML example and intended retime-node interface.
5. The current repeat-frame test, including the offline-comparison branch to remove.
6. The existing handover interface Lucas uses and the expected test-result format.
7. The actual stereo-conversion nodes/base graph and current DA2 wrapper.
8. The pod image digest, dependency/model versions, available GPU VRAM, host/container RAM limits and local Linux GPU/driver specifications.

These items provide technical parameters for implementation without opening historic production workflows. Resolve missing implementation details directly from these technical sources.

## 11. Acceptance

Implementation acceptance requires executing a complete shot through the end-to-end pipeline: brief isolation, local asset pulling, XML timing conversion, graph copying, contracted LLM parameterization, local proxy human QC, hard-stop handover, profiled pod execution, preview publication, and automated testing.

The pipeline must prove that upstream history remains inaccessible, LLM agents cannot alter graph structures, and pod execution processes handed-over work without redesign. Repeat-frame tests must reliably catch planted defects without offline references.

This specification incorporates Binc's workflow requirements. Specific XML schemas, field mappings, proxy mechanics, and detection thresholds will be finalized during initial implementation.

## 12. Workflow analysis: protect the brief and spend HITL on the shot

Brief integrity is protected by restricting stage access permissions. Human effort focuses on shot review and creative adjustments, while automated scripts handle repetitive construction, validation, and file transfers.

| Stage | Safeguard | Automated mechanical check | Where human judgement belongs |
|---|---|---|---|
| Kyle's handoff | Current brief and exact asset locations; history stays upstream | Required references are present and supplied locations are used | Kyle supplies the intended work; no need for Binc to reconstruct history |
| Local asset pull | Exact-location transfer into the existing local shot folder | Copy completeness, byte verification and correct local binding | Only a real source/access exception needs attention |
| Graph assembly | Copy Binc's graph; replace only designated shot/input fields | Structural/layout comparison and loader checks | Binc designs the base; no per-shot inspection of routine copying |
| Settings | LLM can change only exposed controls | Types, bounds, dependencies and permitted-field comparison | Binc judges the look and how the settings serve the brief |
| Retime finishing | Preserve creative intention and absolute boundaries; expose deliberate refinement | Correct curve evaluation, sample count and source bounds | Rhythm, acceleration, weight and the intended action beat |
| Stereo finishing | Use integrated approved nodes and stereo controls | Eye identity, frame mapping, output format and supplied technical checks | Depth, comfort, dimensional composition, occlusion quality and temporal coherence |
| Proxy QC | Review the actual result locally | Bind reviewed proxy to the settings used | Primary HITL effort: does the shot deliver Jon's intention and Joe's direction? |
| Pod handover | Exact reviewed graph/settings cross a hard stop | Input completeness, graph/settings correspondence and resource profile | No new creative interpretation at dispatch |
| Lucas's return | Publish actual previews and supplied test results | Repeat detection, counts, eye sync, chunk joins and output integrity | Review exceptions and final stereo quality where required |

Automation must not prompt Binc to approve routine file copies or node bindings. Script failures report technical errors directly without triggering automatic shot redesigns. Routine parameter tweaks stay within local proxy QC, while structural node additions require approval.

The system must not turn a routine build into repeated requests for Binc to approve copying, naming or input binding. A mechanical failure identifies the failed operation; it does not invite an agent to redesign the shot. Ordinary adjustments within the control surface stay in the local proxy/HITL loop. Additional nodes still require approval.

This structure safeguards creative briefs while preserving finishing flexibility. Professional trust across editorial, direction, and finishing allows technical refinements that improve shot quality, backed by automated validation.

## 13. Next round: stereo integration and DA2 memory

### Integrate the approved stereo nodes first

The POC must validate a complete stereo workflow using Binc's approved depth/stereo nodes, layout, qualitative completion options, convergence controls, eye outputs, and color precision. Mono graph validation is insufficient for this phase.

Node execution ordering relative to retime and upscale steps follows Binc's base design. Depth frames must explicitly link to corresponding image frames (source or record timeline), ensuring stereo nodes receive synchronized image/depth pairs.

Local QC evaluates edge movement, occlusions, temporal depth stability, eye order, frame sync, and convergence. Iterate using short test clips, validating whole shots and full-resolution segments before accepting the POC. Proxy runs alone do not validate full-resolution memory footprint or stereo quality.

### Existing cache-node system

The existing cache-node system uses configurable forward (+) and backward (−) frame buffers held in container memory, establishing predictable DA2 VRAM limits. Use this mechanism directly without developing new caching systems.

Resource profiles must record frame window bounds, container memory allocations, and peak RAM/VRAM usage. Execution chunking will be tuned around this cache behavior to protect context at boundaries. Configured cache settings will be validated on target pod hardware during dry runs.

### Lucas defines actual pod resource profiles

Lucas documents and tests the following parameters for each pod hardware profile:

| Resource/profile value | Why it is required |
|---|---|
| GPU model, count and usable VRAM per GPU | Defines the actual inference envelope; multiple GPUs do not automatically pool VRAM |
| Host RAM and container RAM limit | Decode buffers, cached images and depth arrays can exhaust CPU memory before VRAM |
| Free memory at job start | Installed capacity alone ignores resident models and other processes |
| Runtime image, driver compatibility and dependency versions | Links a result to a tested software/hardware combination |
| DA2 model, inference dimensions and precision | Memory depends on the actual model/input, not the shot name |
| Inference batch size | Number of frames held together on the GPU |
| Existing cache backward (−) / forward (+) frame windows | Defines the bounded context held in container memory and supports predictable VRAM use |
| Decode/prefetch buffer and chunk length | Limits frames held in host memory and written per work unit |
| Temporal context and overlap, if used by the wrapper | Protects smoothing/propagation behavior at boundaries |
| Peak process RAM, GPU allocated/reserved memory and total device use | Measures the observed peak rather than guessing from tensor allocation alone |
| Runtime, throughput, output size and working disk | Determines sustainable dispatch and transfer capacity |

Inference batch sizes, execution chunk lengths, and temporal context windows are independent settings. A chunk does not equal a single GPU batch or an entire decoded shot in RAM. System RAM additions cannot offset insufficient GPU VRAM.

Inference batch size, execution chunk length and temporal context are separate settings. A chunk need not be a single GPU batch or an entire decoded shot in RAM. Extra system RAM does not replace insufficient GPU VRAM.

Benchmark graphs on representative media to establish operating margins from observed peaks. Avoid using unverified chunking tables based solely on hardware VRAM labels. Run single jobs per GPU profile initially, adding concurrency only after measuring combined memory usage.

### Chunking rules

1. Keep the approved model, inference dimensions, precision and creative depth/stereo controls fixed while measuring chunk sizes.
2. Assign absolute frame indices. Cover every requested frame exactly once in the final output, even when inference uses overlapping context.
3. Bound decode, GPU inference, post-processing and write buffers independently. A loader that first materializes the whole shot defeats downstream chunking.
4. Inspect the actual DA2 wrapper. The reference DA2 video script estimates frames individually; an installed wrapper may add temporal smoothing, normalization, anchors or propagation. Do not assume it has the reference script's state behavior.
5. Preserve required temporal context and depth-scale behavior across boundaries. Do not reset normalization or anchor schedules at each chunk. Persist required state or provide validated overlap and trim context-only frames from the final sequence.
6. Compare the same moving passage processed whole and across a chunk boundary, where the reference fits. Check the depth data and resulting stereo, not only file counts. The numerical tolerance must be established for the actual implementation; no guarantee of bit-identical GPU pixels is assumed.
7. If a full passage cannot fit whole, compare overlapping regions using shifted chunk boundaries and review resulting stereo seams. Keep that limitation visible.
8. A retry resumes only validated complete work under the same input/settings identity. Remove or quarantine incomplete output; do not silently emit duplicates at a join.

Lucas manages hardware profiling and chunk configurations, while Binc controls picture-affecting stereo parameters. Out-of-memory errors may trigger chunk size reductions but cannot alter rendering methods.

Lucas owns resource measurement and the execution chunk profile. Binc owns picture-affecting depth/stereo behavior. An OOM report may lead to a tested smaller execution chunk; it cannot silently alter the picture-making method.

### Should DA2 be an independent graph?

Evaluate separating DA2 into an independent graph during the POC. Separating depth inference can free VRAM by unloading large models and allow reusing depth data across stereo iterations. However, it will not resolve cases where standalone DA2 memory requirements exceed available GPU VRAM.

| Arrangement | Advantage | Cost/condition |
|---|---|---|
| DA2 inside the stereo graph | Fewer file handoffs; uses the existing spine | Verify that model lifetimes and image buffers do not overlap unnecessarily; changing stereo settings may rerun depth depending on actual caching |
| Explicit approved DA2 graph feeding the stereo graph | Separately bounded memory, restartable depth work and potential depth reuse | Requires an approved graph boundary, additional I/O and an exact depth-data interface |

Recommendation: test standalone DA2 graphs if depth recomputation or model coexistence creates bottlenecking. Maintain integrated graphs if current memory footprints remain stable. Binc determines graph boundaries based on benchmark data.

Recommendation: test the independent-depth option if depth is repeatedly recomputed or model/buffer coexistence is the measured bottleneck. Keep the existing integrated arrangement if it already fits and behaves reliably. Binc decides the graph boundary from that evidence; no agent silently splits the supplied graph.

If separated, each graph uses its own populate script. Standalone DA2 processing is the only permitted exception to single-graph execution and does not authorize ad-hoc processing scripts.

Depth interfaces must maintain precise numeric values, scaling, orientation, dimensions, precision, and frame alignment. Save depth data in approved formats without using 8-bit previews as primary masters. Cache keys encompass input frame sequences, model revisions, settings, and normalization state. Any upstream timing, crop, or model change invalidates cached depth data.

## 14. Local Linux setup matching the pod

Recommendation: use the Linux CUDA workstation for local execution and proxy QC if hardware capacity permits. Mac hosts may be retained for review and control tasks. This targets execution host alignment without restructuring projects.

Deploy identical container images locally and on pods, ensuring matching ComfyUI revisions, node packages, models, OCIO configs, CUDA runtime versions, and file path structures. Mount shot assets at standard locations rather than manually configuring environments on pod instances.

Containers standardize application environments but require compatible host drivers. Successful local execution minimizes software discrepancies but does not eliminate target pod dry runs.

Record local GPU specifications, VRAM, RAM, and driver versions, comparing them against pod targets. Higher CUDA core counts do not guarantee memory compatibility. If local VRAM is limited, validate functional proxy behavior locally and measure full-resolution chunk capacity directly on pod hardware.

Match production path structures, container mounts, image formats, loaders, and permissions. Validate node availability and model loading before starting execution.

## 15. POC, dry run and automation estimate

Planning allowance: 5–7 working days to deliver a tested automated batch, assuming functional nodes, defined control mappings, sample timing files, test packages, and pod access. Render durations, network transfers, and reviewer availability may extend elapsed delivery schedules.

| Phase | Engineering allowance | Deliverable and exit condition |
|---|---|---|
| POC | 2–3 days | One real stereo shot: deterministic local pull, copied approved graph, contracted settings, timing/finishing curve, local proxy human QC and measured candidate DA2 memory/chunk behavior |
| End-to-end dry run | 1 day | The reviewed shot runs through Lucas on the real pod; preview publication, supplied tests, one interrupted/resumed work unit and a chunk join are checked |
| First automated batch | 1–2 days | A small representative batch uses the same tested pull/assembly/settings/handover path; mechanics run automatically, shot HITL remains in place |
| Integration contingency | Allow up to 1 additional day | Resolve environment, timing-reader, writer or adapter problems exposed by the dry run |

The standard timeline allocates 4–6 engineering days plus contingency (5–7 days total). Initial automation applies exclusively to validated base graphs and hardware profiles.

The normal sequence is 4–6 engineering days plus contingency, hence a 5–7 day planning allowance. Do not imply that all graph types, all stereo methods or all shots are certified by one successful POC. Limit initial automation to the tested base graphs and memory profiles.

### Day-by-day working target

- **Day 1:** pin the common runtime; inspect actual graph/controls and timing interface; implement deterministic asset pull and copy/populate; inventory local/pod memory.
- **Day 2:** integrate the approved stereo nodes, expose the intended settings, run local proxy and finishing review; begin measured DA2 profiling.
- **Day 3 if needed:** complete stereo/depth integration, choose integrated or separate DA2 from evidence, and validate chunk continuity on representative final-resolution data.
- **Next day:** full Lucas handover/dry run, published previews, repeat-frame tests without offline comparison, and interruption/restart check.
- **Following 1–2 days:** automate a small set of valid shot packages, verify that each stays bound to its supplied brief/assets and graph, and expand only the tested coverage.

Initial automation covers asset pulling, graph cloning, and parameter injection, while creative acceptance remains human-driven. Batch progress does not require manual inspection of routine file operations, allowing Binc to focus on image review and exceptions.

First automation means deterministic asset pulls and graph instantiation/settings application. It does not mean unattended creative acceptance. Batch progress must not depend on Binc checking mechanical copying or graph wiring shot by shot. Binc's time goes to the proxy picture and genuine exceptions.

Estimates must be revised if stereo nodes require structural updates, custom retime readers must be written, cache systems require code changes, or BH adapters require refactoring.

### POC selection

Select a test shot that exercises stereo processing, visible movement, and complex depth occlusions. Include timing ramps (such as the whale breach) to validate retime handling. Use long clips at full resolution to measure real memory footprints across chunk boundaries.

## 16. Sources and limits

Workflow rules, roles, and finishing authority reflect Binc's explicit directions. Timelines, profiling parameters, and DA2 benchmarking plans represent technical recommendations for deployment.

Primary references checked for the platform details:

- Depth Anything V2 reference video runner: frame-by-frame reference implementation. The installed wrapper must be inspected separately; this plan does not substitute Video Depth Anything or change the approved model.
- NVIDIA Container Toolkit installation prerequisites: the host GPU driver remains a prerequisite outside the application image.
- PyTorch CUDA memory management: allocated and reserved memory are distinct measurements. Measure process/device use as well; allocator statistics alone do not describe every GPU allocation.

Hardware benchmarks and chunk sizing measurements will be executed during initial dry runs. Standalone DA2 graph execution remains an evaluation option subject to testing.

## 17. Stereo SBS distribution and headset review

Deploy a MoonLink endpoint to serve stereo side-by-side (SBS) previews to Moon Player on Vision Pro and Quest Pro. This distribution point operates downstream of local proxy QC and pod preview generation without affecting graph assembly.

Store rendered SBS previews in a versioned review folder on the Mac host. Register review files with MoonLink AVP for Vision Pro and MoonLink QPE for Quest Pro. Verify during dry runs that both host applications run correctly on the serving Mac.

The Linux processing environment remains separate, transferring completed SBS previews to the Mac review host upon completion. Local network playback is supported directly; remote review requires a validated file-transfer route.

Shared iCloud Drive folders offer an optional transfer mechanism. Ensure files are fully downloaded to the Mac host before registering them in MoonLink. Vision Pro can access files via Moon Player's native file integration, while Quest clients utilize the Mac MoonLink endpoint.

Avoid using iCloud Photos Shared Albums for quality review, as Apple enforces compression and resolution limits (e.g., 720p). Deliver full-resolution SBS files via local folders or iCloud Drive to preserve preview fidelity.

Dry-run testing includes reviewing identical SBS previews on both headset platforms to verify eye alignment, SBS layout interpretation, aspect ratios, frame rates, and playback stability. Disable automatic 2D-to-3D conversions or playback enhancements. Automated QC tests will be used to differentiate network streaming stutter from encoded frame drops.

Headset review provides visual QC for stereo depth, viewer comfort, occlusion fidelity, and scene pacing. This review step complements automated technical checks without replacing final projection mastering.

Implementation allowance: allocate 0.5–1 day for headset setup and playback verification during the dry-run phase. Timelines assume target hardware, applications, and host machines are available.

References:

- MoonLink for Vision Pro
- MoonLink for Quest/Pico
- MoonLink AVP host application
- MoonLink QPE host application
- Moon Player Vision Pro: Files and Photos access
- Apple Shared Albums limits
