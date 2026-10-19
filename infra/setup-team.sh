#!/bin/bash
# ComfyUI Workflow - Team Setup Script
# Installs all dependencies and configures environment for local development

set -e

echo "╔════════════════════════════════════════════════════════╗"
echo "║  ComfyUI Workflow - Team Setup                         ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}Step 1: Checking prerequisites${NC}"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}Homebrew not found. Installing...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
echo -e "${GREEN}✓ Homebrew${NC}"

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}Python3 not found. Installing...${NC}"
    brew install python@3.11
fi
PYTHON_VERSION=$(python3 --version)
echo -e "${GREEN}✓ $PYTHON_VERSION${NC}"

# Check Git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Git not found. Installing...${NC}"
    brew install git
fi
GIT_VERSION=$(git --version)
echo -e "${GREEN}✓ $GIT_VERSION${NC}"

# Check Node.js (for frontend)
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    brew install node
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"

echo ""
echo -e "${BLUE}Step 2: Installing Terraform${NC}"
echo ""

if ! command -v terraform &> /dev/null; then
    echo -e "${YELLOW}Terraform not found. Installing...${NC}"
    brew tap hashicorp/tap
    brew install hashicorp/tap/terraform
fi
TF_VERSION=$(terraform version | head -1)
echo -e "${GREEN}✓ $TF_VERSION${NC}"

echo ""
echo -e "${BLUE}Step 3: Installing Python dependencies${NC}"
echo ""

if [ -f "infra/scripts/requirements.txt" ]; then
    pip3 install -r infra/scripts/requirements.txt
    echo -e "${GREEN}✓ Python packages installed${NC}"
fi

echo ""
echo -e "${BLUE}Step 4: Setting up environment variables${NC}"
echo ""

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    cat > .env << 'ENVEOF'
# RunPod API Key (get from https://www.runpod.io/console/api-keys)
RUNPOD_API_KEY=

# Terraform Cloud API Token (get from https://app.terraform.io/app/settings/tokens)
TF_API_TOKEN=

# Optional: Control Plane URL
CONTROL_PLANE_URL=http://localhost:8000
ENVEOF
    echo -e "${YELLOW}Created .env file${NC}"
    echo -e "${YELLOW}⚠️  Edit .env and add your credentials:${NC}"
    echo -e "${YELLOW}   RUNPOD_API_KEY=rpa_...${NC}"
    echo -e "${YELLOW}   TF_API_TOKEN=...${NC}"
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Load environment
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

echo ""
echo -e "${BLUE}Step 5: Initializing Terraform${NC}"
echo ""

cd infra/terraform

if [ ! -d ".terraform" ]; then
    echo "Running: terraform init"
    terraform init -upgrade
    echo -e "${GREEN}✓ Terraform initialized${NC}"
else
    echo -e "${GREEN}✓ Terraform already initialized${NC}"
fi

echo ""
echo -e "${BLUE}Step 6: Validating configuration${NC}"
echo ""

# Validate Terraform
if terraform validate > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Terraform configuration valid${NC}"
else
    echo -e "${RED}✗ Terraform validation failed${NC}"
    terraform validate
    exit 1
fi

echo ""
echo -e "${BLUE}Step 7: Frontend setup${NC}"
echo ""

cd "$PROJECT_ROOT/apps/runpod-dashboard"

if [ ! -d "node_modules" ]; then
    echo "Running: npm install"
    npm install
    echo -e "${GREEN}✓ Frontend dependencies installed${NC}"
else
    echo -e "${GREEN}✓ node_modules already exists${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════════╗"
echo "║  ✓ Setup Complete!                                     ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "1. Add credentials to .env:"
echo "   • RUNPOD_API_KEY from https://www.runpod.io/console/api-keys"
echo "   • TF_API_TOKEN from https://app.terraform.io/app/settings/tokens"
echo ""
echo "2. Reload environment:"
echo "   source .env"
echo ""
echo "3. Check Terraform Cloud connection:"
echo "   cd $PROJECT_ROOT/infra/terraform"
echo "   terraform workspace list"
echo ""
echo "4. Plan the MOE agent pool:"
echo "   terraform plan -var-file=environments/dev.tfvars"
echo ""
echo "5. Start the FastAPI backend:"
echo "   cd $PROJECT_ROOT/infra/scripts"
echo "   python3 -m uvicorn pod_manager_api:app --reload --host 0.0.0.0 --port 8000"
echo ""
echo "6. Start the RunPod dashboard (in another terminal):"
echo "   cd $PROJECT_ROOT/apps/runpod-dashboard"
echo "   npm run dev"
echo ""
echo "Documentation:"
echo "  • infra/terraform/SETUP.md - Terraform usage guide"
echo "  • docs/ADR-002-moe-agent-pool.md - Architecture decisions"
echo "  • CLAUDE.md - Project conventions"
echo ""
