#!/usr/bin/env python3
"""
Create and manage RunPod on-demand pods for ComfyUI.

Usage:
    python3 create_pod.py --create --name ComfyUI-Dev --gpu rtx4090
    python3 create_pod.py --list
    python3 create_pod.py --stop --pod-id <pod-id>
    python3 create_pod.py --resume --pod-id <pod-id>
    python3 create_pod.py --delete --pod-id <pod-id>
"""

import os
import json
import argparse
from typing import Optional, Dict, Any
import runpod
import sys
from pathlib import Path

# The mounts config lives with the pod manager API (apps/runpod-api/mounts.py); the CLI reuses it when present.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "runpod-api"))
try:
    import mounts as _mounts
    import gpus as _gpus
    import idle as _idle
except Exception:  # API not checked out beside this script: mounts are then given on the command line only
    _mounts = _gpus = _idle = None

GPU_FALLBACK = {"rtx4090": {"id": "NVIDIA GeForce RTX 4090", "name": "RTX 4090", "vram": 24}}


class RunPodManager:
    """Manage RunPod pods for ComfyUI."""

    # The GPU menu is apps/runpod-api/gpus.py: 16-24 GB cards, the job needs no more.
    GPU_CONFIGS = _gpus.GPUS if _gpus else GPU_FALLBACK

    IMAGE_OPTIONS = {
        "configured": None,                      # the image in the mounts config (ours, pushed to a registry)
        "prebuilt": "ashleykza/comfyui:latest",  # no packs, ignores COMFY_LINKS
        "official": "comfy-org/comfyui:latest",
        "custom": None,                          # User-supplied
    }

    def __init__(self, api_key: Optional[str] = None):
        """Initialize RunPod manager."""
        api_key = api_key or os.getenv("RUNPOD_API_KEY")
        if not api_key:
            raise ValueError("RUNPOD_API_KEY not set. Set env var or pass --api-key")
        runpod.api_key = api_key
        self.api_key = api_key

    def create_pod(
        self,
        name: str,
        gpu_type: str = "rtx4090",
        volume_gb: int = 0,
        container_disk_gb: int = 20,
        image: str = "configured",
        network_volume: str = "",
        mount_path: str = "",
        extra_links: list = None,
        mounts_apply: bool = True,
        idle_stop_minutes: int = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Create a new on-demand pod.

        Args:
            name: Pod name
            gpu_type: GPU type (rtx4090, l40s, h100)
            volume_gb: Volume size in GB
            container_disk_gb: Container disk size in GB
            image: Image option (prebuilt, official, or custom image name)
            **kwargs: Additional pod configuration

        Returns:
            Pod details
        """
        if gpu_type not in self.GPU_CONFIGS:
            raise ValueError(f"Unknown GPU type: {gpu_type}. Options: {list(self.GPU_CONFIGS.keys())}")

        gpu_config = self.GPU_CONFIGS[gpu_type]
        cfg = _mounts.load() if _mounts is not None else None
        image_name = self.IMAGE_OPTIONS.get(image, image)
        if image == "configured":
            image_name = cfg.image if cfg else ""
        if not image_name:
            raise ValueError(f"No image: {image}. Set one in the dashboard's Configuration or pass --image")
        if "/" not in image_name:
            raise ValueError(f"{image_name} is a local image name; a pod cannot pull it. Push it to the registry Binc names and set that reference in Configuration.")
        if idle_stop_minutes is None:
            idle_stop_minutes = cfg.idle_stop_minutes if cfg else 0

        print(f"Creating pod: {name}")
        print(f"  GPU: {gpu_config['name']} ({gpu_config['vram']}GB VRAM)")
        print(f"  Volume: {volume_gb}GB per pod")
        print(f"  Container Disk: {container_disk_gb}GB")
        print(f"  Image: {image_name}")

        try:
            # Mounts (docs/MOUNT-POINTS.md): the configured network volume and the COMFY_LINKS the image turns into symlinks.
            mount_kwargs = {}
            if _mounts is not None and mounts_apply:
                missing = _mounts.missing_required(cfg)
                if missing:
                    raise ValueError(f"Not mapped on this PC: {', '.join(missing)}. Map them in the dashboard's Configuration; COMFY_MODE=dev makes them optional.")
                if network_volume: cfg.network_volume_id = network_volume
                if mount_path: cfg.mount_path = mount_path
                for pair in extra_links or []:
                    path, _, target = pair.partition("=")
                    cfg.links.append(_mounts.Link(path=path, target=target))
                ov = _mounts.pod_overrides(cfg)
                env = dict(ov["env"]); env.update(kwargs.pop("env", {}) or {})
                mount_kwargs = {"env": env}
                if ov.get("network_volume_id"):
                    mount_kwargs.update(network_volume_id=ov["network_volume_id"], volume_mount_path=ov["volume_mount_path"])
                    if ov.get("data_center_id"): mount_kwargs["data_center_id"] = ov["data_center_id"]
                    volume_gb = 0   # the network volume carries the data; a per-pod volume beside it is billed for nothing
                print(f"  Mounts: {len(_mounts.all_links(cfg))} link(s)" + (f", network volume {ov['network_volume_id']} at {ov['volume_mount_path']}" if ov.get("network_volume_id") else ", no network volume (per-pod disk only)"))
            elif network_volume:
                mount_kwargs = {"network_volume_id": network_volume, "volume_mount_path": mount_path or "/workspace"}
            pod = runpod.create_pod(
                name=name,
                image_name=image_name,
                gpu_type_id=gpu_config["id"],
                cloud_type=kwargs.pop("cloud_type", "COMMUNITY"),
                gpu_count=1,
                volume_in_gb=volume_gb,
                container_disk_in_gb=container_disk_gb,
                ports="8188/http,22/tcp",
                **mount_kwargs,
                **kwargs,
            )
            if _idle is not None and idle_stop_minutes and idle_stop_minutes > 0:
                _idle.register(pod["id"], idle_stop_minutes)
                print(f"  Idle stop: after {idle_stop_minutes} quiet minutes (while the pod manager API runs)")

            print(f"\n✓ Pod created successfully!")
            print(f"  Pod ID: {pod['id']}")
            print(f"  Status: {pod['runtime'].get('uptimeInSeconds', 'starting')}")
            print(f"\n  Web UI: https://{pod['id']}-8188.proxy.runpod.net")
            print(f"  SSH: ssh root@{pod['id']}.proxy.runpod.io")

            return pod

        except Exception as e:
            print(f"✗ Error creating pod: {e}")
            raise

    def list_pods(self) -> list:
        """List all pods."""
        try:
            pods = runpod.get_pods()
            if not pods:
                print("No pods found.")
                return []

            print(f"Found {len(pods)} pod(s):\n")
            for pod in pods:
                status = pod["runtime"].get("uptimeInSeconds", "starting")
                print(f"  ID: {pod['id']}")
                print(f"  Name: {pod['name']}")
                print(f"  Status: {status}s")
                print(f"  GPU: {pod['runtime'].get('gpuCount', 'unknown')}")
                print()

            return pods

        except Exception as e:
            print(f"Error listing pods: {e}")
            return []

    def get_pod_status(self, pod_id: str) -> Dict[str, Any]:
        """Get pod status."""
        try:
            pod = runpod.get_pod(pod_id)
            print(f"\nPod: {pod['name']} ({pod['id']})")
            print(f"  Status: {pod['runtime']}")
            return pod
        except Exception as e:
            print(f"Error getting pod status: {e}")
            raise

    def stop_pod(self, pod_id: str) -> bool:
        """Stop a pod."""
        try:
            runpod.stop_pod(pod_id)
            print(f"✓ Pod {pod_id} stopped")
            return True
        except Exception as e:
            print(f"✗ Error stopping pod: {e}")
            return False

    def resume_pod(self, pod_id: str) -> bool:
        """Resume a stopped pod."""
        try:
            runpod.resume_pod(pod_id)
            print(f"✓ Pod {pod_id} resumed")
            return True
        except Exception as e:
            print(f"✗ Error resuming pod: {e}")
            return False

    def terminate_pod(self, pod_id: str, force: bool = False) -> bool:
        """Terminate (delete) a pod."""
        if not force:
            confirm = input(f"⚠️  Delete pod {pod_id}? (yes/no): ")
            if confirm.lower() != "yes":
                print("Cancelled")
                return False

        try:
            runpod.terminate_pod(pod_id)
            print(f"✓ Pod {pod_id} terminated")
            return True
        except Exception as e:
            print(f"✗ Error terminating pod: {e}")
            return False


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Manage RunPod on-demand pods for ComfyUI"
    )
    parser.add_argument("--api-key", default=None, help="RunPod API key")

    subparsers = parser.add_subparsers(dest="command", help="Command")

    # Create command
    create_parser = subparsers.add_parser("create", help="Create a new pod")
    create_parser.add_argument("--name", required=True, help="Pod name")
    create_parser.add_argument(
        "--gpu",
        default="rtx4090",
        choices=list(RunPodManager.GPU_CONFIGS),
        help="GPU (16-24 GB cards; the job needs no more)",
    )
    create_parser.add_argument(
        "--volume", type=int, default=0, help="Per-pod volume in GB; 0 when the network volume carries the data (default)"
    )
    create_parser.add_argument("--secure", action="store_true", help="Secure cloud instead of the cheaper community cloud")
    create_parser.add_argument("--idle-stop", type=int, default=None, metavar="MINUTES", help="Stop after this many quiet minutes (default: the configuration's value; 0 = never)")
    create_parser.add_argument("--network-volume", default="", help="RunPod network volume id to attach (persistent; the mounts config's value if omitted)")
    create_parser.add_argument("--mount-path", default="", help="Where the network volume is mounted in the pod (default /workspace)")
    create_parser.add_argument("--link", action="append", default=[], metavar="PATH=TARGET", help="Extra path to make resolve on the pod, PATH=TARGET on the volume (repeatable); the three folders come from the dashboard's configuration")
    create_parser.add_argument("--no-mounts", action="store_true", help="Do not apply the mounts config (GET /api/mounts, ~/.config/runpod-pod-manager/mounts.json)")
    create_parser.add_argument(
        "--disk", type=int, default=20, help="Container disk size in GB"
    )
    create_parser.add_argument(
        "--image",
        default="configured",
        help="configured (the image in the dashboard's Configuration, ours), prebuilt (ashleykza, no packs), official, or an image reference",
    )

    # List command
    subparsers.add_parser("list", help="List all pods")

    # Status command
    status_parser = subparsers.add_parser("status", help="Get pod status")
    status_parser.add_argument("--pod-id", required=True, help="Pod ID")

    # Stop command
    stop_parser = subparsers.add_parser("stop", help="Stop a pod")
    stop_parser.add_argument("--pod-id", required=True, help="Pod ID")

    # Resume command
    resume_parser = subparsers.add_parser("resume", help="Resume a pod")
    resume_parser.add_argument("--pod-id", required=True, help="Pod ID")

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a pod")
    delete_parser.add_argument("--pod-id", required=True, help="Pod ID")
    delete_parser.add_argument("--force", action="store_true", help="Skip confirmation")

    args = parser.parse_args()

    manager = RunPodManager(args.api_key)

    if args.command == "create":
        manager.create_pod(
            name=args.name,
            gpu_type=args.gpu,
            volume_gb=args.volume,
            network_volume=args.network_volume,
            mount_path=args.mount_path,
            extra_links=args.link,
            mounts_apply=not args.no_mounts,
            container_disk_gb=args.disk,
            image=args.image,
            idle_stop_minutes=args.idle_stop,
            cloud_type="SECURE" if args.secure else "COMMUNITY",
        )

    elif args.command == "list":
        manager.list_pods()

    elif args.command == "status":
        manager.get_pod_status(args.pod_id)

    elif args.command == "stop":
        manager.stop_pod(args.pod_id)

    elif args.command == "resume":
        manager.resume_pod(args.pod_id)

    elif args.command == "delete":
        manager.terminate_pod(args.pod_id, force=args.force)

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
