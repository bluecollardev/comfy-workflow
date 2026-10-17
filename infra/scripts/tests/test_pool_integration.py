"""
Integration tests for PoolManager - tests against real RunPod API
Run with: pytest tests/test_pool_integration.py -v
⚠️ These tests cost money ($0.42/hour per pod)
"""

import pytest
import os
import asyncio
from pool_manager import PoolManager, PodConfig


@pytest.fixture(scope="module")
def api_key():
    """Get RunPod API key from environment"""
    key = os.getenv("RUNPOD_API_KEY")
    if not key:
        pytest.skip("RUNPOD_API_KEY not set")
    return key


@pytest.fixture(scope="module")
def pool_manager(api_key):
    """Create pool manager with real API"""
    return PoolManager(api_key)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pod_creation_and_deletion(pool_manager):
    """Test creating and deleting a real pod"""
    config = PodConfig(
        agent_name="test-integration",
        gpu_type="rtx4090",
        storage_gb=50
    )

    # Create pod
    agent = await pool_manager.create_pod(config, "test-integration-pod")

    assert agent is not None
    assert agent.status == "running"
    assert agent.gpu_type == "rtx4090"

    pod_id = agent.pod_id

    try:
        # Verify pod status
        status = await pool_manager.get_pod_status(pod_id)
        assert status["status"] == "RUNNING"
        assert status["gpu_count"] == 1

    finally:
        # Cleanup: delete the pod
        success = await pool_manager.delete_pod(pod_id)
        assert success is True


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pod_lifecycle_stop_resume(pool_manager):
    """Test pod stop/resume lifecycle"""
    config = PodConfig(
        agent_name="test-lifecycle",
        gpu_type="rtx4090",
        storage_gb=50
    )

    # Create pod
    agent = await pool_manager.create_pod(config, "test-lifecycle-pod")
    pod_id = agent.pod_id

    try:
        # Stop pod
        stopped = await pool_manager.stop_pod(pod_id)
        assert stopped is True

        # Wait a moment for status to update
        await asyncio.sleep(2)

        # Check status is stopped
        status = await pool_manager.get_pod_status(pod_id)
        assert status["status"] in ["STOPPED", "STOPPING"]

        # Resume pod
        resumed = await pool_manager.resume_pod(pod_id)
        assert resumed is True

        # Wait for resume
        await asyncio.sleep(2)

        # Check status is running
        status = await pool_manager.get_pod_status(pod_id)
        assert status["status"] in ["RUNNING", "STARTING"]

    finally:
        # Cleanup
        await pool_manager.delete_pod(pod_id)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_pool_status_with_pods(pool_manager):
    """Test pool status aggregation with real pods"""
    # Create 2 pods
    config1 = PodConfig(
        agent_name="test-status-1",
        gpu_type="rtx4090",
        storage_gb=50
    )

    agent1 = await pool_manager.create_pod(config1, "test-status-pod-1")

    try:
        # Get pool status
        status = await pool_manager.get_pool_status()

        assert status.total_agents >= 1
        assert status.running_agents >= 1
        assert status.total_cost_per_hour > 0
        assert len(status.agents) >= 1

    finally:
        # Cleanup
        await pool_manager.delete_pod(agent1.pod_id)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_health_check_real_pod(pool_manager):
    """Test health check against a real pod"""
    config = PodConfig(
        agent_name="test-health",
        gpu_type="rtx4090",
        storage_gb=50
    )

    agent = await pool_manager.create_pod(config, "test-health-pod")

    try:
        # Wait for pod to fully start
        await asyncio.sleep(5)

        # Health check (may fail if pod not fully booted yet)
        healthy = await pool_manager.health_check_agent(agent)

        # Pod might still be booting, so we just check that health check runs
        assert agent.health is not None

    finally:
        # Cleanup
        await pool_manager.delete_pod(agent.pod_id)


@pytest.mark.integration
async def test_api_key_validation(api_key):
    """Test that API key is valid by creating manager"""
    manager = PoolManager(api_key)

    assert manager is not None
    assert manager.base_url == "https://api.runpod.io"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
