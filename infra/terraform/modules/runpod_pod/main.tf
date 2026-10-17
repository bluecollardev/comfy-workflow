resource "runpod_pod" "this" {
  cloud_type = "secure"
  gpu_count  = 1
  volume_in_gb = var.storage_gb
  container_disk_in_gb = var.container_disk_gb
  min_vcpu_count = var.vcpu_count
  min_memory_in_gb = var.memory_gb
  gpu_type_id = var.gpu_type
  name = var.pod_name
  image_name = var.container_image

  # Environment variables for the pod
  env = merge(
    var.env_vars,
    {
      POD_ID             = runpod_pod.this.id
      POD_NAME           = var.pod_name
      AGENT_ID           = var.agent_id
      CONTROL_PLANE_URL  = var.control_plane_url
      COMFY_PORT         = "8188"
    }
  )

  ports = var.exposed_ports

  # Pod lifecycle
  auto_stop = var.auto_stop

  # Network settings
  network_volume_type = "DOWNLOADS"

  # Tags for organization
  tags = merge(
    var.tags,
    {
      Agent = var.agent_name
      Type  = "moe-pool"
    }
  )

  lifecycle {
    ignore_changes = [
      ports,  # Port assignments change after pod creation
    ]
  }
}

# Wait for pod to be ready and running
resource "null_resource" "pod_ready" {
  depends_on = [runpod_pod.this]

  provisioner "local-exec" {
    command = "echo 'Pod ${runpod_pod.this.id} is ready'"
  }

  triggers = {
    pod_id = runpod_pod.this.id
  }
}
