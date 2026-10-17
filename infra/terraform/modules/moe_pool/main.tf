locals {
  # Flatten agents list for easier iteration
  pods = flatten([
    for agent in var.agents : [
      for i in range(agent.count) : {
        agent_name = agent.name
        agent_idx  = i
        gpu_type   = agent.gpu_type
        storage_gb = agent.storage_gb
        env_vars   = agent.env_vars
        max_idle_sec = agent.max_idle_sec
        # Unique agent_id per pod
        agent_id = "${agent.name}-${i}"
        pod_name = "${var.project_name}-${agent.name}-${i}"
      }
    ]
  ])

  # Convert to map for easier reference
  pods_map = {
    for pod in local.pods : pod.agent_id => pod
  }

  # Validation: respect cost limits
  total_pods = length(local.pods)

  # GPU mapping to RunPod type IDs
  gpu_types = {
    "rtx4090"     = "NVIDIA RTX 4090"
    "a100"        = "NVIDIA A100"
    "h100"        = "NVIDIA H100"
    "l40s"        = "NVIDIA L40S"
    "rtx6000"     = "NVIDIA RTX 6000"
    "a6000"       = "NVIDIA RTX A6000"
    "a10g"        = "NVIDIA A10G"
    "t4"          = "NVIDIA T4"
  }
}

# Validate cost limits
resource "null_resource" "cost_validation" {
  lifecycle {
    precondition {
      condition     = local.total_pods <= var.cost_limits.max_concurrent_pods
      error_message = "Total pods (${local.total_pods}) exceeds max allowed (${var.cost_limits.max_concurrent_pods})"
    }
  }
}

# Create all agent pods
module "agent_pods" {
  for_each = local.pods_map

  source = "../runpod_pod"

  pod_name           = each.value.pod_name
  agent_id           = each.value.agent_id
  agent_name         = each.value.agent_name
  gpu_type           = lookup(local.gpu_types, each.value.gpu_type, each.value.gpu_type)
  storage_gb         = each.value.storage_gb
  env_vars           = each.value.env_vars
  control_plane_url  = var.control_plane_url
  auto_stop          = each.value.max_idle_sec / 60  # Convert seconds to minutes

  tags = merge(
    var.tags,
    {
      AgentPool = var.pool_name
      AgentType = each.value.agent_name
      Index     = each.value.agent_idx
    }
  )

  depends_on = [null_resource.cost_validation]
}

# Output agent pool status
output "pool_summary" {
  value = {
    total_pods     = length(module.agent_pods)
    agents_by_type = {
      for agent in var.agents : agent.name => {
        count    = agent.count
        gpu_type = agent.gpu_type
        storage_gb = agent.storage_gb
      }
    }
    environment = var.environment
    control_plane_url = var.control_plane_url
  }
}
