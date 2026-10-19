"""Governance for connecting agents: shared/governance, applied on every launch.

The MCP server hands this to every client at initialize (the server's `instructions`), serves
each page as a resource (governance://...) and through the `governance` tool, and refuses the
tools that spend without the named yes Binc's agent-permissions page requires. The API serves
the same at GET /api/governance. Nothing here is hardcoded: the pages are read from the
folder at start, so a re-sync of Binc's policies is applied on the next launch.

Folder: GOVERNANCE_DIR, else shared/governance in the repo checkout, else governance/ beside
this file (the packaged Electron app).
"""
import os
import re
from pathlib import Path
from typing import Dict, List, Optional

_HERE = Path(__file__).resolve().parent
CANDIDATES = [Path(p) for p in [os.getenv("GOVERNANCE_DIR", ""), _HERE.parents[1] / "shared" / "governance", _HERE / "governance"] if p]

SCHEME = "governance://"
# The pages every client gets in full at initialize, in this order. The rest are resources.
LEAD_PAGES = ["policy/agent-permissions.md", "operator-brief.md"]
SPEND_CAP_USD = 100   # policy/agent-permissions.md, 2026-10-09, until Brynley sets another figure


def folder() -> Optional[Path]:
    return next((p for p in CANDIDATES if p.is_dir()), None)


def pages() -> Dict[str, Path]:
    """Relative page name -> file, for every markdown page in the governance folder."""
    root = folder()
    if not root:
        return {}
    out = {}
    for f in sorted(root.rglob("*.md")):
        rel = f.relative_to(root).as_posix()
        if rel != "MANIFEST.md":
            out[rel] = f
    return out


def read(name: str) -> Optional[str]:
    f = pages().get(name)
    return f.read_text(errors="replace") if f else None


def synced_on() -> str:
    """When the copies were last synced from Binc's tree, from the manifest."""
    root = folder()
    if not root or not (root / "MANIFEST.md").is_file():
        return "unknown"
    m = re.search(r"on (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)", (root / "MANIFEST.md").read_text(errors="replace"))
    return m.group(1) if m else "unknown"


def instructions() -> str:
    """What every MCP client is told at initialize: precedence, the agent permissions, the operator brief."""
    root = folder()
    if not root:
        return ("No governance folder was found (GOVERNANCE_DIR, shared/governance). Treat the CANALV2 job as "
                "read-only: no spend, no install, no push, no client contact, and stop and report on ambiguity.")
    parts = [
        "# Governance (applied to this session)",
        f"These rules are Binc's, copied from the CANALV2 tree on {synced_on()}, and govern anything that touches "
        "that job: its tree, shots, plates and client. This repo's own rules govern its code. Where they meet, "
        "Binc's win for their material. Every page is a resource under governance:// and readable with the "
        "`governance` tool; `README.md` is the precedence page.",
        "",
        "Enforced by this server: tools that spend need `approved_by`, the name behind the yes, and the spend cap is "
        f"USD {SPEND_CAP_USD} total for agents and cloud GPU. Everything else below is a rule you follow.",
    ]
    for name in LEAD_PAGES:
        text = read(name)
        if text:
            parts += ["", f"---\n## {name}", "", text.strip()]
    return "\n".join(parts)


def listing() -> List[dict]:
    return [{"uri": SCHEME + n, "name": n, "size": p.stat().st_size} for n, p in pages().items()]


def uri_to_name(uri: str) -> str:
    return uri[len(SCHEME):] if uri.startswith(SCHEME) else uri


def summary() -> dict:
    """For GET /api/governance and the dashboard."""
    return {"folder": str(folder()) if folder() else None, "synced_on": synced_on(), "spend_cap_usd": SPEND_CAP_USD,
            "lead_pages": LEAD_PAGES, "pages": listing(), "instructions": instructions()}


def named_yes(arguments: dict, what: str) -> Optional[str]:
    """The refusal for a spending tool called without the named yes; None when it may proceed."""
    who = str(arguments.get("approved_by") or "").strip()
    if not who:
        return (f"Refused: {what} spends money, and policy/agent-permissions.md needs a named yes for any spend "
                f"(cap USD {SPEND_CAP_USD}). Call again with approved_by=<the person who said yes> once you have it. "
                "Do not guess a name.")
    return None
