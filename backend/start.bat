@echo off
chcp 65001 >nul 2>&1
cd /d "C:\Users\yitong.deng\Desktop\大创\site\backend"

echo 正在清理可能占用 8000 端口的旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 >nul

echo 正在启动 研究生通识课AI教育平台...
echo 启动成功后，请勿关闭此窗口，浏览器访问 http://localhost:8000
echo 账号：student01 / 123456
echo.
"C:\Users\yitong.deng\.workbuddy\binaries\python\envs\default\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
