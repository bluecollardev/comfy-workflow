module "moe_pool" {
  source = "./modules/moe_pool"

  pool_name       = "${var.project_name}-moe"
  project_name    = var.project_name
  environment     = var.environment
  agents          = var.agents
  control_plane_url = var.control_plane_url
  cost_limits     = var.cost_limits
  tags            = var.tags
}
