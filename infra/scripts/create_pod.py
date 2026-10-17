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


class RunPodManager:
    """Manage RunPod pods for ComfyUI."""

    # GPU pricing and specs (approximate)
    GPU_CONFIGS = {
        "rtx4090": {
            "name": "RTX 4090",
            "vram": 24,
            "price": 1.10,
            "bid": 1.10,
        },
        "l40s": {
            "name": "L40S",
            "vram": 48,
            "price": 1.80,
            "bid": 1.80,
        },
        "h100": {
            "name": "H100",
            "vram": 80,
            "price": 4.50,
            "bid": 4.50,
        },
    }

    IMAGE_OPTIONS = {
        "prebuilt": "ashleykza/comfyui:latest",
        "official": "comfy-org/comfyui:latest",
        "custom": None,  # User-supplied
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
        volume_gb: int = 50,
        container_disk_gb: int = 20,
        image: str = "prebuilt",
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
        image_name = self.IMAGE_OPTIONS.get(image, image)

        if not image_name:
            raise ValueError(f"Unknown image: {image}")

        print(f"Creating pod: {name}")
        print(f"  GPU: {gpu_config['name']} ({gpu_config['vram']}GB VRAM)")
        print(f"  Price: ~${gpu_config['price']}/hr")
        print(f"  Volume: {volume_gb}GB")
        print(f"  Container Disk: {container_disk_gb}GB")
        print(f"  Image: {image_name}")

        try:
            pod = runpod.create_pod(
                name=name,
                image_name=image_name,
                gpu_count=1,
                volume_in_gb=volume_gb,
                container_disk_in_gb=container_disk_gb,
                min_bid=gpu_config["bid"],
                **kwargs,
            )

            print(f"\n✓ Pod created successfully!")
            print(f"  Pod ID: {pod['id']}")
            print(f"  Status: {pod['runtime'].get('uptimeInSeconds', 'starting')}")
            print(f"\n  Web UI: http://{pod['id']}.proxy.runpod.io:8188")
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
        choices=["rtx4090", "l40s", "h100"],
        help="GPU type",
    )
    create_parser.add_argument(
        "--volume", type=int, default=50, help="Volume size in GB"
    )
    create_parser.add_argument(
        "--disk", type=int, default=20, help="Container disk size in GB"
    )
    create_parser.add_argument(
        "--image",
        default="prebuilt",
        help="Image (prebuilt, official, or custom image name)",
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
            container_disk_gb=args.disk,
            image=args.image,
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
