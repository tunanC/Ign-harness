<#
.SYNOPSIS
    Windows platform deployment script
.DESCRIPTION
    Initializes runtime environment in user-specified install directory.
    Calls deploy/deploy.py for common cross-platform logic.
    Dev:  .\deploy\windows\deploy.ps1 -DataDir "E:\...\runtime"
    Prod: .\deploy\windows\deploy.ps1 -DataDir "D:\CapabilityPlatform" -Version "0.1.0"
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$DataDir,
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " Capability Platform - Windows deploy" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "DataDir : $DataDir"
Write-Host "Version : $Version"
Write-Host ""

# 1. Validate target path
$resolved = Resolve-Path $DataDir -ErrorAction SilentlyContinue
if (-not $resolved) {
    Write-Host "Creating directory: $DataDir"
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $resolved = Resolve-Path $DataDir
}
$target = $resolved.Path
Write-Host "[OK] Target: $target"

# 2. Find Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python 3.10+ required" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Python found"

# 3. Run common deploy logic
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = (Resolve-Path (Join-Path (Join-Path $scriptDir "..") "..")).Path
Push-Location $rootDir

Write-Host ""
Write-Host "Deploying..." -ForegroundColor Yellow

python deploy/deploy.py --data-dir $target --version $Version

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] deploy.py failed (exit=$LASTEXITCODE)" -ForegroundColor Red
    Pop-Location
    exit $LASTEXITCODE
}

Pop-Location

# 4. Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Deploy successful!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Config : $target\data\platform.yaml" -ForegroundColor White
Write-Host "Start  : python backend\server.py --data-dir '$target'" -ForegroundColor White
Write-Host ""
