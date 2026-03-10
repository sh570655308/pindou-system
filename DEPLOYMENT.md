# 鋼豆库存管理系统 - 鸱署指南

本文档说明如何将拼豆系统部署到 NAS 或本地服务器。


## 方式一： Docker 部署（推荐)
适用于 NAS、 Unraid 等支持 Docker 的环境.

### 歉️骤 1: 安装 Docker
确保已安装 Docker 和 Docker Compose。

### 歓️骤 2: 获取项目
```bash
git clone https://github.com/your-username/pindou.git
cd pindou
```


### 歬️骤 3: 配置环境变量
创建 `.env` 文件（可选，也可直接使用默认配置）:

```bash
cp env.example .env
```

编辑 `.env` 文件，修改以下配置：

| 变量 | 说明 | 默认值 |
|------|------|---------|
| PORT | 服务端口 | 5000 |
| JWT_SECRET | JWT 密钥（**必须修改**） | - |
| OCR_API_KEY | OCR API 密钥（可选） | - |

### 歬️骤 4: 启动服务
```bash
docker compose up -d
```

首次启动会自动构建镜像并启动容器。

### 歬️步骤 5: 访问应用
打开浏览器访问： http://localhost:5000

- 默认账号: admin / admin123



---

## 方式二: 本地运行（Windows)
适用于没有 Docker 的 Windows 环境.

### 假️步骤 1: 安装 Node.js
下载并安装 [Node.js 18+](https://nodejs.org/)

### 歓️步骤 2: 安装依赖
```bash
npm run install-all
```
或双击 `start.bat` 自动安装。

### 🔄 歓️步骤 3: 启动服务
```bash
start.bat
```
或命令行启动：
```bash
npm run dev
```

### 暂停服务
```bash
stop.bat
```
或按 `Ctrl+C`

### 访问地址
| 服务 | 地址 |
|------|------|
| 后端 API | http://localhost:5000 |
| 前端页面 | http://localhost:3000 |



---

## 目录结构
```
pindou/
├── client/              # React 匍端
│   ├── src/
│   │   ├── components/  # React 组件
│   │   ├── pages/         # 页面
│   │   ├── hooks/         # 自定义 Hooks
│   │   └── utils/         # 工具函数
│   └── public/
├── server/              # Express 后端
│   ├── routes/           # API 路由
│   ├── middleware/      # 中间件
│   └── utils/           # 工具函数
├── data/                # 数据目录（Docker 挂载）
│   ├── database/       # SQLite 数据库
│   └── uploads/        # 上传文件
├── docker-compose.yml    # Docker Compose 配置
├── Dockerfile           # Docker 构建文件
├── start.bat             # Windows 启动脚本
├── stop.bat              # Windows 嚂止脚本
└── env.example          # 环境变量示例
```

---

## 猡️注意
1. **生产环境**请修改 `.env` 中的 `JWT_SECRET`
2. **OCR 功能** 需要配置 `OCR_API_KEY`（如不配置， OCR 识别功能不可用）
3. **数据备份** 定期备份 `data/` 目录
