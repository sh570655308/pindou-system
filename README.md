# 拼豆库存管理系统

一个简单的拼豆库存管理工具，支持多用户使用。

## 快速开始

### Windows 本地运行

1. 安装 [Node.js 18+](https://nodejs.org/)
2. （可选）配置 OCR API：复制 `env.example` 为 `.env`，填入 API Key
3. 双击 `start.bat` 启动服务
4. 浏览器访问 http://localhost:3000

停止服务：双击 `stop.bat`

### Docker 部署

详见 [DEPLOYMENT.md](./DEPLOYMENT.md)

## OCR API 配置（可选）

OCR 功能用于从图纸图片中自动识别物料代码和数量，不配置不影响其他功能。

1. 访问 [硅基流动](https://cloud.siliconflow.cn/i/QIYTYm6u) 注册账号
2. 获取 API Key
3. 在项目根目录创建 `.env` 文件，添加：
   ```
   OCR_API_KEY=你的API密钥
   ```

## 默认账号

- 管理员：`admin` / `admin123`

## 示例数据

项目根目录下的 `mard280色号.txt` 包含 MARD 品牌 280 色物料代码，可通过管理后台批量导入。

## 常见问题

**Q: 启动后无法访问？**
- 检查 3000 和 5000 端口是否被占用
- 查看 `server\logs\server.log` 日志文件

**Q: 忘记密码？**
- 删除 `data\database\database.sqlite` 文件后重启，会重置为默认账号
