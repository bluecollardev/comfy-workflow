variable "pod_name" {
  description = "Name of the RunPod pod"
  type        = string
}

variable "agent_id" {
  description = "Unique agent identifier"
  type        = string
}

variable "agent_name" {
  description = "Agent type (image-gen, video-gen, etc.)"
  type        = string
}

variable "gpu_type" {
  description = "GPU type (rtx4090, a100, h100, etc.)"
  type        = string
}

variable "storage_gb" {
  description = "Persistent volume storage in GB"
  type        = number
  default     = 50
}

variable "container_disk_gb" {
  description = "Container disk storage in GB"
  type        = number
  default     = 20
}

variable "vcpu_count" {
  description = "Number of vCPUs"
  type        = number
  default     = 4
}

variable "memory_gb" {
  description = "Memory in GB"
  type        = number
  default     = 16
}

variable "container_image" {
  description = "Docker image for ComfyUI"
  type        = string
  default     = "runpod/io-sdk-base:latest"
}

variable "exposed_ports" {
  description = "Ports to expose from the pod"
  type        = list(string)
  default     = ["8188/http", "8000/http"]
}

variable "env_vars" {
  description = "Environment variables for the pod"
  type        = map(string)
  default     = {}
}

variable "control_plane_url" {
  description = "URL of the FastAPI control plane"
  type        = string
  default     = "http://localhost:8000"
}

variable "auto_stop" {
  description = "Automatically stop pod after idle time (minutes)"
  type        = number
  default     = 60
}

variable "tags" {
  description = "Common tags for the pod"
  type        = map(string)
  default     = {}
}
