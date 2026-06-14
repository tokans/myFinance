@echo off
REM ============================================================================
REM  deploy.bat  -  Guided myFinance release.
REM
REM  Boots a Claude Code agent into the /deploy-release gate. The agent verifies
REM  every publish gate (see docs\release-checklist.md), walks you through the
REM  next remaining step, and only tags + pushes a release once ALL blocking
REM  gates pass and you confirm. The tag push fires .github/workflows/release.yml,
REM  which builds the installers and publishes them to tokans/myFinance.
REM
REM  Safe to run as often as you like: it re-checks from scratch every time and
REM  never deploys without your explicit "yes".
REM
REM  Usage:
REM     deploy.bat            (auto-detects the version from package.json)
REM     deploy.bat v0.2.0     (target a specific version)
REM
REM  Escape hatch: deploy-direct.bat tags + pushes WITHOUT the gate.
REM ============================================================================

setlocal
cd /d "%~dp0"

where claude >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Claude Code CLI not found on PATH.
  echo         Install it, then re-run deploy.bat - see https://claude.com/claude-code
  echo         Or run deploy-direct.bat to tag + push without the guided gate.
  pause
  exit /b 1
)

if "%~1"=="" (
  set "PROMPT=/deploy-release"
) else (
  set "PROMPT=/deploy-release %~1"
)

echo === Launching the guided release gate (/deploy-release) ===
echo     The agent checks every gate and walks you through what's left.
echo.
claude "%PROMPT%"

endlocal
