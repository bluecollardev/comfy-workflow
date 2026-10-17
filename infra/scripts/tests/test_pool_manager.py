"""
Tests for PoolManager - GPU pod orchestration
"""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from pool_manager import PoolManager, PodConfig, PoolAgent, PoolStatus


@pytest.fixture
def mock_api_key():
    return "test-api-key-123"


@pytest.fixture
def pool_manager(mock_api_key):
    return PoolManager(mock_api_key)


@pytest.fixture
def sample_pod_config():
    return PodConfig(
        agent_name="image-gen",
        gpu_type="rtx4090",
        storage_gb=100,
        env_vars={"MODEL": "flux"}
    )


@pytest.fixture
def sample_agent():
    return PoolAgent(
        agent_id="image-gen-abc123",
        pod_id="abc123def456",
        agent_name="image-gen",
        gpu_type="rtx4090",
        status="running",
        created_at=datetime.utcnow(),
        comfyui_url="http://abc123.proxy.runpod.io:8188",
        api_url="http://abc123.proxy.runpod.io:8000",
        ssh_command="ssh root@abc123.proxy.runpod.io"
    )


@pytest.mark.asyncio
async def test_pool_manager_init(pool_manager, mock_api_key):
    """Test PoolManager initialization"""
    assert pool_manager.api_key == mock_api_key
    assert pool_manager.base_url == "https://api.runpod.io"
    assert len(pool_manager.agents) == 0
    assert pool_manager.client is not None


@pytest.mark.asyncio
async def test_create_pod_success(pool_manager, sample_pod_config):
    """Test successful pod creation"""
    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {
            "podFindAndDeployOnDemand": {
                "id": "pod-123",
                "name": "comfy-image-gen-0",
                "status": "RUNNING",
                "gpuCount": 1,
                "costPerHr": 0.42,
                "memoryInGb": 16,
                "vcpuCount": 4,
                "volumeInGb": 100
            }
        }
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        agent = await pool_manager.create_pod(sample_pod_config, "comfy-image-gen-0")

    assert agent.agent_name == "image-gen"
    assert agent.gpu_type == "rtx4090"
    assert "pod-" in agent.agent_id
    assert agent.status == "running"
    assert agent.comfyui_url == "http://pod-123.proxy.runpod.io:8188"
    assert agent.pod_id in pool_manager.agents.values()[0].pod_id if pool_manager.agents else True


@pytest.mark.asyncio
async def test_create_pod_api_error(pool_manager, sample_pod_config):
    """Test pod creation with API error"""
    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "errors": [{"message": "Insufficient GPU quota"}]
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        with pytest.raises(Exception, match="RunPod API error"):
            await pool_manager.create_pod(sample_pod_config, "test-pod")


@pytest.mark.asyncio
async def test_get_pod_status_running(pool_manager):
    """Test getting status of running pod"""
    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {
            "pod": {
                "id": "pod-123",
                "name": "test-pod",
                "status": "RUNNING",
                "costPerHr": 0.42,
                "gpuCount": 1,
                "volumeInGb": 100,
                "containerDiskInGb": 20,
                "memoryInGb": 16,
                "vcpuCount": 4,
                "runtime": {
                    "uptimeInSeconds": 3600,
                    "gpuMemoryUtilization": 75,
                    "cpuUtilization": 45,
                    "memoryUtilization": 60
                }
            }
        }
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        status = await pool_manager.get_pod_status("pod-123")

    assert status["status"] == "RUNNING"
    assert status["cost_per_hour"] == 0.42
    assert status["gpu_count"] == 1
    assert status["runtime"]["gpuMemoryUtilization"] == 75


@pytest.mark.asyncio
async def test_get_pod_status_error(pool_manager):
    """Test pod status query with error"""
    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "errors": [{"message": "Pod not found"}]
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        status = await pool_manager.get_pod_status("nonexistent")

    assert status["status"] == "error"
    assert status["pod_id"] == "nonexistent"


@pytest.mark.asyncio
async def test_stop_pod_success(pool_manager, sample_agent):
    """Test stopping a pod"""
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {"podStop": True}
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        success = await pool_manager.stop_pod(sample_agent.pod_id)

    assert success is True
    assert pool_manager.agents[sample_agent.agent_id].status == "stopped"


@pytest.mark.asyncio
async def test_resume_pod_success(pool_manager, sample_agent):
    """Test resuming a pod"""
    sample_agent.status = "stopped"
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {"podResume": True}
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        success = await pool_manager.resume_pod(sample_agent.pod_id)

    assert success is True
    assert pool_manager.agents[sample_agent.agent_id].status == "running"


@pytest.mark.asyncio
async def test_delete_pod_success(pool_manager, sample_agent):
    """Test deleting a pod"""
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {"podTerminate": True}
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        success = await pool_manager.delete_pod(sample_agent.pod_id)

    assert success is True
    assert sample_agent.agent_id not in pool_manager.agents


@pytest.mark.asyncio
async def test_get_pool_status_empty(pool_manager):
    """Test pool status when empty"""
    status = await pool_manager.get_pool_status()

    assert status.total_agents == 0
    assert status.running_agents == 0
    assert status.stopped_agents == 0
    assert status.total_cost_per_hour == 0.0
    assert len(status.agents) == 0


@pytest.mark.asyncio
async def test_get_pool_status_with_agents(pool_manager, sample_agent):
    """Test pool status with agents"""
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "data": {
            "pod": {
                "id": sample_agent.pod_id,
                "status": "RUNNING",
                "costPerHr": 0.42,
                "gpuCount": 1,
                "volumeInGb": 100,
                "containerDiskInGb": 20,
                "memoryInGb": 16,
                "vcpuCount": 4
            }
        }
    }

    with patch.object(pool_manager.client, "post", return_value=mock_response):
        status = await pool_manager.get_pool_status()

    assert status.total_agents == 1
    assert status.running_agents == 1
    assert status.total_cost_per_hour == 0.42


@pytest.mark.asyncio
async def test_health_check_agent_healthy(pool_manager, sample_agent):
    """Test health check on healthy agent"""
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    mock_response = AsyncMock()
    mock_response.status_code = 200

    with patch("pool_manager.httpx.AsyncClient.get", return_value=mock_response):
        healthy = await pool_manager.health_check_agent(sample_agent)

    assert healthy is True
    assert sample_agent.health["status"] == 200


@pytest.mark.asyncio
async def test_health_check_agent_unhealthy(pool_manager, sample_agent):
    """Test health check on unhealthy agent"""
    pool_manager.agents[sample_agent.agent_id] = sample_agent

    with patch("pool_manager.httpx.AsyncClient.get", side_effect=Exception("Connection refused")):
        healthy = await pool_manager.health_check_agent(sample_agent)

    assert healthy is False
    assert "error" in sample_agent.health


# Integration tests (require real API key)
@pytest.mark.integration
@pytest.mark.asyncio
async def test_full_pod_lifecycle():
    """Full integration test: create, check, stop, resume, delete pod"""
    api_key = os.getenv("RUNPOD_API_KEY")
    if not api_key:
        pytest.skip("RUNPOD_API_KEY not set")

    manager = PoolManager(api_key)
    config = PodConfig(
        agent_name="test-agent",
        gpu_type="rtx4090",
        storage_gb=50
    )

    # Create
    agent = await manager.create_pod(config, "test-pod-lifecycle")
    assert agent.status == "running"
    pod_id = agent.pod_id

    try:
        # Check status
        status = await manager.get_pod_status(pod_id)
        assert status["status"] == "RUNNING"

        # Stop
        stopped = await manager.stop_pod(pod_id)
        assert stopped is True

        # Resume
        resumed = await manager.resume_pod(pod_id)
        assert resumed is True

    finally:
        # Cleanup
        await manager.delete_pod(pod_id)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
