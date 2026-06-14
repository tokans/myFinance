<#
.SYNOPSIS
  Launch the myFinance demo-capture rig. RUN THIS YOURSELF in a terminal — it
  opens a real app window and records the screen, so it needs an interactive
  desktop session (it won't work headless / inside an automation step).

.DESCRIPTION
  Verifies the required tools, force-builds the demo bundle (frontend with
  VITE_DEMO_MODE + debug Tauri binary), then records one or all scenarios to
  demo/output/ as MP4 + GIF.

.PARAMETER Scenario
  Scenario id to record (default: 01-basic-import). Ignored with -All.

.PARAMETER All
  Record every registered scenario.

.PARAMETER GifsOnly
  Re-encode existing MP4s to GIF without re-recording (skips build).

.PARAMETER NoBuild
  Skip the build step (use the existing dist/ + binary as-is).

.EXAMPLE
  .\demo\run-demo.ps1                      # build + record scenario 01
  .\demo\run-demo.ps1 -Scenario 01-basic-import
  .\demo\run-demo.ps1 -All
  .\demo\run-demo.ps1 -GifsOnly
#>
param(
  [string]$Scenario = "01-basic-import",
  [switch]$All,
  [switch]$GifsOnly,
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# Make freshly-installed tools resolvable even if this shell's PATH is stale.
$env:Path = $env:Path + ";" +
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links") + ";" +
  (Join-Path $env:USERPROFILE ".cargo\bin")

Write-Host "== myFinance demo rig ==" -ForegroundColor Cyan

# --- tool check ---------------------------------------------------------------
$missing = @()
foreach ($t in @("node", "cargo", "ffmpeg", "gifski", "tauri-driver")) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { $missing += $t }
}
$edgeDriver = Join-Path $PSScriptRoot ".bin\msedgedriver.exe"
if (-not (Test-Path $edgeDriver)) { $missing += "msedgedriver (demo/.bin/msedgedriver.exe)" }
if ($missing.Count -gt 0) {
  Write-Host "Missing prerequisites:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" }
  Write-Host "See DEMO.md for install instructions." -ForegroundColor Yellow
  exit 1
}

if ($GifsOnly) {
  Write-Host "Re-encoding existing MP4s to GIF..." -ForegroundColor Cyan
  npm run demo:gifs
  exit $LASTEXITCODE
}

# --- build --------------------------------------------------------------------
if (-not $NoBuild) {
  Write-Host "Building demo bundle (this can take a while on first run)..." -ForegroundColor Cyan
  npm run demo:build
  if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }
}

# --- record -------------------------------------------------------------------
Write-Host "Recording (a window will open — leave it focused)..." -ForegroundColor Cyan
if ($All) {
  npm run demo:all
} else {
  npm run demo:single -- $Scenario
}
$code = $LASTEXITCODE
if ($code -eq 0) {
  Write-Host "Done. Output in demo\output\" -ForegroundColor Green
} else {
  Write-Host "Recording failed (exit $code). See output above." -ForegroundColor Red
}
exit $code
