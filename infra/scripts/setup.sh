#!/bin/bash
# RunPod Setup Script
# Initializes environment and creates first on-demand pod

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$PROJECT_ROOT/infra"
SCRIPTS_DIR="$INFRA_DIR/scripts"

echo "================================"
echo "ComfyUI RunPod Setup"
echo "================================"
echo ""

# 1. Check Python
echo "1. Checking Python..."
if ! command -v python3 &> /dev/null; then
    echo "✗ Python 3 not found. Please install Python 3.8+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo "✓ Python $PYTHON_VERSION found"
echo ""

# 2. Install dependencies
echo "2. Installing dependencies..."
pip install -q -r "$SCRIPTS_DIR/requirements.txt"
echo "✓ Dependencies installed"
echo ""

# 3. Check RunPod API key
echo "3. Checking RunPod credentials..."
if [ -z "$RUNPOD_API_KEY" ]; then
    echo ""
    echo "⚠️  RUNPOD_API_KEY not set!"
    echo ""
    echo "To get your API key:"
    echo "  1. Go to https://www.runpod.io/account"
    echo "  2. Create an API key"
    echo "  3. Set it:"
    echo ""
    echo "    export RUNPOD_API_KEY='your-key-here'"
    echo ""
    read -p "Enter your RunPod API key: " -s RUNPOD_API_KEY
    echo ""
    export RUNPOD_API_KEY
fi
echo "✓ API key configured"
echo ""

# 4. Load environment (if .env exists)
if [ -f "$PROJECT_ROOT/.env" ]; then
    echo "4. Loading environment from .env..."
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
    echo "✓ Environment loaded"
else
    echo "4. No .env file found, using defaults or CLI args"
fi
echo ""

# 5. Summary and next steps
echo "================================"
echo "Setup Complete!"
echo "================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Create your first pod:"
echo "   python3 $SCRIPTS_DIR/create_pod.py create \\"
echo "     --name ComfyUI-Dev \\"
echo "     --gpu rtx4090 \\"
echo "     --volume 50 \\"
echo "     --disk 20"
echo ""
echo "2. Access ComfyUI:"
echo "   http://<pod-id>.proxy.runpod.io:8188"
echo ""
echo "3. SSH into pod:"
echo "   ssh root@<pod-id>.proxy.runpod.io"
echo ""
echo "For more help:"
echo "   python3 $SCRIPTS_DIR/create_pod.py --help"
echo ""
