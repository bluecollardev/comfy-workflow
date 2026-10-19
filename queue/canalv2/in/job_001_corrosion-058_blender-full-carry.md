job: corrosion-058_blender-full-carry_20261017
shot: corrosion-058  part a
tool: anchor-from-blender (existing script) -> graph v022 (copy of v021, two widget changes) -> queue-graphs v003
machine: binc-PC
root: /home/binc/CANALV2_r3/CANALV2

STEP 1  Solve from the Blender tracks, whole shot (start = first frame, ramp 0). Existing script, run as-is:
  python3 /home/binc/CANALV2_r3/CANALV2/02_SCRIPTS/solve-blender/corrosion_anchor-from-blender_v001.py \
    /home/binc/CANALV2_r3/CANALV2/10_CORROSION/corrosion-058/03_WORK/solve_S26_v001.npz \
    /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-track_2026-10-17/corrosion-058_lead-a_blender-track-2ends_v001.json \
    93999 93999 93999 \
    /home/binc/CANALV2_r3/CANALV2/10_CORROSION/corrosion-058/03_WORK/solve_S26F_v001.npz S26F 0
  Must create: /home/binc/CANALV2_r3/CANALV2/10_CORROSION/corrosion-058/03_WORK/solve_S26F_v001.npz and solve_S26F_v001_log.txt. If the npz exists already: STOP, report.

STEP 2  Graph: copy /home/binc/CANALV2_r3/CANALV2/10_CORROSION/corrosion-058/04_GRAPH/corrosion-058_graph_v021.json to corrosion-058_graph_v022.json. Change ONLY:
  a) the BH_LoadSolve node whose output feeds the part-a BH_CarryLayerExact (title starts 'D0'): label widget 'S26' -> 'S26F', version widget -> 1.
  b) the BH_RenderMp4 and BH_WriteProxySeq nodes (titles start 'F1', 'F2'): folder -> /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-full_2026-10-17, name prefix -> corrosion-058_gen-s26f_lead-a-left.
  c) the 00 CHANGE REPORT note: VERSION v022; CHANGED: D0 load S26F v001; F1/F2 output folder. UNCHANGED: everything else.
  No other node, link, widget or mode changes. Trackers stay muted.

STEP 3  Queue, wait, report:
  python3 /home/binc/CANALV2_r3/CANALV2/02_SCRIPTS/queue-graphs/corrosion_queue-graphs_v003.py --shots 058 --wait
  (it takes the newest graph = v022; output job folder under 06_REVIEW plus the mp4 in 80_TEST-BUCKET/corrosion_blender-full_2026-10-17).

REPORT.md in /home/binc/CANALV2_r3/CANALV2/80_TEST-BUCKET/corrosion_blender-full_2026-10-17/corrosion-058_REPORT.md: files written (paths, counts, frame ranges from disk), stopped-at frame, tool exit lines verbatim,
  the '_log.txt' lines from STEP 1 copied verbatim (they name frames where fewer than 12 tracks were available). No other words.
Then move this job file to queue/done/ and end the session.
