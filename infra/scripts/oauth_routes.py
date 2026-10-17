"""
OAuth2 routes for FastAPI
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
import secrets
import logging

from oauth_handler import oauth_handler, get_current_user, check_admin, Token, User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/oauth", tags=["oauth"])

# Store for state validation (in production, use Redis or database)
oauth_states = {}


@router.get("/login")
async def login():
    """Initiate OAuth login flow"""
    state = secrets.token_urlsafe(32)
    oauth_states[state] = True

    auth_url = await oauth_handler.get_authorization_url(state)
    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def oauth_callback(code: str, state: str):
    """OAuth callback endpoint"""
    # Verify state
    if state not in oauth_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid state parameter",
        )

    del oauth_states[state]

    # Exchange code for token
    token_data = await oauth_handler.exchange_code_for_token(code)
    if not token_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to exchange code for token",
        )

    # Get user info
    access_token = token_data.get("access_token")
    user_info = await oauth_handler.get_user_info(access_token)
    if not user_info:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to get user info",
        )

    user_id = user_info.get("id")

    # Create our JWT token
    jwt_token = oauth_handler.create_access_token(user_id, ["read", "write"])
    refresh_token = oauth_handler.create_refresh_token(user_id)

    # Redirect to frontend with tokens
    return RedirectResponse(
        url=f"http://localhost:5173/auth/success?access_token={jwt_token}&refresh_token={refresh_token}"
    )


@router.post("/token")
async def get_token(code: str = None, refresh_token: str = None) -> Token:
    """Get or refresh tokens"""
    if code:
        # Exchange auth code for token
        token_data = await oauth_handler.exchange_code_for_token(code)
        if not token_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization code",
            )

        access_token = token_data.get("access_token")
        user_info = await oauth_handler.get_user_info(access_token)
        if not user_info:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to get user info",
            )

        user_id = user_info.get("id")
        jwt_token = oauth_handler.create_access_token(user_id)
        new_refresh_token = oauth_handler.create_refresh_token(user_id)

        return Token(
            access_token=jwt_token,
            refresh_token=new_refresh_token,
            expires_in=30 * 60,
        )

    elif refresh_token:
        # Refresh access token
        token_data = oauth_handler.verify_token(refresh_token)
        if not token_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid refresh token",
            )

        user_id = token_data.sub
        new_access_token = oauth_handler.create_access_token(user_id)

        return Token(
            access_token=new_access_token,
            expires_in=30 * 60,
        )

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either code or refresh_token required",
        )


@router.post("/logout")
async def logout(current_user: User = Depends(get_current_user)):
    """Logout (frontend should clear tokens)"""
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Get current user info"""
    return current_user


@router.get("/admin-test")
async def admin_test(current_user: User = Depends(check_admin)):
    """Test endpoint that requires admin scope"""
    return {"message": "Admin access granted", "user": current_user}
