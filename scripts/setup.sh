#!/usr/bin/env bash
# Sloppy Setup Script for macOS/Linux
# Run: chmod +x scripts/setup.sh && ./scripts/setup.sh

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}========================================"
echo "       Sloppy Setup Script             "
echo -e "========================================${NC}"
echo ""

# Check if running from the correct directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Please run this script from the sloppy root directory${NC}"
    exit 1
fi

# Function to compare versions
version_gte() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Step 1: Check Node.js
echo -e "${YELLOW}[1/6] Checking Node.js...${NC}"

if ! command -v node &> /dev/null; then
    echo ""
    echo -e "${RED}Node.js is not installed!${NC}"
    echo ""
    echo -e "Please install Node.js v22 or later:"
    echo ""
    echo -e "${GRAY}  macOS (Homebrew):${NC}"
    echo -e "${GRAY}    brew install node@22${NC}"
    echo ""
    echo -e "${GRAY}  Ubuntu/Debian:${NC}"
    echo -e "${GRAY}    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -${NC}"
    echo -e "${GRAY}    sudo apt-get install -y nodejs${NC}"
    echo ""
    echo -e "${GRAY}  Using nvm (any platform):${NC}"
    echo -e "${GRAY}    nvm install 22 && nvm use 22${NC}"
    echo ""
    echo -e "${GRAY}  Or download from: https://nodejs.org/${NC}"
    echo ""
    exit 1
fi

NODE_VERSION=$(node --version | sed 's/v//')
REQUIRED_NODE="22.0.0"

if ! version_gte "$NODE_VERSION" "$REQUIRED_NODE"; then
    echo ""
    echo -e "${RED}Node.js version $NODE_VERSION is too old!${NC}"
    echo -e "${YELLOW}Required: v$REQUIRED_NODE or later${NC}"
    echo ""
    echo "Please upgrade Node.js:"
    echo -e "${GRAY}  nvm install 22 && nvm use 22${NC}"
    echo -e "${GRAY}  Or download from: https://nodejs.org/${NC}"
    echo ""
    exit 1
fi

echo -e "  ${GREEN}Node.js v$NODE_VERSION${NC}"

# Step 2: Check/Install pnpm
echo -e "${YELLOW}[2/6] Checking pnpm...${NC}"

if ! command -v pnpm &> /dev/null; then
    echo -e "  ${YELLOW}pnpm not found, installing...${NC}"

    # Try npm first
    if command -v npm &> /dev/null; then
        npm install -g pnpm@9.15.0 || {
            echo ""
            echo -e "${RED}Failed to install pnpm automatically.${NC}"
            echo ""
            echo "Please install pnpm manually:"
            echo -e "${GRAY}  npm install -g pnpm@9.15.0${NC}"
            echo ""
            echo "Or using Corepack:"
            echo -e "${GRAY}  corepack enable && corepack prepare pnpm@9.15.0 --activate${NC}"
            echo ""
            exit 1
        }
        echo -e "  ${GREEN}pnpm installed successfully${NC}"
    else
        echo ""
        echo -e "${RED}npm not found. Cannot install pnpm.${NC}"
        exit 1
    fi
else
    PNPM_VERSION=$(pnpm --version)
    echo -e "  ${GREEN}pnpm v$PNPM_VERSION${NC}"
fi

# Step 3: Check Git
echo -e "${YELLOW}[3/6] Checking Git...${NC}"

if ! command -v git &> /dev/null; then
    echo ""
    echo -e "${RED}Git is not installed!${NC}"
    echo ""
    echo "Please install Git:"
    echo -e "${GRAY}  macOS: brew install git${NC}"
    echo -e "${GRAY}  Ubuntu/Debian: sudo apt-get install git${NC}"
    echo -e "${GRAY}  Fedora: sudo dnf install git${NC}"
    echo ""
    exit 1
fi

GIT_VERSION=$(git --version | sed 's/git version //')
echo -e "  ${GREEN}Git $GIT_VERSION${NC}"

# Step 4: Install dependencies
echo -e "${YELLOW}[4/6] Installing dependencies...${NC}"

pnpm install || {
    echo ""
    echo -e "${RED}Failed to install dependencies.${NC}"
    echo ""
    echo "Common fixes:"
    echo -e "${GRAY}  1. Delete node_modules and pnpm-lock.yaml, then retry${NC}"
    echo -e "${GRAY}  2. On macOS, ensure Xcode CLI tools: xcode-select --install${NC}"
    echo -e "${GRAY}  3. Check for errors above for specific issues${NC}"
    echo ""
    exit 1
}

echo -e "  ${GREEN}Dependencies installed${NC}"

# Step 5: Create config files
echo -e "${YELLOW}[5/6] Setting up configuration...${NC}"

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "  ${GREEN}Created .env from template${NC}"
    else
        # Create minimal .env
        cat > .env << 'EOF'
PORT=7749
HOST=0.0.0.0
NODE_ENV=development
DATABASE_PATH=./data/sloppy.db
LOG_LEVEL=info
EOF
        echo -e "  ${GREEN}Created .env file${NC}"
    fi
else
    echo -e "  ${GRAY}.env already exists${NC}"
fi

# Create sloppy.config.json if it doesn't exist
if [ ! -f "sloppy.config.json" ]; then
    if [ -f "sloppy.config.example.json" ]; then
        cp sloppy.config.example.json sloppy.config.json
        echo -e "  ${GREEN}Created sloppy.config.json from template${NC}"
    fi
else
    echo -e "  ${GRAY}sloppy.config.json already exists${NC}"
fi

# Step 6: Build the project
echo -e "${YELLOW}[6/6] Building project...${NC}"

pnpm build || {
    echo ""
    echo -e "${RED}Build failed. Check the error messages above.${NC}"
    exit 1
}

echo -e "  ${GREEN}Build complete${NC}"

# Success!
echo ""
echo -e "${GREEN}========================================"
echo "       Setup Complete!                 "
echo -e "========================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo -e "${YELLOW}  1. Start Sloppy:${NC}"
echo -e "${CYAN}     pnpm start${NC}"
echo ""
echo -e "${YELLOW}  2. Open in browser:${NC}"
echo -e "${CYAN}     http://localhost:3000${NC}"
echo ""
echo -e "${YELLOW}  3. Configure your AI provider:${NC}"
echo -e "${GRAY}     Go to Settings and add your API key${NC}"
echo ""
echo "For development with hot-reload:"
echo -e "${CYAN}     pnpm dev${NC}"
echo ""
