const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { drawingsDir } = require('../database');

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // support route param named "id" or "drawingId" (routes use :id) and form field drawing_id
    const drawingId = req.body.drawingId || req.body.drawing_id || req.params.drawingId || req.params.id || 'temp';
    const uploadPath = path.join(drawingsDir, drawingId.toString());
    
    // 创建目录（如果不存在）
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名：类型_时间戳_原始文件名
    const imageType = req.body.imageType || 'main';
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    const filename = `${imageType}_${timestamp}_${name}${ext}`;
    cb(null, filename);
  }
});

// 文件过滤器
const fileFilter = (req, file, cb) => {
  // 允许的图片格式
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('只允许上传图片文件（JPEG、PNG、GIF、WebP）'), false);
  }
};

// 配置文件大小限制（默认50MB，支持大图纸）
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// 删除文件辅助函数
function deleteFile(filePath) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(drawingsDir, filePath);
    fs.unlink(fullPath, (err) => {
      if (err && err.code !== 'ENOENT') {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// 删除目录及其所有文件
function deleteDirectory(dirPath) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(drawingsDir, dirPath);
    if (fs.existsSync(fullPath)) {
      fs.rm(fullPath, { recursive: true, force: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  upload,
  deleteFile,
  deleteDirectory,
  drawingsDir
};
