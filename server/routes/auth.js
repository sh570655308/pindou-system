const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get, run } = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// 健康检查端点
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 检查注册是否开启
    const { get } = require('../database');
    const registrationSetting = await get('SELECT value FROM settings WHERE key = ?', ['registration_enabled']);
    const isRegistrationEnabled = !registrationSetting || registrationSetting.value === 'true';

    if (!isRegistrationEnabled) {
      return res.status(403).json({ error: '注册已关闭，请联系管理员' });
    }

    // 检查用户名是否已存在
    const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(400).json({ error: '用户名已存在' });
    }

    // 加密密码
    const hashedPassword = bcrypt.hashSync(password, 10);

    // 创建用户
    await run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

    res.json({ message: '注册成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }

    // 查找用户
    const user = await get('SELECT id, username, password, role FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 验证密码
    const isValidPassword = bcrypt.compareSync(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
