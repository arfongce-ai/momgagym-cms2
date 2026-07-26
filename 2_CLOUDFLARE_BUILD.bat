@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  MOMGAGYM CMS - Cloudflare Build
echo ========================================
echo.
echo This creates the dist folder for Cloudflare Pages upload.
echo Do not upload dist to GitHub.
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npm is not installed or cannot be found.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/2] Installing packages...
  npm.cmd ci
  if errorlevel 1 (
    echo.
    echo [ERROR] Package install failed.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Packages already installed.
)

echo.
echo [2/2] Building dist folder...
npm.cmd run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. Check the message above.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Build complete. Upload this folder:
echo  %cd%\dist
echo ========================================
echo.
explorer "%cd%\dist"
pause
