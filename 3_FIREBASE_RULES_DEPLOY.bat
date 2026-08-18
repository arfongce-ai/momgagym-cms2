@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo  MOMGAGYM CMS - Firebase Rules Deploy
echo ========================================
echo.
echo Cloudflare upload does not update Firestore permissions.
echo This command publishes firestore.rules to momgagym-cms.
echo.

where npx.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js / npx is not installed or cannot be found.
  pause
  exit /b 1
)

npx.cmd firebase-tools deploy --only firestore:rules --project momgagym-cms
if errorlevel 1 (
  echo.
  echo [ERROR] Rules deployment failed.
  echo If login is requested, run: npx.cmd firebase-tools login
  pause
  exit /b 1
)

echo.
echo Firestore rules deployment complete.
pause
