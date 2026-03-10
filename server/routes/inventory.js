const express = require('express');
const { query, get, run } = require('../database');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const os = require('os');
const fs = require('fs');

const router = express.Router();

// 所有路由都需要认证
router.use(authenticateToken);

// 获取统计信息
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.id;

    // 总数量
    const totalResult = await get(
      `SELECT COALESCE(SUM(quantity), 0) as total FROM user_inventory WHERE user_id = ?`,
      [userId]
    );
    const totalQuantity = totalResult.total;

    // 种类数
    const typesResult = await get(
      `SELECT COUNT(*) as count FROM user_inventory WHERE user_id = ? AND quantity > 0`,
      [userId]
    );
    const typesCount = typesResult.count;

    // 获取用户自定义预警阈值，如果没有则使用全局设置
    const userThresholdResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_warning_threshold_${userId}`]
    );
    const globalThresholdResult = await get(`SELECT value FROM settings WHERE key = 'warning_threshold'`);

    const threshold = userThresholdResult
      ? parseInt(userThresholdResult.value)
      : parseInt(globalThresholdResult?.value || '300');

    // 获取用户设置：是否将 0 库存计为缺货
    const userIncludeZeroResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_include_zero_lowstock_${userId}`]
    );
    const includeZero = userIncludeZeroResult ? (userIncludeZeroResult.value === '1') : false;

    // 获取用户安全库存设置
    const userSafetyStockResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_safety_stock_${userId}`]
    );
    const safetyStock = userSafetyStockResult ? parseInt(userSafetyStockResult.value) || 0 : 0;

    // 低库存统计：考虑库存+在途数的合计，包含0库存的规则由 includeZero 控制
    let lowStockResult;
    if (includeZero) {
      // include items with total <= threshold (including 0)
      lowStockResult = await get(
        `SELECT COUNT(*) as count
         FROM (
           SELECT 
             p.id,
             COALESCE(ui.quantity, 0) as quantity,
             COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0) as in_transit_quantity
           FROM products p
           LEFT JOIN user_inventory ui ON p.id = ui.product_id AND ui.user_id = ?
           LEFT JOIN orders o ON p.code = o.product_code AND o.user_id = ?
           GROUP BY p.id, ui.quantity
           HAVING (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) <= ?
         )`,
        [userId, userId, threshold]
      );
    } else {
      // original behavior: >0 and < threshold
      lowStockResult = await get(
        `SELECT COUNT(*) as count
         FROM (
           SELECT 
             p.id,
             COALESCE(ui.quantity, 0) as quantity,
             COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0) as in_transit_quantity
           FROM products p
           LEFT JOIN user_inventory ui ON p.id = ui.product_id AND ui.user_id = ?
           LEFT JOIN orders o ON p.code = o.product_code AND o.user_id = ?
           GROUP BY p.id, ui.quantity
           HAVING (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) > 0
           AND (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) < ?
         )`,
        [userId, userId, threshold]
      );
    }
    const lowStockCount = lowStockResult.count;

    // 待拼不足统计：待消耗数量 > (实际库存 - 安全库存)
    const pendingShortageResult = await get(
      `SELECT COUNT(*) as count
       FROM (
         SELECT
           p.id,
           COALESCE(ui.quantity, 0) as quantity,
           COALESCE((
            SELECT SUM(dm.quantity * COALESCE(d.pending_quantity, 1))
            FROM drawing_materials dm
            JOIN drawings d ON dm.drawing_id = d.id
            WHERE d.user_id = ? AND dm.product_id = p.id
           ), 0) as pending_consumption
         FROM products p
         LEFT JOIN user_inventory ui ON p.id = ui.product_id AND ui.user_id = ?
         WHERE p.id IN (
           SELECT DISTINCT dm.product_id
         FROM drawing_materials dm
           JOIN drawings d ON dm.drawing_id = d.id
            WHERE d.user_id = ? AND d.status = 'pending'
         )
        AND COALESCE((
           SELECT SUM(dm.quantity * COALESCE(d.pending_quantity, 1))
           FROM drawing_materials dm
           JOIN drawings d ON dm.drawing_id = d.id
           WHERE d.user_id = ? AND d.status = 'pending' AND dm.product_id = p.id
         ), 0) > 0
        AND COALESCE((
           SELECT SUM(dm.quantity * COALESCE(d.pending_quantity, 1))
           FROM drawing_materials dm
           JOIN drawings d ON dm.drawing_id = d.id
           WHERE d.user_id = ? AND d.status = 'pending' AND dm.product_id = p.id
         ), 0) >= (COALESCE(ui.quantity, 0) - ?)
       )`,
      [userId, userId, userId, userId, userId, safetyStock]
    );
    const pendingShortageCount = pendingShortageResult.count;

    // 预警阈值
    const warningThreshold = threshold;
    // 安全库存
    const userSafetyStock = safetyStock;

    res.json({
      totalQuantity,
      typesCount,
      lowStockCount,
      pendingShortageCount,
      warningThreshold,
      safetyStock: userSafetyStock
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 启用/禁用类别
router.put('/categories/:id/enable', async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { enabled } = req.body;
    const parsed = enabled ? 1 : 0;
    await run(`UPDATE categories SET enabled = ? WHERE id = ?`, [parsed, id]);
    res.json({ message: '类别设置已保存' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取库存列表
router.get('/list', async (req, res) => {
  try {
    const userId = req.user.id;
    const { category, search, inStockOnly, lowStockOnly, pendingShortageOnly } = req.query;

    // 获取用户自定义预警阈值，如果没有则使用全局设置
    const userThresholdResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_warning_threshold_${userId}`]
    );
    const globalThresholdResult = await get(`SELECT value FROM settings WHERE key = 'warning_threshold'`);
    
    const threshold = userThresholdResult
      ? parseInt(userThresholdResult.value)
      : parseInt(globalThresholdResult?.value || '300');
    
  // 获取用户设置：是否将 0 库存计为缺货
  const userIncludeZeroResult = await get(
    `SELECT value FROM settings WHERE key = ?`,
    [`user_include_zero_lowstock_${userId}`]
  );
  const includeZero = userIncludeZeroResult ? (userIncludeZeroResult.value === '1') : false;
  
  // 获取用户安全库存设置（用于待拼不足判断）
  const userSafetyStockResult = await get(
    `SELECT value FROM settings WHERE key = ?`,
    [`user_safety_stock_${userId}`]
  );
  const safetyStock = userSafetyStockResult ? parseInt(userSafetyStockResult.value) || 0 : 0;

    let sql = `
      SELECT 
        p.id,
        p.code,
        p.color_code,
        p.color_hex,
        c.name as category_name,
        c.id as category_id,
        c.enabled as category_enabled,
        COALESCE(ui.quantity, 0) as quantity,
        COALESCE(ui.unit_price, 0) as unit_price,
        COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0) as in_transit_quantity,
        COALESCE((
          SELECT SUM(dm.quantity * COALESCE(d.pending_quantity, 1))
          FROM drawing_materials dm
          JOIN drawings d ON dm.drawing_id = d.id
          WHERE d.user_id = ? AND d.status = 'pending' AND dm.product_id = p.id
        ), 0) as pending_consumption
      FROM products p
      INNER JOIN categories c ON p.category_id = c.id
      LEFT JOIN user_inventory ui ON p.id = ui.product_id AND ui.user_id = ?
      LEFT JOIN orders o ON p.code = o.product_code AND o.user_id = ? AND o.status = 'in_transit'
      WHERE 1=1 AND c.enabled = 1
    `;
    const params = [userId, userId, userId];

    if (category) {
      sql += ' AND c.name = ?';
      params.push(category);
    }

    if (search) {
      sql += ' AND (p.code LIKE ? OR p.color_code LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ' GROUP BY p.id, p.code, p.color_code, p.color_hex, c.name, c.id, ui.quantity';

    if (inStockOnly === 'true') {
      sql += ' HAVING COALESCE(ui.quantity, 0) > 0 OR COALESCE(SUM(CASE WHEN o.status = \'in_transit\' THEN o.quantity ELSE 0 END), 0) > 0';
    }

    if (lowStockOnly === 'true') {
      if (includeZero) {
        // 包含0库存：包含 <= threshold 的项（包括0）
        sql += ` HAVING (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) <= ?`;
        params.push(threshold);
      } else {
        // 不包含0库存：同原逻辑，排除 0
        sql += ` HAVING (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) > 0
                AND (COALESCE(ui.quantity, 0) + COALESCE(SUM(CASE WHEN o.status = 'in_transit' THEN o.quantity ELSE 0 END), 0)) < ?`;
        params.push(threshold);
      }
    }

    if (pendingShortageOnly === 'true') {
      // 待拼不足：仅包含有待消耗的物料，并且待消耗 >= (实际库存 - 安全库存)
      sql += ` HAVING COALESCE((
        SELECT SUM(dm.quantity)
        FROM drawing_materials dm
        JOIN drawings d ON dm.drawing_id = d.id
        WHERE d.user_id = ? AND d.status = 'pending' AND dm.product_id = p.id
      ), 0) > 0
      AND COALESCE((
        SELECT SUM(dm.quantity)
        FROM drawing_materials dm
        JOIN drawings d ON dm.drawing_id = d.id
        WHERE d.user_id = ? AND d.status = 'pending' AND dm.product_id = p.id
      ), 0) >= (COALESCE(ui.quantity, 0) - ?)`; 
      params.push(userId, userId, safetyStock);
    }

    sql += ' ORDER BY c.sort_order, c.id, p.code';

    const products = await query(sql, params);

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 在统计信息中返回 includeZero 设置，供前端初始化开关
router.get('/stats/include-zero', async (req, res) => {
  try {
    const userId = req.user.id;
    const userIncludeZeroResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_include_zero_lowstock_${userId}`]
    );
    const includeZero = userIncludeZeroResult ? (userIncludeZeroResult.value === '1') : false;
    res.json({ includeZero });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有类别
router.get('/categories', async (req, res) => {
  try {
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    let sql = `
      SELECT 
        c.id,
        c.name,
        c.sort_order,
        c.enabled,
        COUNT(DISTINCT p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      WHERE 1=1
    `;
    const params = [];
    if (!includeAll) {
      sql += ` AND c.enabled = 1`;
    }
    sql += ` GROUP BY c.id, c.name, c.sort_order, c.enabled ORDER BY c.sort_order, c.id`;
    const categories = await query(sql, params);

    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取所有产品（按类别分组，用于产品选择器）
router.get('/products/all', async (req, res) => {
  try {
    const products = await query(`
      SELECT 
        p.id,
        p.code,
        p.color_code,
        p.color_hex,
        c.id as category_id,
        c.name as category_name,
        c.enabled as category_enabled,
        c.sort_order
      FROM products p
      INNER JOIN categories c ON p.category_id = c.id
      WHERE c.enabled = 1
      ORDER BY c.sort_order, c.id, p.code
    `);

    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取指定产品的库存与在途数量（按当前用户）
router.get('/products/:id/stock', async (req, res) => {
  try {
    const userId = req.user.id;
    const productId = req.params.id;
    const product = await get(`SELECT id, code FROM products WHERE id = ? LIMIT 1`, [productId]);
    if (!product) return res.status(404).json({ error: '产品未找到' });

    const inv = await get(`SELECT COALESCE(quantity, 0) as quantity, COALESCE(unit_price, 0) as unit_price FROM user_inventory WHERE user_id = ? AND product_id = ?`, [userId, productId]);
    const inTransitRow = await get(`SELECT COALESCE(SUM(quantity), 0) as qty FROM orders WHERE user_id = ? AND product_code = ? AND status = 'in_transit'`, [userId, product.code]);

    res.json({
      inventory_qty: inv ? inv.quantity : 0,
      in_transit_qty: inTransitRow ? inTransitRow.qty : 0,
      unit_price: inv ? inv.unit_price : 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 导入采购记录（CSV 文件，字段顺序：大类,代码,数量,金额,日期）
// 上传字段名: file
const uploadCsv = multer({ dest: os.tmpdir() });
router.post('/purchases/import', uploadCsv.single('file'), async (req, res) => {
  try {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ error: '缺少上传文件（字段名 file）' });
    }
    const content = fs.readFileSync(req.file.path, 'utf8');
    // 简单 CSV 解析：按行分割，按逗号分列（不支持复杂逃逸）
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const results = { imported: 0, skipped: 0, errors: [] };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cols = line.split(',').map(c => c.trim());
      if (cols.length < 5) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '字段数量不足', raw: line });
        continue;
      }
      const [categoryName, code, qtyStr, amountStr, dateStr] = cols;
      const quantity = parseInt(qtyStr || '0');
      const totalAmount = parseFloat(amountStr || '0');
      const createdAt = dateStr || null;

      // 查找产品（按类别名 + code）
      const prod = await get(
        `SELECT p.id FROM products p JOIN categories c ON p.category_id = c.id WHERE p.code = ? AND c.name = ?`,
        [code, categoryName]
      );
      if (!prod) {
        // 如果找不到产品，记录并跳过
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '未找到对应产品（category+code）', raw: line });
        continue;
      }

      // 插入订单（采购记录），状态默认为 in_transit
      try {
        if (createdAt) {
          await run(
            `INSERT INTO orders (user_id, product_code, quantity, total_amount, status, created_at) VALUES (?, ?, ?, ?, 'in_transit', ?)`,
            [userId, code, quantity, totalAmount, createdAt]
          );
        } else {
          await run(
            `INSERT INTO orders (user_id, product_code, quantity, total_amount, status) VALUES (?, ?, ?, ?, 'in_transit')`,
            [userId, code, quantity, totalAmount]
          );
        }
        results.imported++;
      } catch (err) {
        results.skipped++;
        results.errors.push({ line: i + 1, reason: '数据库插入失败', error: err.message, raw: line });
      }
    }

    // 删除临时文件
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ message: '导入完成', result: results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新库存数量（手动操作，记录变动日志）
router.post('/update', async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, quantity } = req.body;
    // 允许负库存（用于记录消耗或短缺）

    // 检查产品是否存在
    const product = await get('SELECT id FROM products WHERE id = ?', [productId]);
    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    // 查询原有数量
    const existing = await get(
      `SELECT quantity FROM user_inventory WHERE user_id = ? AND product_id = ?`,
      [userId, productId]
    );
    const beforeQty = existing ? existing.quantity : 0;

    // 更新或插入库存
    await run(
      `INSERT INTO user_inventory (user_id, product_id, quantity, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, product_id) 
       DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`,
      [userId, productId, quantity, quantity]
    );

    const afterQty = quantity;
    const diff = afterQty - beforeQty;

    if (diff !== 0) {
      await run(
        `INSERT INTO inventory_change_logs 
          (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          productId,
          diff > 0 ? 'manual_increase' : 'manual_decrease',
          'manual',
          diff,
          beforeQty,
          afterQty,
          '用户手动修改库存',
        ]
      );
    }

    res.json({ message: '更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新库存单价（手动操作）
router.put('/price', async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId, unitPrice } = req.body;

    if (unitPrice === undefined || unitPrice === null) {
      return res.status(400).json({ error: '单价不能为空' });
    }

    const parsedPrice = parseFloat(unitPrice);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: '单价必须为大于等于0的数字' });
    }

    // 检查产品是否存在
    const product = await get('SELECT id FROM products WHERE id = ?', [productId]);
    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    // 更新或插入库存单价（如果库存不存在，则创建一条记录）
    await run(
      `INSERT INTO user_inventory (user_id, product_id, quantity, unit_price, updated_at)
       VALUES (?, ?, 0, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, product_id) 
       DO UPDATE SET unit_price = ?, updated_at = CURRENT_TIMESTAMP`,
      [userId, productId, parsedPrice, parsedPrice]
    );

    res.json({ message: '单价更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新库存（手动批量操作，记录变动日志）
router.post('/batch-update', async (req, res) => {
  try {
    const userId = req.user.id;
    const { updates } = req.body; // [{productId, quantity}, ...]

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: '无效的更新数据' });
    }

    const stmt = `INSERT INTO user_inventory (user_id, product_id, quantity, updated_at)
                  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(user_id, product_id) 
                  DO UPDATE SET quantity = ?, updated_at = CURRENT_TIMESTAMP`;

    for (const update of updates) {
      // allow negative quantities

      const existing = await get(
        `SELECT quantity FROM user_inventory WHERE user_id = ? AND product_id = ?`,
        [userId, update.productId]
      );
      const beforeQty = existing ? existing.quantity : 0;

      await run(stmt, [userId, update.productId, update.quantity, update.quantity]);

      const afterQty = update.quantity;
      const diff = afterQty - beforeQty;

      if (diff !== 0) {
        await run(
          `INSERT INTO inventory_change_logs 
            (user_id, product_id, change_type, source, quantity_change, quantity_before, quantity_after, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            update.productId,
            diff > 0 ? 'manual_increase' : 'manual_decrease',
            'manual',
            diff,
            beforeQty,
            afterQty,
            '用户批量修改库存',
          ]
        );
      }
    }

    res.json({ message: '批量更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新用户预警阈值
router.put('/settings/warning-threshold', async (req, res) => {
  try {
    const userId = req.user.id;
    const { threshold } = req.body;
    
    if (threshold < 0) {
      return res.status(400).json({ error: '预警阈值不能为负数' });
    }

    const key = `user_warning_threshold_${userId}`;
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, threshold.toString(), threshold.toString()]
    );
    res.json({ message: '预警阈值更新成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置是否将0库存计为缺货（包含0库存），值 '1' or '0'
router.put('/settings/include-zero', async (req, res) => {
  try {
    const userId = req.user.id;
    const { includeZero } = req.body;
    const value = includeZero ? '1' : '0';
    const key = `user_include_zero_lowstock_${userId}`;
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value]
    );
    res.json({ message: '设置已保存' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取用户安全库存设置
router.get('/settings/safety-stock', async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_safety_stock_${userId}`]
    );
    const safetyStock = result ? parseInt(result.value) || 0 : 0;
    res.json({ safetyStock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 设置用户安全库存
router.put('/settings/safety-stock', async (req, res) => {
  try {
    const userId = req.user.id;
    const { safetyStock } = req.body;

    if (safetyStock < 0) {
      return res.status(400).json({ error: '安全库存不能为负数' });
    }

    const key = `user_safety_stock_${userId}`;
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, safetyStock.toString(), safetyStock.toString()]
    );
    res.json({ message: '安全库存设置已保存' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /inventory/settings/unit-price-per-material - 获取单个物料售价设置
router.get('/settings/unit-price-per-material', async (req, res) => {
  try {
    const userId = req.user.id;
    const userResult = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_unit_price_per_material_${userId}`]
    );
    const defaultResult = await get(
      `SELECT value FROM settings WHERE key = 'default_unit_price_per_material'`
    );
    const unitPrice = userResult
      ? parseFloat(userResult.value)
      : parseFloat(defaultResult?.value || '0.01');
    res.json({ unitPrice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /inventory/settings/unit-price-per-material - 更新单个物料售价设置
router.put('/settings/unit-price-per-material', async (req, res) => {
  try {
    const userId = req.user.id;
    const { unitPrice } = req.body;
    if (unitPrice < 0) {
      return res.status(400).json({ error: '单价不能为负数' });
    }
    const key = `user_unit_price_per_material_${userId}`;
    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, unitPrice.toString(), unitPrice.toString()]
    );
    res.json({ message: '单个物料售价设置已保存', unitPrice });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /inventory/settings/consumption-excluded-materials - 获取消耗统计排除物料列表
router.get('/settings/consumption-excluded-materials', async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await get(
      `SELECT value FROM settings WHERE key = ?`,
      [`user_consumption_excluded_materials_${userId}`]
    );
    const excludedMaterials = result ? result.value : '';
    res.json({ excludedMaterials });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /inventory/settings/consumption-excluded-materials - 更新消耗统计排除物料列表
router.put('/settings/consumption-excluded-materials', async (req, res) => {
  try {
    const userId = req.user.id;
    const { excludedMaterials } = req.body;

    // 验证输入
    if (excludedMaterials !== undefined && excludedMaterials !== null) {
      if (typeof excludedMaterials !== 'string') {
        return res.status(400).json({ error: '排除物料必须是字符串' });
      }

      // 验证格式: 允许空字符串或逗号分隔的物料代码
      if (excludedMaterials.trim() !== '') {
        const codes = excludedMaterials.split(',').map(s => s.trim()).filter(s => s !== '');
        // 验证每个代码是否存在于products表中
        for (const code of codes) {
          const product = await get(
            `SELECT id FROM products WHERE code = ? LIMIT 1`,
            [code]
          );
          if (!product) {
            return res.status(400).json({
              error: `物料代码 "${code}" 不存在`,
              invalidCode: code
            });
          }
        }
      }
    }

    const key = `user_consumption_excluded_materials_${userId}`;
    const value = excludedMaterials || '';

    await run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = ?`,
      [key, value, value]
    );

    res.json({ message: '排除物料设置已保存', excludedMaterials: value });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 指定产品的库存变动记录
router.get('/logs', async (req, res) => {
  try {
    const userId = req.user.id;
    const { productId } = req.query;

    if (!productId) {
      return res.status(400).json({ error: '缺少productId参数' });
    }

    const logs = await query(
      `SELECT 
         l.id,
         l.change_type,
         l.source,
         l.quantity_change,
         l.quantity_before,
         l.quantity_after,
         l.order_id,
         l.remark,
         l.created_at
       FROM inventory_change_logs l
       WHERE l.user_id = ? AND l.product_id = ?
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT 200`,
      [userId, productId]
    );

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
