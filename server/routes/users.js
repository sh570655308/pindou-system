const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware/auth');
const { uploadsDir, get, run } = require('../database');

const router = express.Router();
router.use(authenticateToken);

const avatarsDir = path.join(uploadsDir, 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uid = req.user.id;
    const dir = path.join(avatarsDir, String(uid));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'avatar.jpg');
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('只支持图片文件（JPEG/PNG/WebP）'), false);
  }
});

// 上传头像
router.post('/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const uid = req.user.id;
    const filePath = `avatars/${uid}/avatar.jpg`;
    res.json({ message: '上传成功', path: filePath, url: `/uploads/${filePath}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 修改密码
router.put('/password', async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // 验证输入
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: '请填写所有密码字段' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: '新密码与确认密码不一致' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密码长度至少6位' });
    }

    // 获取用户当前密码
    const user = await get('SELECT id, password FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证原密码
    const isValidPassword = bcrypt.compareSync(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: '原密码错误' });
    }

    // 加密新密码并更新
    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

    res.json({ message: '密码修改成功' });
  } catch (error) {
    console.error('修改密码失败:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;


