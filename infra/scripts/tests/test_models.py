"""
Simple model validation tests - no async mocking complexity
"""

import pytest
from datetime import datetime
from pool_manager import PodConfig, PoolAgent
from oauth_handler import OAuthHandler, User


def test_pod_config_creation():
    """Test PodConfig model validation"""
    config = PodConfig(
        agent_name="image-gen",
        gpu_type="rtx4090",
        storage_gb=100,
        env_vars={"MODEL": "flux"}
    )
    
    assert config.agent_name == "image-gen"
    assert config.gpu_type == "rtx4090"
    assert config.storage_gb == 100
    assert config.env_vars["MODEL"] == "flux"


def test_pool_agent_creation():
    """Test PoolAgent model validation"""
    agent = PoolAgent(
        agent_id="image-gen-abc",
        pod_id="pod-123",
        agent_name="image-gen",
        gpu_type="rtx4090",
        status="running",
        created_at=datetime.utcnow(),
        comfyui_url="http://pod-123.proxy.runpod.io:8188",
        api_url="http://pod-123.proxy.runpod.io:8000",
        ssh_command="ssh root@pod-123.proxy.runpod.io"
    )
    
    assert agent.agent_id == "image-gen-abc"
    assert agent.status == "running"
    assert "proxy.runpod.io" in agent.comfyui_url


def test_user_model():
    """Test User model validation"""
    user = User(
        id="user-123",
        email="test@example.com",
        name="Test User",
        scopes=["read", "write"]
    )
    
    assert user.id == "user-123"
    assert user.email == "test@example.com"
    assert "read" in user.scopes


def test_jwt_tokens():
    """Test JWT token creation and validation"""
    handler = OAuthHandler()
    
    # Create access token
    token = handler.create_access_token("user-123", ["read", "write"])
    assert token is not None
    
    # Verify it
    decoded = handler.verify_token(token)
    assert decoded is not None
    assert decoded.sub == "user-123"
    assert "read" in decoded.scopes
    
    # Create refresh token
    refresh = handler.create_refresh_token("user-123")
    assert refresh is not None
    
    decoded_refresh = handler.verify_token(refresh)
    assert decoded_refresh.sub == "user-123"


def test_invalid_token():
    """Test invalid token handling"""
    handler = OAuthHandler()
    result = handler.verify_token("not-a-real-token")
    assert result is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
