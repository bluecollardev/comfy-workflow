# Technical standards for corrosion: tracking, solve, carry, comp

Source: Binc's instructions, recorded in project memory.

## Baseline (Binc, 2026-10-15, his words; spelling tidied only)

> "solve the camera, track the moving thing (the ship), solve separately, make the camera solve the parent of the object movement solve, add your texture or surface or geo as a comp layer. That's your baseline, and the rest is about tweaking the controls to match the shot, then add your modifiers: lighting match, highlight, reflections. Build nodes, not scripts attached to a node GUI, to expose it to the human. Connect modifiers and tolerances, and a coordinate system with a motion path and keyframe-able bicubic points, so when stuff goes off screen it still goes someplace and doesn't double back on itself, because there is no defined canvas beyond the image borders."

> "No one size fits all; one needs to decide which workflow to use based on the shot. If a 2D warp is going to lose track, we need to solve the camera and point-track the geo, and then apply a warp to fine-tune the position of the texture."

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
