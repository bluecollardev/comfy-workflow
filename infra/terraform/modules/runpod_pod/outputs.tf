output "pod_id" {
  description = "RunPod pod ID"
  value       = runpod_pod.this.id
}

output "pod_name" {
  description = "Pod name"
  value       = var.pod_name
}

output "agent_id" {
  description = "Agent identifier"
  value       = var.agent_id
}

output "agent_name" {
  description = "Agent type"
  value       = var.agent_name
}

output "gpu_type" {
  description = "GPU type"
  value       = var.gpu_type
}

output "pod_url" {
  description = "Web UI URL for ComfyUI"
  value       = "http://${runpod_pod.this.id}.proxy.runpod.io:8188"
}

output "api_url" {
  description = "API endpoint URL"
  value       = "http://${runpod_pod.this.id}.proxy.runpod.io:8000"
}

output "ssh_command" {
  description = "SSH command to connect to the pod"
  value       = "ssh root@${runpod_pod.this.id}.proxy.runpod.io"
}

output "status" {
  description = "Pod current status"
  value       = runpod_pod.this.status
}

output "pod_info" {
  description = "Complete pod information"
  value = {
    id           = runpod_pod.this.id
    name         = var.pod_name
    agent_id     = var.agent_id
    agent_name   = var.agent_name
    gpu_type     = var.gpu_type
    storage_gb   = var.storage_gb
    comfyui_url  = "http://${runpod_pod.this.id}.proxy.runpod.io:8188"
    api_url      = "http://${runpod_pod.this.id}.proxy.runpod.io:8000"
    ssh_command  = "ssh root@${runpod_pod.this.id}.proxy.runpod.io"
  }
}
