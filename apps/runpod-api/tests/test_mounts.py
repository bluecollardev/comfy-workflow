"""Mounts config: defaults from the shape, store round trip, what a pod receives."""
import importlib
import json
import os
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture
def mounts(tmp_path, monkeypatch):
    monkeypatch.setenv("MOUNTS_FILE", str(tmp_path / "mounts.json"))
    monkeypatch.setenv("MOUNT_POINTS_FILE", str(REPO / "shared" / "shapes" / "mount-points.json"))
    import mounts as m
    return importlib.reload(m)


@pytest.fixture
def client(mounts):
    app = FastAPI(); app.include_router(mounts.router)
    return TestClient(app)


def test_defaults_come_from_the_shape(mounts):
    cfg = mounts.defaults()
    paths = {l.path for l in cfg.links}
    assert "/home/binc/CANALV2_r3/CANALV2" in paths
    assert "/mnt/storage/Panama_Redux" in paths
    assert "/root/CANALV2_r3/CANALV2" in paths            # ~ is /root in a container
    assert cfg.env.get("COMFY_SHARED") == "/workspace/ComfyUI-Shared"
    assert cfg.network_volume_id == "" and cfg.mount_path == "/workspace"
    assert all(l.required for l in cfg.links if l.target.startswith("/workspace/CANALV2"))


def test_links_env_and_overrides(mounts):
    cfg = mounts.defaults()
    env = mounts.links_env(cfg)
    assert "/home/binc/CANALV2_r3/CANALV2=/workspace/CANALV2" in env.split(";")
    assert "/mnt/storage/Panama_Redux=/workspace/plates/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates" in env.split(";")
    ov = mounts.pod_overrides(cfg)
    assert "network_volume_id" not in ov                  # no volume configured yet
    assert ov["env"]["COMFY_LINKS"] == env and ov["env"]["COMFY_SHARED"]
    cfg.network_volume_id = "vol123"; cfg.data_center_id = "EU-RO-1"
    ov = mounts.pod_overrides(cfg)
    assert ov["network_volume_id"] == "vol123" and ov["volume_mount_path"] == "/workspace" and ov["data_center_id"] == "EU-RO-1"


def test_round_trip_and_reset(client, mounts):
    r = client.get("/api/mounts"); assert r.status_code == 200
    body = r.json(); assert body["stored"] is False and body["catalog"]["mounts"]
    cfg = body["config"]; cfg["network_volume_id"] = "vol123"
    cfg["links"].append({"path": "/home/binc/Desktop/corrosion-051", "target": "/workspace/legacy/corrosion-051", "required": False, "mode": "ro"})
    r = client.put("/api/mounts", json=cfg); assert r.status_code == 200
    assert r.json()["stored"] is True and r.json()["preview"]["network_volume_id"] == "vol123"
    assert json.loads(pathlib.Path(os.environ["MOUNTS_FILE"]).read_text())["network_volume_id"] == "vol123"
    assert client.get("/api/mounts").json()["config"]["network_volume_id"] == "vol123"
    r = client.delete("/api/mounts"); assert r.status_code == 200 and r.json()["stored"] is False
    assert r.json()["config"]["network_volume_id"] == ""


def test_rejects_separators_in_paths(client, mounts):
    cfg = mounts.defaults().model_dump()
    cfg["links"].append({"path": "/a;b", "target": "/workspace/x"})
    assert client.put("/api/mounts", json=cfg).status_code == 400
