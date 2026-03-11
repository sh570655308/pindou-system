# 拼豆库存管理系统

一个简单的拼豆库存管理工具，支持多用户使用。

## 快速开始

### Windows 本地运行

1. 安装 [Node.js 18+](https://nodejs.org/)
2. 双击 `start.bat` 启动服务
3. 浏览器访问 http://localhost:3000

停止服务：双击 `stop.bat`

### Docker 部署

详见 [DEPLOYMENT.md](./DEPLOYMENT.md)

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
