@echo off
REM ----------------------------------------------------------------------
REM  myFinance — one-double-click build script.
REM  Produces a Windows installer .exe under src-tauri\target\release\bundle\.
REM  Prerequisites (one-time): Node.js, Rust toolchain (rustup), WebView2 runtime.
REM ----------------------------------------------------------------------

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM Make sure cargo is on PATH for this session.
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where cargo >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Rust is not installed. Install once via: winget install Rustlang.Rustup
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install once via: winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)

echo === Installing JS deps (skipped if already present) ===
if not exist node_modules ( call npm install --no-audit --no-fund || exit /b 1 )

echo === Building Windows installer (this takes a few minutes the first time) ===
call npm run tauri:build || exit /b 1

echo.
echo ====================================================================
echo  Done. Your installer is at:
echo    src-tauri\target\release\bundle\nsis\
echo  Double-click the *-setup.exe file to install myFinance.
echo ====================================================================
echo.
pause
