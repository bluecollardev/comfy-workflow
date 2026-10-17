variable "runpod_api_key" {
  description = "RunPod API key for pod management"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "comfy_workflow"
}

variable "control_plane_url" {
  description = "FastAPI control plane URL for agent registration"
  type        = string
  default     = "http://localhost:8000"
}

variable "control_plane_api_key" {
  description = "API key for control plane authentication"
  type        = string
  sensitive   = true
  default     = ""
}

variable "agents" {
  description = "MOE Agent pool configuration"
  type = list(object({
    name         = string           # Agent name (image-gen, video-gen, etc.)
    gpu_type     = string           # RunPod GPU type (rtx4090, a100, h100, etc.)
    count        = number           # Number of pods for this agent
    storage_gb   = number           # Storage per pod
    env_vars     = optional(map(string), {})  # Environment variables
    max_idle_sec = optional(number, 3600)    # Auto-stop after idle
  }))

  validation {
    condition = alltrue([
      for agent in var.agents : agent.count >= 1 && agent.count <= 10
    ])
    error_message = "Each agent must have between 1 and 10 pods."
  }
}

variable "shared_volume" {
  description = "Shared storage configuration"
  type = object({
    size_gb = number
    name    = string
  })
  default = {
    size_gb = 100
    name    = "comfy-shared"
  }
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "comfy_workflow"
    ManagedBy   = "terraform"
  }
}

variable "cost_limits" {
  description = "Cost control settings"
  type = object({
    max_concurrent_pods = number
    max_monthly_spend   = number  # dollars
  })
  default = {
    max_concurrent_pods = 5
    max_monthly_spend   = 10000
  }
}
