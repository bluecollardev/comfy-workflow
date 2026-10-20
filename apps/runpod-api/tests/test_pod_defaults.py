"""Pod defaults: the GPU menu, the image a pod may boot, the per-pod volume beside a network volume, the idle stop."""
import asyncio
import json
import os
import pathlib
from datetime import datetime, timedelta, timezone

import pytest

REPO = pathlib.Path(__file__).resolve().parents[3]


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("MOUNTS_FILE", str(tmp_path / "mounts.json"))
    monkeypatch.setenv("IDLE_FILE", str(tmp_path / "idle.json"))
    monkeypatch.setenv("MOUNT_POINTS_FILE", str(REPO / "shared" / "shapes" / "mount-points.json"))
    monkeypatch.setenv("RUNPOD_API_KEY", "test")
    monkeypatch.setenv("IDLE_WATCH", "0")
    monkeypatch.delenv("COMFY_MODE", raising=False); monkeypatch.delenv("COMFY_REQUIRE", raising=False)
    import importlib, mounts, idle, gpus, pod_manager_api
    importlib.reload(mounts); importlib.reload(idle); importlib.reload(gpus)
    return importlib.reload(pod_manager_api)


def test_gpu_menu_is_the_small_cards():
    import gpus
    assert list(gpus.GPUS) == ["a4000", "a5000", "rtx3090", "rtx4090"] and gpus.DEFAULT == "rtx4090"
    assert gpus.runpod_id("a4000") == "NVIDIA RTX A4000" and gpus.runpod_id("NVIDIA GeForce RTX 4090") == "NVIDIA GeForce RTX 4090"
    assert gpus.vram("a4000") == 16 and all(g["vram"] <= 24 for g in gpus.GPUS.values())
    with pytest.raises(ValueError):
        gpus.runpod_id("h100")


def test_image_must_be_pullable(env):
    import mounts
    from fastapi import HTTPException
    cfg = mounts.defaults()
    assert cfg.image == "comfy-app:contract-v26"
    with pytest.raises(HTTPException) as e:
        env.resolve_image("configured", cfg)
    assert "local image name" in e.value.detail and "Push it" in e.value.detail
    cfg.image = "ghcr.io/example/comfy-app:contract-v26"
    assert env.resolve_image("configured", cfg) == cfg.image
    assert env.resolve_image("prebuilt", cfg) == "ashleykza/comfyui:latest"
    assert env.resolve_image("docker.io/org/thing:1", cfg) == "docker.io/org/thing:1"
    cfg.image = ""
    with pytest.raises(HTTPException):
        env.resolve_image("configured", cfg)


def test_create_pod_sends_cheap_defaults(env, monkeypatch, tmp_path):
    import mounts
    from fastapi.testclient import TestClient
    cfg = mounts.defaults(); cfg.image = "ghcr.io/example/comfy-app:v26"; cfg.network_volume_id = "vol1"; cfg.data_center_id = "EU-RO-1"
    cfg.folders["project"] = str(tmp_path); mounts.save(cfg)
    sent = {}
    monkeypatch.setattr(env.runpod, "create_pod", lambda **kw: sent.update(kw) or {"id": "pod123", "runtime": {}})
    client = TestClient(env.app)
    r = client.post("/api/pods", json={"name": "t"}); assert r.status_code == 200, r.text
    assert sent["image_name"] == "ghcr.io/example/comfy-app:v26" and sent["gpu_type_id"] == "NVIDIA GeForce RTX 4090"
    assert sent["cloud_type"] == "COMMUNITY" and sent["volume_in_gb"] == 0 and sent["network_volume_id"] == "vol1"
    assert sent["env"]["PROJECT_ROOT"] == "/workspace/project" and "COMFY_LINKS" not in sent["env"]   # a bare tmp dir declares nothing
    body = r.json(); assert body["web_ui_url"] == "https://pod123-8188.proxy.runpod.net" and body["idle_stop_minutes"] == 30
    import idle
    assert idle.entry("pod123")["minutes"] == 30
    # a per-pod volume asked for beside the network volume is still 0; without the volume it is kept
    r = client.post("/api/pods", json={"name": "t", "volume_gb": 40, "idle_stop_minutes": 0}); assert r.status_code == 200
    assert sent["volume_in_gb"] == 0 and idle.entry("pod123")["minutes"] == 30   # 0 = not re-registered, entry untouched
    cfg.network_volume_id = ""; mounts.save(cfg)
    r = client.post("/api/pods", json={"name": "t", "volume_gb": 40, "gpu": "a4000", "instance_type": "on-demand"}); assert r.status_code == 200
    assert sent["volume_in_gb"] == 40 and sent["gpu_type_id"] == "NVIDIA RTX A4000" and sent["cloud_type"] == "SECURE"
    assert client.post("/api/pods", json={"name": "t", "gpu": "h100"}).status_code == 400
    assert client.post("/api/pods", json={"name": "t", "image": "comfy-app:local"}).status_code == 400


def test_create_pod_refuses_missing_required_in_prod(env, monkeypatch):
    import mounts
    from fastapi.testclient import TestClient
    monkeypatch.setenv("COMFY_MODE", "prod")
    cfg = mounts.defaults(); cfg.image = "ghcr.io/example/comfy-app:v26"; mounts.save(cfg)
    monkeypatch.setattr(env.runpod, "create_pod", lambda **kw: {"id": "p", "runtime": {}})
    r = TestClient(env.app).post("/api/pods", json={"name": "t"})
    assert r.status_code == 400 and "Not mapped on this PC: project, plates, comfy-shared" in r.json()["detail"]
    assert TestClient(env.app).post("/api/pods", json={"name": "t", "apply_mounts": False}).status_code == 200


def test_idle_decision_and_sweep(env):
    import idle
    now = datetime.now(timezone.utc)
    e = {"minutes": 30, "last_activity": (now - timedelta(minutes=45)).isoformat(), "last_prompt": "a"}
    assert idle.decide(e, {"busy": True, "last_prompt": "a", "reachable": True}, now)[1] is False       # rendering: never stop
    e2, stop = idle.decide(e, {"busy": False, "last_prompt": "b", "reachable": True}, now)              # a new prompt finished: activity
    assert stop is False and e2["last_prompt"] == "b" and e2["last_activity"] == now.isoformat()
    assert idle.decide(e, {"busy": False, "last_prompt": "a", "reachable": True}, now)[1] is True       # quiet 45 > 30 min
    assert idle.decide(e, {"busy": False, "last_prompt": None, "reachable": False}, now)[1] is True     # unreachable still bills
    fresh = {"minutes": 30, "last_activity": (now - timedelta(minutes=10)).isoformat(), "last_prompt": None}
    assert idle.decide(fresh, {"busy": False, "last_prompt": None, "reachable": True}, now)[1] is False
    assert idle.decide(e, {"busy": False, "last_prompt": None, "reachable": False}, now, 120)[1] is False   # a minute old and silent: still pulling its image
    assert idle.decide(e, {"busy": False, "last_prompt": None, "reachable": False}, now, 20 * 60)[1] is True
    idle.register("p1", 30); idle.register("p2", 30); idle.register("p3", 0)
    assert set(idle.load()) == {"p1", "p2"}
    for pid in ("p1", "p2"):
        reg = idle.load(); reg[pid]["last_activity"] = (now - timedelta(hours=2)).isoformat(); idle.save(reg)
    stopped = []

    async def fake_probe(pod_id, client=None):
        return {"busy": pod_id == "p2", "last_prompt": None, "reachable": True}
    idle.probe = fake_probe
    out = asyncio.run(idle.sweep(lambda: {"p1": 3600, "p2": 3600}, stopped.append))
    assert out == ["p1"] and stopped == ["p1"] and set(idle.load()) == {"p2"}        # p2 is rendering, kept


def test_sync_plan_and_command(env, tmp_path):
    import importlib.util, mounts
    spec = importlib.util.spec_from_file_location("sync_volume", REPO / "infra" / "scripts" / "sync_volume.py")
    sv = importlib.util.module_from_spec(spec); spec.loader.exec_module(sv)
    cfg = mounts.defaults(); cfg.folders.update(project=str(tmp_path), plates=str(tmp_path), **{"comfy-shared": str(tmp_path)})
    assert [k for k, _, _ in sv.plan(cfg, set(), plates=False)] == ["project", "comfy-shared", "workflows"]       # plates only when asked; the repo's workflows ride with comfy-shared
    assert [r for k, _, r in sv.plan(cfg, set(), plates=False) if k == "workflows"] == ["/workspace/comfy-shared/workflows/"]
    assert [k for k, _, _ in sv.plan(cfg, set(), plates=True)] == ["project", "plates", "comfy-shared", "workflows"]
    assert [r for _, _, r in sv.plan(cfg, {"project"}, plates=False)] == ["/workspace/project/"]
    cmd = sv.rsync_cmd(str(tmp_path) + "/", "root@1.2.3.4", 2222, "/workspace/project/")
    assert cmd[0] == "rsync" and "--delete" not in cmd and cmd[-1] == "root@1.2.3.4:/workspace/project/" and "-p 2222" in cmd[cmd.index("-e") + 1]
