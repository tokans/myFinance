@echo off
REM ----------------------------------------------------------------------
REM  myFinance - one-double-click dev launcher.
REM  Boots the full Tauri shell (Rust + webview) with SQLite + Stronghold.
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

if not exist node_modules (
  echo === Installing JS deps (first run only) ===
  call npm install --no-audit --no-fund || ( pause & exit /b 1 )
)

echo === Starting Tauri dev (Rust shell + Vite on http://localhost:1420) ===
echo     Close the app window or press Ctrl+C here to stop.
echo.
call npm run tauri:dev
