"""
POD POOL MANAGER - Orchestrate ComfyUI agents on RunPod
Manages agent pod lifecycle, health checks, and job routing
"""

import os
import json
import httpx
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class PodConfig(BaseModel):
    """Pod configuration"""
    agent_name: str
    gpu_type: str
    storage_gb: int
    env_vars: Dict[str, str] = {}


class PoolAgent(BaseModel):
    """Agent in the pool"""
    agent_id: str
    pod_id: str
    agent_name: str
    gpu_type: str
    status: str  # running, stopped, error
    created_at: datetime
    comfyui_url: str
    api_url: str
    ssh_command: str
    health: Optional[Dict[str, Any]] = None


class PoolStatus(BaseModel):
    """Status of the entire agent pool"""
    total_agents: int
    running_agents: int
    stopped_agents: int
    agents: List[PoolAgent]
    total_cost_per_hour: float
    created_at: datetime


class PoolManager:
    """Manage ComfyUI agent pool on RunPod"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.runpod.io"
        self.client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {api_key}"}
        )
        self.agents: Dict[str, PoolAgent] = {}

    async def create_pod(
        self,
        pod_config: PodConfig,
        pod_name: str,
        template_id: str = "runpod-io-comfy-ui"  # Comfy UI ready image
    ) -> PoolAgent:
        """
        Create a new pod for an agent
        """
        try:
            response = await self.client.post(
                f"{self.base_url}/graphql",
                json={
                    "query": """
                    mutation {{
                        podFindAndDeployOnDemand(
                            input: {{
                                gpuCount: 1
                                volumeInGb: {volume}
                                containerDiskInGb: 20
                                minVcpuCount: 4
                                minMemoryInGb: 16
                                gpuTypeId: "{gpu}"
                                name: "{name}"
                                imageName: "{template}"
                                startSsh: true
                                containerRegistry: "docker"
                            }}
                        ) {{
                            id
                            name
                            status
                            gpuCount
                            costPerHr
                            memoryInGb
                            vcpuCount
                            volumeInGb
                        }}
                    }}
                    """.format(
                        volume=pod_config.storage_gb,
                        gpu=pod_config.gpu_type,
                        name=pod_name,
                        template=template_id
                    )
                }
            )

            result = response.json()
            if "errors" in result:
                logger.error(f"Pod creation error: {result['errors']}")
                raise Exception(f"RunPod API error: {result['errors']}")

            pod_data = result["data"]["podFindAndDeployOnDemand"]
            pod_id = pod_data["id"]

            # Create agent record
            agent = PoolAgent(
                agent_id=f"{pod_config.agent_name}-{pod_id[:8]}",
                pod_id=pod_id,
                agent_name=pod_config.agent_name,
                gpu_type=pod_config.gpu_type,
                status="running",
                created_at=datetime.utcnow(),
                comfyui_url=f"http://{pod_id}.proxy.runpod.io:8188",
                api_url=f"http://{pod_id}.proxy.runpod.io:8000",
                ssh_command=f"ssh root@{pod_id}.proxy.runpod.io"
            )

            self.agents[agent.agent_id] = agent
            logger.info(f"Pod created: {agent.agent_id} (pod {pod_id})")

            return agent

        except Exception as e:
            logger.error(f"Failed to create pod: {e}")
            raise

    async def get_pod_status(self, pod_id: str) -> Dict[str, Any]:
        """
        Get current status of a pod
        """
        try:
            response = await self.client.post(
                f"{self.base_url}/graphql",
                json={
                    "query": """
                    query {{
                        pod(input: {{podId: "{pod_id}"}}) {{
                            id
                            name
                            status
                            costPerHr
                            gpuCount
                            volumeInGb
                            containerDiskInGb
                            memoryInGb
                            vcpuCount
                            runtime {{
                                uptimeInSeconds
                                gpuMemoryUtilization
                                cpuUtilization
                                memoryUtilization
                                networkIn
                                networkOut
                            }}
                        }}
                    }}
                    """.format(pod_id=pod_id)
                }
            )

            result = response.json()
            if "errors" in result:
                logger.error(f"Status query error: {result['errors']}")
                return {"status": "error", "pod_id": pod_id}

            pod_data = result["data"]["pod"]
            return {
                "pod_id": pod_id,
                "status": pod_data["status"],
                "cost_per_hour": pod_data["costPerHr"],
                "gpu_count": pod_data["gpuCount"],
                "storage_gb": pod_data["volumeInGb"],
                "memory_gb": pod_data["memoryInGb"],
                "runtime": pod_data.get("runtime"),
            }

        except Exception as e:
            logger.error(f"Failed to get pod status: {e}")
            return {"status": "error", "pod_id": pod_id, "error": str(e)}

    async def stop_pod(self, pod_id: str) -> bool:
        """Stop a running pod"""
        try:
            response = await self.client.post(
                f"{self.base_url}/graphql",
                json={
                    "query": f"""
                    mutation {{
                        podStop(input: {{podId: "{pod_id}"}})
                    }}
                    """
                }
            )

            result = response.json()
            if "errors" in result:
                logger.error(f"Stop error: {result['errors']}")
                return False

            logger.info(f"Pod stopped: {pod_id}")
            # Update local agent status
            for agent in self.agents.values():
                if agent.pod_id == pod_id:
                    agent.status = "stopped"

            return True

        except Exception as e:
            logger.error(f"Failed to stop pod: {e}")
            return False

    async def resume_pod(self, pod_id: str) -> bool:
        """Resume a stopped pod"""
        try:
            response = await self.client.post(
                f"{self.base_url}/graphql",
                json={
                    "query": f"""
                    mutation {{
                        podResume(input: {{podId: "{pod_id}"}})
                    }}
                    """
                }
            )

            result = response.json()
            if "errors" in result:
                logger.error(f"Resume error: {result['errors']}")
                return False

            logger.info(f"Pod resumed: {pod_id}")
            # Update local agent status
            for agent in self.agents.values():
                if agent.pod_id == pod_id:
                    agent.status = "running"

            return True

        except Exception as e:
            logger.error(f"Failed to resume pod: {e}")
            return False

    async def delete_pod(self, pod_id: str) -> bool:
        """Delete a pod permanently"""
        try:
            response = await self.client.post(
                f"{self.base_url}/graphql",
                json={
                    "query": f"""
                    mutation {{
                        podTerminate(input: {{podId: "{pod_id}"}})
                    }}
                    """
                }
            )

            result = response.json()
            if "errors" in result:
                logger.error(f"Delete error: {result['errors']}")
                return False

            logger.info(f"Pod deleted: {pod_id}")
            # Remove from local cache
            self.agents = {
                aid: agent for aid, agent in self.agents.items()
                if agent.pod_id != pod_id
            }

            return True

        except Exception as e:
            logger.error(f"Failed to delete pod: {e}")
            return False

    async def get_pool_status(self) -> PoolStatus:
        """Get status of entire agent pool"""
        running = 0
        stopped = 0
        total_cost = 0.0

        for agent in self.agents.values():
            status = await self.get_pod_status(agent.pod_id)
            if status.get("status") == "RUNNING":
                running += 1
                agent.status = "running"
                total_cost += status.get("cost_per_hour", 0)
            else:
                stopped += 1
                agent.status = "stopped"

        return PoolStatus(
            total_agents=len(self.agents),
            running_agents=running,
            stopped_agents=stopped,
            agents=list(self.agents.values()),
            total_cost_per_hour=total_cost,
            created_at=datetime.utcnow()
        )

    async def health_check_agent(self, agent: PoolAgent) -> bool:
        """Check if agent is healthy"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{agent.api_url}/health")
                agent.health = {"status": response.status_code, "timestamp": datetime.utcnow()}
                return response.status_code == 200
        except Exception as e:
            agent.health = {"error": str(e), "timestamp": datetime.utcnow()}
            return False

    async def close(self):
        """Clean up HTTP client"""
        await self.client.aclose()
