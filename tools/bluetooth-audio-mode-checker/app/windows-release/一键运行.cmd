@echo off
setlocal
cd /d "%~dp0"

set "APP_NODE=%~dp0runtime\node.exe"
set "APP_ENTRY=%~dp0app\index.ts"

if not exist "%APP_NODE%" (
  echo [START FAILED] Missing runtime\node.exe.
  echo Download the release package again and extract every file before running it.
  pause
  exit /b 1
)

if not exist "%APP_ENTRY%" (
  echo [START FAILED] Missing app\index.ts.
  echo Download the release package again and extract every file before running it.
  pause
  exit /b 1
)

echo Starting Bluetooth Audio Mode Checker...
echo Your browser will open automatically. Keep this window open while using the app.
echo.
"%APP_NODE%" "%APP_ENTRY%" %*
set "APP_EXIT_CODE=%ERRORLEVEL%"

if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo [APP STOPPED] Exit code: %APP_EXIT_CODE%
  echo Keep this window and the logs folder when reporting a problem.
  pause
)

exit /b %APP_EXIT_CODE%
