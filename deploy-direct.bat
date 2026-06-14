@echo off
REM ============================================================================
REM  deploy-direct.bat  -  UNGATED release trigger (escape hatch).
REM
REM  Tags the current commit and pushes the tag, firing release.yml directly,
REM  WITHOUT the guided publish-gate checks. Prefer deploy.bat, which runs the
REM  /deploy-release agent gate first. Use this only when you have already
REM  verified readiness another way.
REM
REM  Usage:
REM     deploy-direct.bat v0.1.0
REM     deploy-direct.bat              (prompts for the version)
REM ============================================================================

setlocal

set "VERSION=%~1"
if "%VERSION%"=="" set /p "VERSION=Enter release version (e.g. v0.1.0): "

if "%VERSION%"=="" (
  echo ERROR: No version provided.
  exit /b 1
)

REM Require a v-prefixed version so it matches the workflow's "v*" tag trigger.
echo %VERSION% | findstr /r "^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo ERROR: Version must look like v1.2.3  (got "%VERSION%"^).
  exit /b 1
)

REM Make sure we're inside the git repo.
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo ERROR: Not a git repository.
  exit /b 1
)

REM Warn on uncommitted changes - the tag points at the last commit, not them.
git diff --quiet
if errorlevel 1 (
  echo WARNING: You have uncommitted changes. The tag will point at the last
  echo          commit, NOT your working-tree changes.
  set /p "CONFIRM=Continue anyway? (y/N): "
  if /i not "%CONFIRM%"=="y" (
    echo Aborted.
    exit /b 1
  )
)

REM Refuse to clobber an existing tag.
git rev-parse "%VERSION%" >nul 2>&1
if not errorlevel 1 (
  echo ERROR: Tag %VERSION% already exists.
  exit /b 1
)

echo.
echo Tagging %VERSION% and pushing to origin...
git tag %VERSION%
if errorlevel 1 (
  echo ERROR: Failed to create tag.
  exit /b 1
)

git push origin %VERSION%
if errorlevel 1 (
  echo ERROR: Failed to push tag. Removing local tag.
  git tag -d %VERSION% >nul 2>&1
  exit /b 1
)

echo.
echo Done. Release %VERSION% is building.
echo Watch progress: https://github.com/anshumandas/myFinance/actions
echo Result lands at: https://github.com/tokans/myFinance/releases

endlocal
