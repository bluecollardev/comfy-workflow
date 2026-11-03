#!/usr/bin/env python3
"""Check a pulled delivery round against its MANIFEST.json files: every listed file present, same byte count, same sha256.

The pod-side twin of the app's check (apps/runpod-dashboard/libs/core/src/panama.ts `verify`) and of BH's verify_round.py. Reads both manifest shapes:
the root MANIFEST.json's `files`, and each shot's MANIFEST.json for the shots the root lists under `shots`. Paths are relative to the round root.
Files on disk that no manifest lists are counted, never touched. Standard library only.

    verify_round.py <round dir>        exit 0 and the last line `OK` only when every listed file matches; 1 on a mismatch; 2 when there is no file list
"""
import hashlib, json, os, sys


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def listed(root):
    """{normalised relative path: entry} from the root manifest and the per-shot ones, or None when there is no root manifest."""
    mp = os.path.join(root, "MANIFEST.json")
    if not os.path.isfile(mp):
        return None
    try:
        m = json.load(open(mp))
    except ValueError:
        return None
    files = {}
    for f in m.get("files") or []:
        files[os.path.normpath(f["path"])] = f
    for shot in (m.get("shots") or {}):
        sm = os.path.join(root, shot, "MANIFEST.json")
        if os.path.isfile(sm):
            try:
                for f in json.load(open(sm)).get("files") or []:
                    files.setdefault(os.path.normpath(f["path"]), f)
            except ValueError:
                pass
    return files


def main(root):
    files = listed(root)
    if not files:
        print("NO FILE LIST: no usable MANIFEST.json in", root)
        return 2
    bad = []
    for f in files.values():
        p = os.path.join(root, f["path"])
        if not os.path.isfile(p):
            bad.append("MISSING  " + f["path"])
        elif os.path.getsize(p) != f["bytes"]:
            bad.append("SIZE     " + f["path"])
        elif sha256(p) != f["sha256"]:
            bad.append("SHA256   " + f["path"])
    extra = 0
    for d, _, fs in os.walk(root):
        for n in fs:
            rel = os.path.normpath(os.path.relpath(os.path.join(d, n), root))
            if rel not in files and n != "MANIFEST.json" and not n.startswith(".s3-pull"):
                extra += 1
    for line in bad[:50]:
        print(line)
    print("%d listed, %d bad, %d on disk but not listed" % (len(files), len(bad), extra))
    print("OK" if not bad else "FAIL")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]) if len(sys.argv) == 2 else 64)
