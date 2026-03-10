const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { query, get, run } = require('../database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { getDatabaseStats, drawingsDir } = require('../database');

const router = express.Router();

// 所有路由都需要认证和管理员权限
router.use(authenticateToken);
router.use(requireAdmin);

// 获取数据库统计信息
router.get('/stats', async (req, res) => {
  try {
    const stats = await getDatabaseStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有类别
router.get('/categories', async (req, res) => {
  try {
    const categories = await query('SELECT * FROM categories ORDER BY sort_order, id');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建类别
router.post('/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '类别名称不能为空' });
    }

    // 获取当前最大sort_order
    const maxSort = await get('SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM categories');
    const newSortOrder = (maxSort?.max_sort || 0) + 1;

    const result = await run('INSERT INTO categories (name, sort_order) VALUES (?, ?)', [name, newSortOrder]);
    res.json({ id: result.id, name, message: '类别创建成功' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: '类别名称已存在' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 更新类别排序
router.post('/categories/reorder', async (req, res) => {
  try {
    const { categoryOrders } = req.body; // [{id: 1, sort_order: 0}, ...]
    
    if (!Array.isArray(categoryOrders)) {
      return res.status(400).json({ error: '无效的排序数据' });
    }

    // 批量更新排序
    for (const { id, sort_order } of categoryOrders) {
      await run('UPDATE categories SET sort_order = ? WHERE id = ?', [sort_order, id]);
    }

    res.json({ message: '排序更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新类别
router.put('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: '类别名称不能为空' });
    }

    await run('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    res.json({ message: '类别更新成功' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: '类别名称已存在' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 删除类别
router.delete('/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // 检查是否有产品使用该类别
    const products = await get('SELECT COUNT(*) as count FROM products WHERE category_id = ?', [id]);
    if (products.count > 0) {
      return res.status(400).json({ error: '该类别下还有产品，无法删除' });
    }

    await run('DELETE FROM categories WHERE id = ?', [id]);
    res.json({ message: '类别删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取类别下的所有产品
router.get('/categories/:categoryId/products', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const products = await query(
      'SELECT * FROM products WHERE category_id = ? ORDER BY code',
      [categoryId]
    );
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 创建产品
router.post('/products', async (req, res) => {
  try {
    const { categoryId, code, colorCode, colorHex } = req.body;
    if (!categoryId || !code) {
      return res.status(400).json({ error: '类别ID和产品代码不能为空' });
    }

    // 检查类别是否存在
    const category = await get('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!category) {
      return res.status(404).json({ error: '类别不存在' });
    }

    const result = await run(
      'INSERT INTO products (category_id, code, color_code, color_hex) VALUES (?, ?, ?, ?)',
      [categoryId, code, colorCode || code, colorHex || '#CCCCCC']
    );
    res.json({ id: result.id, message: '产品创建成功' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: '该类别下已存在相同代码的产品' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 更新产品
router.put('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, colorCode, colorHex } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: '产品代码不能为空' });
    }

    await run(
      'UPDATE products SET code = ?, color_code = ?, color_hex = ? WHERE id = ?',
      [code, colorCode || code, colorHex || '#CCCCCC', id]
    );
    res.json({ message: '产品更新成功' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: '该类别下已存在相同代码的产品' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 删除产品
router.delete('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM products WHERE id = ?', [id]);
    // 同时删除所有用户的该产品库存记录
    await run('DELETE FROM user_inventory WHERE product_id = ?', [id]);
    res.json({ message: '产品删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量导入产品（CSV格式）
router.post('/products/batch-import', async (req, res) => {
  try {
    const { categoryId, products, allowOverwrite = false } = req.body; // products: [{code, colorHex}]

    if (!categoryId) {
      return res.status(400).json({ error: '类别ID不能为空' });
    }

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: '产品数据不能为空' });
    }

    // 检查类别是否存在
    const category = await get('SELECT id FROM categories WHERE id = ?', [categoryId]);
    if (!category) {
      return res.status(404).json({ error: '类别不存在' });
    }

    const success = [];
    const errors = [];
    const skipped = [];

    // 十六进制颜色验证函数
    const isValidHexColor = (color) => {
      if (!color) return false;
      // 移除#号（如果有）
      const hex = color.replace(/^#/, '').toUpperCase();
      // 验证是否为6位十六进制数
      return /^[0-9A-F]{6}$/.test(hex);
    };

    // 格式化十六进制颜色（添加#前缀，转换为大写）
    const formatHexColor = (color) => {
      if (!color) return '#CCCCCC';
      const hex = color.replace(/^#/, '').toUpperCase();
      if (/^[0-9A-F]{6}$/.test(hex)) {
        return `#${hex}`;
      }
      return '#CCCCCC'; // 无效格式返回默认灰色
    };

    for (const product of products) {
      try {
        const { code, colorHex } = product;
        if (!code) {
          errors.push({ code: code || '未知', error: '产品代码不能为空' });
          continue;
        }

        // 格式化颜色值
        const finalColorHex = formatHexColor(colorHex);
        // 使用产品代码作为颜色编码
        const colorCode = code;

        // 检查产品是否已存在
        const existing = await get(
          'SELECT id FROM products WHERE category_id = ? AND code = ?',
          [categoryId, code]
        );

        if (existing) {
          // 产品已存在
          if (allowOverwrite) {
            // 允许覆盖：更新现有产品
            try {
              await run(
                'UPDATE products SET color_hex = ? WHERE id = ?',
                [finalColorHex, existing.id]
              );
              success.push({ code, action: '覆盖' });
            } catch (err) {
              errors.push({ code, error: err.message });
            }
          } else {
            // 不允许覆盖：跳过
            skipped.push({ code, action: '跳过（已存在）' });
          }
        } else {
          // 产品不存在，插入新记录
          try {
            await run(
              'INSERT INTO products (category_id, code, color_code, color_hex) VALUES (?, ?, ?, ?)',
              [categoryId, code, colorCode, finalColorHex]
            );
            success.push({ code, action: '新增' });
          } catch (err) {
            if (err.message.includes('UNIQUE constraint')) {
              errors.push({ code, error: '产品已存在' });
            } else {
              errors.push({ code, error: err.message });
            }
          }
        }
      } catch (err) {
        errors.push({ code: product.code || '未知', error: err.message });
      }
    }

    // 构建结果消息
    const resultParts = [];
    resultParts.push(`成功 ${success.length} 条`);
    if (skipped.length > 0) {
      resultParts.push(`跳过 ${skipped.length} 条`);
    }
    if (errors.length > 0) {
      resultParts.push(`失败 ${errors.length} 条`);
    }

    res.json({
      message: `导入完成：${resultParts.join('，')}`,
      success: success.length,
      skipped: skipped.length,
      failed: errors.length,
      details: {
        success,
        skipped,
        errors
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新预警阈值
router.put('/settings/warning-threshold', async (req, res) => {
  try {
    const { threshold } = req.body;
    if (threshold < 0) {
      return res.status(400).json({ error: '预警阈值不能为负数' });
    }

    await run(
      `INSERT INTO settings (key, value) VALUES ('warning_threshold', ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [threshold.toString(), threshold.toString()]
    );
    res.json({ message: '预警阈值更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取注册开关状态
router.get('/settings/registration-enabled', async (req, res) => {
  try {
    const setting = await get('SELECT value FROM settings WHERE key = ?', ['registration_enabled']);
    const isEnabled = !setting || setting.value === 'true';
    res.json({ enabled: isEnabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新注册开关状态
router.put('/settings/registration-enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled必须是布尔值' });
    }

    await run(
      `INSERT INTO settings (key, value) VALUES ('registration_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [enabled.toString(), enabled.toString()]
    );
    res.json({ message: '注册开关更新成功', enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 重置管理员账号（根据配置文件）
router.post('/admin/reset', async (req, res) => {
  try {
    // 读取配置文件
    const configPath = path.join(__dirname, '..', 'admin-config.json');
    let adminUsername = 'admin';
    let adminPassword = 'admin123';

    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.admin && config.admin.username && config.admin.password) {
          adminUsername = config.admin.username;
          adminPassword = config.admin.password;
        }
      }
    } catch (configError) {
      return res.status(400).json({ error: '配置文件格式错误或无法读取' });
    }

    // 检查是否已存在管理员账号
    const existingAdmin = await get('SELECT id FROM users WHERE role = ?', ['admin']);

    if (existingAdmin) {
      return res.status(400).json({
        error: '已存在管理员账号，无法重置。如需修改，请手动删除数据库中的管理员账号后重试'
      });
    }

    // 创建新的管理员账号
    const hashedPassword = bcrypt.hashSync(adminPassword, 10);
    const result = await run(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [adminUsername, hashedPassword, 'admin']
    );

    res.json({
      message: '管理员账号创建成功',
      admin: {
        id: result.id,
        username: adminUsername
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取管理员配置信息（不返回密码）
router.get('/admin/config', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', 'admin-config.json');
    let configInfo = {
      configured: false,
      username: null
    };

    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.admin && config.admin.username) {
          configInfo.configured = true;
          configInfo.username = config.admin.username;
        }
      }
    } catch (configError) {
      // 配置文件不存在或格式错误
    }

    res.json(configInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取需要生成缩略图的图片数量
router.get('/thumbnails/status', async (req, res) => {
  try {
    // 图纸图片
    const totalDrawingImages = await get(`SELECT COUNT(*) as count FROM drawing_images`);
    const withDrawingThumbnail = await get(`SELECT COUNT(*) as count FROM drawing_images WHERE thumbnail_path IS NOT NULL`);
    const withoutDrawingThumbnail = await get(`SELECT COUNT(*) as count FROM drawing_images WHERE thumbnail_path IS NULL`);

    // 完工记录图片
    const totalCompletionImages = await get(`SELECT COUNT(*) as count FROM completion_records WHERE image_path IS NOT NULL`);
    const withCompletionThumbnail = await get(`SELECT COUNT(*) as count FROM completion_records WHERE image_path IS NOT NULL AND thumbnail_path IS NOT NULL`);
    const withoutCompletionThumbnail = await get(`SELECT COUNT(*) as count FROM completion_records WHERE image_path IS NOT NULL AND thumbnail_path IS NULL`);

    const total = (totalDrawingImages.count || 0) + (totalCompletionImages.count || 0);
    const withThumbnail = (withDrawingThumbnail.count || 0) + (withCompletionThumbnail.count || 0);
    const withoutThumbnail = (withoutDrawingThumbnail.count || 0) + (withoutCompletionThumbnail.count || 0);

    res.json({
      total,
      withThumbnail,
      withoutThumbnail,
      details: {
        drawings: {
          total: totalDrawingImages.count || 0,
          withThumbnail: withDrawingThumbnail.count || 0,
          withoutThumbnail: withoutDrawingThumbnail.count || 0
        },
        completions: {
          total: totalCompletionImages.count || 0,
          withThumbnail: withCompletionThumbnail.count || 0,
          withoutThumbnail: withoutCompletionThumbnail.count || 0
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量生成缩略图
router.post('/thumbnails/generate', async (req, res) => {
  try {
    const { limit = 50 } = req.body; // 每次最多处理50张，避免超时

    let successCount = 0;
    let failCount = 0;
    let deletedCount = 0;
    const errors = [];

    // 1. 处理图纸图片
    const drawingImages = await query(`
      SELECT id, drawing_id, file_path, file_name
      FROM drawing_images
      WHERE thumbnail_path IS NULL
      LIMIT ?
    `, [limit]);

    for (const img of drawingImages) {
      try {
        const fullPath = path.join(drawingsDir, img.file_path);

        // 检查文件是否存在
        if (!fs.existsSync(fullPath)) {
          await run(`DELETE FROM drawing_images WHERE id = ?`, [img.id]);
          deletedCount++;
          console.log(`[thumbnails] 删除无效图纸图片记录: ID=${img.id}, path=${img.file_path}`);
          continue;
        }

        // 生成缩略图
        const ext = path.extname(img.file_name || img.file_path);
        const thumbnailFilename = `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
        const thumbnailPath = `${img.drawing_id}/${thumbnailFilename}`;
        const thumbnailFullPath = path.join(drawingsDir, thumbnailPath);

        const thumbnailDir = path.dirname(thumbnailFullPath);
        if (!fs.existsSync(thumbnailDir)) {
          fs.mkdirSync(thumbnailDir, { recursive: true });
        }

        await sharp(fullPath)
          .resize(150, 150, { fit: 'cover', position: 'center' })
          .jpeg({ quality: 80 })
          .toFile(thumbnailFullPath);

        await run(`UPDATE drawing_images SET thumbnail_path = ? WHERE id = ?`, [thumbnailPath, img.id]);
        successCount++;
      } catch (err) {
        failCount++;
        errors.push({ type: 'drawing', id: img.id, error: err.message });
        console.error(`[thumbnails] 处理图纸图片失败: ID=${img.id}, error=${err.message}`);
      }
    }

    // 2. 处理完工记录图片
    const remainingLimit = limit - drawingImages.length;
    if (remainingLimit > 0) {
      const completionImages = await query(`
        SELECT id, drawing_id, image_path, file_name
        FROM completion_records
        WHERE image_path IS NOT NULL AND thumbnail_path IS NULL
        LIMIT ?
      `, [remainingLimit]);

      for (const img of completionImages) {
        try {
          const fullPath = path.join(drawingsDir, img.image_path);

          // 检查文件是否存在
          if (!fs.existsSync(fullPath)) {
            // 完工记录图片不存在时，清除图片相关字段而不是删除整个记录
            await run(`UPDATE completion_records SET image_path = NULL, file_name = NULL, mime_type = NULL, thumbnail_path = NULL WHERE id = ?`, [img.id]);
            deletedCount++;
            console.log(`[thumbnails] 清除无效完工记录图片: ID=${img.id}, path=${img.image_path}`);
            continue;
          }

          // 生成缩略图
          const ext = path.extname(img.image_path);
          const thumbnailFilename = `thumb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
          const thumbnailPath = `${img.drawing_id}/${thumbnailFilename}`;
          const thumbnailFullPath = path.join(drawingsDir, thumbnailPath);

          const thumbnailDir = path.dirname(thumbnailFullPath);
          if (!fs.existsSync(thumbnailDir)) {
            fs.mkdirSync(thumbnailDir, { recursive: true });
          }

          await sharp(fullPath)
            .resize(150, 150, { fit: 'cover', position: 'center' })
            .jpeg({ quality: 80 })
            .toFile(thumbnailFullPath);

          await run(`UPDATE completion_records SET thumbnail_path = ? WHERE id = ?`, [thumbnailPath, img.id]);
          successCount++;
        } catch (err) {
          failCount++;
          errors.push({ type: 'completion', id: img.id, error: err.message });
          console.error(`[thumbnails] 处理完工图片失败: ID=${img.id}, error=${err.message}`);
        }
      }
    }

    // 获取剩余未处理数量
    const remainingDrawings = await get(`SELECT COUNT(*) as count FROM drawing_images WHERE thumbnail_path IS NULL`);
    const remainingCompletions = await get(`SELECT COUNT(*) as count FROM completion_records WHERE image_path IS NOT NULL AND thumbnail_path IS NULL`);
    const remaining = (remainingDrawings.count || 0) + (remainingCompletions.count || 0);

    let message = `处理完成：成功 ${successCount} 张`;
    if (deletedCount > 0) message += `，清理无效记录 ${deletedCount} 条`;
    if (failCount > 0) message += `，失败 ${failCount} 张`;

    res.json({
      message,
      processed: successCount + failCount + deletedCount,
      success: successCount,
      failed: failCount,
      deleted: deletedCount,
      remaining,
      errors: errors.length <= 10 ? errors : errors.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;