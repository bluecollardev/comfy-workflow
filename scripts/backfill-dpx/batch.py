#!/usr/bin/env python3
"""Backfill the DPX frames of the reviews already published (docs/CANALV2-DPX-BACKFILL-PLAN.md): one clip at a time, S3 only, into the round each review is in.

Needs the RunPod Manager app (v1.6.6 or later) RUNNING: it drives the app's own MCP endpoint on 127.0.0.1:8765, so the upload uses the app's pod route.
Safe to stop and run again: files already in the bucket are skipped ("same size already there"), so a finished clip costs a check, not an upload.
Pause between clips: create a file named STOP next to this script (the batch ends after the clip it is on); delete it to run again.
usage: batch.py [--group A|B|C ...] [--only stem-prefix ...]   (default: every clip, A then B then C; stops after 2 failures in a row)"""
import json, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
groups = [args[i + 1].upper() for i, a in enumerate(args) if a == '--group'] or ['A', 'B', 'C']
only = [args[i + 1].lower() for i, a in enumerate(args) if a == '--only']
clips = [c for c in json.load(open(os.path.join(here, 'clips.json'))) if c['group'] in groups and (not only or any(c['stem'].lower().startswith(o) for o in only))]
print(f"{len(clips)} clips, {sum(c['bytes'] or 0 for c in clips) / 1e9:.1f} GB", flush=True)
fails = 0
for c in clips:
    if os.path.exists(os.path.join(here, 'STOP')): print('STOPPED: the STOP file exists', flush=True); sys.exit(0)
    r = subprocess.run([sys.executable, os.path.join(here, 'runclip.py'), c['round'], c['dir'], c['stem']], capture_output=True, text=True)
    print((r.stdout.strip() or r.stderr.strip())[:420], flush=True)
    fails = fails + 1 if r.returncode else 0
    if fails >= 2: print('STOPPED: 2 failures in a row', flush=True); sys.exit(1)
print('BATCH DONE', flush=True)
