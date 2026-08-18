@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM === Your repository (change here only if the repo moves) ===
set DEFAULT_REPO=https://github.com/arfongce-ai/momgagym-cms2.git

echo.
echo ========================================
echo  MOMGAGYM CMS - GitHub Upload
echo ========================================
echo.
echo This uploads source files to GitHub.
echo Ignored folders such as node_modules, dist, assets, outputs are not uploaded.
echo.

REM -- Check git is installed --
where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed or cannot be found.
  echo Install Git first, then run this file again.
  pause
  exit /b 1
)

REM -- Refuse to run in a copied/downloaded folder --
if not exist ".git" (
  echo [ERROR] This is not the official GitHub work folder.
  echo Do not upload from a copied or downloaded folder.
  echo Open this folder instead:
  echo   C:\Users\MOMGAGYM\Documents\GitHub\momgagym-cms2
  pause
  exit /b 1
)

REM -- Make sure a remote named origin exists --
git remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Linking this folder to your GitHub repository:
  echo   !DEFAULT_REPO!
  echo.
  echo Press Enter to use this address, or paste a different one.
  set /p REPO_URL=Repository address [Enter = default]: 
  if "!REPO_URL!"=="" set REPO_URL=!DEFAULT_REPO!
  git remote add origin "!REPO_URL!"
  echo Saved. You will not need to enter this again.
  echo.
)

REM -- Read the branch that actually contains the current work --
for /f "delims=" %%B in ('git branch --show-current') do set CURRENT_BRANCH=%%B
if "!CURRENT_BRANCH!"=="" (
  echo [ERROR] Git cannot determine the current branch.
  echo Open GitHub Desktop and select a branch first.
  pause
  exit /b 1
)

echo Current work branch: !CURRENT_BRANCH!
echo.

REM -- Stop before overwriting work when GitHub has newer commits --
echo Checking GitHub for newer files...
git fetch origin
if errorlevel 1 (
  echo [ERROR] Could not check GitHub. Check login and internet connection.
  pause
  exit /b 1
)

git rev-parse --verify "origin/!CURRENT_BRANCH!" >nul 2>nul
if not errorlevel 1 (
  git merge-base --is-ancestor "origin/!CURRENT_BRANCH!" HEAD
  if errorlevel 1 (
    echo [STOP] GitHub has other changes that are not in this folder.
    echo Open GitHub Desktop, press Pull origin, and run this file again.
    pause
    exit /b 1
  )
)

echo [1/4] Checking changed files...
git status --short
echo.

echo [2/4] Preparing upload files...
git add -A

REM -- Stop if there is nothing staged to commit --
REM git diff --cached --quiet exits 0 when there are NO changes.
git diff --cached --quiet && (
  echo No changed files to upload.
  pause
  exit /b 0
)

echo.
set /p COMMIT_MSG=Write upload memo and press Enter: 
if "!COMMIT_MSG!"=="" set COMMIT_MSG=Update CMS files

echo.
echo [3/4] Saving upload memo...
git commit -m "!COMMIT_MSG!"
if errorlevel 1 (
  echo.
  echo [ERROR] Commit failed. Check the message above.
  pause
  exit /b 1
)

echo.
echo [4/4] Uploading the current branch to GitHub...
REM First push: -u sets the upstream so later pushes are just 'git push'.
git push -u origin "!CURRENT_BRANCH!"
if errorlevel 1 (
  echo.
  echo [ERROR] GitHub upload failed.
  echo Possible causes: not logged in, no network, no permission,
  echo or the remote has newer commits ^(try pulling first^).
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Upload complete.
echo ========================================
pause
