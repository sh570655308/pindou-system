@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cls

echo.
echo  ================================================================
echo    拼豆库存管理系统 - 启动脚本
echo  ================================================================
echo.
echo  [提示] 此脚本需要 Node.js 环境
echo  [提示] 关闭此窗口后进程将继续在后台运行
echo  [提示] 运行 stop.bat 可以停止服务
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未安装 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)
echo Node.js 版本:
node --version
echo.

REM 检查 .env 文件
if not exist ".env" (
    if exist "env.example" (
        echo [提示] 正在从 env.example 创建 .env 文件...
        copy "env.example" ".env" >nul 2>&1
    ) else (
        echo [警告] 未找到 .env 文件，将使用默认配置
    )
)

REM 创建必要目录
if not exist "server\logs" mkdir "server\logs"
if not exist "client\logs" mkdir "client\logs"
if not exist "data\database" mkdir "data\database"
if not exist "data\uploads" mkdir "data\uploads"
if not exist "server\drawings" mkdir "server\drawings"

REM 安装依赖
if exist "package.json" (
    if not exist "node_modules" (
        echo [1/3] 正在安装后端依赖...
        call npm install --production
        if %errorlevel% neq 0 (
            echo [警告] 后端依赖安装失败，但将继续启动...
        ) else (
            echo [完成] 后端依赖安装完成
        )
    ) else (
        echo [1/3] 后端依赖已安装
    )
)

if exist "client\package.json" (
    if not exist "client\node_modules" (
        echo [2/3] 正在安装前端依赖...
        pushd client
        call npm install
        popd
        if %errorlevel% neq 0 (
            echo [警告] 前端依赖安装失败，但将继续启动...
        ) else (
            echo [完成] 前端依赖安装完成
        )
    ) else (
        echo [2/3] 前端依赖已安装
    )
)

echo.
echo [3/3] 正在启动服务...
echo.

REM 启动后端服务（后台运行）
echo [后端] 启动中... 端口 5000
start /b "" npm run dev > "server\logs\server.log" 2>&1

REM 等待后端启动
timeout /t 5 /nobreak >nul 2>&1

REM 启动前端服务（后台运行）
echo [前端] 启动中... 端口 3000
start /b "" npm start --prefix client > "client\logs\client.log" 2>&1

REM 等待前端启动
timeout /t 8 /nobreak >nul 2>&1

echo.
echo  ================================================================
echo    启动完成
echo  ================================================================
echo.
echo   后端地址: http://localhost:5000
echo   前端地址: http://localhost:3000
echo.
echo   停止服务: 运行 stop.bat
echo   查看日志: server\logs\server.log 和 client\logs\client.log
echo.
echo  ================================================================
