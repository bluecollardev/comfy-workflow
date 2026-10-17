"""
Tests for OAuth authentication handler
"""

import pytest
from unittest.mock import AsyncMock
from datetime import datetime, timedelta

from oauth_handler import OAuthHandler, TokenData, User


@pytest.fixture
def oauth_handler():
    return OAuthHandler()


@pytest.fixture
def sample_user_info():
    return {
        "id": "user-123",
        "email": "test@runpod.io",
        "name": "Test User"
    }


@pytest.mark.asyncio
async def test_get_authorization_url(oauth_handler):
    """Test OAuth authorization URL generation"""
    state = "test-state-123"
    url = await oauth_handler.get_authorization_url(state)

    assert "authorize" in url
    assert "client_id" in url
    assert "state=test-state-123" in url
    assert "response_type=code" in url


@pytest.mark.asyncio
async def test_exchange_code_for_token(oauth_handler):
    """Test exchanging auth code for token"""
    mock_response = AsyncMock()
    mock_response.json = AsyncMock(return_value={
        "access_token": "mock-access-token",
        "token_type": "Bearer",
        "expires_in": 3600
    })
    mock_response.raise_for_status = AsyncMock()

    oauth_handler.client.post = AsyncMock(return_value=mock_response)

    token_data = await oauth_handler.exchange_code_for_token("auth-code-123")

    assert token_data["access_token"] == "mock-access-token"
    assert token_data["token_type"] == "Bearer"


@pytest.mark.asyncio
async def test_exchange_code_for_token_error(oauth_handler):
    """Test token exchange with error"""
    mock_response = AsyncMock()
    mock_response.raise_for_status.side_effect = Exception("Unauthorized")

    oauth_handler.client.post = AsyncMock(return_value=mock_response)

    result = await oauth_handler.exchange_code_for_token("invalid-code")

    assert result is None


@pytest.mark.asyncio
async def test_get_user_info(oauth_handler, sample_user_info):
    """Test fetching user info from RunPod"""
    mock_response = AsyncMock()
    mock_response.json = AsyncMock(return_value=sample_user_info)
    mock_response.raise_for_status = AsyncMock()

    oauth_handler.client.get = AsyncMock(return_value=mock_response)

    user_info = await oauth_handler.get_user_info("test-token")

    assert user_info["id"] == "user-123"
    assert user_info["email"] == "test@runpod.io"


@pytest.mark.asyncio
async def test_create_access_token(oauth_handler):
    """Test JWT access token creation"""
    user_id = "user-123"
    scopes = ["read", "write"]

    token = oauth_handler.create_access_token(user_id, scopes)

    assert token is not None
    assert isinstance(token, str)

    # Verify token can be decoded
    decoded = oauth_handler.verify_token(token)
    assert decoded is not None
    assert decoded.sub == user_id
    assert decoded.scopes == scopes


@pytest.mark.asyncio
async def test_create_refresh_token(oauth_handler):
    """Test JWT refresh token creation"""
    user_id = "user-123"

    token = oauth_handler.create_refresh_token(user_id)

    assert token is not None
    decoded = oauth_handler.verify_token(token)
    assert decoded.sub == user_id


@pytest.mark.asyncio
async def test_verify_token_valid(oauth_handler):
    """Test token verification with valid token"""
    user_id = "user-123"
    token = oauth_handler.create_access_token(user_id)

    token_data = oauth_handler.verify_token(token)

    assert token_data is not None
    assert token_data.sub == user_id
    assert "read" in token_data.scopes


@pytest.mark.asyncio
async def test_verify_token_invalid(oauth_handler):
    """Test token verification with invalid token"""
    result = oauth_handler.verify_token("invalid-token")

    assert result is None


@pytest.mark.asyncio
async def test_verify_token_expired(oauth_handler):
    """Test token verification with expired token"""
    from jose import jwt
    from oauth_config import settings

    # Create token with very short expiry
    user_id = "user-123"
    expire = datetime.utcnow() - timedelta(seconds=1)

    to_encode = {
        "sub": user_id,
        "scopes": ["read"],
        "exp": expire
    }

    expired_token = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )

    result = oauth_handler.verify_token(expired_token)

    assert result is None


def test_token_scope_validation(oauth_handler):
    """Test token with specific scopes"""
    admin_token = oauth_handler.create_access_token("user-123", ["admin", "read", "write"])

    decoded = oauth_handler.verify_token(admin_token)
    assert "admin" in decoded.scopes
    assert "read" in decoded.scopes
    assert "write" in decoded.scopes


def test_user_model():
    """Test User Pydantic model"""
    user = User(
        id="user-123",
        email="test@example.com",
        name="Test User",
        scopes=["read", "write"]
    )

    assert user.id == "user-123"
    assert user.email == "test@example.com"
    assert "write" in user.scopes


def test_token_data_model():
    """Test TokenData Pydantic model"""
    exp_time = datetime.utcnow() + timedelta(hours=1)

    token_data = TokenData(
        sub="user-123",
        scopes=["read", "write"],
        exp=exp_time
    )

    assert token_data.sub == "user-123"
    assert len(token_data.scopes) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
