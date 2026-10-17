terraform {
  required_version = ">= 1.5"

  required_providers {
    runpod = {
      source  = "runpod/runpod"
      version = "~> 1.0"
    }
  }

  # Enable for team state locking + VCS integration
  # Setup:
  #   1. Create org at app.terraform.io
  #   2. Create workspace: "comfy-moe-<env>"
  #   3. Run: terraform login (paste API token)
  #   4. Uncomment below, run: terraform init
  #
  # cloud {
  #   organization = "your-org-name"
  #
  #   workspaces {
  #     name = "comfy-moe-${var.environment}"
  #   }
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
