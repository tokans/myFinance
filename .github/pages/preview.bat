@echo off
REM ----------------------------------------------------------------------
REM  Preview the GitHub Pages landing-page template locally.
REM
REM  Edit index.template.html, then double-click this file. It fills the
REM  __PLACEHOLDERS__ with sample values, drops a sample release-notes.md
REM  beside it, and serves the result over HTTP at http://localhost:8000/
REM  (a server is required because the page fetch()es release-notes.md,
REM  which does NOT work from a file:// URL).
REM
REM  Output goes to .github/pages/.preview/ (git-ignored). Ctrl+C to stop.
REM ----------------------------------------------------------------------
setlocal
cd /d "%~dp0"

REM Optional first arg = preferred port (default 8000). The server falls back to
REM another free port automatically if it is taken or blocked by Windows.
set "PORT=%~1"

set "OUT=.preview"
if not exist "%OUT%" mkdir "%OUT%"

REM Sample values for local preview only. The real values are injected by the
REM release workflow (.github/workflows/release.yml) at publish time.
set "VERSION=v0.0.0-preview"
set "REPO=tokans/myFinance"
set "RELEASE_URL=https://github.com/tokans/myFinance/releases/tag/v0.0.0-preview"
set "LATEST_URL=https://github.com/tokans/myFinance/releases/latest"

echo === Rendering template with sample values ===
REM Read/write as UTF-8 explicitly via .NET. Windows PowerShell 5.1's
REM Get-Content/Set-Content would otherwise read this no-BOM UTF-8 file as
REM ANSI and mojibake every emoji (the chart icon would render as garbled text).
powershell -NoProfile -Command "$t=[IO.File]::ReadAllText('%~dp0index.template.html',[Text.Encoding]::UTF8).Replace('__VERSION__','%VERSION%').Replace('__REPO__','%REPO%').Replace('__RELEASE_URL__','%RELEASE_URL%').Replace('__LATEST_URL__','%LATEST_URL%'); [IO.File]::WriteAllText('%~dp0%OUT%\index.html',$t,(New-Object Text.UTF8Encoding($false)))"
if errorlevel 1 ( echo [ERROR] Failed to render template. & pause & exit /b 1 )

copy /y sample-release-notes.md "%OUT%\release-notes.md" >nul

REM Copy tracked page assets (e.g. the demo video assets\demo.mp4) into the
REM preview so the "See it in action" section plays locally.
if exist assets (
  if not exist "%OUT%\assets" mkdir "%OUT%\assets"
  copy /y "assets\*" "%OUT%\assets\" >nul 2>nul
)

echo.
echo === Starting local preview server (Ctrl+C to stop) ===
echo   It auto-picks a free port and opens your browser.
echo.

REM serve.py binds to loopback and falls back to a free port, sidestepping the
REM Windows WinError 10013 you get when a fixed port is reserved/blocked.
where python >nul 2>nul && ( python serve.py "%OUT%" %PORT% & goto :eof )
where py     >nul 2>nul && ( py serve.py "%OUT%" %PORT% & goto :eof )
echo [INFO] Python not found; falling back to "npx serve".
cd "%OUT%"
npx --yes serve
