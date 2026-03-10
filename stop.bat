@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cls

echo.
echo  ================================================================
echo    拼豆库存管理系统 - 停止脚本
echo  ================================================================
echo.

REM 停止后端服务 (端口 5000)
echo [1/2] 正在停止后端服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000') do (
    taskkill /pid %%a /f >nul 2>&1
)
if %errorlevel% equ 0 (
    echo [完成] 后端服务已停止
) else (
    echo [提示] 后端服务可能已停止或未运行
)

REM 停止前端服务 (端口 3000)
echo [2/2] 正在停止前端服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    taskkill /pid %%a /f >nul 2>&1
)
if %errorlevel% equ 0 (
    echo [完成] 前端服务已停止
) else (
    echo [提示] 前端服务可能已停止或未运行
)

REM 清理 PID 文件
if exist "backend.pid" del "backend.pid" >nul 2>&1
if exist "frontend.pid" del "frontend.pid" >nul 2>&1

echo.
echo  ================================================================
echo    所有服务已停止
echo  ================================================================
echo.
pause
