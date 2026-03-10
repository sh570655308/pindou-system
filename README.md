# 拼豆库存管理系统

一个基于 React + Node.js 的库存管理系统，支持多用户账号系统和权限管理。

## 功能特性

- 🔐 用户账号系统（注册、登录）
- 👥 用户角色管理（普通用户、管理员）
- 📦 库存管理（查看、更新库存数量）
- 📊 统计信息（总数量、种类数、低库存预警）
- 🔍 搜索和筛选功能
- 👨‍💼 管理员功能（管理库存大类、产品细类）

## 技术栈

### 后端
- Node.js + Express
- SQLite 数据库
- JWT 认证
- bcrypt 密码加密

### 前端
- React + TypeScript
- Tailwind CSS
- React Router

## 安装和运行

### 方式一： 本地运行（Windows）

**Windows 用户:**
1. 双击 `start.bat` 启动前后端服务
2. 双击 `stop.bat` 停止所有服务

3. 访问: http://localhost:3000

4. 查看日志: 查看 `server\logs\server.log` 和 `client\logs\client.log`

`start.bat` 脚本会自动:
- ✅ 检查并释放占用的端口（3000 和 5000）
- ✅ 同时启动后端和前端服务
- ✅ 后台运行，关闭窗口后进程继续运行

### 方式二: Docker 部署

适用于 NAS 或服务器环境, **详细步骤请查看 [DEPLOYMENT.md](./DEPLOYMENT.md)**

### 方式三: 埥看日志

在运行窗口按 `Ctrl+C`， 或双击 `stop.bat` 文件停止服务

## 默认账号

- **管理员账号**: admin / admin123
- 普通用户需要通过注册页面创建账号

## 项目结构

```
.
├── server/              # 后端代码
│   ├── routes/         # API 路由
│   ├── middleware/     # 中间件
│   └── database.js     # 数据库配置
├── client/             # 前端代码
│   ├── src/
│   │   ├── components/ # React 组件
│   │   ├── pages/      # 页面组件
│   │   └── utils/      # 工具函数
│   └── public/
├── data/                # 数据目录（Docker 挂载）
│   ├── database/       # SQLite 数据库
│   └── uploads/        # 上传文件
├── docker-compose.yml  # Docker Compose 配置
├── Dockerfile           # Docker 构建文件
├── start.bat            # Windows 启动脚本
├── stop.bat             # Windows 停止脚本
└── env.example          # 环境变量示例
```

## API 端点

### 认证
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录

### 库存管理
- `GET /api/inventory/stats` - 获取统计信息
- `GET /api/inventory/list` - 获取库存列表
- `GET /api/inventory/categories` - 获取所有类别
- `POST /api/inventory/update` - 更新单个库存
- `POST /api/inventory/batch-update` - 批量更新库存

### 管理员功能
- `GET /api/admin/categories` - 获取所有类别
- `POST /api/admin/categories` - 创建类别
- `PUT /api/admin/categories/:id` - 更新类别
- `DELETE /api/admin/categories/:id` - 删除类别
- `GET /api/admin/categories/:categoryId/products` - 获取类别下的产品
- `POST /api/admin/products` - 创建产品
- `PUT /api/admin/products/:id` - 更新产品
- `DELETE /api/admin/products/:id` - 删除产品
