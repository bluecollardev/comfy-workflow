job: corrosion-056_lead-a_blender-track_20261017
shot: corrosion-056  part a   (no Blender track exists yet; track the FULL entry range 093472-093604, 133 frames; lead paint frame is 093520)
tool: Blender GUI + existing script corrosion_blender_track-2ends_v003.py (stock Blender detector + tracker only)
machine: binc-PC
root: /home/binc/CANALV2_r3/CANALV2

STEP 1  Open Blender (GUI). In its Python console:
  exec(open('/home/binc/CANALV2_r3/CANALV2/02_SCRIPTS/solve-blender/corrosion_blender_track-2ends_v003.py').read())
  start('/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/corrosion-052_3D/corrosion-052_3D.LEFT/corrosion-052_3D.LEFT.093472.dpx', 133,
        '/home/binc/CANALV2_r3/CANALV2/10_CORROSION/Gen_Paint_assets/corrosion-052_3D.LEFT.093520_Geo.png',
        <comp matte png for this part in 10_CORROSION/corrosion-056/03_WORK, newest *comp-matte* lead-a; if none exists use the Geo png again>,
        '/home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-056_lead-a_blender-track-2ends_v001')
  Geo png: if the exact name above does not exist, STOP and report the directory listing of Gen_Paint_assets for this shot. Do not pick another.
STEP 2  Wait for the script to write <out>.blend, <out>.json, <out>_report.txt. Do not touch tracks.
STEP 3  Then run the matching anchor + carry job: write it exactly like job_001..009 for this shot/part (S26 label: S26, first 93472, lead 93520) as job_012b and STOP; do not run it. Binc queues it.

REPORT.md in /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-056_lead-a_REPORT.md: files written, track count from the json, clip frame range from the json, tool exit lines verbatim. No other words.
Move this job file to queue/done/ and end the session.
