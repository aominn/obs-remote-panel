@echo off
setlocal

set "SCRIPT_PATH=%~dp0scripts\setup-tailscale-serve.ps1"
set "EXIT_CODE=1"

echo OBS Remote Panel - Windows initial setup
echo This setup is normally needed only once on each OBS PC.
echo.

if not exist "%SCRIPT_PATH%" (
    echo ERROR: The PowerShell setup script was not found.
    echo Expected path: "%SCRIPT_PATH%"
    set "EXIT_CODE=2"
    goto :finish
)

where /q powershell.exe
if errorlevel 1 (
    echo ERROR: Windows PowerShell was not found.
    set "EXIT_CODE=3"
    goto :finish
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_PATH%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
    echo SUCCESS: Initial setup completed.
    echo You do not need to run this file every time the PC starts.
) else (
    echo ERROR: Initial setup failed with exit code %EXIT_CODE%.
    echo Review the messages above, then try again.
)

:finish
echo.
echo Press any key to close this window.
pause >nul
endlocal & exit /b %EXIT_CODE%
