"""Mount configuration: the three folders on this PC that every runtime needs, and how a pod gets them.

The app runs on one PC. On each PC the user maps three folders, anywhere on its disks: the
project tree, the served plates and ComfyUI-Shared. That mapping is the whole configuration
(stored in ~/.config/runpod-pod-manager/mounts.json, MOUNTS_FILE). Everything else is derived:

- On this PC (launch.sh, the Compose file) the folders are used where they are, through
  PROJECT_ROOT, PLATES_ROOT and COMFY_SHARED (GET /api/mounts/env).
- On a pod the network volume carries the three folders at fixed places under the mount path
  (shared/shapes/mount-points.json, MOUNT_POINTS_FILE), the same env points at them, and the
  paths the project's own files declare for its tree, plates and shared folder are linked to
  them by the image's entrypoint (COMFY_LINKS). Those declared paths are read from the project
  tree, never typed here: the job files' root line, the shots' SOURCES.csv, the structure master.
"""
import csv
import json
import os
import re
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["Mounts"])

STORE = Path(os.getenv("MOUNTS_FILE", Path.home() / ".config/runpod-pod-manager/mounts.json"))
DEFAULT_IMAGE = os.getenv("COMFY_IMAGE", "comfy-app:contract-v26")   # our image; must be pushed to a registry before a pod can pull it


def mode() -> str:
    """COMFY_MODE: `dev` (default; a local run, plates optional) or `prod` (every required folder must be mapped)."""
    return "prod" if os.getenv("COMFY_MODE", "dev").strip().lower() == "prod" else "dev"


def require_source() -> str:
    """Who decides which folders are required: `prod` (all, always), `env` (COMFY_REQUIRE is set), or
    `config` (the panel's per-folder toggles, dev only)."""
    if mode() == "prod":
        return "prod"
    return "env" if os.getenv("COMFY_REQUIRE", "").strip() else "config"


def required_keys(cfg: Optional["MountsConfig"] = None) -> set:
    """Which of the three folders must be mapped. In prod all of them. In dev, COMFY_REQUIRE when set
    (`project,plates,comfy-shared`, `all`, `none`), else the toggles saved in the configuration, off by
    default: we have no plates on a dev machine yet (Lucas, 2026-10-19) and a dev run is not blocked."""
    keys = {m["name"] for m in folder_shapes_all()}
    src = require_source()
    if src == "prod":
        return keys
    if src == "env":
        raw = os.getenv("COMFY_REQUIRE", "").strip().lower()
        if raw == "all":
            return keys
        if raw == "none":
            return set()
        return {k.strip() for k in raw.split(",") if k.strip()} & keys
    return {k for k in keys if (cfg.required.get(k) if cfg else False)}


def folder_shapes_all() -> List[dict]:
    return [m for m in shape().get("mounts", []) if m.get("container") and m.get("required")]
_HERE = Path(__file__).resolve().parent
SHAPE_CANDIDATES = [
    Path(p) for p in [
        os.getenv("MOUNT_POINTS_FILE", ""),
        _HERE.parents[1] / "shared" / "shapes" / "mount-points.json",   # repo checkout
        _HERE / "mount-points.json",                                     # packaged Electron app (extraResources)
    ] if p
]


MIRROR = _HERE.parents[1] / "projects" / "desktop"   # Binc's mirror, read-only by rule (.claude/rules/binc-tree.md)


def in_mirror(local: str) -> bool:
    """True when a mapped folder points into the mirror, where a run must not write."""
    try:
        return bool(local) and Path(local).resolve().is_relative_to(MIRROR.resolve())
    except (OSError, ValueError):
        return False


class Link(BaseModel):
    """A path the project's files name, and where it lives on the pod."""
    path: str = Field(..., description="Path the graphs, scripts or job files name")
    target: str = Field(..., description="Where it lives on the pod, e.g. /workspace/project")
    required: bool = Field(default=True, description="A render cannot work without it")
    mode: str = Field(default="rw", description="ro or rw; informational, the entrypoint makes a symlink either way")
    what: str = Field(default="", description="One line for people")
    folder: str = Field(default="", description="The folder this link was derived from; empty = added by hand")


class CustomFolder(BaseModel):
    """A folder of the user's own, beyond the three every run needs."""
    name: str = Field(..., description="Short name, e.g. legacy")
    local: str = Field(default="", description="Where it is on this PC; empty = not mapped")
    container: str = Field(default="", description="Where a pod has it; empty = <mount_path>/<name>")
    link: str = Field(default="", description="A path the code names for it, linked onto the pod path; empty = no link")
    mode: str = Field(default="rw", description="ro or rw; informational")


class MountsConfig(BaseModel):
    folders: Dict[str, str] = Field(default_factory=dict, description="Required folder key -> local folder on this PC; keys from the shape (project, plates, comfy-shared); empty = not mapped")
    custom: List[CustomFolder] = Field(default_factory=list, description="The user's own folders, mapped the same way")
    network_volume_id: str = Field(default="", description="RunPod network volume to attach; empty = per-pod disk only")
    mount_path: str = Field(default="/workspace", description="Where the volume is mounted in the pod")
    data_center_id: str = Field(default="", description="Must match the volume's datacenter; empty = let RunPod choose")
    links: List[Link] = Field(default_factory=list, description="Extra links added by hand or by create_pod.py --link")
    env: dict = Field(default_factory=dict, description="Extra env for the pod")
    apply_by_default: bool = Field(default=True, description="New pods get these mounts unless the form says otherwise")
    required: Dict[str, bool] = Field(default_factory=dict, description="Dev-mode toggles: which of the three folders a run and a pod refuse to go without; prod requires all, COMFY_REQUIRE overrides")
    image: str = Field(default=DEFAULT_IMAGE, description="The image every new pod boots unless the form picks another; ours, pushed to a registry Binc names")
    idle_stop_minutes: int = Field(default=30, description="Stop a pod after this many minutes with nothing queued in its ComfyUI; 0 = never")


def shape() -> dict:
    for p in SHAPE_CANDIDATES:
        if p.is_file():
            return json.loads(p.read_text())
    return {"mounts": [], "principle": "", "runtimes": {}}


def folder_shapes() -> List[dict]:
    """The three folders every runtime needs, in the shape's order: required, with a place on the pod.
    Optional material (the legacy folder) is a hand-added link, not a mapped folder."""
    return [m for m in shape().get("mounts", []) if m.get("container") and m.get("required")]


def defaults() -> MountsConfig:
    return MountsConfig(folders={m["name"]: "" for m in folder_shapes()})


def load() -> MountsConfig:
    cfg = defaults()
    if STORE.is_file():
        try:
            data = json.loads(STORE.read_text())
            if "folders" not in data:   # a file from before the folder mapping: its links were the derived ones, now derived again
                containers = {m["container"] for m in folder_shapes()} | {"/workspace/CANALV2"}   # and the tree's place before it was /workspace/project
                data["links"] = [l for l in data.get("links", []) if l.get("target") not in containers]
            cfg = MountsConfig(**data)
        except Exception as e:  # a hand-edited file should not take the API down
            raise HTTPException(status_code=500, detail=f"{STORE} is not a valid mounts config: {e}")
        for m in folder_shapes():
            cfg.folders.setdefault(m["name"], "")
            cfg.required.setdefault(m["name"], False)
    return cfg


def save(cfg: MountsConfig) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(cfg.model_dump(), indent=2) + "\n")


# ----- What the project tree declares about its own paths -----

def _most_common(values: List[str]) -> Optional[str]:
    return Counter(v for v in values if v).most_common(1)[0][0] if any(values) else None


def declared_root(tree: Path) -> Optional[dict]:
    """The path the tree calls itself: the job files' `root:` line, else the structure master's `Root:`."""
    roots = []
    for f in sorted((tree / "04_TRACKER" / "queue").rglob("*.md")) if (tree / "04_TRACKER" / "queue").is_dir() else []:
        try:
            for line in f.read_text(errors="replace").splitlines():
                m = re.match(r"^root:\s*(\S+)", line)
                if m:
                    roots.append(m.group(1).rstrip("/")); break
        except OSError:
            continue
    if roots:
        return {"path": _most_common(roots), "source": "the tree's job files", "count": len(roots)}
    masters = sorted((tree / "00_POLICY").glob("structure_v*.md")) if (tree / "00_POLICY").is_dir() else []
    for f in reversed(masters):
        m = re.search(r"Root:\s*`([^`]+)`", f.read_text(errors="replace"))
        if m:
            return {"path": m.group(1).rstrip("/"), "source": "the tree's structure page", "count": 1}
    return None


def declared_plates(tree: Path) -> Optional[dict]:
    """The folder the shots' SOURCES.csv link their plates from: two levels above each eye folder."""
    found = []
    for f in tree.glob("*/*/02_SOURCE/SOURCES.csv"):
        try:
            with f.open(newline="", errors="replace") as fh:
                for row in csv.DictReader(fh):
                    loc = (row.get("location") or "").rstrip("/")
                    if row.get("role") == "plate" and loc.startswith("/"):
                        found.append(str(Path(loc).parent.parent))
        except OSError:
            continue
    if not found:
        return None
    return {"path": _most_common(found), "source": "the shots' source lists", "count": len(found)}


def declared_shared(root: Optional[str]) -> Optional[dict]:
    """ComfyUI-Shared is `~/ComfyUI-Shared` on the tree's machine (structure master, systems page)."""
    parts = (root or "").split("/")
    if len(parts) > 3 and parts[1] == "home":
        return {"path": f"/home/{parts[2]}/ComfyUI-Shared", "source": "the tree's structure page", "count": 1}
    return None


def declared(cfg: MountsConfig) -> Dict[str, Optional[dict]]:
    """Per folder key, the path the project's files name for it, read from the mapped project tree."""
    tree = Path(cfg.folders.get("project") or "")
    out: Dict[str, Optional[dict]] = {m["name"]: None for m in folder_shapes()}
    if not cfg.folders.get("project") or not tree.is_dir():
        return out
    root = declared_root(tree)
    out["project"] = root
    out["plates"] = declared_plates(tree)
    out["comfy-shared"] = declared_shared(root["path"] if root else None)
    return out


# ----- What a runtime receives -----

def folder_rows(cfg: MountsConfig) -> List[dict]:
    """One row per folder for the panel: what it is, where it is on this PC, where a pod has it, what the project calls it."""
    dec = declared(cfg)
    rows = []
    for m in folder_shapes():
        local = cfg.folders.get(m["name"], "")
        env_keys = list(m.get("env") or {})   # first is the name shown; the rest are aliases some packs read
        rows.append({
            "key": m["name"], "what": m.get("what", ""), "mode": m.get("mode") or "rw", "required": m["name"] in required_keys(cfg),
            "local": local, "exists": bool(local) and Path(local).is_dir(), "mirror": in_mirror(local),
            "container": m["container"], "env_key": env_keys[0] if env_keys else "", "env_keys": env_keys, "declared": dec.get(m["name"]),
        })
    base = (cfg.mount_path or "/workspace").rstrip("/")
    for c in cfg.custom:
        rows.append({
            "key": c.name, "what": "", "mode": c.mode or "rw", "required": False, "custom": True,
            "local": c.local, "exists": bool(c.local) and Path(c.local).is_dir(), "mirror": in_mirror(c.local),
            "container": c.container or f"{base}/{c.name}", "env_key": "", "env_keys": [],
            "declared": {"path": c.link, "source": "the path typed here", "count": 1} if c.link else None,
        })
    return rows


def all_links(cfg: MountsConfig) -> List[Link]:
    """The links a pod makes: each declared path onto its folder's place on the volume, then the hand-added ones."""
    links = []
    for r in folder_rows(cfg):
        if r["declared"]:
            links.append(Link(path=r["declared"]["path"], target=r["container"], required=r["required"], mode=r["mode"], what=r["what"], folder=r["key"]))
    return links + cfg.links


def local_env(cfg: MountsConfig) -> dict:
    """Env for a runtime on this PC: each folder's variable set to the local folder (launch.sh, compose.yml)."""
    return {k: r["local"] for r in folder_rows(cfg) if r["local"] for k in r["env_keys"]}


def pod_env(cfg: MountsConfig) -> dict:
    """Env for a pod: each folder's variable set to its place on the volume."""
    return {k: r["container"] for r in folder_rows(cfg) for k in r["env_keys"]}


def links_env(links: List[Link]) -> str:
    """COMFY_LINKS: 'path=target;path=target'. Paths may contain spaces; they may not contain ';' or '='."""
    bad = [l.path for l in links if ";" in l.path or "=" in l.path or ";" in l.target or "=" in l.target]
    if bad:
        raise HTTPException(status_code=400, detail=f"';' and '=' cannot appear in a link: {bad}")
    return ";".join(f"{l.path}={l.target}" for l in links)


def pod_overrides(cfg: MountsConfig) -> dict:
    """What pod creation adds: RunPod volume fields and the env the image reads."""
    env = {**pod_env(cfg), **cfg.env}
    links = all_links(cfg)
    if links:
        env["COMFY_LINKS"] = links_env(links)
    out = {"env": env}
    if cfg.network_volume_id:
        out["network_volume_id"] = cfg.network_volume_id
        out["volume_mount_path"] = cfg.mount_path or "/workspace"
    if cfg.data_center_id:
        out["data_center_id"] = cfg.data_center_id
    return out


def _payload(cfg: MountsConfig) -> dict:
    sh = shape()
    return {
        "config": cfg.model_dump(),
        "mode": mode(),
        "require": sorted(required_keys(cfg)),
        "require_source": require_source(),
        "stored": STORE.is_file(),
        "store": str(STORE),
        "folders": folder_rows(cfg),
        "links": [l.model_dump() for l in all_links(cfg)],
        "local_env": local_env(cfg),
        "preview": pod_overrides(cfg),
        "catalog": {"principle": sh.get("principle", ""), "runtimes": sh.get("runtimes", {})},
    }


@router.get("/mounts")
def get_mounts():
    """The folder mapping on this PC, what the project declares, and exactly what a new pod will receive."""
    return _payload(load())


@router.put("/mounts")
def put_mounts(cfg: MountsConfig):
    for key, local in list(cfg.folders.items()) + [(c.name, c.local) for c in cfg.custom]:
        if local and not local.startswith("/"):
            raise HTTPException(status_code=400, detail=f"{key}: a folder is an absolute path on this PC, not {local!r}")
    seen = set(cfg.folders)
    for c in cfg.custom:
        if not c.name.strip() or "/" in c.name or c.name in seen:
            raise HTTPException(status_code=400, detail=f"custom folder: a name is one word, not already used, not {c.name!r}")
        seen.add(c.name)
        if c.container and not c.container.startswith("/"):
            raise HTTPException(status_code=400, detail=f"{c.name}: the pod path is absolute, not {c.container!r}")
    links_env(all_links(cfg))  # validate
    if cfg.idle_stop_minutes < 0:
        raise HTTPException(status_code=400, detail="idle_stop_minutes is 0 (never) or a number of minutes")
    save(cfg)
    return _payload(cfg)


def missing_required(cfg: MountsConfig) -> List[str]:
    """Required folders (COMFY_REQUIRE, by mode) not mapped on this PC, by key."""
    return [r["key"] for r in folder_rows(cfg) if r["required"] and not r["local"]]


@router.delete("/mounts", status_code=200)
def reset_mounts():
    """Back to nothing mapped."""
    if STORE.is_file():
        STORE.unlink()
    return _payload(defaults())


@router.get("/mounts/env")
def mounts_env():
    """Shell lines for a runtime on this PC: `eval "$(curl -s localhost:8000/api/mounts/env | jq -r .sh)"`."""
    env = local_env(load())
    return {"env": env, "sh": "".join(f"export {k}={json.dumps(v)}\n" for k, v in env.items())}


# ----- Folder browser for the panel's picker (this PC's disks) -----

@router.get("/fs/dirs")
def list_dirs(path: str = "", hidden: bool = False):
    """Subfolders of a folder on this PC, for the folder picker. Empty path = the home folder."""
    p = Path(path).expanduser() if path else Path.home()
    try:
        p = p.resolve()
    except OSError:
        raise HTTPException(status_code=400, detail=f"cannot resolve {path!r}")
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"not a folder: {p}")
    dirs = []
    try:
        for child in sorted(p.iterdir(), key=lambda c: c.name.lower()):
            if child.name.startswith(".") and not hidden:
                continue
            try:
                if child.is_dir():
                    dirs.append({"name": child.name, "path": str(child)})
            except OSError:
                continue
    except PermissionError:
        raise HTTPException(status_code=403, detail=f"no permission to read {p}")
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None, "home": str(Path.home()), "dirs": dirs}
