#!/usr/bin/env python3
"""Publish one volume DPX folder to the exchange bucket through the app's own MCP endpoint (127.0.0.1:8765): S3 only, approved by Lucas.
usage: runclip.py <round> <dpx dir under output/> <stem>   -> prints one result line; exit 0 done, 1 failed"""
import json, os, sys, time, urllib.request
rnd, d, stem = sys.argv[1:4]
URL = 'http://127.0.0.1:8765/mcp'
HDR = {'content-type': 'application/json', 'accept': 'application/json, text/event-stream'}

def call(name, args, rid=1):
    req = urllib.request.Request(URL, json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': 'tools/call', 'params': {'name': name, 'arguments': args}}).encode(), HDR)
    body = urllib.request.urlopen(req, timeout=120).read().decode()
    line = next((l[5:].strip() for l in body.splitlines() if l.startswith('data:')), body)
    r = json.loads(line)
    if 'error' in r: raise RuntimeError(r['error'])
    txt = ''.join(c.get('text', '') for c in r['result'].get('content', []))
    if r['result'].get('isError'): raise RuntimeError(txt[:300])
    return json.loads(txt)

jobs_file = os.path.expanduser('~/.config/runpod-pod-manager/publish-jobs.json')
def job(jid):
    j = json.load(open(jobs_file)); js = j.get('jobs', j) if isinstance(j, dict) else j
    return next((x for x in js if x.get('job_id') == jid), None)

item = {'where': 'volume', 'path': d, 'stem': stem}
try:
    jid = call('publish', {'action': 'run', 'items': [item], 'targets': ['s3'], 'round': rnd, 'preview_frame': False, 'approved_by': 'Lucas', 'confirm': True})['job_id']
except Exception as e:
    print(f'FAILED to start {stem}: {e}'); sys.exit(1)
t0 = time.time()
while True:
    time.sleep(5)
    x = job(jid)
    if x and x.get('state') in ('done', 'done_with_warning', 'failed', 'cancelled'): break
    if time.time() - t0 > 6 * 3600: print(f'TIMEOUT {stem} {jid}'); sys.exit(1)
ok = x['state'] in ('done', 'done_with_warning') and not x.get('error')
rate = (x.get('rate_bps') or 0) / 1e6
print(f"{'OK' if ok else 'FAIL'} {stem} {rnd} | {x.get('state')} | {x.get('files_done')}/{x.get('files_total')} files | {(x.get('bytes_done') or 0)/1e9:.2f} GB | {rate:.1f} MB/s | via {x.get('adapter')} {x.get('pod') or ''} pod_files={x.get('pod_files')} pc_files={x.get('pc_files')} | {x.get('error') or x.get('summary') or ''}"[:400])
sys.exit(0 if ok else 1)
