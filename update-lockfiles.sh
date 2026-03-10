#!/bin/bash

# 更新 package-lock.json 文件，确保与 package.json 同步

echo "=========================================="
echo "更新 package-lock.json 文件"
echo "=========================================="

echo "更新根目录 package-lock.json..."
cd "$(dirname "$0")"
npm install --package-lock-only

echo "更新 client/package-lock.json..."
cd client
npm install --package-lock-only

echo ""
echo "完成！package-lock.json 文件已更新并与 package.json 同步。"

