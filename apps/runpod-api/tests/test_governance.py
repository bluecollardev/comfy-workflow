"""Governance applied to MCP clients: instructions at initialize, pages as resources and a tool, spend gated."""
import asyncio
import pathlib

import pytest
from mcp.types import CallToolRequestParams, ReadResourceRequestParams

import governance
import mcp_server

REPO = pathlib.Path(__file__).resolve().parents[3]


def test_folder_and_pages():
    assert governance.folder() == REPO / "shared" / "governance"
    names = set(governance.pages())
    assert {"README.md", "operator-brief.md", "policy/agent-permissions.md", "workflow/workflow-rules.md"} <= names
    assert "MANIFEST.md" not in names and len(names) >= 36
    assert governance.synced_on().startswith("20")


def test_instructions_carry_the_lead_pages():
    text = governance.instructions()
    assert "Needs a named yes: any download or install, any spend" in text     # agent-permissions, verbatim
    assert "You do not write, edit or install code of any kind." in text        # operator brief, verbatim
    assert "USD 100" in text and "governance://" in text
    assert mcp_server.server.instructions == text


def test_instructions_without_a_folder(monkeypatch, tmp_path):
    monkeypatch.setattr(governance, "CANDIDATES", [tmp_path / "missing"])
    assert governance.folder() is None and governance.pages() == {}
    assert "read-only" in governance.instructions() and governance.summary()["pages"] == []


def test_resources_and_tool():
    res = asyncio.run(mcp_server.list_resources(None, None)).resources
    uris = {str(r.uri) for r in res}
    assert "governance://policy/agent-permissions.md" in uris and len(uris) == len(governance.pages())
    out = asyncio.run(mcp_server.read_resource(None, ReadResourceRequestParams(uri="governance://operator-brief.md")))
    assert "operator, not a builder" in out.contents[0].text
    with pytest.raises(ValueError):
        asyncio.run(mcp_server.read_resource(None, ReadResourceRequestParams(uri="governance://nope.md")))
    tools = asyncio.run(mcp_server.list_tools(None, None)).tools
    by_name = {t.name: t for t in tools}
    assert "governance" in by_name and "approved_by" in by_name["create_agent"].input_schema["properties"]
    r = asyncio.run(mcp_server.call_tool(None, CallToolRequestParams(name="governance", arguments={"page": "policy/naming.md"})))
    assert "Shot folder" in r.content[0].text and not r.is_error
    r = asyncio.run(mcp_server.call_tool(None, CallToolRequestParams(name="governance", arguments={})))
    assert "policy/agent-permissions.md" in r.content[0].text
    r = asyncio.run(mcp_server.call_tool(None, CallToolRequestParams(name="governance", arguments={"page": "nope.md"})))
    assert r.is_error


def test_spend_needs_a_named_yes():
    r = asyncio.run(mcp_server.call_tool(None, CallToolRequestParams(name="create_agent", arguments={"agent_name": "x", "gpu_type": "rtx4090"})))
    assert r.is_error and "approved_by" in r.content[0].text and "USD 100" in r.content[0].text
    assert governance.named_yes({"approved_by": "Binc"}, "create_agent") is None
    assert governance.named_yes({"approved_by": "   "}, "create_agent")
