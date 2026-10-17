"""Repositories attached to the project, plus read-only git lookups used by the UI.

  GET    /api/repositories              attached repositories
  POST   /api/repositories              attach {url, branch?} — branch defaults to the repo's HEAD
  DELETE /api/repositories/{id}
  GET    /api/repos/search?q=           repositories visible to the connected accounts (autocomplete)
  GET    /api/repos/branches?url=       {default, branches[]} via `git ls-remote` — no clone
  GET    /api/repos/folders?url=&branch= top-level folders via a blob-less, no-checkout clone

Private repositories work when the host has a connected account (git_accounts.py).
Store: ~/.config/runpod-pod-manager/repositories.json (REPOSITORIES_FILE to override).
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from git_accounts import authenticated_url, list_accounts, list_repos

router = APIRouter(prefix="/api", tags=["Repositories"])

STORE = Path(os.getenv("REPOSITORIES_FILE", Path.home() / ".config/runpod-pod-manager/repositories.json"))

GIT_URL_RE = re.compile(r"^(https?://|ssh://|git@)[\w.@:/~+-]+$")
GIT_REF_RE = re.compile(r"^[\w./-]+$")


class AttachRepository(BaseModel):
    url: str = Field(..., description="Repository URL")
    branch: str | None = Field(None, description="Branch; defaults to the repository's HEAD")


# ----- storage -----

def _load() -> list[dict]:
    if not STORE.exists():
        return []
    return json.loads(STORE.read_text() or "[]")


def _save(repositories: list[dict]) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(repositories, indent=2))


# ----- git -----

def _check(url: str, branch: str | None = None) -> None:
    if not GIT_URL_RE.match(url):
        raise HTTPException(status_code=400, detail="Not a git repository URL")
    if branch is not None and not GIT_REF_RE.match(branch):
        raise HTTPException(status_code=400, detail="Not a valid branch name")


def _git(args: list[str], secret: str | None, timeout: int) -> str:
    """Run git non-interactively; errors come back as 400 with any token redacted."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        return subprocess.run(["git", *args], check=True, capture_output=True, text=True,
                              timeout=timeout, env=env).stdout
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="git timed out contacting the repository")
    except subprocess.CalledProcessError as e:
        reason = (e.stderr or "git failed").strip().splitlines()[-1]
        if secret:
            reason = reason.replace(secret, "***")  # git echoes the clone URL in its errors
        raise HTTPException(status_code=400, detail=reason)


def _normalize(url: str) -> str:
    return url.strip().rstrip("/").removesuffix(".git")


def _repo_name(url: str) -> str:
    path = urlparse(url).path if "://" in url else url.split(":", 1)[-1]
    return _normalize(path).strip("/")


def branches_of(url: str) -> dict:
    clone_url, secret = authenticated_url(url)
    out = _git(["ls-remote", "--symref", "--", clone_url, "HEAD", "refs/heads/*"], secret, timeout=30)
    default, branches = None, []
    for line in out.splitlines():
        left, _, ref = line.partition("\t")
        if left.startswith("ref: refs/heads/") and ref == "HEAD":
            default = left[len("ref: refs/heads/"):]
        elif ref.startswith("refs/heads/"):
            branches.append(ref[len("refs/heads/"):])
    branches.sort(key=lambda b: (b != default, b.lower()))
    return {"default": default or (branches[0] if branches else "main"), "branches": branches}


# ----- routes -----

@router.get("/repositories")
def list_repositories():
    return {"repositories": _load()}


@router.post("/repositories", status_code=201)
def attach_repository(body: AttachRepository):
    url = _normalize(body.url)
    _check(url, body.branch)
    branch = body.branch or branches_of(url)["default"]
    repositories = _load()
    for existing in repositories:
        if existing["url"] == url and existing["branch"] == branch:
            return existing
    repo = {
        "id": uuid.uuid4().hex,
        "url": url,
        "branch": branch,
        "name": _repo_name(url),
        "host": urlparse(url).netloc if "://" in url else url.split("@")[-1].split(":")[0],
        "attached_at": time.time(),
    }
    _save(repositories + [repo])
    return repo


@router.delete("/repositories/{repo_id}", status_code=204)
def detach_repository(repo_id: str):
    repositories = _load()
    remaining = [r for r in repositories if r["id"] != repo_id]
    if len(remaining) == len(repositories):
        raise HTTPException(status_code=404, detail="Repository not found")
    _save(remaining)


@router.get("/repos/search")
def search_repos(q: str = ""):
    """Repositories visible to every connected account, merged; for the attach autocomplete."""
    repos, seen = [], set()
    for account in list_accounts()["accounts"]:
        try:
            found = list_repos(account["id"], q)["repos"]
        except HTTPException:
            continue  # one expired account should not break the others
        for repo in found:
            if repo["url"] not in seen:
                seen.add(repo["url"])
                repos.append({**repo, "account": account["username"], "provider": account["provider"]})
    return {"repos": repos[:50]}


@router.get("/repos/branches")
def list_branches(url: str):
    url = _normalize(url)
    _check(url)
    return branches_of(url)


@router.get("/repos/folders")
def list_repo_folders(url: str, branch: str = "main"):
    """Top-level folders of a repository — the node packs you can pick out of a monorepo."""
    url = _normalize(url)
    _check(url, branch)
    clone_url, secret = authenticated_url(url)
    tmp = tempfile.mkdtemp(prefix="repo-folders-")
    try:
        _git(["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", "--branch", branch,
              "--", clone_url, tmp], secret, timeout=60)
        tree = _git(["-C", tmp, "ls-tree", "-d", "--name-only", "HEAD"], secret, timeout=30)
        folders = sorted(f for f in tree.splitlines() if f and not f.startswith("."))
        return {"url": url, "branch": branch, "folders": folders}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
