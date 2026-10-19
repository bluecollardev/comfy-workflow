"""
OAuth2 authentication handler for RunPod integration
"""

from datetime import datetime, timedelta
from typing import Optional
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt
import logging

from oauth_config import settings, OAUTH_SCOPES

logger = logging.getLogger(__name__)

# OAuth2 scheme
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="token",
    scopes={scope: description for scope, description in [
        ("read", "Read access"),
        ("write", "Write access"),
        ("admin", "Admin access"),
    ]}
)


class Token(BaseModel):
    """OAuth Token response"""
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    expires_in: int


class TokenData(BaseModel):
    """JWT Token data"""
    sub: str  # subject (user ID)
    scopes: list = []
    exp: datetime


class User(BaseModel):
    """User model"""
    id: str
    email: str
    name: str
    scopes: list = ["read"]


class OAuthHandler:
    """Handle OAuth2 authentication"""

    def __init__(self):
        self.client = httpx.AsyncClient()

    async def get_authorization_url(self, state: str) -> str:
        """Get RunPod OAuth authorization URL"""
        params = {
            "client_id": settings.RUNPOD_CLIENT_ID,
            "redirect_uri": settings.REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(OAUTH_SCOPES),
            "state": state,
        }

        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{settings.RUNPOD_OAUTH_URL}/authorize?{query_string}"

    async def exchange_code_for_token(self, code: str) -> Optional[dict]:
        """Exchange authorization code for access token"""
        try:
            response = await self.client.post(
                f"{settings.RUNPOD_TOKEN_URL}/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": settings.REDIRECT_URI,
                    "client_id": settings.RUNPOD_CLIENT_ID,
                    "client_secret": settings.RUNPOD_CLIENT_SECRET,
                },
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error exchanging code for token: {e}")
            return None

    async def get_user_info(self, access_token: str) -> Optional[dict]:
        """Get user info from RunPod"""
        try:
            response = await self.client.get(
                f"{settings.RUNPOD_OAUTH_URL}/user",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error getting user info: {e}")
            return None

    def create_access_token(self, user_id: str, scopes: list = None) -> str:
        """Create JWT access token"""
        if scopes is None:
            scopes = ["read"]

        expire = datetime.utcnow() + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

        to_encode = {
            "sub": user_id,
            "scopes": scopes,
            "exp": expire,
        }

        encoded_jwt = jwt.encode(
            to_encode,
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM
        )

        return encoded_jwt

    def create_refresh_token(self, user_id: str) -> str:
        """Create JWT refresh token"""
        expire = datetime.utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        to_encode = {
            "sub": user_id,
            "type": "refresh",
            "exp": expire,
        }

        encoded_jwt = jwt.encode(
            to_encode,
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM
        )

        return encoded_jwt

    def verify_token(self, token: str) -> Optional[TokenData]:
        """Verify and decode JWT token"""
        try:
            payload = jwt.decode(
                token,
                settings.SECRET_KEY,
                algorithms=[settings.ALGORITHM]
            )
            sub: str = payload.get("sub")
            if sub is None:
                return None

            scopes = payload.get("scopes", [])
            return TokenData(
                sub=sub,
                scopes=scopes,
                exp=payload.get("exp")
            )
        except JWTError:
            return None


# Global OAuth handler
oauth_handler = OAuthHandler()


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    """Get current authenticated user from token"""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    token_data = oauth_handler.verify_token(token)
    if token_data is None:
        raise credentials_exception

    user_id: str = token_data.sub
    if user_id is None:
        raise credentials_exception

    # In a real app, you'd fetch user from database
    user = User(
        id=user_id,
        email=f"{user_id}@runpod.io",
        name=user_id,
        scopes=token_data.scopes,
    )

    return user


async def check_admin(current_user: User = Depends(get_current_user)) -> User:
    """Check if user has admin scope"""
    if "admin" not in current_user.scopes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions",
        )
    return current_user
