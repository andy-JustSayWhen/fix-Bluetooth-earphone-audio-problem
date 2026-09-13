@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer.
  pause
  exit /b 1
)
node.exe app/index.ts %*
if errorlevel 1 pause
