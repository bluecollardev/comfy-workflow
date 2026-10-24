# Delivery packages (the Brynley round)

**Status:** notes from reading the first package, 2026-10-23. Nothing here is built;
the import is a design waiting on two decisions (end of this page). Everything stated
as fact was read from the package's own files; what is inference is marked.

## What they are

A **delivery package** is a self-contained ComfyUI handover of finished shots, built
by the Panama Canal v2 film project (`panama-imax-redux`, its script
`scripts/panama-gen/build-brynley-comfy-delivery.py`, Kyle's side) for **Brynley, who
is Binc** (BH). The recipient is the same person as CANALV2's owner, but the content
is a different job from CANALV2, the IMAX restoration: a different film, a different
tree. The first package we have is `brynley-comfy-2026-10-20` (round 2026-10-20,
earlier READMEs dated 2026-09-30), three shots:

| Shot | Graph | Delivered finals | Size |
|---|---|---|---|
| cgi-042 | `cgi-042-common-nodes-v13-delivery-20261020.json` | 1 (3840x2160 HEVC) | 6.3 GB |
| archival-071 | `archival-071-common-nodes-v10-delivery-20261020.json` | 1 (3840x2160 HEVC) | 1.0 GB |
| creature-266 | `creature-266-common-nodes-v02-delivery-20261020.json` | 3 (1920x1080 HEVC) | 1.5 GB |

Purpose, in the package's own words: "First test round of the delivery contract on
three shots" (its notes/167). The **delivery contract** (§3 naming and hashes, §4 the
spec gate) is the spec for handing a shot to an outside artist. A package carries:

- the **graph** of each shot in **HISTORY** mode: a record of the steps that made the
  final, with every paid provider node (fal.ai, OpenAI) **bypassed**, so opening or
  queueing it re-bills nothing and generates nothing;
- the **inputs** the graph loads, with their sha256 in `MANIFEST.json`;
- the **approved finals** under their delivered names;
- the **provenance** of how it was made;
- a **gate** result per shot (all three failed, with exceptions Kyle accepted, e.g.
  "Let Brynley add the Stereo work", "Let him conform frame rate as well").

Binc's part (stated in those exceptions, which name Brynley): the stereo work and the
frame-rate conform. There is no stereo PRODUCTION graph in this round. *Inference:* the larger
aim is stereo conversion of the Panama film; the package does not say so outright.

README rule: **do not queue anything without Kyle's go-ahead.** Nothing in the round
has been run.

## The layout

Delivered as five parts (a Google Drive split): five folders
`brynley-comfy-2026-10-20`, ` 2` to ` 5`, plus five zips of the same bytes (the zips
are redundant once the extract is verified). Each part holds pieces of the same tree;
merged they are the original: 1,287 files, 18 GB with the zips, 9 GB without. Only
part 1 has the top-level `MANIFEST.json`; the readmes are spread over parts 2 to 4.

```
brynley-comfy-2026-10-20/
├── MANIFEST.json                 built, for, ComfyUI version, per-shot files/bytes/graph, delivered names
├── 00_READ_ME.md                 status per graph, spec gate, open problems, delivered finals table
├── 01_PATHS_FOR_SETUP.md         the install procedure and every path each graph loads
├── README.md                     per-shot install
└── <shot>/                       cgi-042, archival-071, creature-266
    ├── MANIFEST.json             every file's sha256
    ├── comfy/
    │   ├── input/shots/<shot>/…  what the graphs load, by path relative to ComfyUI's input folder
    │   └── workflows/            the graph, its _api twin, its inputs manifest
    ├── final/                    the delivered video(s), delivered names
    ├── approved/                 the approved intermediates under their repo folder names
    └── provenance/03-scripts/    the scripts and notes that built the shot
```

| Folder | cgi-042 | What it is | Needed to open a graph? |
|---|---|---|---|
| `comfy/input` + `comfy/workflows` | about 45 MB (all five parts) | the graph and exactly the files it loads | **yes** |
| `final/` | 246 MB | the finished deliverable | no |
| `approved/` | 5.7 GB | the approved plates, boards, character sheets, output videos; the source of `comfy/input`'s copies, under their original folder names | no |
| `provenance/` | 1.5 MB | where it all came from: the Python and Node scripts that generated boards, composited, graded and ran the paid provider calls; markdown and JSON records of generation runs (the README's "fire records" and ledger rows) | no, but small |

**Provenance** means the record of how a file came to exist: which tool, parameters,
inputs and run produced it, so the result can be reproduced or defended. The
package's open problems are provenance gaps: "prompts not recorded", "seed not
logged", "fire record unresolved".

Across the three shots the inputs the graphs load come to about 1 GB (78 files); the
other 8 GB is `final`, `approved` and `provenance`.

## How a graph finds its files

Loader nodes name files **relative to ComfyUI's input folder**, always
`shots/<shot>/…`. The package's own procedure (`01_PATHS_FOR_SETUP.md`): copy each
`<shot>/comfy/input/` into ComfyUI's `input/` **keeping the `shots/<shot>/…` folders**
(do not rename or flatten), copy the workflows into `user/default/workflows/`, copy
the node packs into `custom_nodes/`, check every path exists, check the hashes.

Checked 2026-10-23 against the extracted parts: all 85 image and video paths the
three graphs load resolve (archival-071 35, cgi-042 28, creature-266 22).

On our pod image that means: input folder = `/workspace/comfy-shared/input`,
Workflows panel = `/workspace/comfy-shared/workflows` (ADR-006). So the package's
`<shot>/comfy/input/shots/<shot>` belongs at `comfy-shared/input/shots/<shot>` and its
`comfy/workflows` at `comfy-shared/workflows`.

## What it needs that we do not have

- **The node packs.** The READMEs say each shot's `nodes/<pack>-vN/` folder carries them
  (setup: copy into `custom_nodes/<pack>/`, dropping `-vN`); none came through in the
  2026-10-20 extract. The 2026-10-23 round's manifest lists packs `bh_stereo_dibr-v0.4.0`
  and `ComfyUI-BincStereo`. The graphs use core nodes (`LoadImage`, `LoadVideo`,
  `GetVideoComponents`, `Reroute`, `MarkdownNote`, …), the `OpenAIGPTImageNodeV2`
  partner-API node, and 13 `FalAPI_*` nodes (Seedance 2.5 image-to-video, Seedream
  4.5 edit, nano-banana pro edit) from a fal pack our image does not carry (it has
  ShotPipe v7, v10 to v14, v26 and BincStereo). Without it ComfyUI opens the graphs
  with missing-node warnings on those nodes.
- **ComfyUI 0.39.2 or later.** The manifest records 0.39.2 at commit `3c1b7a17`,
  which is exactly our pin (`apps/comfy-app/pins.env`).
- **For a real run**: provider API keys (the package does not say whose) and a go-ahead. Those nodes call paid
  APIs; under `shared/governance/policy/agent-permissions.md` spend needs a named
  yes. No GPU is involved: these graphs make API calls, so a small pod or the Mac's
  ComfyUI is enough to open and inspect them.

## What Binc does with them

First read from the READMEs and gate tables, then confirmed by the delivery contract
itself (`projects/contract/`, §5.2 and the guide §15, notes/172, 2026-10-22). It is a
first-test handover: Kyle's side generates, Binc finishes.

- **Receives finished generation, not raw plates.** Each shot's graph is `MODE: HISTORY`,
  "BUILT - NOT RUN", every provider node bypassed: it records how the picture was made.
- **Adds the stereo work.** Kyle's gate decisions (notes/167) say "Let Brynley add the
  Stereo work." The §4.2 checks (depth source, temporal, limits, cut continuity, review
  format, human QC) are EXCEPTION rows whose replacement step is "Brynley's stereo pass,
  then the §4.2 measures on his eyes."
- **Registers the stereo graph.** §4.3 notes no PRODUCTION (stereo) graph yet:
  "Brynley's stereo graph, registered on return."
- **Conforms.** "Let him conform frame rate as well" (24 fps conform record);
  archival-071 needs 8-bit to 16-bit; camera-path concerns are "flagged to Brynley";
  untagged colour is tagged at conform.
- **Was already building his own test and delivery pipeline** (cgi-042 stereo-source
  audit, 2026-10-10; a Ruby HDR test package was staged for it).

Flow: Kyle generates, Binc stereo-converts, conforms, finishes, returns the graph.

**The lock and the send-back** (contract §5.2, Binc's wording): the HISTORY graph is
locked, baked, never rewired on his side. Stereo, conform and 16-bit work branch from the
HANDOFF frame into his own PRODUCTION graph. When stereo does not work from a final he
sends the shot back with his measures; the fix is made in generation on Kyle's side and
re-delivered as a new round (`-rN`; a sent round is never edited). He returns his graphs
with the inputs manifest and run script filled from the package's templates
(`GRAPH-STEM-inputs-manifest.example.json`, `run_GRAPH-STEM.template.py`).

So the packages are inputs to Binc's stereo/conform work, not jobs to re-run: provider
nodes are bypassed and replaying a fire needs Kyle's go and the provider key. What would
run on RunPod is the PRODUCTION (stereo) graph, not the HISTORY graph.

Who is who in these documents: **Kyle** approves (only he moves a take into `Approved/`),
drives Comfy Desktop through Claude, and every send or copy to Drive is his call.
**Brynley (Binc)** receives the rounds, finishes them, and is the source of the BH-ShotPipe
packs (v7 to v13), the lettered-group layout, the stereo-generation risk notes (notes/137,
2026-10-12) and his own `01_PATHS_FOR_SETUP.md` method. **Jon** supplies the EDL
placements. **Astra** (GPT-6) does the layout QA on the delivered graph bytes.

### Format against CANALV2

Binc's CANALV2 (`projects/desktop/CANALV2`) is a working tree: per-shot stage folders
(`03_WORK`, `04_GRAPH`, ...) with numbered graph versions and `_api.json` exports, plus
`20_STEREO/<shot>/04_GRAPH/` and `80_TEST-BUCKET/` proofs of concept. A package is a
bundle (`comfy/`, `final/`, `approved/`, `provenance/`, hashed `MANIFEST.json`) whose
graphs use `comfy/input/shots/<shot>/...` paths. Whether a CANALV2 graph and a package
graph for the same shot share node types and ShotPipe version is unchecked.

## Doing it today, by hand

No import feature exists. Loading a package onto the Mac or a pod without changing
its layout means: merge the five parts into one tree, give ComfyUI the
`shots/<shot>/…` paths it expects (copy into the shared input folder, or link
`input/shots/<shot>` to `<package>/<shot>/comfy/input/shots/<shot>`), put the
workflows where the panel reads them, and Sync the shared folder to the pod.
Copying into `~/ComfyUI-Shared` was tried on 2026-10-23 and undone at Lucas's request:
he does not want the package's structure changed.

## The design for importing, and what is open

**Update 2026-10-24:** the import is built as adapters (`docs/ADR-008-import-adapters.md`, spec `docs/IMPORT-ADAPTERS.md`): this package format is the built-in `panama-imax-redux` adapter (`./start.sh import <folder> --dry-run`, or Import Shot Pack); other formats are hot-loaded modules. Inputs land in ComfyUI-Shared's `input/` with `shots/<shot>/` unchanged, workflows under `workflows/panama-imax-redux/<round>/`, packs under `node-packs/panama-imax-redux/`. Merge the Drive parts first so every shot's manifest is present and every copied file is hash-checked. The three points below are the earlier sketch.

1. **A layout per project type.** The next-steps item "abstract shapes and concrete
   shapes" fits: CANALV2 is one layout (project tree, plates, ComfyUI-Shared), the
   delivery package another, each a small file listing where its parts go on the pod.
2. **The package stays whole.** The five parts merge back into the one tree they were
   cut from (no renames, no flattening); the app mounts it as a custom folder with a
   pod path and one link per shot, which the entrypoint's link mechanism (`COMFY_LINKS`)
   already supports.
3. **A packages view.** Add a package folder; see its shots and graphs, whether every
   file matches the manifest, and which node types its graphs need that the image
   lacks; load onto a pod only the parts a graph needs (about 1 GB, not 9).

Open decisions (Lucas, to answer): **what "run" means** (open and inspect on a pod,
or real generation with spend, keys and Kyle's go-ahead), and **scope** (one package
or a stream of them in this shape, which decides layout files versus a one-off).

## The 2026-10-23 round and the contract documents

`projects/contract/` (added 2026-10-24; `.md` files saved as `.docx`) holds the contract
(`DELIVERY-CONTRACT`), the graph guide (`COMFY_DELIVERY_GUIDE`), the install notes
(`README`, `01_PATHS_FOR_SETUP`) and the `MANIFEST.json` of a newer round, built
2026-10-23 on ComfyUI 0.42.1 (commit `63be2f9b`, repo commit `ea299592`). Its shots:
archival-085, 102, 103, 104 and 123 (about 5,700 files; archival-123 alone is 4,907 files,
14.8 GB, with three element graphs and three stereo graphs). The round's shot folders are
not in the repo. Its floor is 0.42.1, above the 0.39.2 pin noted above.

Setup per the guide: loader values are paths relative to ComfyUI's input folder
(`shots/<shot>/...`); Kyle's own Comfy uses the film folder as its input and output
folder, so a package's `comfy/input/` stands in for it. The contract is explicit that a
received package is kept byte-identical and never edited.
