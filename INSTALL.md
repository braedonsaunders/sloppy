# Installation Guide

This guide provides detailed installation instructions for all platforms.

## Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** 9.15.0 (will be installed by setup script)
- **Git** (for version control operations)
- An API key for one of: Claude (Anthropic), OpenAI, or Ollama (local)

---

## Quick Setup (Recommended)

### Windows (PowerShell)

```powershell
# Run the setup script
.\scripts\setup.ps1
```

### macOS / Linux

```bash
# Make the script executable and run it
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The setup scripts will:
1. Check for Node.js >= 22
2. Install pnpm if not present
3. Install all dependencies
4. Create `.env` file from template
5. Create `sloppy.config.json` from template
6. Build the project
7. Provide next steps

---

## Windows Manual Installation (Step-by-Step)

### Step 1: Install Node.js

1. Download Node.js **v22 or later** from [nodejs.org](https://nodejs.org/)
   - Choose the **LTS** version (must be 22+)
   - Or use the direct link: https://nodejs.org/en/download/

2. Run the installer:
   - Accept the license agreement
   - Use default installation path (or customize)
   - **Important**: Check "Automatically install necessary tools" if prompted

3. Verify installation - open **PowerShell** or **Command Prompt**:
   ```powershell
   node --version
   # Should output: v22.x.x or higher
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

### Step 6: Configure Environment Variables

1. Copy the example environment file:
   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` with your preferred editor:
   ```powershell
   notepad .env
   # Or use VS Code: code .env
   ```

3. Add your API key(s):
   ```env
   # Choose one (or multiple) AI providers:
   ANTHROPIC_API_KEY=sk-ant-...your-key-here...
   OPENAI_API_KEY=sk-...your-key-here...

   # Or for local Ollama:
   OLLAMA_HOST=http://localhost:11434
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

### Step 10: Open the UI

Open your browser to: **http://localhost:3000**

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

### Step 4: Configure and Run

```bash
# Edit .env with your API keys
nano .env  # or: code .env

# Build and start
pnpm build
pnpm start
```

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

### Step 4: Configure and Run

```bash
# Edit .env with your API keys
nano .env

# Build and start
pnpm build
pnpm start
```

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

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new key
5. Add to `.env` as `ANTHROPIC_API_KEY`

### OpenAI
1. Go to [platform.openai.com](https://platform.openai.com/)
2. Sign up or log in
3. Navigate to API Keys
4. Create a new secret key
5. Add to `.env` as `OPENAI_API_KEY`

### Ollama (Local/Free)
1. Install Ollama from [ollama.ai](https://ollama.ai/)
2. Pull a model: `ollama pull codellama`
3. Set in `.env`: `OLLAMA_HOST=http://localhost:11434`
4. Set `DEFAULT_PROVIDER=ollama` in `.env`
