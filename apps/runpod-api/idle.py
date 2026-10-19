"""Idle stop: a pod that has had nothing queued in its ComfyUI for N minutes is stopped.

RunPod bills a running pod by the hour whether or not it renders, and the one bill nobody
plans for is the pod someone forgot. Each pod created with idle_stop_minutes > 0 is registered
here (~/.config/runpod-pod-manager/idle.json, IDLE_FILE); a background loop in the API probes
each registered running pod's ComfyUI through RunPod's proxy once a minute: /queue (anything
running or pending) and /history (a new prompt finished). Either counts as activity. After N
quiet minutes the pod is stopped through RunPod and the entry is dropped. A pod the probe cannot
reach is treated as quiet: a pod that is up but unreachable still costs money.
"""
import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, Optional

import httpx

logger = logging.getLogger(__name__)
STORE = Path(os.getenv("IDLE_FILE", Path.home() / ".config/runpod-pod-manager/idle.json"))
PROBE_EVERY_S = 60
STARTUP_GRACE_S = 15 * 60   # a pod pulling its image answers nothing; it is not idle until it has been up this long


def proxy_url(pod_id: str, port: int = 8188) -> str:
    """RunPod's HTTP proxy for a pod port."""
    return f"https://{pod_id}-{port}.proxy.runpod.net"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def load() -> Dict[str, dict]:
    if not STORE.is_file():
        return {}
    try:
        return json.loads(STORE.read_text())
    except Exception:
        logger.warning("idle registry unreadable, starting empty: %s", STORE)
        return {}


def save(reg: Dict[str, dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(reg, indent=2) + "\n")


def register(pod_id: str, minutes: int) -> None:
    """Watch a pod; minutes <= 0 removes it from the watch."""
    reg = load()
    if minutes <= 0:
        reg.pop(pod_id, None)
    else:
        reg[pod_id] = {"minutes": int(minutes), "last_activity": _now().isoformat(), "last_prompt": None}
    save(reg)


def forget(pod_id: str) -> None:
    reg = load()
    if pod_id in reg:
        del reg[pod_id]; save(reg)


def entry(pod_id: str) -> Optional[dict]:
    return load().get(pod_id)


async def probe(pod_id: str, client: Optional[httpx.AsyncClient] = None) -> dict:
    """What ComfyUI on the pod is doing: {'busy': bool, 'last_prompt': id or None, 'reachable': bool}."""
    own = client is None
    client = client or httpx.AsyncClient(timeout=8)
    base = proxy_url(pod_id)
    try:
        q = (await client.get(f"{base}/queue")).json()
        busy = bool(q.get("queue_running")) or bool(q.get("queue_pending"))
        h = (await client.get(f"{base}/history", params={"max_items": 1})).json()
        last = next(iter(h), None) if isinstance(h, dict) else None
        return {"busy": busy, "last_prompt": last, "reachable": True}
    except Exception as e:
        logger.info("idle probe of %s failed: %s", pod_id, e)
        return {"busy": False, "last_prompt": None, "reachable": False}
    finally:
        if own:
            await client.aclose()


def decide(e: dict, probe_result: dict, now: datetime, uptime_s: Optional[int] = None) -> tuple[dict, bool]:
    """Update one registry entry from a probe; returns (entry, stop_now). A pod younger than the start-up
    grace that answers nothing is still pulling its image, not idle."""
    e = dict(e)
    active = probe_result["busy"] or (probe_result["last_prompt"] and probe_result["last_prompt"] != e.get("last_prompt"))
    if probe_result["last_prompt"]:
        e["last_prompt"] = probe_result["last_prompt"]
    if active or (uptime_s is not None and uptime_s < STARTUP_GRACE_S and not probe_result["reachable"]):
        e["last_activity"] = now.isoformat()
        return e, False
    quiet_s = (now - datetime.fromisoformat(e["last_activity"])).total_seconds()
    return e, quiet_s >= e["minutes"] * 60


async def sweep(running: Callable[[], set], stop: Callable[[str], None], client: Optional[httpx.AsyncClient] = None) -> list:
    """One pass over the registry. `running` lists the pod ids RunPod says are running; `stop` stops one."""
    reg = load()
    if not reg:
        return []
    live = running()
    stopped, now = [], _now()
    for pod_id in list(reg):
        if pod_id not in live:
            continue   # stopped or gone: nothing to do, keep the entry in case it is resumed
        uptime = live.get(pod_id) if isinstance(live, dict) else None
        e, stop_now = decide(reg[pod_id], await probe(pod_id, client), now, uptime)
        reg[pod_id] = e
        if stop_now:
            logger.warning("idle stop: %s had nothing queued for %s minutes", pod_id, e["minutes"])
            try:
                stop(pod_id); stopped.append(pod_id); del reg[pod_id]
            except Exception as ex:
                logger.error("idle stop of %s failed: %s", pod_id, ex)
    save(reg)
    return stopped


async def loop(running: Callable[[], set], stop: Callable[[str], None]) -> None:
    """The background task the API starts: sweep every minute, forever, never raising."""
    async with httpx.AsyncClient(timeout=8) as client:
        while True:
            try:
                await sweep(running, stop, client)
            except Exception as ex:
                logger.error("idle sweep failed: %s", ex)
            await asyncio.sleep(PROBE_EVERY_S)
