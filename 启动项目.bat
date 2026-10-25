@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\vite\package.json (
  echo 正在安装项目依赖...
  call npm.cmd ci --registry=https://registry.npmmirror.com --cache .npm-cache --no-audit --no-fund
  if errorlevel 1 (pause & exit /b 1)
)
if not exist public\models\pose_landmarker_lite.task (
  call npm.cmd run prepare:assets
  if errorlevel 1 (pause & exit /b 1)
)
echo.
echo 正在启动 PinEase。请打开终端显示的 Local 地址。
echo 关闭此窗口将停止服务。
echo.
call npm.cmd run dev -- --host 127.0.0.1
pause

