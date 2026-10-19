#!/usr/bin/env python3
"""Check real things against the JSON shapes. Read-only.

  shared/shapes/check.py project <root>      top level against project-tree.json
  shared/shapes/check.py shot <shot-folder>  against shot-folder.json
  shared/shapes/check.py job <job.md>        against job-file.json template fields
  shared/shapes/check.py name <string>...    which names.json pattern each matches
Exit 1 when something required is missing.
"""
import json, re, sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
def load(n): return json.loads((HERE / n).read_text())

def check_entries(root, shape):
    root = pathlib.Path(root); bad = 0
    for e in shape["entries"]:
        p = root / e["name"]; want = e["kind"]
        ok = p.is_dir() if want == "dir" else p.is_file()
        if not ok and e.get("required"): print(f"MISSING  {e['name']} ({want})"); bad += 1
        elif not ok: print(f"absent   {e['name']} (optional)")
        else:
            print(f"ok       {e['name']}")
            for f in e.get("files", []):
                if not (p / f).exists(): print(f"  missing {e['name']}/{f}")
    known = {e["name"] for e in shape["entries"]}
    extra = sorted(x.name for x in root.iterdir() if x.name not in known and not x.name.startswith('.'))
    if extra: print("extra    " + ", ".join(extra))
    return bad

def check_job(path, shape):
    text = pathlib.Path(path).read_text(); bad = 0
    name_ok = re.match(shape["name_pattern"], pathlib.Path(path).name)
    print(("ok       " if name_ok else "BAD NAME ") + pathlib.Path(path).name)
    for f in shape["template_fields"]:
        present = re.search(rf"^\s*{re.escape(f['field'])}\s*:", text, re.M)
        if present: print(f"ok       {f['field']}")
        elif f.get("required"): print(f"MISSING  {f['field']}"); bad += 1
        else: print(f"absent   {f['field']} (optional)")
    return bad

def check_names(names, shape):
    for n in names:
        hits = [k for k, v in shape["patterns"].items() if k != "version" and re.match(v["regex"], n)]
        print(f"{n}: {', '.join(hits) if hits else 'matches no pattern'}")
    return 0

if __name__ == "__main__":
    if len(sys.argv) < 3: print(__doc__); sys.exit(2)
    cmd, args = sys.argv[1], sys.argv[2:]
    bad = {"project": lambda: check_entries(args[0], load("project-tree.json")),
           "shot":    lambda: check_entries(args[0], load("shot-folder.json")),
           "job":     lambda: check_job(args[0], load("job-file.json")),
           "name":    lambda: check_names(args, load("names.json"))}.get(cmd, lambda: (print(__doc__), 2)[1])()
    sys.exit(1 if bad else 0)
