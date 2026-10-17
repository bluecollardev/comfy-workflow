terraform {
  required_version = ">= 1.5"

  required_providers {
    runpod = {
      source  = "runpod/runpod"
      version = "~> 1.0"
    }
  }

  # Team state locking + VCS integration (Terraform Cloud)
  cloud {
    organization = "bluecollardev-comfy"

    workspaces {
      name = "comfy-moe-${var.environment}"
    }
  }

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
