# 反向代理配置指南

## 问题说明

当使用反向代理（如 Nginx）将服务暴露到外网时，前端需要能够正确访问后端 API。本项目已优化为使用相对路径，支持内网和外网访问。

## 解决方案

### 1. 前端已优化（已完成）

前端现在使用相对路径 `/api`，而不是绝对路径：
- ✅ 内网访问：`http://192.168.1.100:5000` → API: `/api`
- ✅ 外网访问：`https://your-domain.com` → API: `/api`
- ✅ 自动适配当前域名，无需配置

### 2. Nginx 反向代理配置

在 Unraid 上配置 Nginx（或其他反向代理），示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 如果需要 HTTPS，取消下面的注释并配置 SSL
    # listen 443 ssl;
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    # 客户端上传文件大小限制（根据需求调整）
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        
        # 重要：保留原始主机头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持（如果将来需要）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 静态文件缓存（可选，提升性能）
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        proxy_pass http://localhost:5000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 3. 关键配置说明

#### 必须配置的头部：

1. **`proxy_set_header Host $host;`**
   - 保留原始请求的主机头
   - 确保后端能正确识别请求来源

2. **`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`**
   - 传递客户端真实 IP
   - 用于日志和访问控制

3. **`proxy_set_header X-Forwarded-Proto $scheme;`**
   - 传递协议类型（http/https）
   - 确保重定向和链接使用正确的协议

### 4. Unraid 上的配置步骤

#### 方法一：使用 Nginx Proxy Manager（推荐）

1. 在 Unraid 的 Community Applications 安装 "Nginx Proxy Manager"
2. 添加 Proxy Host：
   - **Domain Names**: `your-domain.com`
   - **Forward Hostname/IP**: `unraid-server-ip` 或 `localhost`
   - **Forward Port**: `5000`
   - **Block Common Exploits**: ✅ 启用
   - **Websockets Support**: ✅ 启用（如果需要）
3. SSL 证书（可选但推荐）：
   - 使用 Let's Encrypt 自动申请证书
   - 或上传自己的证书

#### 方法二：手动配置 Nginx

1. SSH 登录 Unraid
2. 编辑 Nginx 配置文件（位置取决于你的 Nginx 安装方式）
3. 添加上述配置
4. 重启 Nginx：`nginx -s reload`

### 5. 验证配置

#### 检查前端 API 请求

1. 打开浏览器开发者工具（F12）
2. 切换到 Network 标签
3. 尝试登录
4. 查看 API 请求：
   - ✅ 应该看到请求 URL 为：`https://your-domain.com/api/auth/login`
   - ❌ 不应该看到：`http://localhost:5000/api/auth/login`

#### 检查后端日志

```bash
# 查看 Docker 容器日志
docker-compose logs -f

# 应该看到正常的请求日志，没有 CORS 错误
```

### 6. 常见问题排查

#### 问题 1: 外网访问时提示 "操作失败，请重试"

**原因**：前端仍在使用旧的绝对路径

**解决**：
1. 重新构建 Docker 镜像（确保使用最新的代码）
2. 检查浏览器缓存，强制刷新（Ctrl+F5）
3. 确认 `REACT_APP_API_URL` 环境变量设置为 `/api` 或未设置（使用默认值）

#### 问题 2: CORS 错误

**原因**：反向代理配置不正确

**解决**：
1. 检查 Nginx 配置中的 `proxy_set_header` 设置
2. 确认后端 CORS 配置允许所有来源（已配置）

#### 问题 3: 上传文件失败

**原因**：文件大小限制

**解决**：
1. 在 Nginx 配置中增加 `client_max_body_size`
2. 检查 Docker 容器的文件上传限制

### 7. 安全建议

1. **使用 HTTPS**：
   - 使用 Let's Encrypt 免费证书
   - 强制 HTTPS 重定向

2. **限制访问**：
   - 使用 Nginx 的访问控制
   - 或使用防火墙规则

3. **定期更新**：
   - 保持 Nginx 和 Docker 镜像更新

### 8. 更新部署

修改代码后，需要重新构建：

```bash
# 在 Unraid 上
cd /mnt/user/appdata/pindou
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 9. 测试清单

- [ ] 内网访问正常（`http://unraid-ip:5000`）
- [ ] 外网访问正常（`https://your-domain.com`）
- [ ] 登录功能正常
- [ ] API 请求使用相对路径（检查浏览器 Network）
- [ ] 上传文件功能正常
- [ ] 没有 CORS 错误（检查浏览器 Console）

## 技术说明

### 为什么使用相对路径？

1. **自动适配**：无论从哪个域名访问，都能正确工作
2. **简化配置**：不需要为每个环境配置不同的 API URL
3. **反向代理友好**：与 Nginx 等反向代理完美配合

### 前端代码变更

```typescript
// 之前（有问题）
const API_URL = 'http://localhost:5000/api';

// 现在（已修复）
const API_URL = '/api';  // 相对路径，自动适配当前域名
```

### 后端 CORS 配置

后端已配置为允许所有来源，适用于反向代理场景：

```javascript
app.use(cors({
  origin: true,  // 允许所有来源
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

## 总结

✅ **已修复**：前端使用相对路径，支持内网和外网访问  
✅ **已优化**：CORS 配置支持反向代理  
✅ **下一步**：重新构建 Docker 镜像并部署

重新构建后，外网访问应该可以正常工作了！

