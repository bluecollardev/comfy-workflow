terraform {
  required_version = ">= 1.5"

  required_providers {
    runpod = {
      source  = "runpod/runpod"
      version = "= 0.5.0"  # Stable version (v1.0.9 has schema bug)
    }
  }

  # Local state for now (RunPod provider issue with TF Cloud)
  # Upgrade to TF Cloud once provider is stable
  # cloud {
  #   organization = "bluecollardev-comfy"
  #   workspaces { name = "comfy-moe-dev" }
  # }

  # Alternative: Local S3 backend (shared team storage, no TF Cloud)
  # backend "s3" {
  #   bucket         = "comfy-terraform-state"
  #   key            = "moe-pool/terraform.tfstate"
  #   region         = "us-east-1"
  #   encrypt        = true
  #   dynamodb_table = "terraform-locks"
  # }
}

provider "runpod" {
  api_key = var.runpod_api_key
}
