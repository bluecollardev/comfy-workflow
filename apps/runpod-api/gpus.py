"""The GPUs a pod may use, with RunPod's ids. One table for the API, the CLI and the form.

The job runs on binc-PC's RTX A4000 (16 GB) today; nothing in the packs asks for more than 24 GB.
So the menu is the 16-24 GB cards, cheapest first, and the 4090 is the default. Bigger cards
(A100, H100, L40S) are left out on purpose: they cost several times the rate for no gain here.
RunPod bills by the hour the pod exists in a running state; the idle stop (idle.py) is what
keeps a forgotten pod from eating the USD 100 cap.
"""

GPUS = {
    "a4000":   {"id": "NVIDIA RTX A4000",         "name": "RTX A4000",  "vram": 16},
    "a5000":   {"id": "NVIDIA RTX A5000",         "name": "RTX A5000",  "vram": 24},
    "rtx3090": {"id": "NVIDIA GeForce RTX 3090",  "name": "RTX 3090",   "vram": 24},
    "rtx4090": {"id": "NVIDIA GeForce RTX 4090",  "name": "RTX 4090",   "vram": 24},
}
DEFAULT = "rtx4090"


def runpod_id(key: str) -> str:
    """RunPod's gpu_type_id for a short key; a full RunPod id passes through unchanged."""
    if key in GPUS:
        return GPUS[key]["id"]
    if any(g["id"] == key for g in GPUS.values()):
        return key
    raise ValueError(f"unknown GPU {key!r}; options: {', '.join(GPUS)}")


def vram(key: str) -> int:
    for k, g in GPUS.items():
        if key in (k, g["id"]):
            return g["vram"]
    return 0


def menu() -> list[dict]:
    return [{"value": k, "text": f"{g['name']} ({g['vram']} GB)"} for k, g in GPUS.items()]
