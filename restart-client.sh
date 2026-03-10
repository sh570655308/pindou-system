#!/bin/bash

echo "停止开发服务器..."
# 停止可能在运行的进程
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

echo "清理缓存..."
cd client
rm -rf node_modules/.cache
rm -rf .tsbuildinfo

echo "重新启动开发服务器..."
npm start
