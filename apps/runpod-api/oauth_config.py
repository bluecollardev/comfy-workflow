"""
OAuth2 configuration for RunPod integration
"""

from typing import Optional
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class OAuthSettings(BaseSettings):
    """OAuth2 Settings"""

    # RunPod OAuth
    RUNPOD_CLIENT_ID: str = os.getenv("RUNPOD_CLIENT_ID", "")
    RUNPOD_CLIENT_SECRET: str = os.getenv("RUNPOD_CLIENT_SECRET", "")
    RUNPOD_OAUTH_URL: str = "https://api.runpod.io/oauth"
    RUNPOD_TOKEN_URL: str = "https://api.runpod.io/oauth/token"

    # Application URLs
    APP_URL: str = os.getenv("APP_URL", "http://localhost:5173")
    API_URL: str = os.getenv("API_URL", "http://localhost:8000")
    REDIRECT_URI: str = os.getenv("REDIRECT_URI", "http://localhost:5173/auth/callback")

    # JWT Settings
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # API Settings
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    # Ignore unrelated variables in .env (RUNPOD_API_KEY, TF_API_TOKEN, ...)
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = OAuthSettings()


# OAuth2 Scopes
SCOPES = {
    "read": "Read access to pods",
    "write": "Write access to pod management",
    "admin": "Admin access to all resources",
}

# Available OAuth scopes to request from RunPod
OAUTH_SCOPES = ["profile", "email"]
