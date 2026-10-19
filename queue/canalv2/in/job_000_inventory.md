job: inventory_20261017-0600
shot: all corrosion (051 056 058 064 110 118 122 124 131 148 160 165)
tool: read-only shell (find, ls, stat). No ComfyUI, no Blender, no Python beyond listing.
machine: binc-PC
root: /home/binc/CANALV2_r3/CANALV2
output: 04_TRACKER/inventory_20261017-0600/

Write INVENTORY.csv with one row per file found, columns:
shot, kind, path, bytes, modified, frame_count, frame_first, frame_last, written_by

kind is one of: plate-L, plate-R, solve, paint, matte, geo, render
written_by: for solves and renders, the tool name if it is in the file or folder name or a sidecar; else "unknown". Never guess.
frame_count: counted from image files on disk, not from any .txt or .json.

Search:
  10_CORROSION/<shot>/03_WORK/      solves (*.npz, *.blend, *.json)
  10_CORROSION/<shot>/06_REVIEW/    renders (every job folder, every image sequence and mp4)
  10_CORROSION/Gen_Paint_assets/    geo, dpx, Gen_Paint_Output/*/ paints and mattes
  80_TEST-BUCKET/                   renders, .blend
  /mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates/   plates

Do not read, summarise or copy any report, .txt or .json content into the inventory. List the file; that is all.
Do not rank, flag, judge or recommend. No column may hold a word like good, bad, pass, fail, best, latest.
REPORT.md: files written, row count, folders that could not be read.
Then stop.
