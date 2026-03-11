const express = require('express');
const cors = require('cors');
const path = require('path');
const authRoutes = require('./routes/auth');
const inventoryRoutes = require('./routes/inventory');
const adminRoutes = require('./routes/admin');
const orderRoutes = require('./routes/orders');
const drawingsRoutes = require('./routes/drawings');
const usersRoutes = require('./routes/users');
const pixelateRoutes = require('./routes/pixelate');
const completionsRoutes = require('./routes/completions');
const reportsRoutes = require('./routes/reports');
const { initializeDatabase, uploadsDir } = require('./database');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS 配置：允许所有来源（适用于反向代理场景）
app.use(cors({
  origin: true, // 允许所有来源
  credentials: true, // 允许携带凭证
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务：提供上传的图片访问
app.use('/uploads', express.static(uploadsDir));

// 初始化数据库
initializeDatabase();

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/drawings', drawingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/pixelate', pixelateRoutes);
app.use('/api/completions', completionsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/sales_orders', require('./routes/sales_orders'));


// 服务前端构建后的静态文件（生产环境）
// 支持pkg打包：打包后静态文件在程序目录的 public 下
const getPublicPath = () => {
  if (process.pkg) {
    return path.join(path.dirname(process.execPath), 'public');
  }
  return path.join(__dirname, 'public');
};
const publicPath = getPublicPath();
const fs = require('fs');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  // 所有非 API 路由都返回前端应用
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

