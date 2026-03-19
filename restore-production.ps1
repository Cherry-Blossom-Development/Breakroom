<#
.SYNOPSIS
    Restores the local development environment after web testing.

.DESCRIPTION
    Stops the Breakroom test containers and optionally starts the local dev
    environment so you can resume normal development.

    Local dev runs on https://local.prosaurus.com (ports 443/3000).
    Test containers run on https://test.prosaurus.com:8443 (ports 8443/3001).
    The two stacks use different ports and do not conflict, but stopping the
    test containers frees up resources when testing is done.

.PARAMETER StopContainers
    Stop the test Docker containers. Omit this flag if you want to leave
    the test environment running (e.g. to run tests again shortly).

.PARAMETER StartLocalDev
    After stopping test containers, start the local dev environment
    (docker-compose.local.yml). Use this to resume development immediately.

.EXAMPLE
    .\restore-production.ps1
    .\restore-production.ps1 -StopContainers
    .\restore-production.ps1 -StopContainers -StartLocalDev
#>
param(
    [switch]$StopContainers,
    [switch]$StartLocalDev
)

$ErrorActionPreference = 'Stop'

# --- Paths ---
$BreakroomDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- Output helpers ---
function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "--- $msg ---" -ForegroundColor Cyan
}
function Write-OK([string]$msg)   { Write-Host "  [ OK ]  $msg" -ForegroundColor Green  }
function Write-Info([string]$msg) { Write-Host "  [ .. ]  $msg" -ForegroundColor Yellow }
function Write-Fail([string]$msg) { Write-Host "  [FAIL]  $msg" -ForegroundColor Red    }

# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "   Restore Local Development Environment  " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- 1. Test containers ---
Write-Step "1/2  Test containers"

if ($StopContainers) {
    Write-Info "Stopping test containers..."
    Push-Location $BreakroomDir
    docker compose -f docker-compose.test.yml down
    $dcExit = $LASTEXITCODE
    Pop-Location
    if ($dcExit -eq 0) {
        Write-OK "Test containers stopped"
    } else {
        Write-Info "docker compose down returned $dcExit - containers may already be stopped"
    }
} else {
    $testUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 8443 `
                                 -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($testUp) {
        Write-Info "Test containers are still running on port 8443 (pass -StopContainers to stop them)"
    } else {
        Write-OK "Test containers are not running"
    }
}

# --- 2. Local dev environment ---
Write-Step "2/2  Local dev environment"

if ($StartLocalDev) {
    $localUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 443 `
                                  -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($localUp) {
        Write-OK "Local dev already running on port 443"
    } else {
        Write-Info "Starting local dev containers..."
        Push-Location $BreakroomDir
        docker compose -f docker-compose.local.yml --env-file .env.local up -d
        $localExit = $LASTEXITCODE
        Pop-Location
        if ($localExit -ne 0) {
            Write-Fail "Failed to start local dev containers (exit $localExit)"
            exit 1
        }
        Write-OK "Local dev started at https://local.prosaurus.com"
    }
} else {
    $localUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 443 `
                                  -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($localUp) {
        Write-OK "Local dev already running at https://local.prosaurus.com"
    } else {
        Write-Info "Local dev is not running (pass -StartLocalDev to start it)"
    }
}

# --- Done ---
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Done" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
