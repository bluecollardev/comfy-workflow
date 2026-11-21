#!/usr/bin/env python3
"""Tunnel V11 push readiness: one row per element of the 36, read-only, from the real round in the exchange bucket.

For each element: DPX frames in the round against the PDF count, ProRes (.mov) and H.264 (.mp4) review videos, the element's own manifest.
Writes docs/CANALV2-TUNNEL-V11-PUSH-READINESS.md (regenerated each run) and prints the same table. Bangkok time (UTC+7).
Usage: python3 scripts/delivery-readiness.py [--no-write]
"""
import datetime, importlib.util, subprocess, sys

spec = importlib.util.spec_from_file_location('ds', 'scripts/delivery-status.py')
ds = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ds)

OUT = 'docs/CANALV2-TUNNEL-V11-PUSH-READINESS.md'


def scan():
    out = subprocess.run(['aws', 's3', 'ls', ds.ROUND, '--recursive', '--profile', 'panama', '--region', 'us-west-2'], capture_output=True, text=True, timeout=240).stdout
    d = {k: {'dpx': 0, 'mov': 0, 'mp4': 0, 'manifest': None} for k in ds.PDF}
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        base = parts[3].rsplit('/', 1)[-1]
        low = base.lower()
        k = ds.key_of(base)
        if k not in d:
            continue
        if low.endswith('.dpx'):
            d[k]['dpx'] += 1
        elif low.endswith('.mov'):
            d[k]['mov'] += 1
        elif low.endswith('.mp4'):
            d[k]['mp4'] += 1
        elif base.endswith('_MANIFEST.json'):
            d[k]['manifest'] = parts[0] + ' ' + parts[1][:5]
    return d


def main():
    d = scan()
    now = ds.now().strftime('%Y-%m-%d %H:%M')
    rows = ['| # | Element | DPX in round / PDF | ProRes | H.264 | Manifest | Ready to push |', '|---|---|---|---|---|---|---|']
    ready = 0
    for i, (k, n) in enumerate(ds.PDF.items(), 1):
        r = d[k]
        frames_ok = r['dpx'] == n
        if k in ds.DEFERRED:
            state = 'deferred (f23)'
        else:
            missing = []
            if not frames_ok:
                missing.append('frames')
            if not r['mov']:
                missing.append('ProRes')
            if not r['mp4']:
                missing.append('H.264')
            if not r['manifest']:
                missing.append('manifest')
            state = 'yes' if not missing else 'missing: ' + ', '.join(missing)
            ready += not missing
        rows.append(f'| {i} | {k} | {r["dpx"]} / {n}{"" if frames_ok else " ✗"} | {"yes" if r["mov"] else "no"} | {"yes" if r["mp4"] else "no"} | {r["manifest"] or "no"} | {state} |')
    want = len([k for k in ds.PDF if k not in ds.DEFERRED])
    head = f'# CANALV2 Tunnel V11: push readiness ({now} Bangkok time)\n\nRead-only snapshot of `{ds.ROUND}` written by `scripts/delivery-readiness.py`: per element the DPX frames against the PDF count, the ProRes and H.264 review videos and the element manifest. **{ready} of {want} targeted elements have everything** (frames, ProRes, H.264, manifest); f23 is deferred. A missing H.264 or ProRes is a review-video gap, not a frame gap.\n\n'
    text = head + '\n'.join(rows) + '\n'
    print(text)
    if '--no-write' not in sys.argv:
        open(OUT, 'w').write(text)


if __name__ == '__main__':
    main()
