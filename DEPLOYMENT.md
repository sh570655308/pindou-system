# 部署指南

本文档说明如何将系统部署到 NAS 或服务器。

## Docker 部署（推荐）

适用于 NAS、群晖、Unraid 等支持 Docker 的环境。

### 步骤 1: 安装 Docker

确保已安装 Docker 和 Docker Compose。

### 步骤 2: 获取项目

```bash
git clone https://github.com/sh570655308/pindou-system.git
cd pindou-system
```

### 步骤 3: 配置环境变量

```bash
cp env.example .env
```

编辑 `.env` 文件，修改以下配置：

| 变量 | 说明 | 是否必填 |
|------|------|----------|
| JWT_SECRET | 用于加密用户登录凭证的密钥，请修改为任意随机字符串 | 推荐 |
| OCR_API_KEY | OCR 识别 API 密钥，用于图纸物料识别功能 | 可选 |

### 步骤 4: 启动服务

```bash
docker compose up -d
```

首次启动会自动构建镜像。

### 步骤 5: 访问应用

浏览器访问：http://localhost:5000

默认账号：`admin` / `admin123`

---

## OCR API 配置（可选）

OCR 功能用于从图纸图片中自动识别物料代码和数量。

### 获取 API Key

推荐使用硅基流动的 DeepSeek-OCR 模型（目前免费）：

1. 访问 [硅基流动](https://cloud.siliconflow.cn/i/QIYTYm6u) 注册账号
2. 进入控制台获取 API Key
3. 将 API Key 填入 `.env` 文件的 `OCR_API_KEY=`

不配置 OCR API 不影响其他功能使用。

---

## 数据持久化

Docker 部署时，数据存储在 `data/` 目录：

- `data/database/` - SQLite 数据库
- `data/uploads/` - 上传的文件

建议定期备份此目录。

---

## 更新版本

```bash
git pull
docker compose down
docker compose up -d --build
```

---

## 端口说明

| 端口 | 用途 |
|------|------|
| 5000 | 后端 API 和前端页面（Docker 模式） |
| 3000 | 前端页面（本地开发模式） |
