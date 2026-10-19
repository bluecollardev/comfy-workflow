"""Mounts config: three folders mapped on this PC, what the tree declares, what a pod receives."""
import importlib
import json
import os
import pathlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO = pathlib.Path(__file__).resolve().parents[3]
PLATES = "/mnt/storage/Panama_Redux/source/PC_20260929_VFX_3D_DSM_plates"


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


@pytest.fixture
def tree(tmp_path):
    """A small project tree that declares its paths the way CANALV2 does, under a name of its own."""
    t = tmp_path / "trees" / "HARBOUR"
    (t / "04_TRACKER" / "queue" / "done").mkdir(parents=True)
    (t / "04_TRACKER" / "queue" / "done" / "job1.md").write_text("job: x\nroot: /home/someone/HARBOUR_r1/HARBOUR\n")
    (t / "04_TRACKER" / "queue" / "done" / "job2.md").write_text("job: y\nroot: /home/someone/HARBOUR_r1/HARBOUR/\n")
    (t / "00_POLICY").mkdir(); (t / "00_POLICY" / "structure_v001.md").write_text("Root: `/home/old/HARBOUR/`.")
    s = t / "10_CORROSION" / "corrosion-001" / "02_SOURCE"; s.mkdir(parents=True)
    (s / "SOURCES.csv").write_text("role,eye,part,location,pattern\nplate,LEFT,1,/srv/plates/PC_x/corrosion-001_3D/corrosion-001_3D.LEFT,*.dpx\nplate,RIGHT,1,/srv/plates/PC_x/corrosion-001_3D/corrosion-001_3D.RIGHT,*.dpx\n")
    return t


def test_defaults_are_the_three_folders_unmapped(mounts):
    cfg = mounts.defaults()
    assert list(cfg.folders) == ["project", "plates", "comfy-shared"] and not any(cfg.folders.values())
    assert cfg.network_volume_id == "" and cfg.mount_path == "/workspace"
    assert mounts.all_links(cfg) == [] and mounts.local_env(cfg) == {}
    assert mounts.pod_env(cfg) == {"PROJECT_ROOT": "/workspace/project", "PLATES_ROOT": "/workspace/plates", "COMFY_SHARED": "/workspace/comfy-shared"}
    assert "COMFY_LINKS" not in mounts.pod_overrides(cfg)["env"]


def test_declared_paths_come_from_the_tree(mounts, tree, tmp_path):
    cfg = mounts.defaults(); cfg.folders["project"] = str(tree)
    dec = mounts.declared(cfg)
    assert dec["project"]["path"] == "/home/someone/HARBOUR_r1/HARBOUR" and dec["project"]["count"] == 2   # job files win over the structure page
    assert dec["plates"]["path"] == "/srv/plates/PC_x" and dec["plates"]["count"] == 2
    assert dec["comfy-shared"]["path"] == "/home/someone/ComfyUI-Shared"
    links = {l.path: l.target for l in mounts.all_links(cfg)}
    assert links == {"/home/someone/HARBOUR_r1/HARBOUR": "/workspace/project", "/srv/plates/PC_x": "/workspace/plates", "/home/someone/ComfyUI-Shared": "/workspace/comfy-shared"}
    assert all(l.folder for l in mounts.all_links(cfg))
    # No job file: the structure master's Root line.
    for f in (tree / "04_TRACKER" / "queue" / "done").iterdir(): f.unlink()
    assert mounts.declared(cfg)["project"] == {"path": "/home/old/HARBOUR", "source": "the tree's structure page", "count": 1}
    # A folder that is not a project tree declares nothing, and nothing is linked.
    cfg.folders["project"] = str(tmp_path)
    assert mounts.declared(cfg)["project"] is None and mounts.all_links(cfg) == []


@pytest.mark.skipif(not (REPO / "projects/desktop/CANALV2/04_TRACKER").is_dir(), reason="the CANALV2 mirror is not on this machine")
def test_the_mirror_declares_binc_pcs_paths(mounts):
    cfg = mounts.defaults(); cfg.folders["project"] = str(REPO / "projects/desktop/CANALV2")
    dec = mounts.declared(cfg)
    assert dec["project"]["path"] == "/home/binc/CANALV2_r3/CANALV2"
    assert dec["plates"]["path"] == PLATES
    assert dec["comfy-shared"]["path"] == "/home/binc/ComfyUI-Shared"


def test_local_env_and_pod_overrides(mounts, tree, tmp_path):
    cfg = mounts.defaults()
    cfg.folders.update(project=str(tree), plates=str(tmp_path), **{"comfy-shared": str(tmp_path / "shared")})
    assert mounts.local_env(cfg) == {"PROJECT_ROOT": str(tree), "PLATES_ROOT": str(tmp_path), "COMFY_SHARED": str(tmp_path / "shared")}
    rows = {r["key"]: r for r in mounts.folder_rows(cfg)}
    assert rows["project"]["exists"] and rows["plates"]["exists"] and not rows["comfy-shared"]["exists"]
    ov = mounts.pod_overrides(cfg)
    assert "network_volume_id" not in ov                  # no volume configured yet
    assert "/home/someone/HARBOUR_r1/HARBOUR=/workspace/project" in ov["env"]["COMFY_LINKS"].split(";")
    assert "/srv/plates/PC_x=/workspace/plates" in ov["env"]["COMFY_LINKS"].split(";")
    assert ov["env"]["PROJECT_ROOT"] == "/workspace/project" and ov["env"]["PLATES_ROOT"] == "/workspace/plates"
    cfg.links.append(mounts.Link(path="/home/someone/Desktop/old", target="/workspace/legacy", required=False, mode="ro"))
    cfg.env["EXTRA"] = "1"; cfg.network_volume_id = "vol123"; cfg.data_center_id = "EU-RO-1"
    ov = mounts.pod_overrides(cfg)
    assert ov["env"]["COMFY_LINKS"].endswith(";/home/someone/Desktop/old=/workspace/legacy") and ov["env"]["EXTRA"] == "1"
    assert ov["network_volume_id"] == "vol123" and ov["volume_mount_path"] == "/workspace" and ov["data_center_id"] == "EU-RO-1"


def test_round_trip_reset_and_env(client, mounts, tree):
    r = client.get("/api/mounts"); assert r.status_code == 200
    body = r.json(); assert body["stored"] is False and [f["key"] for f in body["folders"]] == ["project", "plates", "comfy-shared"]
    assert body["folders"][0]["declared"] is None and body["links"] == []
    cfg = body["config"]; cfg["folders"]["project"] = str(tree); cfg["network_volume_id"] = "vol123"
    r = client.put("/api/mounts", json=cfg); assert r.status_code == 200
    body = r.json(); assert body["stored"] is True and body["preview"]["network_volume_id"] == "vol123"
    assert body["folders"][0]["declared"]["path"] == "/home/someone/HARBOUR_r1/HARBOUR" and body["folders"][0]["exists"]
    assert [l["path"] for l in body["links"]] == ["/home/someone/HARBOUR_r1/HARBOUR", "/srv/plates/PC_x", "/home/someone/ComfyUI-Shared"]
    assert json.loads(pathlib.Path(os.environ["MOUNTS_FILE"]).read_text())["folders"]["project"] == str(tree)
    assert client.get("/api/mounts").json()["local_env"] == {"PROJECT_ROOT": str(tree)}
    env = client.get("/api/mounts/env").json(); assert env["sh"] == f'export PROJECT_ROOT={json.dumps(str(tree))}\n'
    r = client.delete("/api/mounts"); assert r.status_code == 200 and r.json()["stored"] is False
    assert not any(r.json()["config"]["folders"].values())


def test_old_store_without_folders_drops_its_derived_links(client, mounts):
    old = {"network_volume_id": "v1", "mount_path": "/workspace", "data_center_id": "", "apply_by_default": True, "env": {"COMFY_SHARED": "/workspace/comfy-shared"},
           "links": [{"path": "/home/binc/CANALV2_r3/CANALV2", "target": "/workspace/CANALV2"}, {"path": "/root/CANALV2", "target": "/workspace/CANALV2"},
                     {"path": "/home/binc/Desktop/old", "target": "/workspace/legacy", "required": False}]}
    pathlib.Path(os.environ["MOUNTS_FILE"]).write_text(json.dumps(old))
    body = client.get("/api/mounts").json()
    assert body["config"]["network_volume_id"] == "v1" and not any(body["config"]["folders"].values())
    assert [l["path"] for l in body["links"]] == ["/home/binc/Desktop/old"]


def test_custom_folders(client, mounts, tree, tmp_path):
    cfg = client.get("/api/mounts").json()["config"]
    cfg["folders"]["project"] = str(tree)
    cfg["custom"] = [{"name": "legacy", "local": str(tmp_path), "link": "/home/someone/Desktop/old", "mode": "ro"},
                     {"name": "scratch", "local": "", "container": "/data/scratch"}]
    r = client.put("/api/mounts", json=cfg); assert r.status_code == 200
    body = r.json(); rows = {f["key"]: f for f in body["folders"]}
    assert [f["key"] for f in body["folders"]] == ["project", "plates", "comfy-shared", "legacy", "scratch"]
    assert rows["project"]["required"] and not rows["legacy"]["required"] and rows["legacy"]["custom"]
    assert rows["legacy"]["container"] == "/workspace/legacy" and rows["legacy"]["exists"] and rows["legacy"]["declared"]["path"] == "/home/someone/Desktop/old"
    assert rows["scratch"]["container"] == "/data/scratch" and rows["scratch"]["declared"] is None and not rows["scratch"]["exists"]
    assert "/home/someone/Desktop/old=/workspace/legacy" in body["preview"]["env"]["COMFY_LINKS"].split(";")
    assert "scratch" not in body["preview"]["env"]["COMFY_LINKS"]
    assert body["local_env"] == {"PROJECT_ROOT": str(tree)}   # custom folders set no variable
    for bad in [{"name": "", "local": ""}, {"name": "project"}, {"name": "a/b"}, {"name": "x", "container": "rel"}, {"name": "x", "local": "rel"}]:
        cfg["custom"] = [bad]
        assert client.put("/api/mounts", json=cfg).status_code == 400, bad


def test_rejects_bad_input(client, mounts):
    cfg = client.get("/api/mounts").json()["config"]
    cfg["folders"]["plates"] = "relative/plates"
    assert client.put("/api/mounts", json=cfg).status_code == 400
    cfg["folders"]["plates"] = ""
    cfg["links"].append({"path": "/a;b", "target": "/workspace/x"})
    assert client.put("/api/mounts", json=cfg).status_code == 400


def test_folder_browser(client, tmp_path):
    (tmp_path / "b").mkdir(); (tmp_path / "a").mkdir(); (tmp_path / ".hidden").mkdir(); (tmp_path / "file.txt").write_text("x")
    r = client.get("/api/fs/dirs", params={"path": str(tmp_path)}); assert r.status_code == 200
    body = r.json()
    assert [d["name"] for d in body["dirs"]] == ["a", "b"] and body["parent"] == str(tmp_path.parent) and body["home"]
    assert [d["name"] for d in client.get("/api/fs/dirs", params={"path": str(tmp_path), "hidden": "true"}).json()["dirs"]] == [".hidden", "a", "b"]
    assert client.get("/api/fs/dirs").json()["path"] == str(pathlib.Path.home().resolve())
    assert client.get("/api/fs/dirs", params={"path": str(tmp_path / "file.txt")}).status_code == 404
