# 拼豆库存管理系统 (Pindou Inventory Management System)

## 项目概述

拼豆库存管理系统是一个专为拼豆（Perler Beads）爱好者设计的库存管理应用。系统支持多用户账号、库存追踪、图纸档案管理、物料识别（OCR）、订单管理和统计分析等功能。

### 核心功能模块

1. **库存管理** - 跟踪不同品牌（MARD、COCO、ManMan、PanPan、MiXiaoWo）的拼豆库存
2. **图纸档案** - 管理拼豆图纸，支持文件夹分类、标签系统和OCR物料识别
3. **完工记录** - 记录完成的拼豆作品，关联图纸和消耗材料
4. **订单管理** - 采购订单（在途库存）和销售订单管理
5. **报表统计** - 库存、消耗、销售、完工等多维度报表
6. **像素化工具** - 将图片转换为拼豆可用的像素图

## 技术栈

### 后端
- **运行时**: Node.js 18+
- **框架**: Express.js
- **数据库**: SQLite3 (文件型数据库)
- **认证**: JWT (jsonwebtoken)
- **密码加密**: bcryptjs
- **图片处理**: sharp
- **OCR**: DeepSeek-OCR API (硅基流动) + OCR.space (备用)
- **文件上传**: multer
- **跨域**: cors

### 前端
- **框架**: React 19
- **语言**: TypeScript 4.9+
- **样式**: Tailwind CSS 3.4+
- **路由**: React Router 7
- **构建工具**: CRACO (基于 Create React App)
- **图表**: Recharts
- **图标**: Lucide React
- **压缩**: pako

### 部署
- **容器化**: Docker + Docker Compose
- **基础镜像**: node:18-alpine
- **反向代理**: Nginx (可选)

## 项目结构

```
.
├── package.json              # 根 package.json，定义脚本和共享依赖
├── docker-compose.yml        # Docker Compose 配置
├── Dockerfile                # 多阶段构建 Dockerfile
├── .env.example              # 环境变量示例
│
├── server/                   # 后端代码
│   ├── index.js              # Express 应用入口
│   ├── database.js           # 数据库初始化和工具函数
│   ├── database.sqlite       # SQLite 数据库文件
│   ├── middleware/
│   │   └── auth.js           # JWT 认证中间件
│   ├── routes/               # API 路由模块
│   │   ├── auth.js           # 认证相关 (登录/注册)
│   │   ├── inventory.js      # 库存管理
│   │   ├── admin.js          # 管理员功能
│   │   ├── drawings.js       # 图纸档案 (含 OCR 功能)
│   │   ├── orders.js         # 采购订单
│   │   ├── sales_orders.js   # 销售订单
│   │   ├── completions.js    # 完工记录
│   │   ├── reports.js        # 报表统计
│   │   ├── users.js          # 用户管理
│   │   └── pixelate.js       # 像素化工具
│   ├── utils/
│   │   └── fileUpload.js     # 文件上传工具
│   ├── uploads/              # 上传文件存储
│   │   ├── drawings/         # 图纸图片
│   │   └── avatars/          # 用户头像
│   └── public/               # 生产环境前端静态文件
│
├── client/                   # 前端代码
│   ├── package.json          # 前端依赖
│   ├── src/
│   │   ├── App.tsx           # 应用根组件
│   │   ├── index.tsx         # 应用入口
│   │   ├── context/
│   │   │   └── AuthContext.tsx    # 认证上下文
│   │   ├── components/       # 可复用组件
│   │   │   ├── MaterialRecognition.tsx  # OCR 物料识别
│   │   │   ├── DirectoryTree.tsx        # 文件夹树
│   │   │   ├── reports/      # 报表相关组件
│   │   │   └── ...
│   │   ├── pages/            # 页面组件
│   │   │   ├── Dashboard.tsx        # 首页仪表盘
│   │   │   ├── Inventory.tsx        # 库存管理
│   │   │   ├── Drawings.tsx         # 图纸档案
│   │   │   ├── CompletionRecords.tsx # 完工记录
│   │   │   ├── Orders.tsx           # 采购订单
│   │   │   ├── SalesOrders.tsx      # 销售订单
│   │   │   ├── Reports.tsx          # 报表中心
│   │   │   ├── Pixelate.tsx         # 像素化工具
│   │   │   ├── Admin.tsx            # 管理后台
│   │   │   ├── Settings.tsx         # 系统设置
│   │   │   └── Login.tsx            # 登录页
│   │   ├── utils/            # 工具函数
│   │   │   ├── api.ts        # API 调用封装
│   │   │   ├── auth.ts       # 认证工具
│   │   │   └── ...
│   │   ├── types/            # TypeScript 类型定义
│   │   └── workers/          # Web Workers
│   └── public/               # 静态资源
│
├── data/                     # Docker 数据持久化目录
│   ├── database/             # 数据库文件
│   └── uploads/              # 上传文件
│
└── *.md                      # 各种文档
```

## 开发命令

### 安装依赖
```bash
# 安装根目录和 client 的所有依赖
npm run install-all
```

### 开发模式
```bash
# 同时启动后端 (端口 5000) 和前端 (端口 3000)
npm run dev

# 仅启动后端
npm run server

# 仅启动前端
npm run client
```

### 生产构建
```bash
# 构建前端生产版本
npm run build
```

### Windows 一键启动
```bash
# 双击运行或命令行执行
start.bat
```

## API 架构

### 认证方式
所有 API（除登录注册外）需要在请求头中携带 JWT Token：
```
Authorization: Bearer <token>
```

### 路由前缀
- 所有 API 路由前缀: `/api`
- 静态文件: `/uploads`

### 主要 API 模块

| 模块 | 路径 | 说明 |
|------|------|------|
| 认证 | `/api/auth/*` | 登录、注册、健康检查 |
| 库存 | `/api/inventory/*` | 库存查询、更新、统计 |
| 图纸 | `/api/drawings/*` | 图纸 CRUD、OCR 识别 |
| 订单 | `/api/orders/*` | 采购订单管理 |
| 销售订单 | `/api/sales_orders/*` | 销售订单管理 |
| 完工记录 | `/api/completions/*` | 完工记录管理 |
| 报表 | `/api/reports/*` | 各类报表数据 |
| 管理 | `/api/admin/*` | 类别、产品、用户管理 |
| 用户 | `/api/users/*` | 用户个人信息 |
| 像素化 | `/api/pixelate/*` | 图片像素化处理 |

## 数据库设计

### 核心表

1. **users** - 用户表
2. **categories** - 库存大类（品牌）
3. **products** - 产品细类（色号）
4. **user_inventory** - 用户库存
5. **drawings** - 图纸档案
6. **drawing_images** - 图纸图片
7. **drawing_materials** - 图纸材料清单
8. **consumption_records** - 消耗记录
9. **consumption_items** - 消耗明细
10. **completion_records** - 完工记录
11. **orders** - 采购订单
12. **sales_orders** - 销售订单
13. **order_items** - 订单明细
14. **drawing_folders** - 图纸文件夹
15. **drawing_tags** - 图纸标签

### 数据库初始化
数据库在首次启动时自动初始化：
- 创建所有表结构
- 添加默认管理员账号 (admin/admin123)
- 添加默认库存大类
- 添加示例产品数据

## 部署

### Docker 部署（推荐）

```bash
# 快速启动（自动创建数据目录、环境变量）
./docker-start.sh    # Linux/Mac
docker-start.bat     # Windows

# 或手动部署
docker-compose up -d
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 5000 |
| `JWT_SECRET` | JWT 签名密钥 | your-secret-key-change-in-production |
| `REACT_APP_API_URL` | 前端 API 地址 | /api |
| `NODE_ENV` | 运行环境 | production |
| `DATA_DIR` | 数据库目录 | /app/data/database |
| `UPLOADS_DIR` | 上传文件目录 | /app/data/uploads |

### 数据持久化
Docker 部署时，以下数据通过 Volume 持久化：
- `data/database/` - SQLite 数据库
- `data/uploads/` - 上传的图片文件

## 代码规范

### 后端
- 使用 CommonJS 模块 (require/module.exports)
- 异步操作使用 async/await
- 路由按功能模块化拆分
- 数据库操作使用参数化查询防止 SQL 注入
- 错误处理使用 try-catch 包裹

### 前端
- TypeScript 严格模式
- React 函数组件 + Hooks
- 组件文件使用 PascalCase 命名
- 工具函数使用 camelCase 命名
- 类型定义集中存放在 types/ 目录

### 日志规范
后端日志使用前缀标识：
```javascript
console.log('[drawings] OCR recognition started');
console.log('[auth] User logged in:', username);
```

## 安全注意事项

1. **JWT 密钥**: 生产环境必须修改默认 JWT_SECRET
2. **管理员密码**: 首次部署后应立即修改默认管理员密码
3. **CORS**: 生产环境配置允许的来源，避免使用 `origin: true`
4. **文件上传**: 已限制允许的文件类型和大小
5. **SQL 注入**: 所有数据库查询使用参数化语句

## OCR 物料识别

系统集成了 DeepSeek-OCR (硅基流动 API) 用于识别图纸上的物料清单：

### 配置
- API 密钥和地址配置在 `server/routes/drawings.js`
- 当前使用模型: `deepseek-ai/DeepSeek-OCR`

### 功能特点
1. **图片预处理** - 3倍放大、高对比度、锐化
2. **结构化识别** - 使用 `<|ref|>文本</|ref|><|det|>坐标</|det|>` 格式
3. **格式自适应** - 自动识别内联格式和分行格式
4. **错误修正** - 自动修正常见 OCR 错误 (6→G, 0→O 等)

### 测试
```bash
node test-production-ocr.js
```

## 默认账号

- **管理员**: admin / admin123
- **普通用户**: 通过注册页面创建

## 开发注意事项

1. **数据库迁移**: 修改表结构时，使用 `ALTER TABLE ADD COLUMN` 并在 `database.js` 的初始化函数中添加迁移逻辑
2. **文件上传**: 上传的文件存储在 `server/uploads/`，生产环境通过 Volume 持久化
3. **前端代理**: 开发模式下，前端通过 `proxy` 配置代理到后端端口 5000
4. **Docker 构建**: 使用多阶段构建，前端构建产物复制到 `server/public/` 由 Express 统一服务

## 故障排查

### 常见问题

1. **端口被占用**
   ```bash
   # Windows
   netstat -ano | findstr :5000
   taskkill /F /PID <PID>
   
   # 或使用 stop.bat
   ```

2. **数据库锁定**
   - SQLite 不支持并发写入，确保同一时间只有一个进程访问数据库

3. **Docker 容器无法启动**
   - 检查数据目录权限
   - 查看日志: `docker-compose logs -f`

4. **OCR 识别失败**
   - 检查 API 密钥是否有效
   - 查看服务器日志中的错误信息
