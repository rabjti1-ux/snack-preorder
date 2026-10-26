@echo off
chcp 65001 >nul
title 零食预订
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先到 https://nodejs.org 下载安装 LTS 版本（22.13 或更高），装好后再双击本文件。
  pause
  exit /b 1
)
echo 正在启动……关闭这个窗口就会停止服务。
node server\server.js
pause
