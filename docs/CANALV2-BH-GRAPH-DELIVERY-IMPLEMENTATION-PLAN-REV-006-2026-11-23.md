# BH graph delivery implementation plan

Revision 006 — 23 November 2026

> Pasted into the repo by Lucas on 2026-11-25, verbatim. Revision 007 (24 November) is in [BH-GRAPH-DELIVERY-IMPLEMENTATION-PLAN-REV-007-2026-11-24.md](CANALV2-BH-GRAPH-DELIVERY-IMPLEMENTATION-PLAN-REV-007-2026-11-24.md): a shorter rewrite of the same plan. Revision 006 is the fuller text (it keeps the sentences 007 compresses); where they differ, 007 is the later one.

This revision incorporates Binc's finishing contract, deterministic local asset pull, and the next stereo delivery round. It is an implementation specification; the local Mac/Linux hosts, base graphs, XML format, BH interfaces and pod code have not yet been inspected or modified. The schedule is a conditional engineering estimate, not a measured delivery commitment.

## 1. The workflow

Kyle supplies the brief and assets. Production history stops at that handoff. Timing from the editorial handoff is represented in XML with absolute source and record in/out values and a tabulated retime curve. Binc may refine that curve as finishing work to preserve the intended action while improving motion. An EDL alone cannot restore ramp data absent from its export. Binc supplies the base graphs in the approved layout, using the approved nodes. A deterministic pull copies the assets from the supplied locations into local shot folders and verifies them. An assembly script copies a base graph and inserts the shot name and local input paths. An LLM operates only the settings exposed by the graph's control-surface contract. The next delivery round is stereo: the approved stereo-conversion nodes must be integrated into the supplied base graphs. The proxy runs locally and receives human QC of the shot. That is followed by a hard-stop handover to the pod. Lucas processes the handover, publishes previews and runs the supplied tests, including the independent repeat-frame test.

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

Shot history, EDL commentary, historic creative notes, previous handovers, policy Markdown, historical graphs, agent memory and repository history.

The receiving LLM has no repository or history access. A deterministic transfer script retrieves only the supplied asset locations, including assets held in a repository or its shared-drive copy. Its narrowly scoped asset access does not expose history to the LLM. Do not sync a whole repository into the agent workspace or move history into a sidecar beside the graph and call that a hard stop.

The brief is the instruction for the shot. Assets are the selected material. Neither is an invitation to search for another source or reconstruct why the shot was made that way.

### Implementation

1. Establish a dedicated exchange location with only these deliverables.
2. Pull assets deterministically from the supplied locations into each local shot folder. Verify transferred bytes before making the local copy available to the graph. Preserve existing verified copies; finalize a new copy only after transfer completes.
3. Bind the graph inputs to those local paths. The settings LLM receives local input references, not access to browse the source repository. A failed pull reports the supplied location and actual transfer error; it does not search for substitutes.
4. Keep transfer/integrity records technical. They may identify files and checksums; they do not contain creative history or create additional instructions.

Completion check: execute a representative shot using the exchange package alone. Attempting to open the upstream history must fail through the permissions actually used by the workflow.

## 3. Timing representation and the finishing contract

Editorial establishes the creative intention; Binc finishes the motion. Jon trusts Binc to protect the edit and vision, and Binc trusts Jon to supply an intention that can be finished. Joe's direction and the intended action are the reference for judgement. This professional trust is not replaced by exact replication of an editor's technical keyframes.

For the whale breach, the ramp must make the suspended moment at the top of the breach land with the intended weight and timing. Binc may smooth or reshape the ramp to achieve that. Human QC judges the picture, including that moment.

Convert the available editorial timing to the XML/table representation. Preserve the absolute source and record bounds as supplied. Keep the editorial mapping and the finishing mapping distinguishable so a finishing adjustment is deliberate and reviewable. Tabulate the finishing curve used by the graph after refinement. The LLM may operate finishing controls explicitly exposed by Binc; it may not choose an unrequested smoothing algorithm or bypass the control contract.

If a plain EDL omits a variable ramp, obtain the needed timing export or a supplied table. Do not invent the lost curve. The pasted research converter is not accepted as production code: tests exposed cut-merging and timecode faults, and its curve semantics require correction.

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

Implementation proposal: provide a source-position entry for every output record frame. This makes fractional source positions explicit and removes the need for the LLM to interpolate a sparse set of timing keys. The exact XML dialect and how the approved retime node consumes the table must be checked against the supplied files; do not invent a new dialect if the existing one already carries these values.

The table states the finishing mapping to execute. Curve refinement and image interpolation are different operations: Binc shapes the timing, and the approved retime node synthesizes the required image samples. A deterministic curve function can be exposed through the defined controls. Normal finishing adjustments use local proxy QC, not a new node-approval process.

### Converter checks

- Source and record identities agree with the handoff.
- Absolute in/out positions and the table agree, using the declared endpoint convention.
- Every required record frame has a defined source position.
- Source positions stay within available media/handles.
- Holds, reverse motion and non-linear speed changes are represented correctly. A deliberate finishing change is distinguished from a conversion error; converter fidelity does not require the finished ramp to copy editorial keys.
- Fractional source positions retain precision through XML writing and reading.

Use small converter fixtures with independently specified expected mappings for constant speed, a ramp, a hold, reverse motion and fractional rates. These verify timing arithmetic; they do not compare final rendered frames with the offline.

Completion check: the graph consumes the reviewed finishing table correctly, retains the required absolute bounds and makes the intended action land in local human QC. No unauthorized fitting or keyframe reconstruction occurs after handover.

## 4. Graph assembly: copy and populate

Binc supplies the base graphs. Their node selection, wiring and layout are already approved.

The assembly script copies the supplied graph and fills the shot name and designated inputs. Each assembly script produces one shot graph. It does not design or rebuild the graph.

### Assembly may change

- The shot name and its designated naming fields.
- Input references in the designated loader fields.
- The designated timing input reference for the supplied XML/table, where applicable.

Exact fields are mapped from the supplied graph. Do not infer field locations from labels or invent node identifiers in advance.

### Assembly preserves

- Nodes and node types.
- Links and processing order.
- Layout, groups and positions.
- Existing settings outside the designated assembly fields.
- The existing creative control surface.

Asset copying is transfer only, not image preprocessing. There is no separately generated element workflow or agent-selected replacement processing method. Loading media and processing it happen in the supplied graph. The optional separate DA2 graph described below requires an explicit design decision before integration; it is not silently introduced during assembly.

If an element is needed, enable the existing DPX write node at the appropriate location in that graph through the designated control. Do not generate a separate element graph or move the work outside the spine.

If that writer is not already present, adding it is a node addition and requires approval.

### Assembly verification

Compare the assembled graph with the supplied base graph. Only the explicitly mapped shot-name/input fields may differ. Compare nodes, links and layout structurally, not just the number of nodes. Unexpected changes fail the assembly check.

Completion check: a copied graph opens in the approved layout and has exactly the approved nodes and wiring, with the correct shot name and inputs populated.

## 5. LLM operation through the control surface

The LLM receives the current brief and the defined control-surface contract. It orchestrates the settings in the locked base graph based on that brief.

The contract is a direct map to permitted existing settings. It is not an agent-written policy or a new interpretation of production authority.

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

The controls include the qualitative functions Binc exposes, including generative fill versus warp/stretch where provided by the base graph. Those existing choices remain available through the control surface. Do not impose an additional approval for every ordinary setting change.

The script's assembly fields and the LLM's control fields are separate. The settings interface permits Binc-defined finishing-curve controls, where provided. It does not expose source substitution, arbitrary keyframe authoring, graph topology, layout, arbitrary code or arbitrary node insertion. Finishing discretion belongs to Binc and is exercised through the available controls and proxy QC.

### Enforce the restriction in code

Give the LLM a settings operation accepting only the contract's named controls. A deterministic function applies those values to the copied graph. Reject unknown controls, wrong types, out-of-range values and invalid combinations. The LLM does not receive unrestricted write access to the graph file or base-graph directory.

After applying settings, compare the graph again. Permitted differences are the assembly fields and contracted control fields only. Nodes, links and layout remain unchanged.

If the brief requires functionality outside the available controls, report the specific missing capability. Additional nodes are created only with approval. An approved extension is incorporated deliberately; it is not inserted by the settings LLM during a run.

Completion check: valid contracted settings, including exposed finishing adjustments, work. Requests to add a node, alter a link, change an unexposed field or overwrite the timing outside the control contract are rejected.

## 6. Local proxy run and human QC

Run the proxy locally using the assembled graph and the LLM-selected settings. Human review after that run is the QC stage.

Review the actual proxy against the brief, including the selected qualitative method, timing, framing, restoration quality and stereo result where applicable. The control surface stays usable for corrections. Adjust permitted settings and rerun the local proxy as required.

The local runner must use the supplied graph's proxy arrangement. It must not invent a separate preprocessing or element pipeline. The graph's existing transition from proxy to full output must be identified from the supplied graph and made explicit in the handover.

Record the exact graph/settings that produced the reviewed proxy. The handover must contain those settings and only the established changes needed to run the final-resolution path. Do not let an agent rebuild the shot between proxy review and pod execution.

Completion check: the reviewed proxy is traceable to the graph/settings being handed over. No unresolved creative change is silently deferred to Lucas.

## 7. Second hard stop: handover to the pod

After local human QC, transfer the prepared execution package to BH for Lucas to process.

### The handover contains

- The prepared execution graph with the reviewed settings.
- The exact required input assets or their designated transfer references.
- The XML/table consumed by the graph.
- The established proxy-to-final settings, if the graph requires them.
- The expected output identity, frame range and delivery settings.
- The supplied tests and their fixed configuration.
- Lucas's validated pod resource/chunking profile, including the reviewed depth/stereo settings and DA2 graph choice.

It does not carry the local LLM session, agent instructions, production history or the process used to arrive at the settings.

Any required conversion from the supplied graph format to execution format must preserve its behavior and be verified before handover. It is not an opportunity to reconstruct the graph. Check the actual formats first; do not assume a new compiler or intermediate graph representation is necessary.

### Lucas's role

Lucas processes the prepared graph under the BH harness, publishes the previews and runs the tests provided with the handover. Lucas also defines the usable pod memory sizes and measures the DA2 execution/chunking settings before dispatch at scale. The pod stage executes the prepared work. It does not reopen source selection, reinterpret the brief, author timing keys or redesign the graph. Memory tuning stays within the validated profile; it cannot silently change depth resolution, model, precision or picture controls.

Return actual output and test evidence. A failed run or failed test is reported as such. It must not trigger an unrequested change to method or graph structure. Any correction follows the appropriate side of the boundary and is handed over explicitly.

Compare the received and executed graph/settings with the handover. Use file digests or structural comparison appropriate to the existing BH tooling to detect accidental modification. This does not require a new signing/approval bureaucracy.

Completion check: Lucas executes the handed-over graph/settings and returns previews plus results from the supplied tests.

## 8. Automated output QC and integrity

Lucas runs the supplied automated QC suite on the rendered outputs and returns the results with the previews. The scan covers:

- Duplicate/repeated frames and temporal jitter.
- Colour-space and encoding checks against the delivery specification.
- Zero-byte, missing, corrupt or unreadable frames and sequence completeness.
- Filenames, shot/version/eye identifiers and frame numbering against the agreed naming convention.
- DPX header integrity, including the required timecode entries/placeholders as specified for delivery.
- Expected dimensions, bit depth, frame counts and stereo eye synchronization, plus the usual automated file/transfer integrity checks.

Tests inspect the delivered output. Matching the offline is not a pass override. Results identify the shot/version and affected files or frame ranges for review.

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

Use the existing working components wherever they meet this specification. Do not reorganize the project, rebuild the production harness or redesign the supplied graphs as part of implementation. Use the conditional POC/dry-run estimate in section 15; confirm it after inspecting the graph files, XML interface, stereo nodes, current repeat test and Lucas handover.

## 10. Required implementation inputs

To turn this plan into code, use:

1. Binc's actual approved base graphs, including their local proxy and final-output controls.
2. The defined control-surface contract, or Binc's explicit mapping of settings from which to encode it.
3. One current brief and its selected assets from Kyle, without history.
4. The actual EDL/XML example and intended retime-node interface.
5. The current repeat-frame test, including the offline-comparison branch to remove.
6. The existing handover interface Lucas uses and the expected test-result format.
7. The actual stereo-conversion nodes/base graph and current DA2 wrapper.
8. The pod image digest, dependency/model versions, available GPU VRAM, host/container RAM limits and local Linux GPU/driver specifications.

These are engineering inputs, not a request to reopen production history. Missing implementation details should be resolved from these specific files and interfaces.

## 11. Acceptance

The implementation is complete for the tested base graph when a shot moves through the complete route: fixed brief/asset locations, deterministic pull to the local shot folder, explicit XML timing and finishing curve, copied stereo-ready graph, contracted LLM settings, local proxy human QC, hard-stop pod handover, Lucas's memory-profiled processing, preview publication and independent test results.

It must demonstrate that history is unavailable across the first boundary, the settings LLM cannot change graph structure, and the pod receives the reviewed work without reopening design. The repeat-frame test must catch planted defects without an offline comparison route.

Basis: Binc's explicit workflow corrections in this conversation. XML dialect, node-field mappings, proxy/final mechanics, BH integration and detector thresholds remain implementation details to establish from the supplied files. Additional analysis and implementation choices follow below.

## 12. Workflow analysis: protect the brief and spend HITL on the shot

The brief is safeguarded by limiting what each stage can consume and change. Human time is spent evaluating and improving the shot; scripts check the repeated construction and transfer mechanics.

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

The system must not turn a routine build into repeated requests for Binc to approve copying, naming or input binding. A mechanical failure identifies the failed operation; it does not invite an agent to redesign the shot. Ordinary adjustments within the control surface stay in the local proxy/HITL loop. Additional nodes still require approval.

This safeguards the brief without freezing finishing judgement. The professional trust between editor, director and finishing artist allows technical improvement in service of the intended shot. The tooling carries that work through execution and supplies useful QC evidence.

## 13. Next round: stereo integration and DA2 memory

### Integrate the approved stereo nodes first

The POC must be a stereo POC. Include Binc's specified depth/stereo nodes, approved wiring/layout, existing qualitative completion functions, convergence/depth controls, eye outputs and required colour/precision behavior. Do not declare a mono graph proof sufficient for this round.

The processing order relative to retime and upscale follows Binc's supplied design. Every depth frame must identify which image frame it belongs to and whether that is a source-timeline or finished-record-timeline frame. The consuming stereo node must use the corresponding image/depth pair. Do not silently use an unretimed depth sequence against retimed images.

Local QC includes moving edges, occlusions, depth stability, eye order, frame synchronization and convergence/depth intent. Use brief representative passages for iteration, then one complete shot and at least one representative final-resolution segment before accepting the POC. Proxy behavior alone does not establish final memory use or stereo quality.

### Existing cache-node system

Binc confirms that the existing cache-node system has adjustable backward (−) and forward (+) frame windows held in the pod container's memory. This provides a bounded working window and makes DA2's VRAM requirements more predictable. Use this existing mechanism; a new cache or streaming system is not part of the planned build.

Lucas's resource profile must include both window settings and the container memory budget, alongside the measured RAM/VRAM peaks. Tune execution chunking around that cache behavior and preserve the required context at chunk boundaries. The task is to configure and validate the existing nodes on each pod profile. These controls manage resource use; their actual effect on peak VRAM is measured during the dry run.

### Lucas defines actual pod resource profiles

For each pod type to be used, Lucas records and tests:

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

Inference batch size, execution chunk length and temporal context are separate settings. A chunk need not be a single GPU batch or an entire decoded shot in RAM. Extra system RAM does not replace insufficient GPU VRAM.

Measure the actual graph/wrapper on representative material. Establish a safe operating margin from the measured peak and repeat a full-length run. Do not publish a guessed frames-per-chunk table based only on a 16/24/48 GB GPU label. Start with one job per tested GPU profile; add concurrency only when its combined memory behavior has been measured.

### Chunking rules

1. Keep the approved model, inference dimensions, precision and creative depth/stereo controls fixed while measuring chunk sizes.
2. Assign absolute frame indices. Cover every requested frame exactly once in the final output, even when inference uses overlapping context.
3. Bound decode, GPU inference, post-processing and write buffers independently. A loader that first materializes the whole shot defeats downstream chunking.
4. Inspect the actual DA2 wrapper. The reference DA2 video script estimates frames individually; an installed wrapper may add temporal smoothing, normalization, anchors or propagation. Do not assume it has the reference script's state behavior.
5. Preserve required temporal context and depth-scale behavior across boundaries. Do not reset normalization or anchor schedules at each chunk. Persist required state or provide validated overlap and trim context-only frames from the final sequence.
6. Compare the same moving passage processed whole and across a chunk boundary, where the reference fits. Check the depth data and resulting stereo, not only file counts. The numerical tolerance must be established for the actual implementation; no guarantee of bit-identical GPU pixels is assumed.
7. If a full passage cannot fit whole, compare overlapping regions using shifted chunk boundaries and review resulting stereo seams. Keep that limitation visible.
8. A retry resumes only validated complete work under the same input/settings identity. Remove or quarantine incomplete output; do not silently emit duplicates at a join.

Lucas owns resource measurement and the execution chunk profile. Binc owns picture-affecting depth/stereo behavior. An OOM report may lead to a tested smaller execution chunk; it cannot silently alter the picture-making method.

### Should DA2 be an independent graph?

Evaluate this as a technical option during the POC. It may be beneficial if separate depth inference permits unloading other large models and if repeated stereo adjustments can reuse unchanged depth. It will not fix a DA2 model whose own inference footprint exceeds available VRAM.

| Arrangement | Advantage | Cost/condition |
|---|---|---|
| DA2 inside the stereo graph | Fewer file handoffs; uses the existing spine | Verify that model lifetimes and image buffers do not overlap unnecessarily; changing stereo settings may rerun depth depending on actual caching |
| Explicit approved DA2 graph feeding the stereo graph | Separately bounded memory, restartable depth work and potential depth reuse | Requires an approved graph boundary, additional I/O and an exact depth-data interface |

Recommendation: test the independent-depth option if depth is repeatedly recomputed or model/buffer coexistence is the measured bottleneck. Keep the existing integrated arrangement if it already fits and behaves reliably. Binc decides the graph boundary from that evidence; no agent silently splits the supplied graph.

If separated, each supplied graph has its own copy/populate script. This explicit depth stage is the only proposed exception to the single-graph arrangement; it does not authorize miscellaneous element graphs or preprocessing.

The depth interface must preserve numeric depth values, orientation, scale convention, dimensions, precision and frame identity. Store depth as data in a Binc-approved format; do not use an 8-bit normalized viewing preview as the depth master. Cache identity includes the actual depth input sequence, model/version, settings and any temporal/normalization state. Retime, crop, model or input changes invalidate affected depth; controls downstream of depth can reuse it only if their dependencies permit that.

## 14. Local Linux setup matching the pod

Recommendation: use the Linux CUDA workstation as the local execution and proxy/QC runner if its measured VRAM and RAM suit the supplied graphs. Use the Mac as the workstation for review/control if that remains convenient. This is a targeted execution move, not a project migration or reorganization.

Run the exact same pinned container image digest locally and on the pod, with the same ComfyUI revision, node packs, models, OCIO configuration, Python/PyTorch/CUDA runtime dependencies and internal input/output path layout. Keep the executable runtime fixed and mount each shot's inputs, working directory and outputs at consistent paths. Do not hand-recreate a similar environment or install packages independently on the pod after testing locally.

The container does not clone the GPU, VRAM, host driver, host RAM limits, filesystem throughput or provider configuration. NVIDIA's container tooling still requires a suitable host driver. A successful local run reduces software surprises; it does not replace a dry run on the actual target pod.

First record the Linux machine's actual GPU model/VRAM, RAM, driver and free disk, then compare them with Lucas's intended pod profile. More CUDA cores alone is not a memory or compatibility guarantee. If local VRAM is smaller, validate functional proxy behavior locally and measure full-resolution chunk capacity on the pod. Do not infer pod throughput or capacity from the local run.

Match the production execution path, including container mounts, image/depth formats, loaders, writers and transfer permissions. Confirm model imports and node availability before a long job. No new model, GPU purchase or image upgrade is assumed in the schedule below.

## 15. POC, dry run and automation estimate

Planning allowance: **5–7 working days to a tested small automated batch**, assuming existing working processing nodes, available approved graphs/control mapping, one usable timing example, a representative brief/assets package, the current repeat test and access to Lucas's handover and target pod. This is an estimate of engineering work; pod provisioning, large transfers, render duration, reviewer availability and new algorithm development can extend elapsed time.

| Phase | Engineering allowance | Deliverable and exit condition |
|---|---|---|
| POC | 2–3 days | One real stereo shot: deterministic local pull, copied approved graph, contracted settings, timing/finishing curve, local proxy human QC and measured candidate DA2 memory/chunk behavior |
| End-to-end dry run | 1 day | The reviewed shot runs through Lucas on the real pod; preview publication, supplied tests, one interrupted/resumed work unit and a chunk join are checked |
| First automated batch | 1–2 days | A small representative batch uses the same tested pull/assembly/settings/handover path; mechanics run automatically, shot HITL remains in place |
| Integration contingency | Allow up to 1 additional day | Resolve environment, timing-reader, writer or adapter problems exposed by the dry run |

The normal sequence is 4–6 engineering days plus contingency, hence a 5–7 day planning allowance. Do not imply that all graph types, all stereo methods or all shots are certified by one successful POC. Limit initial automation to the tested base graphs and memory profiles.

### Day-by-day working target

- **Day 1:** pin the common runtime; inspect actual graph/controls and timing interface; implement deterministic asset pull and copy/populate; inventory local/pod memory.
- **Day 2:** integrate the approved stereo nodes, expose the intended settings, run local proxy and finishing review; begin measured DA2 profiling.
- **Day 3 if needed:** complete stereo/depth integration, choose integrated or separate DA2 from evidence, and validate chunk continuity on representative final-resolution data.
- **Next day:** full Lucas handover/dry run, published previews, repeat-frame tests without offline comparison, and interruption/restart check.
- **Following 1–2 days:** automate a small set of valid shot packages, verify that each stays bound to its supplied brief/assets and graph, and expand only the tested coverage.

First automation means deterministic asset pulls and graph instantiation/settings application. It does not mean unattended creative acceptance. Batch progress must not depend on Binc checking mechanical copying or graph wiring shot by shot. Binc's time goes to the proxy picture and genuine exceptions.

The estimate needs revision if approved stereo nodes do not yet work together, an arbitrary-timestep retime reader must be developed, the existing DA2 cache/window system requires changes beyond configuration, or the existing BH adapter cannot accept the prepared package. Those are development tasks, not routine assembly.

### POC selection

Use one shot that exercises the next round's actual stereo path, visible motion and a meaningful depth/occlusion challenge. Include the whale ramp or another finishing-critical ramp if ready; otherwise verify that case separately before claiming ramp support. Include enough duration to cross chunk boundaries, and use a final-resolution segment to measure the real resource envelope. A short easy mono preview is not an adequate proof.

## 16. Sources and limits

The workflow, roles and finishing authority above come from Binc's explicit instructions in this conversation. Estimates, memory-profile fields and the proposed DA2 comparison are engineering recommendations, not observations of the deployed project.

Primary references checked for the platform details:

- [Depth Anything V2 reference video runner](https://github.com/DepthAnything/Depth-Anything-V2/blob/main/run_video.py): frame-by-frame reference implementation. The installed wrapper must be inspected separately; this plan does not substitute Video Depth Anything or change the approved model.
- [NVIDIA Container Toolkit installation prerequisites](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html): the host GPU driver remains a prerequisite outside the application image.
- [PyTorch CUDA memory management](https://docs.pytorch.org/docs/stable/notes/cuda.html): allocated and reserved memory are distinct measurements. Measure process/device use as well; allocator statistics alone do not describe every GPU allocation.

No actual Linux-versus-pod benchmark or chunk-size measurement has been performed for this document. The independent DA2 graph remains an option to test, not an approved implementation change.

## 17. Stereo SBS distribution and headset review

Add a MoonLink serving point for stereo side-by-side (SBS) previews, viewed in Moon Player on Apple Vision Pro and Quest Pro. This is a review endpoint downstream of local proxy generation and Lucas's published previews; it has no role in graph assembly or source selection.

Use a dedicated, versioned SBS review folder on the Mac serving host. Publish only completed review files with the shot/version visible. Register the same review files with MoonLink AVP for Vision Pro and MoonLink QPE for Quest Pro. The vendor currently supplies distinct host applications for these clients. Confirm both services can serve the review folder on the actual host during the dry run; do not assume a single application serves both headsets.

The Linux/pod processing environment can remain separate. Transfer completed SBS previews to the Mac review folder. MoonLink's documented connection is over the same local network; remote reviewers need a separately tested file-transfer/cloud route rather than an assumed public MoonLink URL.

A shared iCloud Drive folder is an optional file distribution/sync route. Fully download each completed file on the serving Mac before registering it with MoonLink; Vision Pro can also use Moon Player's Files integration. Direct iCloud access from the Quest client remains unverified, so the shared serving Mac is the proposed common endpoint.

Binc also proposed iCloud Photos sharing. Distinguish Photos Shared Albums from an iCloud Drive shared folder: Apple documents delivery limits for Shared Albums, including up-to-720p video in applicable versions. Use original SBS files through the local review folder or iCloud Drive for quality review rather than relying on a potentially downscaled album copy. The actual sharing method must preserve the agreed preview quality.

The dry run includes playback of the same identified SBS preview on both headsets. Verify eye order, full/half-SBS interpretation, aspect ratio, frame rate, seeking and uninterrupted playback. Use the encoded stereo directly; disable automatic 2D-to-3D conversion or other picture-altering playback features. Distinguish playback/network stutter from repeated frames encoded in the file using the existing independent output test.

This puts stereo HITL on the picture: depth, comfort, occlusion behavior and the intended moment. Headset review complements the supplied technical tests; it does not certify the final IMAX projection environment.

Implementation allowance: include a 0.5–1 day provisional setup/playback task in the POC/dry-run work, overlapping other tasks where possible. The existing 5–7 day estimate assumes headsets, app access and the serving Mac are available; unresolved playback or distribution issues may extend it. No server, cloud share or headset application has been configured by this document update.

References:

- [MoonLink for Vision Pro](https://moonvrplayer.com/blog/101/moon-link-for-apple-vision-pro)
- [MoonLink for Quest/Pico](https://moonvrplayer.com/blog/20/how-to-use-moon-link)
- [MoonLink AVP host application](https://apps.apple.com/us/app/moonlink-avp/id6736929520?mt=12)
- [MoonLink QPE host application](https://apps.apple.com/us/app/moonlink-qpe/id6468948408?mt=12)
- [Moon Player Vision Pro: Files and Photos access](https://moonvrplayer.com/moon-player-apple-vision-pro)
- [Apple Shared Albums limits](https://support.apple.com/en-us/148868)
