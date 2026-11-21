#!/usr/bin/env python3
"""Tunnel V11 delivery status: a read-only snapshot written between two markers of the delivery report and the production plan.

What it reads (nothing is written anywhere but those two docs):
  * the real round in the exchange bucket (aws s3 ls, profile `panama`): which elements have their own _MANIFEST.json, how many DPX frames each holds;
  * the ComfyUI /queue and /history of the render pods (public proxy URLs, GET only): per element frames written, the chunk running now, the rate, an ETA.

Usage:  python3 scripts/delivery-status.py [--pods top=<id> landing=<id> sunlight=<id> ...] [--no-write]
The markers are  <!-- LIVE-STATUS:START -->  and  <!-- LIVE-STATUS:END -->  (added once, by hand, under the title).
Times are Bangkok time (UTC+7).
"""
import datetime, json, re, subprocess, sys, urllib.request

ROUND = 's3://bh-panama-exchange-610140802195/returns/BKK/tunnel-v11-edl-2026-11-18/'
DOCS = ['docs/CANALV2-TUNNEL-V11-DELIVERY-REPORT-2026-11-20.md', 'docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md']
# the PDF frame counts of the 36 elements (docs/CANALV2-TUNNEL-V11-PRODUCTION-PLAN.md section 11)
PDF = {
    'ARCHIVAL-071_MAIN': 227, 'ARCHIVAL-077_A': 80, 'ARCHIVAL-077_B': 69, 'ARCHIVAL-077_C': 74, 'ARCHIVAL-080_A': 94, 'ARCHIVAL-080_B': 60,
    'ARCHIVAL-080_C': 90, 'ARCHIVAL-080_D': 83, 'ARCHIVAL-080_E': 44, 'ARCHIVAL-083_MAIN': 98, 'ARCHIVAL-084_MAIN': 39, 'ARCHIVAL-085_MAIN': 54,
    'ARCHIVAL-093_B': 126, 'ARCHIVAL-102_MAIN': 128, 'ARCHIVAL-104_B': 130, 'ARCHIVAL-123_C': 66, 'CGI-042_MAIN': 229, 'ARCHIVAL-087_PLATFORM': 97,
    'ARCHIVAL-087_RAIN': 96, 'ARCHIVAL-123_F': 43, 'ARCHIVAL-168_A': 153, 'ARCHIVAL-168_B': 139, 'ARCHIVAL-168_C': 105, 'ARCHIVAL-168_D': 48,
    'CREATURE-266_DOLPHIN-LOWTRACK': 94, 'PHOTOREAL-013_ASCENT': 108, 'PHOTOREAL-013_CHASM07': 271, 'PHOTOREAL-013_SPLASH': 96,
    'CGI-072_BACKHALF-B': 70, 'CGI-072_HEAD': 106, 'PHOTOREAL-013_HADAL': 160, 'CGI-072_BACKHALF-C': 162, 'PHOTOREAL-013_LANDING': 226,
    'PHOTOREAL-013_SUNLIGHT': 212, 'PHOTOREAL-013_TOP': 209, 'PHOTOREAL-013_F23': 633,
}
DEFERRED = {'PHOTOREAL-013_F23'}   # Lucas, 2026-11-21: skipped for now
BKK = datetime.timezone(datetime.timedelta(hours=7))


def now():
    return datetime.datetime.now(BKK)


def key_of(name):
    """ARCHIVAL-071_MAIN_FINAL_V02_... -> ARCHIVAL-071_MAIN (element = shot + the name before FINAL/STILL/ALT)."""
    m = re.match(r'^(.*?)_(FINAL|STILL|ALT)(?=_|\.|$)', name, re.I)
    return (m.group(1) if m else name).upper()


def bucket():
    out = subprocess.run(['aws', 's3', 'ls', ROUND, '--recursive', '--profile', 'panama', '--region', 'us-west-2'], capture_output=True, text=True, timeout=180).stdout
    manifests, frames = {}, {}
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        path = parts[3]
        base = path.rsplit('/', 1)[-1]
        if base.endswith('_MANIFEST.json') and base != 'RETURN-MANIFEST.json':
            manifests[key_of(base)] = parts[0] + ' ' + parts[1][:5]
        elif base.lower().endswith('.dpx'):
            k = key_of(base)
            frames[k] = frames.get(k, 0) + 1
    return manifests, frames


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.7.1'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def writer(prompt):
    for n in prompt.values():
        if n.get('class_type') == 'OCIOWrite':
            i = n['inputs']
            return i.get('filename', ''), int(i.get('start_number') or 0), int(i.get('first_frame') or 0), int(i.get('last_frame') or 0)
    return None


def pod(name, pid):
    """-> dict(name, element, delivered frames, running chunk frames, rate s/frame, eta) or an error text."""
    try:
        base = f'https://{pid}-8188.proxy.runpod.net'
        q = get(base + '/queue', 20)
        h = get(base + '/history?max_items=200', 45)
    except Exception as e:  # noqa: BLE001
        return {'pod': name, 'error': str(e)[:80]}
    done, el = [], None
    for v in h.values():
        w = writer(v['prompt'][2])
        if not w:
            continue
        ms = {m[0]: m[1] for m in v['status']['messages']}
        a = (ms.get('execution_start') or {}).get('timestamp')
        b = (ms.get('execution_success') or ms.get('execution_error') or {}).get('timestamp')
        if a and b and v['status']['status_str'] == 'success':
            done.append((b, w, (b - a) / 1000))
    running = [writer(it[2]) for it in q['queue_running'] if writer(it[2])]
    if running:
        el = key_of(running[0][0])
    elif done:
        el = key_of(sorted(done, key=lambda x: x[0])[-1][1][0])
    mine = [d for d in done if key_of(d[1][0]) == el]
    delivered = sum(w[3] - w[2] + 1 for _, w, _ in mine)
    chunks = [(w[3] - w[2] + 1, s) for _, w, s in mine if (w[3] - w[2] + 1) > 12]
    rate = (sum(s for _, s in chunks) / sum(n for n, _ in chunks)) if chunks else None
    total = PDF.get(el)
    eta = None
    if rate and total:
        rem = max(total - delivered - sum(w[3] - w[2] + 1 for w in running), 0)
        eta = now() + datetime.timedelta(seconds=rem * rate + 600)
    return {'pod': name, 'element': el, 'delivered': delivered, 'total': total, 'running': sum(w[3] - w[2] + 1 for w in running),
            'rate': rate, 'eta': eta}


def block(pods):
    manifests, frames = bucket()
    lines = [f'**Live status, {now().strftime("%Y-%m-%d %H:%M")} Bangkok time** (written by `scripts/delivery-status.py`; read-only).', '']
    want = [k for k in PDF if k not in DEFERRED]
    delivered = [k for k in want if k in manifests]
    lines.append(f'- **In the real round (element manifest present): {len(delivered)} of {len(want)} targeted** (36 in the PDF; f23 deferred by Lucas). `RETURN-MANIFEST.json` should list the same number.')
    pending = [k for k in want if k not in manifests]
    if pending:
        lines.append('- **Not delivered yet:** ' + ', '.join(f'{k} ({frames.get(k, 0)}/{PDF[k]} frames in the bucket)' for k in pending) + '.')
    lines.append('- **Deferred:** PHOTOREAL-013_F23 (633 frames).')
    lines += ['', '| Render pod | Element | Written (of PDF) | Chunk running | s per frame | ETA (render) |', '|---|---|---|---|---|---|']
    for name, pid in pods.items():
        r = pod(name, pid)
        if 'error' in r:
            lines.append(f'| {name} | pod unreachable: {r["error"]} | | | | |')
        else:
            lines.append(f'| {name} | {r["element"]} | {r["delivered"]} of {r["total"]} | {r["running"]} frames | {r["rate"]:.1f} | {r["eta"].strftime("%H:%M") if r["eta"] else "-"} |' if r['rate'] else
                         f'| {name} | {r["element"]} | {r["delivered"]} of {r["total"]} | {r["running"]} frames | - | - |')
    return '\n'.join(lines)


def quick(pods):
    """Fast table (about 10 s): the render pods' queue and history plus the item count of RETURN-MANIFEST.json (no recursive listing)."""
    import json as _json
    n = None
    try:
        out = subprocess.run(['aws', 's3', 'cp', ROUND + 'RETURN-MANIFEST.json', '-', '--profile', 'panama', '--region', 'us-west-2'], capture_output=True, text=True, timeout=60).stdout
        n = len(_json.loads(out).get('items', []))
    except Exception:  # noqa: BLE001
        pass
    lines = [f'**{now().strftime("%H:%M:%S")} Bangkok** · RETURN-MANIFEST items: {n if n is not None else "?"} of 35 targeted', '',
             '| Element | Frames done of total | % | Chunk running | s/frame | Render ETA |', '|---|---|---|---|---|---|']
    for name, pid in pods.items():
        r = pod(name, pid)
        if 'error' in r:
            lines.append(f'| {name} | unreachable | | | | |')
            continue
        pct = f'{100 * r["delivered"] / r["total"]:.1f}%' if r.get('total') else ''
        done = r.get('total') and r['delivered'] >= r['total'] and not r['running']
        lines.append(f'| {r["element"]} | {r["delivered"]} of {r["total"]} | {pct} | {r["running"]} frames | {r["rate"]:.1f} | {"done" if done else (r["eta"].strftime("%H:%M") if r.get("eta") else "-")} |' if r.get('rate') else
                     f'| {r["element"]} | {r["delivered"]} of {r["total"]} | {pct} | {r["running"]} frames | - | - |')
    return '\n'.join(lines)


def main():
    args = sys.argv[1:]
    pods = {'top': 'kqdx2u4xqs8jef', 'landing': 'h563hjyoacn5p0', 'sunlight': 'zlujagddxx5gop'}
    if '--pods' in args:
        pods = dict(a.split('=', 1) for a in args[args.index('--pods') + 1:] if '=' in a)
    if '--quick' in args:
        print(quick(pods)); return
    text = block(pods)
    print(text)
    if '--no-write' in args:
        return
    for p in DOCS:
        s = open(p).read()
        pat = re.compile(r'(<!-- LIVE-STATUS:START -->).*?(<!-- LIVE-STATUS:END -->)', re.S)
        if not pat.search(s):
            print(f'(no markers in {p}: skipped)')
            continue
        open(p, 'w').write(pat.sub(lambda m: m.group(1) + '\n' + text + '\n' + m.group(2), s))


if __name__ == '__main__':
    main()
