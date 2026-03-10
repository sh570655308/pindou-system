#!/bin/bash

# Docker 快速启动脚本

echo "=========================================="
echo "拼豆系统 Docker 部署脚本"
echo "=========================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null; then
    echo "错误: Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

# 创建数据目录
echo "创建数据目录..."
mkdir -p data/database data/uploads

# 检查是否有现有数据库需要迁移
if [ -f "server/database.sqlite" ] && [ ! -f "data/database/database.sqlite" ]; then
    echo "检测到现有数据库，正在迁移..."
    cp server/database.sqlite data/database/database.sqlite
    echo "数据库迁移完成"
fi

# 检查是否有现有上传文件需要迁移
if [ -d "server/uploads" ] && [ "$(ls -A server/uploads 2>/dev/null)" ]; then
    if [ ! -d "data/uploads" ] || [ -z "$(ls -A data/uploads 2>/dev/null)" ]; then
        echo "检测到现有上传文件，正在迁移..."
        cp -r server/uploads/* data/uploads/ 2>/dev/null || true
        echo "上传文件迁移完成"
    fi
fi

# 检查环境变量文件
if [ ! -f ".env" ]; then
    echo "未找到 .env 文件，从 env.example 创建..."
    if [ -f "env.example" ]; then
        cp env.example .env
        echo "已创建 .env 文件，请根据需要修改配置"
    else
        echo "警告: env.example 文件不存在"
    fi
fi

# 构建并启动容器
echo ""
echo "开始构建 Docker 镜像..."
docker-compose build

echo ""
echo "启动容器..."
docker-compose up -d

# 等待服务启动
echo ""
echo "等待服务启动..."
sleep 5

# 检查服务状态
if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "=========================================="
    echo "部署成功！"
    echo "=========================================="
    echo ""
    echo "服务地址: http://localhost:5000"
    echo ""
    echo "默认管理员账号:"
    echo "  用户名: admin"
    echo "  密码: admin123"
    echo ""
    echo "常用命令:"
    echo "  查看日志: docker-compose logs -f"
    echo "  停止服务: docker-compose stop"
    echo "  重启服务: docker-compose restart"
    echo "  查看状态: docker-compose ps"
    echo ""
else
    echo ""
    echo "警告: 服务可能未正常启动，请检查日志:"
    echo "  docker-compose logs"
    echo ""
fi

