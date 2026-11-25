# ADR-059: The Outputs modal shows an element in three rows (videos, DPX previews, sequences), and the DPX row has a frame mode: First Frame or Fifth Frame

**Date:** 2026-11-25
**Status:** Accepted (Lucas, 2026-11-25). Rows one and two built on `develop` (not released); the frame mode is not built.
**Context from:** [ADR-058](ADR-058-outputs-overall-left-right-eye.md) (the four slots), the frame previews (`framepreviews.ts`, 320 px JPEGs and 160 px thumbnails), the Outputs modal of ComfyUI-v008-landing-2x4500.

## 1. What happened (the evidence)
- ADR-058 put the four slots (Overall, Left Eye, Right Eye, Side By Side) in one row, each slot a full sequence cell. With four columns the cells were too narrow and the picture, the Data File tile and the buttons were jumbled (Lucas, screenshot 2026-11-25 15:10: "this is messy").
- Lucas's corrections, in order: the four slots on one row; the DPX frames, Load Frame Previews and Expand/Collapse on a second row that is not four columns; the Left Eye, Right Eye and Side By Side slots show **a movie**; then "a row after the first row that shows frame previews of the same stuff in the first row, but these are DPX preview / thumbnail renders", with a display mode "1st frame and 5th frame".

## 2. Decisions
1. **Three kinds of row per element, in this order** (Show Stereoscopic Outputs on):
   1. **Row one, the videos:** four columns, Overall, Left Eye, Right Eye, Side By Side. Each shows the slot's **video** (a video file whose name carries the slot's role and the element's stem, same folder first; the Left Eye falls back to the main video beside its sequence). A slot with frames but no video reads `No Video`; a slot with neither reads `Not Generated`. A right-eye video with no right-eye frames still shows in its slot.
   2. **Row two, the DPX previews:** the same four columns, each the slot's DPX preview (the 320 px frame JPEG, else the decoded first frame), a click opens the viewer at that frame. An empty slot is the dashed `Not Generated` placeholder.
   3. **Then each filled sequence at full width,** as before: tile, Data File, the filmstrip, Load Frame Previews, Expand/Collapse, the frame list.
2. **The frame mode of row two** is a two-way switch above that row, **First Frame** (default) and **Fifth Frame**. It changes which frame of each sequence the row shows: the first frame (index 0), or the fifth (index 4). A sequence of fewer than five frames shows its last frame. The click opens the viewer at the frame shown.
3. **The fifth frame needs its own preview:** the first frame's JPEG is made at once; the fifth comes from the frame previews job (Load Frame Previews, Load all previews). Until it exists the card shows the film icon and a **Load Frame Previews** action, never an error.
4. **The mode is remembered per viewer** (browser storage, like the Show Stereoscopic Outputs checkbox) and the page renders without it. It is display only: no file is written, renamed or published differently.
5. **Show Stereoscopic Outputs off** shows the sequences as before: no slot rows and no mode switch.

## 3. Consequences
- The pictures of the four slots line up for comparison (video, then DPX), and the wide sequence controls no longer share a narrow column.
- The old specs that expect a sequence's tile as the first thing in the modal run with the checkbox off (the e2e fixture sets it, the eye-slot specs set it on).
- The 5th-frame mode is only as good as the previews on the pod; a pod with only first-frame previews shows the placeholder.

## 4. Open
- Build the mode switch, the fifth-frame source and a browser spec (First Frame default, Fifth Frame swaps the picture and the viewer start index, fewer than five frames shows the last, the choice is remembered).
- Ask Binc how their right-eye and side-by-side videos will be named (the role tokens are a guess until a real file exists, ADR-058).
