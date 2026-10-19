job: corrosion-051_whip_blender-track_20261017
shot: corrosion-051  part whip (092841-092850, 10 frames between lead a and lead b; no render covers them)
tool: Blender GUI + existing script corrosion_blender_track-2ends_v003.py (stock Blender detector + tracker only)
machine: binc-PC
root: /home/binc/CANALV2_r3/CANALV2

STEP 1  Open Blender (GUI). In its Python console:
  exec(open('/home/binc/CANALV2_r3/CANALV2/02_SCRIPTS/solve-blender/corrosion_blender_track-2ends_v003.py').read())
  start('/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/corrosion-051_3D/corrosion-051_3D.LEFT/corrosion-051_3D.LEFT.092841.dpx', 10,
        '/home/binc/CANALV2_r3/CANALV2/10_CORROSION/Gen_Paint_assets/corrosion-051_3D.LEFT.092809_Geo.png',
        <comp matte png for this part in 10_CORROSION/corrosion-051/03_WORK, newest *comp-matte* lead-a (the whip carries lead a's paint forward); if none exists use the Geo png again>,
        '/home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-051_whip_blender-track-2ends_v001')
  Geo png: if the exact name above does not exist, STOP and report the directory listing of Gen_Paint_assets for this shot. Do not pick another.
STEP 2  Wait for the script to write <out>.blend, <out>.json, <out>_report.txt. Do not touch tracks.
STEP 3  Then run the matching anchor + carry job: write it exactly like job_001..009 for this shot/part (S26 label: SA26, first 92841, lead 92841) as job_010b and STOP; do not run it. Binc queues it.

REPORT.md in /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-051_whip_REPORT.md: files written, track count from the json, clip frame range from the json, tool exit lines verbatim. No other words.
Move this job file to queue/done/ and end the session.
