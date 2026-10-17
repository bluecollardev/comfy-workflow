variable "pool_name" {
  description = "Name of the agent pool"
  type        = string
  default     = "comfy-moe"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "comfy"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "agents" {
  description = "List of agent types and their counts"
  type = list(object({
    name         = string
    gpu_type     = string
    count        = number
    storage_gb   = number
    env_vars     = optional(map(string), {})
    max_idle_sec = optional(number, 3600)
  }))
}

variable "control_plane_url" {
  description = "FastAPI control plane URL"
  type        = string
  default     = "http://localhost:8000"
}

variable "cost_limits" {
  description = "Cost control and resource limits"
  type = object({
    max_concurrent_pods = number
    max_monthly_spend   = number
  })
  default = {
    max_concurrent_pods = 10
    max_monthly_spend   = 10000
  }
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project   = "comfy_workflow"
    ManagedBy = "terraform"
  }
}
