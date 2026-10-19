#!/usr/bin/env python3
"""Copy the three mapped folders to a pod's network volume. Never deletes anything there.

    sync_volume.py --pod <id> [--dry-run] [--plates --approved-by <name>] [--only project,comfy-shared]

The pod must have the network volume attached (the dashboard's Configuration, applied at
creation) and SSH on port 22/tcp exposed, which the pod manager and create_pod.py do. The
script reads the mapping (apps/runpod-api/mounts.py), finds the pod's public SSH address from
RunPod, and runs one rsync per folder into /workspace/{project,plates,comfy-shared}, i.e. the
places the pod's env and links expect. Plates are client material: copying them off the PC
needs Binc's named yes (shared/governance/policy/agent-permissions.md), so they are skipped
unless --plates and --approved-by are both given. rsync is additive: --delete is never passed.
"""
import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "runpod-api"))
import mounts  # noqa: E402

EXCLUDE = [".DS_Store", "._*", ".git", "__pycache__", "*.pyc", "logs/", ".venv/"]


def ssh_target(pod_id: str) -> tuple[str, int]:
    """root@<public ip>, port for the pod's 22/tcp mapping, from RunPod."""
    import runpod
    runpod.api_key = os.environ["RUNPOD_API_KEY"]
    pod = runpod.get_pod(pod_id)
    for port in ((pod or {}).get("runtime") or {}).get("ports") or []:
        if port.get("privatePort") == 22 and port.get("isIpPublic"):
            return f"root@{port['ip']}", int(port["publicPort"])
    raise SystemExit(f"pod {pod_id}: no public 22/tcp port; is it running with SSH exposed?")


def plan(cfg: mounts.MountsConfig, only: set, plates: bool) -> list[tuple[str, str, str]]:
    """(key, local, remote) per folder to copy; plates only when asked."""
    out = []
    for r in mounts.folder_rows(cfg):
        if r.get("custom") or (only and r["key"] not in only):
            continue
        if r["key"] == "plates" and not plates:
            continue
        if not r["local"]:
            print(f"skip {r['key']}: not mapped on this PC", file=sys.stderr)
            continue
        out.append((r["key"], r["local"].rstrip("/") + "/", r["container"].rstrip("/") + "/"))
    return out


def rsync_cmd(local: str, host: str, port: int, remote: str) -> list[str]:
    cmd = ["rsync", "-a", "--info=progress2", "--partial", "-e", f"ssh -p {port} -o StrictHostKeyChecking=accept-new"]
    for e in EXCLUDE:
        cmd += ["--exclude", e]
    return cmd + [local, f"{host}:{remote}"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pod", required=True, help="pod id with the network volume attached")
    ap.add_argument("--only", default="", help="comma list of folder keys: project, plates, comfy-shared")
    ap.add_argument("--plates", action="store_true", help="include the plates (client material)")
    ap.add_argument("--approved-by", default="", help="who said yes to copying plates off this PC; required with --plates")
    ap.add_argument("--dry-run", action="store_true", help="print the rsync commands and run them with -n")
    a = ap.parse_args()
    if a.plates and not a.approved_by.strip():
        ap.error("--plates needs --approved-by <name>: plates leaving this PC need Binc's named yes (policy/agent-permissions.md)")
    cfg = mounts.load()
    only = {k.strip() for k in a.only.split(",") if k.strip()}
    todo = plan(cfg, only, a.plates)
    if not todo:
        print("nothing to copy", file=sys.stderr); return 1
    host, port = ssh_target(a.pod)
    rc = 0
    for key, local, remote in todo:
        cmd = rsync_cmd(local, host, port, remote)
        if a.dry_run:
            cmd.insert(1, "-n")
        print(f"{key}: {local} -> {host}:{remote}")
        print("  " + " ".join(shlex.quote(c) for c in cmd))
        r = subprocess.run(cmd)
        rc = rc or r.returncode
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
