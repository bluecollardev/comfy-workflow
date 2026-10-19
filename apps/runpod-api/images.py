"""Container image lookups for the UI.

  GET /api/images/env?source=image&image=<ref|prebuilt>
      ENV from the image's config (fetched from the registry — no docker, no pull), minus
      base-image/toolchain variables, plus the build ARGs of the image's source repository
      (located through the org.opencontainers.image.source label or KNOWN_SOURCES), with
      the values docker-bake.hcl gives them for its default target.
  GET /api/images/env?source=dockerfile
      ENV and ARG instructions from DOCKERFILE_PATH (default <repo>/apps/comfy-app/Dockerfile).

Response: {source, image, env: [{key, value}], build_args: [{key, value}], skipped, build_source}

Registry access is anonymous (Docker Hub, GHCR, any v2 registry with a Bearer challenge);
private images answer 401/404 and are reported as such.
"""

import os
import re
import shlex
from functools import lru_cache
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api", tags=["Images"])

PREBUILT_IMAGE = "ashleykza/comfyui:latest"
DOCKERFILE_PATH = Path(os.getenv("DOCKERFILE_PATH", Path(__file__).resolve().parents[2] / "apps" / "comfy-app" / "Dockerfile"))

# Images whose config carries no org.opencontainers.image.source label.
KNOWN_SOURCES = {
    "ashleykza/comfyui": "https://github.com/ashleykleynhans/comfyui-docker",
    "ashleykza/runpod-worker-comfyui": "https://github.com/ashleykleynhans/runpod-worker-comfyui",
}

# Base-image and toolchain variables nobody sets on a pod.
SYSTEM_ENV = re.compile(
    r"^(PATH|HOME|SHELL|LANG|LC_ALL|DEBIAN_FRONTEND|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE"
    r"|GPG_KEY|PYTHON_VERSION|PYTHON_SHA256|NVARCH|NV_.*|NVIDIA_.*|CUDA_VERSION|NCCL_VERSION"
    r"|LD_LIBRARY_PATH|LIBRARY_PATH)$"
)

MANIFEST_TYPES = ", ".join([
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
])


# ----- registry -----

def parse_reference(image: str) -> tuple[str, str, str]:
    """'ashleykza/comfyui:latest' → ('registry-1.docker.io', 'ashleykza/comfyui', 'latest')."""
    image = image.strip()
    if not image:
        raise HTTPException(status_code=400, detail="No image given")
    name, _, digest = image.partition("@")
    first, _, rest = name.partition("/")
    if rest and ("." in first or ":" in first or first == "localhost"):
        registry, path = first, rest
    else:
        registry, path = "docker.io", name
    if ":" in path.rsplit("/", 1)[-1]:
        path, tag = path.rsplit(":", 1)
    else:
        tag = "latest"
    if registry == "docker.io":
        registry = "registry-1.docker.io"
        if "/" not in path:
            path = f"library/{path}"
    return registry, path, digest or tag


def _registry_get(url: str, accept: str, token: str | None) -> requests.Response:
    headers = {"Accept": accept}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return requests.get(url, headers=headers, timeout=20)


def _anonymous_token(challenge: str) -> str | None:
    """Follow a `WWW-Authenticate: Bearer realm=...,service=...,scope=...` challenge."""
    params = dict(re.findall(r'(\w+)="([^"]*)"', challenge))
    realm = params.pop("realm", None)
    if not realm:
        return None
    r = requests.get(realm, params=params, timeout=20)
    return (r.json().get("token") or r.json().get("access_token")) if r.ok else None


def image_config(image: str) -> dict:
    """The image's OCI config blob (`config.Env`, `config.Labels`, …) for linux/amd64."""
    registry, repo, ref = parse_reference(image)
    base = f"https://{registry}/v2/{repo}"
    token = None

    def get(path: str, accept: str = MANIFEST_TYPES) -> dict:
        nonlocal token
        r = _registry_get(f"{base}/{path}", accept, token)
        if r.status_code == 401 and token is None:
            token = _anonymous_token(r.headers.get("WWW-Authenticate", ""))
            r = _registry_get(f"{base}/{path}", accept, token)
        if r.status_code in (401, 403, 404):
            raise HTTPException(status_code=404, detail=f"{image}: not found on {registry}, or not public")
        if not r.ok:
            raise HTTPException(status_code=502, detail=f"{registry} answered {r.status_code}")
        return r.json()

    manifest = get(f"manifests/{ref}")
    if "manifests" in manifest:  # multi-arch index: RunPod runs linux/amd64
        candidates = manifest["manifests"]
        chosen = next((m for m in candidates
                       if m.get("platform", {}).get("os") == "linux" and m["platform"].get("architecture") == "amd64"),
                      candidates[0])
        manifest = get(f"manifests/{chosen['digest']}")
    config_digest = manifest.get("config", {}).get("digest")
    if not config_digest:
        raise HTTPException(status_code=502, detail=f"{image}: manifest has no config")
    return get(f"blobs/{config_digest}", accept="application/octet-stream, application/json").get("config", {})


# ----- Dockerfile / bake parsing -----

def parse_dockerfile(text: str) -> tuple[list[dict], list[dict]]:
    """(env, args) from ENV / ARG instructions; later definitions win, ARG defaults may be empty."""
    text = re.sub(r"\\\s*\n", " ", text)  # join line continuations
    env: dict[str, str] = {}
    args: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        instr, _, body = line.partition(" ")
        body = body.strip()
        if instr.upper() == "ENV":
            if "=" in body.split(None, 1)[0]:
                for token in shlex.split(body):  # ENV A=1 B="two words"
                    k, _, v = token.partition("=")
                    env[k] = v
            else:  # ENV KEY the rest of the line
                k, _, v = body.partition(" ")
                env[k] = v.strip().strip('"')
        elif instr.upper() == "ARG":
            for token in shlex.split(body):
                k, _, v = token.partition("=")
                args.setdefault(k, v)
    return ([{"key": k, "value": v} for k, v in env.items()],
            [{"key": k, "value": v} for k, v in args.items()])


def parse_bake_args(text: str) -> dict[str, str]:
    """ARG values for docker-bake.hcl's default target, with ${VARIABLE}s resolved."""
    variables = dict(re.findall(r'variable\s+"(\w+)"\s*\{[^}]*?default\s*=\s*"([^"]*)"', text, re.S))
    group = re.search(r'group\s+"default"\s*\{[^}]*?targets\s*=\s*\[\s*"([^"]+)"', text, re.S)
    target_name = group.group(1) if group else None
    pattern = rf'target\s+"{re.escape(target_name)}"' if target_name else r'target\s+"[^"]+"'
    target = re.search(pattern + r'\s*\{.*?args\s*=\s*\{', text, re.S)
    if not target:
        return {}
    # Balanced scan: values like "${RELEASE}" contain braces, so a lazy regex would cut the block short.
    start, depth = target.end(), 1
    i = start
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    args = dict(re.findall(r'(\w+)\s*=\s*"([^"]*)"', text[start:i - 1]))

    def resolve(value: str) -> str:
        for _ in range(3):
            value = re.sub(r"\$\{(\w+)\}", lambda m: variables.get(m.group(1), m.group(0)), value)
        return value

    return {k: resolve(v) for k, v in args.items()}


@lru_cache(maxsize=32)
def source_build_args(repo_url: str) -> list[dict]:
    """ARGs of a GitHub repo's Dockerfile with docker-bake.hcl values for the default target."""
    m = re.match(r"https://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$", repo_url)
    if not m:
        return []
    raw = f"https://raw.githubusercontent.com/{m.group(1)}"
    for branch in ("main", "master"):
        r = requests.get(f"{raw}/{branch}/Dockerfile", timeout=20)
        if not r.ok:
            continue
        _, args = parse_dockerfile(r.text)
        bake = requests.get(f"{raw}/{branch}/docker-bake.hcl", timeout=20)
        values = parse_bake_args(bake.text) if bake.ok else {}
        return [{"key": a["key"], "value": values.get(a["key"], a["value"])} for a in args]
    return []


def newest_hub_tag(repo: str) -> str | None:
    """Most recently pushed tag of a Docker Hub repository (for images that publish no `latest`)."""
    r = requests.get(f"https://hub.docker.com/v2/repositories/{repo}/tags",
                     params={"page_size": 1, "ordering": "last_updated"}, timeout=20)
    results = r.json().get("results") if r.ok else None
    return results[0]["name"] if results else None


def source_repo_for(image: str, labels: dict) -> str | None:
    if labels.get("org.opencontainers.image.source"):
        return labels["org.opencontainers.image.source"]
    _, repo, _ = parse_reference(image)
    return KNOWN_SOURCES.get(repo)


# ----- route -----

@router.get("/images/env")
def image_env(source: str = "image", image: str = "prebuilt"):
    if source == "dockerfile":
        if not DOCKERFILE_PATH.is_file():
            raise HTTPException(status_code=404, detail=f"No Dockerfile at {DOCKERFILE_PATH}")
        env, args = parse_dockerfile(DOCKERFILE_PATH.read_text())
        return {"source": source, "image": str(DOCKERFILE_PATH), "env": env, "build_args": args,
                "skipped": 0, "build_source": str(DOCKERFILE_PATH)}
    if source != "image":
        raise HTTPException(status_code=400, detail="source must be 'image' or 'dockerfile'")

    ref = PREBUILT_IMAGE if image == "prebuilt" else image
    try:
        try:
            config = image_config(ref)
        except HTTPException as e:
            registry, repo, tag = parse_reference(ref)
            newest = newest_hub_tag(repo) if (e.status_code == 404 and registry == "registry-1.docker.io" and tag == "latest") else None
            if not newest:
                raise
            ref = f"{repo.removeprefix('library/')}:{newest}"
            config = image_config(ref)
        all_env = [e.partition("=") for e in (config.get("Env") or [])]
        env = [{"key": k, "value": v} for k, _, v in all_env if not SYSTEM_ENV.match(k)]
        repo_url = source_repo_for(ref, config.get("Labels") or {})
        build_args = source_build_args(repo_url) if repo_url else []
    except requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach the registry: {e}")
    return {"source": source, "image": ref, "env": env, "build_args": build_args,
            "skipped": len(all_env) - len(env), "build_source": repo_url}
