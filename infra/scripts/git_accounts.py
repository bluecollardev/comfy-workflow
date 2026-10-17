"""Git provider accounts (GitHub / GitLab) connected with OAuth.

Routes (mounted by pod_manager_api.py):
  GET    /api/git-accounts                 connected accounts (no secrets) + provider availability
  DELETE /api/git-accounts/{id}            disconnect
  GET    /api/git-accounts/{id}/repos?q=   repositories the account can see
  GET    /api/auth/{provider}/start        browser entry point → provider's authorize page
  GET    /api/auth/{provider}/callback     exchanges the code, stores the account, redirects to the UI

Setup — register an OAuth app per provider with callback URL
  <API_BASE_URL>/api/auth/<provider>/callback       (default http://localhost:8000/api/auth/github/callback)
and put its credentials in the API server's environment / .env:
  GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET            scope: repo read:user
  GITLAB_CLIENT_ID, GITLAB_CLIENT_SECRET            scope: read_user read_api read_repository
  GITLAB_URL        self-hosted GitLab, default https://gitlab.com
  API_BASE_URL      default http://localhost:8000
  FRONTEND_URL      where the browser is sent back, default http://localhost:5173
  GIT_ACCOUNTS_FILE token store, default ~/.config/runpod-pod-manager/git_accounts.json (chmod 600)

Tokens are used server-side to read private repos and handed to a pod (GIT_CREDENTIALS)
only for the hosts its custom-node entries clone from.
"""

import json
import os
import secrets
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode, urlparse

import requests
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

load_dotenv()

router = APIRouter(prefix="/api", tags=["Git accounts"])

STORE = Path(os.getenv("GIT_ACCOUNTS_FILE", Path.home() / ".config/runpod-pod-manager/git_accounts.json"))
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
GITLAB_URL = os.getenv("GITLAB_URL", "https://gitlab.com").rstrip("/")

PROVIDERS = {
    "github": {
        "label": "GitHub",
        "base": "https://github.com",
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "api": "https://api.github.com",
        "scope": "repo read:user",
        "clone_user": "x-access-token",
    },
    "gitlab": {
        "label": "GitLab",
        "base": GITLAB_URL,
        "authorize": f"{GITLAB_URL}/oauth/authorize",
        "token": f"{GITLAB_URL}/oauth/token",
        "api": f"{GITLAB_URL}/api/v4",
        "scope": "read_user read_api read_repository",
        "clone_user": "oauth2",
    },
}

# state → (provider, expires_at); OAuth CSRF protection for in-flight logins
_pending_states: dict[str, tuple[str, float]] = {}


# ----- storage -----

def _load() -> list[dict]:
    if not STORE.exists():
        return []
    return json.loads(STORE.read_text() or "[]")


def _save(accounts: list[dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(accounts, indent=2))
    STORE.chmod(0o600)


def _public(account: dict) -> dict:
    return {k: v for k, v in account.items() if k not in ("token", "refresh_token")}


def _get(account_id: str) -> dict:
    for account in _load():
        if account["id"] == account_id:
            return account
    raise HTTPException(status_code=404, detail="Account not found")


# ----- provider helpers -----

def _provider(provider: str) -> dict:
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'")
    return cfg


def _client(provider: str) -> tuple[str | None, str | None]:
    return os.getenv(f"{provider.upper()}_CLIENT_ID"), os.getenv(f"{provider.upper()}_CLIENT_SECRET")


def _redirect_uri(provider: str) -> str:
    return f"{API_BASE_URL}/api/auth/{provider}/callback"


def _back_to_ui(provider: str, **query) -> RedirectResponse:
    return RedirectResponse(f"{FRONTEND_URL}/?{urlencode({'provider': provider, **query})}")


def _fetch_user(provider: str, token: str) -> dict:
    cfg = PROVIDERS[provider]
    headers = {"Authorization": f"Bearer {token}"}
    if provider == "github":
        headers["Accept"] = "application/vnd.github+json"
    r = requests.get(f"{cfg['api']}/user", headers=headers, timeout=20)
    r.raise_for_status()
    u = r.json()
    if provider == "github":
        return {"username": u["login"], "name": u.get("name"), "avatar_url": u.get("avatar_url"),
                "profile_url": u.get("html_url")}
    return {"username": u["username"], "name": u.get("name"), "avatar_url": u.get("avatar_url"),
            "profile_url": u.get("web_url")}


def _access_token(account: dict) -> str:
    """Current token; refreshes GitLab's short-lived one when it is about to expire."""
    expires_at = account.get("expires_at")
    if expires_at and expires_at < time.time() + 60 and account.get("refresh_token"):
        cfg = PROVIDERS[account["provider"]]
        client_id, client_secret = _client(account["provider"])
        r = requests.post(cfg["token"], data={
            "client_id": client_id, "client_secret": client_secret,
            "grant_type": "refresh_token", "refresh_token": account["refresh_token"],
            "redirect_uri": _redirect_uri(account["provider"]),
        }, timeout=20)
        if not r.ok:
            raise HTTPException(status_code=401, detail=f"{cfg['label']} session expired — reconnect the account")
        tok = r.json()
        account.update(
            token=tok["access_token"],
            refresh_token=tok.get("refresh_token", account["refresh_token"]),
            expires_at=time.time() + tok.get("expires_in", 7200),
        )
        _save([account if a["id"] == account["id"] else a for a in _load()])
    return account["token"]


def _account_for_host(host: str) -> dict | None:
    return next((a for a in _load() if a["host"] == host), None)


# ----- used by pod_manager_api -----

def authenticated_url(url: str) -> tuple[str, str | None]:
    """(clone_url, secret): the URL with the matching account's token embedded, or unchanged."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https"):
        return url, None
    account = _account_for_host(parts.netloc)
    if not account:
        return url, None
    token = _access_token(account)
    user = PROVIDERS[account["provider"]]["clone_user"]
    return parts._replace(netloc=f"{user}:{token}@{parts.netloc}").geturl(), token


def credentials_for(urls: list[str]) -> dict[str, dict]:
    """{host: {username, token}} for every host in `urls` that has a connected account."""
    creds = {}
    for url in urls:
        host = urlparse(url).netloc
        if host in creds:
            continue
        account = _account_for_host(host)
        if account:
            creds[host] = {"username": PROVIDERS[account["provider"]]["clone_user"],
                           "token": _access_token(account)}
    return creds


# ----- routes -----

@router.get("/git-accounts")
def list_accounts():
    providers = []
    for pid, cfg in PROVIDERS.items():
        client_id, client_secret = _client(pid)
        providers.append({"id": pid, "label": cfg["label"], "host": urlparse(cfg["base"]).netloc,
                          "configured": bool(client_id and client_secret)})
    return {"accounts": [_public(a) for a in _load()], "providers": providers}


@router.delete("/git-accounts/{account_id}", status_code=204)
def disconnect_account(account_id: str):
    accounts = _load()
    remaining = [a for a in accounts if a["id"] != account_id]
    if len(remaining) == len(accounts):
        raise HTTPException(status_code=404, detail="Account not found")
    _save(remaining)


@router.get("/git-accounts/{account_id}/repos")
def list_repos(account_id: str, q: str = ""):
    """Repositories the account can see, newest activity first; `q` filters by name."""
    account = _get(account_id)
    token = _access_token(account)
    cfg = PROVIDERS[account["provider"]]
    headers = {"Authorization": f"Bearer {token}"}
    repos = []

    if account["provider"] == "github":
        headers["Accept"] = "application/vnd.github+json"
        for page in range(1, 4):  # up to 300 most recently pushed repos
            r = requests.get(f"{cfg['api']}/user/repos", headers=headers, timeout=20, params={
                "per_page": 100, "page": page, "sort": "pushed",
                "affiliation": "owner,collaborator,organization_member",
            })
            r.raise_for_status()
            batch = r.json()
            repos += [{"name": x["full_name"], "url": x["html_url"], "default_branch": x.get("default_branch") or "main",
                       "private": x.get("private", False), "description": x.get("description")} for x in batch]
            if len(batch) < 100:
                break
        if q:
            needle = q.lower()
            repos = [x for x in repos if needle in x["name"].lower()]
    else:
        r = requests.get(f"{cfg['api']}/projects", headers=headers, timeout=20, params={
            "membership": "true", "simple": "true", "per_page": 100,
            "order_by": "last_activity_at", "search": q or None,
        })
        r.raise_for_status()
        repos = [{"name": x["path_with_namespace"], "url": x["web_url"], "default_branch": x.get("default_branch") or "main",
                  "private": x.get("visibility") != "public", "description": x.get("description")} for x in r.json()]

    return {"repos": repos[:200]}


@router.get("/auth/{provider}/start")
def oauth_start(provider: str):
    cfg = _provider(provider)
    client_id, client_secret = _client(provider)
    if not (client_id and client_secret):
        raise HTTPException(status_code=400, detail=(
            f"{cfg['label']} is not configured: set {provider.upper()}_CLIENT_ID and "
            f"{provider.upper()}_CLIENT_SECRET on the API server"))
    state = secrets.token_urlsafe(24)
    _pending_states[state] = (provider, time.time() + 600)
    params = {"client_id": client_id, "redirect_uri": _redirect_uri(provider), "scope": cfg["scope"], "state": state}
    if provider == "gitlab":
        params["response_type"] = "code"
    return RedirectResponse(f"{cfg['authorize']}?{urlencode(params)}")


@router.get("/auth/{provider}/callback")
def oauth_callback(provider: str, code: str | None = None, state: str | None = None,
                   error: str | None = None, error_description: str | None = None):
    cfg = _provider(provider)
    pending = _pending_states.pop(state or "", None)
    if error:
        return _back_to_ui(provider, error=error_description or error)
    if not pending or pending[0] != provider or pending[1] < time.time():
        return _back_to_ui(provider, error="Login expired or was tampered with — try again")

    client_id, client_secret = _client(provider)
    data = {"client_id": client_id, "client_secret": client_secret, "code": code,
            "redirect_uri": _redirect_uri(provider)}
    if provider == "gitlab":
        data["grant_type"] = "authorization_code"
    r = requests.post(cfg["token"], data=data, headers={"Accept": "application/json"}, timeout=20)
    tok = r.json() if r.ok else {}
    if "access_token" not in tok:
        reason = tok.get("error_description") or tok.get("error") or f"token exchange failed ({r.status_code})"
        return _back_to_ui(provider, error=reason)

    try:
        user = _fetch_user(provider, tok["access_token"])
    except requests.RequestException as e:
        return _back_to_ui(provider, error=f"could not read your {cfg['label']} profile: {e}")

    account = {
        "id": uuid.uuid4().hex,
        "provider": provider,
        "host": urlparse(cfg["base"]).netloc,
        **user,
        "scope": tok.get("scope") or cfg["scope"],
        "token": tok["access_token"],
        "refresh_token": tok.get("refresh_token"),
        "expires_at": time.time() + tok["expires_in"] if tok.get("expires_in") else None,
        "connected_at": time.time(),
    }
    # Reconnecting the same user replaces the old entry
    others = [a for a in _load() if not (a["provider"] == provider and a["username"] == account["username"])]
    _save(others + [account])
    return _back_to_ui(provider, connected=account["username"])
