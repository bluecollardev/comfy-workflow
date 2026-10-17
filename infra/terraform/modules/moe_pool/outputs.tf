output "agent_pods" {
  description = "All agent pods in the pool"
  value = {
    for agent_id, pod in module.agent_pods : agent_id => pod.pod_info
  }
}

output "pool_stats" {
  description = "Pool statistics"
  value = {
    total_pods = length(module.agent_pods)
    agents_by_type = {
      for agent in var.agents : agent.name => {
        count      = agent.count
        gpu_type   = agent.gpu_type
        storage_gb = agent.storage_gb
        total_storage = agent.count * agent.storage_gb
      }
    }
  }
}

output "pool_endpoints" {
  description = "Quick reference for all agent endpoints"
  value = {
    for agent_id, pod in module.agent_pods : agent_id => {
      comfyui = pod.pod_url
      api     = pod.api_url
      ssh     = pod.ssh_command
    }
  }
}

output "control_plane" {
  description = "Control plane configuration"
  value = {
    url     = var.control_plane_url
    agents  = length(module.agent_pods)
  }
}

output "json_output" {
  description = "JSON format for CI/CD pipelines"
  value = jsonencode({
    pool = {
      name        = var.pool_name
      environment = var.environment
      created_at  = timestamp()
      agents = [
        for agent_id, pod in module.agent_pods : {
          id        = pod.agent_id
          name      = pod.agent_name
          pod_id    = pod.pod_id
          gpu_type  = pod.gpu_type
          comfyui_url = pod.pod_url
          api_url     = pod.api_url
          ssh_cmd     = pod.ssh_command
        }
      ]
    }
  })
}
