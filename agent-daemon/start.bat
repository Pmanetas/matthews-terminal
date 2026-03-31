@echo off
title Matthews Terminal - Agent Daemon
cd /d "%~dp0"

:loop
node dist/index.js %*
if %ERRORLEVEL% EQU 75 (
    echo.
    echo [Daemon] Restarting with new code...
    echo.
    timeout /t 1 /nobreak >nul
    goto loop
)

echo.
echo [Daemon] Exited with code %ERRORLEVEL%
pause
