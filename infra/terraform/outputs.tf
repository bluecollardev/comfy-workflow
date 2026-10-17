output "moe_pool" {
  description = "Complete MOE agent pool information"
  value       = module.moe_pool.agent_pods
}

output "pool_stats" {
  description = "Pool statistics and configuration"
  value       = module.moe_pool.pool_stats
}

output "endpoints" {
  description = "Quick reference: all agent endpoints (ComfyUI, API, SSH)"
  value       = module.moe_pool.pool_endpoints
}

output "control_plane_info" {
  description = "Control plane (FastAPI) configuration"
  value       = module.moe_pool.control_plane
}

output "pool_json" {
  description = "Full pool state as JSON (for integration with FastAPI)"
  value       = module.moe_pool.json_output
}

output "commands" {
  description = "Quick commands for team members"
  value = {
    status = "terraform show"
    refresh_state = "terraform refresh"
    destroy = "terraform destroy -var-file=environments/${var.environment}.tfvars"
    output_json = "terraform output -json > pool_state.json"
  }
}
