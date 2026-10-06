@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title ResearchHub

echo.
echo ========================================
echo        ResearchHub
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install Node.js 22.19 or newer, then run this file again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Reinstall Node.js with npm enabled, then run this file again.
  pause
  exit /b 1
)

if not exist "%~dp0package.json" (
  echo [ERROR] package.json was not found.
  echo This file must remain in the ResearchHub project root.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo Dependencies are not installed. Running npm install...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Building the frontend and starting the local Runtime...
echo Keep this window open while using ResearchHub.
echo The Runtime will open the browser after startup and print its URL below.
echo.
set "RESEARCHHUB_OPEN_BROWSER=1"
call npm run researchhub
set "EXIT_CODE=%ERRORLEVEL%"
set "RESEARCHHUB_OPEN_BROWSER="

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] ResearchHub stopped with exit code %EXIT_CODE%.
  pause
)

endlocal & exit /b %EXIT_CODE%
