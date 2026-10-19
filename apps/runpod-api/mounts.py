"""Mount configuration: which binc-PC paths a pod must make resolve, and where on its volume they live.

Stored in ~/.config/runpod-pod-manager/mounts.json (MOUNTS_FILE). Defaults come from
shared/shapes/mount-points.json (MOUNT_POINTS_FILE), the scan of the project tree, so nothing
here is hardcoded in the app. Pod creation turns the config into RunPod's network volume +
mount path and a COMFY_LINKS env var that the image's entrypoint turns into symlinks.
"""
import json
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api", tags=["Mounts"])

STORE = Path(os.getenv("MOUNTS_FILE", Path.home() / ".config/runpod-pod-manager/mounts.json"))
_HERE = Path(__file__).resolve().parent
SHAPE_CANDIDATES = [
    Path(p) for p in [
        os.getenv("MOUNT_POINTS_FILE", ""),
        _HERE.parents[1] / "shared" / "shapes" / "mount-points.json",   # repo checkout
        _HERE / "mount-points.json",                                     # packaged Electron app (extraResources)
    ] if p
]


class Link(BaseModel):
    """A binc-PC path the container must have, and where on the volume it points."""
    path: str = Field(..., description="Path the graphs, scripts or packs name, e.g. /home/binc/CANALV2_r3/CANALV2")
    target: str = Field(..., description="Where it lives on the pod, e.g. /workspace/CANALV2")
    required: bool = Field(default=True, description="A render cannot work without it")
    mode: str = Field(default="rw", description="ro or rw; informational, the entrypoint makes a symlink either way")
    what: str = Field(default="", description="One line for people")


class MountsConfig(BaseModel):
    network_volume_id: str = Field(default="", description="RunPod network volume to attach; empty = per-pod disk only")
    mount_path: str = Field(default="/workspace", description="Where the volume is mounted in the pod")
    data_center_id: str = Field(default="", description="Must match the volume's datacenter; empty = let RunPod choose")
    links: List[Link] = Field(default_factory=list)
    env: dict = Field(default_factory=dict, description="Extra env for the pod, e.g. COMFY_SHARED")
    apply_by_default: bool = Field(default=True, description="New pods get these mounts unless the form says otherwise")


def shape() -> dict:
    for p in SHAPE_CANDIDATES:
        if p.is_file():
            return json.loads(p.read_text())
    return {"mounts": [], "not_mounts": [], "principle": "", "runtimes": {}}


def defaults() -> MountsConfig:
    links, env = [], {}
    for m in shape().get("mounts", []):
        if not m.get("container"):
            continue
        for path in m.get("links", []):
            links.append(Link(path=path, target=m["container"], required=bool(m.get("required")), mode=m.get("mode") or "rw", what=m.get("what", "")))
        env.update(m.get("env") or {})
    return MountsConfig(links=links, env=env)


def load() -> MountsConfig:
    if STORE.is_file():
        try:
            return MountsConfig(**json.loads(STORE.read_text()))
        except Exception as e:  # a hand-edited file should not take the API down
            raise HTTPException(status_code=500, detail=f"{STORE} is not a valid mounts config: {e}")
    return defaults()


def save(cfg: MountsConfig) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(cfg.model_dump(), indent=2) + "\n")


def links_env(cfg: MountsConfig) -> str:
    """COMFY_LINKS: 'path=target;path=target'. Paths may contain spaces; they may not contain ';' or '='."""
    bad = [l.path for l in cfg.links if ";" in l.path or "=" in l.path or ";" in l.target or "=" in l.target]
    if bad:
        raise HTTPException(status_code=400, detail=f"';' and '=' cannot appear in a link: {bad}")
    return ";".join(f"{l.path}={l.target}" for l in cfg.links)


def pod_overrides(cfg: MountsConfig) -> dict:
    """What pod creation adds: RunPod volume fields and the env the image reads."""
    env = dict(cfg.env)
    if cfg.links:
        env["COMFY_LINKS"] = links_env(cfg)
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
        "stored": STORE.is_file(),
        "store": str(STORE),
        "defaults": defaults().model_dump(),
        "catalog": {"mounts": sh.get("mounts", []), "not_mounts": sh.get("not_mounts", []), "principle": sh.get("principle", ""), "runtimes": sh.get("runtimes", {})},
        "preview": pod_overrides(cfg),
    }


@router.get("/mounts")
def get_mounts():
    """The mount configuration, its defaults from the scan, and exactly what a new pod will receive."""
    return _payload(load())


@router.put("/mounts")
def put_mounts(cfg: MountsConfig):
    links_env(cfg)  # validate
    save(cfg)
    return _payload(cfg)


@router.delete("/mounts", status_code=200)
def reset_mounts():
    """Back to the defaults from shared/shapes/mount-points.json."""
    if STORE.is_file():
        STORE.unlink()
    return _payload(defaults())
