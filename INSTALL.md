# Installation Guide

This guide provides detailed installation instructions for all platforms.

## Prerequisites

- **Node.js v22 LTS or later** (v22+ required)
- **pnpm** 9.15.0 (will be installed by setup script)
- **Git** (for version control operations)
- **Build tools** (Visual Studio Build Tools on Windows, Xcode CLI on macOS, build-essential on Linux)
- An API key for one of: Claude (Anthropic), OpenAI, or Ollama (local)

---

## Quick Setup (Recommended)

The setup scripts automatically install all dependencies and handle platform-specific requirements.

### Windows (PowerShell)

```powershell
.\scripts\setup.ps1
```

### macOS / Linux

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

### What the scripts do

| Step | Windows | macOS | Linux |
|------|---------|-------|-------|
| 1. Node.js v22 | Auto-install via winget | Auto-install via Homebrew | Auto-install via package manager |
| 2. pnpm | Auto-install via npm | Auto-install via npm | Auto-install via npm |
| 3. Git | Auto-install via winget | Auto-install via Homebrew/Xcode | Auto-install via package manager |
| 4. Build tools | Auto-install VS Build Tools | Auto-install Xcode CLI | Auto-install build-essential |
| 5. Dependencies | `pnpm install` | `pnpm install` | `pnpm install` |
| 6. Configuration | Create `.env` and config files | Create `.env` and config files | Create `.env` and config files |
| 7. Build | `pnpm build` | `pnpm build` | `pnpm build` |

The scripts will detect failures and provide helpful error messages with solutions.

---

## Windows Manual Installation (Step-by-Step)

### Step 1: Install Node.js LTS

**Option A: Using winget (recommended)**
```powershell
winget install OpenJS.NodeJS.LTS
```

**Option B: Manual download**
1. Download Node.js **LTS** from [nodejs.org](https://nodejs.org/)
2. Run the installer
3. **Important**: Check "Automatically install necessary tools" if prompted

**Verify installation:**
```powershell
node --version
# Should output: v22.x.x or later
```

### Step 2: Install pnpm

Open PowerShell **as Administrator** and run:

```powershell
# Install pnpm globally using npm
npm install -g pnpm@9.15.0

# Verify installation
pnpm --version
# Should output: 9.15.0
```

**Alternative methods:**

```powershell
# Using Corepack (built into Node.js)
corepack enable
corepack prepare pnpm@9.15.0 --activate

# Or using winget
winget install pnpm.pnpm

# Or using Scoop
scoop install pnpm
```

### Step 3: Install Git (if not already installed)

1. Download Git from [git-scm.com](https://git-scm.com/download/win)
2. Run the installer with default options
3. Verify:
   ```powershell
   git --version
   ```

### Step 4: Clone the Repository

```powershell
git clone https://github.com/braedonsaunders/sloppy.git
cd sloppy
```

### Step 5: Install Dependencies

```powershell
pnpm install
```

This installs all packages across the monorepo workspaces.

### Step 6: Configure Environment (Optional)

1. Copy the example environment file:
   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` if you need to change defaults (port, database path, etc.):
   ```powershell
   notepad .env
   ```

### Step 7: Configure Sloppy (Optional)

```powershell
Copy-Item sloppy.config.example.json sloppy.config.json
notepad sloppy.config.json
```

Customize settings like strictness level, which analyzers to run, etc.

### Step 8: Build the Project

```powershell
pnpm build
```

### Step 9: Start Sloppy

```powershell
# Production mode
pnpm start

# Or development mode (with hot reload)
pnpm dev
```

### Step 10: Configure AI Provider

1. Open your browser to: **http://localhost:3000**
2. Go to **Settings** (gear icon)
3. Select your AI provider (Claude, OpenAI, etc.)
4. Enter your API key
5. Click **Test Connection** to verify

---

## macOS Manual Installation

### Step 1: Install Node.js

Using Homebrew (recommended):
```bash
brew install node@22
```

Or download from [nodejs.org](https://nodejs.org/).

### Step 2: Install pnpm

```bash
# Using npm
npm install -g pnpm@9.15.0

# Or using Homebrew
brew install pnpm

# Or using Corepack
corepack enable
corepack prepare pnpm@9.15.0 --activate
```

### Step 3: Clone and Setup

```bash
git clone https://github.com/braedonsaunders/sloppy.git
cd sloppy
pnpm install
cp .env.example .env
cp sloppy.config.example.json sloppy.config.json
```

### Step 4: Build and Run

```bash
pnpm build
pnpm start
```

### Step 5: Configure AI Provider

1. Open **http://localhost:3000**
2. Go to **Settings** and configure your AI provider with your API key

---

## Linux Manual Installation

### Step 1: Install Node.js 22+

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora:**
```bash
sudo dnf install nodejs
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm
```

**Using nvm (any distro):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
```

### Step 2: Install pnpm

```bash
npm install -g pnpm@9.15.0
```

### Step 3: Clone and Setup

```bash
git clone https://github.com/braedonsaunders/sloppy.git
cd sloppy
pnpm install
cp .env.example .env
cp sloppy.config.example.json sloppy.config.json
```

### Step 4: Build and Run

```bash
pnpm build
pnpm start
```

### Step 5: Configure AI Provider

1. Open **http://localhost:3000**
2. Go to **Settings** and configure your AI provider with your API key

---

## Troubleshooting

### Windows: "pnpm is not recognized"

After installing pnpm, you may need to restart your terminal or add pnpm to your PATH:

```powershell
# Check if pnpm is in PATH
$env:PATH -split ';' | Where-Object { $_ -like '*pnpm*' }

# Add to PATH if missing (run as Administrator)
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\pnpm", "User")
```

Then restart your terminal.

### Windows: "node-gyp" build errors

Some native modules (like `better-sqlite3`) require build tools:

```powershell
# Install Windows Build Tools (run as Administrator)
npm install -g windows-build-tools

# Or install Visual Studio Build Tools manually from:
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

### Windows: PowerShell script execution policy

If you get "scripts are disabled" error:

```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Port already in use

If ports 5173 or 7749 are busy:

```powershell
# Windows - find and kill process on port
netstat -ano | findstr :7749
taskkill /PID <PID> /F

# Or use the built-in script
node scripts/kill-ports.js
```

```bash
# macOS/Linux
lsof -i :7749
kill -9 <PID>

# Or use the built-in script
node scripts/kill-ports.js
```

### Database errors

If you encounter SQLite errors:

```bash
# Remove the database and let it recreate
rm -rf data/sloppy.db
pnpm start
```

---

## Development Commands

```bash
pnpm dev        # Start development servers (frontend + backend)
pnpm build      # Build all packages
pnpm test       # Run tests
pnpm typecheck  # TypeScript type checking
pnpm lint       # Run ESLint
```

---

## Getting API Keys

API keys are configured through the Sloppy UI (Settings page), not in environment variables.

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Paste it in Sloppy's Settings page

### OpenAI
1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new secret key
5. Paste it in Sloppy's Settings page

### Ollama (Local/Free)
1. Install Ollama from [ollama.ai](https://ollama.ai/)
2. Pull a model: `ollama pull codellama`
3. In Sloppy's Settings, select Ollama and set the host (default: `http://localhost:11434`)
