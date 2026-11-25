# ADR-058: Each sequence in an Outputs modal has four slots: Overall, Left Eye, Right Eye, Side By Side

**Date:** 2026-11-25
**Status:** Accepted (Lucas, 2026-11-25). Not built.
**Context from:** the Outputs modal of ComfyUI-v008-landing-2x4500 (PHOTOREAL-013 landing), ADR-045 (all outputs mode), the frame previews and thumbnails (`framepreviews.ts`), the Tunnel V11 delivery ("mono left eye").

## 1. What happened (the evidence)
- The outputs of the landing pod hold one DPX sequence per element under `delivery_v008/<clip>/` (226 frames and a `.json`). It is the mono **left eye**; no right eye and no overall file exist on the volume.
- The right eye and the overall output are **not generated yet; Lucas will render them next** (2026-11-25). The right eye will come from **additional Binc workflows** that are not in the app yet (Lucas, 2026-11-25).
- The modal shows each sequence as one group with one set of previews, so a stereo element cannot show its three pictures side by side.

## 2. Decisions
1. **Four slots per sequence** (amended 2026-11-25): `Overall` (the combined shot), `Left Eye`, `Right Eye` and `Side By Side` (left and right next to each other, SBS). A **Show Stereoscopic Outputs** checkbox in the Outputs modal (above Hide Empty Folders, on by default) turns the slots on and off; off shows the sequences as before. Each slot shows its own previews (the 320 px frame previews, the 160 px thumbnails, and a video poster where the slot is a video) exactly as a sequence does today.
2. **A slot is filled by naming, not by a setting.** The role is read from the file or folder name as a whole token: `LEFT`, `_L`, `.L.` or `LE` for the left eye; `RIGHT`, `_R`, `.R.` or `RE` for the right eye; `OVERALL`, `STEREO`, `PACK` or `COMBINED` for the overall output; `SBS`, `SIDEBYSIDE` or `LR` for the side-by-side output (it wins over overall). A sequence with no such token is the **left eye** (today's mono deliveries), so nothing already delivered changes. The token list is one table in core so Binc's workflows can be matched by editing it.
3. **An empty slot is shown, not hidden:** it shows a dashed preview placeholder and reads `Not Generated` (with the workflow that would write it, when known) so a missing right eye is visible. It is never counted as a failure and never blocks Publish or Auto-publish.
4. **Previews are generated per slot** by the same jobs (Load all previews, the Queue's Generations tab); the folder is the unit, so left and right in different folders each get their own `.previews/`.
5. **Delivery is unchanged:** the V11 delivery stays "mono left eye". The right eye and overall are published only when a person includes them.

## 3. Consequences
- A stereo element reads as one row with three pictures; mono ones show one filled slot and two empty ones.
- No file on the volume is renamed or moved; the roles are display only.
- The naming of Binc's right-eye workflow output is not known: the token table is a guess until a real file exists, and the first right-eye run decides it.

## 4. Open
- Ask Binc the right-eye workflow names and the output naming.
- Build the grouping in the Outputs modal (`OutputsGallery`/`PodOutputsModal`) and the role table in core, with browser specs; gate before release.
