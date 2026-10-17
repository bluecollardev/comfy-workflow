"""
MCP Server - Expose ComfyUI Agent Pool tools to Claude Code
Provides tools for pod management, job submission, and agent orchestration
"""

import os
import json
import logging
import asyncio
from typing import Any
from contextlib import asynccontextmanager

from mcp.server import Server, stdio_server
from mcp.types import (
    Tool, TextContent, ToolResult, CallToolRequest, CallToolResult,
)

from pool_manager import PoolManager, PodConfig
from oauth_handler import oauth_handler

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Initialize pool manager
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
pool_manager = PoolManager(RUNPOD_API_KEY)

server = Server("comfy-moe-server")


@server.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools for Claude"""
    return [
        Tool(
            name="list_agents",
            description="List all agents in the MOE pool with their status",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="get_pool_status",
            description="Get detailed status of the entire agent pool (running pods, cost, health)",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="create_agent",
            description="Create a new GPU pod agent for the pool",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Agent type (e.g., 'image-gen', 'video-gen', 'upscale')",
                    },
                    "gpu_type": {
                        "type": "string",
                        "enum": ["rtx4090", "a100", "h100", "l40s", "rtx6000"],
                        "description": "GPU type for this agent",
                    },
                    "storage_gb": {
                        "type": "integer",
                        "description": "Storage size in GB (50-500)",
                        "default": 100,
                    },
                },
                "required": ["agent_name", "gpu_type"],
            },
        ),
        Tool(
            name="stop_agent",
            description="Stop a running agent pod (pauses billing)",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to stop",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="resume_agent",
            description="Resume a stopped agent pod",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to resume",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="delete_agent",
            description="Permanently delete an agent pod",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to delete",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="health_check_agent",
            description="Check if an agent is healthy and responding",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to check",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="get_agent_info",
            description="Get detailed information about an agent",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to get info for",
                    },
                },
                "required": ["agent_id"],
            },
        ),
        Tool(
            name="submit_job",
            description="Submit a ComfyUI workflow to an agent for execution",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent ID to submit job to",
                    },
                    "workflow_json": {
                        "type": "string",
                        "description": "ComfyUI workflow JSON (API format)",
                    },
                    "prompt_name": {
                        "type": "string",
                        "description": "Name/description of this job",
                    },
                },
                "required": ["agent_id", "workflow_json"],
            },
        ),
        Tool(
            name="get_job_status",
            description="Get status of a submitted job",
            inputSchema={
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "description": "Agent that's running the job",
                    },
                    "job_id": {
                        "type": "string",
                        "description": "Job ID from submission",
                    },
                },
                "required": ["agent_id", "job_id"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> ToolResult:
    """Execute tools called by Claude"""

    try:
        if name == "list_agents":
            agents = list(pool_manager.agents.values())
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=json.dumps([a.dict() for a in agents], indent=2, default=str)
                )]
            )

        elif name == "get_pool_status":
            status = await pool_manager.get_pool_status()
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=json.dumps(status.dict(default=str), indent=2)
                )]
            )

        elif name == "create_agent":
            config = PodConfig(
                agent_name=arguments["agent_name"],
                gpu_type=arguments["gpu_type"],
                storage_gb=arguments.get("storage_gb", 100),
            )
            pod_name = f"comfy-{config.agent_name}-{len(pool_manager.agents)}"
            agent = await pool_manager.create_pod(config, pod_name)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"✓ Agent created: {agent.agent_id}\n\n" +
                         f"ComfyUI: {agent.comfyui_url}\n" +
                         f"SSH: {agent.ssh_command}"
                )]
            )

        elif name == "stop_agent":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )
            success = await pool_manager.stop_pod(agent.pod_id)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"✓ Agent stopped: {agent_id}" if success else f"✗ Failed to stop agent"
                )]
            )

        elif name == "resume_agent":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )
            success = await pool_manager.resume_pod(agent.pod_id)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"✓ Agent resumed: {agent_id}" if success else f"✗ Failed to resume agent"
                )]
            )

        elif name == "delete_agent":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )
            success = await pool_manager.delete_pod(agent.pod_id)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"✓ Agent deleted: {agent_id}" if success else f"✗ Failed to delete agent"
                )]
            )

        elif name == "health_check_agent":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )
            healthy = await pool_manager.health_check_agent(agent)
            status = "✓ Healthy" if healthy else "✗ Unhealthy"
            health_info = json.dumps(agent.health, indent=2, default=str)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"{status}\n\n{health_info}"
                )]
            )

        elif name == "get_agent_info":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )
            # Get live status
            pod_status = await pool_manager.get_pod_status(agent.pod_id)
            info = {**agent.dict(default=str), **pod_status}
            return ToolResult(
                content=[TextContent(type="text", text=json.dumps(info, indent=2))]
            )

        elif name == "submit_job":
            agent_id = arguments["agent_id"]
            agent = pool_manager.agents.get(agent_id)
            if not agent:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Agent not found: {agent_id}")]
                )

            # TODO: Implement job submission to agent API
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Job submission not yet implemented\n\n" +
                         f"Agent: {agent.agent_id}\n" +
                         f"API: {agent.api_url}/api/prompt"
                )]
            )

        elif name == "get_job_status":
            # TODO: Implement job status checking
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text="Job status checking not yet implemented"
                )]
            )

        else:
            return ToolResult(
                content=[TextContent(type="text", text=f"Unknown tool: {name}")]
            )

    except Exception as e:
        logger.exception(f"Tool error: {name}")
        return ToolResult(
            content=[TextContent(
                type="text",
                text=f"Error executing {name}: {str(e)}"
            )]
        )


@asynccontextmanager
async def mcp_server():
    """Run MCP server"""
    async with stdio_server(server) as streams:
        yield


if __name__ == "__main__":
    asyncio.run(mcp_server())
