job: corrosion-118_lead-a_blender-track_20261017
shot: corrosion-118  part a   (no Blender track exists yet for this part)
tool: Blender GUI + existing script corrosion_blender_track-2ends_v003.py (stock Blender detector + tracker only)
machine: binc-PC
root: /home/binc/CANALV2_r3/CANALV2

STEP 1  Open Blender (GUI). In its Python console:
  exec(open('/home/binc/CANALV2_r3/CANALV2/02_SCRIPTS/solve-blender/corrosion_blender_track-2ends_v003.py').read())
  start('/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/corrosion-112_3D/corrosion-112_3D.LEFT/corrosion-112_3D.LEFT.108751.dpx', 66,
        '/home/binc/CANALV2_r3/CANALV2/10_CORROSION/Gen_Paint_assets/corrosion-112_3D.LEFT.[108521-108751]_Geo.png',
        <comp matte png for this part in 10_CORROSION/corrosion-118/03_WORK, newest *comp-matte* lead-a; if none exists use the Geo png again>,
        '/home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-118_lead-a_blender-track-2ends_v001')
  Geo png: if the exact name above does not exist, STOP and report the directory listing of Gen_Paint_assets for this shot. Do not pick another.
STEP 2  Wait for the script to write <out>.blend, <out>.json, <out>_report.txt. Do not touch tracks.
STEP 3  Then run the matching anchor + carry job: write it exactly like job_001..009 for this shot/part (S26 label: SA26, first 108751, lead 108751) as job_014b and STOP; do not run it. Binc queues it.

REPORT.md in /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-118_lead-a_REPORT.md: files written, track count from the json, clip frame range from the json, tool exit lines verbatim. No other words.
Move this job file to queue/done/ and end the session.
