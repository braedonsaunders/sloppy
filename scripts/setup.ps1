# Sloppy Setup Script for Windows
# Run this script in PowerShell to set up the development environment

$ErrorActionPreference = "Continue"

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

# Function to parse version string to comparable array
function Get-VersionParts {
    param([string]$Version)
    $Version -replace 'v', '' -split '\.' | ForEach-Object { [int]$_ }
}

# Function to check if Visual Studio Build Tools are installed
function Test-BuildTools {
    # Check for VS Build Tools via vswhere
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($vsPath) {
            return $true
        }
    }

    # Alternative check: look for cl.exe in common locations
    $commonPaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe"
    )

    foreach ($path in $commonPaths) {
        if (Get-ChildItem -Path $path -ErrorAction SilentlyContinue) {
            return $true
        }
    }

    return $false
}

# Function to install Visual Studio Build Tools
function Install-BuildTools {
    Write-Host ""
    Write-Host "Visual Studio Build Tools are required to compile native modules." -ForegroundColor Yellow
    Write-Host ""

    # Check if winget is available
    if (Test-Command "winget") {
        Write-Host "Installing Visual Studio Build Tools via winget..." -ForegroundColor Yellow
        Write-Host "This may take several minutes and require ~6-8 GB of disk space." -ForegroundColor Gray
        Write-Host ""

        $process = Start-Process -FilePath "winget" -ArgumentList "install", "Microsoft.VisualStudio.2022.BuildTools", "--override", "`"--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended`"" -Wait -PassThru -NoNewWindow

        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq -1978335189) {
            Write-Host "  Visual Studio Build Tools installed successfully" -ForegroundColor Green
            Write-Host ""
            Write-Host "  IMPORTANT: Please restart PowerShell and run this script again." -ForegroundColor Yellow
            Write-Host ""
            exit 0
        } else {
            Write-Host "  Automatic installation failed (exit code: $($process.ExitCode))." -ForegroundColor Red
            Write-Host ""
        }
    }

    # Manual installation instructions
    Write-Host "Please install Visual Studio Build Tools manually:" -ForegroundColor White
    Write-Host ""
    Write-Host "  1. Download from: https://visualstudio.microsoft.com/visual-cpp-build-tools/" -ForegroundColor Gray
    Write-Host "  2. Run the installer" -ForegroundColor Gray
    Write-Host "  3. Select 'Desktop development with C++' workload" -ForegroundColor Gray
    Write-Host "  4. Click Install" -ForegroundColor Gray
    Write-Host "  5. Restart PowerShell and run this script again" -ForegroundColor Gray
    Write-Host ""

    # Offer to open the download page
    $response = Read-Host "Would you like to open the download page now? (y/n)"
    if ($response -eq 'y' -or $response -eq 'Y') {
        Start-Process "https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    }

    exit 1
}

# Step 1: Check Node.js
Write-Host "[1/7] Checking Node.js..." -ForegroundColor Yellow

if (-not (Test-Command "node")) {
    Write-Host ""
    Write-Host "Node.js is not installed!" -ForegroundColor Red
    Write-Host ""

    # Try to install via winget
    if (Test-Command "winget") {
        Write-Host "Installing Node.js v22 LTS via winget..." -ForegroundColor Yellow
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "  Node.js installed. Please restart PowerShell and run this script again." -ForegroundColor Yellow
            exit 0
        }
        Write-Host "  Automatic installation failed." -ForegroundColor Red
    }

    Write-Host "Please install Node.js v22 LTS:" -ForegroundColor White
    Write-Host "  1. Download from: https://nodejs.org/" -ForegroundColor Gray
    Write-Host "  2. Choose the LTS version (v22.x)" -ForegroundColor Gray
    Write-Host "  3. Run the installer" -ForegroundColor Gray
    Write-Host "  4. Restart your terminal" -ForegroundColor Gray
    Write-Host "  5. Run this script again" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$nodeVersionStr = (node --version) -replace 'v', ''
$nodeVersionParts = Get-VersionParts $nodeVersionStr
$nodeMajor = $nodeVersionParts[0]

# Check Node version - must be v22.x (v23+ and v24+ are too new, prebuild binaries don't exist)
if ($nodeMajor -lt 22) {
    Write-Host ""
    Write-Host "Node.js version $nodeVersionStr is too old!" -ForegroundColor Red
    Write-Host "Required: v22.x LTS" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please upgrade Node.js:" -ForegroundColor White
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Gray
    Write-Host "  Or download from: https://nodejs.org/" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

if ($nodeMajor -gt 22) {
    Write-Host ""
    Write-Host "Node.js version $nodeVersionStr is too new!" -ForegroundColor Red
    Write-Host "Native modules like better-sqlite3 don't have prebuilt binaries for v$nodeMajor yet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please install Node.js v22 LTS instead:" -ForegroundColor White
    Write-Host ""
    Write-Host "  # Uninstall current version" -ForegroundColor Gray
    Write-Host "  winget uninstall OpenJS.NodeJS" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # Install v22 LTS" -ForegroundColor Gray
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # Then restart PowerShell and run this script again" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

Write-Host "  Node.js v$nodeVersionStr" -ForegroundColor Green

# Step 2: Check/Install pnpm
Write-Host "[2/7] Checking pnpm..." -ForegroundColor Yellow

if (-not (Test-Command "pnpm")) {
    Write-Host "  pnpm not found, installing..." -ForegroundColor Yellow

    npm install -g pnpm@9.15.0
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Failed to install pnpm automatically." -ForegroundColor Red
        Write-Host ""
        Write-Host "Please install pnpm manually:" -ForegroundColor White
        Write-Host "  npm install -g pnpm@9.15.0" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
    Write-Host "  pnpm installed successfully" -ForegroundColor Green
} else {
    $pnpmVersion = pnpm --version
    Write-Host "  pnpm v$pnpmVersion" -ForegroundColor Green
}

# Step 3: Check Git
Write-Host "[3/7] Checking Git..." -ForegroundColor Yellow

if (-not (Test-Command "git")) {
    Write-Host ""
    Write-Host "Git is not installed!" -ForegroundColor Red
    Write-Host ""

    # Try to install via winget
    if (Test-Command "winget") {
        Write-Host "Installing Git via winget..." -ForegroundColor Yellow
        winget install Git.Git --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "  Git installed. Please restart PowerShell and run this script again." -ForegroundColor Yellow
            exit 0
        }
        Write-Host "  Automatic installation failed." -ForegroundColor Red
    }

    Write-Host "Please install Git:" -ForegroundColor White
    Write-Host "  Download from: https://git-scm.com/download/win" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$gitVersion = (git --version) -replace 'git version ', ''
Write-Host "  Git $gitVersion" -ForegroundColor Green

# Step 4: Check Visual Studio Build Tools
Write-Host "[4/7] Checking Visual Studio Build Tools..." -ForegroundColor Yellow

if (-not (Test-BuildTools)) {
    Install-BuildTools
}

Write-Host "  Build tools found" -ForegroundColor Green

# Step 5: Install dependencies
Write-Host "[5/7] Installing dependencies..." -ForegroundColor Yellow

# Clean up any previous failed installs
if (Test-Path "node_modules") {
    $betterSqlitePath = Get-ChildItem -Path "node_modules" -Recurse -Filter "better_sqlite3.node" -ErrorAction SilentlyContinue
    if (-not $betterSqlitePath) {
        Write-Host "  Cleaning up previous failed install..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
        Remove-Item "pnpm-lock.yaml" -ErrorAction SilentlyContinue
    }
}

# Run pnpm install and capture output
$installOutput = pnpm install 2>&1 | Out-String
$installExitCode = $LASTEXITCODE

# Check for failure
if ($installExitCode -ne 0 -or $installOutput -match "gyp ERR!" -or $installOutput -match "ELIFECYCLE") {
    Write-Host ""
    Write-Host "Dependency installation failed!" -ForegroundColor Red
    Write-Host ""

    # Check if it's a node-gyp/native module issue
    if ($installOutput -match "gyp ERR!" -or $installOutput -match "better-sqlite3") {
        Write-Host "Native module compilation failed. Checking build tools..." -ForegroundColor Yellow

        if (-not (Test-BuildTools)) {
            Install-BuildTools
        }

        Write-Host ""
        Write-Host "Build tools are installed. Cleaning up and retrying..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
        Remove-Item "pnpm-lock.yaml" -ErrorAction SilentlyContinue

        $retryOutput = pnpm install 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0 -or $retryOutput -match "gyp ERR!") {
            Write-Host ""
            Write-Host "Installation still failing." -ForegroundColor Red
            Write-Host ""
            Write-Host "Please try:" -ForegroundColor White
            Write-Host "  1. Ensure you're using Node.js v22 LTS (not v23 or v24)" -ForegroundColor Gray
            Write-Host "  2. Restart PowerShell to pick up new environment variables" -ForegroundColor Gray
            Write-Host "  3. Run this script again" -ForegroundColor Gray
            Write-Host ""
            exit 1
        }
    } else {
        Write-Host "Please check the error messages above and try again." -ForegroundColor Gray
        exit 1
    }
}

Write-Host "  Dependencies installed" -ForegroundColor Green

# Step 6: Create config files
Write-Host "[6/7] Setting up configuration..." -ForegroundColor Yellow

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

# Step 7: Build the project
Write-Host "[7/7] Building project..." -ForegroundColor Yellow

$buildOutput = pnpm build 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Build failed!" -ForegroundColor Red
    Write-Host ""

    if ($buildOutput -match "turbo.*not recognized" -or $buildOutput -match "not found") {
        Write-Host "Turbo is not installed. This usually means pnpm install failed." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Please try:" -ForegroundColor White
        Write-Host "  1. Delete node_modules folder" -ForegroundColor Gray
        Write-Host "  2. Run: pnpm install" -ForegroundColor Gray
        Write-Host "  3. Run: pnpm build" -ForegroundColor Gray
    } else {
        Write-Host "Check the error messages above." -ForegroundColor Gray
    }
    Write-Host ""
    exit 1
}

Write-Host "  Build complete" -ForegroundColor Green

# Success!
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "       Setup Complete!                 " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Start Sloppy:" -ForegroundColor Yellow
Write-Host "     pnpm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  2. Open in browser:" -ForegroundColor Yellow
Write-Host "     http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "  3. Configure your AI provider:" -ForegroundColor Yellow
Write-Host "     Go to Settings and add your API key" -ForegroundColor Gray
Write-Host ""
Write-Host "For development with hot-reload:" -ForegroundColor White
Write-Host "     pnpm dev" -ForegroundColor Cyan
Write-Host ""
