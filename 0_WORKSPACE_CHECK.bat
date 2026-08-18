@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo  MOMGAGYM CMS - Work Folder Check
echo ========================================
echo.

if not exist ".git" (
  echo [FAIL] This is a copied folder, not the official work folder.
  echo.
  echo Codex and Claude must both open this exact folder:
  echo C:\Users\MOMGAGYM\Documents\GitHub\momgagym-cms2
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set CURRENT_BRANCH=%%B

echo [OK] Official GitHub work folder
echo Folder : %CD%
echo Branch : !CURRENT_BRANCH!
echo.
echo Changed files:
git status --short
echo.
echo Before starting work, open GitHub Desktop and click Fetch origin.
echo If Pull origin appears, click it before editing files.
echo.
pause
