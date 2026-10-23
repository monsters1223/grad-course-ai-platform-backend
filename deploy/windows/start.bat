@echo off
REM ============================================================
REM  GradAI platform - Windows native launcher
REM  Layout: <ROOT>\site\deploy\windows\start.bat
REM          <ROOT>\venv   <ROOT>\data   <ROOT>\logs
REM  Usage:  start.bat [port]     (default port 80)
REM ============================================================
chcp 65001 >nul

set "PORT=%~1"
if "%PORT%"=="" set "PORT=80"

for %%i in ("%~dp0..\..\..") do set "ROOT=%%~fi"
for %%i in ("%~dp0..\..\backend") do set "BACKEND=%%~fi"

if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%ROOT%\data" mkdir "%ROOT%\data"

cd /d "%BACKEND%"

echo [%date% %time%] starting uvicorn on 0.0.0.0:%PORT% >> "%ROOT%\logs\server.log"
"%ROOT%\venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port %PORT% >> "%ROOT%\logs\server.log" 2>&1
