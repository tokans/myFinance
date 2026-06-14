@echo off
REM ============================================================================
REM  publish-masters.bat  -  Publish an over-the-air master-data update.
REM
REM  Because signing is OFFLINE (the private key lives on this machine, never in
REM  CI), masters are packed, signed, and uploaded from here -- not by GitHub
REM  Actions. This script runs the full local pipeline:
REM     pack -> sign -> upload encrypted bundle to the 'masters-latest' release
REM             on tokans/myFinance.
REM
REM  Usage:
REM     publish-masters.bat 3                 (revision 3, min-app-version 0.1.0)
REM     publish-masters.bat 3 0.2.0           (revision 3, min-app-version 0.2.0)
REM
REM  Requires: .keys/ present (run `npm run masters:keys` once), and `gh` logged
REM  in to an account with write access to tokans/myFinance.
REM ============================================================================

setlocal

set "REPO=tokans/myFinance"
set "TAG=masters-latest"
set "REVISION=%~1"
set "MINVER=%~2"
if "%MINVER%"=="" set "MINVER=0.1.0"

if "%REVISION%"=="" (
  echo ERROR: Provide a monotonic revision number, e.g. publish-masters.bat 3
  exit /b 1
)

REM Call tsx directly (not `npm run -- ...`) so flag parsing is shell-independent.
echo Packing masters (revision %REVISION%, min-app-version %MINVER%)...
call npx tsx scripts/pack-masters.ts --revision %REVISION% --min-app-version %MINVER%
if errorlevel 1 ( echo ERROR: pack failed. & exit /b 1 )

echo Signing manifest...
call npx tsx scripts/sign-masters.ts
if errorlevel 1 ( echo ERROR: sign failed. & exit /b 1 )

echo Uploading bundle to %REPO% (%TAG%)...
REM Create the rolling release once; thereafter just clobber its assets.
gh release view %TAG% --repo %REPO% >nul 2>&1
if errorlevel 1 (
  gh release create %TAG% --repo %REPO% --title "Master data" ^
    --notes "Rolling over-the-air reference-data bundle. Updated automatically." ^
    dist-masters/masters.manifest.json dist-masters/masters.manifest.json.sig dist-masters/*.master.enc
) else (
  gh release upload %TAG% --repo %REPO% --clobber ^
    dist-masters/masters.manifest.json dist-masters/masters.manifest.json.sig dist-masters/*.master.enc
)
if errorlevel 1 ( echo ERROR: upload failed. & exit /b 1 )

echo.
echo Done. Master revision %REVISION% published to:
echo   https://github.com/%REPO%/releases/tag/%TAG%

endlocal
