@echo off
REM Docker 快速启动脚本 (Windows)

echo ==========================================
echo 拼豆系统 Docker 部署脚本
echo ==========================================

REM 检查 Docker 是否安装
docker --version >nul 2>&1
if errorlevel 1 (
    echo 错误: Docker 未安装，请先安装 Docker Desktop
    pause
    exit /b 1
)

REM 检查 Docker Compose 是否安装
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo 错误: Docker Compose 未安装，请先安装 Docker Compose
    pause
    exit /b 1
)

REM 创建数据目录
echo 创建数据目录...
if not exist "data\database" mkdir data\database
if not exist "data\uploads" mkdir data\uploads

REM 检查是否有现有数据库需要迁移
if exist "server\database.sqlite" (
    if not exist "data\database\database.sqlite" (
        echo 检测到现有数据库，正在迁移...
        copy "server\database.sqlite" "data\database\database.sqlite" >nul
        echo 数据库迁移完成
    )
)

REM 检查是否有现有上传文件需要迁移
if exist "server\uploads" (
    if not exist "data\uploads\*.*" (
        echo 检测到现有上传文件，正在迁移...
        xcopy "server\uploads\*" "data\uploads\" /E /I /Y >nul 2>&1
        echo 上传文件迁移完成
    )
)

REM 检查环境变量文件
if not exist ".env" (
    echo 未找到 .env 文件，从 env.example 创建...
    if exist "env.example" (
        copy "env.example" ".env" >nul
        echo 已创建 .env 文件，请根据需要修改配置
    ) else (
        echo 警告: env.example 文件不存在
    )
)

REM 构建并启动容器
echo.
echo 开始构建 Docker 镜像...
docker-compose build

echo.
echo 启动容器...
docker-compose up -d

REM 等待服务启动
echo.
echo 等待服务启动...
timeout /t 5 /nobreak >nul

REM 检查服务状态
echo.
echo ==========================================
echo 部署完成！
echo ==========================================
echo.
echo 服务地址: http://localhost:5000
echo.
echo 默认管理员账号:
echo   用户名: admin
echo   密码: admin123
echo.
echo 常用命令:
echo   查看日志: docker-compose logs -f
echo   停止服务: docker-compose stop
echo   重启服务: docker-compose restart
echo   查看状态: docker-compose ps
echo.

pause

