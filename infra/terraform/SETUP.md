# Terraform MOE Agent Pool Setup

**Goal:** Spin up a coordinated pool of GPU agents on RunPod using Terraform.

## Prerequisites

1. **Terraform >= 1.5**
   ```bash
   terraform version
   ```

2. **RunPod API Key**
   ```bash
   export RUNPOD_API_KEY="rpa_..."
   ```

3. **Terraform Cloud account (optional but recommended)**
   - Free tier: https://app.terraform.io
   - Gives you: state locking, VCS integration, cost estimation

## Quick Start (Local State)

### 1. Initialize Terraform

```bash
cd infra/terraform
terraform init
```

**What it does:**
- Downloads RunPod provider
- Sets up `.terraform/` directory
- Initializes local state file

### 2. Create Your Configuration

Copy the example and customize:

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:
```hcl
agents = [
  {
    name         = "image-gen"
    gpu_type     = "rtx4090"
    count        = 1           # Start with 1, scale later
    storage_gb   = 50
  },
]
```

### 3. Preview Changes

```bash
terraform plan -var-file=terraform.tfvars
```

**Read the output carefully.** You'll see:
```
Plan: 1 to add, 0 to change, 0 to destroy.
```

### 4. Create the Pool

```bash
terraform apply -var-file=terraform.tfvars
```

**When prompted:** type `yes`

**Wait:** Pods take 2-3 minutes to launch.

### 5. Get Connection Details

```bash
# View all outputs
terraform output

# Get just endpoints
terraform output -json | jq '.endpoints.value'

# Export as JSON for FastAPI
terraform output -json > pool_state.json
```

**Output example:**
```json
{
  "image-gen-0": {
    "comfyui": "http://abc123.proxy.runpod.io:8188",
    "api": "http://abc123.proxy.runpod.io:8000",
    "ssh": "ssh root@abc123.proxy.runpod.io"
  }
}
```

## With Terraform Cloud (Team Remote State)

### 1. Create Organization

1. Sign up: https://app.terraform.io
2. Create organization: "your-org-name"
3. Create token: Settings → Tokens → Create API Token
4. Copy the token

### 2. Login to Terraform Cloud

```bash
terraform login
# Paste token when prompted
```

This creates `~/.terraform/cloud` with your token.

### 3. Enable Cloud Backend

Edit `versions.tf` - uncomment the `cloud` block:

```hcl
terraform {
  cloud {
    organization = "your-org-name"
    workspaces {
      name = "comfy-moe-${var.environment}"
    }
  }
}
```

### 4. Re-initialize

```bash
terraform init
# Say "yes" to migrate local state to cloud
```

**Now your state is locked and shared.** Multiple team members can safely run:
```bash
terraform plan
terraform apply
```

Without race conditions.

## Managing the Pool

### Scale Up

Edit your `.tfvars`:
```hcl
agents = [
  {
    name  = "image-gen"
    count = 2  # was 1
  },
  {
    name  = "video-gen"
    count = 1  # new agent type
    gpu_type = "a100"
    storage_gb = 100
  },
]
```

Plan and apply:
```bash
terraform plan
terraform apply
```

### Check Status

```bash
# Current state
terraform show

# Quick summary
terraform output pool_stats
```

### Stop a Pod (Don't Destroy)

Terraform doesn't support pause (RunPod API limitation). You must:
1. Delete it: `terraform destroy -target=module.moe_pool.module.agent_pods["video-gen-0"]`
2. Recreate it later: `terraform apply`

### Destroy Everything

```bash
terraform destroy -var-file=terraform.tfvars
# Type "yes" when prompted
```

**This is irreversible.** All pods, data, outputs are gone.

## Environment-Specific Configs

Use separate `.tfvars` per environment:

### Development
```bash
terraform apply -var-file=environments/dev.tfvars
```

### Production
```bash
terraform apply -var-file=environments/prod.tfvars
```

Different environments = different state files (with Terraform Cloud).

## Integration with FastAPI

After `terraform apply`, export state:

```bash
terraform output -json > pool_state.json
```

FastAPI reads this to:
- Register agents with MCP server
- Provide dashboard with pod URLs
- Route jobs to available agents

See: `apps/runpod-api/pod_manager_api.py`

## Troubleshooting

### "Error: The RunPod API key is not set"

```bash
export RUNPOD_API_KEY="rpa_..."
terraform apply
```

Or pass inline:
```bash
terraform apply -var runpod_api_key="rpa_..."
```

### "Error: Pod creation failed"

Check RunPod dashboard:
1. https://www.runpod.io/console/pods
2. Search for your pod name
3. Look at pod logs for ComfyUI startup errors

Or SSH in:
```bash
ssh root@<pod-id>.proxy.runpod.io
```

### "Error: Cost limit exceeded"

Your `max_concurrent_pods` is too low. Edit `.tfvars`:
```hcl
cost_limits = {
  max_concurrent_pods = 10  # was 5
  max_monthly_spend   = 15000
}
```

### State File Conflicts

If multiple people run `terraform apply` simultaneously:

**With Terraform Cloud:** Remote locking prevents conflicts automatically.

**With Local State:** Merge conflicts in `terraform.tfstate` — never edit by hand.

Resolution:
```bash
# One person: terraform apply
# Other person: wait, then
git pull
terraform refresh
terraform apply
```

## Best Practices

### 1. Always Plan Before Apply

```bash
terraform plan -var-file=environments/prod.tfvars  # Read output
terraform apply -var-file=environments/prod.tfvars
```

### 2. Commit Lock File

```bash
git add .terraform.lock.hcl
git commit -m "chore(terraform): lock provider versions"
```

This ensures all team members use the same provider version.

### 3. Use Workspaces for Complex Scenarios

```bash
terraform workspace new staging
terraform workspace select staging
terraform apply -var-file=environments/staging.tfvars
```

### 4. Keep Secrets Out of Git

**Never commit:**
- `terraform.tfstate`
- `terraform.tfvars`
- API keys in code

**Always:**
- Use env vars: `export RUNPOD_API_KEY=...`
- Use `.tfvars.example` as template
- Add `terraform.tfvars` to `.gitignore`

### 5. Tag Resources

Add tags for cost tracking:

```hcl
tags = {
  Environment = "prod"
  Team        = "engineering"
  Project     = "comfy"
  CostCenter  = "ml-infrastructure"
}
```

RunPod dashboard then groups costs by tag.

## Advanced: Custom GPU Types

Edit module to add more GPU mappings:

**`modules/moe_pool/main.tf`:**
```hcl
gpu_types = {
  "rtx4090"  = "NVIDIA RTX 4090"
  "h100"     = "NVIDIA H100"
  "l40s"     = "NVIDIA L40S"
  "custom"   = "Your Custom GPU ID"  # Add here
}
```

Check RunPod docs for exact GPU IDs.

## Support

- **Terraform docs:** https://www.terraform.io/docs
- **RunPod API:** https://docs.runpod.io/api
- **This project:** See `CLAUDE.md` in root

---

**Ready?**
```bash
export RUNPOD_API_KEY="rpa_..."
terraform init
terraform plan -var-file=environments/dev.tfvars
terraform apply -var-file=environments/dev.tfvars
```
