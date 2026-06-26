@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  MOMGAGYM CMS - GitHub Upload
echo ========================================
echo.
echo This uploads source files to GitHub.
echo Ignored folders such as node_modules, dist, assets, outputs are not uploaded.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Git is not installed or cannot be found.
  echo Install Git first, then run this file again.
  pause
  exit /b 1
)

echo [1/4] Checking changed files...
git status --short
echo.

echo [2/4] Preparing upload files...
git add -A

git diff --cached --quiet
if not errorlevel 1 (
  echo No changed files to upload.
  pause
  exit /b 0
)

echo.
set /p COMMIT_MSG=Write upload memo and press Enter: 
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Update CMS files

echo.
echo [3/4] Saving upload memo...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo.
  echo [ERROR] Commit failed. Check the message above.
  pause
  exit /b 1
)

echo.
echo [4/4] Uploading to GitHub main branch...
git push origin main
if errorlevel 1 (
  echo.
  echo [ERROR] GitHub upload failed. Check login, network, or permission.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Upload complete.
echo ========================================
pause
