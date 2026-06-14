<#
.SYNOPSIS
  One-command demo VIDEO maker: (re)record fresh screens, then edit them into a
  finished marketing and/or tutorial video. RUN THIS YOURSELF in a terminal —
  recording opens a real app window and screen-records it, so it needs an
  interactive desktop session.

.DESCRIPTION
  Verifies tools, force-builds the demo bundle, records the scenarios the chosen
  video needs, then composes the finished video(s) into demo/output/video/:

    - marketing : records the 16 feature clips → 60s montage  (marketing.mp4)
    - tutorial  : records the single-take full tour          (tutorial.mp4)
    - both      : records everything and renders both

  Use -NoRecord to re-edit existing recordings (fast: skips build + record), or
  -NoBuild to record with the current build.

.PARAMETER Video
  Which video to make: marketing (default), tutorial, or both.

.PARAMETER NoRecord
  Skip build + recording; just re-compose the video from existing MP4s.

.PARAMETER NoBuild
  Skip the build step (record with the existing dist/ + binary).

.EXAMPLE
  .\demo\make-video.ps1                      # fresh record + 60s marketing video
  .\demo\make-video.ps1 -Video tutorial      # fresh record + full tutorial video
  .\demo\make-video.ps1 -Video both          # both, one go
  .\demo\make-video.ps1 -NoRecord            # re-edit marketing from existing clips
#>
param(
  [ValidateSet("marketing", "tutorial", "both")]
  [string]$Video = "marketing",
  [switch]$NoRecord,
  [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# Make freshly-installed tools resolvable even if this shell's PATH is stale.
$env:Path = $env:Path + ";" +
  (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links") + ";" +
  (Join-Path $env:USERPROFILE ".cargo\bin")

function Invoke-Step($desc, $script) {
  Write-Host "→ $desc" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) { Write-Host "✖ $desc failed (exit $LASTEXITCODE)." -ForegroundColor Red; exit 1 }
}

Write-Host "== myFinance video maker ($Video) ==" -ForegroundColor Cyan

$wantMarketing = $Video -eq "marketing" -or $Video -eq "both"
$wantTutorial  = $Video -eq "tutorial"  -or $Video -eq "both"

# --- tool check ---------------------------------------------------------------
# ffmpeg is always needed (editing); the rest only when actually recording.
$needTools = @("node", "ffmpeg")
if (-not $NoRecord) { $needTools += @("cargo", "gifski", "tauri-driver") }
$missing = @()
foreach ($t in $needTools) {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { $missing += $t }
}
if (-not $NoRecord) {
  $edgeDriver = Join-Path $PSScriptRoot ".bin\msedgedriver.exe"
  if (-not (Test-Path $edgeDriver)) { $missing += "msedgedriver (demo/.bin/msedgedriver.exe)" }
}
if ($missing.Count -gt 0) {
  Write-Host "Missing prerequisites:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  - $_" }
  Write-Host "See DEMO.md for install instructions." -ForegroundColor Yellow
  exit 1
}

# --- build + record -----------------------------------------------------------
if (-not $NoRecord) {
  if (-not $NoBuild) {
    Invoke-Step "Building demo bundle (slow on first run)" { npm run demo:build }
  }
  Write-Host "A window will open and record — leave it focused and don't move the mouse." -ForegroundColor Yellow
  if ($wantMarketing) {
    Invoke-Step "Recording the 16 feature clips" { npm run demo:all }
  }
  if ($wantTutorial) {
    Invoke-Step "Recording the full tutorial (single take)" { npm run demo:single -- 20-full-tutorial }
  }
} else {
  Write-Host "Skipping build + record (-NoRecord): re-editing existing clips." -ForegroundColor DarkGray
}

# --- compose video(s) ---------------------------------------------------------
if ($wantMarketing) { Invoke-Step "Editing the marketing video" { npm run demo:video:marketing } }
if ($wantTutorial)  { Invoke-Step "Editing the tutorial video"  { npm run demo:video:tutorial } }

# --- done ---------------------------------------------------------------------
$outDir = Join-Path $PSScriptRoot "output\video"
Write-Host ""
Write-Host "✔ Done. Videos in demo\output\video\" -ForegroundColor Green
if ($wantMarketing) { Write-Host "   marketing.mp4" -ForegroundColor Green }
if ($wantTutorial)  { Write-Host "   tutorial.mp4"  -ForegroundColor Green }
Write-Host ""
Write-Host "Music: drop your own track to change the score, then re-run with -NoRecord:" -ForegroundColor DarkGray
Write-Host "   demo\assets\music\marketing.mp3   (upbeat, for the montage)" -ForegroundColor DarkGray
Write-Host "   demo\assets\music\tutorial.mp3    (calm, for the tutorial)" -ForegroundColor DarkGray

if (Test-Path $outDir) { Invoke-Item $outDir }
