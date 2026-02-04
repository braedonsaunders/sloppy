# Sloppy Setup Script for Windows
# Run this script in PowerShell to set up the development environment

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "       Sloppy Setup Script             " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running from the correct directory
if (-not (Test-Path "package.json")) {
    Write-Host "Error: Please run this script from the sloppy root directory" -ForegroundColor Red
    exit 1
}

# Function to check command exists
function Test-Command {
    param($Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# Function to compare versions
function Compare-Version {
    param(
        [string]$Current,
        [string]$Required
    )
    $currentParts = $Current -replace 'v', '' -split '\.'
    $requiredParts = $Required -split '\.'

    for ($i = 0; $i -lt $requiredParts.Count; $i++) {
        $c = [int]$currentParts[$i]
        $r = [int]$requiredParts[$i]
        if ($c -gt $r) { return $true }
        if ($c -lt $r) { return $false }
    }
    return $true
}

# Step 1: Check Node.js
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow

if (-not (Test-Command "node")) {
    Write-Host ""
    Write-Host "Node.js is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js v22 or later:" -ForegroundColor White
    Write-Host "  1. Download from: https://nodejs.org/" -ForegroundColor Gray
    Write-Host "  2. Choose the LTS version (must be 22+)" -ForegroundColor Gray
    Write-Host "  3. Run the installer" -ForegroundColor Gray
    Write-Host "  4. Restart your terminal" -ForegroundColor Gray
    Write-Host "  5. Run this script again" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$nodeVersion = (node --version) -replace 'v', ''
$requiredNode = "22.0.0"

if (-not (Compare-Version -Current $nodeVersion -Required $requiredNode)) {
    Write-Host ""
    Write-Host "Node.js version $nodeVersion is too old!" -ForegroundColor Red
    Write-Host "Required: v$requiredNode or later" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please upgrade Node.js:" -ForegroundColor White
    Write-Host "  Download from: https://nodejs.org/" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host "  Node.js v$nodeVersion" -ForegroundColor Green

# Step 2: Check/Install pnpm
Write-Host "[2/6] Checking pnpm..." -ForegroundColor Yellow

if (-not (Test-Command "pnpm")) {
    Write-Host "  pnpm not found, installing..." -ForegroundColor Yellow

    try {
        npm install -g pnpm@9.15.0
        Write-Host "  pnpm installed successfully" -ForegroundColor Green
    }
    catch {
        Write-Host ""
        Write-Host "Failed to install pnpm automatically." -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install pnpm manually:" -ForegroundColor White
        Write-Host "  npm install -g pnpm@9.15.0" -ForegroundColor Gray
        Write-Host ""
        Write-Host "If you get permission errors, try:" -ForegroundColor White
        Write-Host "  1. Run PowerShell as Administrator" -ForegroundColor Gray
        Write-Host "  2. Or use: corepack enable && corepack prepare pnpm@9.15.0 --activate" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
} else {
    $pnpmVersion = pnpm --version
    Write-Host "  pnpm v$pnpmVersion" -ForegroundColor Green
}

# Step 3: Check Git
Write-Host "[3/6] Checking Git..." -ForegroundColor Yellow

if (-not (Test-Command "git")) {
    Write-Host ""
    Write-Host "Git is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Git:" -ForegroundColor White
    Write-Host "  Download from: https://git-scm.com/download/win" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$gitVersion = (git --version) -replace 'git version ', ''
Write-Host "  Git $gitVersion" -ForegroundColor Green

# Step 4: Install dependencies
Write-Host "[4/6] Installing dependencies..." -ForegroundColor Yellow

try {
    pnpm install
    Write-Host "  Dependencies installed" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Failed to install dependencies." -ForegroundColor Red
    Write-Host ""
    Write-Host "Common fixes:" -ForegroundColor White
    Write-Host "  1. Delete node_modules and pnpm-lock.yaml, then retry" -ForegroundColor Gray
    Write-Host "  2. Run: npm install -g windows-build-tools (as Admin)" -ForegroundColor Gray
    Write-Host "  3. Install Visual Studio Build Tools" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

# Step 5: Create config files
Write-Host "[5/6] Setting up configuration..." -ForegroundColor Yellow

# Create .env if it doesn't exist
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "  Created .env from template" -ForegroundColor Green
    } else {
        # Create minimal .env
        @"
PORT=7749
HOST=0.0.0.0
NODE_ENV=development
DATABASE_PATH=./data/sloppy.db

# Add your API key (at least one required):
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# OLLAMA_HOST=http://localhost:11434

DEFAULT_PROVIDER=claude
LOG_LEVEL=info
"@ | Out-File -FilePath ".env" -Encoding utf8
        Write-Host "  Created .env file" -ForegroundColor Green
    }
} else {
    Write-Host "  .env already exists" -ForegroundColor Gray
}

# Create sloppy.config.json if it doesn't exist
if (-not (Test-Path "sloppy.config.json")) {
    if (Test-Path "sloppy.config.example.json") {
        Copy-Item "sloppy.config.example.json" "sloppy.config.json"
        Write-Host "  Created sloppy.config.json from template" -ForegroundColor Green
    }
} else {
    Write-Host "  sloppy.config.json already exists" -ForegroundColor Gray
}

# Step 6: Build the project
Write-Host "[6/6] Building project..." -ForegroundColor Yellow

try {
    pnpm build
    Write-Host "  Build complete" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "Build failed. Check the error messages above." -ForegroundColor Red
    exit 1
}

# Success!
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "       Setup Complete!                 " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Add your API key to .env:" -ForegroundColor Yellow
Write-Host "     notepad .env" -ForegroundColor Gray
Write-Host ""
Write-Host "     Add one of these:" -ForegroundColor Gray
Write-Host "       ANTHROPIC_API_KEY=sk-ant-..." -ForegroundColor Gray
Write-Host "       OPENAI_API_KEY=sk-..." -ForegroundColor Gray
Write-Host "       OLLAMA_HOST=http://localhost:11434" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Start Sloppy:" -ForegroundColor Yellow
Write-Host "     pnpm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  3. Open in browser:" -ForegroundColor Yellow
Write-Host "     http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "For development with hot-reload:" -ForegroundColor White
Write-Host "     pnpm dev" -ForegroundColor Cyan
Write-Host ""
