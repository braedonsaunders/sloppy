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

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ -f /etc/debian_version ]]; then
        echo "debian"
    elif [[ -f /etc/fedora-release ]]; then
        echo "fedora"
    elif [[ -f /etc/arch-release ]]; then
        echo "arch"
    else
        echo "linux"
    fi
}

OS=$(detect_os)

# Function to compare versions
version_gte() {
    [ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

# Function to check if build tools are installed
check_build_tools() {
    if [[ "$OS" == "macos" ]]; then
        # Check for Xcode CLI tools
        if xcode-select -p &> /dev/null; then
            return 0
        fi
        return 1
    else
        # Check for gcc/g++ on Linux
        if command -v gcc &> /dev/null && command -v g++ &> /dev/null && command -v make &> /dev/null; then
            return 0
        fi
        return 1
    fi
}

# Function to install build tools
install_build_tools() {
    echo ""
    echo -e "${YELLOW}Build tools are required to compile native modules.${NC}"
    echo ""

    if [[ "$OS" == "macos" ]]; then
        echo -e "Installing Xcode Command Line Tools..."
        echo -e "${GRAY}This may open a dialog - please click 'Install' and wait for completion.${NC}"
        echo ""

        xcode-select --install 2>/dev/null || true

        # Wait for installation
        echo "Waiting for Xcode CLI tools installation to complete..."
        echo -e "${GRAY}(Press Ctrl+C if you've already installed them)${NC}"

        until xcode-select -p &> /dev/null; do
            sleep 5
        done

        echo -e "  ${GREEN}Xcode CLI tools installed${NC}"
    else
        echo "Installing build tools..."
        echo ""

        case "$OS" in
            debian)
                echo -e "${YELLOW}Running: sudo apt-get update && sudo apt-get install -y build-essential python3${NC}"
                sudo apt-get update
                sudo apt-get install -y build-essential python3
                ;;
            fedora)
                echo -e "${YELLOW}Running: sudo dnf groupinstall -y 'Development Tools'${NC}"
                sudo dnf groupinstall -y "Development Tools"
                sudo dnf install -y python3
                ;;
            arch)
                echo -e "${YELLOW}Running: sudo pacman -S --noconfirm base-devel python${NC}"
                sudo pacman -S --noconfirm base-devel python
                ;;
            *)
                echo -e "${RED}Could not auto-install build tools for your distribution.${NC}"
                echo ""
                echo "Please install the following packages manually:"
                echo -e "${GRAY}  - gcc, g++, make (or build-essential)${NC}"
                echo -e "${GRAY}  - python3${NC}"
                echo ""
                exit 1
                ;;
        esac

        echo -e "  ${GREEN}Build tools installed${NC}"
    fi
}

# Step 1: Check Node.js
echo -e "${YELLOW}[1/7] Checking Node.js...${NC}"

if ! command -v node &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Node.js is not installed. Attempting to install...${NC}"
    echo ""

    case "$OS" in
        macos)
            if command -v brew &> /dev/null; then
                echo "Installing Node.js via Homebrew..."
                brew install node@22
                brew link node@22 --force --overwrite
            else
                echo -e "${RED}Homebrew not found.${NC}"
                echo ""
                echo "Please install Node.js v22 or later:"
                echo -e "${GRAY}  brew install node@22${NC}"
                echo -e "${GRAY}  Or download from: https://nodejs.org/${NC}"
                exit 1
            fi
            ;;
        debian)
            echo "Installing Node.js via NodeSource..."
            curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        fedora)
            echo "Installing Node.js via dnf..."
            sudo dnf install -y nodejs
            ;;
        arch)
            echo "Installing Node.js via pacman..."
            sudo pacman -S --noconfirm nodejs npm
            ;;
        *)
            echo -e "${RED}Could not auto-install Node.js for your distribution.${NC}"
            echo ""
            echo "Please install Node.js v22 or later:"
            echo -e "${GRAY}  Using nvm: nvm install 22 && nvm use 22${NC}"
            echo -e "${GRAY}  Or download from: https://nodejs.org/${NC}"
            exit 1
            ;;
    esac

    echo -e "  ${GREEN}Node.js installed${NC}"
fi

NODE_VERSION=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

# Check Node version - must be v22.x (v23+ and v24+ are too new, prebuild binaries don't exist)
if [ "$NODE_MAJOR" -lt 22 ]; then
    echo ""
    echo -e "${RED}Node.js version $NODE_VERSION is too old!${NC}"
    echo -e "${YELLOW}Required: v22.x LTS${NC}"
    echo ""
    echo "Please upgrade Node.js:"
    echo -e "${GRAY}  nvm install 22 && nvm use 22${NC}"
    echo -e "${GRAY}  Or download from: https://nodejs.org/${NC}"
    echo ""
    exit 1
fi

if [ "$NODE_MAJOR" -gt 22 ]; then
    echo ""
    echo -e "${RED}Node.js version $NODE_VERSION is too new!${NC}"
    echo -e "${YELLOW}Native modules like better-sqlite3 don't have prebuilt binaries for v$NODE_MAJOR yet.${NC}"
    echo ""
    echo "Please install Node.js v22 LTS instead:"
    echo -e "${GRAY}  nvm install 22 && nvm use 22${NC}"
    echo -e "${GRAY}  Or download v22 LTS from: https://nodejs.org/${NC}"
    echo ""
    exit 1
fi

echo -e "  ${GREEN}Node.js v$NODE_VERSION${NC}"

# Step 2: Check/Install pnpm
echo -e "${YELLOW}[2/7] Checking pnpm...${NC}"

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
echo -e "${YELLOW}[3/7] Checking Git...${NC}"

if ! command -v git &> /dev/null; then
    echo ""
    echo -e "${YELLOW}Git is not installed. Attempting to install...${NC}"

    case "$OS" in
        macos)
            if command -v brew &> /dev/null; then
                brew install git
            else
                # Xcode CLI tools include git
                xcode-select --install 2>/dev/null || true
            fi
            ;;
        debian)
            sudo apt-get update
            sudo apt-get install -y git
            ;;
        fedora)
            sudo dnf install -y git
            ;;
        arch)
            sudo pacman -S --noconfirm git
            ;;
        *)
            echo -e "${RED}Could not auto-install Git.${NC}"
            echo ""
            echo "Please install Git manually."
            exit 1
            ;;
    esac

    echo -e "  ${GREEN}Git installed${NC}"
fi

GIT_VERSION=$(git --version | sed 's/git version //')
echo -e "  ${GREEN}Git $GIT_VERSION${NC}"

# Step 4: Check build tools
echo -e "${YELLOW}[4/7] Checking build tools...${NC}"

if ! check_build_tools; then
    install_build_tools
fi

echo -e "  ${GREEN}Build tools found${NC}"

# Step 5: Install dependencies
echo -e "${YELLOW}[5/7] Installing dependencies...${NC}"

# Try to install, capture errors
set +e
INSTALL_OUTPUT=$(pnpm install 2>&1)
INSTALL_EXIT_CODE=$?
set -e

# Check for native module compilation errors
if [ $INSTALL_EXIT_CODE -ne 0 ] || echo "$INSTALL_OUTPUT" | grep -q "gyp ERR!"; then
    echo ""
    echo -e "${YELLOW}Dependency installation failed (likely native module compilation).${NC}"
    echo ""

    # Re-check build tools
    if ! check_build_tools; then
        install_build_tools
    fi

    # Clean up and retry
    echo "Cleaning up and retrying..."
    rm -rf node_modules
    rm -f pnpm-lock.yaml

    pnpm install || {
        echo ""
        echo -e "${RED}Installation still failing.${NC}"
        echo ""
        echo "Please try:"
        echo -e "${GRAY}  1. Check the error messages above${NC}"
        echo -e "${GRAY}  2. Ensure you have gcc, g++, make, and python3 installed${NC}"
        echo -e "${GRAY}  3. On macOS, run: xcode-select --install${NC}"
        echo ""
        exit 1
    }
fi

echo -e "  ${GREEN}Dependencies installed${NC}"

# Step 6: Create config files
echo -e "${YELLOW}[6/7] Setting up configuration...${NC}"

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

# Step 7: Build the project
echo -e "${YELLOW}[7/7] Building project...${NC}"

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
